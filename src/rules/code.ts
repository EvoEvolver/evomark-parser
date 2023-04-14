import { evomark_core } from "../core"
import { evomark_parser, parse_node, parse_rule_func, parse_state } from "../parse";
import { evomark_tokenizer, get_closed_tag, get_tag_pair, token, tokener_state, tokenize_rule_func } from "../tokenize";
import { renderToString } from "katex"

function parse(src: string, state: parse_state, param: any, parser: evomark_parser): boolean {
    return true
}

function tokenize(root: parse_node, tokens: token[], tokener: evomark_tokenizer, state: tokener_state) {
    for (let child of root.children) {
        if (child.type == "func_body") {
            let [open, close] = get_tag_pair("span")
            tokens.push(open)
            tokens.push(new token("literal", renderToString(child.content.trim(),
                {
                    throwOnError: false,
                    macros: {},
                    output: "html"
                }
            )))
            tokens.push(close)
            break
        }
    }
}

export function code(core: evomark_core) {
    core.add_rule("code", parse, tokenize, {
       "Code": "@/Code.vue"
    })
}