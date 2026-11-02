/** Spring primitives (R3-26; bible §4 "Morph"). Pure maths, no DOM, so CSS, WAAPI and script all use the same curve.
 *
 * A spring is described the way SwiftUI describes it (WWDC23 "Animate with springs"): a perceptual `duration` in seconds
 * and a `bounce` from 0 (critically damped: arrives and stops, no overshoot) up to ~0.4 (clearly springy). Underneath:
 *   mass 1, stiffness = (2π / duration)², damping = (4π / duration) · (1 − bounce)  →  damping ratio ζ = 1 − bounce.
 *
 * Use it two ways:
 *  - `springEasing(spec, scale)` → `{ duration, easing: 'linear(…)' }` for CSS and `element.animate()`. The curve is
 *    sampled once and cached; it animates transform/opacity on the compositor like any other easing (Chromium ≥ 113).
 *  - `springAt(spec, from, to, t, velocity)` for script-driven values (drag release, retargeting with velocity kept).
 *
 * `scale` is the global animation-speed multiplier (`--motion-scale`: Premium 1.7, Fast 1, Off 0): it stretches the
 * spring's duration; the shape of the curve stays the same. */

export interface SpringSpec { /** Perceptual duration in seconds (SwiftUI semantics). */ duration: number; /** 0 = critically damped … ~0.4 springy. */ bounce: number }

/** Apple's three SwiftUI presets (duration 0.5 s; the bounce values are the widely documented ones: smooth 0, snappy .15,
 * bouncy .3) and Acira's own, tuned for a calm instrument: nothing wobbles, the largest overshoot is ~2%. */
export const springs = {
  smooth: { duration: .5, bounce: 0 },
  snappy: { duration: .5, bounce: .15 },
  bouncy: { duration: .5, bounce: .3 },
  /** Critically damped. Things that arrive and stop: a toast leaving, a panel resizing, a row sliding to its place. */
  settle: { duration: .32, bounce: 0 },
  /** Slight bounce (ζ .78, 2% overshoot). Things that join or transform: a tab entering a group, a chip becoming a popover. */
  morph: { duration: .38, bounce: .22 },
  /** Small controls and quick feedback. */
  quick: { duration: .2, bounce: 0 },
  /** Follows a pointer or finger and hands its velocity on (Apple's interactiveSpring: response .15, damping .86). */
  interactive: { duration: .15, bounce: .14 },
} as const satisfies Record<string, SpringSpec>;
export type SpringName = keyof typeof springs;

/** SwiftUI's other constructor, `Spring(response:dampingRatio:)`: response is the same perceptual duration, and a damping
 * ratio of 1 is critical damping (bounce 0). A ratio above 1 is treated as 1 (no over-damping in UI). */
export const springFromResponse = (response: number, dampingRatio: number): SpringSpec => ({ duration: response, bounce: 1 - Math.min(1, Math.max(0, dampingRatio)) });
/** The way out of a morph: critically damped and 30% shorter. Springs enter with a little life and leave without
 * any (the Dynamic Island's expand/collapse asymmetry); exits are ~⅔ of enters (bible §3.9). */
export const springExit = (spec: SpringSpec): SpringSpec => ({ duration: spec.duration * .7, bounce: 0 });

const TAU = Math.PI * 2;
const clampBounce = (bounce: number) => Math.max(0, Math.min(.95, bounce));

/** Natural frequency (rad/s) and damping ratio of a spec. */
export function springParams(spec: SpringSpec) {
  const duration = Math.max(.05, spec.duration), omega = TAU / duration, zeta = 1 - clampBounce(spec.bounce);
  return { omega, zeta, stiffness: omega * omega, damping: 2 * zeta * omega };
}

/** Position and velocity after `t` seconds, moving from `from` to `to` with initial `velocity` (units/second). */
export function springAt(spec: SpringSpec, from: number, to: number, t: number, velocity = 0): { value: number; velocity: number } {
  const { omega, zeta } = springParams(spec), y0 = from - to;
  if (t <= 0) return { value: from, velocity };
  if (zeta >= .9999) { // critically damped: y = (A + Bt)e^(-ωt)
    const a = y0, b = velocity + omega * y0, e = Math.exp(-omega * t);
    return { value: to + (a + b * t) * e, velocity: (b - omega * (a + b * t)) * e };
  }
  const wd = omega * Math.sqrt(1 - zeta * zeta), decay = zeta * omega, e = Math.exp(-decay * t);
  const a = y0, b = (velocity + decay * y0) / wd, cos = Math.cos(wd * t), sin = Math.sin(wd * t);
  return { value: to + e * (a * cos + b * sin), velocity: e * ((b * wd - decay * a) * cos - (a * wd + decay * b) * sin) };
}

