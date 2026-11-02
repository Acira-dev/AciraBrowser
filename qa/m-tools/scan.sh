#!/bin/sh
# scan.sh PORT [eval|oeval] : run clip.js, print result with real newlines
S="$(dirname "$0")"
curl -s "http://127.0.0.1:$1/${2:-eval}" --data-binary "$(cat $S/clip.js)" | python -c "import sys,json; t=sys.stdin.read(); print(json.loads(t) if t.startswith('\"') else t)"
