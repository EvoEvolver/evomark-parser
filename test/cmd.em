%b = $def{
  hello
}

%a = $def{
  %b is hello
  %b is not hello
}

%h = $hello{
  %a

  
}

$cache{%h}("e173e4a1fe31a2c41ee8d4cd414a9818"){Hello! hello  is hello 
hello  is not hello

}

$show{%h}
$t{
  Hello! hello  is hello 
hello  is not hello 

 
}

