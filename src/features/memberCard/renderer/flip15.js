// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// r15 test only: "flipped colour" samples of Trusted (T3) and Insider (A). The approved cards are untouched: the
// flip is a pixel transform of their finished plates, so the layout is exactly the same.
//   paper  -> the card's metal (foil on, so it shimmers like the band / number did)
//   foil   -> white paper (enamel-white elements, still raised by the original relief)
//   ink    -> white (fine white engraving and type), so contrast holds on the dark metal
// take b keeps a white lower name block (the original pixels inside a rounded rect), so the text sits on paper.
import { W, H } from './sys12.js';
const PAPER = [255, 255, 255]; // r17b: pure white
function cv(src) { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; }
function inBlock(b, x, y) { if (!b) return false; const [x0, y0, x1, y1, r] = b; if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; }
// base plate: paper/ink/foil classification per pixel
function flipBase(pl, metal, block, ink = [18, 19, 23]) {
  const col = cv(pl.col), map = cv(pl.map), cx = col.getContext('2d'), mx = map.getContext('2d');
  const cd = cx.getImageData(0, 0, W, H), md = mx.getImageData(0, 0, W, H), a = cd.data, m = md.data;
  const il = 0.3 * ink[0] + 0.59 * ink[1] + 0.11 * ink[2], pl0 = 0.3 * PAPER[0] + 0.59 * PAPER[1] + 0.11 * PAPER[2];
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
    if (a[i + 3] < 4) continue; if (inBlock(block, x, y)) continue;
    const f = m[i] / 255; const L = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];
    const t = f > 0.03 ? 0 : Math.min(1, Math.max(0, (L - il) / (pl0 - il))); // share of PAPER in a non-foil pixel
    const metalShare = (1 - f) * t; // paper part turns to metal; ink part and foil part turn white
    for (let j = 0; j < 3; j++) a[i + j] = metal[j] * metalShare + PAPER[j] * (1 - metalShare);
    m[i] = Math.round(255 * metalShare); m[i + 1] = 0; // procedural grating (no stamped angles on the new face)
  }
  cx.putImageData(cd, 0, 0); mx.putImageData(md, 0, 0); return { ...pl, col, map };
}
// raised metal plate (Insider bezel): white enamel, dark keylines kept as fine keylines
function flipRaised(pl, block) {
  const col = cv(pl.col), map = cv(pl.map), cx = col.getContext('2d'), mx = map.getContext('2d');
  const cd = cx.getImageData(0, 0, W, H), md = mx.getImageData(0, 0, W, H), a = cd.data, m = md.data;
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) { if (a[i + 3] < 4 || inBlock(block, x, y)) continue;
    const L = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]; const k = Math.min(1, Math.max(0, (L - 70) / 90));
    for (let j = 0; j < 3; j++) a[i + j] = 30 * (1 - k) + PAPER[j] * k; m[i] = 0; }
  cx.putImageData(cd, 0, 0); mx.putImageData(md, 0, 0); return { ...pl, col, map, kind: 0, gloss: 0.12 };
}
export function flipTrusted(spec, take) {
  const block = take === 'b' ? [650, 1925, 1225, 2350, 36] : null;
  const p = flipBase(spec.plates[0], [29, 50, 112], block);
  return { ...spec, plates: [{ ...p, bump: 6, ringK: 0.45 }], edge: '#1d2f66' };
}
export function flipInsider(spec, take) {
  const block = take === 'b' ? [60, 1975, 1540, 2340, 40] : null;
  const p = flipBase(spec.plates[0], [205, 208, 213], block);
  const bz = flipRaised(spec.plates[1], block);
  // the face: platinum with a restrained holographic sheen (holo 0.85 -> 0.32), toned a step darker so white reads
  return { ...spec, plates: [{ ...p, holo: 0.32, sat: 0.55, tint: '#a9adb4' }, bz], edge: '#b9bdc4' };
}
