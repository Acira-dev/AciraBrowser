import type { BrowserAction, BrowserSnapshot, Settings, TabSession } from './types';
import { workspaceIdOf } from './workspaces';

/**
 * 14.1 (a Discord ask): Settings > Tabs > "After closing a tab": go to the previous tab (13.10's rule, the default) or show an EMPTY PAGE,
 * as Arc does, so closing a tab never wakes another one.
 *
 * The empty page is one tab flagged `blank` (Zen's mechanism for the same behaviour): an `acira://new` tab, so nothing loads (main never
 * gives an Acira page a page view) and every lookup of "the tab on screen" keeps working (the address bar, the keys, the menus). It is
 * drawn as Acira's own quiet page (features/newtab/EmptyPage.tsx), never as a row: no list shows it (the sidebar, the strip, Mini, the
 * Shelf, the tab viewer, the palette, Ctrl+Tab, Ctrl+1…9, the counts), so with it on screen nothing in the list is selected.
 *
 * It exists only while it is shown, or while it is what a workspace not on screen showed last (so coming back to that workspace shows
 * the empty page again instead of waking one of its tabs). `settleEmptyPages` ends every action: picking any other tab of its workspace
 * removes it, and so does anything else that leaves it. It is never remembered as closed (no "Tab closed · Undo", no Rewind entry).
 * Typing an address or a search on it makes it an ordinary tab (the flag goes): it then appears in the list where a new tab would.
 */

export type CloseLanding = 'previous' | 'empty';
export const CLOSE_LANDINGS: readonly CloseLanding[] = ['previous', 'empty'];
export const closeLandingOf = (settings: Pick<Settings, 'closeTabLanding'> | undefined | null): CloseLanding => settings?.closeTabLanding === 'empty' ? 'empty' : 'previous';

/** The empty page, not a tab of the list. */
export const isEmptyPage = (tab: Pick<TabSession, 'blank'> | null | undefined): boolean => tab?.blank === true;
/** The tabs a list shows (every list skips the empty page). */
export const withoutEmptyPage = <T extends Pick<TabSession, 'blank'>>(tabs: readonly T[]): T[] => tabs.some(isEmptyPage) ? tabs.filter(tab => !isEmptyPage(tab)) : tabs as T[];

/**
 * Does this close of the tab on screen show the empty page? Only with the setting on, and only for the person's own close: main's own
 * closes (`remove` on an ordinary tab: a page closing itself, an extension's tabs.remove, Tor's new identity) keep 13.10's rule, so a
 * sign-in pop-up that closes itself still goes back to the page that opened it. A pinned tab's "Close and remove" is the person's.
 * A tab handed to another window is not a close.
 */
export function closeShowsEmptyPage(state: Pick<BrowserSnapshot, 'settings'>, action: Extract<BrowserAction, { type: 'tab.close' }>, keptByPin: boolean): boolean {
  if (closeLandingOf(state.settings) !== 'empty' || action.handedOver === true) return false;
  return action.remove !== true || keptByPin;
}

/**
 * The empty page's id, from the closed tab's id: the same in the interface (which runs a click's close at once, before main answers) and in main,
 * so the page the interface draws in the first frame is the one main's state names (a random id would remount it when main's state arrives, and
 * the interface would name a tab main does not have). The shape of every tab id (`tab-` and a version 4 UUID). Pure.
 */
export function emptyPageId(closedId: string): string {
  const word = (seed: number) => { let h = (0x811c9dc5 ^ seed) >>> 0; for (const char of 'empty-page|' + closedId) { h ^= char.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0).toString(16).padStart(8, '0'); };
  const hex = word(1) + word(2) + word(3) + word(4);
  return `tab-${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The empty page of the workspace and profile `closed` belonged to: the one already there, else a new one at the end of the strip (where a
 * new tab goes, so a search typed on it lands where Ctrl+T would have put it). `fresh` makes a New Tab of a profile (core.ts makeTab). Adds it to `s.tabs`.
 */
export function emptyPageFor(s: BrowserSnapshot, previous: BrowserSnapshot, closed: TabSession, fresh: (profileId: string) => TabSession): TabSession {
  const home = workspaceIdOf(previous, closed);
  const existing = s.tabs.find(tab => isEmptyPage(tab) && tab.browserProfileId === closed.browserProfileId && workspaceIdOf(s, tab) === home);
  if (existing) return existing;
  const tab = fresh(closed.browserProfileId), id = emptyPageId(closed.id);
  if (!s.tabs.some(item => item.id === id)) tab.id = id;
  tab.blank = true;
  if (home) tab.workspaceId = home;
  s.tabs.push(tab);
  return tab;
}

const opened = (tab: TabSession): boolean => isEmptyPage(tab) && (tab.url !== 'acira://new' || tab.history.length > 1 || tab.loading === true || !!tab.requestedUrl);
const ordinary = (tab: TabSession): TabSession => { const { blank: _blank, ...rest } = tab; return rest; };

/** Every action ends here: an empty page that is neither on screen nor what a workspace off screen showed last goes. The same object when nothing goes. */
export function settleEmptyPages(s: BrowserSnapshot): BrowserSnapshot {
  if (!s.tabs.some(isEmptyPage)) return s;
  // Something was opened on it (an address or a search typed in the address bar, a file, a bookmark): from now on it is an ordinary tab, in the list.
  if (s.tabs.some(opened)) s = { ...s, tabs: s.tabs.map(tab => opened(tab) ? ordinary(tab) : tab) };
  const kept = new Set<string>([s.activeTabId]);
  for (const [workspace, id] of Object.entries(s.windowUi.lastTabs ?? {})) if (workspace !== s.activeWorkspaceId) kept.add(id);
  const gone = s.tabs.filter(tab => isEmptyPage(tab) && !kept.has(tab.id));
  if (!gone.length) return s;
  const ids = new Set(gone.map(tab => tab.id));
  const lastTabs = s.windowUi.lastTabs ? Object.fromEntries(Object.entries(s.windowUi.lastTabs).filter(([, id]) => !ids.has(id))) : undefined;
  const trail = s.windowUi.tabTrail?.filter(id => !ids.has(id));
  const windowUi = { ...s.windowUi, ...(lastTabs ? { lastTabs } : {}), ...(trail ? { tabTrail: trail } : {}) };
  if (lastTabs && !Object.keys(lastTabs).length) delete windowUi.lastTabs;
  if (trail && !trail.length) delete windowUi.tabTrail;
  return { ...s, tabs: s.tabs.filter(tab => !ids.has(tab.id)), windowUi };
}