/** Seconds until the spring (from rest, 0 → 1) stays within `tolerance` of its target. */
export function springSettle(spec: SpringSpec, tolerance = .004, velocity = 0): number {
  const step = 1 / 240; let last = 0;
  for (let i = 1; i <= 240 * 6; i++) { const t = i * step; if (Math.abs(springAt(spec, 0, 1, t, velocity).value - 1) > tolerance) last = t; else if (t - last > .1) break; }
  return last + step;
}

/** The largest value the step response reaches (1 + overshoot). 1 for a critically damped spring. */
export function springPeak(spec: SpringSpec): number {
  let peak = 1; const settle = springSettle(spec);
  for (let t = 0; t <= settle; t += settle / 400) peak = Math.max(peak, springAt(spec, 0, 1, t).value);
  return peak;
}

export interface SpringEasing { /** Milliseconds, for `element.animate({ duration })` or CSS `transition-duration`. */ duration: number; /** A CSS `linear(…)` easing function. */ easing: string; /** The peak of the curve (1 = no overshoot). */ peak: number }
const cache = new Map<string, SpringEasing>();
const POINTS = 44;

/** The spring as a CSS easing. `scale` stretches the duration (the animation-speed setting). A scale of 0 returns an
 * instant animation. `velocity` is the incoming speed as a fraction of the travel per second (0.5 = half the distance each
 * second): an interrupted animation passes what it had, so the new one carries on instead of restarting from rest, the way
 * SwiftUI retargets a spring. Cached per spec, scale and velocity. */
export function springEasing(spec: SpringSpec, scale = 1, velocity = 0): SpringEasing {
  if (!(scale > 0)) return { duration: 0, easing: 'linear', peak: 1 };
  velocity = Math.round(velocity * 20) / 20;
  const key = `${spec.duration}|${spec.bounce}|${scale}|${velocity}`, known = cache.get(key); if (known) return known;
  const stretched: SpringSpec = { duration: spec.duration * scale, bounce: spec.bounce };
  const settle = springSettle(stretched, .004, velocity), stops: string[] = [];
  let peak = 1;
  for (let i = 0; i < POINTS; i++) {
    // Denser early, where the curve moves fastest: t = settle · (i/(n−1))^1.35.
    const t = settle * Math.pow(i / (POINTS - 1), 1.35), value = i === POINTS - 1 ? 1 : springAt(stretched, 0, 1, t, velocity).value;
    peak = Math.max(peak, value);
    stops.push(`${Math.round(value * 10000) / 10000}`);
  }
  // linear() takes explicit input positions so the uneven sampling above stays exact.
  const positions = stops.map((_, i) => Math.round(Math.pow(i / (POINTS - 1), 1.35) * 10000) / 100);
  const easing: SpringEasing = { duration: Math.round(settle * 1000), easing: `linear(${stops.map((v, i) => i === 0 ? v : i === POINTS - 1 ? v : `${v} ${positions[i]}%`).join(', ')})`, peak };
  if (cache.size > 64) cache.clear();
  cache.set(key, easing);
  return easing;
}

/** One spring in flight, for values driven from script and for retargeting a running animation: ask where it is and how
 * fast it is moving at any moment, then start the next flight from that value and velocity (`retarget`), so an
 * interrupted morph never stops dead or jumps. Times are in milliseconds (`performance.now()`); `scale` is the speed setting. */
export interface SpringFlight { from: number; to: number; velocity: number; startedAt: number; at(now: number): { value: number; velocity: number }; done(now: number): boolean; retarget(to: number, now: number): SpringFlight }
export function springFlight(spec: SpringSpec, from: number, to: number, startedAt: number, scale = 1, velocity = 0): SpringFlight {
  const stretched: SpringSpec = { duration: spec.duration * (scale > 0 ? scale : .001), bounce: spec.bounce };
  const travel = to - from, settleMs = scale > 0 && travel ? springSettle(stretched, .004, velocity / travel) * 1000 : 0;
  const at = (now: number) => scale > 0 ? springAt(stretched, from, to, Math.max(0, (now - startedAt) / 1000), velocity) : { value: to, velocity: 0 };
  return { from, to, velocity, startedAt, at, done: now => now - startedAt >= settleMs, retarget: (next, now) => { const state = at(now); return springFlight(spec, state.value, next, now, scale, state.velocity); } };
}
