import json,sys
rows=json.load(open(sys.argv[1]))
thr=float(sys.argv[2]) if len(sys.argv)>2 else 0.02
last=None
print('frames',len(rows),'duration',rows[-1]['t'])
for r in rows:
    key=(r['bbox'],r['area'])
    if r['diff']>thr or key!=last: print(r['i'],r['t'],r['diff'],r['bbox'],r['area'])
    last=key
