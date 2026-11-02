#!/bin/sh
# pass.sh PORT THEME WxH|x,y,w,h  -- one surface pass: pages, Settings sections, popups. Prints only problems (clip hits, no-popup, slow popups).
# Needs tabs: example.com + acira://settings history bookmarks downloads rewind routines (opened by the caller). Hard caps: 16 settings sections.
P=$1; TH=$2; SZ=$3; T="$(dirname "$0")"; M=http://127.0.0.1:$P
case "$SZ" in *,*) B="{\"x\":$(echo $SZ|cut -d, -f1),\"y\":$(echo $SZ|cut -d, -f2),\"width\":$(echo $SZ|cut -d, -f3),\"height\":$(echo $SZ|cut -d, -f4)}";; *) B="{\"x\":-1580,\"y\":-60,\"width\":${SZ%x*},\"height\":${SZ#*x}}";; esac
curl -s $M/bounds --data-binary "$B" >/dev/null; curl -s $M/bounds --data-binary "$B" >/dev/null
curl -s $M/eval --data-binary "window.acira.dispatch({type:'settings.update',patch:{appearance:'$TH',verticalTabs:false}}).then(()=>1)" >/dev/null; sleep 2
echo "### $TH $SZ  (innerWidth $(curl -s $M/eval --data-binary 'innerWidth+"x"+innerHeight'))"
hit(){ r=$(sh $T/scan.sh $P $2 | grep -v "^ellipsis" | grep -v "^no hits" | grep -vE "Bookmark added|Tab actions|span.tab-title|sb-title" | head -4); [ -n "$r" ] && { echo "CLIP $1:"; echo "$r" | cut -c1-200; curl -s "$M/shot?name=$TH-$SZ-$1" >/dev/null; }; }
sel(){ curl -s $M/eval --data-binary "(async()=>{const s=await window.acira.getSnapshot();const t=s.tabs.find(t=>t.url===$1);if(t)await window.acira.dispatch({type:'tab.select',id:t.id});return !!t})()" >/dev/null; sleep 1; }
for u in history bookmarks downloads rewind routines new; do sel "'acira://$u'"; hit page-$u eval; done
sel "'acira://settings'"
i=0; while [ $i -lt 16 ]; do N=$(curl -s $M/eval --data-binary "(async()=>{const navs=[...document.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.x<260&&r.y>80&&b.textContent.trim()&&!/Back to browser/.test(b.textContent)});const b=navs[$i];if(!b)return 'END';b.click();await new Promise(r=>setTimeout(r,450));return b.textContent.trim()})()" | tr -d '"'); [ "$N" = "END" ] && break; hit "settings-$(echo $N|tr ' &' '__')" eval; i=$((i+1)); done
curl -s $M/eval --data-binary "window.acira.getSnapshot().then(s=>window.acira.dispatch({type:'tab.select',id:s.tabs.find(t=>t.url.includes('example.com')).id}))" >/dev/null; sleep 1.5
curl -s $M/move --data-binary '{"x":300,"y":400}' >/dev/null
for spec in "Acira menu|main-menu" "Page information|site-info" "Extensions|extensions" "All open tabs|tab-viewer" "Switch profile|profile" "Show Tor status|tor"; do
  L="${spec%%|*}"; N="${spec##*|}"; curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; sleep .5
  if ! sh $T/cl.sh $P "$L" >/dev/null 2>&1; then echo "NOTRIGGER $N ($L)"; continue; fi
  sleep 1.3; [ "$(curl -s $M/oeval --data-binary "document.querySelectorAll('.browser-popup').length")" = "0" ] && { echo "NOPOPUP $N"; continue; }
  hit "popup-$N" oeval
done
curl -s $M/okeys --data-binary '["Escape"]' >/dev/null
for spec in "Control+Shift+K|command-bar" "Control+f|find-bar"; do K="${spec%%|*}"; N="${spec##*|}"; sleep .5; curl -s $M/keys --data-binary "[\"$K\"]" >/dev/null; sleep 1.2; [ "$(curl -s $M/oeval --data-binary "document.querySelectorAll('.browser-popup').length")" = "0" ] && echo "NOPOPUP $N" || hit "popup-$N" oeval; curl -s $M/okeys --data-binary '["Escape"]' >/dev/null; done
curl -s $M/click --data-binary '{"x":300,"y":16,"button":"right"}' >/dev/null; sleep 1.2; hit popup-tab-menu oeval; curl -s $M/okeys --data-binary '["Escape"]' >/dev/null
for spec in "Acira menu|main-menu" "All open tabs|tab-viewer" "Page information|site-info"; do L="${spec%%|*}"; N="${spec##*|}"; echo "LAG $N: $(sh $T/lag.sh $P "$L" $N 2>/dev/null | cut -c1-200)"; done
