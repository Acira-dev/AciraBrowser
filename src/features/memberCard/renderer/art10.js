// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
// Acira member cards, round 10: face art for four design systems (D1-D4), drawn as physical layers.
// Every card = a stack of plates. Each plate = a colour canvas (stock + ink, alpha = where the plate exists) and a
// map canvas: R = foil strength, G = explicit grating angle / PI (0 = use the shared zigzag field), B = height (0.5 flat).
import { ACIRA_MARK_D } from './emblems.js';
import { MEMBER_NAME } from './sys12.js';

export const W = 1600, H = 2400, U = W / 24, M = 2 * U, S = U / 2, L = 2 * U, XS = U / 4;
export const INK = 'rgb(13,14,17)';
export const TIERS = {
  early: { num: '1482', word: 'EARLY MEMBER', label: 'Early Member' },
  contributor: { num: '0214', word: 'CONTRIBUTOR', label: 'Contributor' },
  trusted: { num: '0087', word: 'TRUSTED CONTRIBUTOR', label: 'Trusted Contributor' },
  insider: { num: '0001', word: 'INSIDER', label: 'Insider', invited: 'Founding team' },
  founding: { num: '0003', word: 'FOUNDING CONTRIBUTOR', label: 'Founding Contributor' },
};
export const ORDER = ['early', 'contributor', 'trusted', 'insider', 'founding'];
export const RANK = { early: 0, contributor: 1, trusted: 2, insider: 3, founding: 4 };
const NAME = MEMBER_NAME, SINCE = 'Nov 2026';

export function mk(w = W, h = H) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const g2 = (c) => c.getContext('2d');
// a plate: colour + map canvases; map starts flat (B = 128) with no foil
export function plate(fill = null) {
  const col = mk(), map = mk();
  const m = g2(map); m.fillStyle = 'rgb(0,0,128)'; m.fillRect(0, 0, W, H);
  if (fill) { const c = g2(col); c.fillStyle = fill; c.fillRect(0, 0, W, H); }
  return { col, map, c: g2(col), m };
}
export function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
export const RAD = 0.059 * W;
// clip both canvases of a plate to the card outline (rounded corners)
function cardClip(p) {
  for (const ctx of [p.c]) { ctx.save(); ctx.globalCompositeOperation = 'destination-in'; rrect(ctx, 0, 0, W, H, RAD); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore(); }
}

// ---------- type ----------
function font(px, fam, wt = 400) { return `${wt} ${px}px "${fam}"`; }
export function text(ctx, s, x, y, f, col, track = 0, align = 'left') {
  ctx.save(); ctx.font = f; ctx.fillStyle = col; ctx.letterSpacing = track ? `${track}px` : '0px'; ctx.textBaseline = 'alphabetic';
  let w = ctx.measureText(s).width - (track || 0);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.textAlign = 'left'; ctx.fillText(s, x0, y); ctx.restore(); return w;
}
function tw(ctx, s, f, track = 0) { ctx.save(); ctx.font = f; ctx.letterSpacing = track ? `${track}px` : '0px'; const w = ctx.measureText(s).width - track; ctx.restore(); return w; }

// the Acira mark centred at (cx, cy) with height h
export function markPath(cx, cy, h) {
  const p = new Path2D(); const s = h / 99.4;
  p.addPath(new Path2D(ACIRA_MARK_D), new DOMMatrix().translate(cx, cy).scale(s, s).translate(-39.79, -58.4));
  return p;
}

// header: mark + wordmark top-left, tier word top-right. Returns nothing; draws on each ctx in `ctxs` with colour col
const TW_PX = 70, TW_TR = 0.2 * 70;
export function header(ctx, tier, col = INK, opt = {}) {
  const cap = TW_PX * 0.72, MH = 2 * cap, cy = 0.8 * M + MH / 2;
  ctx.save(); ctx.fillStyle = opt.markCol || col; ctx.fill(markPath(M + 39.79 / 99.4 * MH, cy, MH)); ctx.restore();
  text(ctx, 'Acira', M + 79.5 / 99.4 * MH + XS, cy + 0.66 * MH * 0.5, font(0.66 * MH / 0.70, 'Card Sans', 500), col);
  const f = font(TW_PX, 'Card Mono', 700); const word = TIERS[tier].word;
  if (tw(ctx, word, f, TW_TR) > 8 * U && word.includes(' ')) {
    const [a, ...b] = word.split(' ');
    text(ctx, a, W - M, cy - S / 2 - 2, f, col, TW_TR, 'right');
    text(ctx, b.join(' '), W - M, cy + cap + S / 2 - 2, f, col, TW_TR, 'right');
  } else text(ctx, word, W - M, cy + cap / 2, f, col, TW_TR, 'right');
  return { cy, MH };
}

