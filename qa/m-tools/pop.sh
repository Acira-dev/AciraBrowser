#!/bin/sh
S="$(dirname "$0")"
curl -s "http://127.0.0.1:$1/oeval" --data-binary "$(cat $S/pop.js)" | sed "s/^\"//;s/\"\$//"
echo
