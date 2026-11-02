import { t } from '../../i18n';
import type { BrowserSnapshot, RatingFeature } from '../../runtime/types';

/** R4-61 moment rules and geometry of the feature-rating card, kept apart from the card (no styles) so tests and the browser layout can
 * use them. Main decides WHICH feature and WHETHER the cadence allows it (feature-rating.cjs), refuses the offer within 30 s of a key
 * pressed in a website (page keys never reach the interface) and never answers private or Tor windows; this adds the interface side. */

/** Typing = a key pressed in the last 8 seconds, or a focused field that already holds text (an empty, idle address field is not typing). */
let lastKey = -Infinity;
if (typeof window !== 'undefined') window.addEventListener('keydown', () => { lastKey = performance.now(); }, true);
const typing = () => {
  if (performance.now() - lastKey < 8000) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return Boolean(el.textContent?.trim());
  return /^(INPUT|TEXTAREA)$/.test(el.tagName) && Boolean((el as HTMLInputElement).value);
};
/** Whether this moment is calm enough to ask: never in a private window, during setup, in fullscreen, while typing or while video plays.
 *  A website on screen is fine (the card then goes to the overlay). */
export function quietMoment(state: Pick<BrowserSnapshot, 'tabs' | 'activeTabId' | 'settings'>, privateWindow: boolean): boolean {
  if (privateWindow || !state.settings.onboardingComplete) return false;
  if (typeof document !== 'undefined' && (document.fullscreenElement || document.hidden || typing())) return false;
  return !state.tabs.some((tab) => tab.media === 'playing');
}
/** A website is on screen: the card goes to the native overlay (the same test toasts use). */
export const ratingOverWebsite = (state: Pick<BrowserSnapshot, 'tabs' | 'activeTabId'>): boolean => {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  return typeof window !== 'undefined' && Boolean((window as { acira?: unknown }).acira) && active?.contentKind === 'web' && !active.error;
};

/* Geometry (keep in step with rating.css): 320 wide; padding 12 top/bottom, 14 left, 12 right; the question keeps 28px clear of ×;
 * rows of 18 (question, 1–2 lines), 32 (stars) and 28 (buttons) with 10px gaps. The overlay host is sized from this before it paints. */
export const RATING_WIDTH = 320, RATING_EDGE = 16, RATING_SHADOW_ROOM = 16;
const QUESTION_WIDTH = RATING_WIDTH - 14 - 12 - 28;
// A hidden span rather than a canvas, so Inter's features count as they do on screen (canvas ignores them).
let measure: HTMLSpanElement | null | undefined;
function questionWidth(text: string) {
  if (measure === undefined && typeof document !== 'undefined' && document.body) {
    measure = document.createElement('span'); measure.setAttribute('aria-hidden', 'true');
    measure.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre;pointer-events:none;contain:layout style';
    document.body.append(measure);
  }
  if (!measure || (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded')) return text.length * 7.2;
  measure.style.font = '600 13px Inter, "Segoe UI", sans-serif'; measure.textContent = text; return Math.ceil(measure.getBoundingClientRect().width);
}
/** The card's box while it asks (the overlay host keeps this room through the thanks and the exit; the card sits at its bottom). */
export function ratingCardSize(feature: RatingFeature) {
  const lines = questionWidth(t('rating.question', { feature: t(`rating.feature.${feature}`) })) > QUESTION_WIDTH ? 2 : 1;
  return { width: RATING_WIDTH, height: 12 + lines * 18 + 10 + 32 + 10 + 28 + 12 };
}
