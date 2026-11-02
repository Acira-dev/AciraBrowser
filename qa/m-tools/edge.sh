#!/bin/sh
# edge.sh PORT page(ui|overlay) [cap] : run the edge scanner, print findings compactly (rest + hover), P1 candidates first
curl -s -X POST "http://127.0.0.1:$1/edgescan?page=$2&hover=1&cap=${3:-60}" | python -c "
import sys,json
d=json.load(sys.stdin); print('candidates',d['candidates'],'| rest',len(d['rest']),'| hover',len(d['hover']))
for k in ('rest','hover'):
  for f in d[k][:40]: print(k.upper(),'|',f['box'][:80],'|',f['what'][:34],'|',f['problem'][:80])"
