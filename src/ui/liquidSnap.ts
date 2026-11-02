import { motionTokens, type MotionTokenId } from './motionTokens';
import { classStretch, motionScale } from './splitMotion';
import { splitContainers, union, type Box } from './splitDropTarget';

/** Liquid snap (R3-77, R3-80, R4-28; founder 27 Oct: "like jelly, liquid water"). One primitive for every drag that carries the
 *  glass icon chip (strip, compact strip, sidebar, and any carried element): near a drop target (a split picker cell or slot, a
 *  split container, a tab group, a sidebar group, a workspace icon, the bookmarks bar) the chip and the target behave as two
 *  drops of water.
 *  - Attraction starts close: the chip's centre within `reach` (30 px for the 28 px chip: its edge 16 px from the target, scaled
 *    with the chip's size), rising smoothly (smoothstep) to full where the chip touches.
 *  - BOTH shapes morph: the target's rounded rect bulges toward the chip (a Gaussian swell of its edge), the chip's plate
 *    stretches toward the target (area kept, the icon never scaled), and the two merge as one surface: a polynomial smooth-min
 *    union of signed distance fields, drawn on a small WebGL2 layer that covers only the chip and target (no blur, no filter,
 *    nothing full-window). R5 (founder 27 Oct: "not an actual drop of water … the whole background of it dragging
 *    outwards"): the neck grows out of the FULL face of the chip's plate and of the target (an hourglass, `neckParams`), not
 *    out of a dot at the icon; it is painted in exactly the surface's own fill (the chip's tint, an owned cell's fill) with no
 *    highlight, glint, rim, gradient or accent tint; only its edge is a little soft. The chip's shadow fades as it merges.
 *  - Jelly: everything is a mass-spring (semi-implicit Euler, sub-stepped, frame-rate independent). The plate's strain is a
 *    traceless 2D tensor driven by the pointer's velocity and the pull, so it stretches along a fast move and squashes and
 *    wobbles when the move stops; while held the bridge breathes softly.
 *  - Sticky, then snap: once the drops touch (`attach`) they stay joined while the chip is pulled away, the target reaching out
 *    after it and the neck thinning as it lengthens (area kept), until `breakAt` (38 px: the chip's edge 24 px out): the neck pinches in its middle and both shapes jiggle
 *    back on `liquid.jiggle` (a damped oscillation, ~2–3 visible cycles inside 400 ms).
 *  - Drop: the chip is absorbed into the target (it sinks into the cell and the layer fades as the pane morph takes over).
 *  Every spring is a latency-bound (L) token, so it is never slowed by Premium; speed Off (and reduced motion) = no liquid at
 *  all: the targets' plain highlight stays. The pure geometry and physics below are unit-tested; `liquidChip` drives them. */
export interface Pt { x: number; y: number }
export interface Spring1 { x: number; v: number }
export interface SpringSpec1 { duration: number; bounce: number }

/** The geometry of the liquid for a chip of half-size `half` (14 for the 28 px chip), in CSS px (so it follows the interface
 *  scale). `reach`: attraction starts; `attach`: the drops touch and join; `breakAt`: a joined neck lets go. */
export function liquidGeometry(half = 14) {
  const k = half / 14;
  return { half, reach: half + 16 * k, attach: half + 8 * k, breakAt: half + 24 * k, bulge: 6 * k, tongue: 10 * k, neck: 8.5 * k, radius: 8 * k };
}

/** The point of a box nearest to `p` (`p` itself when inside), and how far away it is (0 inside). */
export function nearestOn(box: Box, p: Pt): { point: Pt; distance: number } {
  const point = { x: Math.max(box.left, Math.min(box.right, p.x)), y: Math.max(box.top, Math.min(box.bottom, p.y)) };
  return { point, distance: Math.hypot(point.x - p.x, point.y - p.y) };
}
/** Surface tension between the chip and a target edge `distance` px from the chip's centre: 0 from `reach` out, rising smoothly
 *  to 1 where the chip's edge touches the target (and inside it). */
export function tension(distance: number, half = 14): number {
  const { reach } = liquidGeometry(half);
  if (distance <= half) return 1; if (distance >= reach) return 0;
  const t = (reach - distance) / (reach - half); return t * t * (3 - 2 * t);
}

export interface LiquidTarget { key: string; box: Box; radius?: number; node?: HTMLElement; owned?: boolean; /** already showing the hover fill */ hovered?: boolean }
const area = (box: Box) => (box.right - box.left) * (box.bottom - box.top);
/** The target the chip is drawn to: the one under the pointer (the smallest, the most specific), else the joined one while its
 *  neck still holds (`breakAt`), else the nearest within reach; null when nothing is near. */
export function pickTarget(targets: readonly LiquidTarget[], pointer: Pt, joined = '', half = 14): { target: LiquidTarget; anchor: Pt; distance: number } | null {
  const geo = liquidGeometry(half);
  type Hit = { target: LiquidTarget; anchor: Pt; distance: number };
  let inside: LiquidTarget | null = null, nearest: Hit | null = null, held: Hit | null = null;
  for (const target of targets) {
    const { point, distance } = nearestOn(target.box, pointer);
    if (distance === 0 && (!inside || area(target.box) < area(inside.box))) inside = target;
    if (target.key === joined && distance <= geo.breakAt) held = { target, anchor: point, distance };
    if (distance < geo.reach && (!nearest || distance < nearest.distance)) nearest = { target, anchor: point, distance };
  }
  if (inside) return { target: inside, anchor: { ...pointer }, distance: 0 };
  return held ?? nearest;
}
/** The target the chip is most drawn to (the nearest within reach), with its tension, or null. */
export function strongest(targets: readonly LiquidTarget[], pointer: Pt, half = 14): { key: string; anchor: Pt; s: number } | null {
  const best = pickTarget(targets, pointer, '', half);
  return best ? { key: best.target.key, anchor: best.anchor, s: tension(best.distance, half) } : null;
}

/** A damped spring (mass 1) toward `goal` over `dt` seconds, sub-stepped at 240 Hz so a slow frame lands where it should.
 *  `duration` is the perceptual period and `bounce` 1 − ζ, as in the motion tokens. */
export function stepSpring(state: Spring1, goal: number, dt: number, spring: SpringSpec1): void {
  const w = 2 * Math.PI / spring.duration, k = w * w, c = 4 * Math.PI * (1 - spring.bounce) / spring.duration, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
  for (let i = 0; i < n; i++) { state.v += (-k * (state.x - goal) - c * state.v) * h; state.x += state.v * h; }
}

