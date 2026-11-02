import { stripEase } from '../../ui/motionTokens';

/** The sidebar fold (R5, founder 27 Oct: "the fade-away is not like the fade-in … they move to the left a bit and get
 *  directly clipped out"). Folding is the unfold played back toward closed:
 *  - every leaving row goes back the way it came (opacity to 0, up 4px, to 98% at its left edge), on the same spring curve
 *    as the unfold, in the reverse order (the lowest row first, 16 ms apart, at most 64 ms: the unfold's top-first stagger
 *    mirrored);
 *  - the section's edge (the clip over the leaving rows) and the rows below it glide up together on the unfold's spring, in
 *    step with the fade: they wait only until the lowest row has faded (`wait`), and each row's fade is timed so it is gone
 *    (opacity ≤ .05) before the rising edge reaches it. Nothing is ever cut off while it can still be seen, nothing moves
 *    sideways, and nothing is drawn over a row that is still fading.
 *  Pure (no DOM): `useFlip` in AciraSidebar.tsx applies it with WAAPI (transform, opacity, clip-path only). */

/** The unfold's spring as sampled for CSS (`stripEase`, a critically damped spring with a small launch velocity). */
export const FOLD_CURVE: readonly number[] = (stripEase.match(/[\d.]+/g) ?? ['0', '1']).map(Number);
/** The spring's progress at t (0–1), piecewise linear between the samples exactly as CSS `linear()` reads them. */
export function curveAt(t: number, curve: readonly number[] = FOLD_CURVE): number {
  if (t <= 0) return curve[0]; if (t >= 1) return curve[curve.length - 1];
  const x = t * (curve.length - 1), i = Math.floor(x); return curve[i] + (curve[i + 1] - curve[i]) * (x - i);
}
/** The first t (0–1) at which the spring has reached `value`. */
export function curveTime(value: number, curve: readonly number[] = FOLD_CURVE): number {
  if (value <= curve[0]) return 0;
  for (let i = 1; i < curve.length; i++) if (curve[i] >= value) { const a = curve[i - 1], b = curve[i]; return (i - 1 + (b > a ? (value - a) / (b - a) : 0)) / (curve.length - 1); }
  return 1;
}

/** A leaving row's fade lasts this share of the spring (the unfold's visible fade-in is about the first 40% of it). */
export const FOLD_FADE = .4;
/** A row counts as gone (it may be clipped) at or below this opacity. */
export const FOLD_GONE = .05;
export const FOLD_STAGGER = 16;
export const FOLD_STAGGER_MAX = 64;

export interface FoldRow { top: number; height: number; /** the opacity it leaves from (a row caught mid-unfold), default 1 */ opacity?: number }
export interface FoldPlan {
  top: number; span: number;
  /** how far the edge travels up (px): the distance the rows below slide, at most the span */
  travel: number;
  /** the spring's length (ms): the edge and the rows below */
  spring: number;
  /** each leaving row's fade (ms) */
  fade: number;
  /** the edge and the rows below start this late (ms): until the lowest row has faded */
  wait: number;
  /** each row's fade delay (ms), in the order given (top to bottom) */
  delays: number[];
}

/** The fold of `rows` (sorted top to bottom, content px) when the rows below slide up by `slide` px, on a spring of `spring` ms. */
export function foldPlan(rows: readonly FoldRow[], slide: number, spring: number): FoldPlan {
  const top = Math.min(...rows.map(r => r.top)), bottom = Math.max(...rows.map(r => r.top + r.height)), span = Math.max(0, bottom - top);
  const travel = slide > 0 ? Math.min(slide, span) : span, fade = Math.round(spring * FOLD_FADE);
  // The time a row takes from full ink to gone on the spring curve.
  const gone = fade * curveTime(1 - FOLD_GONE);
  const n = rows.length;
  const delays = rows.map((row, i) => {
    // The row's bottom sits `u` px above the section's bottom: the edge reaches it at wait + spring × curveTime(u / travel).
    const u = bottom - (row.top + row.height), latest = travel > 0 ? spring * curveTime(Math.min(1, u / travel)) : spring;
    // A row caught mid-unfold (opacity < 1) is gone sooner, so the same start is safe.
    return Math.max(0, Math.min(Math.min(n - 1 - i, FOLD_STAGGER_MAX / FOLD_STAGGER) * FOLD_STAGGER, latest));
  });
  return { top, span, travel, spring, fade, wait: Math.ceil(gone), delays };
}

/** What the plan draws at `t` ms (for tests and QA): each row's opacity and the edge's travel so far (px). */
export function foldAt(plan: FoldPlan, rows: readonly FoldRow[], t: number): { opacity: number[]; edge: number } {
  const edge = plan.travel * curveAt((t - plan.wait) / Math.max(1, plan.spring));
  const opacity = rows.map((row, i) => (row.opacity ?? 1) * (1 - curveAt((t - plan.delays[i]) / Math.max(1, plan.fade))));
  return { opacity, edge };
}
