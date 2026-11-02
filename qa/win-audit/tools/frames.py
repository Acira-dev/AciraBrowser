#!/usr/bin/env python3
"""frames.py <mov> [--scale 2] : extract frames, print per-frame table (t, diff, magenta bbox) and write sheets."""
import sys, os, subprocess, glob, json
import numpy as np
from PIL import Image
mov = sys.argv[1]
base = mov[:-4]
os.makedirs(base, exist_ok=True)
for f in glob.glob(base + '/*.png'): os.remove(f)
subprocess.run(['ffmpeg','-v','error','-i',mov,'-vsync','0',base+'/%04d.png'],check=True)
pts=[float(x.strip(',')) for x in subprocess.run(['ffprobe','-v','error','-select_streams','v','-show_entries','frame=pts_time','-of','csv=p=0',mov],capture_output=True,text=True).stdout.split()]
fs=sorted(glob.glob(base+'/*.png'))
rows=[]; prev=None
for i,f in enumerate(fs):
    im=Image.open(f).convert('RGB'); a=np.asarray(im).astype(np.int16)
    d=0 if prev is None else float(np.abs(a-prev).mean())
    mag=(a[:,:,0]>200)&(a[:,:,1]<60)&(a[:,:,2]>200)
    ys,xs=np.where(mag)
    bb=(int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())) if len(xs) else None
    rows.append(dict(i=i,t=round(pts[i],3),diff=round(d,3),bbox=bb,area=int(mag.sum())))
    prev=a
json.dump(rows,open(base+'.json','w'))
if '--quiet' not in sys.argv:
    last=None
    for r in rows:
        key=(r['bbox'],r['area'])
        if r['diff']>0.02 or key!=last: print(r['i'],r['t'],r['diff'],r['bbox'],r['area'])
        last=key