// ---- signed distance fields (CSS px; mirrored in the shader below) ----
/** Polynomial smooth minimum (Quilez): the union of two distance fields with a fillet of size `k`, which is what makes two drops
 *  flow into one (`k` 0 = a plain union). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 1e-3) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25;
}
export function sdRoundBox(px: number, py: number, hx: number, hy: number, r: number): number {
  r = Math.min(r, hx, hy); const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// ---- the simulation (pure: no DOM) ----
export interface LiquidBody {
  key: string; box: Box; radius: number; owned: boolean; node?: HTMLElement;
  anchor: Pt; dir: Pt; distance: number; live: boolean; attached: boolean; inside: boolean;
  /** tension, edge swell (px, negative = a dent), neck radius (px), owned-cell fill toward the hover colour */
  s: Spring1; bulge: Spring1; neck: Spring1; hover: Spring1; snapAt: number;
  /** the neck's radius when it let go (its two halves retract as it falls to 0) */
  neckSnap: number;
}
export interface LiquidSim {
  t: number; half: number; pointer: Pt | null; last: Pt | null; vel: Pt;
  lean: { x: Spring1; y: Spring1 }; strain: { a: Spring1; b: Spring1 }; bodies: LiquidBody[]; snapAt: number;
  /** drop absorption: seconds since the drop, or -1 */
  absorb: number;
  /** the chip has left the liquid (released, or back to a pill): only the targets' shapes are drawn while they settle */
  released: boolean;
}
export interface LiquidSprings { pull: SpringSpec1; form: SpringSpec1; jelly: SpringSpec1; jiggle: SpringSpec1; snap: SpringSpec1 }
const tokenSpring = (id: MotionTokenId, scale: number): SpringSpec1 => { const [, d, bounce] = motionTokens[id]; return { duration: d * Math.max(classStretch(id, scale), .01), bounce }; };
/** The liquid's springs at a speed (all latency-bound L tokens: Premium never slows them). */
export const liquidSprings = (scale = 1): LiquidSprings => ({ pull: tokenSpring('liquid.pull', scale), form: tokenSpring('liquid.form', scale), jelly: tokenSpring('liquid.jelly', scale), jiggle: tokenSpring('liquid.jiggle', scale), snap: tokenSpring('drag.follow', scale) });
const spring0 = (): Spring1 => ({ x: 0, v: 0 });
export const createSim = (half = 14): LiquidSim => ({ t: 0, half, pointer: null, last: null, vel: { x: 0, y: 0 }, lean: { x: spring0(), y: spring0() }, strain: { a: spring0(), b: spring0() }, bodies: [], snapAt: -1, absorb: -1, released: false });
const quiet = (s: Spring1, eps = .02) => Math.abs(s.x) < eps && Math.abs(s.v) < eps * 20;

/** A joined neck's radius at `distance`: full when the drops have just met, thinning in proportion as it is pulled longer (its
 *  area kept), never below 38%. */
export function neckRadius(distance: number, half = 14): number {
  const geo = liquidGeometry(half), base = geo.attach - half + 4;
  return geo.neck * Math.max(.38, Math.min(1, base / Math.max(1, distance - half + 4)));
}

/** One step of the liquid: the pointer (null once released), the chosen target (`pickTarget`), `dt` seconds. Returns what
 *  happened this step ('merge' when the drops touch, 'snap' when a neck lets go). */
export function simStep(sim: LiquidSim, pointer: Pt | null, target: { target: LiquidTarget; anchor: Pt; distance: number } | null, dt: number, springs: LiquidSprings): Array<'merge' | 'snap'> {
  const events: Array<'merge' | 'snap'> = [], geo = liquidGeometry(sim.half), half = sim.half;
  sim.t += dt; if (sim.absorb >= 0) sim.absorb += dt;
  // The pointer's velocity, smoothed over ~20 ms (what the jelly feels).
  if (pointer && sim.last && dt > 0) { const f = 1 - Math.exp(-dt / .02); sim.vel.x += ((pointer.x - sim.last.x) / dt - sim.vel.x) * f; sim.vel.y += ((pointer.y - sim.last.y) / dt - sim.vel.y) * f; }
  else if (!pointer) { sim.vel.x *= .8; sim.vel.y *= .8; }
  sim.last = pointer ? { ...pointer } : sim.last; if (pointer) sim.pointer = { ...pointer };
  const at = sim.pointer;
  let body = target ? sim.bodies.find(b => b.key === target.target.key) : undefined;
  if (target && !body && sim.absorb < 0) {
    body = { key: target.target.key, box: target.target.box, radius: target.target.radius ?? 6, owned: !!target.target.owned, node: target.target.node, anchor: { ...target.anchor }, dir: { x: 0, y: 1 }, distance: target.distance, live: true, attached: false, inside: false, s: spring0(), bulge: spring0(), neck: spring0(), hover: { x: target.target.hovered ? 1 : 0, v: 0 }, snapAt: -1, neckSnap: 0 };
    sim.bodies.push(body);
  }
  for (const b of sim.bodies) {
    const live = !!target && b === body && sim.absorb < 0 && !!at;
    b.live = live;
    if (live && at) {
      b.box = target!.target.box; b.distance = target!.distance; b.inside = target!.distance === 0;
      if (!b.inside) { b.anchor = { ...target!.anchor }; const dx = at.x - b.anchor.x, dy = at.y - b.anchor.y, len = Math.hypot(dx, dy) || 1; b.dir = { x: dx / len, y: dy / len }; }
      // A bridge needs time to form (thick liquid): a fast flick past the target never joins.
      if (!b.attached && b.distance <= geo.attach && b.s.x > .6) { b.attached = true; events.push('merge'); b.neck.v += 30 * half / 14; b.bulge.v += 20 * half / 14; }
      else if (b.attached && b.distance > geo.breakAt) { b.attached = false; b.snapAt = sim.t; b.neckSnap = b.neck.x; sim.snapAt = sim.t; events.push('snap'); }
    } else if (b.attached) { b.attached = false; b.snapAt = sim.t; b.neckSnap = b.neck.x; if (sim.absorb < 0) { sim.snapAt = sim.t; events.push('snap'); } }
    const s = live ? tension(b.distance, half) : 0, held = b.attached && !b.inside, breathe = held ? Math.sin(sim.t * 2 * Math.PI * 2.2) : 0;
    const bulgeGoal = sim.absorb >= 0 ? 0 : b.inside ? 0 : held ? Math.max(geo.bulge, Math.min(geo.tongue, b.distance - half * .85)) * (1 + .04 * breathe) : s * geo.bulge;
    stepSpring(b.s, s, dt, springs.form);
    stepSpring(b.bulge, bulgeGoal, dt, b.attached ? springs.form : springs.jiggle);
    stepSpring(b.neck, held ? neckRadius(b.distance, half) : 0, dt, b.attached ? springs.form : springs.snap);
    // R5 (founder 27 Oct): the cell the picker targets (data-hover) is lit at once, fill and outline, and the liquid joining it takes the same accent;
    // otherwise the fill eases in as the chip sinks into a cell and out as it leaves.
    const targeted = live && b.owned && !!target?.target.hovered;
    if (targeted) { b.hover.x = 1; b.hover.v = 0; } else stepSpring(b.hover, (live && b.inside && b.owned) || (sim.absorb >= 0 && b.owned && b.inside) ? 1 : 0, dt, springs.pull);
    if (b.neck.x < 0) { b.neck.x = 0; b.neck.v = Math.max(0, b.neck.v); }
  }
  sim.bodies = sim.bodies.filter(b => b.live || !(quiet(b.s, .004) && quiet(b.bulge, .08) && quiet(b.neck, .05) && quiet(b.hover, .01)));
  // The chip: a lean toward the target it is joined to (recoiling on the jiggle spring when it lets go), and its plate's strain.
  const main = sim.bodies.find(b => b.live), recent = sim.snapAt >= 0 && sim.t - sim.snapAt < .42;
  let leanX = 0, leanY = 0, ma = 0, ta = 0;
  if (main && at && !main.inside) {
    const ux = -main.dir.x, uy = -main.dir.y, amount = main.attached ? Math.min(4, 1.2 + Math.max(0, main.distance - half) * .18) * half / 14 : main.s.x * 2 * half / 14;
    leanX = ux * Math.max(0, amount); leanY = uy * Math.max(0, amount); ta = Math.atan2(uy, ux);
    ma = main.attached ? .035 + .13 * Math.max(0, Math.min(1, (main.distance - half) / (geo.breakAt - half))) + .01 * Math.sin(sim.t * 2 * Math.PI * 1.6 + 1) : .06 * main.s.x;
  }
  const speed = Math.hypot(sim.vel.x, sim.vel.y), mv = Math.min(.08, speed / 4500), tv = Math.atan2(sim.vel.y, sim.vel.x);
  const goalA = mv * Math.cos(2 * tv) + ma * Math.cos(2 * ta), goalB = mv * Math.sin(2 * tv) + ma * Math.sin(2 * ta);
  const strainSpring = recent ? springs.jiggle : springs.jelly, leanSpring = main?.attached ? springs.pull : recent ? springs.jiggle : springs.pull;
  stepSpring(sim.strain.a, goalA, dt, strainSpring); stepSpring(sim.strain.b, goalB, dt, strainSpring);
  stepSpring(sim.lean.x, leanX, dt, leanSpring); stepSpring(sim.lean.y, leanY, dt, leanSpring);
  return events;
}

