// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// The Acira mark as an architect's construction plate.
// Every number below was MEASURED from public/acira-symbol.svg (the canonical path; see SKETCH_RESEARCH.md §5):
// path sampled at 8 points per cubic, straight runs grouped by direction (±3°), corner arcs fitted with a Kasa
// least-squares circle. Units are SVG user units "u" (mark height 98.5 u), y down.
import { ACIRA_MARK_D } from './emblems.js';

export const GEO = {
  C: [39.79, 58.12],                // centre of 180° rotational symmetry (midpoint of matching corner centres)
  box: [0, 8.85, 79.57, 107.39],    // x0 y0 x1 y1
  // the mark has exactly two edge directions: vertical (90°) and 30° (isometric). Vertical edges at x = C.x ± v
  vx: [39.79, 17.2, 5.39],          // x = 0 | 22.6 | 34.4 | 45.18 | 57.0 | 79.57
  // 30° edges: lines n·p = k with n = (-sin30, cos30); C sits at k = 30.4. Offsets from C:
  dk: [0.7, 22.17, 45.2],           // k = -14.8 | 8.3 | 29.7 | 31.1 | 52.6 | 75.6
  band: 22.6,                       // leg width (vertical legs) ; diagonal legs measure 22.9 perpendicular
  // corner arcs of the lower form [cx, cy, r, a0, a1 (deg, y-down, the drawn sweep of the true arc)]
  arcs: [
    { c: [8.35, 48.86], r: 8.35, tag: 'R8.4', kind: 'obtuse 120°' },
    { c: [20.99, 48.36], r: 1.57, tag: 'R1.6', kind: 'acute 60°' },
    { c: [30.31, 69.47], r: 7.59, tag: 'R7.6', kind: 'concave' },
    { c: [39.42, 75.99], r: 6.49, tag: 'R6.5', kind: 'notch' },
    { c: [43.44, 83.81], r: 2.0, tag: 'R2', kind: 'notch' },
    { c: [36.85, 99.05], r: 8.36, tag: 'R8.4', kind: 'acute 60°' },
    { c: [7.83, 83.0], r: 7.74, tag: 'R7.7', kind: 'obtuse 120°' },
  ],
};
const S30 = 0.5, C30 = Math.sqrt(3) / 2;
export const rot = (p) => [2 * GEO.C[0] - p[0], 2 * GEO.C[1] - p[1]];
export const ALL_ARCS = [...GEO.arcs.map((a) => ({ ...a, f: 0 })), ...GEO.arcs.map((a) => ({ ...a, c: rot(a.c), f: 1 }))];

// circumscribed circle about C, computed from the outline (true, not chosen)
let RC = 0;
(() => { const re = /-?\d*\.?\d+/g; const n = ACIRA_MARK_D.match(re).map(Number); for (let i = 0; i + 1 < n.length; i += 2) RC = Math.max(RC, Math.hypot(n[i] - GEO.C[0], n[i + 1] - GEO.C[1])); })();
export const R_CIRC = RC;

