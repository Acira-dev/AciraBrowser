// @ts-nocheck
// Beta 14 member cards. Ported from the team-approved sample pack (the reference sample, round r19, 15 Nov 2026).
// His drawing values are kept as they were; what changed is only what the app needs: no test harness, the member's own name, month and number
// in place of the sample's, assets and fonts from the app bundle (never the network), and no code for cards that do not ship.
﻿// Shared emblem definitions for the r2 badge families (G glass, H holo seal, X hybrid).
// Unit coordinates: badge radius = 1, y up.

export const RANKS = ['contributor', 'trusted', 'insider', 'founding', 'early'];
export const NAMES = {
  contributor: 'Contributor',
  trusted: 'Trusted Contributor',
  insider: 'Insider',
  founding: 'Founding Contributor',
  early: 'Early Member',
};

// Compass-star ladder: 4 -> 6 -> 8 -> 12 points.
export const STAR = {
  contributor: { n: 4, R: [0.50], r: 0.115 },
  trusted: { n: 6, R: [0.49], r: 0.17 },
  insider: { n: 8, R: [0.56, 0.38], r: 0.16 },
  founding: { n: 12, R: [0.56, 0.41], r: 0.18 },
};

export function starPoints(cfg) {
  const pts = [];
  const n = cfg.n;
  for (let k = 0; k < n * 2; k++) {
    const a = Math.PI / 2 - (k * Math.PI) / n;
    const rad = k % 2 === 0 ? cfg.R[(k / 2) % cfg.R.length] : cfg.r;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return pts;
}

// Acira mark (two interlocking capsules), from the app logo, native box ~ x 0..80, y 8..108 (y down).
export const ACIRA_MARK_D = 'M9.14648 40.4844C11.2929 40.7498 13.0895 41.7641 14.8955 42.9131C15.3076 43.1699 15.7202 43.4267 16.1328 43.6826C16.3407 43.8118 16.5485 43.9411 16.7627 44.0742C18.148 44.9207 19.5657 45.7119 20.9775 46.5117C21.8443 47.0354 21.8445 47.0356 22.4795 47.6787C22.5615 48.6038 22.5613 48.604 22.5654 49.8027C22.5671 50.0208 22.5696 50.2392 22.5713 50.4639C22.5745 50.9387 22.5756 51.4139 22.5762 51.8887C22.5773 52.6422 22.5834 53.3959 22.5898 54.1494C22.6074 56.2925 22.6172 58.4359 22.625 60.5791C22.6301 61.8899 22.6391 63.2009 22.6514 64.5117C22.655 65.0094 22.6572 65.5072 22.6572 66.0049C22.6575 69.0187 22.6817 71.6714 24.2979 74.3105C25.2374 75.2393 26.2421 75.8486 27.3838 76.4941C27.615 76.6282 27.8467 76.7623 28.085 76.9004C28.589 77.1922 29.0941 77.4823 29.5996 77.7715C30.478 78.2756 31.3527 78.7868 32.2266 79.2988C32.829 79.6508 33.4316 80.0028 34.0342 80.3545C34.323 80.5233 34.6116 80.6923 34.9092 80.8662C35.3148 81.1012 35.315 81.1012 35.7285 81.3408C35.9685 81.4803 36.2089 81.62 36.4561 81.7637C37.7717 82.4681 38.8786 82.4789 40.3477 82.4863C40.7553 82.4909 41.163 82.4953 41.583 82.5C42.8238 82.4249 43.8472 82.1452 45.0322 81.7822C45.0692 84.2434 45.0971 86.7046 45.1143 89.166C45.1225 90.3093 45.1342 91.4525 45.1523 92.5957C45.1731 93.9134 45.1805 95.231 45.1875 96.5488C45.1957 96.9545 45.2035 97.3604 45.2119 97.7783C45.2128 100.553 44.8012 102.834 42.877 104.917C40.2375 107.392 37.1254 108.019 33.7168 106.78C32.3608 106.145 31.0741 105.388 29.7852 104.625C29.3638 104.379 29.3636 104.379 28.9336 104.128C27.332 103.194 25.7362 102.249 24.1445 101.298C22.2329 100.158 20.3043 99.0497 18.3701 97.9492C16.0063 96.6028 13.6554 95.2379 11.3232 93.8359C10.1009 93.1017 8.87101 92.3845 7.63086 91.6816C1.39236 88.1354 1.39149 88.135 0.244141 84.6777C0.160662 83.891 0.160998 83.8909 0.155273 83.0527C0.151647 82.7331 0.148268 82.4133 0.144531 82.084C0.143466 81.5632 0.143665 81.5625 0.142578 81.0312C0.137851 80.4789 0.137638 80.4788 0.132812 79.915C0.123536 78.6963 0.118745 77.4776 0.115234 76.2588C0.111579 75.4105 0.108152 74.5622 0.104492 73.7139C0.0984165 72.1619 0.0946995 70.6096 0.0927734 69.0576C0.0899306 66.7799 0.0789712 64.5022 0.0605469 62.2246C0.0451063 60.2464 0.0401601 58.2683 0.0390625 56.29C0.0371439 55.4513 0.0317963 54.6121 0.0234375 53.7734C0.0125554 52.5975 0.0144415 51.422 0.0185547 50.2461C0.0127015 49.9022 0.00603053 49.5584 0 49.2041C0.0265815 46.7682 0.646894 45.0879 2.15039 43.1748C4.29348 41.1381 6.24182 40.5408 9.14648 40.4844ZM36.6963 11.3174C39.3358 8.84229 42.4486 8.21516 45.8574 9.4541C47.2133 10.0894 48.4993 10.8465 49.7881 11.6094C50.2095 11.8551 50.2097 11.8548 50.6396 12.1055C52.2414 13.0397 53.837 13.984 55.4287 14.9355C57.3405 16.0759 59.2688 17.1847 61.2031 18.2852C63.5669 19.6316 65.9178 20.9965 68.25 22.3984C69.4725 23.1327 70.703 23.8498 71.9434 24.5527C78.1817 28.0988 78.1818 28.0994 79.3291 31.5566C79.4126 32.3433 79.4122 32.3434 79.418 33.1816C79.4216 33.5013 79.425 33.821 79.4287 34.1504C79.4298 34.671 79.4306 34.6712 79.4316 35.2021C79.4364 35.7549 79.4356 35.7554 79.4404 36.3193C79.4497 37.538 79.4545 38.7569 79.458 39.9756C79.4617 40.8239 79.4651 41.6722 79.4688 42.5205C79.4748 44.0725 79.4785 45.6247 79.4805 47.1768C79.4833 49.4544 79.4943 51.7322 79.5127 54.0098C79.5281 55.988 79.5331 57.9661 79.5342 59.9443C79.5361 60.7831 79.5414 61.6222 79.5498 62.4609C79.5607 63.6368 79.5598 64.8124 79.5557 65.9883C79.5615 66.3321 79.5672 66.6761 79.5732 67.0303C79.5466 69.4661 78.9264 71.1464 77.4229 73.0596C75.2799 75.0961 73.3321 75.6936 70.4277 75.75C68.2811 75.4846 66.4839 74.4704 64.6777 73.3213C64.2657 73.0645 63.8531 72.8077 63.4404 72.5518C63.2326 72.4226 63.0247 72.2933 62.8105 72.1602C61.4254 71.3138 60.0084 70.5224 58.5967 69.7227C57.7295 69.1986 57.7288 69.1989 57.0938 68.5557C57.0117 67.6307 57.0119 67.6301 57.0078 66.4316C57.0062 66.2134 57.0046 65.9944 57.0029 65.7695C56.9997 65.2949 56.9977 64.8203 56.9971 64.3457C56.9959 63.5922 56.9908 62.8384 56.9844 62.085C56.9668 59.9419 56.957 57.7984 56.9492 55.6553C56.9441 54.3444 56.9341 53.0334 56.9219 51.7227C56.9182 51.2249 56.916 50.7272 56.916 50.2295C56.9157 47.2158 56.8923 44.5629 55.2764 41.9238C54.3368 40.9951 53.3321 40.3857 52.1904 39.7402C51.9591 39.6061 51.7276 39.4721 51.4893 39.334C50.985 39.0421 50.4794 38.7512 49.9736 38.4619C49.0955 37.958 48.2213 37.4474 47.3477 36.9355C46.7451 36.5835 46.1418 36.2316 45.5391 35.8799C45.2503 35.7111 44.9616 35.5421 44.6641 35.3682C44.2585 35.1331 44.2583 35.1332 43.8447 34.8936C43.6046 34.754 43.3646 34.6135 43.1172 34.4697C41.8016 33.7654 40.6954 33.7555 39.2266 33.748C38.8187 33.7435 38.4104 33.7391 37.9902 33.7344C36.7495 33.8094 35.7261 34.0891 34.541 34.4521C34.504 31.991 34.4762 29.5297 34.459 27.0684C34.4507 25.9251 34.439 24.7818 34.4209 23.6387C34.4002 22.321 34.3927 21.0033 34.3857 19.6855C34.3775 19.28 34.3698 18.8739 34.3613 18.4561C34.3605 15.6816 34.7722 13.4002 36.6963 11.3174Z';
export const ACIRA_MARK_BOX = { cx: 39.79, cy: 58.4, h: 99.4 };

// Maps the mark into unit coords with a given half-height (y up). Returns a DOMMatrix-like for canvas.
export function markTransform(halfH) {
  const s = (2 * halfH) / ACIRA_MARK_BOX.h;
  return { s, tx: -ACIRA_MARK_BOX.cx * s, ty: ACIRA_MARK_BOX.cy * s };
}

// Seal palettes (sRGB hex), 4 stops, cyclic. ink = line colour.
export const SEAL = {
  contributor: { stops: ['#e4e8ef', '#f7f1f4', '#d9e3ec', '#eef0e4'], ink: '#15161a', guil: 0.9, sat: 1 },
  trusted: { stops: ['#9fb6ff', '#cbb8ff', '#8fe2ff', '#b3c2ff'], ink: '#111322', guil: 0.8, sat: 1 },
  insider: { stops: ['#ffe561', '#ff9fd6', '#b7a3ff', '#74f0ff'], ink: '#121216', guil: 0.6, sat: 1 },
  founding: { stops: ['#f4d99f', '#fff0cf', '#e2bd78', '#f8e2b6'], ink: 'foil', guil: 1, sat: 1, dark: true },
  early: { stops: ['#ffd8bd', '#fff1c7', '#bdf3e2', '#cfe7ff'], ink: '#14171a', guil: 0.8, sat: 1 },
};

export const MICRO = {
  contributor: 'ACIRA · CONTRIBUTOR · EST. 2026 · VERIFIED · ',
  trusted: 'ACIRA · TRUSTED CONTRIBUTOR · EST. 2026 · ',
  insider: 'ACIRA · INSIDER · CERTIFIED · EST. 2026 · ',
  founding: 'ACIRA · FOUNDING CONTRIBUTOR · EST. 2026 · ',
  early: 'ACIRA · EARLY MEMBER · BEFORE 1.0 · BETA 14 · ',
};

// ---------- Canvas helpers (unit coords, y up) ----------
function unitCtx(ctx, S) { ctx.setTransform(S / 2, 0, 0, -S / 2, S / 2, S / 2); }

function circle(ctx, r, lw) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.lineWidth = lw; ctx.stroke(); }

