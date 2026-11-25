// @ts-nocheck
// Beta 14 member cards: the Founding Contributor card, "the point of contact" (the Creation of Adam hands). Ported from the reference design's pack
// (the reference sample, card d5d, approved 16 Nov 2026, commit 143320e0f). His drawing values are kept as they were; what changed is only
// what the app needs: no test harness, the member's own number and month in place of the sample's, the layers and foil patches from the app bundle (never the network),
// and no code for studies that do not ship (the other four hand layouts, the technical / blind-emboss / spark variants).
// Base = the instrument card of r19: white paper, platinum bezel plate, holo guilloche, foil number (fit to x 1500), lockup, identity, FOUNDING / CONTRIBUTOR, the compass
// token. The hands art is made offline (the pack's src/hands_tools) as card-size layers; only the four layers d5d draws are shipped (assets/hands/DB_*.png, byte for byte).
// The hands' source is the public-domain fresco (see THIRD_PARTY_NOTICES.md); no pixel of the scan is printed, the engraving is our own art.
import { W, H, INK, LW, T, identity, lockup, heroNumber, ln, cline, CENTRE_DASH, rgba, REG, CARD } from './sys12.js';
import { TIERS, mk } from './art10.js';
import { H13 } from './cards12.js';
import { foilImages } from './cards16.js';
import { SEALS } from './assets.js';
import { FOUNDING_LAYOUT as LAYOUT } from './foundingLayout.js';
import halo from '../assets/hands/DB_halo.png';
import halo6 from '../assets/hands/DB_halo6.png';
import engrave from '../assets/hands/DB_engrave.png';
import emboss from '../assets/hands/DB_emboss.png';
const { relief, finalize, page, knockout, compose, seal, foilNumber, FOIL, FOILG, METAL, KIND, inkC, gray, g2 } = H13;
const PAPER = '#ffffff';
const FOUNDING_SEAL = SEALS.founding; // the colour holo compass token, lettered FOUNDING (the live coin in coin.js replaces it with the member's own number)
const HANDS = { DB: { halo, halo6, engrave, emboss } };
const IMG = {};
const ld = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('card art ' + src)); i.src = src; });
export async function preloadHands(names = [LAYOUT.hands]) {
  for (const n of names) for (const [k, src] of Object.entries(HANDS[n])) { const key = `${n}_${k}`; if (!(key in IMG)) IMG[key] = await ld(src); }
}

// grey layer -> canvas of colour rgb with alpha = grey * a
function alphaCanvas(img, rgb, a = 1) {
  const c = mk(), x = g2(c); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, W, H), A = d.data;
  for (let i = 0; i < A.length; i += 4) { A[i + 3] = A[i] * a; A[i] = rgb[0]; A[i + 1] = rgb[1]; A[i + 2] = rgb[2]; }
  x.putImageData(d, 0, 0); return c;
}
function greyData(img) { const c = mk(), x = g2(c); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H).data; }
const hitAt = (D, x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return 0; return D[(y * W + x) * 4]; };
function bezelPlate() { const B = H13.plate(null); B.m.clearRect(0, 0, W, H); B.m.fillStyle = 'rgb(0,0,128)'; return B; }
function foilEdge(P, metal, w = 28) {
  for (const [c, col] of [[P.c, metal], [P.m, FOIL]]) { c.save(); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.roundRect(0, 0, W, H, 94); c.stroke(); c.restore(); }
  relief(P, 150, 2, (h) => { h.lineWidth = w; h.beginPath(); h.roundRect(0, 0, W, H, 94); h.stroke(); });
}
function knockNumber(plates, str, o) {
  for (const p of plates) for (const c of [p.c, p.m]) { c.save(); c.globalCompositeOperation = 'destination-out'; heroNumber(c, str, { ...o, fill: '#000', stroke: 50, strokeCol: '#000' }); REG.pop(); c.restore(); }
  for (const p of plates) { p.m.save(); p.m.globalCompositeOperation = 'destination-over'; p.m.fillStyle = 'rgb(0,0,128)'; p.m.fillRect(0, 0, W, H); p.m.restore();
    p.h.save(); p.h.fillStyle = gray(128); heroNumber(p.h, str, { ...o, fill: gray(128), stroke: 50, strokeCol: gray(128) }); REG.pop(); p.h.restore(); }
}
// knock a shape (alpha canvas `ko`) out of the plates: colour + foil cleared, map neutral, height flat
function knockShape(plates, ko) {
  for (const p of plates) {
    for (const c of [p.c, p.m]) { c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(ko, 0, 0); c.restore(); }
    p.m.save(); p.m.globalCompositeOperation = 'destination-over'; p.m.fillStyle = 'rgb(0,0,128)'; p.m.fillRect(0, 0, W, H); p.m.restore();
    const g = mk(), gx = g2(g); gx.fillStyle = gray(128); gx.fillRect(0, 0, W, H); gx.globalCompositeOperation = 'destination-in'; gx.drawImage(ko, 0, 0);
    p.h.drawImage(g, 0, 0);
  }
}
const disc = (x, y, r) => { const c = mk(), g = g2(c); g.fillStyle = '#000'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); return c; };

