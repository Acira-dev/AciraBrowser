# Stream K: WCAG contrast of setup text on real pixels, from qa/k-setup-sheet.mjs output.  python qa/k-sheet-contrast.py qa/artifacts/k-sheet-<tag>
import json, re, sys
from PIL import Image
d = sys.argv[1]; rep = json.load(open(d + '/report.json', encoding='utf-8'))
def lum(c):
    c = [x / 255 for x in c]; c = [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c]; return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
worst = []
for st in rep['steps']:
    im = Image.open(d + '/' + st['shot'] + '.png').convert('RGB'); s = im.width / (1440 if rep['zoom'] == 1 else 1350) * rep['zoom']
    for t in st.get('texts', []):
        m = re.match(r'rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)', t['color'])
        if not m: continue
        r, g, b = [float(m.group(i)) for i in (1, 2, 3)]; a = float(m.group(4) or 1); x, y, w, h = t['box']
        pts = [im.getpixel((px, py)) for px in range(int((x - 6) * s), int((x + w + 6) * s), 3) for py in (int((y - 4) * s), int((y + h + 4) * s)) if 0 <= px < im.width and 0 <= py < im.height]
        if not pts: continue
        bg = [sum(p[i] for p in pts) / len(pts) for i in range(3)]; fg = [c * a + bg[i] * (1 - a) for i, c in enumerate((r, g, b))]
        L1, L2 = lum(fg), lum(bg); ratio = (max(L1, L2) + .05) / (min(L1, L2) + .05)
        size = float(t['size'][:-2]); need = 3 if size >= 18 or (size >= 14 and int(t['weight']) >= 600) else 4.5
        worst.append((round(ratio, 2), need, st['title'][:22], t['text'], t['size']))
fails = [w for w in worst if w[0] < w[1]]
for w in sorted(worst)[:8]: print(w)
print('texts', len(worst), 'below threshold', len(fails))
