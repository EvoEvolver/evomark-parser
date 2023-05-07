import { parse_node } from "../parse";
import { hash as spark_hash } from "spark-md5"
import { normalize_text } from "../utils/normalize";

let type_of_cmd = ["var_use", "cmd", "var_assign"]

export const special_one_time_cmd = ["warning", "halted_here"]

function get_cmd_list_for_node(node: parse_node, cmd_list: parse_node[]): void {
    for (let child of node.children) {
        if (type_of_cmd.indexOf(child.type) > -1) {
            cmd_list.push(child)
            continue
        }
        get_cmd_list_for_node(child, cmd_list)
    }
}

export function get_cmd_list(root: parse_node): parse_node[] {
    let cmd_list = []
    get_cmd_list_for_node(root, cmd_list)
    return cmd_list
}

export type exec_rule = (cmd_node: parse_node, state: exec_state, assigned: obj_host) => void

export class evomark_exec {
    public exec_rules = {}
    public add_rule(name: string, rule_func) {
        if (name in this.exec_rules)
            throw Error("Rule with name " + name + " already in rules")
        this.exec_rules[name] = rule_func
    }
    public exec(root: parse_node, ctx: any): exec_state {
        let cache_table = ctx["cache"] || {}
        let saved = ctx["saved"] || {}
        let state = new exec_state(cache_table, saved)
        let cmd_list = get_cmd_list(root)
        for (let cmd of cmd_list) {
            switch (cmd.type) {
                case "var_use": {
                    let host = state.node_to_obj_host(cmd)
                    if (host == null)
                        throw Error("Undefined variable %" + cmd.content)
                    cmd.add_child(new parse_node("literal")).set_content(host.get_content(state))
                    break
                }
                case "var_assign": {
                    let cmd_node = cmd.children[0]
                    let rule = this.exec_rules[cmd_node.content]
                    if (!rule)
                        throw Error("Cannot find rule " + cmd.children[0].content)
                    let var_host = new obj_host()
                    var_host.var_name = cmd.content
                    rule(cmd_node, state, var_host)
                    state.last_var_assign = var_host
                    state.host_map[cmd.content] = var_host
                    break
                }
                case "cmd": {
                    // We ignore warning from the last execution
                    if (special_one_time_cmd.indexOf(cmd.content) > -1) {
                        cmd.remove_self_from_parent()
                        break
                    }

                    let rule = this.exec_rules[cmd.content]
                    if (!rule)
                        throw Error("Cannot find rule " + cmd.content)
                    rule(cmd, state, null)
                    // There is warning added. We must process
                    if (state.warning_list.length != 0) {
                        let message = state.warning_list.join("\n")
                        cmd.add_sibling(new parse_node("cmd"))
                            .set_content("warning")
                            .push_child("body")
                            .push_child("literal")
                            .set_content(message)
                        cmd.add_sibling(new parse_node("sep")).set_content_obj(1)
                        state.warning_list = []
                    }
                    break
                }
                default:
                    throw Error("bug found")
            }
            if (state.halt_flag) {
                let sibling = cmd.get_next_semantic_sibling()
                // Check whether there has already been a label
                if (sibling?.type == "cmd" && sibling.content == "halted_here")
                    break
                else
                    cmd.add_sibling(new parse_node("cmd")).set_content("halted_here")
                break
            }
            state.cmd_pos++
        }
        return state
    }

}


export class exec_state {
    // ID to obj map
    // Store all the cached objects
    // May be read from file. May be saved as cache
    public cache_table: any
    // Saved variables
    public saved_var_table: any
    // Name to var_host map
    public host_map: Record<string, obj_host> = {}
    // A rule function might turn this to true and the execution should halt
    public halt_flag = false
    public last_var_assign: obj_host = null
    public warning_list: string[] = []
    // A number that is different for each cmd in execution
    // Designed for cache salt
    public cmd_pos: number = 0
    public constructor(cache_table: any, saved_var_table: any) {
        this.cache_table = cache_table || {}
        this.saved_var_table = saved_var_table || {}
    }
    public get_ctx() {
        return {
            "cache": this.cache_table,
            "saved": this.saved_var_table
        }
    }
    public save_var(host: obj_host) {
        // TODO handle date type
        if (!host.defined) {
            this.add_warning("Save failed because the variable is Undef")
            return
        }
        let content_to_save = host.get_content(this)
        let var_name = host.var_name
        this.saved_var_table[var_name] = {
            "t": host.data_type,
            "v": content_to_save
        }
    }

