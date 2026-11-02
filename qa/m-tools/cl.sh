#!/bin/sh
# cl.sh PORT "aria-label substring" : real mouse click at the centre of the first visible button with that label
M=http://127.0.0.1:$1
P=$(curl -s $M/eval --data-binary "(()=>{const b=[...document.querySelectorAll('button,[role=button],[role=tab]')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(b).visibility!=='hidden'&&((b.getAttribute('aria-label')||'')+'|'+(b.title||'')+'|'+b.textContent.trim()).includes('$2')})[0];if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
[ "$P" = "null" ] && { echo "NOBTN $2"; exit 1; }
curl -s $M/click --data-binary "$P" >/dev/null
