/**
 * Noël's snow, as numbers (a port of the motion study's physics, the design notes).
 * No DOM in this file: the world is plain data, every function takes it first, and a seeded `rnd` makes a run repeatable, so a test can hold the rules.
 *
 *  - A LEDGE is a cushion of snow on something with a top edge (the selected tab's plate, the address field, New Tab's search box). Its heights are
 *    columns 2 px wide, local to the cushion's own picture (x0 = .5 .. x1 = width - .5, `y` = where the plate's top edge is).
 *  - Where a ledge stands on screen (in the sidebar's coordinates) is `Placed`: the controller reads it from the DOM; flakes land and clumps start there.
 *  - WEIGHT: the selected cushion is a mass on a damped spring (stiffness 300, damping 17) driven by the plate's acceleration.
 *  - FLAKES fall in the sidebar (about 16 in a Standard one), land on a cushion or in the DRIFT along the bottom, and are drawn by `draw.ts`.
 */
export type Rng = () => number;
export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A seeded generator (mulberry32), for repeatable runs and tests. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export type LedgeId = 'sel' | 'addr' | 'ntp';
export interface Ledge {
  id: LedgeId;
  /** The plate's width in px; the columns run from x0 to x1 (half a px in from each side). */
  width: number; x0: number; x1: number;
  /** Where the plate's top edge is, in the cushion's own picture (px from its top). */
  y: number;
  /** The deepest the snow gets (px), how much of a landing flake it keeps (1), and the radius of the plate's rounded corners (0: none). */
  max: number; catch: number; rad: number;
  /** One height per 2 px column. */
  h: Float32Array;
  spark: number[]; jag: Float32Array; shape: Float32Array;
  /** How full it was before a brush (set while brushed), and when it was last brushed (ms), and what the brush has pushed to an end and not yet dropped. */
  full?: number; brushedAt?: number; spillAcc?: number;
  /** Its picture is out of date. */
  dirty: boolean;
}
/** Where a ledge's plate-top line is in the sidebar's canvas (px): flakes land on it, clumps start from it. Only ledges inside the sidebar are placed. */
export interface Placed { e: Ledge; x0: number; x1: number; y: number }
export interface Flake { cls: FlakeClass; r: number; a: number; vy: number; amp: number; fq: number; ph: number; ph2: number; px: number; py: number; fade: number; rot: number; vr: number; sp: number; life: number; x: number; y: number }
export interface Clump { x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number }
export interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number; t: number; g?: number }
export interface Drift { n: number; h: Float32Array; shape: Float32Array; max: number; lvl: number; dirty: boolean }
export interface FlakeClass { id: 'far' | 'mid' | 'near'; r: [number, number]; a: [number, number]; vy: [number, number]; amp: [number, number]; f: [number, number]; dens: number; wk: number }

/** Three sizes, about 16 flakes in a 240 x 760 sidebar (density per px squared, so a wide sidebar is not busier). */
export const CLASSES: FlakeClass[] = [
  { id: 'far', r: [1.7, 2.2], a: [.36, .5], vy: [14, 20], amp: [3, 6], f: [.4, .8], dens: 1 / 30000, wk: .6 },
  { id: 'mid', r: [3.0, 4.0], a: [.82, .95], vy: [22, 32], amp: [5, 9], f: [.3, .7], dens: 1 / 24000, wk: 1 },
  { id: 'near', r: [4.4, 5.8], a: [.7, .85], vy: [34, 46], amp: [7, 12], f: [.25, .5], dens: 1 / 110000, wk: 1.3 },
];
/** How much of a landing flake sticks. */
export const STICK = .7;
/** Size of a cushion's picture: where the plate's top edge sits in it, and how far below it the picture reaches. */
export const CUSHION_PAD = 9, CUSHION_LOW = 9;
/** The drift's picture is this tall at the foot of the sidebar. */
export const DRIFT_PICTURE = 22;

export interface World {
  rnd: Rng;
  dark: boolean;
  /** The sidebar canvas's size (px). */
  W: number; H: number;
  flakes: Flake[]; clumps: Clump[]; puffs: Puff[];
  drift: Drift | null;
  placed: Record<string, Placed>;
  def: { d: number; v: number; broke: boolean };
  plate: { y: number; v: number; a: number; t: number };
  /** The person's choice, and what the system allows. */
  snow: 'sidebar' | 'window' | 'off';
  amount: number;
  eligible: boolean;
  resting: boolean;
  flurry: number;
  rampT0: number;
  /** Reduce motion: brushed snow is simply gone, nothing flies. */
  reduced: boolean;
  settling: boolean; weightActive: boolean;
  /** Set when something that needs a frame has happened (a clump started, ...): the controller starts its loop. */
  wake: boolean;
  /** The pointer, in sidebar coordinates. */
  ptr: { x: number; y: number; vx: number; vy: number };
  trick: number; trickT: number;
  /** The last frame's flurry strength (0 to 1). */
  flu: number;
  /** D176 (reported 24 Nov: "either make it a nice snowy pile ... or just don't make any precipitation"; the team's pick between the team's two outcomes: none): with no drift, a flake
   *  melts away over the last FOOT_MELT px before the bottom instead of settling there. Set by the sidebar's controller; the snow window's page has its own fade. */
  footMelt: boolean;
  /** "Shake the globe" (the tree's menu): when it started (ms), 0 when none runs. */
  globe: number;
}

