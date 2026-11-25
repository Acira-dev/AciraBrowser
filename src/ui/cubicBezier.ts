/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress (0..1 -> 0..1), the way the browser evaluates a transition's timing function. Used to know where a running opacity fade IS without asking the page
 * (`getComputedStyle` forces a style recalculation): Ambient's and the site glow's layers pick the layer that shows the least from this (Beta 14, speed pass).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t, y = (t: number) => ((ay * t + by) * t + cy) * t, dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return progress => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let i = 0; i < 8; i++) { const error = x(t) - progress; if (Math.abs(error) < 1e-6) return y(t); const slope = dx(t); if (Math.abs(slope) < 1e-6) break; t -= error / slope; }
    let lo = 0, hi = 1; t = progress;
    for (let i = 0; i < 40; i++) { const value = x(t); if (Math.abs(value - progress) < 1e-6) break; if (value < progress) lo = t; else hi = t; t = (lo + hi) / 2; }
    return y(t);
  };
}

/** A running opacity fade of one layer: where it started, where it goes, when, how long, and on which curve. `shown(now)` is the opacity it is drawn at then. */
export interface OpacityFade { from: number; to: number; at: number; ms: number; ease: (progress: number) => number }
export const fadeShown = (fade: OpacityFade | undefined, fallback: number, now: number): number => {
  if (!fade) return fallback;
  if (!(fade.ms > 0)) return fade.to;
  const k = Math.min(1, Math.max(0, (now - fade.at) / fade.ms));
  return fade.from + (fade.to - fade.from) * fade.ease(k);
};
/** True when the fade ended long enough ago that the page has drawn its end (a frame or more): the layer is at rest at `to`, and a style change on it is a plain change, not a retarget. */
export const fadeAtRest = (fade: OpacityFade | undefined, now: number, settle = 64): boolean => !fade || now - fade.at >= fade.ms + settle;
