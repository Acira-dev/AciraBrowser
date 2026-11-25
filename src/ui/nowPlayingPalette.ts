/** The artwork's main colours, for the now-playing card's glow (Beta 14). Read once per picture, from a 40 x 40 look at its
 * visible centre square: every pixel goes to OKLab; k-means (k = 10, farthest-point seeds, so the same picture always gives the
 * same answer and no hue is ever random) groups them by colour, not by shade (lightness counts .3); near-greys are dropped unless
 * the whole picture is grey; the rest are ranked by share x colourfulness, near-twins (hue within 20 degrees) merged, the top four
 * kept and ordered by where they sit in the picture (left to right). A picture with fewer than four colours lends neighbours of its
 * own hues (+14, -14, +28 degrees), so there are always four lights, all from the picture. Each is lifted to one lightness band
 * (OKLCH L .74, so a dark cover still glows) with its hue kept and its chroma x1.6 held between .08 and .18. */
type Lab = [number, number, number];
export const PALETTE_SIZE = 40, PALETTE_LIGHTS = 4;

const linear = (channel: number) => { const c = channel / 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
/** sRGB (0..255) to OKLab. */
export function oklab(r: number, g: number, b: number): Lab {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(.4122214708 * R + .5363325363 * G + .0514459929 * B), m = Math.cbrt(.2119034982 * R + .6806995451 * G + .1073969566 * B), s = Math.cbrt(.0883024619 * R + .2817188376 * G + .6299787005 * B);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}

interface Group { L: number; a: number; b: number; C: number; h: number; share: number; x: number }
const hueGap = (p: number, q: number) => { const d = Math.abs(p - q) % 360; return Math.min(d, 360 - d); };

/** The lights' colours (CSS `oklch(...)` strings, left to right) from the RGBA pixels of a size x size look at the picture, or null when there is nothing to read. */
export function paletteFromPixels(pixels: ArrayLike<number>, size = PALETTE_SIZE): string[] | null {
  const pts: Lab[] = [], xs: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (!(pixels[i * 4 + 3] >= 128)) continue;   // see-through, or no pixel at all
    pts.push(oklab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]));
    xs.push((i % size + .5) / size);
  }
  if (pts.length < 8) return null;
  const F = pts.map(p => [p[0] * .3, p[1], p[2]] as Lab);
  const d2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const K = 10, centres: Lab[] = [F.reduce((acc, p) => [acc[0] + p[0] / F.length, acc[1] + p[1] / F.length, acc[2] + p[2] / F.length], [0, 0, 0] as Lab)];
  while (centres.length < K) {
    let far = 0, best = -1;
    for (let i = 0; i < F.length; i++) { let near = Infinity; for (const c of centres) near = Math.min(near, d2(F[i], c)); if (near > best) { best = near; far = i; } }
    centres.push([...F[far]] as Lab);
  }
  const owner = new Int32Array(F.length);
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < F.length; i++) { let near = Infinity, pick = 0; for (let j = 0; j < K; j++) { const v = d2(F[i], centres[j]); if (v < near) { near = v; pick = j; } } owner[i] = pick; }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < F.length; i++) { const s = sums[owner[i]]; s[0] += F[i][0]; s[1] += F[i][1]; s[2] += F[i][2]; s[3]++; }
    sums.forEach((s, j) => { if (s[3]) centres[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const groups: Group[] = centres.map((_, j) => {
    let n = 0, sx = 0, L = 0, A = 0, B = 0;
    for (let i = 0; i < pts.length; i++) if (owner[i] === j) { n++; sx += xs[i]; L += pts[i][0]; A += pts[i][1]; B += pts[i][2]; }
    const a = A / (n || 1), b = B / (n || 1);
    return { L: L / (n || 1), a, b, share: n / pts.length, x: n ? sx / n : .5, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
  }).filter(g => g.share >= .015);
  if (!groups.length) return null;
  const vivid = groups.filter(g => g.C >= .035), grey = vivid.length === 0;
  const pool = (grey ? groups : vivid).sort((p, q) => q.share * (.2 + q.C * 8) - p.share * (.2 + p.C * 8));
  const picked: Group[] = [];
  for (const g of pool) {
    if (picked.length >= PALETTE_LIGHTS) break;
    if (picked.every(p => Math.hypot(p.a - g.a, p.b - g.b) >= .04 && (grey || hueGap(p.h, g.h) >= 20))) picked.push(g);
  }
  const base = [...picked], shifts = [14, -14, 28];
  for (let k = 0; picked.length < PALETTE_LIGHTS && base.length; k++) {
    const from = base[k % base.length], shift = shifts[k % shifts.length];
    picked.push({ ...from, h: (from.h + shift + 360) % 360, x: Math.min(.95, Math.max(.05, from.x + (shift > 0 ? .3 : -.3))), share: from.share / 2 });
  }
  picked.sort((p, q) => p.x - q.x);
  return picked.map(g => `oklch(.74 ${(grey ? Math.min(.03, g.C) : Math.min(.18, Math.max(.08, g.C * 1.6))).toFixed(3)} ${g.h.toFixed(1)})`);
}

/** Four lights from ONE colour (the site's own, for a card whose page offers no picture): its hue and the hues beside it (-18, 0, +16, +34 degrees), on the
 * same lightness band and chroma rule as a picture's colours. A white, grey or black site colour says nothing, so it gives null. */
export function paletteFromColor(hex: string | null | undefined): string[] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ''); if (!m) return null;
  const n = parseInt(m[1], 16), [, a, b] = oklab((n >> 16) & 255, (n >> 8) & 255, n & 255), C = Math.hypot(a, b);
  if (C < .035) return null;
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360, chroma = Math.min(.18, Math.max(.08, C * 1.6)).toFixed(3);
  return [-18, 0, 16, 34].map(d => `oklch(.74 ${chroma} ${((h + d + 360) % 360).toFixed(1)})`);
}

const cache = new Map<string, Promise<string[] | null>>(), CACHE_LIMIT = 48;
/** The colours of the picture at `src` (a data: URL from main, or the site's icon), once per picture: read at idle, remembered, null when it cannot be read. */
export function samplePalette(src: string): Promise<string[] | null> {
  const hit = cache.get(src);
  if (hit) return hit;
  const read = new Promise<string[] | null>(resolve => {
    const image = new Image(); image.decoding = 'async';
    image.onload = () => {
      const work = () => {
        try {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = PALETTE_SIZE;
          const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) { resolve(null); return; }
          context.imageSmoothingQuality = 'high';
          const side = Math.min(image.naturalWidth, image.naturalHeight);
          if (!(side > 0)) { resolve(null); return; }
          context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, PALETTE_SIZE, PALETTE_SIZE);
          resolve(paletteFromPixels(context.getImageData(0, 0, PALETTE_SIZE, PALETTE_SIZE).data));
        } catch { resolve(null); }
      };
      const idle = (window as unknown as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(work, { timeout: 400 }); else setTimeout(work, 0);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
  cache.set(src, read);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return read;
}
