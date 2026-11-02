#!/usr/bin/env python3
"""sheet.py <base> i0 i1 [step] [x0 y0 x1 y1] [cols] -> <base>-sheet.png, frames numbered by index; crop in native px"""
import sys, glob
from PIL import Image, ImageDraw
base=sys.argv[1]; i0=int(sys.argv[2]); i1=int(sys.argv[3]); step=int(sys.argv[4]) if len(sys.argv)>4 else 1
crop=tuple(int(x) for x in sys.argv[5:9]) if len(sys.argv)>=9 else None
cols=int(sys.argv[9]) if len(sys.argv)>9 else 4
fs=sorted(glob.glob(base+'/*.png'))
idx=list(range(i0,i1+1,step))
ims=[]
for i in idx:
    im=Image.open(fs[i]).convert('RGB')
    if crop: im=im.crop(crop)
    ims.append((i,im))
w,h=ims[0][1].size
sc=min(1.0, 1900/(cols*w))
tw,th=int(w*sc),int(h*sc)
rows=(len(ims)+cols-1)//cols
sheet=Image.new('RGB',(cols*tw,rows*th),'white')
d=ImageDraw.Draw(sheet)
for k,(i,im) in enumerate(ims):
    im=im.resize((tw,th)); x,y=(k%cols)*tw,(k//cols)*th
    sheet.paste(im,(x,y)); d.rectangle([x,y,x+34,y+12],fill='black'); d.text((x+2,y+1),str(i),fill='white')
sheet.save(base+'-sheet.png'); print(sheet.size)
