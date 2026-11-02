# Stream K: WCAG contrast of first-run text against the real pixels behind it.  python qa/k-contrast.py qa/artifacts/k-walk-<tag>  (after qa/k-first-run-walk.mjs)
import json,sys,re
from PIL import Image
d=sys.argv[1]; rep=json.load(open(d+'/report.json',encoding='utf-8'))
def lum(c):
    c=[x/255 for x in c]; c=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c]; return .2126*c[0]+.7152*c[1]+.0722*c[2]
names={'welcome':'00-welcome'}
dpr=rep['steps'][0].get('dpr',1)
zoom=rep['zoom']
worst=[]
for st in rep['steps']:
    key=names.get(st['step']) if st['step']=='welcome' else '%02d-step'%st['step']
    try: im=Image.open(d+'/'+key+'.png').convert('RGB')
    except: continue
    k=im.width/ (1440 if zoom==1 else 1350) * (1 if zoom==1 else 1)  # image px per window px
    for t in st['texts']:
        m=re.match(r'rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)',t['color'])
        if not m: continue
        r,g,b=[float(m.group(i)) for i in (1,2,3)]; a=float(m.group(4) or 1)
        x,y,w,h=t['box']; s=k*zoom
        # background: ring just outside the text box
        pts=[]
        for px in range(int((x-6)*s),int((x+w+6)*s),3):
            for py in (int((y-4)*s),int((y+h+4)*s)):
                if 0<=px<im.width and 0<=py<im.height: pts.append(im.getpixel((px,py)))
        if not pts: continue
        bg=[sum(p[i] for p in pts)/len(pts) for i in range(3)]
        fg=[r*a+bg[i]*(1-a) for i,r in enumerate((r,g,b))]
        L1,L2=lum(fg),lum(bg); ratio=(max(L1,L2)+.05)/(min(L1,L2)+.05)
        size=float(t['size'][:-2]); big=size>=18 or (size>=14 and int(t['weight'])>=600)
        need=3 if big else 4.5
        if ratio<need: worst.append((round(ratio,2),need,st['step'],t['text'],t['size'],t['color']))
for w in sorted(worst)[:25]: print(w)
print('checked steps',len(rep['steps']),'below threshold',len(worst))
