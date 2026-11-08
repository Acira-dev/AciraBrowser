# usage: summary.py file.json ...   one line per run: totals and the groups (Acira main, GPU, utilities, UI renderer, overlay renderer, site renderers)
import json,sys
def group(r):
    h=r['hosts'][0]['url'] if r['hosts'] else ''
    if r['type']=='Browser': return 'main'
    if r['type']=='GPU': return 'gpu'
    if r['type']=='Utility': return 'utility'
    if 'view=overlay' in h: return 'overlay'
    if h.startswith('acira-browser-ui://'): return 'ui'
    return 'sites'
print(f"{'run':34} {'total ws':>8} {'total foot':>10} | {'main':>9} {'gpu':>9} {'utility':>9} {'ui':>9} {'overlay':>9} {'sites(n)':>13}   (ws/foot MB)")
for f in sys.argv[1:]:
    d=json.load(open(f)); g={}
    for r in d['rows']:
        k=group(r); a=g.setdefault(k,[0,0,0]); a[0]+=r['ws']; a[1]+=r['footprint']; a[2]+=1
    cell=lambda k:(f"{g[k][0]:.0f}/{g[k][1]:.0f}" if k in g else '-')
    s=g.get('sites',[0,0,0])
    print(f"{f.split('/')[-1][:-5]:34} {d['totals']['ws']:8} {d['totals']['footprint']:10} | {cell('main'):>9} {cell('gpu'):>9} {cell('utility'):>9} {cell('ui'):>9} {cell('overlay'):>9} {s[0]:5.0f}/{s[1]:.0f}({s[2]})")