    public load_saved_var(var_name: string) {
        // TODO handle date type
        if (var_name in this.saved_var_table) {
            return this.saved_var_table[var_name]
        }
        else
            return null
    }

    public node_to_obj_host(var_use_node: parse_node): obj_host {
        let var_name = var_use_node.content
        return this.name_to_obj_host(var_name)
    }
    public name_to_obj_host(var_name: string): obj_host {
        if (var_name in this.host_map) {
            return this.host_map[var_name]
        }
        else {
            return null
        }
    }
    public read_cache(hash: string): any {
        return this.cache_table[hash]
    }
    public save_cache(hash: string, content: any) {
        this.cache_table[hash] = content
    }
    public add_warning(message: string) {
        this.warning_list.push(message)
    }
    public add_fatal(message: string) {
        this.warning_list.push(message)
        this.halt_flag = true
    }
}


export function get_hash(input: any, caller: string) {
    return spark_hash([caller, "$", JSON.stringify(input)].join(""))
}

export enum host_type {
    Undef,
    Lazy, // In this case, the content of the host is the input hash
    InDoc,  // Normal case. The content is deduced from the document
    Saved
}

export class obj_host {
    public defined: boolean = false
    public use_cache: boolean = false
    public var_name: string = null
    public data_type = null
    //public status: host_type = host_type.Undef
    // Content for cached obj
    public input_hash = null
    public input: any = null
    public eval_func: (input: any) => any = null
    private _content: any = null
    public dependency: obj_host[] = []
    public get_content(state: exec_state): any {
        if (this._content == null) {
            if (this.use_cache) {
                let res = eval_and_cache(this, state.cache_table)
                if (res == null) {
                    this._content == null
                }
                this._content = res
                return this._content
            }
            return null
        }
        else
            return this._content
    }
    public get_text(state: exec_state): string {
        let content = this.get_content(state)
        switch (this.data_type) {
            case "str": {
                return content
            }
            default:
            case "obj": {
                return JSON.stringify(content)
            }
        }
    }
    public set_content(content: any) {
        if(content != null)
            this.defined = true
        this._content = content
    }
    public constructor() {
    }
}

export function eval_without_cache(host: obj_host): any {
    let res = host.eval_func(host.input)
    return res
}


export function eval_and_cache(host: obj_host, cache_table: any): any {
    let cached = cache_table[host.input_hash]
    if (cached != undefined)
        return cached
    let res = host.eval_func(host.input)
    cache_table[host.input_hash] = res
    host.set_content(res)
    return res
}

export function eval_to_text(nodes: parse_node[], state: exec_state): [string, obj_host[]] {
    let dependency: obj_host[] = []
    let undef = []
    for (let node of nodes) {
        if (node.type == "var_use") {
            let var_host = state.node_to_obj_host(node)
            if (var_host != null) {
                dependency.push(var_host)
                if (!var_host.defined) {
                    undef.push(node.content)
                }
            }
            else {
                undef.push(node.content)
                dependency.push(null)
            }

        }
    }
    let res: string[] = []
    let i_var = 0
    for (let node of nodes) {
        if (node.type == "var_use") {
            let var_host = dependency[i_var]
            if (var_host != null) {
                let content = var_host.get_content(state)
                res.push(content + " ")
            }
            else
                res.push("*Error*")
            i_var++
        }
        else if (node.type == "literal") {
            res.push(node.content + " ")
        }
        else if (node.type == "sep") {
            res.push("\n".repeat(node.content_obj))
        }
    }

    if (undef.length > 0) {
        for (let name of undef) {
            state.add_warning("Variable \"" + name + "\" is not defined")
        }
        return [null, dependency]
    }

    let content = normalize_text(res.join(""))

    return [content, dependency]
}