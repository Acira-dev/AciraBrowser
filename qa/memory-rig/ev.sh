#!/bin/zsh
# usage: ev.sh 'js body'   (or ev.sh -f file.js)
if [[ "$1" == "-f" ]]; then BODY="$(cat "$2")"; else BODY="$1"; fi
curl -s --max-time ${EV_TIMEOUT:-300} -X POST --data-binary "$BODY" http://127.0.0.1:${RAM_PORT:-9831}/eval
echo