// ---------- drawing primitives (pixel space) ----------
const rgba = (c, a) => `rgba(${c},${a})`;
function fadeLine(ctx, a, b, lw, col, alpha, fade = 0.12, dash = null) {
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, rgba(col, 0)); g.addColorStop(fade, rgba(col, alpha)); g.addColorStop(1 - fade, rgba(col, alpha)); g.addColorStop(1, rgba(col, 0));
  ctx.save(); ctx.strokeStyle = g; ctx.lineWidth = lw; ctx.lineCap = 'butt'; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
}
function line(ctx, a, b, lw, col, alpha = 1, dash = null) {
  ctx.save(); ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = lw; ctx.lineCap = 'butt'; if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
}
// compass sweep: an arc whose ends fade out (overshoot of the instrument), drawn as short segments
function compass(ctx, c, r, a0, a1, lw, col, alpha, fadeFrac = 0.18) {
  const N = Math.max(24, Math.ceil(Math.abs(a1 - a0) * r / 3));
  ctx.save(); ctx.lineWidth = lw; ctx.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, tm = (t0 + t1) / 2;
    const e = Math.min(1, tm / fadeFrac, (1 - tm) / fadeFrac);
    ctx.strokeStyle = rgba(col, alpha * Math.max(0, e));
    const u0 = a0 + (a1 - a0) * t0, u1 = a0 + (a1 - a0) * t1;
    ctx.beginPath(); ctx.arc(c[0], c[1], r, u0, u1, a1 < a0); ctx.stroke();
  }
  ctx.restore();
}
function cross(ctx, p, sz, lw, col, alpha = 1) {
  line(ctx, [p[0] - sz, p[1]], [p[0] + sz, p[1]], lw, col, alpha); line(ctx, [p[0], p[1] - sz], [p[0], p[1] + sz], lw, col, alpha);
}
function dot(ctx, p, r, col, alpha = 1) { ctx.save(); ctx.fillStyle = rgba(col, alpha); ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
export const LABEL = { fam: 'Card Mono', k: 1, wt: null };
function label(ctx, s, p, px, col, alpha = 1, align = 'center', ang = 0, base = 'middle', wt = 500) {
  ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang + (LABEL.jit ? (Math.sin(p[0] * 0.07 + p[1] * 0.13) * 0.012) : 0)); ctx.font = `${LABEL.wt || wt} ${px * LABEL.k}px "${LABEL.fam}"`; ctx.letterSpacing = `${0.06 * px}px`;
  ctx.fillStyle = rgba(col, alpha); ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, 0, 0); ctx.restore();
}
// architectural tick (45° oblique stroke) terminator
function tick(ctx, p, dir, sz, lw, col) {
  const a = Math.atan2(dir[1], dir[0]) - Math.PI / 4; const d = [Math.cos(a) * sz, Math.sin(a) * sz];
  line(ctx, [p[0] - d[0], p[1] - d[1]], [p[0] + d[0], p[1] + d[1]], lw * 1.6, col, 1);
}
// linear dimension between feature points a, b (px), measured along unit dir, offset along normal nrm by off px
function dim(ctx, a, b, nrm, off, text, o) {
  const { thin, col, px } = o; const gap = 0.9 * px * 0.35, over = px * 0.55;
  const A = [a[0] + nrm[0] * off, a[1] + nrm[1] * off], B = [b[0] + nrm[0] * off, b[1] + nrm[1] * off];
  const sgn = Math.sign(off);
  for (const [p, q] of [[a, A], [b, B]]) line(ctx, [p[0] + nrm[0] * gap * sgn, p[1] + nrm[1] * gap * sgn], [q[0] + nrm[0] * over * sgn, q[1] + nrm[1] * over * sgn], thin, col, 0.75);
  const d = [B[0] - A[0], B[1] - A[1]]; const L = Math.hypot(d[0], d[1]); const u = [d[0] / L, d[1] / L];
  line(ctx, [A[0] - u[0] * over * 0.6, A[1] - u[1] * over * 0.6], [B[0] + u[0] * over * 0.6, B[1] + u[1] * over * 0.6], thin, col, 0.9);
  tick(ctx, A, u, px * 0.32, thin, col); tick(ctx, B, u, px * 0.32, thin, col);
  let ang = Math.atan2(u[1], u[0]); if (ang > Math.PI / 2 + 0.01) ang -= Math.PI; if (ang < -Math.PI / 2 - 0.01) ang += Math.PI;
  const m = [(A[0] + B[0]) / 2 + nrm[0] * px * 0.62 * sgn, (A[1] + B[1]) / 2 + nrm[1] * px * 0.62 * sgn];
  label(ctx, text, m, px, col, 1, 'center', ang);
}

