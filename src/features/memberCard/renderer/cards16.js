// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// r16: (1) Trusted = flipped a, with the identity block re-placed on the card grid (three options);
//      (2) Founding redesign: six full-material concepts FC1..FC6 built as stacked plates (base material, inlays,
//          a platinum plate for lines/type/number, the seal on top). Early, Contributor, Insider are untouched.
import { W, H, INK, LW, T, identity, lockup, markAt, heroNumber, regReset, CARD, REG } from './sys12.js';
import { drawConstruction, GEO } from './sketch.js';
import { mk, TIERS } from './art10.js';
import { H13 } from './cards12.js';
import { guilloche } from './cards15.js';
import { SEALS, FOIL_DIGITS } from './assets.js';
import { trusted } from './cards14.js';
import { flipTrusted } from './flip15.js';
const { plate, relief, finalize, FOIL, FOILG, gray, g2 } = H13;
const TAU = Math.PI * 2;
const lin = (hex) => [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));

// ---------------------------------------------------------------------------------------------------------------
// Trusted: flipped a + identity positions
// ---------------------------------------------------------------------------------------------------------------
const LAB = 'rgba(18,19,23,0.92)'; // label ink before the flip -> near-white after it (legible on metal)
// header: the official wordmark's ink box is y 109.47..166.81 (cap 57.34) when the mark sits at (100,100) h 75.
// The tier word's first line takes exactly that cap line and baseline; the second line follows 25 px below.
export const HDR = { st: { fam: 'Card Mono', wt: 700, cap: 57.34, track: 0.15 }, y: [109.47, 191.81] };
const TH = { tierY: HDR.y, tierSt: HDR.st };
export const TRUSTED16 = {
  trustedPa: () => flipTrusted(trusted({ ...TH, id: { x: 100, B: 2300, labCol: LAB } }), 'a'),
  trustedPb: () => flipTrusted(trusted({ ...TH, id: { x: 100, B: 2300, labCol: LAB }, cell: 1925 }), 'a'),
  trustedPc: () => flipTrusted(trusted({ ...TH, id: { x: 300, B: 2300, align: 'c', labCol: LAB } }), 'a'),
  trustedOld: () => flipTrusted(trusted(), 'a'),
};

// ---------------------------------------------------------------------------------------------------------------
// Founding: plate helpers
// ---------------------------------------------------------------------------------------------------------------
const PL = '220,222,226'; // platinum swatch (only the alpha of the colour plate matters on a foil plate)
const PLATM = [0.60, 0.62, 0.66];
function full(P) { P.m.save(); P.m.fillStyle = FOIL; P.m.fillRect(0, 0, W, H); P.m.restore(); }
function base(hex, foil = true) { regReset(); const P = plate(hex); if (foil) full(P); return P; }
function layer() { const Q = plate(null); full(Q); return Q; }
// draw fn(ctx, 'r,g,b') on the colour plate (col) and on the height plate (level lev, blur); clips = [[path, rule]]
function put(Q, fn, col, lev = null, blur = 1, clips = null) {
  const go = (c, t, b) => { c.save(); if (clips) for (const [p, r] of clips) c.clip(p, r || 'nonzero'); if (b) c.filter = `blur(${b}px)`; fn(c, t); c.restore(); };
  if (col) go(Q.c, col, 0);
  if (lev != null) go(Q.h, `${lev},${lev},${lev}`, blur);
}
const fillP = (path) => (c, t) => { c.fillStyle = `rgb(${t})`; c.fill(path); };
const strokeP = (path, w) => (c, t) => { c.strokeStyle = `rgb(${t})`; c.lineWidth = w; c.lineJoin = 'round'; c.stroke(path); };
const lineP = (pts, w) => (c, t) => { c.strokeStyle = `rgb(${t})`; c.lineWidth = w; c.lineCap = 'butt'; c.beginPath(); for (let i = 0; i < pts.length; i += 2) { c.moveTo(...pts[i]); c.lineTo(...pts[i + 1]); } c.stroke(); };
const rectPath = (x, y, w, h) => { const p = new Path2D(); p.rect(x, y, w, h); return p; };
const outside = (path) => { const p = new Path2D(); p.rect(-10, -10, W + 20, H + 20); p.addPath(path); return [p, 'evenodd']; };
function markC(cx, cy, s) { const C = GEO.C; return markAt(cx + (GEO.box[0] - C[0]) * s, cy + (GEO.box[1] - C[1]) * s, (GEO.box[3] - GEO.box[1]) * s); }
const metalE = (Q, z, o = {}) => ({ col: Q.col, map: Q.map, aux: o.aux, z, kind: 1, gloss: 0.1, bump: o.bump ?? 6, metal: o.metal || PLATM, hi: o.hi || [1, 1, 1], guil: o.guil });
const glazeE = (Q, z, hex, o = {}) => ({ col: Q.col, map: Q.map, aux: o.aux, z, kind: 5, gloss: 0.1, bump: o.bump ?? 8, metal: lin(hex), hi: [1, 1, 1], clear: o.clear ?? 0.6, guil: o.guil || [0, 0, 0], paper: 0 });

