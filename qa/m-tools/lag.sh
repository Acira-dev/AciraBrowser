#!/bin/sh
# lag.sh PORT "button label" name [uiaction=click|keys:Control+Shift+K]
S="$(dirname "$0")"; P=$1; M=http://127.0.0.1:$P
curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; sleep .7
curl -s $M/oeval --data-binary "$(cat $S/lag.js)" >/dev/null
T0=$(date +%s%3N)
case "$4" in rclick:*) curl -s $M/click --data-binary "{\"x\":${4#rclick:},\"button\":\"right\"}" >/dev/null;; keys:*) curl -s $M/keys --data-binary "[\"${4#keys:}\"]" >/dev/null;; *) sh $S/cl.sh $P "$2";; esac
sleep 1.1
R=$(sed "s/__T0__/$T0/" $S/lagread.js)
echo "$3 :: $(curl -s $M/oeval --data-binary "$R")"
curl -s $M/okeys --data-binary '["Escape"]' >/dev/null