// ---------- the plate ----------
// o: { cx, cy, s (px per u), density 0|1|2, ink 'r,g,b', accent 'r,g,b' | null, lw (thin px), px (label px),
//      fill 'css' | null, markAlpha, field: {x0,y0,x1,y1} in u (where construction lines may run), grid: bool,
//      title: {rows:[[k,v]...]} | null, skipMark }
export function drawConstruction(ctx, o) {
  const s = o.s, C = GEO.C, ink = o.ink || '18,20,26', acc = o.accent === undefined ? '38,98,255' : o.accent;
  const thin = o.lw || Math.max(1, s * 0.11), heavy = thin * 2.6, hair = thin * 0.6;
  const px = o.px || Math.max(10, s * 1.55);
  const P = (x, y) => [o.cx + s * (x - C[0]), o.cy + s * (y - C[1])];
  const F = o.field || { x0: -16, y0: -4, x1: 96, y1: 121 };
  const dens = o.density ?? 1, A = o.alpha ?? 1;
  ctx.save();
  // every line is a chord of the working circle (radius Rf about C), so the plate keeps the mark's C2 symmetry
  const Rf = o.clipR || 64, kc = -S30 * C[0] + C30 * C[1];
  const chordV = (x, R = Rf) => { const dx = x - C[0]; if (Math.abs(dx) >= R) return null; const h = Math.sqrt(R * R - dx * dx); return [P(x, C[1] - h), P(x, C[1] + h)]; };
  const chordK = (k, R = Rf) => { const dd = k - kc; if (Math.abs(dd) >= R) return null; const h = Math.sqrt(R * R - dd * dd); const f = [C[0] - S30 * dd, C[1] + C30 * dd]; return [P(f[0] - C30 * h, f[1] - S30 * h), P(f[0] + C30 * h, f[1] + S30 * h)]; };
  const chordH = (y, R = Rf) => { const dy = y - C[1]; if (Math.abs(dy) >= R) return null; const h = Math.sqrt(R * R - dy * dy); return [P(C[0] - h, y), P(C[0] + h, y)]; };
  const fl = (ch, w, a, fade, dash) => { if (ch) fadeLine(ctx, ch[0], ch[1], w, ink, a, fade, dash); };

  // 0. graph paper: the isometric lattice of quarter-legs (22.6 / 4 u) the mark sits on, anchored on C
  if (o.grid ?? dens >= 1) {
    const step = GEO.band / 4, ga = (o.gridAlpha ?? 0.1) * A, Rg = Rf * 0.94;
    for (let j = -14; j <= 14; j++) {
      const strong = j % 4 === 0 ? 1.9 : 1;
      fl(chordV(C[0] + j * step, Rg), hair, ga * strong, 0.3);
      fl(chordK(kc + j * step, Rg), hair, ga * strong, 0.3);
    }
  }

  // 1. centre lines (long-dash-dot, ISO 128 type 04) through the centre of symmetry: vertical + the 30° axis
  const cl = [thin * 10, thin * 3, thin * 1.4, thin * 3];
  if (dens >= 1) { fl(chordV(C[0], Rf * 1.04), hair * 1.3, 0.6 * A, 0.04, cl); fl(chordK(kc, Rf * 1.04), hair * 1.3, 0.6 * A, 0.04, cl); }

  // 2. construction lines: every true edge (6 verticals, 6 at 30°) extended across the working circle
  const cA = (o.conAlpha ?? 0.46) * A;
  for (const v of GEO.vx) for (const x of [C[0] - v, C[0] + v]) fl(chordV(x), thin, cA, 0.2);
  for (const d of GEO.dk) for (const k of [kc - d, kc + d]) fl(chordK(k), thin, cA, 0.2);
  // horizontal datums at the extremes (the bounding box), lighter
  if (dens >= 1) for (const y of [GEO.box[1], GEO.box[3]]) fl(chordH(y, Rf * 0.98), hair, 0.42 * A, 0.22);
  // the working circle itself, as a faint compass sweep
  if (dens >= 1) { const c = P(C[0], C[1]); compass(ctx, c, Rf * s, -2.2, -2.2 + Math.PI * 2.08, hair, ink, 0.22 * A, 0.04); }

  // 3. corner circles: the six outer fillets always; concave + notch fillets from medium; their centres crossed
  const outer = ALL_ARCS.filter((a) => a.r > 7.65 || a.tag === 'R7.7');
  const inner = ALL_ARCS.filter((a) => !outer.includes(a) && a.r > 3), small = ALL_ARCS.filter((a) => a.r <= 3);
  const circ = (a, w, al) => { const c = P(a.c[0], a.c[1]); const a0 = (a.c[0] * 7 + a.c[1] * 3) % 6.28; compass(ctx, c, a.r * s, a0, a0 + Math.PI * 2.1, w, ink, al, 0.06); cross(ctx, c, Math.max(4, s * 0.9), hair * 1.3, ink, 0.75 * A); };
  for (const a of outer) circ(a, thin * 0.95, 0.55 * A);
  if (dens >= 1) for (const a of inner) circ(a, thin * 0.8, 0.4 * A);
  if (dens >= 2) for (const a of small) { const c = P(a.c[0], a.c[1]); compass(ctx, c, a.r * s, 0, Math.PI * 2, hair * 1.2, ink, 0.6 * A, 0.001); cross(ctx, c, Math.max(3, s * 0.5), hair, ink, 0.6 * A); }
  // the circumscribed circle (dashed: a reference, not an edge)
  if (dens >= 1) { ctx.save(); ctx.setLineDash([thin * 5, thin * 3]); ctx.strokeStyle = rgba(ink, 0.34 * A); ctx.lineWidth = hair * 1.2; ctx.beginPath(); const c = P(C[0], C[1]); ctx.arc(c[0], c[1], R_CIRC * s, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }

  // 4. the mark: heavy outline over a pale fill
  if (!o.skipMark) {
    const path = new Path2D(); path.addPath(new Path2D(ACIRA_MARK_D), new DOMMatrix().translate(o.cx, o.cy).scale(s).translate(-C[0], -C[1]));
    if (o.fill) { ctx.save(); ctx.fillStyle = o.fill; ctx.fill(path); ctx.restore(); }
    ctx.save(); ctx.strokeStyle = rgba(ink, (o.markAlpha ?? 1) * A); ctx.lineWidth = heavy; ctx.lineJoin = 'round'; ctx.stroke(path); ctx.restore();
  }

  // 5. centre of symmetry: crossed circle + the 180° rotation arrow
  const cP = P(C[0], C[1]);
  ctx.save(); ctx.strokeStyle = rgba(ink, 0.9 * A); ctx.lineWidth = thin; ctx.beginPath(); ctx.arc(cP[0], cP[1], s * 1.6, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  cross(ctx, cP, s * 2.6, thin, ink, 0.9 * A);
  if (acc) dot(ctx, cP, Math.max(2.5, s * 0.42), acc, A);
  if (dens >= 1) {
    const rr = s * 7.2, a0 = -Math.PI * 0.95, a1 = a0 + Math.PI;
    ctx.save(); ctx.strokeStyle = rgba(ink, 0.8 * A); ctx.lineWidth = thin; ctx.beginPath(); ctx.arc(cP[0], cP[1], rr, a0, a1); ctx.stroke();
    const e = [cP[0] + Math.cos(a1) * rr, cP[1] + Math.sin(a1) * rr], tg = [-Math.sin(a1), Math.cos(a1)], nn = [Math.cos(a1), Math.sin(a1)], h = s * 1.3;
    ctx.fillStyle = rgba(ink, 0.9 * A); ctx.beginPath(); ctx.moveTo(e[0] + tg[0] * h, e[1] + tg[1] * h); ctx.lineTo(e[0] + nn[0] * h * 0.4, e[1] + nn[1] * h * 0.4); ctx.lineTo(e[0] - nn[0] * h * 0.4, e[1] - nn[1] * h * 0.4); ctx.fill(); ctx.restore();
    label(ctx, '180°', [cP[0] + Math.cos(a0 + Math.PI * 0.5) * (rr + px * 0.9), cP[1] + Math.sin(a0 + Math.PI * 0.5) * (rr + px * 0.9)], px * 0.9, ink, 0.95 * A);
  }

  // 6. accent points: tangent points where the outer fillets leave the vertical edges (x = edge, y = centre)
  if (acc && dens >= 1) {
    for (const a of ALL_ARCS.filter((q) => q.r > 7)) {
      const lowerEdges = [0, 22.6, 45.18], edges = a.f ? lowerEdges.map((x) => 2 * C[0] - x) : lowerEdges;
      let best = edges[0]; for (const e of edges) if (Math.abs(Math.abs(e - a.c[0]) - a.r) < Math.abs(Math.abs(best - a.c[0]) - a.r)) best = e;
      if (Math.abs(Math.abs(best - a.c[0]) - a.r) < 0.6) dot(ctx, P(best, a.c[1]), Math.max(2.2, s * 0.3), acc, A);
    }
  }
  ctx.restore();
  if (dens >= 1) dimensions(ctx, P, s, thin, hair, ink, acc, px, dens, A, o);
}

// a dimension line between pixel points A and B (ticks, slight run-past), label on side `side` (unit normal)
function dimLine(ctx, A, B, text, side, d) {
  const { thin, col, px, alpha } = d; const v = [B[0] - A[0], B[1] - A[1]]; const L = Math.hypot(v[0], v[1]); const u = [v[0] / L, v[1] / L];
  const run = px * 0.5;
  line(ctx, [A[0] - u[0] * run, A[1] - u[1] * run], [B[0] + u[0] * run, B[1] + u[1] * run], thin, col, 0.9 * alpha);
  tick(ctx, A, u, px * 0.34, thin, col); tick(ctx, B, u, px * 0.34, thin, col);
  let ang = Math.atan2(u[1], u[0]); if (ang > Math.PI / 2 + 0.01) ang -= Math.PI; if (ang < -Math.PI / 2 - 0.01) ang += Math.PI;
  const m = [(A[0] + B[0]) / 2 + side[0] * px * 0.75, (A[1] + B[1]) / 2 + side[1] * px * 0.75];
  label(ctx, text, m, px, col, alpha, 'center', ang);
}
// short extension line from a feature point toward a dimension line (gap at the object, overshoot past the line)
function ext(ctx, from, to, d) {
  const v = [to[0] - from[0], to[1] - from[1]]; const L = Math.hypot(v[0], v[1]); const u = [v[0] / L, v[1] / L];
  const gap = d.px * 0.35, over = d.px * 0.55;
  line(ctx, [from[0] + u[0] * gap, from[1] + u[1] * gap], [to[0] + u[0] * over, to[1] + u[1] * over], d.thin * 0.8, d.col, 0.7 * d.alpha);
}

// radius callout: dot on the true arc, leader out along `dir`, shoulder, text
function callout(ctx, P, a, dir, len, text, d, acc) {
  const p = [a.c[0] + dir[0] * a.r, a.c[1] + dir[1] * a.r];
  const q = [p[0] + dir[0] * len, p[1] + dir[1] * len];
  const sh = Math.sign(dir[0]) || 1;
  const Pp = P(p[0], p[1]), Pq = P(q[0], q[1]), Pr = [Pq[0] + sh * d.px * 1.1, Pq[1]];
  line(ctx, Pp, Pq, d.thin, d.col, 0.85 * d.alpha); line(ctx, Pq, Pr, d.thin, d.col, 0.85 * d.alpha);
  dot(ctx, Pp, Math.max(2, d.px * 0.14), acc || d.col, d.alpha);
  label(ctx, text, [Pr[0] + sh * d.px * 0.3, Pr[1]], d.px, d.col, d.alpha, sh > 0 ? 'left' : 'right');
}

function dimensions(ctx, P, s, thin, hair, ink, acc, px, dens, A, o) {
  const d = { thin, col: ink, px, alpha: A };
  const [x0, y0, x1, y1] = GEO.box, C = GEO.C;
  const up = [0, -1], dn = [0, 1], rt = [1, 0], lf = [-1, 0];
  // top: chain on the upper form's legs + overall width
  const yA = y0 - 6, yB = y0 - 12.5;
  dimLine(ctx, P(34.4, yA), P(57.0, yA), '22.6', up, d);
  dimLine(ctx, P(57.0, yA), P(x1, yA), '22.6', up, d);
  ext(ctx, P(0, 49.2), P(0, yB), d);
  dimLine(ctx, P(x0, yB), P(x1, yB), '79.6', up, d);
  // right: overall height between the two horizontal datums
  const xR = x1 + 8;
  ext(ctx, P(48, y0), P(xR, y0), d); ext(ctx, P(40, y1), P(xR, y1), d);
  dimLine(ctx, P(xR, y0), P(xR, y1), '98.5', rt, d);
  // bottom: the overlap of the two forms (the interlock), hung off the construction verticals
  const yC = y1 + 7;
  dimLine(ctx, P(34.4, yC), P(45.18, yC), '10.8', dn, d);
  // 30° angle at the left: horizontal reference + arc to the extended top edge of the lower form (k = 29.7)
  const kTop = -S30 * C[0] + C30 * C[1] - GEO.dk[0];
  const vx = -9, vy = (kTop + S30 * vx) / C30, V = P(vx, vy), rA = 13 * s;
  line(ctx, V, P(vx + 17, vy), thin, ink, 0.8 * A);
  ctx.save(); ctx.strokeStyle = rgba(ink, 0.9 * A); ctx.lineWidth = thin; ctx.beginPath(); ctx.arc(V[0], V[1], rA, 0, Math.PI / 6); ctx.stroke(); ctx.restore();
  tick(ctx, [V[0] + rA, V[1]], [0, 1], px * 0.3, thin, ink); tick(ctx, [V[0] + rA * C30, V[1] + rA * S30], [-S30, C30], px * 0.3, thin, ink);
  label(ctx, '30°', [V[0] + (rA + px * 1.4) * Math.cos(Math.PI / 12), V[1] + (rA + px * 1.4) * Math.sin(Math.PI / 12)], px, ink, A);
  // perpendicular leg width of a 30° leg (lower form), off to the lower-left, measured along the normal
  const k1 = kTop + GEO.dk[1] + GEO.dk[0], k2 = k1 + 23.05; // 52.6 and 75.65
  if (dens >= 2) {
    const px0 = -6, p1 = [px0, (k1 + S30 * px0) / C30], p2 = [p1[0] - S30 * (k2 - k1), p1[1] + C30 * (k2 - k1)];
    dimLine(ctx, P(p1[0], p1[1]), P(p2[0], p2[1]), '22.9', [-C30, -S30], d);
  }
  // radius callouts on the true fillets
  const ar = GEO.arcs, n = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const R = (a) => ({ ...a, c: rot(a.c) }), neg = (v) => [-v[0], -v[1]];
  callout(ctx, P, ar[0], n([-0.5, -0.866]), 7, 'R8.4', d, acc);
  callout(ctx, P, ar[6], n([-0.866, 0.5]), 6, 'R7.7', d, acc);
  callout(ctx, P, R(ar[5]), n([-0.5, -0.866]), 6, 'R8.4', d, acc);
  if (dens >= 2) {
    callout(ctx, P, ar[5], n([0.5, 0.866]), 6, 'R8.4', d, acc);
    callout(ctx, P, R(ar[6]), neg(n([-0.866, 0.5])), 6, 'R7.7', d, acc);
    callout(ctx, P, R(ar[0]), neg(n([-0.5, -0.866])), 7, 'R8.4', d, acc);
    callout(ctx, P, ar[1], n([0.6, -0.8]), 9, 'R1.6', d, acc);
    callout(ctx, P, R(ar[4]), n([0.3, -0.95]), 9, 'R2', d, acc);
  }
}

// title block + scale bar + note (rich plates). rect = [x, y, w, h] px. rows = [[label, value], ...]
export function titleBlock(ctx, rect, rows, o) {
  const [x, y, w, h] = rect, ink = o.ink || '18,20,26', thin = o.lw, px = o.px, A = o.alpha ?? 1;
  ctx.save(); ctx.strokeStyle = rgba(ink, 0.85 * A); ctx.lineWidth = thin * 1.6; ctx.strokeRect(x, y, w, h);
  const rh = h / rows.length;
  rows.forEach(([k, v], i) => {
    const yy = y + i * rh; if (i) line(ctx, [x, yy], [x + w, yy], thin * 0.8, ink, 0.6 * A);
    const kw = w * 0.36; line(ctx, [x + kw, yy], [x + kw, yy + rh], thin * 0.8, ink, 0.6 * A);
    label(ctx, k, [x + px * 0.6, yy + rh / 2], px * 0.78, ink, 0.6 * A, 'left');
    label(ctx, v, [x + kw + px * 0.6, yy + rh / 2], px, ink, A, 'left');
  });
  ctx.restore();
}
export function scaleBar(ctx, x, y, s, units, o) {
  // alternating filled/open segments of 5 u, labelled 0 / 10 / 20 ...
  const ink = o.ink || '18,20,26', hgt = o.px * 0.45, A = o.alpha ?? 1;
  ctx.save(); ctx.lineWidth = o.lw; ctx.strokeStyle = rgba(ink, A); ctx.fillStyle = rgba(ink, 0.85 * A);
  for (let i = 0; i < units / 5; i++) { const xx = x + i * 5 * s; if (i % 2 === 0) ctx.fillRect(xx, y, 5 * s, hgt); ctx.strokeRect(xx, y, 5 * s, hgt); }
  for (let u = 0; u <= units; u += 10) label(ctx, String(u), [x + u * s, y + hgt + o.px * 0.8], o.px * 0.8, ink, A);
  label(ctx, 'u', [x + units * s + o.px * 0.9, y + hgt / 2], o.px * 0.8, ink, A);
  ctx.restore();
}
export function regMark(ctx, p, r, o) {
  const ink = o.ink || '18,20,26';
  ctx.save(); ctx.strokeStyle = rgba(ink, o.alpha ?? 0.8); ctx.lineWidth = o.lw; ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.55, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p[0] - r, p[1]); ctx.lineTo(p[0] + r, p[1]); ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0], p[1] + r); ctx.stroke(); ctx.restore();
}
export function cropMarks(ctx, x0, y0, x1, y1, len, off, o) {
  const ink = o.ink || '18,20,26';
  ctx.save(); ctx.strokeStyle = rgba(ink, o.alpha ?? 0.7); ctx.lineWidth = o.lw; ctx.beginPath();
  for (const [x, y, sx, sy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
    ctx.moveTo(x + sx * off, y); ctx.lineTo(x + sx * (off + len), y); ctx.moveTo(x, y + sy * off); ctx.lineTo(x, y + sy * (off + len));
  }
  ctx.stroke(); ctx.restore();
}
export { label as drawLabel, fadeLine, compass, cross, dot, line as drawLine, dimLine, tick };
