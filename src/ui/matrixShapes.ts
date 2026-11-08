/** The classic grid (round 2, founder: "classic square dot matrix only, never dot-drawn pictures"). Every pattern is
 * the whole square grid with lights moving through it in a clean order; no shape (onion, mask, globe, face, check) is
 * ever drawn in dots. Status ticks are CheckMark strokes, not the matrix (bible §3.7). */

/** A chat you have seen: the matrix stays, so it still reads as an agent, but every dot is dim. */
export const switchedOff = (_r?: number, _c?: number) => .16;

/** Added (R4-08b, founder: "morphs to a dot-matrix check"): the whole square grid stays, and the dots on a check stroke
 * light at full while the rest hold their dim base. Not a picture made by leaving dots out: every dot is still there.
 * 5x5, 6x6 and 7x7 grids only; any other grid rests dim. */
const CHECKS: Record<number, ReadonlySet<string>> = {
  5: new Set(['2,0', '3,1', '2,2', '1,3', '0,4']),
  // 6x6 (the update mark): rows 1-4 of 0-5 and columns 0-5, so the check is centred on the grid both ways; the 5x5 one spans rows 0-3 of 0-4 and hugs the top
  6: new Set(['2,0', '3,1', '4,2', '3,3', '2,4', '1,5']),
  7: new Set(['3,0', '4,1', '5,2', '4,3', '3,4', '2,5', '1,6']),
};
export const checkLights = (r: number, c: number, R: number, C: number) => (R === C && CHECKS[R]?.has(r + ',' + c) ? 1 : 0);

/** The update check (founder's pick, 8 Nov 2026): the tick drawn as a row of round dots over the faint 6x6 grid. The classic check above stays for the other matrices
 *  (the rating card, a finished download); this one is free-placed, not a pattern of lit cells, so it has its own geometry.
 *  The dots are evenly spaced along the stroke (one on the elbow, none snapped to the grid): arm 1 runs down-right and arm 2 up-right, a dot at every `step` css px along
 *  each axis, so the pitch is step * sqrt(2) on both arms. A 2 px step is the one that stays whole device pixels at 1x, 1.5x and 2x (2, 3 and 4 px), and 2 px dots leave
 *  a clear 0.83 px gap on the diagonal; finer steps look better at 2x but go soft and uneven at 1x. 7 dots, 12 x 8 px, centred on the mark both ways. */
export const UPDATE_TICK = { step: 2, dot: 2, arm1: 2, arm2: 4 } as const;
export function dottedTick(size: number, step: number = UPDATE_TICK.step, arm1: number = UPDATE_TICK.arm1, arm2: number = UPDATE_TICK.arm2): [number, number][] {
  const width = (arm1 + arm2) * step, top = Math.min(0, (arm1 - arm2) * step), bottom = arm1 * step;
  const x0 = (size - width) / 2, y0 = (size - (bottom - top)) / 2 - top, dots: [number, number][] = [];
  for (let i = 0; i <= arm1; i++) dots.push([x0 + i * step, y0 + i * step]);
  for (let i = 1; i <= arm2; i++) dots.push([x0 + (arm1 + i) * step, y0 + (arm1 - i) * step]);
  return dots;
}
const easeOut = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
/** The finish at time `p` (0 = the fill just completed, every dot lit; 1 = done): how much of the grid's light is left, how far the tick has been drawn (0 to 1, from its
 *  first dot to its last), and how much of dot `i` of `count` is there (it grows and fades in as the drawing reaches it). */
export function updateCheckAt(p: number) {
  const grid = 1 - easeOut(p), drawn = easeOut((p - .2) / .8);
  return { grid, drawn, dot: (i: number, count: number) => Math.min(1, Math.max(0, drawn * count - i)) };
}
/** Whether a grid dot sits so close to a tick dot that it is left out once the tick is there (so a faint dot never half-hides behind a tick dot). */
export const gridClearedBy = (x: number, y: number, gridRadius: number, dots: [number, number][], dotRadius: number) => dots.some(([dx, dy]) => Math.hypot(dx - x, dy - y) < dotRadius + gridRadius + .35);

/** Dots cross-fade between states on smootherstep, so a change never cuts. */
export function blend(from: number, to: number, progress: number) {
  const p = Math.min(1, Math.max(0, progress)), eased = p * p * p * (p * (p * 6 - 15) + 10);
  const a = Math.max(0, from), b = Math.max(0, to);
  return a + (b - a) * eased;
}

/** The square layer a dot sits on: 0 at the centre, (n - 1) / 2 at the edge. */
export const layer = (r: number, c: number, R: number, C: number) => Math.max(Math.abs(r - (R - 1) / 2), Math.abs(c - (C - 1) / 2));

