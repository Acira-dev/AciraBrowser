// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// r14: Trusted = T3 "Trust rings" finished; Founding = the r13 F1 inlay composition in non-gold material studies.
// Early, Contributor and Insider A are unchanged (cards12.js); only the lockup changed (sys12.js, official SVG).
import { W, H, INK, PAPER, IVORY, LW, T, identity, lockup, markAt, heroNumber, ln, rgba, reg, REG } from './sys12.js';
import { drawConstruction, GEO } from './sketch.js';
import { mk, TIERS } from './art10.js';
import { H13 } from './cards12.js';
const { relief, finalize, page, knockout, compose, seal, foilNumber, FOIL, FOILG, METAL, KIND, inkC, gray, g2 } = H13;
const TAU = Math.PI * 2;

// =================================================================================================================
// TRUSTED CONTRIBUTOR: T3 "Trust rings" (final)
// A measured protractor plate pivoting on the seal at (300, 1700). A turned blue-steel band (R 1150..1290) carries
// the degree scale cut clean through to paper on its outer edge, figures on its inner edge; the number rides the
// arc in the same steel. Radial rays every 10 deg (every 30 deg heavier), three hairline rings.
// =================================================================================================================
const T_C = [300, 1700], T_R0 = 1150, T_R1 = 1290, BLUE_KEY = '14,26,64';
export const TRUSTED_RING = T_C;
// r16: o.id = { x, B, align, labCol } moves the identity block; o.cell = y of a title-cell rule (rays stop on it);
// o.tierY = cap lines of the two tier-word lines (default [100, 175])
export function trusted(o = {}) {
  const tier = 'trusted', { P, A } = page(PAPER); const c = T_C, R0 = T_R0, R1 = T_R1;
  const P2 = (r, t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  const ring = (ctx, r, w, col, al = 1) => { ctx.save(); ctx.strokeStyle = rgba(col, al); ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, TAU); ctx.stroke(); ctx.restore(); };
  // drawing layer: three rings + rays (stop 25 px short of the band; start on the 260 ring)
  for (const r of [260, 520, 760]) ring(A.c, r, LW.hair, INK, 0.7);
  for (let a = 0; a < 360; a += 10) { const t = a * Math.PI / 180; ln(A.c, P2(260, t), P2(R0 - 25, t), a % 30 === 0 ? LW.thin * 0.7 : LW.hair, INK, a % 30 === 0 ? 0.55 : 0.28); }
  // the band (2 pi exactly: r13 used 7 rad and the even-odd overlap left a wedge at 0 deg)
  const band = (ctx) => { ctx.beginPath(); ctx.arc(c[0], c[1], R1, 0, TAU); ctx.moveTo(c[0] + R0, c[1]); ctx.arc(c[0], c[1], R0, 0, TAU, true); };
  for (const [cc, col] of [[P.c, METAL.blue], [P.m, FOIL]]) { cc.save(); cc.fillStyle = col; band(cc); cc.fill('evenodd'); cc.restore(); }
  relief(P, 150, 2, (h) => { band(h); h.fill('evenodd'); });
  // cuts (through foil to paper, and sunk in the height map): outer scale 1 / 5 / 10 deg, an inner hairline, figures
  const cut = (fn) => { for (const cc of [P.c, P.m]) { cc.save(); cc.globalCompositeOperation = 'destination-out'; fn(cc); cc.restore(); } P.h.save(); P.h.strokeStyle = gray(118); P.h.fillStyle = gray(118); fn(P.h); P.h.restore(); };
  cut((cc) => { cc.lineCap = 'butt';
    for (let a = 0; a < 360; a++) { const t = a * Math.PI / 180, maj = a % 10 === 0, mid = a % 5 === 0;
      cc.lineWidth = maj ? 4.5 : mid ? 3 : 2.2; cc.beginPath(); cc.moveTo(...P2(R1 - 12, t)); cc.lineTo(...P2(R1 - (maj ? 76 : mid ? 56 : 38), t)); cc.stroke(); }
    cc.lineWidth = 2; cc.beginPath(); cc.arc(c[0], c[1], R1 - 12, 0, TAU); cc.stroke();
    cc.beginPath(); cc.arc(c[0], c[1], R0 + 12, 0, TAU); cc.stroke(); });
  cut((cc) => { cc.font = '700 27px "Card Mono"'; cc.textAlign = 'center'; cc.textBaseline = 'middle'; cc.letterSpacing = '1px';
    for (let a = -90; a <= 40; a += 10) { const t = a * Math.PI / 180, p = P2(R0 + 40, t); cc.save(); cc.translate(...p); cc.rotate(t + Math.PI / 2); cc.fillText(String(a + 90), 0, 0); cc.restore(); } });
  P.c.save(); P.c.globalCompositeOperation = 'destination-over'; P.c.fillStyle = PAPER; P.c.fillRect(0, 0, W, H); P.c.restore();
  P.m.save(); P.m.globalCompositeOperation = 'destination-over'; P.m.fillStyle = 'rgb(0,0,128)'; P.m.fillRect(0, 0, W, H); P.m.restore();
  for (const r of [R0, R1]) ring(P.c, r, 2, BLUE_KEY, 1);
  // the number on the arc: glyph ink centres spaced by their real ink widths on the mid radius; run centred on -55 deg
  // spacing is measured on the BASELINE radius (the tight side of the arc), so feet never crowd and heads open up
  const NUM = TIERS.trusted.num, cap = 230, rN = 865, rm = rN, gap = cap * 0.3;
  const sc = g2(mk()); const wd = [...NUM].map((ch) => { const n = heroNumber(sc, ch, { x: 0, y: 0, cap, align: 'c', wt: 400, fill: '#000' }); REG.pop(); return n.w; });
  const span = wd.reduce((s, w) => s + w, 0) + gap * (NUM.length - 1);
  let s0 = -span / 2; const angs = wd.map((w) => { const a = -55 * Math.PI / 180 + (s0 + w / 2) / rm; s0 += w + gap; return a; });
  const glyph = (cc, k, o) => { cc.save(); cc.translate(...P2(rN, angs[k])); cc.rotate(angs[k] + Math.PI / 2); heroNumber(cc, NUM[k], { x: 0, y: 0, cap, align: 'c', wt: 400, ...o }); REG.pop(); cc.restore(); };
  for (let k = 0; k < NUM.length; k++) {
    glyph(P.c, k, { fill: METAL.blue }); glyph(P.m, k, { fill: FOIL }); glyph(P.c, k, { stroke: 3.2, strokeCol: rgba(BLUE_KEY, 1) });
    P.h.save(); P.h.filter = 'blur(2px)'; glyph(P.h, k, { fill: gray(104), stroke: 14, strokeCol: gray(104) }); P.h.restore();
    // keep the rays and rings off the digits (25 px clear)
    for (const cc of [A.c, A.m]) { cc.save(); cc.globalCompositeOperation = 'destination-out'; glyph(cc, k, { fill: '#000', stroke: 50, strokeCol: '#000' }); cc.restore(); }
  }
  reg('number-arc', { x0: c[0], y0: c[1] - rN - cap, x1: c[0] + rN + cap, y1: c[1], ax: c[0], ay: c[1], free: true }, 'number');
  lockup(P.c, 100, 100);
  const ty = o.tierY || [100, 175], tst = o.tierSt || 'tier';
  T(P.c, 'TRUSTED', { x: 1500, y: ty[0], st: tst, v: 'top', align: 'r' }); T(P.c, 'CONTRIBUTOR', { x: 1500, y: ty[1], st: tst, v: 'top', align: 'r' });
  if (o.cell) { // a drafting title cell: the rays and rings stop on a hairline rule; the cell is clear for the identity
    const yC = o.cell, xr = c[0] + Math.sqrt(R0 * R0 - (yC - c[1]) ** 2) - 25;
    for (const cc of [A.c, A.m]) { cc.save(); cc.globalCompositeOperation = 'destination-out'; cc.fillRect(0, yC, W, H - yC); cc.restore(); }
    ln(P.c, [100, yC], [xr, yC], LW.hair * 1.4, INK, 0.9);
    if (o.cellWall) ln(P.c, [o.cellWall, yC], [o.cellWall, 2300], LW.hair * 1.4, INK, 0.9);
  }
  const id = o.id || { x: 700, B: 2300 };
  identity(P.c, id.x, id.B, { align: id.align, labCol: id.labCol });
  const sl = seal(P, tier, c[0], c[1], 220, { ring: inkC(0.9), free: true });
  knockout(A); compose(P, A); finalize(P, 6);
  return { plates: [{ col: P.col, map: P.map, z: 0, kind: KIND.blue, gloss: 0.1, bump: 6, ring: c, metal: [0.075, 0.15, 0.40], hi: [0.62, 0.78, 1.0] }], seal: sl, edge: '#dfe2e8', seed: 2.4 };
}

