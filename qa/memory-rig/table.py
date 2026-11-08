import json,sys
d=json.load(sys.stdin)
print(f"{'pid':>6} {'type':8} {'name':22} {'ws MB':>7} {'foot MB':>8} {'rss':>7}  hosts")
for r in sorted(d['rows'],key=lambda r:-r['footprint']):
    h='; '.join(f"{x['type']}:{x['url'].replace('https://','')[:38]}" for x in r['hosts'])[:110]
    print(f"{r['pid']:>6} {r['type'][:8]:8} {r['name'][:22]:22} {r['ws']:7.1f} {r['footprint']:8.1f} {r['rss']:7.1f}  {h}")
print('TOTAL ws',d['totals']['ws'],'footprint',d['totals']['footprint'],'rss',d['totals']['rss'],'| main heapUsed %.1f ext %.1f ab %.1f'%(d['main']['heapUsed'],d['main']['external'],d['main']['arrayBuffers']), d.get('foot_error') or '', d.get('errors') or '')