function polyPath(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }

export function sparklePath(ctx, R, pinch = 0.1) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 2 - (i * Math.PI) / 2;
    const b = a - Math.PI / 2;
    const m = a - Math.PI / 4;
    const p = [Math.cos(a) * R, Math.sin(a) * R];
    const q = [Math.cos(b) * R, Math.sin(b) * R];
    const c = [Math.cos(m) * R * pinch, Math.sin(m) * R * pinch];
    if (i === 0) ctx.moveTo(p[0], p[1]);
    ctx.quadraticCurveTo(c[0], c[1], q[0], q[1]);
  }
  ctx.closePath();
}

export function drawMark(ctx, halfH, fill = true) {
  const t = markTransform(halfH);
  ctx.save();
  ctx.transform(t.s, 0, 0, -t.s, t.tx, t.ty);
  const p = new Path2D(ACIRA_MARK_D);
  if (fill) ctx.fill(p); else ctx.stroke(p);
  ctx.restore();
}

function compassRose(ctx, longR, shortR, n, lw) {
  // n main points (alternating long/short), each half filled half outlined
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 - (i * 2 * Math.PI) / n;
    const L = i % 2 === 0 ? longR : shortR;
    const w = (i % 2 === 0 ? 0.105 : 0.075) * (longR / 0.5);
    const tip = [Math.cos(a) * L, Math.sin(a) * L];
    const left = [Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w];
    const right = [Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w];
    polyPath(ctx, [[0, 0], tip, left]); ctx.fill();
    polyPath(ctx, [[0, 0], tip, right]); ctx.lineWidth = lw; ctx.lineJoin = 'miter'; ctx.stroke();
  }
}

