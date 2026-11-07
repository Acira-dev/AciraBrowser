import { groupForTab } from './tabGroups';
import { workspaceIdOf } from './workspaces';
import type { BrowserAction, BrowserSnapshot, TabSession } from './types';

/**
 * "Put to sleep" in the tab, group and workspace menus (beta.12 item 15). The sleep itself is main's (desktop/tab-sleep.cjs
 * `sleepNow`, the same protections as the automatic Memory Saver: sound, camera, microphone, screen, typed input, downloads,
 * notification sites, calls and music sites, the never-sleep list ...). This file only decides which tabs a menu has any reason
 * to offer, from what the interface already knows, so a row never appears for a tab that could not go to sleep anyway:
 * the tab on screen (the window's active tab or a pane of the split on screen), a pinned tab, a private, Tor or secured tab,
 * a page of Acira's own (nothing to free), a tab already asleep, and a tab in a private window. Whether a page is playing
 * something or holds typed input only the page can say; main checks that and tells the person with a toast.
 */
export type SleepScope = Pick<BrowserSnapshot, 'activeTabId' | 'windowUi' | 'browserProfiles'>;

/** Can this tab be put to sleep as far as the interface can tell? */
export function mayOfferSleep(state: SleepScope, tab: TabSession): boolean {
  if (tab.contentKind !== 'web' || !/^https?:/i.test(tab.url)) return false;
  if (tab.sleeping || tab.pinned || tab.privacy || tab.error) return false;
  if (tab.id === state.activeTabId || state.windowUi.split?.tabIds.includes(tab.id)) return false;
  return !state.browserProfiles.find(profile => profile.id === tab.browserProfileId)?.private;
}

/** The tabs of `tabs` a "Put to sleep" row would act on. */
export const sleepableTabs = (state: SleepScope, tabs: readonly TabSession[]): TabSession[] => tabs.filter(tab => mayOfferSleep(state, tab));

/** The tabs of one group, as the group's menu counts them. */
export const groupSleepTabs = (state: Pick<BrowserSnapshot, 'tabs' | 'tabGroups'> & SleepScope, groupId: string): TabSession[] =>
  sleepableTabs(state, state.tabs.filter(tab => groupForTab(state, tab)?.id === groupId));

/** The tabs of one workspace in this window (every group in it, grouped or not). The interface's `tabs` are the open workspace's alone
 *  (runtime/workspaces.ts scopeToWorkspace); the other workspaces' tabs come as `otherWorkspaceTabs`, so a menu on any workspace sees them all. */
export const workspaceSleepTabs = (state: Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'otherWorkspaceTabs'> & SleepScope, workspaceId: string): TabSession[] =>
  sleepableTabs(state, [...state.tabs, ...(state.otherWorkspaceTabs ?? [])].filter(tab => workspaceIdOf(state, tab) === workspaceId));

/** The action a menu row sends for these tabs; null when there is nothing to send. */
export const sleepAction = (tabs: readonly TabSession[]): BrowserAction | null => tabs.length ? { type: 'tab.sleep', tabIds: tabs.map(tab => tab.id) } : null;
