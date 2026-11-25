import { groupForTab } from './tabGroups';
import { tabIsPinned } from './pinnedFolders';
import { workspaceIdOf } from './workspaces';
import { unloadLanding } from './tabTrail';
import type { BrowserAction, BrowserSnapshot, TabSession } from './types';

/**
 * "Unload tab" in the tab, group and workspace menus (named "Put to sleep" up to 13.9; beta.12 item 15). The unloading itself is main's (desktop/tab-sleep.cjs
 * `sleepNow`, the same engine as the automatic Memory Saver: the tab keeps its title, icon and place and its page loads again when it is opened). This file only
 * decides which tabs a menu has any reason to offer, from what the interface already knows, so a row never appears for a tab that could not be unloaded anyway:
 * a page of Acira's own (nothing to free), a tab already asleep, a private, Tor or secured tab, a tab in a private window, a pane of the split on screen.
 *   - The tab menu (one tab the person named) also offers a pinned tab, and the tab on screen when there is an AWAKE tab to move to first (tabTrail.ts unloadLanding).
 *   - The group and workspace menus (many tabs the person did not each choose) leave out the tab on screen and pinned tabs, and main keeps the Memory Saver's protections there.
 * Whether a page is playing something or holds typed input only the page can say; main checks that and tells the person with a toast.
 */
export type SleepScope = Pick<BrowserSnapshot, 'activeTabId' | 'windowUi' | 'browserProfiles'>;
type MenuScope = SleepScope & Pick<BrowserSnapshot, 'tabs' | 'tabGroups' | 'workspaces' | 'activeBrowserProfileId'>;

/** What no menu offers: no page to free, already asleep, never slept, or on screen in a split. */
function unloadable(state: SleepScope, tab: TabSession): boolean {
  if (tab.contentKind !== 'web' || !/^https?:/i.test(tab.url)) return false;
  if (tab.sleeping || tab.privacy || tab.error) return false;
  if (state.windowUi.split?.tabIds.includes(tab.id)) return false;
  return !state.browserProfiles.find(profile => profile.id === tab.browserProfileId)?.private;
}

/** Does the tab's own menu offer Unload tab? The tab on screen only if an awake tab can take its place. (13.10 also offers a pinned tab; Beta 14's pinned menu has its own row, pinnedClose.ts.) */
export function mayOfferSleep(state: MenuScope, tab: TabSession): boolean {
  // Beta 14: a pinned tab's menu already has its own Unload tab row (its close puts it to sleep in place: runtime/pinnedClose.ts), so this one is not offered twice.
  if (tabIsPinned(state, tab)) return false; // a tab of a pinned folder has that row too (pinned folders)
  return unloadable(state, tab) && (tab.id !== state.activeTabId || !!unloadLanding(state as BrowserSnapshot, tab));
}

/** Can a group's or workspace's Unload row act on this tab? Not the tab on screen, not a pinned one. */
const mayBulkSleep = (state: SleepScope, tab: TabSession): boolean => unloadable(state, tab) && !tab.pinned && tab.id !== state.activeTabId;

/** The tabs of `tabs` a "Put to sleep" row would act on. */
export const sleepableTabs = (state: SleepScope, tabs: readonly TabSession[]): TabSession[] => tabs.filter(tab => mayBulkSleep(state, tab));

/** The tabs of one group, as the group's menu counts them. */
export const groupSleepTabs = (state: Pick<BrowserSnapshot, 'tabs' | 'tabGroups'> & SleepScope, groupId: string): TabSession[] =>
  sleepableTabs(state, state.tabs.filter(tab => groupForTab(state, tab)?.id === groupId));

/** The tabs of one workspace in this window (every group in it, grouped or not). The interface's `tabs` are the open workspace's alone
 *  (runtime/workspaces.ts scopeToWorkspace); the other workspaces' tabs come as `otherWorkspaceTabs`, so a menu on any workspace sees them all. */
export const workspaceSleepTabs = (state: Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'otherWorkspaceTabs'> & SleepScope, workspaceId: string): TabSession[] =>
  sleepableTabs(state, [...state.tabs, ...(state.otherWorkspaceTabs ?? [])].filter(tab => workspaceIdOf(state, tab) === workspaceId));

/** The action a menu row sends for these tabs; null when there is nothing to send. */
export const sleepAction = (tabs: readonly TabSession[]): BrowserAction | null => tabs.length ? { type: 'tab.sleep', tabIds: tabs.map(tab => tab.id) } : null;
