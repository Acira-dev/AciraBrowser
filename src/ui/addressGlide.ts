import { springEasing, springs } from './springs';
import { frequentStretch } from './motionTokens';

/** The address text at rest sits in the middle of the address bar and glides to the left edge when the bar takes focus (a click,
 * Cmd/Ctrl+L), and back to the middle when it lets go (Esc, a click in the page, after navigating).
 *
 * This file is the logic without the DOM: where the middle is, what the field's own text is offset by, the glide's time and easing,
 * and when a focus change starts one. AddressField.tsx measures and applies it; address-glide.css moves one number (`--af-p`) that
 * the at-rest layer, the input's own text and the cross-fade between them all read, so they cannot drift apart.
 * tests/address-glide.test.ts pins it. */

/** The padding the field gives its text on each side (the same 8 px as the input's own). */
export const FIELD_PADDING = 8;

export interface GlideLayout {
  /** How far right of the left edge the shown text starts when it rests in the middle. 0 means there is no glide: the text stays at the
   * left (it fills the box, or has too little room left to hold what it leaves out in front), as it always did. */
  center: number;
  /** The width of what the at-rest text leaves out in front of the domain (`https://`, `www.`). The field's own text starts that far left
   * of the shown text, so the domain is in the same place in both through the whole glide and they cross-fade without doubling. */
  pre: number;
}

/** The middle of the field's text box for a text `textWidth` wide in a field `fieldWidth` wide (both CSS px). Whole and half pixels
 * only, so the text is never blurred by a quarter-pixel position. A text that fills the box has no middle to go to, and neither has one
 * with so little room left that the piece it leaves out in front would not fit before it: the two layers could not line up, so it stays
 * at the left and swaps as before, with nothing doubled. */
export function glideLayout(input: { fieldWidth: number; textWidth: number; hiddenPrefixWidth?: number }): GlideLayout {
  const inner = input.fieldWidth - FIELD_PADDING * 2, width = Math.max(0, input.textWidth), pre = Math.max(0, input.hiddenPrefixWidth ?? 0);
  if (!(inner > 0) || !(width > 0) || width >= inner) return { center: 0, pre: 0 };
  const center = Math.round(inner - width) / 2;
  return pre > center ? { center: 0, pre: 0 } : { center, pre };
}

/** The offset into the field's full text of the first character the at-rest text shows, when that is a real piece of it (a name
 * rewritten for display, such as an international one, has none: nothing to offset). `index` is addressDisplayMap's `index`. */
export function hiddenPrefixLength(index: readonly number[]): number {
  return index.length > 0 && index[0] > 0 ? index[0] : 0;
}

export interface Glide { /** Milliseconds; 0 = no glide, the text is just placed. */ ms: number; /** A CSS `linear(...)` easing. */ ease: string }

/** Acira's own critically damped spring (`springs.settle`, nothing overshoots) on the stretch the frequent surfaces use (the tabs and
 * the sidebar rows). `scale` is the animation-speed multiplier (`motionScaleOf`: Premium 1.7, Fast 0.6, Off and Reduce motion 0). With a
 * scale of 0 there is no glide at all. */
export function glideMotion(scale: number): Glide {
  if (!(scale > 0)) return { ms: 0, ease: 'linear' };
  const easing = springEasing(springs.settle, frequentStretch(scale));
  return { ms: easing.duration, ease: easing.easing };
}

/** A focus change starts a glide, when there is a glide to play. */
export const startsGlide = (wasFocused: boolean, focused: boolean, glide: Glide | undefined): boolean => !!glide && glide.ms > 0 && wasFocused !== focused;

/** How long the at-rest layer stays mounted after a glide starts, in case the browser never reports its end (a hidden window). */
export const glideGuardMs = (glide: Glide): number => glide.ms + 80;
