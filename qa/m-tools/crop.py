"""crop.py in.png out.png x y w h [zoom=4] [half=0]  -- nearest-neighbour zoom crop (pixels, of the source png).
   crop.py half in.png out.png  -- half-size copy for quick review (composited over black, RGB)."""
import sys
from PIL import Image

def flat(im):
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
    # desktopCapturer keeps acrylic alpha; judge on RGB, so drop alpha instead of compositing over white
    r, g, b, a = im.split()
    return Image.merge("RGB", (r, g, b))

a = sys.argv[1:]
if a[0] == "half":
    im = flat(Image.open(a[1]))
    s = float(a[3]) if len(a) > 3 else 0.5
    im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS).save(a[2])
else:
    src, dst, x, y, w, h = a[0], a[1], *map(int, a[2:6])
    z = int(a[6]) if len(a) > 6 else 4
    im = flat(Image.open(src)).crop((x, y, x + w, y + h))
    im.resize((w * z, h * z), Image.NEAREST).save(dst)
    print(dst, im.size)
