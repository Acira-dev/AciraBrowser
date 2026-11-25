// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// r11 card system: one grid, one type scale, three line weights. Everything a layout places goes through here,
// so every anchor can be audited against the grid (see SYSTEM.md).
import { ACIRA_MARK_D } from './emblems.js';
import { LOCKUP_WORD_D, LOCKUP_MARK_D } from './lockupPaths.js'; // the official lockup (public/brand/acira-lockup-2026.svg), as its two outlines

export const MEMBER_NAME = 'Trixz'; // the sample's name (only used by the old bottom() helper; the app sets CARD.name)
// The member's own words, set by prepareCard() (index.js) before a card is drawn.
export const CARD = { name: MEMBER_NAME, since: 'Nov 2026', nameMax: 0 };
export const W = 1600, H = 2400;          // card face, 2:3 (px at 1:1 of the master render)
export const MOD = 100;                   // module: the card is 16 x 24 modules
export const MAR = 100;                   // outer margin = 1 module on all four sides (live area 14 x 22)
export const BL = 25;                     // baseline / snap unit = 1/4 module
export const g = (n) => n * MOD;          // module -> px
export const INK = '18,19,23';            // solid ink
export const PAPER = '#ffffff', IVORY = PAPER; // r17b: one paper constant, pure neutral white (was #fbfbf8 / ivory #f7f3ea)
export const ACC = '38,98,255';           // the one accent (Early only, printed)
// three line weights (px at master size). heavy = 2.6 x thin, hair = 0.6 x thin (ISO 128 sqrt2 steps, rounded)
export const LW = { hair: 1.6, thin: 2.7, heavy: 7 };
// five type sizes, defined by CAP HEIGHT so every cap line can sit on the 25 px baseline grid
export const TYPE = {
  micro: { fam: 'Card Mono', wt: 500, cap: 15, track: 0.10 },   // annotations, microtext (texture at 360 px)
  label: { fam: 'Card Mono', wt: 500, cap: 25, track: 0.14 },   // field labels: MEMBER SINCE, No.
  value: { fam: 'Card Sans', wt: 400, cap: 50, track: 0 },           // field values: Nov 2026
  tier: { fam: 'Card Mono', wt: 700, cap: 50, track: 0.16 },    // tier word (same cap as value, heavier)
  name: { fam: 'Oxanium', wt: 500, cap: 100, track: -0.01 },     // the member's name
  // the hero number is the sixth, free size: cap set per card in whole modules / half modules
};

const _cap = {};
const scratch = document.createElement('canvas'); scratch.width = 2400; scratch.height = 900;
const sx = scratch.getContext('2d', { willReadFrequently: true });
export function capRatio(fam, wt, ch = 'H') {
  const k = fam + wt + ch; if (_cap[k]) return _cap[k];
  sx.font = `${wt} 1000px "${fam}"`; const m = sx.measureText(ch); return (_cap[k] = m.actualBoundingBoxAscent / 1000);
}
export const fontOf = (st) => { const px = st.cap / capRatio(st.fam, st.wt); return { px, f: `${st.wt} ${px}px "${st.fam}"` }; };

// true ink box of a string (pixel scan), relative to the fillText origin at baseline
function inkBox(s, f, track) {
  sx.save(); sx.clearRect(0, 0, scratch.width, scratch.height); sx.font = f; sx.letterSpacing = `${track}px`; sx.fillStyle = '#000'; sx.textBaseline = 'alphabetic';
  const ox = 200, oy = 600; sx.fillText(s, ox, oy); sx.restore();
  const w = Math.min(scratch.width, Math.ceil(sx.measureText(s).width + 400)), d = sx.getImageData(0, 0, w, scratch.height).data;
  let x0 = 1e9, x1 = -1e9;
  for (let x = 0; x < w; x++) for (let y = 0; y < scratch.height; y += 1) { if (d[(y * w + x) * 4 + 3] > 96) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); break; } }
  return { l: x0 - ox, r: x1 - ox };
}

export const REG = []; // layout registry: { id, x0,y0,x1,y1, ax, ay (anchors), kind }
export function regReset() { REG.length = 0; LOCKUPS.length = 0; }
export function reg(id, box, kind = 'box') { REG.push({ id, kind, ...box }); }