export function createWorld(opts: { rnd?: Rng; dark?: boolean; W?: number; H?: number } = {}): World {
  return {
    rnd: opts.rnd ?? Math.random, dark: opts.dark ?? true, W: opts.W ?? 240, H: opts.H ?? 760,
    flakes: [], clumps: [], puffs: [], drift: null, placed: {}, def: { d: 0, v: 0, broke: false }, plate: { y: 0, v: 0, a: 0, t: 0 },
    snow: 'sidebar', amount: 1, eligible: true, resting: false, flurry: 0, rampT0: 0, reduced: false, settling: false, weightActive: false, wake: false,
    ptr: { x: -999, y: -999, vx: 0, vy: 0 }, trick: 0, trickT: 0, flu: 0, footMelt: false, globe: 0,
  };
}
const R = (w: World, a: number, b: number): number => a + w.rnd() * (b - a);

/* ---------- ledges ---------- */
/** A plate under something that clips its top (the address field right under the window's edge, a tab strip's pill): the snow lies along the inside of its top edge. */
/** An inside cap (a field, a clipped plate): its snow lies just within the plate's rim, concentric with its outline (the controller clips it to that outline). New Tab's field is
 *  taller and its snow a little deeper. */
export const INSIDE_Y = 1.6, INSIDE_NTP = 2;
/** `y`: where the plate's top edge is in the cushion's picture. A tab's snow sits on top of its plate (9 px of room above it); the address field sits right under the window's top edge, where
 *  nothing can overflow its clip, so its snow lies along the inside of its top edge (a hair of room). */
const LEDGE_KINDS: Record<LedgeId, { max: number; catch: number; rad: number; y: number }> = {
  sel: { max: 5.2, catch: 1, rad: 9, y: CUSHION_PAD },
  addr: { max: 3.8, catch: .9, rad: 0, y: INSIDE_Y },
  ntp: { max: 4.4, catch: .9, rad: 0, y: INSIDE_NTP },
};
export function createLedge(w: World, id: LedgeId, width: number, rad?: number): Ledge {
  const k = LEDGE_KINDS[id], n = Math.max(4, Math.round((width - 1) / 2));
  const q1 = R(w, 0, 6), q2 = R(w, 0, 6), p1 = R(w, 0, 6), p2 = R(w, 0, 6), p3 = R(w, 0, 6);
  return {
    id, width, x0: .5, x1: width - .5, y: k.y, max: k.max, catch: k.catch, rad: rad ?? k.rad, h: new Float32Array(n), spark: Array.from({ length: 9 }, () => w.rnd()),
    jag: Float32Array.from({ length: n }, (_, i) => clamp(.45 + .3 * Math.sin(i * .83 + q1) * Math.sin(i * .29 + q2) + R(w, -.18, .18), 0, .95)),
    shape: Float32Array.from({ length: n }, (_, i) => clamp(.5 + .3 * Math.sin(i * .19 + p1) + .22 * Math.sin(i * .07 + p2) + .12 * Math.sin(i * .43 + p3), 0, 1)),
    dirty: true,
  };
}
/** The plate got another width (a sidebar of another size): the snow keeps its shape, resampled to the new columns. */
export function resizeLedge(w: World, e: Ledge, width: number): void {
  if (Math.abs(e.width - width) < .5) return;
  const n = Math.max(4, Math.round((width - 1) / 2)), old = e.h, oldShape = e.shape, oldJag = e.jag, m = old.length;
  e.h = new Float32Array(n); e.shape = new Float32Array(n); e.jag = new Float32Array(n);
  for (let i = 0; i < n; i++) { const j = Math.min(m - 1, Math.floor(i * m / n)); e.h[i] = old[j]; e.shape[i] = oldShape[j]; e.jag[i] = oldJag[j]; }
  e.width = width; e.x0 = .5; e.x1 = width - .5; e.dirty = true;
}
export const meanOf = (e: Ledge): number => { let m = 0; for (let i = 0; i < e.h.length; i++) m += e.h[i]; return m / e.h.length; };