/** The chip as drawn: its centre (pointer + lean), the stretch axis and the plate's scales (sx·sy = 1: area kept), how much of it
 *  the liquid layer draws (`engaged`; the CSS glass plate fades the other way), and the absorption scale on a drop. */
export function chipPose(sim: LiquidSim) {
  const m = Math.min(.32, Math.hypot(sim.strain.a.x, sim.strain.b.x)), angle = Math.atan2(sim.strain.b.x, sim.strain.a.x) / 2;
  const absorb = sim.absorb < 0 ? sim.released ? 0 : 1 : Math.max(0, 1 - sim.absorb / .1);
  const engaged = absorb && Math.max(0, Math.min(1, Math.max(0, ...sim.bodies.map(b => Math.max(b.s.x * 3, b.neck.x / 3, b.attached ? 1 : 0)))));
  const p = sim.pointer ?? { x: 0, y: 0 };
  return { centre: { x: p.x + sim.lean.x.x, y: p.y + sim.lean.y.x }, lean: { x: sim.lean.x.x, y: sim.lean.y.x }, angle, sx: 1 + m, sy: 1 / (1 + m), engaged, absorb };
}

/** How merged the chip is with a target, 0–1, continuous (never a switch): the tension while approaching, and while joined
 *  the neck's fullness too (it thins as the drops are pulled apart). Merged, the two are ONE shape: the chip's own drop shadow
 *  fades out by this amount (the union carries the target's single shadow and edge) and fades back in as they separate. */
export function mergeAmount(sim: LiquidSim): number {
  const geo = liquidGeometry(sim.half);
  return Math.max(0, Math.min(1, Math.max(0, ...sim.bodies.map(b => Math.max(b.s.x, b.neck.x / geo.neck)))));
}

/** The liquid surface's signed distance at `p` (negative inside), the same field the shader draws: each target (its rounded
 *  rect with the Gaussian swell toward the chip) smooth-joined to its neck and to the chip. */
export function liquidDistance(sim: LiquidSim, p: Pt, radius = liquidGeometry(sim.half).radius): number {
  const pose = chipPose(sim), c = pose.centre, cos = Math.cos(pose.angle), sin = Math.sin(pose.angle), dx = p.x - c.x, dy = p.y - c.y;
  const h = sim.half * pose.absorb, qx = (cos * dx + sin * dy) / pose.sx, qy = (-sin * dx + cos * dy) / pose.sy;
  const chip = h > .5 ? sdRoundBox(qx, qy, h, h, radius * pose.absorb) * Math.min(pose.sx, pose.sy) : 1e4;
  let d = chip;
  for (const b of sim.bodies) d = Math.min(d, bodyDistance(b, p, chip, b.node?.matches('[data-ws],.sidebar-bookmark-return,.sb-bookmark') ? null : neckParams(sim, b, radius)));
  return d;
}
function bodyDistance(b: LiquidBody, p: Pt, chip: number, neck: NeckParams | null): number {
  const hx = (b.box.right - b.box.left) / 2, hy = (b.box.bottom - b.box.top) / 2, cx = b.box.left + hx, cy = b.box.top + hy;
  const bulge = b.bulge.x, cxB = b.anchor.x + b.dir.x * Math.max(bulge, 0) * .5, cyB = b.anchor.y + b.dir.y * Math.max(bulge, 0) * .5;
  const sigma = Math.max(4, Math.min(9, Math.min(hx, hy) * 1.2)) + Math.abs(bulge) * .5;
  let zone = sdRoundBox(p.x - cx, p.y - cy, hx, hy, b.radius) - bulge * Math.exp(-((p.x - cxB) ** 2 + (p.y - cyB) ** 2) / (sigma * sigma));
  const k = 2 + 6 * Math.max(0, b.s.x) + (b.attached ? 2 : 0);
  if (neck) zone = smin(zone, neckField(p, neck), NECK_FILLET);
  return smin(zone, chip, k * Math.max(0, Math.min(1, b.s.x * 2)));
}

// ---- the neck: the whole surface reaching out (founder 27 Oct: "the whole background of it dragging outwards", not a dot) ----
/** The fillet where a neck meets the chip's or the target's face (px). */
export const NECK_FILLET = 3;
/** The neck between the chip and one target, in the frame of the axis from the chip's centre `c` to the target (`u`): an
 *  hourglass whose flanks grow out of the FULL width of each face (`hc` the chip's face, `ht` the target's, both half-widths)
 *  and ease in (flat at both ends) to the waist (`rw`, half-width) in the middle of the gap. `xb`: where the
 *  chip's face is along the axis, `xw` the waist, `xt` the target's face. When the neck lets go it is cut at the waist and
 *  each half retracts into its own face (`g`: how much of its half is left, 1 while joined); `chip` false once the chip is
 *  gone (released: only the target's half settles). The same numbers drive the shader (uniforms), so tests can read it. */
