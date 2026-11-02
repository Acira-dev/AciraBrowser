"""sheet.py out.png scale cols in1.png in2.png ...  -- contact sheet (RGB, alpha dropped), 4px gaps."""
import sys
from PIL import Image
out, s, cols, files = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
ims = []
for f in files:
    im = Image.open(f).convert("RGBA")
    r, g, b, a = im.split()
    im = Image.merge("RGB", (r, g, b))
    ims.append(im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS))
w, h = max(i.width for i in ims), max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols - 1) * 4, rows * h + (rows - 1) * 4), (255, 0, 255))
for n, im in enumerate(ims):
    sheet.paste(im, ((n % cols) * (w + 4), (n // cols) * (h + 4)))
sheet.save(out)
print(out, sheet.size)