/** Snow lands on a cushion at local x (a Gaussian pile, then the pile slumps where it is steeper than snow would stand). */
export function deposit(e: Ledge, x: number, amount: number): void {
  e.dirty = true; const n = e.h.length, i0 = (x - e.x0) / 2, sig = 3.2; if (Math.min(i0, n - 1 - i0) < 2) return;
  for (let i = Math.max(0, Math.floor(i0 - 9)); i <= Math.min(n - 1, Math.ceil(i0 + 9)); i++) { const wt = Math.exp(-((i - i0) * (i - i0)) / (2 * sig * sig)); e.h[i] = Math.min(e.max, e.h[i] + amount * e.catch * wt * .55 * (1 - e.h[i] / e.max * .6)); }
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < n; i++) { const d = e.h[i] - e.h[i - 1]; if (Math.abs(d) > .3) { const m = (Math.abs(d) - .3) / 2 * Math.sign(d); e.h[i] -= m; e.h[i - 1] += m; } }
}

/* ---------- weight ---------- */
/** The plate's position now (px, any one frame of reference): its velocity and acceleration follow, smoothed. */
export function platePush(w: World, y: number, now: number): void {
  const P = w.plate, dt = (now - P.t) / 1000;
  if (!(dt > 0) || dt > .12) { P.y = y; P.v = 0; P.a = 0; P.t = now; return; }
  // the plate's acceleration is capped: a drag's first frame (the preview appears under the pointer) or a stalled frame is a step, not a push, so the snow lifts a hair and never leaps
  const v = (y - P.y) / Math.max(.008, dt); P.a = P.a * .45 + clamp((v - P.v) / Math.max(.008, dt), -6000, 6000) * .55; P.v = v; P.y = y; P.t = now;
}
/** The selected cushion's spring: the snow lags behind a plate that starts or stops, lifts a hair, presses flat, settles with one soft bounce. Returns whether it still moves. */
export function stepWeight(w: World, dt: number, now: number): boolean {
  const D = w.def, P = w.plate, p = w.placed.sel; if (!p) return false;
  const a = now - P.t < 70 ? P.a : 0, k = 300, c = 17, kap = .07;
  D.v += (-k * D.d - c * D.v + a * kap) * dt; D.d = clamp(D.d + D.v * dt, -1.8, 3.2);
  if (D.d > 1.5 && !D.broke) { D.broke = true; breakOff(w, p, P.v); }
  if (D.d < .8) D.broke = false;
  return Math.abs(D.d) > .01 || Math.abs(D.v) > .05;
}
/** A hard jerk breaks a clump off one end of the cushion; it falls with gravity. */
export function breakOff(w: World, p: Placed, pv: number): void {
  const e = p.e; e.dirty = true; const n = e.h.length, mean = meanOf(e); if (mean < .35) return;
  const right = w.rnd() < .5, c0 = right ? n - 1 - Math.floor(R(w, 5, 13)) : Math.floor(R(w, 5, 13)); let took = 0;
  for (let i = Math.max(0, c0 - 10); i <= Math.min(n - 1, c0 + 10); i++) { const wt = 1 - Math.abs(i - c0) / 11, cut = e.h[i] * .55 * wt; e.h[i] -= cut; took += cut; }
  const pieces = took > 6 ? 2 : 1;
  for (let k = 0; k < pieces; k++) w.clumps.push({ x: p.x0 + c0 * 2 + R(w, -3, 3), y: p.y - 2.6, vx: (right ? 1 : -1) * R(w, 8, 34), vy: pv * .5 - R(w, 20, 55), r: clamp(1.7 + took * .1, 1.9, 3.3) * (k ? .72 : 1), rot: R(w, 0, 6.28), vr: R(w, -3, 3) });
  w.wake = true;
}
/** A tab that closes drops all its snow: two to four clumps, by weight. */
export function dropAll(w: World, p: Placed | undefined, e: Ledge, now = 0): void {
  e.dirty = true; const n = e.h.length; let total = 0; for (let i = 0; i < n; i++) total += e.h[i];
  // the next tab's plate starts bare and fills again (where snow falls, from the flakes; where none falls, by itself after a pause, as after a brush)
  if (now) { e.full = Math.max(.6, total / n); e.brushedAt = now; }
  if (total < 8 || !p || w.reduced) { e.h.fill(0); return; }
  const pieces = clamp(Math.round(total / 40), 2, 4);
  for (let k = 0; k < pieces; k++) { const i = Math.floor((k + .5) / pieces * n); w.clumps.push({ x: p.x0 + i * 2 + R(w, -4, 4), y: p.y - 2.4, vx: R(w, -14, 14), vy: R(w, -30, -5), r: R(w, 2.2, 3.3), rot: R(w, 0, 6.28), vr: R(w, -3, 3) }); }
  e.h.fill(0); w.wake = true;
}
/** Clumps fall with gravity (900 px/s squared) and crumble into the drift where they land. */
export function stepClumps(w: World, dt: number): void {
  for (let i = w.clumps.length - 1; i >= 0; i--) {
    const c = w.clumps[i]; c.vy += 900 * dt; c.vx *= Math.exp(-dt * .8); c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
    const floor = w.drift ? driftTop(w, clamp(c.x, 0, w.W - 1)) : w.H - 20;
    if (c.y + c.r * .6 >= floor) {
      const k0 = c.r > 1.5 ? 4 : 1;
      for (let k = 0; k < k0; k++) w.puffs.push({ x: c.x + R(w, -2, 2), y: floor - 1, vx: R(w, -30, 30), vy: R(w, -50, -16), r: R(w, .6, 1.1), life: R(w, .24, .4), t: 0, g: 520 });
      if (w.drift) driftAdd(w, clamp(c.x, 2, w.W - 2), c.r * .9);
      w.clumps[i] = w.clumps[w.clumps.length - 1]; w.clumps.pop();
    }
  }
}
export function stepPuffs(w: World, dt: number): void { for (let i = w.puffs.length - 1; i >= 0; i--) { const p = w.puffs[i]; p.t += dt; p.vy += (p.g || 150) * dt; p.vx *= Math.exp(-dt * 1.6); p.x += p.vx * dt; p.y += p.vy * dt; if (p.t > p.life) { w.puffs[i] = w.puffs[w.puffs.length - 1]; w.puffs.pop(); } } }
/** Grains and clumps come off a cushion (picking a tab up, while it moves, putting it down). Returns how much was taken. */
export function shed(w: World, p: Placed | undefined, n: number, big: boolean, pv: number): number {
  if (!p || w.reduced) return 0; const e = p.e; e.dirty = true; const m = e.h.length; if (meanOf(e) < .4) return 0;
  let took = 0;
  for (let k = 0; k < n; k++) {
    const right = w.rnd() < .5, c0 = right ? m - 1 - Math.floor(R(w, 5, 15)) : Math.floor(R(w, 5, 15)), wd = big ? 7 : 3; let t = 0;
    for (let i = Math.max(0, c0 - wd); i <= Math.min(m - 1, c0 + wd); i++) { const wt = 1 - Math.abs(i - c0) / (wd + 1), cut = e.h[i] * (big ? .4 : .18) * wt; e.h[i] -= cut; t += cut; }
    took += t;
    w.clumps.push({ x: p.x0 + c0 * 2 + R(w, -1.5, 1.5), y: p.y - R(w, 1, 2.4), vx: (right ? 1 : -1) * R(w, big ? 4 : 3, big ? 14 : 12), vy: (pv || 0) * .4 - R(w, big ? 20 : 8, big ? 50 : 34), r: big ? clamp(2.2 + t * .12, 2.4, 3.2) : R(w, 1.3, 1.8), rot: R(w, 0, 6.28), vr: R(w, -3, 3) });
  }
  w.wake = true; return took;
}