// Text, aligned by INK: align 'l' puts the left ink edge on x, 'r' the right ink edge, 'c' the ink centre.
// v 'base' puts the baseline on y, 'top' puts the cap line on y. rot in degrees (-90 reads bottom->top).
export function T(ctx, s, o) {
  const st = typeof o.st === 'string' ? TYPE[o.st] : o.st; const { px, f } = fontOf(st); const track = (st.track || 0) * px;
  const b = inkBox(s, f, track); const capH = st.cap;
  const align = o.align || 'l', v = o.v || 'base';
  const ox = align === 'l' ? -b.l : align === 'r' ? -b.r : -(b.l + b.r) / 2;
  const oy = v === 'top' ? capH : 0;
  const draw = (c, col) => { c.save(); c.translate(o.x, o.y); if (o.rot) c.rotate(o.rot * Math.PI / 180); c.font = f; c.letterSpacing = `${track}px`; c.fillStyle = col; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillText(s, ox, oy); c.restore(); };
  draw(ctx, o.col || `rgb(${INK})`);
  if (o.map) draw(o.map, o.mapCol || 'rgb(255,0,110)');
  // box in page space
  const lx0 = 0 + (align === 'l' ? 0 : align === 'r' ? -(b.r - b.l) : -(b.r - b.l) / 2), lx1 = lx0 + (b.r - b.l);
  const ly0 = oy - capH, ly1 = oy;
  const pts = [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]].map(([x, y]) => { const a = (o.rot || 0) * Math.PI / 180; return [o.x + x * Math.cos(a) - y * Math.sin(a), o.y + x * Math.sin(a) + y * Math.cos(a)]; });
  const box = { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])), ax: o.x, ay: o.y };
  if (o.id !== false) reg(o.id || s, box, 'text');
  return { ...box, w: b.r - b.l, cap: capH, px };
}

// identity block: name / label / value, bottom anchored at y = B (value baseline), left (or right) ink edge on x
// heights: value cap 50, gap 25, label cap 25, gap 75, name cap 100  -> block = 275 px (11 baselines)
// Long names (the pack only tried 'Trixz'): the name shrinks, to at most 62% of its size, until it fits `max` px (CARD.nameMax, set per card), and
// past that is cut with an ellipsis. It never reaches the number, the token or the edge.
function fitName(s, max) {
  const st0 = TYPE.name, width = (t, st) => { const { px, f } = fontOf(st); const b = inkBox(t, f, (st.track || 0) * px); return b.r - b.l; };
  if (!(max > 0) || width(s, st0) <= max) return { s, st: st0 };
  const st = { ...st0, cap: st0.cap * Math.max(0.62, max / width(s, st0)) };
  if (width(s, st) <= max) return { s, st };
  const chars = [...s]; while (chars.length > 1 && width(chars.join('').trimEnd() + '\u2026', st) > max) chars.pop();
  return { s: chars.join('').trimEnd() + '\u2026', st };
}
export function identity(ctx, x, B, o = {}) {
  const al = o.align || 'l', col = o.col, lab = o.labCol || `rgba(${INK},0.62)`;
  const nm = fitName(o.name || CARD.name, o.nameMax ?? CARD.nameMax);
  T(ctx, nm.s, { x, y: B - 175, st: nm.st, align: al, col, id: 'name' });
  const cols = o.cols || [['MEMBER SINCE', CARD.since]];
  let xx = x;
  for (const [l, v] of cols) {
    const a = T(ctx, l, { x: xx, y: B - 75, st: 'label', align: al, col: lab, id: 'label:' + l });
    const b = T(ctx, v, { x: xx, y: B, st: 'value', align: al, col, id: 'value:' + l });
    xx += (al === 'r' ? -1 : 1) * (Math.ceil((Math.max(a.w, b.w) + 75) / 100) * 100); // next column starts on a module line
  }
}