function rays(ctx, n, r0, r1, lw, alt = null, a0 = 0, a1 = Math.PI * 2) {
  ctx.lineWidth = lw; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (a1 - a0 >= Math.PI * 2 - 1e-6 ? n : n - 1);
    const e = alt && i % 2 ? alt : r1;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * e, Math.sin(a) * e); ctx.stroke();
  }
}

export function dawnPath(ctx, s = 1) {
  // half sun above horizon
  ctx.beginPath(); ctx.arc(0, -0.06 * s, 0.24 * s, 0, Math.PI); ctx.closePath(); ctx.fill();
}

// Centre emblem in ink (line art), shared by H and X.
export function drawSealEmblem(ctx, rank, k = 1) {
  ctx.save(); ctx.scale(k, k);
  const L = 0.0085;
  if (rank === 'contributor') {
    sparklePath(ctx, 0.40, 0.13); ctx.fill();
    circle(ctx, 0.55, L * 0.8);
    ctx.beginPath(); for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { ctx.moveTo(Math.cos(a + Math.PI / 4) * 0.55, Math.sin(a + Math.PI / 4) * 0.55); ctx.arc(Math.cos(a + Math.PI / 4) * 0.55, Math.sin(a + Math.PI / 4) * 0.55, 0.018, 0, Math.PI * 2); } ctx.fill();
  } else if (rank === 'trusted') {
    polyPath(ctx, starPoints({ n: 6, R: [0.40], r: 0.16 })); ctx.fill();
    circle(ctx, 0.50, L * 0.9);
    circle(ctx, 0.585, L * 0.6);
    rays(ctx, 24, 0.50, 0.585, L * 0.6);
  } else if (rank === 'insider') {
    rays(ctx, 96, 0.47, 0.66, 0.0042, 0.60);
    circle(ctx, 0.47, L * 0.8);
    compassRose(ctx, 0.43, 0.27, 8, L * 0.9);
    ctx.save(); ctx.lineWidth = L * 0.7; circle(ctx, 0.12, L * 0.7); ctx.restore();
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      ctx.save(); ctx.translate(Math.cos(a) * 0.36, Math.sin(a) * 0.36); sparklePath(ctx, 0.045, 0.15); ctx.fill(); ctx.restore();
    }
  } else if (rank === 'founding') {
    rays(ctx, 48, 0.42, 0.66, 0.005, 0.56);
    const dodec = []; for (let i = 0; i < 12; i++) { const a = Math.PI / 2 - (i * Math.PI) / 6; dodec.push([Math.cos(a) * 0.39, Math.sin(a) * 0.39]); }
    polyPath(ctx, dodec); ctx.lineWidth = L; ctx.stroke();
    polyPath(ctx, starPoints({ n: 12, R: [0.36, 0.30], r: 0.27 })); ctx.lineWidth = L * 0.6; ctx.stroke();
    drawMark(ctx, 0.20);
  } else if (rank === 'early') {
    ctx.lineCap = 'round';
    dawnPath(ctx);
    ctx.lineWidth = L * 1.2; ctx.beginPath(); ctx.moveTo(-0.55, -0.06); ctx.lineTo(0.55, -0.06); ctx.stroke();
    ctx.save(); ctx.translate(0, -0.06); rays(ctx, 9, 0.31, 0.50, L, 0.45, 0.12, Math.PI - 0.12); ctx.restore();
    // dotted field below the horizon, perspective rows
    for (let row = 0; row < 4; row++) {
      const y = -0.15 - row * 0.085; const cnt = 9 - row * 2; const span = 0.42 - row * 0.09; const rr = 0.014 - row * 0.002;
      ctx.beginPath(); for (let i = 0; i < cnt; i++) { const x = -span + (2 * span * i) / (cnt - 1); ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI * 2); } ctx.fill();
    }
  }
  ctx.restore();
}