// bottom block: name, MEMBER SINCE (+ optional columns). Returns geometry
export const BOT = (() => {
  const valBase = H - M, valPx = 64, labPx = 42, labCap = 42 * 0.72;
  const labBase = valBase - valPx * 0.72 - S, nameBase = labBase - labCap - L * 0.8;
  return { valBase, valPx, labPx, labBase, nameBase, namePx: 176 };
})();
export function bottom(ctx, tier, col = INK, labCol = 'rgba(40,42,50,.62)', extra = []) {
  text(ctx, NAME, M - 4, BOT.nameBase, font(BOT.namePx, 'Oxanium', 500), col, -0.01 * BOT.namePx);
  const cols = [['MEMBER SINCE', SINCE], ...(TIERS[tier].invited ? [['INVITED BY', TIERS[tier].invited]] : []), ...extra];
  let x = M;
  for (const [l, v] of cols) {
    const lf = font(BOT.labPx, 'Card Mono', 500), vf = font(BOT.valPx, 'Card Sans', 400);
    text(ctx, l, x, BOT.labBase, lf, labCol, 0.14 * BOT.labPx);
    text(ctx, v, x, BOT.valBase, vf, col);
    x += Math.max(tw(ctx, l, lf, 0.14 * BOT.labPx), tw(ctx, v, vf)) + L;
  }
}
// seal geometry: visible disc 3.2U, bottom-right at margin M
export const SEAL_D = 3.2 * U; export const SEAL_C = [W - M - SEAL_D / 2, H - M - SEAL_D / 2 + 6];
// (the sample's sealOf() named its seal files by path: the app's cards get theirs from assets.js)

// ---------- the big number: Oxanium Light, dotted zero ----------
export function numberGeom(str, fitW = W - 2 * M, capMax = 470) {
  const c = g2(mk(10, 10)); let px = 600;
  for (let k = 0; k < 3; k++) { const w = tw(c, '0000', font(px, 'Oxanium', 300), 0.02 * px); px *= fitW / w; }
  px = Math.min(px, capMax / 0.70);
  return { px, f: font(px, 'Oxanium', 300), track: 0.02 * px, cap: px * 0.70 };
}
// draw str centred at cx with optical centre cy; mode 'fill' | 'stroke'
export function drawNumber(ctx, str, cx, cy, G, style = {}) {
  const base = cy + G.cap / 2; const col = style.col || INK;
  ctx.save(); ctx.font = G.f; ctx.letterSpacing = `${G.track}px`;
  const w = ctx.measureText(str).width - G.track; let x = cx - w / 2;
  const adv = [...str].map((ch, k) => ctx.measureText(str.slice(0, k)).width);
  ctx.letterSpacing = '0px';
  const zw = ctx.measureText('0').width;
  [...str].forEach((ch, k) => {
    const gx = x + adv[k];
    if (style.stroke) { ctx.strokeStyle = col; ctx.lineWidth = style.stroke; ctx.lineJoin = 'round'; ctx.strokeText(ch, gx, base); }
    else { ctx.fillStyle = col; ctx.fillText(ch, gx, base); }
    if (ch === '0') { // the inner mark: a short vertical bar of stem weight
      const stem = G.px * 0.062, bh = G.cap * 0.22, zx = gx + zw / 2, zy = base - G.cap / 2;
      if (style.stroke) { ctx.strokeRect(zx - stem / 2, zy - bh / 2, stem, bh); }
      else { ctx.beginPath(); ctx.roundRect(zx - stem / 2, zy - bh / 2, stem, bh, stem * 0.2); ctx.fill(); }
    }
  });
  ctx.restore();
  return { x0: x, x1: x + w, top: base - G.cap, base };
}

// ---------- pixel patterns per rank (square cells, mirror-symmetric) ----------
// returns [col, row, size 0..1] with row 0 sitting on the baseline
export function patCells(tier, N) {
  const out = []; const mid = (N - 1) / 2;
  for (let col = 0; col < N; col++) {
    const d = Math.abs(col - mid);
    if (tier === 'contributor') { const p = col % 6; for (let r = 0; r < 3; r++) if (p !== 5 && Math.abs(p - 2) <= 2 - r) out.push([col, r, 1]); }
    else if (tier === 'trusted') { const sz = [1, 0.8, 0.6, 0.42, 0.26]; for (let r = 0; r < 5; r++) if ((d + r) % 2 === 0) out.push([col, r, sz[r]]); }
    else if (tier === 'insider' || tier === 'founding') {
      const p = d % 8, dd = Math.min(p, 8 - p);
      for (let r = 0; r < 7; r++) { if (dd + Math.abs(r - 3) <= 3) out.push([col, r, 1]); else if (p === 4 && r === 3) out.push([col, r, 0.5]); }
      if (tier === 'founding') { if (d % 2 === 0) out.push([col, 8, 0.4]); }
    } else if (tier === 'early') { const p = col % 4; for (let r = 0; r < 2; r++) if (p !== 3 && Math.abs(p - 1) <= 1 - r) out.push([col, r, 1]); }
  }
  return out;
}
export function drawPattern(ctx, tier, x0, x1, base, N, style = 'fill', lw = 2) {
  const C = (x1 - x0) / N;
  for (const [col, r, s] of patCells(tier, N)) {
    const cx = x0 + (col + 0.5) * C, cy = base - (r + 0.5) * C, h = C * s;
    if (style === 'fill') { ctx.fillRect(Math.round(cx - h / 2), Math.round(cy - h / 2), Math.round(h), Math.round(h)); }
    else { ctx.lineWidth = lw; ctx.strokeRect(cx - h / 2 + lw, cy - h / 2 + lw, h - 2 * lw, h - 2 * lw); }
  }
  return C;
}

