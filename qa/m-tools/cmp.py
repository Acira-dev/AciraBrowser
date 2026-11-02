"""cmp.py out.png mode(v|h) scale x y w h before.png after.png [z]  -- same region from two shots, stacked (v) or side by side (h),
labelled BEFORE/AFTER. Alpha dropped (judge RGB)."""
import sys
from PIL import Image, ImageDraw
out, mode, s, x, y, w, h, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), *map(int, sys.argv[4:8]), sys.argv[8], sys.argv[9]
z = int(sys.argv[10]) if len(sys.argv) > 10 else 0
def get(p):
    im = Image.open(p).convert("RGBA"); r, g, bb, al = im.split(); im = Image.merge("RGB", (r, g, bb)).crop((x, y, x + w, y + h))
    if z: return im.resize((w * z, h * z), Image.NEAREST)
    return im.resize((int(w * s), int(h * s)), Image.LANCZOS)
A, B = get(a), get(b)
if mode == "v": o = Image.new("RGB", (A.width, A.height * 2 + 6), (255, 0, 255)); o.paste(A, (0, 0)); o.paste(B, (0, A.height + 6))
else: o = Image.new("RGB", (A.width * 2 + 6, A.height), (255, 0, 255)); o.paste(A, (0, 0)); o.paste(B, (A.width + 6, 0))
d = ImageDraw.Draw(o); d.text((4, 2), "BEFORE 2795aa0", fill=(255, 0, 255)); d.text((4 if mode == "v" else A.width + 10, (A.height + 8) if mode == "v" else 2), "AFTER 090ac9d", fill=(255, 0, 255))
o.save(out); print(out, o.size)