/** Each dot's place in layer order: the centre first, then every layer clockwise from its top centre. */
const orders = new Map<string, number[]>();
export function layerOrder(R: number, C: number) {
  const key = `${R}x${C}`, hit = orders.get(key); if (hit) return hit;
  const cells = Array.from({ length: R * C }, (_, i) => {
    const r = Math.floor(i / C), c = i % C, angle = ((Math.atan2(c - (C - 1) / 2, -(r - (R - 1) / 2)) / (Math.PI * 2)) + 1) % 1;
    return { i, key: layer(r, c, R, C) * 10 + angle };
  }).sort((a, b) => a.key - b.key);
  const rank = new Array<number>(R * C); cells.forEach((cell, n) => { rank[cell.i] = n; });
  orders.set(key, rank); return rank;
}

/** Tor connecting: the layers fill from the centre with real bootstrap progress, dot by dot and clockwise, and the next
 * dot blinks at half while Tor works on it. */
export function torConnecting(t: number, r: number, c: number, R: number, C: number, progress = 0) {
  const rank = layerOrder(R, C)[r * C + c], lit = Math.max(1, Math.round(Math.min(1, Math.max(0, progress)) * R * C));
  return rank < lit ? 1 : rank === lit ? ((t * 2.4) % 1 < .5 ? .5 : 0) : 0;
}

/** The same fill held still (a paused update download): the lit layers stay, the next dot stops blinking. A still frame: it costs no frames. */
export function progressHeld(_t: number, r: number, c: number, R: number, C: number, progress = 0) {
  const lit = Math.max(1, Math.round(Math.min(1, Math.max(0, progress)) * R * C));
  return layerOrder(R, C)[r * C + c] < lit ? 1 : 0;
}

/** Tor connected: every layer rests at half and a full layer travels from the centre to the edge, then a short rest. */
export function torConnected(t: number, r: number, c: number, R: number, C: number) {
  const edge = (Math.min(R, C) - 1) / 2, front = ((t / 3.2) % 1) * (edge + 2.5) - .5;
  return Math.abs(layer(r, c, R, C) - front) < .5 ? 1 : .5;
}

/** Tor stopped: the grid goes dark but for its centre, held at half. */
export const torStopped = (_t: number, r: number, c: number, R: number, C: number) => layer(r, c, R, C) < 1 ? .5 : 0;

/** Smooth value noise of one dimension: a pure function of time (no state), so every frame of every meter agrees. */
const hash = (i: number, seed: number) => { const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x: number, seed: number) {
  const i = Math.floor(x), f = x - i, e = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - e) + hash(i + 1, seed) * e;
}

/** Playing sound (R4-30): an equaliser. Electron only says a tab is audible, never how loud, so the columns are animated, not
 * measured. Each column follows its own smooth random walk at its own pace (golden-ratio spaced, so no two keep step and the
 * whole never loops), under one slow shared swell that makes it breathe like phrasing. A column never drops below its bottom
 * dot, so a quiet moment still reads as a meter. Lights are full, half or dark, like every other pattern. */
export function audioBars(t: number, r: number, c: number, R: number, _C?: number) {
  const rate = 4.6 + ((c * .618034) % 1) * 4.8, raw = noise(t * rate + c * 3.1, c * 7.31 + 1);
  // Value noise hugs the middle; a gentle contrast curve gives the columns the full height now and then.
  const body = Math.min(1, Math.max(0, (raw - .5) * 1.85 + .5)), swell = .4 + .6 * noise(t * .85, 91.7);
  const height = .9 + (R - .9) * Math.min(1, body * (.55 + .45 * swell) + (noise(t * 2.2, c * 2.9 + 40) > .84 ? .3 : 0));
  const value = height - (R - 1 - r);
  return value >= .55 ? 1 : value >= .18 ? .5 : 0;
}

/** Download: the grid fills from its bottom row up with the real share of the file received, dot by dot and left to right, and the
 * next dot blinks at half while bytes arrive. Above the fill a light falls down every column at its own pace and lands on the
 * surface, so a download with no known size (progress 0) still reads as moving. `held` (a paused download) keeps the fill and
 * stops everything else: it is a still frame, so it costs no frames. */
export function downloadFill(t: number, r: number, c: number, R: number, C: number, progress = 0, held = false) {
  const lit = Math.round(Math.min(1, Math.max(0, progress)) * R * C), rank = (R - 1 - r) * C + c;
  if (rank < lit) return 1;
  if (held) return 0;
  if (rank === lit) return (t * 2.4) % 1 < .5 ? .5 : 0;
  // Rows already filled in this column; the light falls through the rows above them.
  const filled = Math.floor(lit / C) + (c < lit % C ? 1 : 0), free = R - filled;
  if (free <= 0) return 0;
  const rate = .85 + ((c * .618034) % 1) * .5, head = (((t * rate + c * .37) % 1 + 1) % 1) * (free + 1.5) - .5;
  return Math.abs(r - head) < .5 ? .5 : 0;
}

/** Private: a clean diagonal sweep lights the grid and leaves it dark behind it — nothing is kept. */
export function privateSweep(t: number, r: number, c: number, R: number, C: number) {
  const span = R + C - 2, head = ((t / 2.8) % 1) * (span + 5) - 1.5, d = r + c - head;
  return Math.abs(d) <= .5 ? 1 : d < -.5 && d >= -1.5 ? .5 : 0;
}
