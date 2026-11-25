import type { BrowserSnapshot } from '../runtime/types';
import { favoriteEditTarget } from './favoriteEdit';
import { readSidebarApps } from './sidebarApps';
import { favoriteTabOf } from '../runtime/favoriteTabs';
import { isWebsite } from '../runtime/newTabPage';
import { mayOfferSleep } from '../runtime/tabSleepMenu';

/** The content height of a Favorite's menu (components/sidebar/FavoriteMenu.tsx), counted from the rows it draws: a row is 30, a divider 9, the padding 44. Measured in the real app: an open
 *  Favorite (9 rows, 2 dividers) 332, a closed one (6 rows, 1 divider) 233, the same in dark and light at 100% and 150% (tests/popup-heights.json). The Favorite is the one the sidebar left in the
 *  Edit popover's hand-off just before it opened the menu; with none, the open Favorite's typical menu. */
export function favoriteMenuHeight(state: BrowserSnapshot): number {
  const ROW = 30, RULE = 9, BASE = 44, typical = BASE + 9 * ROW + 2 * RULE;
  const target = favoriteEditTarget(), app = target && readSidebarApps(target.profileId, false).apps.find(item => item.id === target.appId);
  if (!target || !app) return typical;
  const tab = favoriteTabOf(state.tabs, app.id, target.profileId), active = state.tabs.find(item => item.id === state.activeTabId);
  if (!tab) return BASE + (5 + (active && isWebsite(active) ? 1 : 0)) * ROW + RULE;   // Open, Open in new tab, [Split view], Copy address, then Edit and Remove after the divider: 5 or 6 rows
  const web = isWebsite(tab);
  const rows = 2 + (web ? 2 : 0) + (mayOfferSleep(state, tab) ? 1 : 0) + (web && tab.id !== state.activeTabId && active && isWebsite(active) ? 1 : 0) + 1 + 2 + 1;   // Reload, Duplicate, [Copy, Mute], [Sleep], [Split], Move, Edit, Remove, Close
  return BASE + rows * ROW + 2 * RULE;
}
