import type { BrowserSnapshot } from '../runtime/types';
import { toolbarLayout } from '../runtime/toolbarLayout';
import { windowViewOf } from '../runtime/windowView';

/** Round 2 (founder: every mode switch animates): the toolbar's own layout switches — compact or comfortable toolbar,
 * titles in the compact strip, the bookmarks bar on or off, hiding the toolbar until the top edge (Settings › Appearance › Layout) — go through A's layout view transition, like G's sidebar
 * and Focus mode switches (layoutMode.ts), so the rows glide to their new place instead of jumping. */
export function chromeLayoutChanged(previous: Pick<BrowserSnapshot, 'settings'> | null, next: Pick<BrowserSnapshot, 'settings'>) {
  if (!previous) return false;
  const a = previous.settings, b = next.settings;
  return toolbarLayout(a) !== toolbarLayout(b) || windowViewOf(a) !== windowViewOf(b) || (a.hideToolbar === true) !== (b.hideToolbar === true) || a.compactTabTitles !== b.compactTabTitles || a.bookmarksBar !== b.bookmarksBar || a.bookmarksOnNewTabOnly !== b.bookmarksOnNewTabOnly;
}
