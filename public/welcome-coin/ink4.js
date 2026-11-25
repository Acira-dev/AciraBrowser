// Beta 14 member cards: the rank token's own number on its rim. Ported from his seal pack (the reference sample, round r5) the way earlier work ships the member's own seal (a QA rig):
// his renderer, and ONLY the words of the rim legend change, in place (each replaced word centred where his word was). No globals, no test harness; the legend font is the approved stand-in for his Windows-only Bahnschrift.
// Round 4 engraving layers for the H seal.
//   E (enamel): debossed grooves filled with black enamel (gold inlay on Founding)
//   M (metal):  raised polished metal relief: emblem edge, studs (domed via soft alpha)
// Unit coords: coin radius = 1, y up. White on transparent.
import { starPoints, sparklePath, drawMark } from './emblems.js';

let RELABEL = null;
/** The words to put on a legend in place of his (a function from his words to the new ones, or null for none). */
export const setRelabel = (fn) => { RELABEL = fn; };
export const LEGEND = {
  contributor: ['ACIRA', 'CONTRIBUTOR', 'VERIFIED MEMBER', 'EST. 2026', 'AUTHENTIC'],
  early: ['ACIRA', 'EARLY MEMBER', 'BETA 14 \u00b7 BEFORE 1.0', 'EST. 2026'],
  trusted: ['ACIRA', 'TRUSTED CONTRIBUTOR', 'VERIFIED', 'EST. 2026', 'AUTHENTIC'],
  insider: ['ACIRA', 'INSIDER', 'CERTIFIED MEMBER', 'No. 0001', 'EST. 2026', 'AUTHENTIC'],
  founding: ['ACIRA', 'FOUNDING CONTRIBUTOR', 'No. 0001', 'EST. 2026', 'AUTHENTIC'],
};
const TAU = Math.PI * 2;
function circle(x, r, lw) { x.beginPath(); x.arc(0, 0, r, 0, TAU); x.lineWidth = lw; x.stroke(); }
function poly(x, pts) { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); }
function ray(x, a, r0, r1, cx = 0, cy = 0) { x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
function diamond(x, s) { x.beginPath(); x.moveTo(0, s); x.lineTo(s * 0.62, 0); x.lineTo(0, -s); x.lineTo(-s * 0.62, 0); x.closePath(); x.fill(); }
function stud(x, cx, cy, r) { // domed: soft alpha falls off to the edge -> height gradient
  const g = x.createRadialGradient(cx - r * 0.25, cy + r * 0.25, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.save(); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); x.restore();
}

// Legend on a circle: pair kerning, fixed tracking, diamond separators.
// Groups whose centre falls on the lower half are set to read left-to-right along the bottom
// (baseline on the outside, letters pointing to the centre), as on coins and casebacks.
function ringText(x, S, groups, R, cap, opts = {}) {
  x.save();
  x.setTransform(S / 2, 0, 0, S / 2, S / 2, S / 2); // y-down
  const K = 1000;
  x.font = `${opts.weight || 600} ${Math.round(cap * 1.36 * K)}px "Card Legend"`;
  try { x.fontStretch = opts.stretch || 'semi-condensed'; } catch (e) {}
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  const w = (s) => x.measureText(s).width / K;
  const track = cap * (opts.track ?? 0.22);
  const gs = groups.map((g) => {
    const chars = [...g]; const gl = [];
    for (let i = 0; i < chars.length; i++) {
      let adv = w(chars[i]);
      if (i < chars.length - 1) adv += w(chars[i] + chars[i + 1]) - w(chars[i]) - w(chars[i + 1]);
      gl.push({ c: chars[i], adv: adv + (chars[i] === ' ' ? 0 : track), draw: w(chars[i]) });
    }
    return { gl, len: gl.reduce((a, b) => a + b.adv, 0) };
  });
  const circ = TAU * R; const total = gs.reduce((a, b) => a + b.len, 0);
  const sep = (circ - total) / gs.length;
  if (sep < cap * 2.2) { x.restore(); return ringText(x, S, groups, R, cap * 0.95, opts); }
  // arc start of each group (arc length measured clockwise from 12 o'clock), first group centred at top
  let s = -gs[0].len / 2;
  gs.forEach((g) => { g.s0 = s; s += g.len + sep; g.sepAt = s - sep / 2; });
  if (opts.centers) { // explicit group centres (degrees clockwise from 12 o'clock); separators midway
    gs.forEach((g, i) => { g.s0 = (opts.centers[i] * Math.PI / 180) * R - g.len / 2; });
    gs.forEach((g, i) => { const n = gs[(i + 1) % gs.length]; let e = g.s0 + g.len, b = n.s0; if (b < e) b += circ; g.sepAt = (e + b) / 2; });
  }
  { const swap = RELABEL && RELABEL(groups); // earlier work's in-place hook: re-letter the words that changed, each centred where his word was
    if (swap) gs.forEach((g, i) => { if (swap[i] === groups[i]) return; const mid = g.s0 + g.len / 2, chars = [...swap[i]], gl = [];
      for (let j = 0; j < chars.length; j++) { let adv = w(chars[j]); if (j < chars.length - 1) adv += w(chars[j] + chars[j + 1]) - w(chars[j]) - w(chars[j + 1]); gl.push({ c: chars[j], adv: adv + (chars[j] === ' ' ? 0 : track), draw: w(chars[j]) }); }
      g.gl = gl; g.len = gl.reduce((a, b) => a + b.adv, 0); g.s0 = mid - g.len / 2; }); }
  const ang = (arc) => -Math.PI / 2 + arc / R; // y-down angle
  const bottom = (g) => Math.sin(ang(g.s0 + g.len / 2)) > 0.3;
  for (const g of gs) {
    if (!bottom(g)) {
      let a0 = g.s0;
      for (const it of g.gl) {
        const a = ang(a0 + it.adv / 2);
        x.save(); x.translate(Math.cos(a) * R, Math.sin(a) * R); x.rotate(a + Math.PI / 2); x.scale(1 / K, 1 / K);
        x.fillText(it.c, -(it.draw * K) / 2, (cap / 2) * K); x.restore();
        a0 += it.adv;
      }
    } else {
      // reading order runs counter-clockwise along the bottom: start at the group's far end
      let a0 = g.s0 + g.len;
      for (const it of g.gl) {
        const a = ang(a0 - it.adv / 2);
        x.save(); x.translate(Math.cos(a) * R, Math.sin(a) * R); x.rotate(a - Math.PI / 2); x.scale(1 / K, 1 / K);
        x.fillText(it.c, -(it.draw * K) / 2, (cap / 2) * K); x.restore();
        a0 -= it.adv;
      }
    }
    if (opts.sepFn) { const a = ang(g.sepAt); opts.sepFn(Math.cos(a) * R, Math.sin(a) * R, a); }
    else { const a = ang(g.sepAt); x.save(); x.translate(Math.cos(a) * R, Math.sin(a) * R); x.rotate(a); diamond(x, cap * 0.2); x.restore(); }
  }
  x.restore();
}

// ---------- r5 Early Member: a finer dawn ----------
export const EARLY_PICK = 'earlyB';
const HZ = -0.04, SR = 0.2; // horizon height, sun radius
function lens(x, x0, x1, y, w) { // a horizon line that tapers to hairline ends
  x.beginPath(); x.moveTo(x0, y); x.quadraticCurveTo(0, y + w, x1, y); x.quadraticCurveTo(0, y - w, x0, y); x.closePath(); x.fill();
}
function earlyDawn(x, guill) {
  const L = 0.0055;
  // sun: engraved concentric bands
  // A: black-enamel sun with bright metal bands cut through; B: polished raised sun with enamel grooves
  x.save(); if (!guill) x.globalCompositeOperation = 'destination-out'; x.lineWidth = L * (guill ? 0.6 : 0.5);
  for (let k = guill ? 0 : 1; k <= 5; k++) { x.beginPath(); x.arc(0, HZ, SR - k * 0.033, 0, Math.PI); if (guill && k === 0) { x.closePath(); x.lineWidth = 0.011; } else if (guill) x.lineWidth = L * 0.75; x.stroke(); } x.restore();
  x.lineCap = 'round';
  if (!guill) {
    // tier 1: long fine rays, graded; tier 2: short rays between them
    const N = 29;
    x.lineWidth = 0.0027; x.beginPath();
    for (let i = 0; i < N; i++) { const a = 0.1 + (i * (Math.PI - 0.2)) / (N - 1); ray(x, a, SR + 0.05, SR + 0.05 + [0.25, 0.15, 0.2, 0.15][i % 4], 0, HZ); } x.stroke();
    x.lineWidth = 0.0017; x.beginPath();
    for (let i = 0; i < N - 1; i++) { const a = 0.1 + ((i + 0.5) * (Math.PI - 0.2)) / (N - 1); ray(x, a, SR + 0.05, SR + 0.105, 0, HZ); } x.stroke();
  } else {
    // guilloch\u00e9 sunburst: dense hairlines with 12 bold rays
    x.lineWidth = 0.0011; x.beginPath();
    for (let i = 0; i <= 120; i++) { const a = 0.04 + (i * (Math.PI - 0.08)) / 120; ray(x, a, SR + 0.04, 0.6, 0, HZ); } x.stroke();
    x.lineWidth = 0.0046; x.beginPath();
    for (let i = 0; i < 13; i++) { const a = 0.12 + (i * (Math.PI - 0.24)) / 12; ray(x, a, SR + 0.04, i % 2 ? 0.5 : 0.56, 0, HZ); } x.stroke();
    // a fine arc closing the sky
    x.lineWidth = 0.0018; x.beginPath(); x.arc(0, HZ, 0.62, 0.03, Math.PI - 0.03); x.stroke();
  }
  // fine dotted arc above the rays
  const dr = guill ? 0.655 : 0.555;
  for (let i = 0; i <= 44; i++) { const a = 0.16 + (i * (Math.PI - 0.32)) / 44; x.beginPath(); x.arc(Math.cos(a) * dr, HZ + Math.sin(a) * dr, i % 4 === 0 ? 0.0058 : 0.0034, 0, TAU); x.fill(); }
  // a few tiny stars
  const stars = guill ? [] :[[-0.43, 0.43, 0.036], [0.47, 0.37, 0.028], [0.27, 0.56, 0.019], [-0.2, 0.6, 0.015]];
  for (const [sx, sy, s] of stars) { x.save(); x.translate(sx, sy); sparklePath(x, s, 0.16); x.fill(); x.restore(); }
  // double horizon, tapered to hairline ends
  lens(x, -0.64, 0.64, HZ, 0.012);
  lens(x, -0.56, 0.56, HZ - 0.03, 0.004);
  // reflection: the sun's glitter on still water, broken bars shrinking downward
  for (let k = 0; k < 8; k++) {
    const y = HZ - 0.07 - k * 0.036; const half = SR * (1.02 - k * 0.11); x.lineWidth = L * (1.0 - k * 0.08);
    const gaps = [[-0.3, -0.22], [0.35, 0.42], [-0.6, -0.55], [0.05, 0.1]][k % 4];
    x.beginPath(); x.moveTo(-half, y); x.lineTo(half * gaps[0], y); x.moveTo(half * gaps[1], y); x.lineTo(half, y); x.stroke();
  }
  // delicate reflected horizon lines across the water, parted where the glitter is
  x.lineWidth = 0.0013;
  for (let k = 0; k < 4; k++) {
    const y = HZ - 0.088 - k * 0.072; const w = 0.5 - k * 0.07; const g = SR * (1.0 - (k * 2 + 0.5) * 0.11) + 0.035;
    x.beginPath(); x.moveTo(-w, y); x.lineTo(-g, y); x.moveTo(g, y); x.lineTo(w, y); x.stroke();
  }
  // refined inner ring: a hairline, a bead row and a finer hairline
  circle(x, 0.685, L * 0.45);
  for (let i = 0; i < 120; i++) { const a = (i / 120) * TAU; x.beginPath(); x.arc(Math.cos(a) * 0.708, Math.sin(a) * 0.708, 0.0042, 0, TAU); x.fill(); }
  circle(x, 0.731, L * 0.3);
}

// main emblem shape as a path (for enamel fill + polished metal edge)
function mainShape(x, rank) {
  if (rank === 'contributor') sparklePath(x, 0.42, 0.13);
  else if (rank === 'trusted') poly(x, starPoints({ n: 6, R: [0.41], r: 0.17 }));
  else if (rank === 'insider') poly(x, starPoints({ n: 8, R: [0.45, 0.29], r: 0.12 }));
  else if (rank === 'earlyR4') { x.beginPath(); x.arc(0, -0.02, 0.2, 0, Math.PI); x.closePath(); }
  else if (rank === 'earlyA' || rank === 'earlyB') { x.beginPath(); x.arc(0, HZ, SR, 0, Math.PI); x.closePath(); }
  else x.beginPath();
}

function details(x, rank) {
  const L = 0.0055;
  x.lineJoin = 'miter'; x.lineCap = 'round';
  if (rank === 'contributor') {
    x.save(); x.globalCompositeOperation = 'destination-out'; x.lineWidth = L * 0.7; sparklePath(x, 0.34, 0.13); x.stroke(); x.restore();
    circle(x, 0.56, L * 0.9);
  } else if (rank === 'trusted') {
    const pts = starPoints({ n: 6, R: [0.41], r: 0.17 });
    x.save(); x.globalCompositeOperation = 'destination-out'; x.lineWidth = L * 0.65; x.beginPath(); pts.forEach((p, i) => { if (i % 2 === 0) { x.moveTo(0, 0); x.lineTo(p[0] * 0.84, p[1] * 0.84); } }); x.stroke(); x.restore();
    circle(x, 0.52, L); circle(x, 0.61, L * 0.6);
    x.lineWidth = L * 0.6; x.beginPath(); for (let i = 0; i < 72; i++) ray(x, (i / 72) * TAU, 0.52, i % 6 === 0 ? 0.61 : 0.56); x.stroke();
  } else if (rank === 'insider') {
    x.lineWidth = 0.0032; x.beginPath(); for (let i = 0; i < 144; i++) ray(x, (i / 144) * TAU, 0.49, i % 2 ? 0.62 : 0.67); x.stroke();
    circle(x, 0.49, L); circle(x, 0.68, L * 0.5);
    // facet lines: each point split into a lit and a shaded half
    x.save(); x.globalCompositeOperation = 'destination-out'; x.lineWidth = L * 0.6; x.beginPath();
    starPoints({ n: 8, R: [0.45, 0.29], r: 0.12 }).forEach((p, i) => { if (i % 2 === 0) { x.moveTo(0, 0); x.lineTo(p[0] * 0.9, p[1] * 0.9); } }); x.stroke(); x.restore();
    circle(x, 0.13, L * 0.7);
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; x.save(); x.translate(Math.cos(a) * 0.37, Math.sin(a) * 0.37); sparklePath(x, 0.042, 0.15); x.fill(); x.restore(); }
  } else if (rank === 'founding') {
    x.lineWidth = 0.0034; x.beginPath(); for (let i = 0; i < 96; i++) ray(x, (i / 96) * TAU, 0.47, i % 2 ? 0.6 : 0.67); x.stroke();
    const d = []; for (let i = 0; i < 12; i++) { const a = Math.PI / 2 - (i * Math.PI) / 6; d.push([Math.cos(a) * 0.42, Math.sin(a) * 0.42]); }
    poly(x, d); x.lineWidth = L * 1.2; x.stroke();
    poly(x, starPoints({ n: 12, R: [0.39, 0.33], r: 0.30 })); x.lineWidth = L * 0.7; x.stroke();
    circle(x, 0.68, L * 0.6);
    // second inner ring: a solid gold band just inside the frame
    circle(x, 0.79, 0.011);
    drawMark(x, 0.22);
  } else if (rank === 'earlyA' || rank === 'earlyB') {
    earlyDawn(x, rank === 'earlyB');
  } else if (rank === 'earlyR4') {
    // dawn, redrawn: a sun with engraved concentric bands, 25 graded hairline rays,
    // a double horizon and the sun's reflection on still water below
    x.save(); x.globalCompositeOperation = 'destination-out'; x.lineWidth = L * 0.55;
    for (let k = 1; k <= 4; k++) { x.beginPath(); x.arc(0, -0.02, 0.2 - k * 0.04, 0, Math.PI); x.stroke(); } x.restore();
    x.lineWidth = 0.0034; x.beginPath();
    for (let i = 0; i < 25; i++) { const a = 0.08 + (i * (Math.PI - 0.16)) / 24; const len = [0.5, 0.36, 0.42, 0.36][i % 4]; ray(x, a, 0.25, len + 0.02 * Math.sin(i), 0, -0.02); } x.stroke();
    x.lineWidth = L * 1.1; x.beginPath(); x.moveTo(-0.6, -0.02); x.lineTo(0.6, -0.02); x.stroke();
    x.lineWidth = L * 0.45; x.beginPath(); x.moveTo(-0.56, -0.045); x.lineTo(0.56, -0.045); x.stroke();
    // reflection: horizontal strokes shrinking downward
    x.lineCap = 'round';
    for (let k = 0; k < 7; k++) { const y = -0.085 - k * 0.042; const half = 0.2 * (1 - k * 0.12); x.lineWidth = L * (1.1 - k * 0.1); x.beginPath(); x.moveTo(-half, y); x.lineTo(half, y); x.stroke(); }
    circle(x, 0.68, L * 0.5);
  }
}