export interface NeckParams { c: Pt; u: Pt; xb: number; xw: number; xt: number; hc: number; ht: number; rw: number; g: number; chip: boolean }
/** The support of the chip's plate (a rounded square of half `h`, corner `r`, under the stretch `pose`) along `dir`. */
function support(dir: Pt, h: number, r: number, cos: number, sin: number, sx: number, sy: number): number {
  const vx = sx * (cos * dir.x + sin * dir.y), vy = sy * (-sin * dir.x + cos * dir.y);
  return (h - r) * (Math.abs(vx) + Math.abs(vy)) + r * Math.hypot(vx, vy);
}
export function neckParams(sim: LiquidSim, b: LiquidBody, radius = liquidGeometry(sim.half).radius): NeckParams | null {
  if (b.neck.x <= .05 || b.inside) return null;
  const pose = chipPose(sim), c = pose.centre, h = sim.half * pose.absorb, r = Math.min(h, radius * pose.absorb), geo = liquidGeometry(sim.half);
  const bulge = Math.max(b.bulge.x, 0), tip = { x: b.anchor.x + b.dir.x * bulge * .4, y: b.anchor.y + b.dir.y * bulge * .4 };
  const xt = Math.hypot(tip.x - c.x, tip.y - c.y); if (xt < 1) return null;
  const u = { x: (tip.x - c.x) / xt, y: (tip.y - c.y) / xt }, perp = { x: -u.y, y: u.x }, cos = Math.cos(pose.angle), sin = Math.sin(pose.angle);
  const face = h > .5 ? support(u, h, r, cos, sin, pose.sx, pose.sy) : 0, across = h > .5 ? support(perp, h, r, cos, sin, pose.sx, pose.sy) : 0;
  // Met corner-first, the face is a point: the flank starts a little inside, where the plate is as wide as the neck's base.
  const lu = { x: cos * u.x + sin * u.y, y: -sin * u.x + cos * u.y }, corner = Math.max(0, Math.min(1, (Math.abs(lu.x) + Math.abs(lu.y) - 1) / (Math.SQRT2 - 1)));
  const rw = Math.max(0, b.neck.x), form = Math.max(0, Math.min(1, rw / (geo.neck * .35)));
  const hc0 = .9 * across * (1 - .3 * corner), hx = (b.box.right - b.box.left) / 2, hy = (b.box.bottom - b.box.top) / 2;
  const ht0 = Math.min(hc0 || geo.neck, .9 * (Math.abs(perp.x) * hx + Math.abs(perp.y) * hy));
  const xb = Math.min(xt, face - 1 - corner * hc0 * .7), xw = Math.min(xt, face + Math.max(0, xt - face) / 2);
  const hc = rw + (hc0 - rw) * form, ht = rw + (Math.max(rw, ht0) - rw) * form;
  // Joined: one hourglass. Let go: cut at the waist (a 16% gap at once), each half retracting as the waist falls.
  const g = b.attached ? 1 : Math.max(0, Math.min(1, 2 * pinchOf(b, c)));
  return { c, u, xb, xw, xt, hc, ht, rw, g, chip: !(sim.released && !b.attached) && h > .5 };
}
/** One half of the neck: from its face at `xs` (half-width `base`) toward the waist, ending at `xe` (half-width `rw`). The flank
 *  leaves the face straight (the plate's own side carrying on) and eases in to the waist (a smoothstep, flat at both ends), so
 *  the surface itself stretches out and then necks; signed distance, first-order corrected for the flank's slope. */
function neckHalf(x: number, y: number, xs: number, xe: number, base: number, rw: number, pad: number): number {
  const len = xe - xs; if (Math.abs(len) < .01) return 1e4;
  const t = Math.max(0, Math.min(1, (x - xs) / len)), w = rw + (base - rw) * (1 - t * t * (3 - 2 * t)), slope = 6 * (base - rw) * t * (1 - t) / len;
  // The slope correction holds near the flank only; past 4 px it would let the field's gradient blow up where the slope
  // changes fast (a short, steep half), so further out the field grows plainly with the distance.
  const e = y - w, side = Math.min(e, 4) / Math.sqrt(1 + slope * slope) + Math.max(e - 4, 0), sign = Math.sign(len);
  // `pad`: a joined half runs on past the waist at the waist's width, so the two halves overlap there (no seam).
  return Math.max(side, (xs - x) * sign, (x - xe) * sign - pad);
}
/** The neck's signed distance at `p` (the shader's `neckD`). */
export function neckField(p: Pt, n: NeckParams): number {
  const dx = p.x - n.c.x, dy = p.y - n.c.y, x = dx * n.u.x + dy * n.u.y, y = Math.abs(n.u.x * dy - n.u.y * dx), pad = n.g >= .999 ? 2 : 0;
  const chipHalf = n.chip ? neckHalf(x, y, n.xb, n.xb + (n.xw - n.xb) * n.g, n.hc, n.rw, pad) : 1e4;
  return Math.min(chipHalf, neckHalf(x, y, n.xt, n.xt - (n.xt - n.xw) * n.g, n.ht, n.rw, pad));
}
/** How much of the neck still spans the drops: 1 while joined; once it lets go it is cut in its middle at once (a 16% gap) and
 *  each half retracts into its own drop as the radius falls (so no thread is ever left hanging between them). */
export function pinchOf(b: LiquidBody, chipCentre: Pt): number {
  if (b.attached) return 1;
  // Each half is also never longer than ~1.6 neck radii, so a chip that has moved far on (a fast pull) trails no long thread.
  const tipX = b.anchor.x + b.dir.x * Math.max(b.bulge.x, 0) * .4, tipY = b.anchor.y + b.dir.y * Math.max(b.bulge.x, 0) * .4, length = Math.max(1, Math.hypot(chipCentre.x - tipX, chipCentre.y - tipY));
  return Math.min(.42 * Math.max(0, Math.min(1, b.neck.x / Math.max(b.neckSnap, .01))), 1.6 * b.neck.x / length);
}

// ---- the DOM: targets, colours and the WebGL2 layer ----
const visible = (node: Element) => !node.closest('[inert],[hidden],.tab-drag-preview,.sb-flip-ghost') && node.getClientRects().length > 0;
const rect = (node: Element): Box => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
/** Every drop target a carried chip can stick to, measured now: split picker cells (and arrange slots, same class), split
 *  containers (chip and members), tab groups (label and members), sidebar groups, workspace icons, the bookmarks bar, and
 *  anything marked `data-liquid-target`. Picker cells are `owned`: the liquid layer redraws them (their own paint steps aside)
 *  so the cell itself can swell; every other target keeps its own paint and the swell grows out of its edge. */
