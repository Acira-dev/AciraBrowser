import { useSyncExternalStore } from 'react';
import type { RatingFeature } from '../../runtime/types';

/** R4-61: the feature-rating card on screen, shared by its owner (RatingCard, in the main interface) and the browser layout. While a
 * website is on screen the page view would cover a card drawn in the main interface, so the layout carries the card to the native
 * overlay's transient layer instead (as toasts go), and the overlay's answers come back to the owner as `ui` actions. */
export interface RatingOnScreen { feature: RatingFeature; phase: 'ask' | 'thanks'; leaving: boolean }
let current: RatingOnScreen | null = null;
const listeners = new Set<() => void>();
export const ratingOnScreen = (): RatingOnScreen | null => current;
export function setRatingOnScreen(next: RatingOnScreen | null): void {
  if (next === current || (next && current && next.feature === current.feature && next.phase === current.phase && next.leaving === current.leaving)) return;
  current = next ? { feature: next.feature, phase: next.phase, leaving: next.leaving } : null;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useRatingOnScreen(): RatingOnScreen | null { return useSyncExternalStore(subscribe, ratingOnScreen, ratingOnScreen); }
/** The overlay carrying the card went away (a click in the page closes it): the owner hides the card quietly, not as a dismissal. */
export const RATING_HIDE_EVENT = 'acira:rating-hide';
