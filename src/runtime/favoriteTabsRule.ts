import type { Settings, TabSession } from './types';

/** Where a favorite's tab shows (Settings › Tabs › Sidebar › Favorites, founder 7 Nov: some people want it in the tab list too so they know which tab is
 *  a favorite, others want it only above). On, the default and what beta.11 did: the tab is an ordinary row of the list and its tile shows it. Off, Arc's
 *  way: a tab opened from or linked to a favorite lives only in its tile and the list does not repeat it. Only the sidebar layout has tiles: tabs along the
 *  top list every tab, so a linked tab is never out of reach there. (Favorites switched off, and a tab whose favorite is gone, list it too; that part is the
 *  interface's, ui/sidebarApps.ts listedInSidebar, because the favorites live in the interface. A tile folded behind "+N" still has its tab out of the list.) */
export const favoriteTabsInList = (settings: Pick<Settings, 'favoriteTabsInList'>): boolean => settings.favoriteTabsInList !== false;
export const favoriteTabsOnlyInTile = (settings: Pick<Settings, 'favoriteTabsInList' | 'verticalTabs'>): boolean => !favoriteTabsInList(settings) && !!settings.verticalTabs;
export const tabListed = (tab: Pick<TabSession, 'favoriteId'>, settings: Pick<Settings, 'favoriteTabsInList' | 'verticalTabs'>): boolean => !(tab.favoriteId && favoriteTabsOnlyInTile(settings));

