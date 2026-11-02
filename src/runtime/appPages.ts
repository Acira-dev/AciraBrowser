import type { BrowserSnapshot, TabSession } from './types';

/** Acira's own pages that menus, buttons and shortcuts open in a tab of their own (or the tab already showing them), so the page
 * you were on stays as it was: a video keeps playing, a half-typed form keeps its text (founder, 30 Oct: Settings replaced a
 * playing YouTube tab, which reloaded on Back and vanished on Home). */
const APP_PAGE = /^acira:\/\/(settings|history|downloads|bookmarks|rewind|routines)$/;

/** The app page an address names ('settings'), or null for anything else. */
export function appPageOf(url: string): string | null {
  return APP_PAGE.exec(url)?.[1] ?? null;
}

/** Back on an app page with nothing behind it closes that tab and returns to the tab it was opened from, while that tab is still open. */
export function backReturnsToOpener(state: Pick<BrowserSnapshot, 'tabs'>, tab: TabSession): boolean {
  return tab.contentKind !== 'web' && tab.historyIndex <= 0 && !!appPageOf(tab.url) && !!tab.openerId && tab.openerId !== tab.id && state.tabs.some(other => other.id === tab.openerId);
}
