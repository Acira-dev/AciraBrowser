import type { BrowserSnapshot, TabSession } from './types';
import { workspaceIdOf, workspacesFor, workspaceTabs } from './workspaces';

/** A favorite owns one tab (reviewer, 2 Nov: "fav tabs aren't a tab … it's basically a bookmark"; Arc, Zen and Dia work
 *  this way). The favorites themselves are the interface's, per profile (ui/sidebarApps.ts); the tab carries the
 *  favorite's id in `favoriteId`, so the link is saved with the window and comes back after a restart. Its tile opens
 *  that tab, returns to it and brings it back to the favorite's address; the sidebar's tab list leaves it out; closing it
 *  unloads the page and keeps the favorite. Pure. */
export const FAVORITE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
export const validFavoriteId = (value: unknown): value is string => typeof value === 'string' && FAVORITE_ID.test(value);

/** The tab a favorite owns in this profile, if it is open. */
export const favoriteTabOf = <T extends Pick<TabSession, 'favoriteId' | 'browserProfileId'>>(tabs: readonly T[], favoriteId: string, profileId: string): T | undefined =>
  tabs.find(tab => tab.favoriteId === favoriteId && tab.browserProfileId === profileId);

/** One tab per favorite in a window. A tab that arrives owning a favorite another tab already owns (Reopen closed tab, a
 *  duplicate, a secured workspace's tabs coming back, two saved owners) keeps its page but becomes an ordinary tab; the
 *  tab that owned the favorite before wins. Run at the end of every action and on restore. */
export function settleFavoriteTabs(s: BrowserSnapshot, previous?: BrowserSnapshot): void {
  if (!s.tabs.some(tab => tab.favoriteId)) return;
  const before = new Set(previous?.tabs.filter(tab => tab.favoriteId).map(tab => tab.id + '\n' + tab.favoriteId));
  const rank = (tab: TabSession) => before.has(tab.id + '\n' + tab.favoriteId) ? 0 : 1, seen = new Set<string>();
  for (const tab of s.tabs.filter(tab => tab.favoriteId).sort((a, b) => rank(a) - rank(b))) {
    const key = tab.browserProfileId + '\n' + tab.favoriteId;
    if (!validFavoriteId(tab.favoriteId) || seen.has(key)) delete tab.favoriteId; else seen.add(key);
  }
}

/** The tabs Ctrl+1…9, Ctrl+PageDown/PageUp, Ctrl+Shift+PageDown/PageUp and Ctrl+Tab's Next tab walk: the open workspace's, in
 *  order, without a favorite's own tab in the sidebar layout, where it lives in its tile and not in the list, so the numbers match
 *  the list on screen. The tab strip lists it (no Favorites there), so there it counts. */
export const listedTabs = (state: BrowserSnapshot): TabSession[] => {
  const here = workspaceTabs(state);
  return state.settings.verticalTabs ? here.filter(tab => !tab.favoriteId) : here;
};

/** Favorites are the same in every workspace of a profile, so the favorite's tab follows you: selected from another
 *  workspace of this window it moves into the one on screen (and out of its tab group there). It stays where it is when
 *  that would cross a secured workspace (its pages live in their own session) or break a split (a split's panes share one
 *  workspace); selecting it then opens its workspace, as selecting any tab does. True when it moved. */
export function bringTabHere(s: BrowserSnapshot, tab: TabSession): boolean {
  const here = s.activeWorkspaceId, own = workspacesFor(s, tab.browserProfileId), target = own.find(workspace => workspace.id === here);
  if (!target || tab.browserProfileId !== s.activeBrowserProfileId || workspaceIdOf(s, tab) === here) return false;
  if (target.secured || tab.privacy) return false;
  if (s.windowUi.split?.tabIds.includes(tab.id) || s.windowUi.splitGroups?.some(group => group.tabIds.includes(tab.id))) return false;
  tab.workspaceId = here;
  tab.group = '';
  return true;
}
