#!/usr/bin/env python3
"""check.py <base.json> : monotonicity of the magenta page bbox across the frames of one transition."""
import json,sys
rows=json.load(open(sys.argv[1]))
rows=[r for r in rows if r['bbox']]
out=[]
for k,name in enumerate(['left','top','right','bottom']):
    seq=[]
    for r in rows[3:]:
        v=r['bbox'][k]
        if not seq or seq[-1][1]!=v: seq.append((r['i'],v))
    vals=[v for _,v in seq]
    if len(vals)<3: continue
    ups=sum(1 for a,b in zip(vals,vals[1:]) if b>a); downs=sum(1 for a,b in zip(vals,vals[1:]) if b<a)
    if ups and downs: out.append(f'{name}: not monotone {seq[:14]}')
print('; '.join(out) if out else 'monotone')