/* ---------- brushing ---------- */
/** The pointer brushes the snow at local x, moving sideways at vx (px/s): half of what is within 10 columns, pushed 55 % into a ridge 12 columns ahead. */
export function brushAt(w: World, p: Placed | undefined, e: Ledge, x: number, vx: number, now: number): void {
  const n = e.h.length, dir = Math.sign(vx) || 1, i0 = (x - e.x0) / 2, R0 = 10;
  if (e.full === undefined) e.full = Math.max(.6, meanOf(e)); e.brushedAt = now;
  let took = 0;
  for (let i = Math.max(0, Math.floor(i0 - R0)); i <= Math.min(n - 1, Math.ceil(i0 + R0)); i++) { const wt = Math.max(0, 1 - Math.abs(i - i0) / R0), cut = e.h[i] * .5 * wt; e.h[i] -= cut; took += cut; }
  if (took < .04) return; e.dirty = true;
  if (w.reduced) return;                                   // Reduce motion: it is simply gone, nothing flies
  const ahead = i0 + dir * 12;
  if (ahead < 1 || ahead > n - 2) spill(w, p, e, dir > 0 ? n - 1 : 0, took * .55, vx);        // pushed off the end: it gathers there and slides off as a clump
  else for (let i = Math.max(0, Math.floor(ahead - 5)); i <= Math.min(n - 1, Math.ceil(ahead + 5)); i++) { const wt = Math.max(0, 1 - Math.abs(i - ahead) / 5); e.h[i] = Math.min(e.max * 1.15, e.h[i] + took * .55 * wt / 5); }   // it ploughs a small ridge ahead of the brush
  if (p && w.rnd() < .06) { w.clumps.push({ x: p.x0 + (x - e.x0) + dir * R(w, 3, 10), y: p.y - 1, vx: vx * .1, vy: R(w, -12, 8), r: R(w, .9, 1.4), rot: R(w, 0, 6.28), vr: R(w, -3, 3) }); w.wake = true; }   // a grain off the front edge
}
function spill(w: World, p: Placed | undefined, e: Ledge, col: number, amount: number, vx: number): void {
  // what the brush pushes off the end gathers there and leaves as a clump each time enough has gathered: one or two clumps a stroke, not a spray
  e.spillAcc = (e.spillAcc || 0) + amount; if (!p) { e.spillAcc = 0; return; }
  const x = p.x0 + col * 2;
  while (e.spillAcc > 3) { e.spillAcc -= 3; w.clumps.push({ x: x + Math.sign(vx) * R(w, 2, 6), y: p.y - R(w, 1.5, 3), vx: vx * R(w, .08, .14), vy: R(w, -22, 2), r: R(w, 2.3, 3.1), rot: R(w, 0, 6.28), vr: R(w, -4, 4) }); w.wake = true; }
}
/** Where no snow falls on a brushed cushion, it settles back by itself: a pause of 2.5 s, then about a minute to full, gently (12 frames a second). */
export function settleBack(w: World, dt: number, now: number): boolean {
  let any = false;
  for (const k in w.placed) {
    const e = w.placed[k].e; if (e.full === undefined) continue;
    const fed = w.snow !== 'off' && w.eligible && !w.resting && (k === 'sel' || w.snow === 'window');
    if (fed) continue;                                       // it builds up again from the flakes that land
    if (now - (e.brushedAt || 0) < 2500) { any = true; continue; }
    if (meanOf(e) >= e.full * .97) { e.full = undefined; continue; }
    for (let j = 0; j < 2; j++) deposit(e, R(w, e.x0 + 4, e.x1 - 4), .38 * dt);
    any = true;
  }
  return any;
}
/** Ledges that are not placed in the sidebar (the address field's, New Tab's) settle back the same way: pass them in by id. */
export function settleLedges(w: World, ledges: Ledge[], dt: number, now: number): boolean {
  let any = false;
  for (const e of ledges) {
    if (e.full === undefined) continue;
    const fed = w.snow === 'window' && w.eligible && !w.resting;
    if (fed) continue;
    if (now - (e.brushedAt || 0) < 2500) { any = true; continue; }
    if (meanOf(e) >= e.full * .97) { e.full = undefined; continue; }
    for (let j = 0; j < 2; j++) deposit(e, R(w, e.x0 + 4, e.x1 - 4), .38 * dt);
    any = true;
  }
  return any;
}

