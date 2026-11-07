import { springEasing, springs } from './springs';
import { frequentStretch } from './motionTokens';

/** The address text at rest sits in the middle of the address bar and glides to the left edge when the bar takes focus (a click,
 * Cmd/Ctrl+L), and back to the middle when it lets go (Esc, a click in the page, after navigating).
 *
 * This file is the logic without the DOM: where the text rests, what the field's own text is offset by, the glide's time and easing,
 * and when a focus change starts one. AddressField.tsx measures and applies it; address-glide.css moves one number (`--af-p`) that
 * the at-rest layer, the input's own text and the cross-fade between them all read, so they cannot drift apart.
 * tests/address-glide.test.ts pins it. */

/** The padding the field gives its text on each side (the same 8 px as the input's own). */
export const FIELD_PADDING = 8;

export interface GlideLayout {
  /** How far right of the left edge the shown text starts when it rests (CSS px). In the middle when there is room for it and for what
   * it leaves out in front; 0 when there is not (a narrow sidebar field, a long address): it rests at the left, as it always did. */
  center: number;
  /** The width of what the at-rest text leaves out in front of the domain (`https://`, `www.`). The field's own text starts that far left
   * of the shown text, so the domain is in the same place in both through the whole glide and they cross-fade without doubling. */
  pre: number;
  /** Whether there is a glide to play: any text in a field with room for padding. The domain travels from where the text rests to where the
   * full address puts it (left from the middle, or right from the left edge when the field is too narrow to rest in the middle), the field's
   * own text slides in behind it. false = no text to move: the swap is instant. */
  glides: boolean;
}

/** Where the at-rest text rests and what it leaves out in front, for a text `textWidth` wide in a field `fieldWidth` wide (both CSS px).
 * Whole and half pixels only, so the text is never blurred by a quarter-pixel position. A text that fills the box, or one with so little
 * room left that the piece it leaves out in front would not fit before it, rests at the left (`center` 0) and its domain travels RIGHT by
 * `pre` as the field takes focus: the two layers still line up through the whole glide (the field's own text starts `pre` to the left of
 * the shown text, behind the left edge), so a narrow sidebar field morphs like a wide toolbar one. */
export function glideLayout(input: { fieldWidth: number; textWidth: number; hiddenPrefixWidth?: number }): GlideLayout {
  const inner = input.fieldWidth - FIELD_PADDING * 2, width = Math.max(0, input.textWidth), pre = Math.max(0, input.hiddenPrefixWidth ?? 0);
  if (!(inner > 0) || !(width > 0)) return { center: 0, pre: 0, glides: false };
  const room = Math.round(inner - width) / 2;
  return { center: width < inner && pre <= room ? room : 0, pre, glides: true };
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