// the instrument (dialRich of cards12.js), with: indices and bezel figures skipped where the hands' halo or the
// token would cut them, an optional pointer, and the crosshair drawn by the caller (so it can thread the gap)
function dialH(P, Bz, cx, cy, R, o = {}) {
  const Rb0 = R * 0.86, Rf = R * 0.70, halo = o.haloD, blocked = (pts) => halo && pts.some(([x, y]) => hitAt(halo, x, y) > 8);
  const tokBlock = (x, y, pad) => o.token && Math.hypot(x - o.token[0], y - o.token[1]) < o.token[2] / 2 + pad;
  for (const [c, col] of [[Bz.c, METAL.plat], [Bz.m, FOIL]]) { c.save(); c.fillStyle = col; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.arc(cx, cy, Rb0, 0, 7, true); c.fill('evenodd'); c.restore(); }
  relief(Bz, 190, 5, (h) => { h.beginPath(); h.arc(cx, cy, R - 3, 0, 7); h.arc(cx, cy, Rb0 + 3, 0, 7, true); h.fill('evenodd'); });
  for (let i = 0; i < 120; i++) {
    const a = -Math.PI / 2 + i / 120 * Math.PI * 2, maj = i % 10 === 0, mid = i % 5 === 0;
    const r0 = maj ? Rb0 + 14 : mid ? R - (R - Rb0) * 0.5 : R - (R - Rb0) * 0.28, r1 = R - 10;
    for (const c of [Bz.c, Bz.m]) { c.save(); c.globalCompositeOperation = 'destination-out'; c.lineWidth = maj ? 8 : 3.6; c.beginPath(); c.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); c.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); c.stroke(); c.restore(); }
    relief(Bz, 120, 0, (h) => { h.lineWidth = maj ? 8 : 3.6; h.beginPath(); h.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); h.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); h.stroke(); });
  }
  for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI * 2 + Math.PI / 120, rr = (R + Rb0) / 2 + 4;
    const pts = [0, 20, 40].map((t) => [cx + rr * Math.cos(a) + t * Math.cos(a + Math.PI / 2), cy + rr * Math.sin(a) + t * Math.sin(a + Math.PI / 2)]);
    if (blocked(pts)) continue; // a figure the hands would slice is left out (as a watch leaves out a figure under a subdial)
    for (const c of [Bz.c, Bz.m]) { c.save(); c.globalCompositeOperation = 'destination-out'; c.translate(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); c.rotate(a + Math.PI / 2); c.font = '700 30px "Card Mono"'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(String(i * 5).padStart(2, '0'), 8, 0); c.restore(); } }
  for (const r of [R, Rb0]) { Bz.c.save(); Bz.c.strokeStyle = inkC(0.9); Bz.c.lineWidth = LW.hair; Bz.c.beginPath(); Bz.c.arc(cx, cy, r, 0, 7); Bz.c.stroke(); Bz.c.restore(); }
  const c = P.c;
  for (const r of [Rb0 - 28, Rf + 8]) { c.save(); c.strokeStyle = inkC(0.85); c.lineWidth = LW.hair; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke(); c.restore(); }
  for (let i = 0; i < 300; i++) { const a = -Math.PI / 2 + i / 300 * Math.PI * 2, l = i % 25 === 0 ? 34 : i % 5 === 0 ? 20 : 10; ln(c, [cx + (Rb0 - 28) * Math.cos(a), cy + (Rb0 - 28) * Math.sin(a)], [cx + (Rb0 - 28 - l) * Math.cos(a), cy + (Rb0 - 28 - l) * Math.sin(a)], i % 5 === 0 ? 2.2 : 1.2, INK, 0.85); }
  if (o.guilloche !== false) {
    // r20 d5c: the rosette can be limited to a central disc [r0, r1] at the same ring pitch as the r19 dial (9.35 px)
    const rA = o.rosette ? o.rosette[0] : R * 0.20, rB = o.rosette ? o.rosette[1] : Rf;
    const rings = o.rosette ? Math.round((rB - rA) / 9.35) + 1 : 46, petals = 18;
    for (let i = 0; i < rings; i++) {
      const rr = rA + (rB - rA) * i / (rings - 1), amp = 10 + 7 * Math.sin(i * 0.33);
      const pts = []; for (let tt = 0; tt <= 900; tt++) { const a = tt / 900 * Math.PI * 2; const q = rr + amp * Math.sin(petals * a + i * 0.42); pts.push([cx + q * Math.cos(a), cy + q * Math.sin(a)]); }
      c.save(); c.strokeStyle = inkC(o.guilA ?? 0.16); c.lineWidth = 1.2; c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(...p) : c.moveTo(...p))); c.stroke(); c.restore();
      for (let kk = 0; kk < 900; kk += 3) { const a = pts[kk], b = pts[kk + 3]; P.m.strokeStyle = FOILG(Math.atan2(b[1] - a[1], b[0] - a[0])); P.m.lineWidth = 3.2; P.m.beginPath(); P.m.moveTo(...a); P.m.lineTo(...b); P.m.stroke(); }
      relief(P, 114, 0, (h) => { h.lineWidth = 2.2; h.beginPath(); pts.forEach((p, k) => (k ? h.lineTo(...p) : h.moveTo(...p))); h.stroke(); });
    }
  }
  for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI * 2, r0 = Rf - 70, r1 = Rf - 8, w = i % 3 === 0 ? 20 : 12;
    const p0 = [cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)], p1 = [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)];
    const along = [0, 0.25, 0.5, 0.75, 1].map((t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
    if (blocked(along) || along.some(([x, y]) => tokBlock(x, y, 40))) continue; // an index under the hands or the token goes
    const draw = (cc, col) => { cc.save(); cc.translate(cx, cy); cc.rotate(a); cc.fillStyle = col; cc.beginPath(); cc.roundRect(r0, -w / 2, r1 - r0, w, 3); cc.fill(); cc.restore(); };
    draw(Bz.c, METAL.plat); draw(Bz.m, FOIL); Bz.h.save(); Bz.h.filter = 'blur(2px)'; draw(Bz.h, gray(205)); Bz.h.restore();
    Bz.c.save(); Bz.c.translate(cx, cy); Bz.c.rotate(a); Bz.c.strokeStyle = inkC(0.8); Bz.c.lineWidth = 1.2; Bz.c.strokeRect(r0, -w / 2, r1 - r0, w); Bz.c.restore(); }
  if (o.pointer) { const a = -Math.PI / 2 + 1 / 100 * Math.PI * 2; const p0 = [cx + 180 * Math.cos(a), cy + 180 * Math.sin(a)], p1 = [cx + (Rb0 - 40) * Math.cos(a), cy + (Rb0 - 40) * Math.sin(a)];
    const dr = (cc, col, w) => { cc.save(); cc.strokeStyle = col; cc.lineWidth = w; cc.lineCap = 'round'; cc.beginPath(); cc.moveTo(...p0); cc.lineTo(...p1); cc.stroke(); cc.restore(); };
    dr(Bz.c, METAL.plat, 14); dr(Bz.m, FOIL, 14); Bz.h.save(); Bz.h.filter = 'blur(2px)'; dr(Bz.h, gray(215), 14); Bz.h.restore(); ln(Bz.c, p0, p1, 1.2, INK, 0.8); }
  return { Rb0, Rf };
}


