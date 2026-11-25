/**
 * Active border (Beta 14): ONE look for every border that appears because something is active, chosen by the person in
 * Settings > Appearance > Active border. The selected Favorite, the selected tab (sidebar row and top tab), the address bar while typing in
 * it, a search field or text input while focused, and the focus ring of any control all read the same tokens (styles/active-border.css).
 * Resting borders (the address bar's quiet outline, card outlines, dividers) are not part of it.
 *
 * The style is written on the root as `<html data-active-border="divider-fade|lit-edge|hairline|inner-light|plain">`, in every view (the window,
 * the pop-up layer, internal pages), before the first paint, so the borders never draw in one style and then switch. The stylesheet keys its five looks
 * on that attribute; a Settings preview keys the same rules on `data-ab-scope` instead, so a card can show a look that is not the chosen one.
 *
 * Keyboard visibility (F1): Divider fade and Inner light are too faint to show where keyboard focus is (they fail the 3:1 check), so while the person is moving with
 * the keyboard those two add a 1px hairline. `<html data-input-modality="keyboard|pointer">` says which it is; the mouse shows the pure style.
 */
import type { ActiveBorderStyle } from '../runtime/types';
export type { ActiveBorderStyle };

/** The five looks, in the order Settings shows them. The first is the default. */
export const ACTIVE_BORDER_STYLES: readonly ActiveBorderStyle[] = ['divider-fade', 'lit-edge', 'hairline', 'inner-light', 'plain'];
export const DEFAULT_ACTIVE_BORDER: ActiveBorderStyle = 'divider-fade';

/** Any saved or received value as one of the five looks; anything else (a missing key from an older version, a hand-edited file) is the default. */
export function normalizeActiveBorder(value: unknown): ActiveBorderStyle {
  return ACTIVE_BORDER_STYLES.includes(value as ActiveBorderStyle) ? value as ActiveBorderStyle : DEFAULT_ACTIVE_BORDER;
}

/** The looks that are too faint to show keyboard focus on their own: they add a 1px hairline while the person is moving with the keyboard. */
export const NEEDS_KEYBOARD_HAIRLINE: readonly ActiveBorderStyle[] = ['divider-fade', 'inner-light'];

export type InputModality = 'keyboard' | 'pointer';

/** Keys that MOVE focus or act on what has it: they make the person a keyboard user. Plain typing in a field does not (a click into the address bar and
 *  then typing keeps the pure style; Ctrl/Cmd+L or Tab into it shows the hairline). */
const MOVING_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'F6']);
/** Does this key press show that the person is moving with the keyboard? Pure, so a test can hold it. */
export function movesWithKeyboard(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return false;
  return MOVING_KEYS.has(event.key) || !!event.ctrlKey || !!event.metaKey || !!event.altKey;
}

/** A press of the pointer this recently explains a focus change; one without it was moved by the keyboard (Cmd/Ctrl+L is handled in the main process, the interface page never sees its keys). */
export const POINTER_FOCUS_GRACE_MS = 400;
export const focusMovedByKeyboard = (msSincePointer: number): boolean => msSincePointer > POINTER_FOCUS_GRACE_MS;

let installed = false;
/**
 * Called once per view (main.tsx). Sets the default look at once, follows the setting through the interface's own snapshot (the same channel the language
 * follows), and keeps `data-input-modality` current. Safe to call twice.
 */
export function installActiveBorder(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  const apply = (style: ActiveBorderStyle) => { if (root.getAttribute('data-active-border') !== style) root.setAttribute('data-active-border', style); };
  apply(DEFAULT_ACTIVE_BORDER);
  const setModality = (modality: InputModality) => { if (root.getAttribute('data-input-modality') !== modality) root.setAttribute('data-input-modality', modality); };
  setModality('pointer');
  // The pointer's own time, not just its press: a drag lasts longer than the grace, and the focus React puts back on a dropped row lands 10 ms after the release. Read from the press alone,
  // that focus flipped the whole sidebar to "keyboard" at every drop (all its rows then ran the 204 ms --ab-k transition, and again at the next lift).
  let lastPointer = -Infinity, held = false;
  const released = () => { held = false; lastPointer = performance.now(); };
  addEventListener('keydown', event => { held = false; if (movesWithKeyboard(event)) setModality('keyboard'); }, true);
  addEventListener('pointerdown', () => { held = true; lastPointer = performance.now(); setModality('pointer'); }, true);
  for (const type of ['pointerup', 'pointercancel', 'dragend']) addEventListener(type, released, true);
  addEventListener('blur', released);   // the window lost the pointer (a release outside it): element blurs do not bubble, only the window's own reaches here
  // focus that arrives with no pointer behind it (Cmd/Ctrl+L, Tab, a shortcut handled by the main process) is keyboard focus; one while a button is held, or just after it was, is the pointer's
  addEventListener('focusin', () => { if (!held && focusMovedByKeyboard(performance.now() - lastPointer)) setModality('keyboard'); }, true);
  const watch = (raw: { settings?: { activeBorder?: unknown } } | null | undefined) => { if (raw?.settings) apply(normalizeActiveBorder(raw.settings.activeBorder)); };
  try { window.acira?.subscribe?.(watch as never); void window.acira?.getSnapshot?.().then(watch as never); } catch { /* no window to follow: the default look stays */ }
}
