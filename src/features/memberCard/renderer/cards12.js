// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// r12 member cards. System: sys12.js (same grid as r11). New in r12: a height plate (real relief: emboss, deboss,
// engraving, machined recesses), multi-material plates, the hand-drawn pass for Early, the solid holo mosaic.
import { W, H, MOD, INK, PAPER, IVORY, ACC, LW, T, identity, lockup, markAt, heroNumber, ln, cline, CENTRE_DASH, dimension, annot, balloon, rgba, reg, REG, regReset, ANN, CARD } from './sys12.js';
import { SEALS } from './assets.js';
import { drawConstruction, GEO, LABEL } from './sketch.js';
import { mk, TIERS } from './art10.js';

const FOIL = 'rgb(255,0,128)';
const FOILG = (ang) => `rgb(255,${Math.max(2, Math.round((((ang % Math.PI) + Math.PI) % Math.PI) / Math.PI * 255))},128)`;
const METAL = { silver: '#c3c5c9', gold: '#b98a3e', blue: '#1d3270', holo: '#cdd0d5', plat: '#d4d6da' };
const KIND = { silver: 0, gold: 1, blue: 2, holo: 3, pearl: 4 };
const inkC = (a = 1) => rgba(INK, a);
const MMPX = W / 53.98;
const SEAL_SRC = (tier) => SEALS[tier];
const C30 = Math.sqrt(3) / 2;
const g2 = (c) => c.getContext('2d');
const gray = (v) => `rgb(${v},${v},${v})`;

// ---------- plates: colour + foil/grating map + height ----------
function plate(stock) {
  const col = mk(), map = mk(), hgt = mk();
  const c = g2(col), m = g2(map), h = g2(hgt);
  if (stock) { c.fillStyle = stock; c.fillRect(0, 0, W, H); }
  m.fillStyle = 'rgb(0,0,128)'; m.fillRect(0, 0, W, H); h.fillStyle = gray(128); h.fillRect(0, 0, W, H);
  return { col, map, hgt, c, m, h };
}
// merge height into the map's blue channel; foil areas sit 10 levels lower (stamped)
function finalize(P, stampDepth = 10) {
  const md = P.m.getImageData(0, 0, W, H), hd = P.h.getImageData(0, 0, W, H); const a = md.data, b = hd.data;
  for (let i = 0; i < a.length; i += 4) a[i + 2] = Math.max(0, Math.min(255, b[i] - (a[i] > 8 ? stampDepth * a[i] / 255 : 0)));
  P.m.putImageData(md, 0, 0);
}
// relief: draw on the height plate with a level (128 = flat; >128 raised, <128 sunk) and a bevel blur
function relief(P, level, blur, fn) { P.h.save(); if (blur) P.h.filter = `blur(${blur}px)`; P.h.fillStyle = gray(level); P.h.strokeStyle = gray(level); fn(P.h); P.h.restore(); }
function page(stock = PAPER) {
  regReset(); const P = plate(stock);
  const A = { c: g2(mk()), m: g2(mk()) }; // drawing layer (knocked out around type)
  return { P, A };
}
function knockout(A, pad = 25) {
  for (const r of REG) { if (!['text', 'mark', 'seal'].includes(r.kind) || r.ko === false) continue;
    for (const c of [A.c, A.m]) { if (r.kind === 'seal') { c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (r.x1 - r.x0) / 2 + pad, 0, 7); c.fill(); c.restore(); }
      else c.clearRect(r.x0 - pad, r.y0 - pad, r.x1 - r.x0 + 2 * pad, r.y1 - r.y0 + 2 * pad); } }
}
function compose(P, A, filter) { if (filter) P.c.filter = filter; P.c.drawImage(A.c.canvas, 0, 0); P.c.filter = 'none'; P.m.drawImage(A.m.canvas, 0, 0); }
// seal in a seat: printed ring + recess. machined = stepped recess (two turned steps) for the instrument hub
function seal(P, tier, cx, cy, d = 200, o = {}) {
  if (o.ring !== false) { P.c.save(); P.c.strokeStyle = o.ring || inkC(0.55); P.c.lineWidth = LW.hair; P.c.beginPath(); P.c.arc(cx, cy, d / 2 + 25, 0, 7); P.c.stroke(); P.c.restore(); }
  if (o.machined) { relief(P, 96, 1.5, (h) => { h.beginPath(); h.arc(cx, cy, d / 2 + 34, 0, 7); h.fill(); }); relief(P, 72, 1.5, (h) => { h.beginPath(); h.arc(cx, cy, d / 2 + 12, 0, 7); h.fill(); }); }
  else relief(P, 104, 3, (h) => { h.beginPath(); h.arc(cx, cy, d / 2 + 10, 0, 7); h.fill(); });
  if (o.goldRing) { for (const [c, col] of [[P.c, METAL.gold], [P.m, FOIL]]) { c.save(); c.strokeStyle = col; c.lineWidth = 9; c.beginPath(); c.arc(cx, cy, d / 2 + 16, 0, 7); c.stroke(); c.restore(); } relief(P, 150, 1.2, (h) => { h.lineWidth = 9; h.beginPath(); h.arc(cx, cy, d / 2 + 16, 0, 7); h.stroke(); }); }
  reg('seal', { x0: cx - d / 2, x1: cx + d / 2, y0: cy - d / 2, y1: cy + d / 2, ax: cx, ay: cy, free: o.free }, 'seal');
  return { src: SEAL_SRC(tier), cx: cx / W, cy: cy / H, size: d / 0.83 / W, z: o.z ?? 0.0012 };
}
function foilEdge(P, metal, w = 28) { for (const [c, col] of [[P.c, metal], [P.m, FOIL]]) { c.save(); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.roundRect(0, 0, W, H, 94); c.stroke(); c.restore(); }
  relief(P, 150, 2, (h) => { h.lineWidth = w; h.beginPath(); h.roundRect(0, 0, W, H, 94); h.stroke(); }); }