/* ---------- the drift by Personal ---------- */
/** How far above the bottom a flake starts to melt when nothing settles (footMelt). */
export const FOOT_MELT = 70;
export const DRIFT_MAX = 13;
/** A low bank along the sidebar's bottom: deeper in the two corners, behind the profile row. It rises slowly while it snows; grains and clumps that land make small heaps. */
export function buildDrift(w: World): void {
  const n = Math.round(w.W / 2) + 1, old = w.drift, d: Drift = { n, h: new Float32Array(n), shape: new Float32Array(n), max: DRIFT_MAX, lvl: old ? old.lvl : 0, dirty: true };
  if (old) for (let i = 0; i < n; i++) d.h[i] = old.h[Math.min(old.n - 1, Math.floor(i * old.n / n))];
  const p1 = R(w, 0, 6), p2 = R(w, 0, 6);
  d.shape = old && old.n === n ? old.shape : Float32Array.from({ length: n }, (_, i) => { const u = i / (n - 1); return clamp(.42 + .58 * Math.max(Math.exp(-Math.pow((u - .07) / .09, 2)), Math.exp(-(1 - u) / .08)) + .1 * Math.sin(i * .17 + p1) + .06 * Math.sin(i * .41 + p2), 0, 1.1); });
  w.drift = d;
}
export const driftH = (w: World, i: number): number => { const d = w.drift!; return clamp(d.lvl * 12 * d.shape[i] + d.h[i], 0, d.max); };
export const driftTop = (w: World, x: number): number => w.H - driftH(w, clamp(Math.round(x / 2), 0, w.drift!.n - 1));
export function driftAdd(w: World, x: number, amount: number): void {
  const d = w.drift; if (!d) return; d.dirty = true; const i0 = x / 2, sig = 3;
  for (let i = Math.max(0, Math.floor(i0 - 8)); i <= Math.min(d.n - 1, Math.ceil(i0 + 8)); i++) { const wt = Math.exp(-((i - i0) * (i - i0)) / (2 * sig * sig)); d.h[i] = Math.min(3.5, d.h[i] + amount * wt * .45); }
  for (let i = 1; i < d.n; i++) { const df = d.h[i] - d.h[i - 1]; if (Math.abs(df) > .35) { const m = (Math.abs(df) - .35) / 2 * Math.sign(df); d.h[i] -= m; d.h[i - 1] += m; } }
  d.lvl = Math.min(1, d.lvl + amount * .002);
}