export function liquidTargets(doc: Document, exclude = ''): LiquidTarget[] {
  const out: LiquidTarget[] = [];
  doc.querySelectorAll<HTMLElement>('.split-picker-cell').forEach((node, i) => { if (visible(node)) out.push({ key: `zone:${i}:${node.parentElement?.className ?? ''}`, box: rect(node), radius: 3, node, owned: true, hovered: node.hasAttribute('data-hover') }); });
  for (const split of splitContainers(doc)) out.push({ key: `split:${split.id}`, box: split.box, radius: 8 });
  const groups = new Map<string, Box[]>();
  for (const node of doc.querySelectorAll<HTMLElement>('[data-group-header],[data-tab-group]')) {
    const id = node.dataset.groupHeader || node.dataset.tabGroup; if (!id || node.dataset.tabId === exclude || !visible(node)) continue;
    (groups.get(id) ?? groups.set(id, []).get(id)!).push(rect(node));
  }
  for (const [id, boxes] of groups) { const box = union(boxes); if (box) out.push({ key: `group:${id}`, box, radius: 8 }); }
  for (const node of doc.querySelectorAll<HTMLElement>('[data-sidebar-group],[data-ws],.bookmarks-bar,[data-liquid-target]')) if (visible(node) && !(node.dataset.ws && node.getAttribute('aria-checked') === 'true')) out.push({ key: `el:${node.dataset.sidebarGroup || node.dataset.ws || node.dataset.liquidTarget || node.className}`, box: rect(node), radius: 6, node, owned: Boolean(node.dataset.ws) });
  return out;
}