// a foil number: foil fill + ink keyline + a debossed bed 10 px wider than the glyphs (the die's edge)
function foilNumber(P, str, o, metal, key = INK, bed = 96) {
  const N = heroNumber(P.c, str, { ...o, fill: metal, map: P.m, mapCol: o.grating != null ? FOILG(o.grating) : FOIL, stroke: o.key ?? LW.thin, strokeCol: rgba(key, 1) });
  if (bed) { const tmp = { save() {}, restore() {} }; void tmp; P.h.save(); P.h.filter = 'blur(2.5px)'; heroNumber(P.h, str, { ...o, fill: gray(bed), stroke: 14, strokeCol: gray(bed) }); P.h.restore(); REG.pop(); }
  return N;
}

// ==================================================================================================================
// EARLY MEMBER: "The mark, constructed", now drawn by hand with instruments
// ==================================================================================================================
export function early() {
  const tier = 'early', { P, A } = page(PAPER);
  const s = 15.5, cx = 1150, C = GEO.C, top = 225, cyy = top + (C[1] - GEO.box[1]) * s;
  // paper tooth (very fine)
  P.c.save(); P.c.filter = 'url(#acira-card-tooth)'; P.c.fillRect(0, 0, W, H); P.c.restore();
  // the drawing, annotated in a drafting hand
  LABEL.fam = 'Architects Daughter'; LABEL.k = 1.45; LABEL.wt = 400; LABEL.jit = true; ANN.fam = 'Architects Daughter';
  try {
    drawConstruction(A.c, { cx, cy: cyy, s, density: 1, ink: '38,40,46', accent: ACC, lw: LW.thin, px: 22, fill: null, clipR: 70, gridAlpha: 0.12, conAlpha: 0.52 });
    // compass pin-pricks: where the compass point sat (every fillet centre), a tiny dark dot inside a hair ring
    for (const a of [...GEO.arcs, ...GEO.arcs.map((q) => ({ ...q, c: [2 * C[0] - q.c[0], 2 * C[1] - q.c[1]] }))]) {
      const p = [cx + (a.c[0] - C[0]) * s, cyy + (a.c[1] - C[1]) * s]; A.c.save(); A.c.fillStyle = inkC(0.85); A.c.beginPath(); A.c.arc(p[0], p[1], 2.2, 0, 7); A.c.fill(); A.c.strokeStyle = inkC(0.35); A.c.lineWidth = 1; A.c.beginPath(); A.c.arc(p[0], p[1], 6, 0, 7); A.c.stroke(); A.c.restore(); }
    // the 30-degree axis, struck across the sheet
    const u = [C30, 0.5], c0 = [cx, cyy];
    cline(A.c, [c0[0] - u[0] * 1250, c0[1] - u[1] * 1250], [c0[0] + u[0] * 600, c0[1] + u[1] * 600], LW.hair, INK, 0.75, CENTRE_DASH(LW.hair));
    annot(A.c, 'axis 30°', [c0[0] - u[0] * 1010, c0[1] - u[1] * 1010 - 26], { ang: Math.PI / 6 });
  } finally { LABEL.fam = 'Card Mono'; LABEL.k = 1; LABEL.wt = null; LABEL.jit = false; ANN.fam = null; /* his page drew one card at a time and never reset this: the next card's small figures came out in the drawing hand */ }
  // pearl overprint on the outline
  { const D = markAt(cx + (GEO.box[0] - C[0]) * s, cyy + (GEO.box[1] - C[1]) * s, (GEO.box[3] - GEO.box[1]) * s); A.m.save(); A.m.strokeStyle = FOIL; A.m.lineWidth = LW.heavy + 3; A.m.stroke(D.path); A.m.restore(); }
  // type
  lockup(P.c, 100, 100);
  // faint lettering guide lines left under the hand-set tier word (cap and base of both lines), as a draftsman rules them
  for (const y of [400, 450, 475, 525]) cline(P.c, [100, y], [475, y], 1, INK, 0.16, null, 30);
  T(P.c, 'EARLY', { x: 100, y: 400, st: 'tier', v: 'top' });
  T(P.c, 'MEMBER', { x: 100, y: 475, st: 'tier', v: 'top' });
  const y0 = 1900, y1 = 2300, xa = 800, xb = 1250;
  ln(P.c, [100, y0], [1500, y0], LW.thin, INK, 1); ln(P.c, [xa, y0], [xa, y1], LW.hair, INK, 0.8); ln(P.c, [xb, y0], [xb, y1], LW.hair, INK, 0.8); ln(P.c, [100, y1], [1500, y1], LW.hair, INK, 0.8);
  T(P.c, 'MEMBER', { x: 100, y: 1925, st: 'micro', v: 'top', col: inkC(0.6) });
  T(P.c, 'No.', { x: xa + 25, y: 1925, st: 'micro', v: 'top', col: inkC(0.6) });
  T(P.c, 'SHEET 01/05', { x: 1500, y: 1925, st: 'micro', v: 'top', align: 'r', col: inkC(0.6) });
  identity(P.c, 100, 2250);
  heroNumber(P.c, TIERS[tier].num, { x: xa + 25, y: 2250, cap: 100, align: 'l', track: 0.05, fill: inkC() });
  T(P.c, 'SCALE 15.5 : 1  ·  u', { x: xa + 25, y: 2050, st: 'micro', v: 'base', col: inkC(0.6) });
  const sl = seal(P, tier, 1375, 2125, 200);
  knockout(A); compose(P, A, 'url(#acira-card-hand)'); finalize(P);
  return { plates: [{ col: P.col, map: P.map, z: 0, kind: KIND.pearl, gloss: 0.06, paper: 0.03 }], seal: sl, edge: '#e7e7e7', seed: 0.4 };
}