// the card. o = { L (hands layout), dial: [cx, cy, R], token: [x, y, d], art(ctx) -> extra plates, rosette, bezelPlate, bezelBlur }
export function foundingHands(o = {}) {
  const NUMS = TIERS.founding.num, FOIL_P = foilImages(); // the member's own number (set by the caller before the build) and the number's four foil patches
  const { P, A } = page(PAPER); const Bz = bezelPlate();
  const Lk = o.L || 'DB'; const [cx, cy, R] = o.dial || [800, 800, 700];
  const halo = IMG[`${Lk}_halo`], haloD = greyData(halo);
  const tok = o.token || [800, 500, 220];
  const D = dialH(P, Bz, cx, cy, R, { haloD, token: tok, pointer: o.pointer, guilloche: o.guilloche, guilA: o.guilA, rosette: o.rosette });
  // the hands sit on clean paper: the dial (paper plate + bezel plate) is knocked out under them plus a halo
  knockShape([P, Bz], alphaCanvas(halo, [0, 0, 0]));
  // the token's own clearing in the guilloche (a turned seat)
  knockShape([P, Bz], disc(tok[0], tok[1], tok[2] / 2 + 40));
  if (o.seatRing !== false) for (const r of [tok[2] / 2 + 40]) { P.c.save(); P.c.strokeStyle = inkC(0.85); P.c.lineWidth = LW.hair; P.c.beginPath(); P.c.arc(tok[0], tok[1], r, 0, 7); P.c.stroke(); P.c.restore(); }
  // crosshair: the vertical axis of the dial threads the gap (drawn outside the hands, 6 px clear)
  const clearHands = (fn) => { const cc = mk(), x = g2(cc); fn(x); x.globalCompositeOperation = 'destination-out'; x.drawImage(alphaCanvas(IMG[`${Lk}_halo6`], [0, 0, 0]), 0, 0);
    x.drawImage(disc(tok[0], tok[1], tok[2] / 2 + 40), 0, 0); P.c.drawImage(cc, 0, 0); };
  if (o.crossV !== false) clearHands((x) => cline(x, [cx, cy - (R + 40)], [cx, cy + (R + 40)], LW.hair, INK, 0.55, CENTRE_DASH(LW.hair)));
  if (o.crossH) clearHands((x) => cline(x, [cx - (R + 40), cy], [cx + (R + 40), cy], LW.hair, INK, 0.55, CENTRE_DASH(LW.hair)));
  // number (as foundingW: Oxanium 500, shrunk until the right ink edge is on x 1500, foil patches + 4 px keyline)
  const no = { x: 100, y: 1950, cap: 450, align: 'l', track: 0.06, wt: 500 };
  { const t = heroNumber(g2(mk()), NUMS, no); REG.pop(); if (100 + t.w + 2 > 1500) no.cap = Math.floor(no.cap * 1400 / (t.w + 2)); }
  knockNumber([P, Bz], NUMS, no);
  P.c.save(); P.c.globalCompositeOperation = 'destination-over'; P.c.fillStyle = PAPER; P.c.fillRect(0, 0, W, H); P.c.restore();
  const N = foilNumber(P, NUMS, { ...no, key: 4 }, METAL.holo);
  { const tc = mk(), tx = g2(tc); heroNumber(tx, NUMS, { ...no, fill: '#fff' }); REG.pop(); tx.globalCompositeOperation = 'source-in';
    const pc = mk(), px = g2(pc); N.boxes.forEach((q, k) => { const im = FOIL_P[k % 4]; px.drawImage(im, Math.round(no.x + (q.l + q.r) / 2 - im.naturalWidth / 2), Math.round(no.y - no.cap)); });
    tx.drawImage(pc, 0, 0); P.c.drawImage(tc, 0, 0);
    heroNumber(P.m, NUMS, { ...no, fill: 'rgb(0,0,128)' }); REG.pop();
    heroNumber(P.c, NUMS, { ...no, stroke: 4, strokeCol: rgba(INK, 1) }); REG.pop(); }
  // the hands (per direction)
  const extra = o.art ? (o.art({ P, Bz, Lk, IMG, alphaCanvas, no, N, tok, dial: [cx, cy, R], qEx: o.qExclude }) || []) : [];
  lockup(P.c, 100, 100);
  identity(P.c, 100, 2300, { cols: [['MEMBER SINCE', CARD.since]] });
  ['FOUNDING', 'CONTRIBUTOR'].forEach((wd, k) => T(P.c, wd, { x: 1500, y: 2250 - (1 - k) * 75, st: 'tier', v: 'top', align: 'r' }));
  const sl = seal(P, 'insider', tok[0], tok[1], tok[2], o.sealOpt || { machined: true, ring: false, z: 0.0072 }); sl.src = FOUNDING_SEAL;
  REG[REG.length - 1].ko = false;
  // d5d: soften the bezel plate's height a touch so its cut ticks and rim bevel shade smoothly (no stair-step glints)
  if (o.bezelBlur) { const t = mk(), tx = g2(t); tx.filter = 'blur(' + o.bezelBlur + 'px)'; tx.drawImage(Bz.hgt, 0, 0); Bz.h.save(); Bz.h.globalCompositeOperation = 'copy'; Bz.h.drawImage(t, 0, 0); Bz.h.restore(); }
  knockout(A); compose(P, A); foilEdge(P, METAL.holo); finalize(P); finalize(Bz, 0);
  for (const e of extra) if (e.fin) finalize(e.Q, 0);
  return { plates: [{ col: P.col, map: P.map, z: 0, kind: KIND.holo, gloss: 0.08, sat: 0.9, holo: 0.85, bump: 7 }, { col: Bz.col, map: Bz.map, z: 0.006, kind: KIND.silver, gloss: 0.35, bump: 9, ...(o.bezelPlate || {}) }, ...extra.map((e) => e.plate)],
    seal: sl, edge: '#dfe1e5', seed: 3.1, number: no };
}

