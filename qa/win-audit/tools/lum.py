#!/usr/bin/env python3
"""lum.py <mov> : extract frames, print mean luminance of the chrome strip (top rows) and sidebar/page-free regions per frame."""
import sys, os, subprocess, glob
import numpy as np
from PIL import Image
mov=sys.argv[1]; base=mov[:-4]; os.makedirs(base,exist_ok=True)
for f in glob.glob(base+'/*.png'): os.remove(f)
subprocess.run(['ffmpeg','-v','error','-i',mov,'-vsync','0','-vf','scale=663:-1',base+'/%04d.png'],check=True)
pts=[float(x.strip(',')) for x in subprocess.run(['ffprobe','-v','error','-select_streams','v','-show_entries','frame=pts_time','-of','csv=p=0',mov],capture_output=True,text=True).stdout.split()]
fs=sorted(glob.glob(base+'/*.png'))
prev=None; rows=[]
for i,f in enumerate(fs):
    a=np.asarray(Image.open(f).convert('RGB')).astype(float)
    h,w,_=a.shape
    # window content is inset by the shadow (~12px at this scale); sample a thin strip across the top chrome and a strip at the window bottom-left edge
    top=a[24:50, 40:w-40].mean(axis=(0,1)).mean()
    dif=0 if prev is None else np.abs(a-prev).mean()
    rows.append((i,round(pts[i],3),round(top,1),round(dif,2)))
    prev=a
last=None
for r in rows:
    if r[3]>0.15 or last is None or abs(r[2]-last)>0.5: print(*r)
    last=r[2]