// ==================================================================================================================
// CONTRIBUTOR: "The number, dimensioned", tightened. Every element hangs off the number's own geometry:
//  - Detail B sits on the 30-degree ray from the zero's bar (the family angle), centred on the left column's axis x 325
//  - the seal's centre sits on the cell line between "2" and "1", extended across to it as a hairline datum
//  - captions sit one module above what they caption; the pitch chain runs on x 800 (the column's right edge)
// ==================================================================================================================
export function contributor() {
  const tier = 'contributor', { P, A } = page(PAPER); const str = TIERS[tier].num;
  const xb = 1500; let cap = 600, tr = 0.06;
  // his four digits fill the 2000 px run exactly by spreading their tracking (unchanged); a longer number takes a smaller cap so the run stays 2000 px
  { let t = heroNumber(g2(mk(10, 10)), str, { x: 0, y: 0, cap, track: tr }); REG.pop();
    while (str.length > 4 && t.w > 2000 - (str.length - 1) * 0.02 * t.px && cap > 200) { cap -= 10; t = heroNumber(g2(mk(10, 10)), str, { x: 0, y: 0, cap, track: tr }); REG.pop(); }
    tr += (2000 - t.w) / (str.length - 1) / t.px; }
  const N = foilNumber(P, str, { x: xb, y: 2300, cap, rot: -90, align: 'l', track: tr }, METAL.silver);
  const Y = (lx) => 2300 - lx;
  cline(A.c, [xb, 300], [xb, 2300], LW.hair, INK, 0.55); cline(A.c, [xb - cap, 300], [xb - cap, 2300], LW.hair, INK, 0.55);
  cline(A.c, [xb - cap / 2, 300], [xb - cap / 2, 2300], LW.hair, INK, 0.5, CENTRE_DASH(LW.hair));
  for (const b of N.boxes) for (const e of [b.l, b.r]) cline(A.c, [xb - cap - 25, Y(e)], [xb + 25, Y(e)], LW.hair, INK, 0.45, null, 25);
  // pitch chain on x 800, labels in mm (unit stated once, on the first)
  for (let k = 0; k < N.boxes.length - 1; k++) dimension(A.c, [800, Y(N.boxes[k].l)], [800, Y(N.boxes[k + 1].l)], `${((N.boxes[k + 1].l - N.boxes[k].l) / MMPX).toFixed(2)}${k === 0 ? ' mm' : ''}`, [-1, 0]);
  for (const b of N.boxes.slice(0, -1)) ln(A.c, [812, Y(b.l)], [xb - cap - 12, Y(b.l)], LW.hair, INK, 0.4);
  ln(A.c, [xb - cap, 288], [xb - cap, 188], LW.hair, INK, 0.6); ln(A.c, [xb, 288], [xb, 188], LW.hair, INK, 0.6);
  dimension(A.c, [xb - cap, 200], [xb, 200], `CAP ${(cap / MMPX).toFixed(2)} mm`, [0, -1]);
  // Detail B on the 30-degree ray from the bar
  const hasZero = N.boxes.some((b) => b.ch === '0'), z = N.boxes.find((b) => b.ch === '0') || N.boxes[0]; const zc = [xb - cap / 2, Y((z.l + z.r) / 2)];
  const dcx = 325, dc = [dcx, zc[1] - (zc[0] - dcx) * Math.tan(Math.PI / 6)], dr = 225, sc = 2.4;
  const inDetail = (c, fn) => { c.save(); c.beginPath(); c.arc(dc[0], dc[1], dr, 0, 7); c.clip(); c.translate(dc[0], dc[1]); c.scale(sc, sc); c.translate(-zc[0], -zc[1]); fn(c); c.restore(); };
  const bh = cap * 0.22, st = N.stem;
  inDetail(A.c, (c) => { heroNumber(c, str, { x: xb, y: 2300, cap, rot: -90, align: 'l', track: tr, stroke: LW.thin / sc, strokeCol: inkC(1) }); REG.pop();
    if (!hasZero) return; // a number without a zero has no bar to magnify: the detail shows the first digit's stroke alone
    for (const yy of [zc[1] - st / 2, zc[1] + st / 2]) ln(c, [zc[0] - bh / 2 - 40, yy], [zc[0] + bh / 2 + 40, yy], LW.hair / sc, INK, 0.7);
    for (const xx of [zc[0] - bh / 2, zc[0] + bh / 2]) ln(c, [xx, zc[1] - st / 2 - 30], [xx, zc[1] + st / 2 + 30], LW.hair / sc, INK, 0.7);
    c.fillStyle = METAL.silver; c.fillRect(zc[0] - bh / 2, zc[1] - st / 2, bh, st); });
  if (hasZero) inDetail(A.m, (c) => { c.fillStyle = FOIL; c.fillRect(zc[0] - bh / 2, zc[1] - st / 2, bh, st); });
  A.c.save(); A.c.strokeStyle = inkC(1); A.c.lineWidth = LW.thin; A.c.beginPath(); A.c.arc(dc[0], dc[1], dr, 0, 7); A.c.stroke(); A.c.restore();
  annot(A.c, hasZero ? `BAR ${(st / MMPX).toFixed(2)} × ${(bh / MMPX).toFixed(2)} mm` : `STEM ${(st / MMPX).toFixed(2)} mm`, [dc[0], dc[1] + dr - 40], {});
  A.c.save(); A.c.strokeStyle = inkC(1); A.c.lineWidth = LW.hair; A.c.beginPath(); A.c.arc(zc[0], zc[1], 95, 0, 7); A.c.stroke(); A.c.restore();
  { const u = [C30, 0.5]; ln(A.c, [dc[0] + u[0] * dr, dc[1] + u[1] * dr], [zc[0] - u[0] * 95, zc[1] - u[1] * 95], LW.hair, INK, 0.9); annot(A.c, '30°', [dc[0] + u[0] * (dr + 120), dc[1] + u[1] * (dr + 120) - 22], { ang: Math.PI / 6 }); }
  // the seal on the cell line between "2" and "1"
  const b1 = N.boxes[N.boxes.length - 2], b2 = N.boxes[N.boxes.length - 1]; const sy = Y((b1.r + b2.l) / 2);
  cline(A.c, [325 + 125, sy], [xb - cap - 25, sy], LW.hair, INK, 0.45, null, 25);
  // type: left column x 100..800, axis x 325
  lockup(P.c, 100, 100);
  T(P.c, 'CONTRIBUTOR', { x: 100, y: 300, st: 'tier', v: 'top' });
  T(P.c, hasZero ? 'DETAIL B  ·  MARKED ZERO  ·  2.4 : 1' : 'DETAIL B  ·  STEM  ·  2.4 : 1', { x: 100, y: Math.round((dc[1] - dr - 75) / 25) * 25, st: 'micro', v: 'top', col: inkC(0.7) });
  identity(P.c, 100, 2300);
  const sl = seal(P, tier, 325, sy, 200, { free: true });
  knockout(A); compose(P, A); finalize(P);
  return { plates: [{ col: P.col, map: P.map, z: 0, kind: KIND.silver, gloss: 0.08, bump: 5 }], seal: sl, edge: '#e6e6e4', seed: 1.4 };
}

// The instrument dial and the Founding card built on it are in cards20.js (the Creation of Adam hands, 16 Nov); the r19 hands-free dial no longer ships.
export const H13 = { plate, relief, finalize, page, knockout, compose, seal, foilNumber, FOIL, FOILG, METAL, KIND, inkC, gray, g2, MMPX, C30 };