// microtext: tiny repeated line (reads as a rule at normal size, as words under a loupe)
export function microLine(ctx, s, x0, x1, y, px, col) {
  ctx.save(); ctx.font = font(px, 'Card Mono', 500); ctx.fillStyle = col; ctx.letterSpacing = `${px * 0.08}px`;
  ctx.beginPath(); ctx.rect(x0, y - px, x1 - x0, px * 1.6); ctx.clip();
  let x = x0; const w = ctx.measureText(s).width; while (x < x1) { ctx.fillText(s, x, y); x += w; }
  ctx.restore();
}
function microCircle(ctx, s, cx, cy, r, px, col) {
  ctx.save(); ctx.font = font(px, 'Card Mono', 500); ctx.fillStyle = col; ctx.textAlign = 'center';
  const per = ctx.measureText('M').width * 1.08; const n = Math.floor(2 * Math.PI * r / per);
  for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI - Math.PI / 2; ctx.save(); ctx.translate(cx + r * Math.cos(a), cy + r * Math.sin(a)); ctx.rotate(a + Math.PI / 2); ctx.fillText(s[i % s.length], 0, 0); ctx.restore(); }
  ctx.restore();
}

// encode a grating angle (radians, mod PI) as a map colour; R = foil strength, B = height
export function mapCol(foil, ang = null, h = 128) { const g = ang == null ? 0 : Math.max(2, Math.round(((ang % Math.PI) + Math.PI) % Math.PI / Math.PI * 255)); return `rgb(${Math.round(foil * 255)},${g},${h})`; }

// ---------- construction drawing of the Acira mark (r9 E-W2 geometry, here parametrised) ----------
export function construction(ctx, cx, cy, h, lw, col, colLight, accent, opt = {}) {
  const s = h / 99.4; const T = (x, y) => [cx + (x - 39.79) * s, cy + (y - 58.4) * s];
  ctx.save(); ctx.lineCap = 'round';
  const line = (a, b, w = lw.l, c = colLight) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); };
  const circ = (p, r, w = lw.l, c = colLight) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.stroke(); };
  // circumcircle and corner circles
  circ(T(39.79, 58.4), 50.3 * s, lw.m, opt.circCol || colLight);
  for (const [x, y] of [[9.6, 49.8], [69.98, 66.4], [35.6, 97.4], [43.98, 18.8]]) circ(T(x, y), 9.6 * s);
  // verticals through the block edges, slants at 30 degrees, top/bottom rules
  const ext = opt.ext || 60;
  for (const x of [0, 22.6, 45.1, 34.4, 56.9, 79.5]) line(T(x, -ext + 8), T(x, 108 + ext));
  const t30 = Math.tan(Math.PI / 6);
  for (const [x, y] of [[9.6, 49.8], [69.98, 66.4], [39.79, 58.4]]) line(T(x - 70, y - 70 * t30), T(x + 70, y + 70 * t30));
  line(T(-80, 8.9), T(160, 8.9)); line(T(-80, 108.3), T(160, 108.3));
  if (opt.grid) { line(T(-80, 58.4 - 6 * U / s), T(160, 58.4 - 6 * U / s)); line(T(-80, 58.4 + 6 * U / s), T(160, 58.4 + 6 * U / s)); }
  // the mark outline
  const mp = markPath(cx, cy, h);
  if (opt.fill) { ctx.fillStyle = opt.fill; ctx.fill(mp); }
  ctx.strokeStyle = col; ctx.lineWidth = lw.s; ctx.lineJoin = 'round'; ctx.stroke(mp);
  // accents: centre cross, corner dots
  if (accent) { const c = T(39.79, 58.4), k = 0.42 * U; line([c[0] - k, c[1]], [c[0] + k, c[1]], lw.m, accent); line([c[0], c[1] - k], [c[0], c[1] + k], lw.m, accent);
    for (const p of [T(9.6, 49.8), T(69.98, 66.4)]) { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(p[0], p[1], lw.m * 1.6, 0, 7); ctx.fill(); } }
  ctx.restore();
  return mp;
}

// small helpers
export function blurCopy(src, px) { const c = mk(src.width, src.height); const x = g2(c); x.filter = `blur(${px}px)`; x.drawImage(src, 0, 0); return c; }
export function hash(n) { let h = 2166136261 >>> 0; for (const ch of String(n)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }; }
export { NAME, SINCE, font, tw, cardClip, g2 };