function header(Q, t = PL, lev = 150) {
  put(Q, (c, col) => { lockup(c, 100, 100, { col: `rgb(${col})` });
    T(c, 'FOUNDING', { x: 1500, y: HDR.y[0], st: HDR.st, v: 'top', align: 'r', col: `rgb(${col})` });
    T(c, 'CONTRIBUTOR', { x: 1500, y: HDR.y[1], st: HDR.st, v: 'top', align: 'r', col: `rgb(${col})`, id: 'C2' }); }, t, lev, 0.7);
}
function ident(Q, x, B, t = PL, o = {}) { put(Q, (c, col) => identity(c, x, B, { col: `rgb(${col})`, labCol: `rgba(${col},${o.labA ?? 0.74})`, align: o.align, cols: o.cols }), t, o.lev ?? 148, 0.6); }
function sealAt(P, Q, x, y, d, o = {}) {
  if (P) relief(P, 100, 3, (h) => { h.beginPath(); h.arc(x, y, d / 2 + 8, 0, TAU); h.fill(); });
  if (Q && o.ring !== false) put(Q, (c, t) => { c.strokeStyle = `rgb(${t})`; c.lineWidth = o.rw || 5; c.beginPath(); c.arc(x, y, d / 2 + (o.gap || 16), 0, TAU); c.stroke(); }, PL, 160, 1);
  return { src: null, cx: x / W, cy: y / H, size: d / 0.83 / W, z: o.z ?? 0.006 };
}
const label = (Q, s, x, y, o = {}) => put(Q, (c, col) => T(c, s, { x, y, st: 'label', v: 'top', align: o.align || 'l', col: `rgba(${col},${o.a ?? 0.74})`, id: false }), o.t || PL, 146, 0.5);
const fin = (...ps) => ps.forEach((p) => finalize(p, 0));
// a grey aux field (R) from a draw fn; returns the canvas
function auxOf(fn) { const a = mk(), x = g2(a); x.fillStyle = 'rgb(0,0,0)'; x.fillRect(0, 0, W, H); fn(x); return a; }

