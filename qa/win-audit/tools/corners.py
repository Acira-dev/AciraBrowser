import sys, numpy as np
from PIL import Image
im=np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(int)
mag=(im[:,:,0]>200)&(im[:,:,1]<90)&(im[:,:,2]>200)
ys,xs=np.where(mag)
if not len(xs): print('no magenta'); sys.exit()
x0,y0,x1,y1=xs.min(),ys.min(),xs.max(),ys.max()
H,W=mag.shape
def notch(cx,cy,sx,sy,n=40):
    c=0
    for dy in range(n):
        for dx in range(n):
            x=cx+sx*dx; y=cy+sy*dy
            if 0<=x<W and 0<=y<H and not mag[y,x]: c+=1
    return c
print([int(x0),int(y0),int(x1),int(y1)],'size',int(x1-x0+1),int(y1-y0+1),'notch tl,tr,bl,br',notch(x0,y0,1,1),notch(x1,y0,-1,1),notch(x0,y1,1,-1),notch(x1,y1,-1,-1))