/* ---------- flakes ---------- */
const noise1 = (t: number): number => { const i = Math.floor(t), f = t - i, h = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }; const u = f * f * (3 - 2 * f); return lerp(h(i), h(i + 1), u); };
export function mkFlake(w: World, cls: FlakeClass, x: number, y: number, life: number): Flake {
  return { cls, r: R(w, cls.r[0], cls.r[1]), a: R(w, cls.a[0], cls.a[1]), vy: R(w, cls.vy[0], cls.vy[1]), amp: R(w, cls.amp[0], cls.amp[1]), fq: R(w, cls.f[0], cls.f[1]), ph: R(w, 0, 6.28), ph2: R(w, 0, 6.28), px: 0, py: 0, fade: 0, rot: R(w, 0, 6.28), vr: R(w, -1.3, 1.3), sp: Math.floor(w.rnd() * 6), life, x, y };
}
const poisson = (w: World, l: number): number => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= w.rnd(); } while (p > L); return k - 1; };
/** The flakes that are in the air the moment snowfall starts (none where snow cannot fall: Off, Reduce motion, a low battery, a window that is away). */
export function seedField(w: World): void {
  w.flakes.length = 0; if (w.snow === 'off' || !w.eligible) return;
  for (const c of CLASSES) { const n = c.dens * w.amount * w.W * w.H, m = Math.floor(n) + (w.rnd() < n % 1 ? 1 : 0); for (let i = 0; i < m; i++) w.flakes.push(mkFlake(w, c, R(w, -8, w.W + 8), R(w, 0, w.H), 5)); }
}
/** THE SHAKE: pressing the tree is shaking a snow globe: a fuller fall for about 14 s. The snow appears all through the sidebar at once, lifted and swirled a little, then falls gently. */
export function burst(w: World): void {
  for (const c of CLASSES) { const n = Math.round(c.dens * w.amount * w.W * w.H * 1.25); for (let i = 0; i < n; i++) { const f = mkFlake(w, c, R(w, 4, w.W - 4), R(w, 8, w.H - 30), 0); f.px = R(w, -90, 90); f.py = -R(w, 40, 210); w.flakes.push(f); } }
}
/** How strong the flurry is (1 for 6 s, thinning to 0 at 9 s; the controller keeps its own 14 s shape on top of it). */
export function flurryEnv(w: World, now: number): number { if (!w.flurry) return 0; const t = (now - w.flurry) / 1000; if (t < 0) return 0; if (t < 6) return 1; if (t < 9) return 1 - (t - 6) / 3; w.flurry = 0; return 0; }
export function startFlurry(w: World, now: number): void { w.flurry = now; burst(w); }
/* ---------- "Shake the globe" (the tree's menu; the team 24 Nov: "it should actually shake the globe") ----------
 * Stronger than the tree's press (which stays the flurry above, untouched): what lies in the drift and on the caps is thrown up, two quick alternating pushes carry
 * everything left and right, a swirl carries it round inside the sidebar (the globe's glass: nothing leaves it), and then it all settles back into the fall, with the
 * flurry after it. GLOBE_MS long; during it nothing lands, so the caps and the drift fill again only afterwards, from the fall. */