type RGBA = [number, number, number, number];
/** A computed CSS colour (`rgb()`, `rgba()`, `color(srgb …)`) as straight RGBA in 0–1. */
export function parseColor(value: string): RGBA {
  const srgb = /^color\(/.test(value), nums = (value.replace(/^[^(]*\(/, '').replace('srgb', '').match(/-?[\d.]+(?:e-?\d+)?%?/g) ?? []).map(n => n.endsWith('%') ? parseFloat(n) / 100 : parseFloat(n));
  if (nums.length < 3) return [0, 0, 0, 0];
  const k = srgb ? 1 : 1 / 255; return [nums[0] * k, nums[1] * k, nums[2] * k, nums[3] ?? 1];
}
interface Palette { chip: RGBA; accent: RGBA; shadow: number; hover: RGBA; hoverLine: RGBA }
function resolve(host: HTMLElement, css: string, prop: 'color' | 'backgroundColor' = 'color', className = ''): RGBA {
  const probe = document.createElement('span'); probe.className = className; probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'fixed', left: '-9999px', top: '0', width: '1px', height: '1px', visibility: 'hidden', pointerEvents: 'none' });
  if (css) probe.style[prop] = css; host.append(probe);
  const value = getComputedStyle(probe)[prop]; probe.remove(); return parseColor(value);
}
function palette(host: HTMLElement, chip: HTMLElement): Palette {
  const dark = host.closest('.app')?.getAttribute('data-chrome') === 'dark' || host.getAttribute('data-chrome') === 'dark';
  let tint = parseColor(getComputedStyle(chip, '::before').backgroundColor);
  if (tint[3] === 0) tint = resolve(host, 'var(--glass)', 'backgroundColor');
  const accent = resolve(host, 'var(--accent, #3b82f6)');
  const hoverLine: RGBA = dark ? [accent[0] * .7, accent[1] * .7, accent[2] * .7, 1] : [accent[0], accent[1], accent[2], 1];
  return { chip: tint, accent, shadow: dark ? .42 : .26, hover: resolve(host, '', 'backgroundColor', 'split-picker-highlight'), hoverLine };
}
/** A picker cell's visibility: its card's opacity as framer animates it (inline style, no style recalc); 0 once unmounted. */
const cardAlpha = (node?: HTMLElement): number => { if (!node) return 1; if (!node.isConnected) return 0; const o = parseFloat(node.closest<HTMLElement>('.split-picker-card')?.style.opacity || '1'); return Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : 1; };
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

const MAX_BODIES = 3;
const FRAGMENT = `#version 300 es
precision highp float;
#define MAXB ${MAX_BODIES}
uniform vec3 uView; uniform float uHeight;
uniform vec4 uChip; uniform vec4 uChipXf; uniform vec4 uChipFill; uniform vec4 uChipMisc;
uniform int uCount; uniform vec4 uBox[MAXB]; uniform vec4 uBump[MAXB]; uniform vec4 uShape[MAXB]; uniform vec4 uFill[MAXB]; uniform vec4 uLine[MAXB]; uniform vec4 uFlags[MAXB];
uniform vec4 uNeckA[MAXB]; uniform vec4 uNeckB[MAXB]; uniform vec4 uNeckC[MAXB];
out vec4 outColor;
float sdRBox(vec2 p, vec2 h, float r){ r=min(r,min(h.x,h.y)); vec2 q=abs(p)-h+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
float smin(float a,float b,float k){ if(k<=1e-3) return min(a,b); float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*k*.25; }
float chipD(vec2 p){ if(uChip.z<.5) return 1e4; vec2 q=p-uChip.xy; q=vec2(uChipXf.x*q.x+uChipXf.y*q.y,-uChipXf.y*q.x+uChipXf.x*q.y)/uChipXf.zw; return sdRBox(q,uChip.zw,uChipMisc.x)*min(uChipXf.z,uChipXf.w); }
float zoneD(int i, vec2 p){ vec4 b=uBox[i], m=uBump[i], s=uShape[i]; float d=sdRBox(p-b.xy,b.zw,s.w); float bu=s.x; vec2 c=m.xy+m.zw*(max(bu,0.)*.5); float sig=clamp(min(b.z,b.w)*1.2,4.,9.)+abs(bu)*.5; vec2 dc=p-c; return d-bu*exp(-dot(dc,dc)/(sig*sig)); }
// One half of the neck (neckHalf in TS): from its face at xs (half-width base) to xe (half-width rw); the flank leaves the face
// straight and eases in to the waist (smoothstep).
float neckHalf(float x, float y, float xs, float xe, float base, float rw, float pad){ float len=xe-xs; if(abs(len)<.01) return 1e4;
  float t=clamp((x-xs)/len,0.,1.), w=rw+(base-rw)*(1.-t*t*(3.-2.*t)), sl=6.*(base-rw)*t*(1.-t)/len, sg=sign(len);
  float e=y-w; return max(min(e,4.)/sqrt(1.+sl*sl)+max(e-4.,0.), max((xs-x)*sg, (x-xe)*sg-pad)); }
// The neck (neckField in TS): the whole face of the chip and of the target reaching out as one hourglass, cut at the waist when
// it lets go. uNeckA: axis u, xb, xw; uNeckB: xt, hc, ht, rw; uNeckC: g, chip half shown, -, has neck.
float neckD(int i, vec2 p){ vec4 a=uNeckA[i], b=uNeckB[i], c=uNeckC[i]; if(c.w<.5) return 1e4;
  vec2 q=p-uChip.xy; float x=dot(q,a.xy), y=abs(a.x*q.y-a.y*q.x), pad=c.x>=.999 ? 2. : 0.;
  float ch = c.y>.5 ? neckHalf(x,y,a.z,a.z+(a.w-a.z)*c.x,b.y,b.w,pad) : 1e4;
  return min(ch, neckHalf(x,y,b.x,b.x-(b.x-a.w)*c.x,b.z,b.w,pad)); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, uHeight-gl_FragCoord.y)/uView.z + uView.xy;
  // The chip's own drop shadow (a tight contact shade and a soft ambient one, as its CSS plate has), from the chip only: the
  // merged form keeps the target's one shadow, so this fades with the merge (uChipMisc.z). The neck casts none.
  vec2 o1 = vec2(0.,1.), o2 = vec2(0.,5.);
  float dc = chipD(p), best = 1e5, w = 1., zoneMask = 1., zAlpha = 1., hov = 0., plain = 1e5, s1 = chipD(p-o1), s2 = chipD(p-o2), owned = 0.;
  vec4 zf = uChipFill, zl = vec4(0.);
  for(int i=0;i<MAXB;i++){ if(i>=uCount) break;
    float k = uShape[i].z, dz = zoneD(i,p), dn = neckD(i,p), dzn = smin(dz,dn,${NECK_FILLET.toFixed(1)}), u = smin(dzn,dc,k*uFlags[i].z), box = sdRBox(p-uBox[i].xy,uBox[i].zw,uShape[i].w);
    if(uChipMisc.w>.5){s1=smin(s1,zoneD(i,p-o1),k*uFlags[i].z);s2=smin(s2,zoneD(i,p-o2),k*uFlags[i].z);}
    if(u<best){ best=u; plain=min(box,dc); w=smoothstep(-2.5,2.5,dz-min(dn,dc)); owned=uFlags[i].x; zoneMask = owned>.5 ? 1. : smoothstep(0.,1.25,box); zf = owned>.5 ? uFill[i] : uChipFill; zl = owned>.5 ? uLine[i] : vec4(0.); zAlpha = uFlags[i].y; hov = uFlags[i].w; }
  }
  float d = min(dc,best);
  // The surface's own edge: one device pixel of antialiasing on the chip and the target as they are; where the surface reaches
  // out (the swell, the neck, the fillets: the union beyond both shapes) the edge softens to ~1.6 CSS px, a little blurry.
  // (A distance field's gradient is ~1 CSS px per px; capped so no kink in the field can ever draw a hairline far from the shape.)
  vec2 g = vec2(dFdx(d), -dFdy(d)); float gl = clamp(length(g), 1e-4, 2./uView.z);
  float reach = clamp((plain-d)/2.5,0.,1.), edge = mix(1., 1.6*uView.z, reach);
  float cover = clamp(.5-(d/gl)/edge,0.,1.);
  float sh = uChipMisc.z*uChipMisc.y*(.4*(1.-smoothstep(-1.,2.5,s1)) + .7*(1.-smoothstep(-4.,12.,s2)));
  if(cover<=0. && sh<=.002) { outColor=vec4(0.); return; }
  // Exactly the surface's own fill: the chip's tint, or an owned picker cell's own fill (no light, no rim, no gradient, no tint).
  // A lit (targeted) cell fills the whole union with its accent: the neck and the chip plate as well as the cell.
  vec4 fill = mix(zf,uChipFill,w*(1.-hov));
  float alpha = mix(zoneMask*zAlpha, uChipMisc.y, w);
  vec4 col = vec4(0.,0.,0.,1.)*sh*(1.-cover*fill.a);
  vec4 f = vec4(fill.rgb,1.)*fill.a*cover*alpha; col = f+col*(1.-f.a);
  // An owned picker cell keeps its own outline on its own contour only (never along the neck or on the chip).
  float rim = cover*clamp((d+1.)/gl+.5,0.,1.)*(1.-w)*(1.-reach);
  vec4 l = vec4(zl.rgb,1.)*zl.a*rim*alpha; col = l+col*(1.-l.a);
  outColor = col;
}`;
const VERTEX = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.-1., 0., 1.); }`;

interface Layer { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; uni: Record<string, WebGLUniformLocation | null>; w: number; h: number; dpr: number; shown: boolean }
let shared: Layer | null | false = null;
/** The one liquid layer of this window (created once, on idle, and reused by every drag): a transparent fixed canvas that is
 *  only shown, and only as large as needed, while a chip is near a target. False when WebGL2 is unavailable (then the chip only
 *  stretches, with no union drawn). */
function layer(host: HTMLElement): Layer | null {
  if (shared === false) return null;
  if (shared) { if (shared.canvas.parentElement !== host) host.append(shared.canvas); return shared; }
  try {
    const canvas = document.createElement('canvas'); canvas.className = 'liquid-layer'; canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) { shared = false; return null; }
    const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!; gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { shared = false; return null; }
    gl.useProgram(prog); gl.bindVertexArray(gl.createVertexArray()); gl.disable(gl.BLEND);
    const uni: Layer['uni'] = {};
    for (const name of ['uView', 'uHeight', 'uChip', 'uChipXf', 'uChipFill', 'uChipMisc', 'uCount', 'uBox', 'uBump', 'uShape', 'uFill', 'uLine', 'uFlags', 'uNeckA', 'uNeckB', 'uNeckC']) uni[name] = gl.getUniformLocation(prog, name);
    canvas.addEventListener('webglcontextlost', () => { canvas.remove(); shared = false; });
    host.append(canvas); shared = { canvas, gl, uni, w: 0, h: 0, dpr: 0, shown: false };
    return shared;
  } catch { shared = false; return null; }
}
/** Create the layer ahead of need (shader compile is a few ms): called when a carried drag starts, run on idle. */
export function prewarmLiquid(host: HTMLElement | null): void {
  if (!host || shared !== null || typeof window === 'undefined') return;
  const run = () => { if (shared === null) layer(host); };
  (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback?.(run, { timeout: 250 }) ?? setTimeout(run, 0);
}
function hideLayer(l: Layer | null) { if (l?.shown) { l.canvas.style.visibility = 'hidden'; l.shown = false; } }
function drawLayer(l: Layer, sim: LiquidSim, colors: Palette, bodyColors: Map<string, { fill: RGBA; line: RGBA }>, fade: number, plate?: {box:Box;radius:number}) {
  const pose = chipPose(sim), half = sim.half * pose.absorb, geo = liquidGeometry(sim.half), bodies = sim.bodies.slice(-MAX_BODIES);
  // Only the chip, the swells and the parts of the targets near it: foreign targets (a whole strip group, the bookmarks bar) are
  // cut to the stretch round the anchor, so the layer stays a few hundred px at most.
  let left = pose.centre.x - half * 1.4 - 24, top = pose.centre.y - half * 1.4 - 24, right = pose.centre.x + half * 1.4 + 24, bottom = pose.centre.y + half * 1.4 + 32;
  if(plate){left=plate.box.left-24;top=plate.box.top-24;right=plate.box.right+24;bottom=plate.box.bottom+32;}
  for (const b of bodies) {
    const box = b.owned ? b.box : { left: Math.max(b.box.left, b.anchor.x - 90), right: Math.min(b.box.right, b.anchor.x + 90), top: Math.max(b.box.top, b.anchor.y - 90), bottom: Math.min(b.box.bottom, b.anchor.y + 90) };
    left = Math.min(left, box.left - geo.tongue - 8); top = Math.min(top, box.top - geo.tongue - 8); right = Math.max(right, box.right + geo.tongue + 8); bottom = Math.max(bottom, box.bottom + geo.tongue + 8);
  }
  const dpr = window.devicePixelRatio || 1, vw = window.innerWidth, vh = window.innerHeight;
  left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top)); right = Math.min(vw, Math.ceil(right)); bottom = Math.min(vh, Math.ceil(bottom));
  const cw = Math.max(1, right - left), ch = Math.max(1, bottom - top);
  // The backing store only grows (in 64 px steps) or follows a DPI change, so a moving chip never reallocates it every frame.
  const W = Math.ceil(cw * dpr / 64) * 64, H = Math.ceil(ch * dpr / 64) * 64, { canvas, gl, uni } = l;
  if (W > l.w || H > l.h || dpr !== l.dpr) { l.w = Math.max(W, dpr === l.dpr ? l.w : 0); l.h = Math.max(H, dpr === l.dpr ? l.h : 0); l.dpr = dpr; canvas.width = l.w; canvas.height = l.h; canvas.style.width = `${l.w / dpr}px`; canvas.style.height = `${l.h / dpr}px`; }
  canvas.style.transform = `translate3d(${left}px,${top}px,0)`; canvas.style.opacity = fade.toFixed(3);
  if (!l.shown) { canvas.style.visibility = 'visible'; l.shown = true; }
  gl.viewport(0, 0, l.w, l.h);
  gl.uniform3f(uni.uView, left, top, dpr); gl.uniform1f(uni.uHeight, l.h);
  const cos = Math.cos(pose.angle), sin = Math.sin(pose.angle), chipFill = colors.chip;
  if(plate){const b=plate.box;gl.uniform4f(uni.uChip,(b.left+b.right)/2,(b.top+b.bottom)/2,(b.right-b.left)/2,(b.bottom-b.top)/2);gl.uniform4f(uni.uChipXf,1,0,1,1);}
  else{gl.uniform4f(uni.uChip, pose.centre.x, pose.centre.y, half, half); gl.uniform4f(uni.uChipXf, cos, sin, pose.sx, pose.sy);}
  // The chip's own fill, exactly (its CSS plate's tint): no accent, no light.
  gl.uniform4f(uni.uChipFill, ...chipFill);
  // One shape, one shadow: the chip's own shadow fades with the merge (and comes back as the drops separate).
  gl.uniform4f(uni.uChipMisc, plate?.radius ?? geo.radius * pose.absorb, plate ? 1 : pose.engaged * pose.absorb, colors.shadow * (1 - mergeAmount(sim)), plate ? 1 : 0);
  const n4 = () => new Float32Array(MAX_BODIES * 4), box = n4(), bump = n4(), shape = n4(), fill = n4(), line = n4(), flags = n4(), neckA = n4(), neckB = n4(), neckC = n4();
  bodies.forEach((b, i) => {
    const hx = (b.box.right - b.box.left) / 2, hy = (b.box.bottom - b.box.top) / 2, own = bodyColors.get(b.key), hover = b.node?.matches('[data-ws],.sidebar-bookmark-return,.sb-bookmark,.sidebar-tab-drag-gap') ? 0 : Math.max(0, Math.min(1, b.hover.x));
    box.set([b.box.left + hx, b.box.top + hy, hx, hy], i * 4); bump.set([b.anchor.x, b.anchor.y, b.dir.x, b.dir.y], i * 4);
    shape.set([b.bulge.x, b.neck.x, 2 + 6 * Math.max(0, b.s.x) + (b.attached ? 2 : 0), b.radius], i * 4);
    fill.set(own ? mix(own.fill, colors.hover, hover) : chipFill, i * 4); line.set(own ? mix(own.line, colors.hoverLine, hover) : [0, 0, 0, 0], i * 4);
    // An owned cell fades with its picker card (a cancelled or finished picker leaves no ghost cell).
    flags.set([b.owned ? 1 : 0, b.owned ? cardAlpha(b.node) : 1, Math.max(0, Math.min(1, b.s.x * 2)), b.owned ? hover : 0], i * 4);
    // Small workspace/copy plates merge through their rounded distance fields. A full-face
    // neck across a diagonal 28px icon turns into a pointed wedge as it stretches.
    const neck = plate || b.node?.matches('[data-ws],.sidebar-bookmark-return,.sb-bookmark') ? null : neckParams(sim, b);
    if (neck) { neckA.set([neck.u.x, neck.u.y, neck.xb, neck.xw], i * 4); neckB.set([neck.xt, neck.hc, neck.ht, neck.rw], i * 4); neckC.set([neck.g, neck.chip ? 1 : 0, 0, 1], i * 4); }
  });
  gl.uniform4fv(uni.uNeckA, neckA); gl.uniform4fv(uni.uNeckB, neckB); gl.uniform4fv(uni.uNeckC, neckC);
  gl.uniform1i(uni.uCount, bodies.length);
  gl.uniform4fv(uni.uBox, box); gl.uniform4fv(uni.uBump, bump); gl.uniform4fv(uni.uShape, shape); gl.uniform4fv(uni.uFill, fill); gl.uniform4fv(uni.uLine, line); gl.uniform4fv(uni.uFlags, flags);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Two row-sized portions of one surface. Uses the split picker's very same
 * rounded distance fields and smooth union; the caller owns the single clock. */
export function liquidFork(host:HTMLElement,fill:string){
  const l=motionScale()?layer(host):null;if(!l)return null;
  const sim=createSim(),color=parseColor(fill),colors:Palette={chip:color,accent:color,shadow:.2,hover:color,hoverLine:[0,0,0,0]};
  const bodyColors=new Map<string,{fill:RGBA;line:RGBA}>();let disposed=false;
  return{
    draw(a:Box,b:Box,join:number,opacity=1){
      if(disposed)return;
      sim.half=Math.max(1,(a.bottom-a.top)/2);sim.pointer={x:(a.left+a.right)/2,y:(a.top+a.bottom)/2};
      const spring=(x:number)=>({x,v:0});
      sim.bodies=[{key:'fork',box:b,radius:7,owned:true,anchor:{x:(b.left+b.right)/2,y:b.top},dir:{x:0,y:-1},distance:0,live:true,attached:false,inside:false,s:spring(join),bulge:spring(0),neck:spring(0),hover:spring(0),snapAt:-1,neckSnap:0}];
      drawLayer(l,sim,colors,bodyColors,opacity,{box:a,radius:7});
    },
    dispose(){disposed=true;hideLayer(l);}
  };
}

export interface Liquid { point(pointer: Pt, active?: boolean): void; offset(): Pt; end(dropped?: boolean): void; dispose():void }
/** Liquid attraction for one carried chip (`chip`: a fixed-position element the caller places at the pointer; it adds `offset()`
 *  to its place). `exclude` is the dragged tab's id; `onFrame` is called after each step (a caller without its own frame loop
 *  re-places the chip there). The chip only sticks once it is fully a chip (`--chip-p` ≥ .9 when the caller sets it). Off: an
 *  inert object. */
export function liquidChip(chip: HTMLElement, { exclude = '', onFrame, beforeFrame, only, targets }: { exclude?: string; onFrame?: () => void; beforeFrame?: (now:number) => void; targets?: () => LiquidTarget[]; /** Only these targets (a pane drag's chip: the layouts pill and the card's cells); all when absent. */ only?: (target: LiquidTarget) => boolean } = {}): Liquid {
  const scale = motionScale();
  if (!scale || typeof document === 'undefined') return { point() {}, offset: () => ({ x: 0, y: 0 }), end() {},dispose() {} };
  const host = (chip.closest('.app') as HTMLElement | null) ?? (document.querySelector('.app') as HTMLElement | null) ?? document.body;
  prewarmLiquid(host);
  const springs = liquidSprings(scale), sim = createSim(), bodyColors = new Map<string, { fill: RGBA; line: RGBA }>(), owned = new Set<HTMLElement>();
  let colors: Palette | null = null, active = false, gone = false, last = 0, frame = 0, ending = false, fade = 1, endAt = 0;
  const chipHalf = () => { const w = parseFloat(chip.style.width); return Math.max(8, Math.min(20, (Number.isFinite(w) && w > 0 ? w : 28) / 2)); };
  // Only once the pill has fully become the chip (its place then is exactly the pointer + lean, where the layer draws it).
  const ready = () => { const p = chip.style.getPropertyValue('--chip-p'); return p === '' || parseFloat(p) >= .99; };
  const syncOwned = () => {
    const now = new Set(sim.bodies.filter(b => b.owned && b.node).map(b => b.node!));
    for (const node of owned) if (!now.has(node)) node.removeAttribute('data-liquid');
    for (const node of now) if (!owned.has(node)) node.setAttribute('data-liquid', '');
    owned.clear(); for (const node of now) owned.add(node);
  };
  const clear = () => {
    gone = true; cancelAnimationFrame(frame); syncOwnedClear(); hideLayer(shared || null);
    for (const name of ['--liquid-s', '--liquid-on', '--liquid-rot', '--liquid-sx', '--liquid-sy']) chip.style.removeProperty(name);
  };
  const syncOwnedClear = () => { for (const node of owned) node.removeAttribute('data-liquid'); owned.clear(); };
  const tick = (now: number) => {
    if (gone) return;
    // A coordinated fork positions both DOM icons before their shared material is drawn.
    // Updating it after drawLayer leaves the glass one frame behind the icons.
    beforeFrame?.(now);if(gone)return;
    const dt = last ? Math.min(.05, Math.max(0, (now - last) / 1000)) : 1 / 60; last = now;
    const pointer = ending ? null : sim.pointer;
    if (!ending) sim.half = chipHalf();
    sim.released = ending || !active || !ready();
    const joined = sim.bodies.find(b => b.live && b.attached)?.key ?? '';
    const available = targets ? targets() : liquidTargets(document, exclude);
    const target = !ending && active && pointer && ready() ? pickTarget(only ? available.filter(only) : available, pointer, joined, sim.half) : null;
    simStep(sim, pointer, target, dt, springs);
    // An owned cell's own colours, read once before it steps aside (its outline is the picker's `--split-outline`).
    for (const b of sim.bodies) if (b.owned && b.node && !bodyColors.has(b.key)) { const cs = getComputedStyle(b.node); let fill = parseColor(cs.backgroundColor); if (fill[3] < .1 && b.node.matches('[data-ws],.sidebar-bookmark-return,.sb-bookmark,.sidebar-tab-drag-gap')) fill = palette(host, chip).chip; bodyColors.set(b.key, { fill, line: parseColor(cs.getPropertyValue('--split-outline').trim()) }); }
    if (sim.bodies.length && !colors) colors = palette(host, chip);
    const pose = chipPose(sim), style = chip.style;
    style.setProperty('--liquid-on', sim.bodies.length ? pose.engaged.toFixed(3) : '0');
    style.setProperty('--liquid-s', Math.max(0, ...sim.bodies.filter(b => b.live).map(b => Math.min(1, b.s.x))).toFixed(3));
    style.setProperty('--liquid-rot', `${pose.angle.toFixed(3)}rad`); style.setProperty('--liquid-sx', pose.sx.toFixed(3)); style.setProperty('--liquid-sy', pose.sy.toFixed(3));
    // Owned cells whose picker is gone leave at once; a drop fades the layer over 100 ms with the picker card.
    sim.bodies = sim.bodies.filter(b => !b.owned || !b.node || b.node.isConnected);
    if (ending && sim.absorb >= 0) fade = Math.max(0, 1 - sim.absorb / .1);
    const l = sim.bodies.length && colors ? layer(host) : null;
    if (l && colors && fade > 0) { syncOwned(); drawLayer(l, sim, colors, bodyColors, fade); } else { syncOwnedClear(); hideLayer(shared || null); }
    onFrame?.();
    if (ending && (!sim.bodies.length || now - endAt > 700 || fade <= 0)) { clear(); return; }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    dispose:clear,
    point(pointer, isActive = true) { if (gone || ending) return; sim.pointer = { ...pointer }; active = isActive; },
    offset: () => gone || ending ? { x: 0, y: 0 } : { x: sim.lean.x.x, y: sim.lean.y.x },
    end(dropped = false) {
      if (gone || ending) return;
      ending = true; endAt = performance.now();
      // A drop onto the target it is joined to: the chip is absorbed (it sinks into the target, then the layer fades as the pane
      // morph takes over). Released elsewhere: every neck lets go and the shapes jiggle back before the layer goes.
      if (dropped && sim.bodies.some(b => b.live && b.distance <= 2)) sim.absorb = 0;
      else if (dropped) { clear(); return; }
      for (const b of sim.bodies) if (sim.absorb < 0) b.live = false;
    },
  };
}