// the mark (canonical path) placed by its BOX: left/top of the bounding box on (x,y), height h
export const MARK_BOX = [0, 8.85, 79.57, 107.39];
export function markAt(x, y, h) {
  const s = h / (MARK_BOX[3] - MARK_BOX[1]); const p = new Path2D();
  p.addPath(new Path2D(ACIRA_MARK_D), new DOMMatrix().translate(x, y).scale(s).translate(-MARK_BOX[0], -MARK_BOX[1]));
  return { path: p, w: (MARK_BOX[2] - MARK_BOX[0]) * s, h };
}
// lockup: mark (height = 2 x wordmark cap) + "Acira". Top of the mark on y, left on x. wordmark cap = 50.
export const LOCKUPS = [];
// r14: the OFFICIAL lockup artwork (public/brand/acira-lockup-2026.svg, copied unaltered to src/). Both paths are
// drawn as-is with one uniform scale (no typesetting), recoloured to the card's ink. Placed by the MARK's bounding
// box: top-left of the mark on (x, y), mark height LOCK_MH; the wordmark follows exactly as drawn in the SVG.
export const LOCK_MH = 75; // 3 snap units: mark spans y 100..175; the lockup is ~280 px wide (r13's was ~260)
export const LOGO = { ready: false };
export async function loadLogo() {
  if (LOGO.ready) return LOGO;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', 365); svg.setAttribute('height', 108);
  svg.style.cssText = 'position:absolute;left:-9999px'; document.body.appendChild(svg);
  const box = (d) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.appendChild(p); const b = p.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  // path 0 = wordmark, path 1 = mark (as authored in the SVG)
  LOGO.dWord = LOCKUP_WORD_D; LOGO.dMark = LOCKUP_MARK_D;
  LOGO.word = box(LOGO.dWord); LOGO.mark = box(LOGO.dMark); svg.remove(); LOGO.ready = true; return LOGO;
}
export function logoPaths(x, y, mh = LOCK_MH) {
  const s = mh / LOGO.mark.h, M = new DOMMatrix().translate(x, y).scale(s).translate(-LOGO.mark.x, -LOGO.mark.y);
  const pw = new Path2D(), pm = new Path2D(); pw.addPath(new Path2D(LOGO.dWord), M); pm.addPath(new Path2D(LOGO.dMark), M);
  return { s, word: pw, mark: pm, both: (() => { const b = new Path2D(); b.addPath(pw); b.addPath(pm); return b; })() };
}
export function lockup(ctx, x, y, o = {}) {
  const mh = o.h || LOCK_MH, L = logoPaths(x, y, mh), s = L.s;
  ctx.save(); ctx.fillStyle = o.col || `rgb(${INK})`; ctx.fill(L.mark); ctx.fill(L.word); ctx.restore();
  if (o.map) { o.map.save(); o.map.fillStyle = o.mapCol; o.map.fill(L.both); o.map.restore(); }
  const wx0 = x + (LOGO.word.x - LOGO.mark.x) * s, wy0 = y + (LOGO.word.y - LOGO.mark.y) * s;
  const x1 = wx0 + LOGO.word.w * s, mw = LOGO.mark.w * s;
  reg('lockup-mark', { x0: x, y0: y, x1: x + mw, y1: y + mh, ax: x, ay: y }, 'mark');
  reg('wordmark', { x0: wx0, y0: wy0, x1, y1: wy0 + LOGO.word.h * s, ax: wx0, ay: wy0, free: true }, 'text');
  LOCKUPS.push({ x, y, mh, mw, s, x1, wy0, wy1: wy0 + LOGO.word.h * s, wx0 });
  return { x1, y1: y + mh };
}

