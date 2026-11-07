// Keyboard focus follows the page, as in Chrome (founder, 6 Nov). A press in the sidebar or the tab strip gives the keyboard to the
// interface, so Space, the arrow keys and Page Down then went to the sidebar instead of the video or the page the person just chose.
// A plain press on a control that chooses a page asks main (`focus-page`, desktop/page-focus.cjs) to hand the keyboard to the tab
// on screen once it is shown. Keyboard activation (Enter or Space on a focused tab, detail 0) keeps the focus where the person is
// navigating, and so do modified clicks (background tab, new window), the second click of a double-click (a rename follows) and
// controls inside a tab (close, mute, a rename field).

/** What a page-choosing control looks like: the vertical sidebar's tabs, favorites, bookmarks, groups and media card; the tab strips'
 * tabs (`role="tab"`, horizontal and compact); the rail's rows. */
export const PAGE_PICK_SELECTOR = '[role="tab"], .sb-tab-main, .sb-app, .sb-bookmark, .sb-group-header, .sb-media-main, .ed-rail-tab, .ed-rail-app, .ed-rail-tab-group-name';
const NESTED_CONTROL = 'button, [role="button"], a, input, select, textarea, [contenteditable=""], [contenteditable="true"]';

export interface PickEvent { detail: number; button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; target: unknown }
interface PickElement { closest(selector: string): PickElement | null; contains(other: unknown): boolean }

/** True for a plain first press of the primary button on a control that chooses a page. */
export function choosesPage(event: PickEvent): boolean {
  if (event.detail !== 1 || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  const target = event.target as PickElement | null;
  if (!target || typeof target.closest !== 'function') return false;
  const pick = target.closest(PAGE_PICK_SELECTOR);
  if (!pick) return false;
  const inner = target.closest(NESTED_CONTROL);
  return !(inner && inner !== pick && pick.contains(inner));
}
