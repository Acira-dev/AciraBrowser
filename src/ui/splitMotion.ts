import { motionTokens, type MotionTokenId } from './motionTokens';

/** The split surfaces' springs for framer-motion, read from the one token table (`motionTokens.ts`; research
 *  docs/launch/research/APPLE_MORPH_RESEARCH.md 3.1 and 3.2), so the split, the carried chip and the rest of the app are one
 *  motion family. Every token is a perceptual duration (seconds) and a bounce at Fast; a spring has mass 1, stiffness (2π/d)²
 *  and damping 4π(1-bounce)/d. The speed setting (R3-17, --motion-scale: Premium 1.7, Fast .6, Off 0) stretches each token by
 *  its own class: spatial (S) by the scale, effects (E, opacity) by 1 + (scale − 1) × 4/7 above 1 (1.4 at Premium; they used to
 *  take the full 1.7, so fades lagged the shapes they belong to) and by the scale below it (.6 in Fast, as motionTokens'
 *  classScales), latency-bound (L) not at all. Off (and reduced motion) is instant.
 *  Spatial tokens may carry bounce; opacity never does. */
export type SplitMotionToken = MotionTokenId;

/** The global speed multiplier, read from .app when a surface opens (1 when unset). */
export function motionScale(): number {
  const node = typeof document === 'undefined' ? null : document.querySelector('.app') ?? document.documentElement, value = node ? parseFloat(getComputedStyle(node).getPropertyValue('--motion-scale')) : NaN;
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}

/** The stretch a token's class takes at a spatial scale (`--motion-scale`). */
export function classStretch(token: SplitMotionToken, scale = 1): number {
  if (scale === 0) return 0;
  const cls = motionTokens[token][0];
  return cls === 'S' ? scale : cls === 'E' ? (scale > 1 ? 1 + (scale - 1) * 4 / 7 : scale) : 1;
}

/** The spring for a token at a speed: a framer-motion transition, instant at scale 0. */
export function morphSpring(token: SplitMotionToken, scale = 1) {
  if (scale === 0) return { duration: 0 };
  const [, d, bounce] = motionTokens[token], s = classStretch(token, scale), w = 2 * Math.PI / d;
  return { type: 'spring' as const, stiffness: w * w / (s * s), damping: 4 * Math.PI * (1 - bounce) / d / s, mass: 1 };
}

/** When row `order` of a cascade starts (seconds): the content waits 30 ms at the base speed (50 at Premium), then each row
 *  follows by 12 ms (24), the stagger capped at 100 ms (160). Interpolated by the speed setting above the base, and shortened
 *  with it below (Fast .6: 18 ms, 7.2 ms, capped at 60 ms); 0 at Off. */
export function cascadeDelay(order: number, scale = 1): number {
  if (scale === 0) return 0;
  const t = Math.max(0, Math.min(1, (scale - 1) / .7)), lerp = (fast: number, premium: number) => fast + (premium - fast) * t;
  return (lerp(30, 50) + Math.min(lerp(100, 160), order * lerp(12, 24))) * Math.min(1, scale) / 1000;
}
/** How far a revealed row rises into place (px): 3 below Premium, 4 at Premium. */
export const riseFor = (scale = 1) => scale === 0 ? 0 : scale >= 1.7 ? 4 : 3;
