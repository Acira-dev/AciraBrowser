import type { Settings,TabSession,WindowUi } from './types';
import { NEW_TAB_URL } from './newTabPage';

type ChromeTab=Pick<TabSession,'url'|'contentKind'>;
type BookmarkSettings=Pick<Settings,'bookmarksBar'|'bookmarksOnNewTabOnly'>;

/** Start and browsing remember separate sidebar choices; navigation never rewrites either. */
export function workspacePreferenceKey(tab:ChromeTab):'workspaceOpen'|'webWorkspaceOpen' {
  /* an extension's page shown as the New Tab is a start page like Acira's own (runtime/newTabPage.ts) */
  return tab.contentKind==='web'&&tab.url!==NEW_TAB_URL?'webWorkspaceOpen':'workspaceOpen';
}

/** Opening or closing the sidebar is one choice for every page: a sidebar you closed stays closed on a new tab. */
export function sidebarPatch(open:boolean):Pick<WindowUi,'workspaceOpen'|'webWorkspaceOpen'> {
  return {workspaceOpen:open,webWorkspaceOpen:open};
}

export function workspaceIsOpen(ui:Pick<WindowUi,'workspaceOpen'|'webWorkspaceOpen'>,tab:ChromeTab):boolean {
  return ui[workspacePreferenceKey(tab)];
}

/** Compact and Focus can additionally conceal the row without changing this preference. */
export function bookmarksOnTab(settings:BookmarkSettings,tab:ChromeTab):boolean {
  const start=(tab.contentKind==='internal'||tab.url===NEW_TAB_URL)&&(tab.url===NEW_TAB_URL||tab.url==='acira://home');
  return settings.bookmarksBar&&(!settings.bookmarksOnNewTabOnly||start);
}

/** An explicit Show command must reveal bookmarks on the page where it was invoked. */
export function bookmarksTogglePatch(settings:BookmarkSettings,tab:ChromeTab):Partial<BookmarkSettings> {
  return bookmarksOnTab(settings,tab)?{bookmarksBar:false}:{bookmarksBar:true,bookmarksOnNewTabOnly:false};
}