export const GLOBE_MS = 1600, GLOBE_TAKE = .55, GLOBE_MAX_THROWN = 90;
const GLOBE_PUSH = 1100, GLOBE_PUSH_PERIOD = .36, GLOBE_PUSH_END = .72, GLOBE_SWIRL = 300;
/** Start it: lying snow thrown up as flakes (a share of the drift and of every placed cap), the flurry, and the forces `step` applies for GLOBE_MS. */
export function shakeGlobe(w: World, now: number): void {
  w.globe = now; startFlurry(w, now);
  const thrown: Array<[number, number, number]> = [];   // x, y, height of what lay there
  const d = w.drift;
  if (d) { for (let i = 0; i < d.n; i += 2) { const h = driftH(w, i); if (h > .5) thrown.push([i * 2, w.H - h * .5, h]); } for (let i = 0; i < d.n; i++) d.h[i] *= 1 - GLOBE_TAKE; d.lvl *= 1 - GLOBE_TAKE; d.dirty = true; }
  for (const P of Object.values(w.placed)) { const e = P.e; for (let i = 0; i < e.h.length; i += 3) if (e.h[i] > .4) thrown.push([P.x0 + i * 2, P.y - e.h[i] * .5, e.h[i]]); for (let i = 0; i < e.h.length; i++) e.h[i] *= 1 - GLOBE_TAKE; e.dirty = true; }
  // the deepest snow throws the most; never more than GLOBE_MAX_THROWN flakes
  thrown.sort((a, b) => b[2] - a[2]);
  for (const [x, y, h] of thrown.slice(0, GLOBE_MAX_THROWN)) {
    // a puff, not a row: each starts somewhere in the snow it came from (up to 14 px above it) and leaves at its own speed
    const c = CLASSES[w.rnd() < .3 ? 2 : 1], f = mkFlake(w, c, clamp(x + R(w, -3, 3), 6, w.W - 6), clamp(y - R(w, 0, 14), 6, w.H - 6), .4);
    f.px = R(w, -140, 140); f.py = -R(w, 120, 260 + 40 * Math.min(h, 8)); w.flakes.push(f);
  }
}
/** The globe's forces this frame (px/s squared on each flake's own push), its walls, and whether flakes may land: pure in time. */
export function globeForce(w: World, now: number): { on: boolean; ax: number; swirl: number } {
  if (!w.globe) return { on: false, ax: 0, swirl: 0 };
  const t = (now - w.globe) / 1000; if (t < 0) return { on: false, ax: 0, swirl: 0 };
  if (t >= GLOBE_MS / 1000) { w.globe = 0; return { on: false, ax: 0, swirl: 0 }; }
  const push = t < GLOBE_PUSH_END ? GLOBE_PUSH * Math.sin(2 * Math.PI * t / GLOBE_PUSH_PERIOD) * (t < .5 ? 1 : (GLOBE_PUSH_END - t) / (GLOBE_PUSH_END - .5)) : 0;
  const swirl = t < .25 ? GLOBE_SWIRL * t / .25 : t < 1.1 ? GLOBE_SWIRL : GLOBE_SWIRL * Math.max(0, 1 - (t - 1.1) / (GLOBE_MS / 1000 - 1.1));
  return { on: true, ax: push, swirl };
}

