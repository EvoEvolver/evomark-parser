%a = $hello{
  My name is Zijian! What is your name? Answer:
}

$show{%a}
$t{
  Hello! My name is Zijian! What is your name? Answer:
}

%res = $lm{%a}

$show{%res}
$t{
  Hello, my name is [name].
}

%res