// ---------------- the hands: the engraving, pressed (his "contact" art) ----------------
const ARTS = {
  emboss: ({ IMG, Lk, alphaCanvas: ac, qEx }, amp = 1.0, bump = 6, inkFn = null, postFn = null, bake = 0.35, cap = 0.25) => {
    const Q = H13.plate(null); Q.c.drawImage(ac(IMG[`${Lk}_halo`], [255, 255, 255]), 0, 0);
    if (qEx) { Q.c.save(); Q.c.globalCompositeOperation = 'destination-out'; Q.c.drawImage(disc(...qEx), 0, 0); Q.c.restore(); } // keep the token's seat visible
    if (inkFn) { const t = mk(), tx = g2(t); inkFn(tx); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(ac(IMG[`${Lk}_halo`], [0, 0, 0]), 0, 0); Q.c.drawImage(t, 0, 0); }
    if (postFn) postFn(Q.c);
    Q.h.save(); Q.h.fillStyle = gray(128); Q.h.fillRect(0, 0, W, H); Q.h.restore();
    const hc = mk(), hx = g2(hc); hx.drawImage(IMG[`${Lk}_emboss`], 0, 0); const d = hx.getImageData(0, 0, W, H), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const v = 128 + Math.round(a[i] / 255 * 112 * amp); a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
    hx.putImageData(d, 0, 0); Q.h.save(); Q.h.filter = 'blur(0.6px)'; Q.h.drawImage(hc, 0, 0); Q.h.restore();
    // the paper shader lifts white stock to 255 and keeps 0.8 ambient, so a relief can darken it by only ~20 levels;
    // a fixed share of the same light (upper left, the shader's key) is baked into the paper colour as occlusion on
    // the faces turned away. Only darkening (white cannot go brighter), crisp on the die edge, nothing outside it.
    if (bake > 0) {
      const sh = mk(), sx = g2(sh), sd = sx.createImageData(W, H), S = sd.data; const Lx = -0.42, Ly = -0.66, Lz = 0.62, nl = Math.hypot(Lx, Ly, Lz);
      // float copy of the die, box-smoothed (r 2, twice) so the 8-bit steps of the soft modelling do not read as streaks
      let F = new Float32Array(W * H); for (let i = 0; i < F.length; i++) F[i] = a[i * 4];
      const box = (src, dx, dy) => { const o = new Float32Array(src.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0;
        for (let k = -2; k <= 2; k++) { const xx = x + k * dx, yy = y + k * dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; s += src[yy * W + xx]; n++; } o[y * W + x] = s / n; } return o; };
      for (let p = 0; p < 2; p++) F = box(box(F, 1, 0), 0, 1);
      const lv = (i) => F[i];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; let dk = 0;
        const gx = (lv(i + 1) - lv(i - 1)) * 0.5, gy = (lv(i + W) - lv(i - W)) * 0.5;
        if (gx || gy) { const nx = -gx * 0.09, ny = -gy * 0.09, nn = Math.hypot(nx, ny, 1); const dt = (nx * Lx + ny * Ly + Lz) / (nn * nl) - Lz / nl; dk = Math.max(0, -dt) * bake; }
        const v = Math.round(255 * (1 - Math.min(cap, dk))); S[i * 4] = S[i * 4 + 1] = S[i * 4 + 2] = v; S[i * 4 + 3] = 255; }
      sx.putImageData(sd, 0, 0); const sb = mk(), sbx = g2(sb); sbx.filter = 'blur(0.5px)'; sbx.drawImage(sh, 0, 0);
      Q.c.save(); Q.c.globalCompositeOperation = 'multiply'; Q.c.drawImage(sb, 0, 0); Q.c.restore();
      Q.c.save(); Q.c.globalCompositeOperation = 'destination-in'; Q.c.drawImage(ac(IMG[`${Lk}_halo`], [0, 0, 0]), 0, 0); Q.c.restore();
      if (postFn) postFn(Q.c);
    }
    return [{ Q, fin: true, plate: { col: Q.col, map: Q.map, z: 0.0004, kind: 0, gloss: 0.08, bump } }];
  },
  // 5 the point of contact: the engraving, pressed (a soft intaglio relief), the dial as the halo round the gap,
  // the one full-spectrum glint in the gap on the dial's axis
  // the engraving pressed as a soft intaglio relief, the dial as the halo round the gap (the team's rule: no spark in the gap on d5d)
  contact: (c, o = {}) => {
    const { P, Lk, IMG } = c;
    const ink = (x) => x.drawImage(alphaCanvas(IMG[`${Lk}_engrave`], [84, 88, 96]), 0, 0);
    if (o.relief === false) { ink(P.c); return []; }
    return ARTS.emboss(c, o.amp ?? 0.5, o.bump ?? 6, ink, null);
  },
};
// D5d (the team approved D5c B): God's thumb separated from the fingers behind it (layout DB), and the bezel plate (bezel, index bars) as smooth turned platinum:
// no per-facet flakes, concentric tool marks round the dial
export const founding = () => foundingHands({ L: LAYOUT.hands, art: (c) => ARTS.contact(c, { spark: false }),
  token: LAYOUT.token, rosette: LAYOUT.rosette, seatRing: false, sealOpt: { ring: false, z: 0.0072 }, qExclude: LAYOUT.qExclude,
  bezelPlate: { ...LAYOUT.bezel }, bezelBlur: LAYOUT.bezelBlur });