// value noise, upscaled (for the Damascus field)
const PAL9 = [[77, 219, 209], [82, 133, 255], [153, 117, 255], [255, 214, 117], [143, 242, 133]];
function vnoise(seed) { const hs = (i, j) => { let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hs(i, j), b = hs(i + 1, j), c = hs(i, j + 1), d = hs(i + 1, j + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }; }
let _stripes = null;
export function stripeHolo() {
  if (_stripes) return _stripes;
  const c = mk(), x = g2(c), d = x.createImageData(W, H), A = d.data; const n1 = vnoise(3), n2 = vnoise(11), n3 = vnoise(29);
  const ang = -0.30, ca = Math.cos(ang), sa = Math.sin(ang); const ss = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let y = 0, i = 0; y < H; y++) for (let xx = 0; xx < W; xx++, i += 4) {
    const u = xx * ca + y * sa, v = -xx * sa + y * ca;
    const t = v / 330 + 0.50 * (n1(xx / 650, y / 650) - 0.5) + 0.15 * (n2(u / 260, v / 6) - 0.5) + 0.05 * (n3(u / 70, v / 2.2) - 0.5);
    const tt = (((t % 1) + 1) % 1) * 5, k = Math.floor(tt), f = ss(0.32, 0.68, tt - k); const p = PAL9[k], q = PAL9[(k + 1) % 5];
    const lit = 0.80 + 0.30 * n2(u / 420 + 7, v / 9) + 0.06 * (n3(u / 40, v / 1.6) - 0.5);
    for (let j = 0; j < 3; j++) A[i + j] = Math.min(255, (p[j] + (q[j] - p[j]) * f) * lit); A[i + 3] = 255;
  }
  x.putImageData(d, 0, 0); return (_stripes = c);
}
// r19: tokens follow the RANK. Insider (black card) = the original holo compass seal (INSIDER, No. 0001);
// Founding (white card) = the black seal (FOUNDING CONTRIBUTOR), platinum-toned as on r17's black card, No. 0003.
// r19b (the team correction): tokens stay with their card DESIGN, lettered for the new rank (the r18 re-lettered seals):
// black token (INSIDER, No. 0001) on the black Insider card; holo compass (FOUNDING, No. 0003) on the white Founding card.
let FOIL_IMGS = null;
const ld = (src) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
export async function preloadR18() { if (FOIL_IMGS) return; FOIL_IMGS = await Promise.all(FOIL_DIGITS.map((u) => ld(u))); }
// the Founding number's four foil patches (one per digit position), as loaded by preloadR18
export const foilImages = () => FOIL_IMGS;
// the black Insider token is the pack's own token file (his insiderToken() toned the seal at run time: the file is that picture)
export const insiderToken = () => SEALS.insider;
const FLAT = '214,216,221'; // flat platinum-grey ink on the black (no foil, no relief, no gloss)
function fc6Insider() {
  const Lo = base(null), Tp = layer(), Q = layer(), Fl = plate(null);
  const s = 14.5, cx = 800, cy = 1040, D = markC(cx, cy, s);
  // lower plate under the window: exactly fc6 (r17): platinum, engine-turned about the mark centre
  put(Lo, (c, t) => { c.fillStyle = `rgb(${t})`; c.fill(D.path); c.strokeStyle = `rgb(${t})`; c.lineWidth = 80; c.lineJoin = 'round'; c.stroke(D.path); }, '200,202,206');
  const aux = auxOf((x) => { x.fillStyle = 'rgb(70,70,70)'; x.fillRect(0, 0, W, H); guilloche(x, cx, cy, 1200, { pitch: 6 }); });
  Lo.h.save(); Lo.h.globalAlpha = 0.25; Lo.h.drawImage(aux, 0, 0); Lo.h.restore();
  // top plate: black ceramic with the window cut (unchanged from fc6)
  Tp.c.fillStyle = '#09090b'; Tp.c.fillRect(0, 0, W, H); Tp.c.save(); Tp.c.globalCompositeOperation = 'destination-out'; Tp.c.fill(D.path); Tp.c.restore();
  relief(Tp, 70, 7, (h) => h.fill(D.path));
  // all type and the rule: flat ink on their own plate (no height, no foil)
  const F = Fl.c, ink = `rgb(${FLAT})`;
  lockup(F, 100, 100, { col: ink });
  T(F, 'INSIDER', { x: 1500, y: HDR.y[0], st: HDR.st, v: 'top', align: 'r', col: ink });
  F.save(); F.strokeStyle = ink; F.lineWidth = 2.5; F.beginPath(); F.moveTo(100, 1900); F.lineTo(1500, 1900); F.stroke(); F.restore();
  // the number sits bottom right on the same line as the name: the name may run only as far as 60 px short of the number's left ink edge
  { const nw = heroNumber(g2(mk(10, 10)), TIERS.insider.num, { x: 0, y: 0, cap: 175, align: 'r', track: 0.1, wt: 400 }); REG.pop(); CARD.nameMax = Math.min(CARD.nameMax || 1e9, 1500 - nw.w - 60 - 100); }
  identity(F, 100, 2300, { col: ink, labCol: `rgba(${FLAT},0.74)` });
  T(F, 'INSIDER No.', { x: 1500, y: 2025, st: 'label', v: 'top', align: 'r', col: `rgba(${FLAT},0.74)`, id: false });
  // the number: r17's platinum colour, printed flat (no relief, no dent, no gloss)
  heroNumber(F, TIERS.insider.num, { x: 1500, y: 2300, cap: 175, align: 'r', track: 0.1, wt: 400, fill: ink });
  const ax = 100 + 84, ay = cy - 0.5 * (GEO.box[3] - GEO.box[1]) * s + 84;
  const sl = sealAt(Tp, Q, ax, ay, 168); sl.src = insiderToken();
  fin(Lo, Tp, Q, Fl);
  const printed = (Pp, z) => ({ col: Pp.col, map: Pp.map, z, kind: 0, gloss: 0, bump: 0, paper: 0 });
  return { plates: [metalE(Lo, 0, { aux, guil: [1.1, 0, 0], metal: [0.62, 0.64, 0.68], bump: 7 }), glazeE(Tp, 0.0030, '#09090b', { aux: satin(), clear: 0.25, guil: [0, 0.05, 0.08] }), metalE(Q, 0.0034), printed(Fl, 0.0036)], seal: sl, edge: '#0d0d0f', seed: 5.6 };
}
export const R18 = { fc6Insider };
export const CARDS16 = { trusted: TRUSTED16.trustedPb, insider: fc6Insider };

function satin() { return auxOf((x) => { const d = x.getImageData(0, 0, W, H), a = d.data; for (let i = 0; i < a.length; i += 4) { const v = 120 + Math.random() * 30; a[i] = a[i + 1] = a[i + 2] = v; } x.putImageData(d, 0, 0); }); }