export function drawInk4(E, M, S, rank) {
  if (rank === 'early') rank = EARLY_PICK;
  for (const c of [E, M]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, S, S); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.setTransform(S / 2, 0, 0, -S / 2, S / 2, S / 2); }
  // frame hairlines
  circle(E, 0.812, 0.0045); circle(E, 0.797, 0.0016);
  // main emblem: enamel fill, polished metal edge (Early B: the sun itself is polished raised metal)
  if (rank === 'earlyB') { mainShape(M, rank); M.fill(); }
  else mainShape(E, rank), E.fill();
  if (rank !== 'founding') { mainShape(M, rank); M.lineWidth = rank.startsWith('early') ? 0.008 : 0.012; M.lineJoin = 'miter'; M.stroke(); }
  details(E, rank);
  if (rank === 'insider') { M.beginPath(); M.arc(0, 0, 0.032, 0, TAU); M.fill(); stud(M, 0, 0, 0.03); }
  if (rank === 'founding') {
    // gem-set markers: 12 domed gold studs between the frame and the bezel, plus one on the mark's axis
    for (let i = 0; i < 12; i++) { const a = Math.PI / 2 - (i * TAU) / 12; stud(M, Math.cos(a) * 0.825, Math.sin(a) * 0.825, 0.011); }
  }
  // legend on the bezel; Founding uses domed studs as separators
  const sepFn = rank === 'founding' ? (cx, cy) => { M.save(); M.setTransform(S / 2, 0, 0, S / 2, S / 2, S / 2); stud(M, cx, cy, 0.012); M.restore(); } : null;
  const early = rank.startsWith('early');
  ringText(E, S, LEGEND[early ? 'early' : rank], 0.921, 0.045, { track: 0.3, sepFn, centers: early ? [0, 90, 180, 270] : null });
  ringText(E, S, ['ACIRA', 'AUTHENTIC', 'ACIRA', 'AUTHENTIC', 'ACIRA', 'AUTHENTIC', 'ACIRA', 'AUTHENTIC'], 0.758, 0.0145, { track: 0.3, weight: 500 });
  for (const c of [E, M]) c.setTransform(1, 0, 0, 1, 0, 0);
}
