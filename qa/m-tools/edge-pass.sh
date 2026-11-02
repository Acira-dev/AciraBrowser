#!/bin/sh
# edge-pass.sh PORT THEME MODE(strip|sidebar) -- edge-gap scan of every surface with real hover. Prints only findings, tagged with the surface.
# Needs tabs example.com + acira://settings history bookmarks downloads rewind routines (opened by the caller). Caps: 16 settings sections, hover cap 60 per surface.
P=$1; TH=$2; MODE=${3:-strip}; T="$(dirname "$0")"; M=http://127.0.0.1:$P
VT=false; [ "$MODE" = sidebar ] && VT=true
curl -s $M/eval --data-binary "window.acira.dispatch({type:'settings.update',patch:{appearance:'$TH',verticalTabs:$VT}}).then(()=>1)" >/dev/null; sleep 2.2
if [ "$MODE" = sidebar ]; then curl -s $M/eval --data-binary "(()=>{const r=document.querySelector('.ed-rail');if(r&&!r.className.includes('is-expanded')){const b=[...document.querySelectorAll('button')].find(b=>/sidebar/i.test(b.getAttribute('aria-label')||'')&&b.getBoundingClientRect().width>0);b&&b.click()}return 1})()" >/dev/null; sleep 1.5; fi
echo "### edge $TH $MODE ($(curl -s $M/eval --data-binary 'innerWidth+"x"+innerHeight+"@"+devicePixelRatio'))"
POPUPS=${EDGE_POPUPS:-"Acira menu|main-menu
Page information|site-info
Extensions|extensions
All open tabs|tab-viewer
Switch profile|profile
Show Tor status|tor"}
run(){ out=$(sh $T/edge.sh $P $2 ${3:-60} | tail -n +2); [ -n "$out" ] && { echo "[$1]"; echo "$out" | cut -c1-210; }; }
sel(){ curl -s $M/eval --data-binary "(async()=>{const s=await window.acira.getSnapshot();const t=s.tabs.find(t=>t.url===$1);if(t)await window.acira.dispatch({type:'tab.select',id:t.id});return !!t})()" >/dev/null; sleep 1.1; }
run chrome-$MODE ui 80
for u in history bookmarks downloads rewind routines new; do sel "'acira://$u'"; run page-$u ui 50; done
sel "'acira://settings'"
i=0; while [ $i -lt 16 ]; do N=$(curl -s $M/eval --data-binary "(async()=>{const navs=[...document.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.x<260&&r.y>80&&b.textContent.trim()&&!b.closest('.ed-rail,.tab-strip-container,header')&&!/Back to browser/.test(b.textContent)});const b=navs[$i];if(!b)return 'END';b.click();await new Promise(r=>setTimeout(r,500));return b.textContent.trim()})()" | tr -d '"'); [ "$N" = "END" ] && break; run "settings-$N" ui 40; i=$((i+1)); done
curl -s $M/eval --data-binary "window.acira.getSnapshot().then(s=>window.acira.dispatch({type:'tab.select',id:s.tabs.find(t=>t.url.includes('example.com')).id}))" >/dev/null; sleep 1.5
echo "$POPUPS" | while IFS= read -r spec; do
  L="${spec%%|*}"; N="${spec##*|}"; curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; sleep .5
  sh $T/cl.sh $P "$L" >/dev/null 2>&1 || { echo "(no trigger: $N)"; continue; }; sleep 1.3; run "popup-$N" overlay 50
done
curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; sleep .4
curl -s $M/keys --data-binary '["Control+Shift+K"]' >/dev/null; sleep 1.2; run popup-command-bar overlay 40; curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; sleep .4
curl -s $M/click --data-binary '{"x":300,"y":16,"button":"right"}' >/dev/null; sleep 1.2; run popup-tab-menu overlay 30; curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; sleep .4
# toast: close a tab (Undo toast), scan the overlay while it is up
curl -s $M/eval --data-binary "window.acira.dispatch({type:'tab.new',url:'acira://new'}).then(()=>window.acira.getSnapshot()).then(s=>window.acira.dispatch({type:'tab.close',id:s.tabs[s.tabs.length-1].id}))" >/dev/null; sleep 1; run toast overlay 10