export interface StepOutcome { active: boolean }
/** One frame of the world: new flakes arrive while it snows, the flakes fall and land, clumps and grains fall. `now` in ms. */
export function step(w: World, dt: number, now: number): void {
  w.flu = flurryEnv(w, now);
  const amb = w.snow !== 'off' && !w.resting && w.eligible ? clamp((now - w.rampT0) / 4500, 0, 1) * .7 : 0, ramp = Math.max(amb, w.flu), wind = 1 + 13 * noise1(now * .00006 + 7);
  if (ramp > 0 && w.eligible) for (const c of CLASSES) {
    const life = Math.max(.5, (w.H + 20) / ((c.vy[0] + c.vy[1]) / 2)), rate = c.dens * w.amount * w.W * w.H / life * ramp, n = poisson(w, rate * dt);
    for (let i = 0; i < n; i++) { const f = mkFlake(w, c, R(w, -8, w.W + 8), -c.r[1] - 4, 0); w.flakes.push(f); }
  }
  if (ramp > 0 && w.drift && w.drift.lvl < 1) { w.drift.lvl = Math.min(1, w.drift.lvl + dt * ramp * .01); w.drift.dirty = true; }   // the drift by Personal rises while it snows
  const k = Math.exp(-dt / .7), placed = Object.values(w.placed);
  const gl = globeForce(w, now), gcx = w.W / 2, gcy = w.H * .48, gax = w.W * .42, gay = w.H * .42;
  for (let i = w.flakes.length - 1; i >= 0; i--) {
    const f = w.flakes[i];
    f.px *= k; f.py *= k; f.life += dt;
    if (gl.on) {
      // the swirl follows an ellipse the shape of the sidebar (a tall glass), with a pull inward past most of its size, so the flakes go round instead of into the walls
      const dx = f.x - gcx, dy = f.y - gcy, u = dx / gax, v = dy / gay, r = Math.max(.15, Math.hypot(u, v)), tx = -v * gax, ty = u * gay, tn = Math.max(1, Math.hypot(tx, ty));
      const pull = r > .7 ? (r - .7) * 900 : 0;
      f.px += (gl.ax + tx / tn * gl.swirl - u / r * pull) * dt; f.py += (ty / tn * gl.swirl - v / r * pull) * dt;
      // soft walls: a push back inside the last 14 px of each side
      const near = 14; if (f.x < near) f.px += 1400 * (1 - f.x / near) * dt; else if (f.x > w.W - near) f.px -= 1400 * (1 - (w.W - f.x) / near) * dt;
      if (f.y < near) f.py += 1400 * (1 - f.y / near) * dt;
    }
    const sway = f.amp * (.62 * Math.sin(f.ph + now * .0031 * f.fq) + .38 * Math.sin(f.ph2 + now * .0019 * f.fq)) * (.6 + .8 * noise1(now * .0002 + f.ph));
    const vx = wind * f.cls.wk + sway + f.px, vy = f.vy + f.py, oy = f.y;
    f.x += vx * dt; f.y += vy * dt; f.rot += f.vr * dt;
    if (gl.on) {   // the globe's glass: nothing leaves the sidebar while it shakes
      if (f.x < 3) { f.x = 3; f.px = Math.abs(f.px) * .5; } else if (f.x > w.W - 3) { f.x = w.W - 3; f.px = -Math.abs(f.px) * .5; }
      if (f.y < 3) { f.y = 3; f.py = Math.abs(f.py) * .5; } else if (f.y > w.H - 4) { f.y = w.H - 4; f.py = -Math.abs(f.py) * .4; }
    }
    if (w.resting && w.snow !== 'off') f.fade += dt / 3.2;
    if (w.footMelt && !w.drift && f.y > w.H - FOOT_MELT) f.fade += dt / .9;
    let dead = f.fade >= 1 || f.y > w.H + 12 || f.x < -30 || f.x > w.W + 30;
    if (!dead && f.cls.id !== 'far' && !w.resting && !gl.on) {
      for (const P of placed) { if (oy < P.y && f.y >= P.y && f.x > P.x0 && f.x < P.x1) { if (w.rnd() < STICK) { deposit(P.e, f.x - P.x0 + P.e.x0, (f.cls.id === 'near' ? 1.1 : .6) * (w.flu > 0 ? 12 : 2.4)); dead = true; } break; } }
    }
    // what reaches the bottom of the sidebar settles in the drift by Personal
    if (!dead && !gl.on && w.drift && f.cls.id !== 'far' && f.x > 1 && f.x < w.W - 1 && f.y >= driftTop(w, f.x)) { if (w.rnd() < .85) driftAdd(w, f.x, f.cls.id === 'near' ? 1.1 : .7); dead = true; }
    if (dead) { w.flakes[i] = w.flakes[w.flakes.length - 1]; w.flakes.pop(); }
  }
  w.weightActive = stepWeight(w, dt, now); stepClumps(w, dt); stepPuffs(w, dt);
}
/** The pointer moves through the sidebar and the flakes near it part around it. */
export function disturb(w: World, x: number, y: number, vx: number, vy: number): void {
  const Rr = 84;
  for (const f of w.flakes) { const dx = f.x - x, dy = f.y - y, d = Math.hypot(dx, dy); if (d < Rr && d > .1) { const k = Math.pow(1 - d / Rr, 2); f.px += dx / d * 38 * k + vx * .05 * k; f.py += dy / d * 18 * k + vy * .03 * k; } }
}
/** A tab dragged beside the flakes sweeps them along. */
export function sweepAlong(w: World, rowMid: number, v: number): void {
  for (const f of w.flakes) { const d = Math.abs(f.y - rowMid); if (d < 70) { const k = 1 - d / 70; f.px += (w.rnd() * 2 - 1) * Math.abs(v) * .12 * k; f.py += v * .35 * k; } }
}
/** Picking a dragged tab up: the snow gives a little and a grain or two rolls off an end. */
export function dragLift(w: World): void { const p = w.placed.sel; if (!p || w.reduced) return; w.def.v -= 9; shed(w, p, 2, false, 0); w.trick = 0; }
/** While it moves: a grain now and then, more the faster it goes (about 0.8 % of its speed in px/s). */
export function dragMove(w: World, v: number, now: number): void {
  const p = w.placed.sel; if (!p || w.reduced) return;
  const dtm = Math.min(.1, Math.max(0, (now - (w.trickT || now)) / 1000)); w.trickT = now; w.trick += Math.abs(v) * dtm * .008;
  while (w.trick >= 1) { w.trick -= 1; shed(w, p, 1, false, v); }
}
/** Putting it down: the snow presses, bounces once and drops a small clump and three grains. */
export function dragDrop(w: World): void { const p = w.placed.sel; if (!p || w.reduced) return; w.def.v -= 22; shed(w, p, 1, true, 0); shed(w, p, 3, false, 0); }
/** Switching on lays a light first snow on every cushion and the drift, as if it had snowed a little already (the study's fastForward(45)). */
export function fastForward(w: World, ledges: Ledge[], sec: number): void {
  if (w.drift) w.drift.lvl = Math.min(1, w.drift.lvl + sec * .006);
  for (const e of ledges) { const width = e.x1 - e.x0, n = Math.round(width * .00378 * w.amount * STICK * sec); for (let i = 0; i < n; i++) deposit(e, R(w, e.x0, e.x1), w.rnd() < .22 ? 1.1 : .6); }
}
/** Brush the snow off (the tree's menu): the whole cushion goes in one stroke. */
export function brushStroke(w: World, p: Placed | undefined, e: Ledge, t: number, now: number): void {
  // t from 0 to 1 across the plate; the controller calls this each frame of a half second stroke
  const x = (e.x0 - 12) + ((e.x1 + 12) - (e.x0 - 12)) * t;
  brushAt(w, p, e, x, (e.x1 - e.x0 + 24) / .5, now);
}
