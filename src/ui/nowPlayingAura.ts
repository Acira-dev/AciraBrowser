/** The now-playing card's glow, "aura waves" (Beta 14, the team's approved version B, 13 Nov), as pure maths: no window, no canvas,
 * so it can be tested. The sample it is built from is the reference sample; tests/now-playing-aura.test.ts
 * pins this kernel's output to that sample's, pixel for pixel.
 *
 * One continuous band of light along the card's bottom edge. Its colour along x is a soft mix of the artwork's four colours (each
 * colour's share is a wide Gaussian around its home, read through its own slowly domain-warped x, normalised, so colours cross-fade,
 * slide over each other and interleave instead of travelling). Four layers, one per colour, rise from the edge as strata of different
 * heights that breathe out of phase; each crest undulates with two waves running in OPPOSITE directions at unrelated periods plus a
 * short ripple, so the silhouette morphs and flows and nothing translates. The field is computed on a 4 x 2 CSS px grid into pixels
 * the browser scales smoothly; the light is added (plus-lighter) in dark and laid normally in light. The coloured 1 px bottom border
 * reads the same colour field. Nothing is drawn outside the card (the card clips).
 *
 * Pause: one eased value pz (0 playing, 1 paused): the light sinks to 68 % of its height and dims to 48 %; play is the same curve
 * backwards. The clock runs at 1 - pz, so the waves glide to a stop as they sink. */

const TAU = Math.PI * 2;
/** Version B ("more flowing"), the approved one; the sample's A and C are not shipped. */
const V = { H: 27, A: .36, k1: .7, k2: 1.35, spd: .38, warp: .18, sig: .3, drift: .07, s: [1.12, .76, 1, .64], hb: .28, dome: .5, gain: .92, breath: .45, fall: 1.5, R: .14 } as const;
/** Each colour's region is warped with its own phase (WPH): the borders slide past each other. */
const WPH = [0, 1.6, 3.1, 4.5];
const RH = [6.7, 8.9, 7.3, 10.3], FH = [0, 2.4, 4.4, 1.2];
const HOME = [.2, .4, .6, .8];
const PA = [11.3, 13.7, 17.9, 15.1], PB = [9.1, 12.3, 10.7, 14.9], FA = [.3, 2.1, 4, 5.3], FB = [1.1, 3.7, .4, 2.9];
const RB = [8.3, 10.9, 9.7, 12.1], DR = [19.7, 23.3, 17.1, 27.9];

/** The field covers the card's bottom 72 CSS px on a 2 px row grid, 4 px columns. */
export const AURA_G = 72, AURA_CELL = 2, AURA_CELLX = 4, AURA_ROWS = AURA_G / AURA_CELL;
const LUT_N = 1024, LUT_K = LUT_N / 2.4;
/** Paused: crest x .68, light x .48. `ms` is the ease both ways. */
export const PAUSE = { ms: 1000, sink: .32, dim: .52 };
/** A new track's colours ease in OKLab over this long, on cubic-bezier(.4, 0, .2, 1). */
export const PALETTE_EASE_MS = 900;

