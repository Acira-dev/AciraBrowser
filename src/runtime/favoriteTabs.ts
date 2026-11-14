import type { BrowserSnapshot, Settings, TabSession } from './types';
import { workspaceTabs } from './workspaces';
import { favoriteTabsInList, favoriteTabsOnlyInTile, tabListed } from './favoriteTabsRule';

/** A favorite and its tab (reviewer, 2 Nov: "fav tabs aren't a tab … it's basically a bookmark"; reported 6 Nov: "the tab must not disappear
 *  when it's added to Favorites"). The favorites themselves are the interface's, per profile (ui/sidebarApps.ts). A favorite is a saved address
 *  with a tile; the tab it is linked to is an ordinary tab in the list, exactly where it was, with its group and its place. The link is the
 *  tab's `favoriteId`, saved with the window, so it comes back after a restart. While that tab is open the tile shows it (a dot, the raised
 *  card while it is on screen) and a click on the tile goes to it, never to a second copy; on that tab, once you have browsed away, a click
 *  brings it back to the favorite's address. Closing the tab (Cmd+W, its ×, the tile editor's Close tab) leaves the favorite: the next click
 *  opens a new tab at its address and links that one. Pure. */
export const FAVORITE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
export const validFavoriteId = (value: unknown): value is string => typeof value === 'string' && FAVORITE_ID.test(value);

/** The tab a favorite is linked to in this profile, if it is open. */
export const favoriteTabOf = <T extends Pick<TabSession, 'favoriteId' | 'browserProfileId'>>(tabs: readonly T[], favoriteId: string, profileId: string): T | undefined =>
  tabs.find(tab => tab.favoriteId === favoriteId && tab.browserProfileId === profileId);

/** One linked tab per favorite in a window. A tab that arrives linked to a favorite another tab is linked to (Reopen closed tab, a
 *  duplicate, a secured workspace's tabs coming back, two saved links) keeps its page and its place but loses the link; the
 *  tab that was linked before wins. Run at the end of every action and on restore. */
export function settleFavoriteTabs(s: BrowserSnapshot, previous?: BrowserSnapshot): void {
  if (!s.tabs.some(tab => tab.favoriteId)) return;
  const before = new Set(previous?.tabs.filter(tab => tab.favoriteId).map(tab => tab.id + '\n' + tab.favoriteId));
  const rank = (tab: TabSession) => before.has(tab.id + '\n' + tab.favoriteId) ? 0 : 1, seen = new Set<string>();
  for (const tab of s.tabs.filter(tab => tab.favoriteId).sort((a, b) => rank(a) - rank(b))) {
    const key = tab.browserProfileId + '\n' + tab.favoriteId;
    if (!validFavoriteId(tab.favoriteId) || seen.has(key)) delete tab.favoriteId; else seen.add(key);
  }
}

export { favoriteTabsInList, favoriteTabsOnlyInTile, tabListed };

/** The tabs the list on screen shows, in order: the open workspace's, less a favorite's tab that Settings keep only in its tile (the default since 13.9). What
 *  "move tab" walks, since only these have a place to move to. */
export const rowTabs = (state: BrowserSnapshot): TabSession[] => workspaceTabs(state).filter(tab => tabListed(tab, state.settings));
/** The tabs Ctrl+1…9, Ctrl+PageDown/PageUp, Ctrl+Shift+PageDown/PageUp and Ctrl+Tab's Next tab walk: the open workspace's, in order. A favorite's tab that lives only in
 *  its tile is a tab like any other (13.9): the keys reach it and the counts include it. It comes after the rows of the list, so Ctrl+1…8 still land on the
 *  rows exactly as the numbers drawn on them say, nothing shifts for anyone who never opens a favorite, and the next tab after the last row is the first of the tiles'
 *  tabs; the last tab (Ctrl+9) is the last of them. Tile-only tabs keep the order of the window's tab list among themselves. */
export const listedTabs = (state: BrowserSnapshot): TabSession[] => {
  const all = workspaceTabs(state), rows = all.filter(tab => tabListed(tab, state.settings));
  return rows.length === all.length ? rows : [...rows, ...all.filter(tab => !tabListed(tab, state.settings))];
};