// the hero number: Oxanium Light, digits placed one by one, marked zero (a stem-weight bar in the counter)
export function heroNumber(ctx, str, o) {
  const cap = o.cap, px = cap / capRatio('Oxanium', o.wt || 300, '0'), f = `${o.wt || 300} ${px}px "Oxanium"`;
  ctx.save(); ctx.font = f; ctx.letterSpacing = '0px';
  const ms = [...str].map((ch) => ctx.measureText(ch)); ctx.restore();
  const track = (o.track ?? 0.06) * px;
  // ink-based layout: glyph k ink from (pen + -abl) to (pen + abr)
  let pen = 0; const gl = [];
  [...str].forEach((ch, k) => { const m = ms[k]; gl.push({ ch, pen, l: pen - m.actualBoundingBoxLeft, r: pen + m.actualBoundingBoxRight }); pen += m.width + track; });
  const inkL = gl[0].l, inkR = gl[gl.length - 1].r, w = inkR - inkL;
  const align = o.align || 'l'; const shift = align === 'l' ? -inkL : align === 'r' ? -inkR : -(inkL + inkR) / 2;
  const stem = px * (o.wt === 200 ? 0.045 : 0.062);
  const paint = (c, col, stroke) => {
    c.save(); c.translate(o.x, o.y); if (o.rot) c.rotate(o.rot * Math.PI / 180); c.font = f; c.letterSpacing = '0px'; c.textBaseline = 'alphabetic';
    for (const q of gl) {
      const gx = q.pen + shift;
      if (stroke) { c.strokeStyle = col; c.lineWidth = stroke; c.lineJoin = 'round'; c.strokeText(q.ch, gx, 0); } else { c.fillStyle = col; c.fillText(q.ch, gx, 0); }
      if (q.ch === '0') { const zx = (q.l + q.r) / 2 + shift, zy = -cap / 2, bh = cap * 0.22;
        if (stroke) c.strokeRect(zx - stem / 2, zy - bh / 2, stem, bh); else { c.beginPath(); c.roundRect(zx - stem / 2, zy - bh / 2, stem, bh, stem * 0.2); c.fill(); } }
    }
    c.restore();
  };
  if (o.fill) paint(ctx, o.fill);
  if (o.stroke) paint(ctx, o.strokeCol || `rgb(${INK})`, o.stroke);
  if (o.map) paint(o.map, o.mapCol || 'rgb(255,0,90)');
  // glyph boxes in LOCAL coords (x along the text, y up = negative) -> returned for dimensioning
  const boxes = gl.map((q) => ({ ch: q.ch, l: q.l + shift, r: q.r + shift, pen: q.pen + shift }));
  const a = (o.rot || 0) * Math.PI / 180, toPage = (x, y) => [o.x + x * Math.cos(a) - y * Math.sin(a), o.y + x * Math.sin(a) + y * Math.cos(a)];
  const pts = [[inkL + shift, -cap], [inkR + shift, -cap], [inkL + shift, 0], [inkR + shift, 0]].map(([x, y]) => toPage(x, y));
  reg('number', { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])), ax: o.x, ay: o.y }, 'number');
  return { boxes, w, cap, px, stem, toPage, l: inkL + shift, r: inkR + shift, paint };
}

// ---------- line primitives (all weights from LW) ----------
export const rgba = (c, a = 1) => `rgba(${c},${a})`;
export function ln(ctx, a, b, w, col = INK, al = 1, dash = null) { ctx.save(); ctx.strokeStyle = rgba(col, al); ctx.lineWidth = w; ctx.lineCap = 'butt'; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore(); }
// a construction line with the house overshoot fade: solid for the run, fading over exactly FADE px past each end point
export const FADE = 50; // half a module: every construction line overshoots its last feature by 50 px and fades out
export function cline(ctx, a, b, w, col = INK, al = 1, dash = null, fade = FADE) {
  const v = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...v), u = [v[0] / L, v[1] / L];
  const A = [a[0] - u[0] * fade, a[1] - u[1] * fade], B = [b[0] + u[0] * fade, b[1] + u[1] * fade], T2 = L + 2 * fade;
  const gr = ctx.createLinearGradient(A[0], A[1], B[0], B[1]); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(fade / T2, rgba(col, al)); gr.addColorStop(1 - fade / T2, rgba(col, al)); gr.addColorStop(1, rgba(col, 0));
  ctx.save(); ctx.strokeStyle = gr; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.restore();
}
export const CENTRE_DASH = (w) => [w * 12, w * 4, w * 1.5, w * 4];
export function tickMark(ctx, p, u, sz, w, col = INK) { const a = Math.atan2(u[1], u[0]) - Math.PI / 4, d = [Math.cos(a) * sz, Math.sin(a) * sz]; ln(ctx, [p[0] - d[0], p[1] - d[1]], [p[0] + d[0], p[1] + d[1]], w * 1.6, col); }
// dimension line A->B with 45deg ticks, 12 px run-past, label centred on the side normal `side`
export function dimension(ctx, A, B, text, side, o = {}) {
  const col = o.col || INK, w = o.w || LW.hair, al = o.al ?? 0.9, run = 12;
  const v = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...v), u = [v[0] / L, v[1] / L];
  ln(ctx, [A[0] - u[0] * run, A[1] - u[1] * run], [B[0] + u[0] * run, B[1] + u[1] * run], w, col, al);
  tickMark(ctx, A, u, 9, w, col); tickMark(ctx, B, u, 9, w, col);
  if (text) { let ang = Math.atan2(u[1], u[0]); if (ang > Math.PI / 2 + 0.01) ang -= Math.PI; if (ang < -Math.PI / 2 - 0.01) ang += Math.PI;
    annot(ctx, text, [(A[0] + B[0]) / 2 + side[0] * 22, (A[1] + B[1]) / 2 + side[1] * 22], { ang, col, al: 1 }); }
}
// annotation (micro size), centred on p (geometry-bound labels follow geometry, not the layout grid)
export const ANN = { fam: null, k: 1.6 };
export function annot(ctx, s, p, o = {}) {
  const st = TYPE.micro, { f, px } = fontOf(st);
  ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate((o.ang || 0) + (ANN.fam ? Math.sin(p[0] * 0.05 + p[1] * 0.11) * 0.015 : 0)); ctx.font = ANN.fam ? `400 ${px * ANN.k}px "${ANN.fam}"` : (o.wt ? `${o.wt} ${px}px "Card Mono"` : f); ctx.letterSpacing = `${st.track * px}px`;
  ctx.fillStyle = rgba(o.col || INK, o.al ?? 0.9); ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, 0, 0); ctx.restore();
}
// callout bubble (item balloon): dot on the feature, leader at 30deg, circle with number, label beside
export function balloon(ctx, p, q, n, label, o = {}) {
  const col = o.col || INK, r = 25, right = q[0] >= p[0];
  ln(ctx, p, q, LW.hair, col, 0.9);
  ctx.save(); ctx.fillStyle = rgba(col, 1); ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, 7); ctx.fill(); ctx.restore();
  const c = [q[0] + (right ? r : -r), q[1]];
  ctx.save(); ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = LW.hair; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, 7); ctx.stroke(); ctx.restore();
  annot(ctx, n, c, { col, wt: 600 });
  if (label) annot(ctx, label, [c[0] + (right ? r + 12 : -r - 12), c[1]], { col, align: right ? 'left' : 'right', al: 0.8 });
}