const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Colour: sRGB 0..1 <-> OKLab ─────────────────────────────────────────────────────────────────────────────────────────────
const lin = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const gam = (c: number) => c <= .0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - .055;
export function toLab([r, g, b]: readonly number[]): number[] {
  const R = lin(r), Gc = lin(g), B = lin(b);
  const l = Math.cbrt(.4122214708 * R + .5363325363 * Gc + .0514459929 * B), m = Math.cbrt(.2119034982 * R + .6806995451 * Gc + .1073969566 * B), s = Math.cbrt(.0883024619 * R + .2817188376 * Gc + .6299787005 * B);
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s];
}
export function toRgb([L, a, b]: readonly number[]): number[] {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [gam(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s), gam(-.0041960863 * l - .7034186147 * m + 1.7076147010 * s)].map(v => Math.min(1, Math.max(0, v)));
}
/** cubic-bezier(.4, 0, .2, 1) at progress x (Newton). */
export function paletteCurve(x: number): number {
  let t = x;
  for (let i = 0; i < 6; i++) {
    const cx = 3 * .4 * t * (1 - t) ** 2 + 3 * .2 * t * t * (1 - t) + t ** 3 - x, d = 3 * .4 * (1 - t) ** 2 + 6 * (.2 - .4) * t * (1 - t) + 3 * (1 - .2) * t * t;
    if (Math.abs(d) < 1e-6) break; t = Math.min(1, Math.max(0, t - cx / d));
  }
  return 3 * t * t * (1 - t) + t ** 3;
}
/** The four colours between two palettes (OKLab triples) at eased progress `k` (0..1). */
export function mixPalettes(from: readonly number[][], to: readonly number[][], k: number): number[][] {
  return to.map((target, i) => target.map((x, j) => from[i][j] + (x - from[i][j]) * k));
}
/** The pause ease: pz (0 playing .. 1 paused) from the linear progress u. */
export const pauseEase = (u: number) => .5 - .5 * Math.cos(Math.PI * u);
/** One step of the linear progress u towards `target` (0 or 1) over dt seconds (play is the same curve backwards). */
export const stepPause = (u: number, target: number, dt: number) => target > u ? Math.min(1, u + dt * 1000 / PAUSE.ms) : Math.max(0, u - dt * 1000 / PAUSE.ms);

/** Additive light V (0..1 per channel) as un-premultiplied RGBA: alpha = brightest channel, colour = V / alpha. */
function put(d: Uint8ClampedArray, o: number, r: number, g: number, b: number) {
  const a = Math.min(1, Math.max(r, g, b));
  if (a < 1 / 512) { d[o + 3] = 0; return; }
  d[o] = Math.min(255, r / a * 255); d[o + 1] = Math.min(255, g / a * 255); d[o + 2] = Math.min(255, b / a * 255); d[o + 3] = a * 255;
}

export interface AuraFrame {
  /** Columns: the card's width / 4 CSS px. The field is `columns` x AURA_ROWS RGBA pixels, the border `columns` x 1. */
  columns: number;
  /** Clock seconds (frozen while paused). */
  t: number;
  /** The pause ease, 0 playing .. 1 paused. */
  pz: number;
  /** The four colours, sRGB 0..1. */
  colors: readonly number[][];
  /** The light theme: laid normally, the border is not lifted towards white. */
  light: boolean;
}
export interface AuraKernel { render(frame: AuraFrame, field: Uint8ClampedArray, edge: Uint8ClampedArray): void }

