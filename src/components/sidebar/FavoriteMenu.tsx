import type { ReactNode } from 'react';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../../runtime/types';
import type { BrowserMenuIcon } from '../BrowserMenu';
import { Columns2, Copy, LayoutGrid, Link2, Moon, PenLine, Plus, RotateCw, Volume2, VolumeX, X, ArrowUpRight } from '../AppIcons';
import { favoriteTabOf } from '../../runtime/favoriteTabs';
import { isWebsite } from '../../runtime/newTabPage';
import { mayOfferSleep, sleepAction } from '../../runtime/tabSleepMenu';
import { readSidebarApps, removeSidebarAppWithUndo, type SidebarApp } from '../../ui/sidebarApps';
import { requestSidebar, sidebarWindowId } from '../../ui/sidebarSections';
import { favoriteEditTarget } from '../../ui/favoriteEdit';
import { copyText } from '../../ui/pageActions';
import { runtime } from '../../runtime/client';
import { t } from '../../i18n';

type Row = (label: string, Icon: BrowserMenuIcon, action: () => void, hint?: string) => ReactNode;

/** The right-click menu of a Favorite (Beta 14, E10 of the team's notes): the tab menu's rows that make sense for a Favorite, plus the Favorite's own (Edit, Remove from Favorites).
 *  An open Favorite (its tab exists) gets Reload, Duplicate, Copy address, Mute, Sleep, Split view, Move to new window, Close tab (the Favorite stays). A closed one gets Open, Open in new tab,
 *  Open in split view and Copy address. Left out as redundant for a Favorite: Pin, Rename, Add to Favorites, Close and remove, the bulk closes, Reopen closed tab, New tab rows. Edit asks the
 *  sidebar (it owns the tile the editor hangs from) through the sidebar request channel. */
export function FavoriteMenu({ state, dispatch, row, close }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; row: Row; close: () => void }) {
  // a popup may only carry a tab id: the sidebar leaves the Favorite here just before it opens the menu (the Edit favorite popover's hand-off)
  const target = favoriteEditTarget(), profileId = target?.profileId ?? state.activeBrowserProfileId;
  const app: SidebarApp | undefined = readSidebarApps(profileId, false).apps.find(item => item.id === target?.appId);
  if (!app) return <p className="bm-menu-note">{t('favoriteeditor.thisFavoriteWasRemoved')}</p>;
  const tab: TabSession | undefined = favoriteTabOf(state.tabs, app.id, profileId);
  const active = state.tabs.find(item => item.id === state.activeTabId);
  const run = (action: () => void) => () => { action(); close(); };
  const copy = () => void copyText(tab && isWebsite(tab) ? tab.url : app.url).then(() => dispatch({ type: 'toast', text: t('app.addressCopied') }), () => dispatch({ type: 'toast', text: t('app.couldnTCopyTheLink'), tone: 'error' }));
  const edit = row(t('acirasidebar.editFavorite'), PenLine, run(() => requestSidebar(sidebarWindowId(state), { kind: 'edit-favorite', appId: app.id })));
  const remove = row(t('acirasidebar.removeFromFavorites'), LayoutGrid, run(() => { const toast = removeSidebarAppWithUndo(profileId, false, app.id); if (toast) dispatch(toast); }));
  if (!tab) {
    const newTabId = () => 'tab-' + crypto.randomUUID();
    return <>
      {row(t('app.open'), ArrowUpRight, run(() => dispatch({ type: 'tab.new', url: app.url, browserProfileId: profileId, favoriteId: app.id })))}
      {row(t('bookmarkmenu.openInNewTab'), Plus, run(() => dispatch({ type: 'tab.new', url: app.url, browserProfileId: profileId, background: true })))}
      {active && isWebsite(active) && row(t('peek.openInSplit'), Columns2, run(() => { const id = newTabId(); dispatch({ type: 'tab.new', url: app.url, browserProfileId: profileId, id }); dispatch({ type: 'split.open', tabIds: [active.id, id] }); }))}
      {row(t('browsermenu.copyPageAddress'), Link2, run(copy))}
      <hr />{edit}{remove}
    </>;
  }
  const sleep = mayOfferSleep(state, tab) ? sleepAction([tab]) : null;
  return <>
    {row(t('app.reloadTab'), RotateCw, run(() => { if (tab.contentKind === 'web') void runtime.browserCommand({ type: 'reload', tabId: tab.id }); else dispatch({ type: 'tab.navigate', url: tab.url, tabId: tab.id }); }))}
    {row(t('app.duplicateTab'), Copy, run(() => dispatch({ type: 'tab.duplicate', id: tab.id })))}
    {isWebsite(tab) && row(t('browsermenu.copyPageAddress'), Link2, run(copy))}
    {isWebsite(tab) && row(tab.muted ? t('app.unmuteTab') : t('app.muteTab'), tab.muted ? Volume2 : VolumeX, run(() => dispatch({ type: 'tab.mute', id: tab.id, muted: !tab.muted })))}
    {sleep && row(t('tabsleep.menuTab'), Moon, run(() => dispatch(sleep)))}
    {isWebsite(tab) && tab.id !== state.activeTabId && active && isWebsite(active) && row(t('browsermenu.splitView'), Columns2, run(() => dispatch({ type: 'split.open', tabIds: [active.id, tab.id] })))}
    {row(t('app.moveToNewWindow'), Plus, run(() => dispatch({ type: 'tab.move-window', id: tab.id })))}
    <hr />{edit}{remove}<hr />
    {row(t('app.closeTab'), X, run(() => dispatch({ type: 'tab.close', id: tab.id })))}
  </>;
}
