/** The arithmetic of a plus, minus or Reset step on one of Acira's own pages (ui/pageZoomGlide.ts draws it). The same plan, rule for rule,
 * as the one main keeps for a website (desktop/page-zoom-glide.cjs, which sets Chromium's page scale): tests/page-zoom-glide.test.ts runs
 * both on the same cases. No DOM, so it is tested on its own. All zooms are fractions of 100%. */

/** The most a page is ever shown enlarged over the layout it has: a bigger step is a cut. */
export const MAX_RATIO = 1.6;
const EPS = 1e-6;
/** The page's own zoom has a lower bound of 25% and an upper bound of 500% (page-zoom-levels.json). */
export interface GlideState { layout: number; scale: number }
/** `cut`: no glide, the target is laid out now. `none`: already there. `glide`: lay the page out at `layout` now (a landing, when
 * `lands`), show it enlarged by `scale` and ease the scale to `goal`; a zoom in ends with the target laid out at scale 1, a zoom out
 * ends at scale 1 with `layout` already the target. */
export type GlidePlan = { kind: 'cut' } | { kind: 'none' } | { kind: 'glide'; layout: number; scale: number; goal: number; lands: boolean };

export function planGlide(state: GlideState, target: number, cap = MAX_RATIO): GlidePlan {
  const { layout, scale } = state;
  if (![layout, scale, target].every(Number.isFinite) || layout <= 0 || target <= 0 || scale < 1 - EPS) return { kind: 'cut' };
  const visual = layout * scale;
  if (Math.abs(target - layout) < EPS && Math.abs(scale - 1) < EPS) return { kind: 'none' };
  if (target >= layout - EPS) {
    const goal = target / layout;
    if (goal <= cap + EPS) return { kind: 'glide', layout, scale, goal, lands: false };
    // Further from the layout the page has than a scale should go: it lands where it is now and glides the rest.
    const rest = target / visual;
    if (visual - layout > EPS && rest >= 1 - EPS && rest <= cap + EPS) return { kind: 'glide', layout: visual, scale: 1, goal: rest, lands: true };
    return { kind: 'cut' };
  }
  const enlarged = visual / target;
  if (enlarged >= 1 - EPS && enlarged <= cap + EPS) return { kind: 'glide', layout: target, scale: enlarged, goal: 1, lands: true };
  return { kind: 'cut' };
}
