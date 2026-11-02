"""Analyze native K evidence and assemble compact, unaltered screenshot contact sheets."""
import json, math, re, statistics, sys
from pathlib import Path
from PIL import Image, ImageDraw
folder=Path(sys.argv[1]); report=json.loads((folder/'report.json').read_text('utf-8'))
summary={'status':report.get('status'),'errors':report.get('errors'),'cases':[]}
def lum(c):
    c=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c]
    return .2126*c[0]+.7152*c[1]+.0722*c[2]
def rgb(value):
    n=[float(x) for x in re.findall(r'[\d.]+',value)]
    if value.startswith('color(srgb'): return n[:3],n[3] if len(n)>3 else 1
    return [x/255 for x in n[:3]],n[3] if len(n)>3 else 1
for case in report['cases']:
    if '--only100' in sys.argv and case['zoom']!=1:continue
    entry={'name':case['name'],'views':len(case['views']),'scans':[],'contrastBelow45':[]}
    for view in case['views']:
        for field in ['scan','connection','providers','proxy','usage']:
            if field in view:
                scan=view[field]; entry['scans'].append({'view':scan['name'],'edge':len(scan['edge']),'focus':len(scan['focus']),'hover':len(scan.get('hover',[])),'clip':scan['clip']})
        im=Image.open(folder/(view['shot']+'.png')).convert('RGB');scale=im.width/view['viewport']['width']
        for text in view['texts']:
            color,alpha=rgb(text['color']);x,y,w,h=text['box'];points=[]
            for px in range(int((x-3)*scale),int((x+w+3)*scale),max(1,int(3*scale))):
                for py in [int((y-3)*scale),int((y+h+3)*scale)]:
                    if 0<=px<im.width and 0<=py<im.height:points.append(im.getpixel((px,py)))
            if not points or len(color)!=3:continue
            bg=[statistics.median(p[i] for p in points)/255 for i in range(3)]
            fg=[v*alpha+bg[i]*(1-alpha) for i,v in enumerate(color)];a,b=lum(fg),lum(bg);ratio=(max(a,b)+.05)/(min(a,b)+.05)
            if ratio<4.5:entry['contrastBelow45'].append({'shot':view['shot'],'text':text['text'],'ratio':round(ratio,2),'size':text['size'],'color':text['color']})
    if 'finale' in case:
        f=case['finale'];entry['handoff']={'setupRemovedMs':case['setupRemovedMs'],'input':case['immediateInput'],'ghostGoneMs':f['goneMs'],'ghostRemaining':f['ghost'],'deletedPrograms':f['deletedPrograms'],'drawsStopped':f['draws']==case['drawsLater'],'complete':case['status'].get('progress',{}).get('complete')}
        frames=f.get('frames',[]);unique=sorted(set(round(f.get('t',0),4) for f in frames));dt=[(b-a)*1000 for a,b in zip(unique,unique[1:]) if 0<b-a<1]
        if dt:entry['handoff']['frameIntervalsMs']={'median':round(statistics.median(dt),2),'p95':round(sorted(dt)[int((len(dt)-1)*.95)],2),'max':round(max(dt),2)}
    summary['cases'].append(entry)
def sheet(paths,name,cols=3,width=480):
    images=[(p,Image.open(folder/p).convert('RGB')) for p in paths if (folder/p).exists()]
    if not images:return
    height=round(images[0][1].height*width/images[0][1].width)+28
    canvas=Image.new('RGB',(width*cols,height*math.ceil(len(images)/cols)),(28,28,30));draw=ImageDraw.Draw(canvas)
    for i,(p,im) in enumerate(images):
        x=(i%cols)*width;y=(i//cols)*height;im.thumbnail((width,height-28));canvas.paste(im,(x,y+28));draw.text((x+8,y+6),p,fill='white')
    canvas.save(folder/name)
for tone in ['light','dark']:
    for zoom in [100,150]:
        cases=[c for c in report['cases'] if c['tone']==tone and c['zoom']*100==zoom]
        paths=[]
        for step in [0,1,3,5]:
            paths.extend(c['views'][step]['shot']+'.png' for c in cases if len(c['views'])>step)
        sheet(paths,f'comparison-{tone}-{zoom}.jpg',2,640)
for case in report['cases']:
    if '--only100' in sys.argv and case['zoom']!=1:continue
    if case['name'].startswith('after'):
        sheet([case['name']+'-finale-'+str(x)+'.png' for x in [0,180,400,700,1020,1250]],case['name']+'-finale-strip.jpg')
        for view in case['views']:
            if 'poseTrace' in view:sheet([view['shot']+'-motion-'+str(x)+'.png' for x in [0,160,400,800,1050]],case['name']+'-pose-strip.jpg')
summary['reduced']=report.get('reduced')
if (folder/'reduced-still-a.png').exists() and (folder/'reduced-still-b.png').exists():
    summary['reducedPixelsIdentical']=(folder/'reduced-still-a.png').read_bytes()==(folder/'reduced-still-b.png').read_bytes()
(folder/'summary.json').write_text(json.dumps(summary,indent=2),'utf-8')
print(json.dumps(summary,indent=2))
