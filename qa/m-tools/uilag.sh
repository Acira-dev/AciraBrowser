#!/bin/sh
# uilag.sh PORT name 'js-action-expression-returning-promise' [windowMs]
M=http://127.0.0.1:$1; W=${4:-700}
curl -s $M/eval --data-binary "(()=>{const L=window.__ulag={f:[],long:[]};const o=performance.timeOrigin;const t=x=>{if(L.s)return;L.f.push(o+x);if(L.f.length<300)requestAnimationFrame(t)};requestAnimationFrame(t);try{new PerformanceObserver(l=>{for(const e of l.getEntries())L.long.push(Math.round(e.duration))}).observe({entryTypes:['longtask']})}catch{}return 1})()" >/dev/null
T0=$(date +%s%3N)
curl -s $M/eval --data-binary "(async()=>{const T=Date.now();await ($3);return Date.now()-T})()" >/dev/null
sleep $(echo "$W" | awk '{print $1/1000}')
curl -s $M/eval --data-binary "(()=>{const L=window.__ulag;L.s=1;const f=L.f.filter(t=>t>=$T0);const d=f.slice(1).map((t,i)=>t-f[i]);const s=[...d].sort((a,b)=>a-b);return JSON.stringify({name:'$2',frames:d.length,medianMs:+(s[Math.floor(s.length/2)]||0).toFixed(1),maxMs:+Math.max(0,...d).toFixed(1),over25:d.filter(x=>x>25).length,over40:d.filter(x=>x>40).length,worst:[...d].map(Math.round).sort((a,b)=>b-a).slice(0,5),longtasks:L.long.slice(0,6)})})()"
echo
