import type { Settings, TabSession } from './types';

/** Where a favorite's tab shows (Settings › Tabs › Sidebar › Favorites). Off, the default since 13.9 (people kept reporting "a Favorite opens a duplicate tab":
 *  an open Favorite showed twice, as its tile and as a row): a tab opened from or linked to a favorite lives only in its tile and the list does not repeat it,
 *  as in Arc. On: the tab is an ordinary row of the list as well, and its tile shows it (beta.11's way, kept by everyone who turned it On: only an explicit
 *  `true` means On, so a setting nobody touched reads Off). Only the sidebar layout has tiles: tabs along the top list every tab, so a linked tab is never out
 *  of reach there. (Favorites switched off, and a tab whose favorite is gone, list it too; that part is the interface's, ui/sidebarApps.ts listedInSidebar,
 *  because the favorites live in the interface.) A tile-only tab is still a tab: it counts in its workspace and the keyboard reaches it (favoriteTabs.ts). */
export const favoriteTabsInList = (settings: Pick<Settings, 'favoriteTabsInList'>): boolean => settings.favoriteTabsInList === true;
export const favoriteTabsOnlyInTile = (settings: Pick<Settings, 'favoriteTabsInList' | 'verticalTabs'>): boolean => !favoriteTabsInList(settings) && !!settings.verticalTabs;
export const tabListed = (tab: Pick<TabSession, 'favoriteId'>, settings: Pick<Settings, 'favoriteTabsInList' | 'verticalTabs'>): boolean => !(tab.favoriteId && favoriteTabsOnlyInTile(settings));