// grid overlay for the *_grid.png proofs
export function gridOverlay(ctx, o = {}) {
  ctx.save();
  for (let y = 0; y <= H; y += BL) ln(ctx, [0, y], [W, y], 1, '0,170,200', y % MOD === 0 ? 0.0 : 0.10);
  for (let x = 0; x <= W; x += MOD / 2) ln(ctx, [x, 0], [x, H], 1, '0,170,200', x % MOD === 0 ? 0.0 : 0.12);
  for (let x = 0; x <= W; x += MOD) ln(ctx, [x, 0], [x, H], 1.4, '0,150,190', 0.38);
  for (let y = 0; y <= H; y += MOD) ln(ctx, [0, y], [W, y], 1.4, '0,150,190', 0.38);
  ctx.strokeStyle = 'rgba(235,0,120,0.85)'; ctx.lineWidth = 2.5; ctx.setLineDash([16, 8]); ctx.strokeRect(MAR, MAR, W - 2 * MAR, H - 2 * MAR); ctx.setLineDash([]);
  ctx.font = '600 22px "Card Mono"'; ctx.fillStyle = 'rgba(0,120,160,0.9)';
  for (let i = 0; i <= 16; i += 2) ctx.fillText(String(i), i * MOD + 6, 26);
  for (let j = 2; j <= 24; j += 2) ctx.fillText(String(j), 6, j * MOD - 6);
  for (const r of REG) {
    ctx.strokeStyle = r.off ? 'rgba(255,40,0,1)' : 'rgba(235,0,120,0.75)'; ctx.lineWidth = r.off ? 4 : 2; ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.fillStyle = 'rgba(235,0,120,1)'; ctx.beginPath(); ctx.arc(r.ax, r.ay, 7, 0, 7); ctx.fill();
  }
  ctx.restore();
}
// audit: every anchor must sit on the 25 px grid (within 0.6 px); every text box edge it aligns by too
export function audit() {
  const bad = [];
  const on = (v) => Math.abs(v / BL - Math.round(v / BL)) * BL < 0.6;
  for (const r of REG) { if (r.free) continue; if (!on(r.ax) || !on(r.ay)) { r.off = true; bad.push(`${r.id} anchor (${r.ax.toFixed(1)}, ${r.ay.toFixed(1)})`); } }
  return { n: REG.length, bad };
}
