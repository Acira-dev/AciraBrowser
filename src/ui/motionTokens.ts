import type { SpringSpec } from './springs';

/** The motion token table (R3-26; docs/launch/research/APPLE_MORPH_RESEARCH.md §3.2 and §5.11, bible §4 Morph).
 * Every spring in the app is one of these tokens, `(class, perceptual duration, bounce)`. The duration is the base value: the
 * timings the app had before the animation-speed setting. Channel classes:
 *   S  spatial: position, size, shape, aperture; may carry bounce        Premium ×1.7   Fast ×0.6
 *   E  effects: opacity, mist, rim light; always bounce 0                Premium ×1.4   Fast ×0.6
 *   L  latency-bound: press, hover, drag follow; never slowed            Premium ×1.0   Fast ×1.0
 * Fast is snappy, like Chrome and Arc (a reviewer, 2 Nov: "the difference between premium and fast is barely noticeable"): a
 * spring keeps its bounce and gets stiffer. Off is no animation at all (the OS reduced-motion preference is Off). */
export type MotionClass = 'S' | 'E' | 'L';
export const motionTokens = {
  'menu.grow': ['S', .170, 0], 'menu.content': ['E', .130, 0], 'menu.shrink': ['S', .115, 0], 'menu.fade': ['E', .085, 0],
  'popover.grow': ['S', .210, 0],
  // R4-17 the tab viewer (Alt+T) has its own pair so it reads as a deliberate formation without touching other popovers:
  // Premium ≈ 325 ms open / 240 ms close on the house spring (no bounce), Fast ≈ 0.6× of that, Off none.
  'tabViewer.open': ['S', .190, 0], 'tabViewer.close': ['S', .140, 0],
  'toast.in': ['S', .310, .12], 'toast.out': ['S', .150, 0], 'toast.stack': ['S', .225, 0],
  'island.expand': ['S', .295, .2], 'island.collapse': ['S', .210, 0], 'island.content': ['E', .150, 0],
  'tab.merge': ['S', .310, .12], 'tab.split': ['S', .235, .2],
  'workspace.slide': ['S', .130, 0], 'workspace.fade': ['E', .110, 0], 'workspace.pill': ['S', .160, 0],
  'reorder.move': ['S', .150, 0], 'reorder.release': ['S', .215, .2],
  'drag.follow': ['L', .085, 0],
  // R3-77/R3-80 liquid snap: the pull between a carried chip and a drop target, Apple's interactive spring (0.15 s, bounce .14);
  // letting go recoils on `tab.split` (bounce .2).
  'liquid.pull': ['L', .150, .14],
  // R4-28 thick liquid ("honey-glass", founder: thicker, smoother, less jiggle): the swell and neck forming (ζ .85), the chip's
  // plate strain (velocity stretch, near-critical ζ .8) and the snap-away settle of both shapes when a neck lets go (ζ .55: one
  // small visible wobble). Never slowed (L).
  'liquid.form': ['L', .220, .15], 'liquid.jelly': ['L', .200, .2], 'liquid.jiggle': ['L', .200, .45],
  'panel.expand': ['S', .210, 0], 'panel.collapse': ['S', .150, 0],
  'press.down': ['L', .075, 0], 'press.up': ['L', .210, .3], 'hover.lift': ['L', .115, 0],
  'materialize': ['E', .170, 0],
  // A plus, minus or Reset step on a page glides like a pinch before the real zoom lands (ui/pageZoomGlide.ts, desktop/page-zoom-glide.cjs): a frequent
  // surface, so Premium takes 40% of the stretch (205 ms), Fast .6 (95 ms), Off lands at once.
  'page.zoom': ['S', .160, 0],
  // R3-68 Seamless: the toolbar and sidebar reveal on stiffness 400 / damping 33 (ζ .83, +1% overshoot, settled within 2% in
  // ≈ 200 ms) and leave critically damped on stiffness 1330 / damping 73 (≈ 160 ms), about two thirds of the way in.
  'seamless.reveal': ['S', .315, .175], 'seamless.hide': ['S', .170, 0],
} as const satisfies Record<string, readonly [MotionClass, number, number]>;
export type MotionTokenId = keyof typeof motionTokens;

