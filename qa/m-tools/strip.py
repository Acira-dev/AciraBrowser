"""strip.py out.png scale x y w h frame1.png frame2.png ... -- crop the same region from each frame, lay out in a row
with the frame's filename tail as a label. Transparent pixels shown over a checker so alpha reveals itself."""
import sys, os
from PIL import Image, ImageDraw
out, s, x, y, w, h = sys.argv[1], float(sys.argv[2]), *map(int, sys.argv[3:7])
files = sys.argv[7:]
tiles = []
for f in files:
    im = Image.open(f).convert("RGBA").crop((x, y, x + w, y + h))
    bg = Image.new("RGBA", im.size, (90, 90, 90, 255))
    d = ImageDraw.Draw(bg)
    for yy in range(0, h, 16):
        for xx in range(0, w, 16):
            if (xx // 16 + yy // 16) % 2: d.rectangle((xx, yy, xx + 15, yy + 15), fill=(120, 120, 120, 255))
    bg.alpha_composite(im)
    t = bg.convert("RGB").resize((int(w * s), int(h * s)), Image.LANCZOS)
    ImageDraw.Draw(t).text((3, 3), os.path.basename(f).rsplit("-", 1)[-1].replace(".png", ""), fill=(255, 0, 255))
    tiles.append(t)
W = sum(t.width for t in tiles) + 3 * (len(tiles) - 1)
sheet = Image.new("RGB", (W, tiles[0].height), (255, 0, 255))
xx = 0
for t in tiles:
    sheet.paste(t, (xx, 0)); xx += t.width + 3
sheet.save(out); print(out, sheet.size)
