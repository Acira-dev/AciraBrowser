"""Contrast of actual foreground glyphs against their shadow backdrop, using a color-transparent reference."""
import json,sys,statistics
from pathlib import Path
from PIL import Image
p=Path(sys.argv[1]);r=json.loads((p/'report.json').read_text('utf-8'))
def lum(p):
    c=[v/255 for v in p]
    return sum(k*(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4) for k,v in zip([.2126,.7152,.0722],c))
if 'halos' in r:
    results=[]
    for row in r['halos']:
        a=Image.open(p/row['shot']).convert('RGB');mask=Image.open(p/row['mask']).convert('RGB');scale=a.width/row['width'];radius=round(2*scale)
        for text in row['texts']:
            x,y,w,h=text['box'];ratios=[]
            for xx in range(int(x*scale),int((x+w)*scale)):
                for yy in range(int(y*scale),int((y+h)*scale)):
                    if min(mask.getpixel((xx,yy)))<235:continue
                    local=min(lum(a.getpixel((xx+dx,yy+dy))) for dx in range(-radius,radius+1) for dy in range(-radius,radius+1))
                    ratios.append((lum(a.getpixel((xx,yy)))+.05)/(local+.05))
            results.append({'zoom':row['zoom'],'selector':text['selector'],'samples':len(ratios),'minimum':min(ratios) if ratios else None,'median':statistics.median(ratios) if ratios else None,'below45':sum(v<4.5 for v in ratios)})
    result={'method':'Actual high-coverage glyph positions are identified independently using white text on a black mask with the same geometry and no shadow. Compare the actual composited foreground pixels against their nearest surrounding local halo within two CSS pixels; bare beam outside the text box is not the text backdrop.','measurements':results}
    (p/'halo-contrast.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result,indent=2));sys.exit(0)
a=Image.open(p/'skip-foreground.png').convert('RGB');b=Image.open(p/'skip-shadow-background.png').convert('RGB')
s=a.width/r['skip']['width'];x,y,w,h=r['skip']['box'];fg=[237,237,239]
ratios=[];coords=[]
for xx in range(int(x*s),int((x+w)*s)):
    for yy in range(int(y*s),int((y+h)*s)):
        first=a.getpixel((xx,yy));bg=b.getpixel((xx,yy))
        # High-coverage foreground pixels, excluding antialiasing edges and unchanged beam pixels.
        if max(abs(first[i]-fg[i]) for i in range(3))<18 and sum(abs(first[i]-bg[i]) for i in range(3))>100:
            ratios.append((lum(fg)+.05)/(lum(bg)+.05));coords.append([xx,yy])
result={'method':'Stationary scene t=6, actual Skip glyph positions; second image sets only text color transparent, retaining existing opaque local shadow. High-coverage glyph samples exclude antialiasing edges.','samples':len(ratios),'minimum':min(ratios) if ratios else None,'median':statistics.median(ratios) if ratios else None,'below45':sum(v<4.5 for v in ratios),'dimensions':[a.width,a.height]}
(p/'skip-contrast.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result,indent=2))