/** The kernel keeps its tables and scratch arrays, so a frame allocates nothing. */
export function createAuraKernel(): AuraKernel {
  // The vertical falloff f(u) = exp(-u^fall) * (1 - smoothstep(1.2, 2.4, u)), u = height / crest, as a 1024-step table (error < 1e-5).
  const lut = new Float32Array(LUT_N + 2);
  for (let k = 0; k <= LUT_N + 1; k++) { const u = k / LUT_K; lut[k] = u >= 2.4 ? 0 : Math.exp(-(u ** V.fall)) * (1 - sm(1.2, 2.4, u)); }
  const hk = new Float64Array(4), mm = new Float64Array(4), br = new Float64Array(4), pa = new Float64Array(4), pb = new Float64Array(4), pr = new Float64Array(4);
  const raw = new Float64Array(4), ih = new Float64Array(4), pn = new Float64Array(4), pw = new Float64Array(4), col = new Float64Array(12), lcol = new Float64Array(12);
  const rowY = new Float64Array(AURA_ROWS), rowTop = new Float64Array(AURA_ROWS);
  for (let yi = 0; yi < AURA_ROWS; yi++) { rowY[yi] = (AURA_ROWS - 1 - yi + .5) * AURA_CELL; rowTop[yi] = 1 - sm(AURA_G - 30, AURA_G, rowY[yi]); }
  return {
    render({ columns: nx, t, pz, colors: c, light }, d, ed) {
      const sp = V.spd, sink = 1 - PAUSE.sink * pz, dim = 1 - PAUSE.dim * pz;
      // Each layer's own height breathes out of phase (hb), so the strata trade places (which colour rides on top changes). Everything
      // that depends on time only is computed once per frame, not per column.
      for (let i = 0; i < 4; i++) {
        hk[i] = V.H * V.s[i] * (1 + V.hb * Math.sin(TAU * t / (RH[i] * sp) + FH[i])) * sink;
        mm[i] = HOME[i] + V.drift * Math.sin(TAU * t / (DR[i] * sp) + i * 1.3);
        br[i] = 1 + V.breath * Math.sin(TAU * t / (RB[i] * sp) + i * 1.7);
        pa[i] = TAU * t / (PA[i] * sp) + FA[i]; pb[i] = -TAU * t / (PB[i] * sp) + FB[i]; pr[i] = (i % 2 ? 1 : -1) * TAU * t / (6.1 * sp) + i * 1.9;
        col[i * 3] = c[i][0]; col[i * 3 + 1] = c[i][1]; col[i * 3 + 2] = c[i][2];
        for (let j = 0; j < 3; j++) lcol[i * 3 + j] = light ? c[i][j] : c[i][j] * .72 + .28;
      }
      const wa = TAU * t / (13.1 * sp), wb = TAU * t / (9.7 * sp), gk = V.gain * dim, ek = .85 * dim, isig = 1 / V.sig;
      for (let xi = 0; xi < nx; xi++) {
        const x = (xi + .5) / nx;
        let tot = 1e-6; const dome = 1 - V.dome + V.dome * Math.sin(Math.PI * x);
        for (let i = 0; i < 4; i++) {
          const xw = x + V.warp * (.6 * Math.sin(TAU * .5 * x + wa + .3 + WPH[i]) + .4 * Math.sin(TAU * .95 * x - wb + 1.9 + WPH[i] * .7));
          const q = (xw - mm[i]) * isig; raw[i] = Math.exp(-q * q) * br[i]; tot += raw[i];
          ih[i] = LUT_K / (hk[i] * dome * (1 + V.A * (.6 * Math.sin(TAU * V.k1 * x + pa[i]) + .4 * Math.sin(TAU * V.k2 * x + pb[i])) + V.R * Math.sin(TAU * 2.2 * x + pr[i])));
        }
        const env = sm(0, .26, x) * sm(0, .26, 1 - x);
        for (let i = 0; i < 4; i++) { pn[i] = raw[i] / tot; pw[i] = pn[i] * env * gk; }
        // The field, rows from the top of the canvas (row ROWS-1 sits on the bottom edge).
        for (let yi = 0; yi < AURA_ROWS; yi++) {
          const y = rowY[yi]; let r = 0, g = 0, b = 0;
          for (let i = 0; i < 4; i++) {
            const q = y * ih[i]; if (q >= LUT_N || pw[i] < 1e-5) continue;
            const qi = q | 0, w = pw[i] * (lut[qi] + (lut[qi + 1] - lut[qi]) * (q - qi));
            r += col[i * 3] * w; g += col[i * 3 + 1] * w; b += col[i * 3 + 2] * w;
          }
          const k = rowTop[yi]; put(d, (yi * nx + xi) * 4, r * k, g * k, b * k);
        }
        // The lit bottom border: the colour right above it, lifted toward white in dark.
        let er = 0, eg = 0, eb = 0;
        for (let i = 0; i < 4; i++) { const p = pn[i]; er += lcol[i * 3] * p; eg += lcol[i * 3 + 1] * p; eb += lcol[i * 3 + 2] * p; }
        put(ed, xi * 4, er * ek, eg * ek, eb * ek);
      }
    },
  };
}