export type SpeedName = 'premium' | 'fast' | 'off';
/** Premium stretches by channel class; Fast takes 0.6 of the base (L stays 1, as in Premium); Off is 0 (no motion). The
 * windows main draws itself (tab-card.html, site-prompt.html, rewind/peek-frame.html) and main.cjs carry copies of this table:
 * a test keeps them equal. */
export const classScales: Record<SpeedName, Record<MotionClass, number>> = {
  premium: { S: 1.7, E: 1.4, L: 1 },
  fast: { S: .6, E: .6, L: 1 },
  off: { S: 0, E: 0, L: 0 },
};
/** Launch velocity of an opening S spring as a fraction of ω0 (kick × 2π/d progress per second): the first painted frame
 * already shows ~15% of the travel, the spring's slow start is not felt as lateness (research §3.6). Never on a close or a
 * retarget. */
export const kick: Record<SpeedName, number> = { fast: .15, premium: .4, off: 0 };

/** The spring of a token at a speed. Premium durations are rounded to 5 ms as in the research tables. Off returns null. */
export function springFor(id: MotionTokenId, speed: SpeedName = 'fast'): SpringSpec | null {
  const [cls, duration, bounce] = motionTokens[id], scale = classScales[speed][cls];
  if (!scale) return null;
  return { duration: Math.round(duration * scale * 200) / 200, bounce };
}
/** The multiplier of one class at a speed. */
export const classScale = (speed: SpeedName, cls: MotionClass): number => classScales[speed][cls];
/** Motion with a set length that Premium never stretches (the docked sidebar's slide, which the page card and main's native page
 * glide with, the tab forming in the strip, the new tab's entrances, toasts drawn in CSS) still quickens in Fast: its pace is
 * Fast's spatial scale (.6) in Fast and 1 at Premium and Off (Off has these off already). `--motion-pace` in CSS. */
export const motionPaceOf = (speed: SpeedName): number => speed === 'fast' ? classScales.fast.S : 1;

/** Frequent surfaces (suggestions, the command bar, the tab viewer, tab strips, sidebar rows: used a hundred times a day)
 * take only 40% of the Premium stretch, so they never feel slow: `1 + (scale − 1) × .4` above 1 (1.28 for S at Premium,
 * 1.16 for E), the plain scale otherwise. */
export const frequentStretch = (scale: number): number => scale > 1 ? 1 + (scale - 1) * .4 : scale;
/** The tab strip's spring (stiffness 360, damping 38, critically damped; the original strip the founder chose, B 28bee146),
 * which also moves the compact strip and the sidebar rows. Sampled for CSS and WAAPI over `stripMs` (Fast; frequent surfaces
 * take 40% of the Premium stretch). It starts with a small launch velocity (0.35 × ω0, research §3.6 "kick"): the first painted
 * frame already shows ~12% of the change instead of 4%, so a tab opening, closing or making room answers on the input frame,
 * with the same settle and no overshoot. `tab-motion.css` carries the same string as `--tab-ease` (a test keeps them equal). */
export const stripMs = 480;
export const stripEase = 'linear(0,.10848,.22451,.33768,.4423,.53567,.61695,.6864,.74492,.79365,.83386,.8668,.89359,.91527,.93272,.94672,.9579,.96681,.97388,.97948,.98391,.9874,.99015,.9923,.994,.99532,.99636,.99717,.9978,.99829,.99867,.99897,1)';
/** The spring of a token for a frequent surface (see `frequentStretch`). Off returns null. */
export function springForFrequent(id: MotionTokenId, speed: SpeedName = 'fast'): SpringSpec | null {
  const [cls, duration, bounce] = motionTokens[id], scale = frequentStretch(classScales[speed][cls]);
  if (!scale) return null;
  return { duration: Math.round(duration * scale * 200) / 200, bounce };
}