// Full seal ink layer (white on transparent; shader colours it). S = canvas px.
export function drawSealInk(ctx, S, rank, opts = {}) {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
  unitCtx(ctx, S);
  circle(ctx, 0.952, 0.011);
  circle(ctx, 0.792, 0.010);
  if (rank !== 'contributor') circle(ctx, 0.768, 0.0045);
  // separator dots on the inner circle (B3 style)
  ctx.beginPath(); for (const a of [0, Math.PI]) { const x = Math.cos(a) * 0.792; ctx.moveTo(x + 0.022, 0); ctx.arc(x, 0, 0.022, 0, Math.PI * 2); } ctx.fill();
  drawSealEmblem(ctx, rank, opts.emblemScale || 1);
  // micro-text ring, y-down coords
  ctx.setTransform(S / 2, 0, 0, S / 2, S / 2, S / 2);
  const text = MICRO[rank];
  const R = 0.872; let cap = 0.082;
  // canvas fonts need px; work in a 1000x space then scale
  ctx.scale(0.001, 0.001);
  const setFont = () => { ctx.font = `600 ${Math.round(cap * 1.32 * 1000)}px "Bahnschrift"`; try { ctx.fontStretch = 'semi-condensed'; } catch (e) {} };
  setFont();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const chars = [...text];
  const circ = 2 * Math.PI * R;
  let widths = chars.map((c) => ctx.measureText(c).width / 1000);
  let natural = widths.reduce((a, b) => a + b, 0);
  cap = Math.min(0.104, cap * (0.80 * circ) / natural); setFont();
  widths = chars.map((c) => ctx.measureText(c).width / 1000);
  natural = widths.reduce((a, b) => a + b, 0);
  ctx.scale(1000, 1000);
  const spacing = (circ - natural) / chars.length;
  let s = -widths[0] / 2 - spacing / 2; // so the first word is centred at top
  const firstWord = text.indexOf(' ');
  let fw = 0; for (let i = 0; i < firstWord; i++) fw += widths[i] + spacing;
  s = -fw / 2;
  for (let i = 0; i < chars.length; i++) {
    const mid = s + widths[i] / 2;
    const a = -Math.PI / 2 + mid / R;
    ctx.save(); ctx.translate(Math.cos(a) * R, Math.sin(a) * R); ctx.rotate(a + Math.PI / 2); ctx.scale(0.001, 0.001);
    ctx.fillText(chars[i], 0, 4); ctx.restore();
    s += widths[i] + spacing;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- SVG export of emblems (sources) ----------
export function starSVG(rank) {
  const pts = starPoints(STAR[rank]).map((p) => `${(p[0] * 100).toFixed(2)},${(-p[1] * 100).toFixed(2)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200"><polygon points="${pts}" fill="#fff"/></svg>`;
}
