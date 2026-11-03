import type { SplitGroup } from './splitLayout';
import type { BrowserSnapshot, ClosedTabSession, TabGroup, TabSession } from './types';

/**
 * Profiles as spaces (plan-profile-spaces v3 §3): joining profile windows into one window, and separating a window that holds
 * several profiles into one window per profile again. Pure; nothing calls these yet.
 *
 * A profile's part of a window is its tabs with their groups, splits and closed tabs, and the last tab each of its workspaces
 * showed. Tab ids are unique per window only (every window starts with 'tab-home'), so a tab arriving with an id its new window
 * already uses is renamed, and everything naming it follows (splits, groups' last tab, the workspaces' last tabs). Acira moves a
 * tab to another window by opening its address there, so tabs arrive as after a restart: not loading, not playing, no page yet.
 */
export interface ProfilePart {
  profileId: string;
  tabs: TabSession[];
  tabGroups: TabGroup[];
  splitGroups: SplitGroup[];
  closedTabs: ClosedTabSession[];
  lastTabs: Record<string, string>;
}

/** The ordinary profiles a window holds tabs of, the one on screen first. */
export function profilesIn(state: Pick<BrowserSnapshot, 'tabs' | 'activeBrowserProfileId' | 'browserProfiles'>): string[] {
  const ordinary = new Set(state.browserProfiles.filter(profile => !profile.private).map(profile => profile.id));
  const found = [...new Set(state.tabs.map(tab => tab.browserProfileId))].filter(id => ordinary.has(id));
  return found.sort((a, b) => Number(b === state.activeBrowserProfileId) - Number(a === state.activeBrowserProfileId));
}

/** Takes one profile's part out of a window (mutates `state`). The window's tab on screen falls to its first remaining tab when it was taken. */
export function takePart(state: BrowserSnapshot, profileId: string): ProfilePart {
  const tabs = state.tabs.filter(tab => tab.browserProfileId === profileId), ids = new Set(tabs.map(tab => tab.id));
  const ui = state.windowUi, splitGroups = (ui.splitGroups ?? []).filter(group => group.tabIds.length > 0 && group.tabIds.every(id => ids.has(id)));
  const lastTabs = ui.lastTabs ?? {}, mine = (id: string) => ids.has(id);
  const part: ProfilePart = {
    profileId, tabs,
    tabGroups: state.tabGroups.filter(group => group.browserProfileId === profileId),
    splitGroups,
    closedTabs: state.closedTabs.filter(tab => tab.browserProfileId === profileId),
    lastTabs: Object.fromEntries(Object.entries(lastTabs).filter(([, id]) => mine(id)))
  };
  const leaving = new Set(splitGroups);
  state.tabs = state.tabs.filter(tab => !ids.has(tab.id));
  state.tabGroups = state.tabGroups.filter(group => group.browserProfileId !== profileId);
  state.closedTabs = state.closedTabs.filter(tab => tab.browserProfileId !== profileId);
  state.windowUi = {
    ...ui,
    split: ui.split && ui.split.tabIds.some(mine) ? null : ui.split,
    ...(ui.splitGroups ? { splitGroups: ui.splitGroups.filter(group => !leaving.has(group)) } : {}),
    ...(ui.lastTabs ? { lastTabs: Object.fromEntries(Object.entries(lastTabs).filter(([, id]) => !mine(id))) } : {})
  };
  if (!state.tabs.some(tab => tab.id === state.activeTabId)) state.activeTabId = state.tabs[0]?.id ?? '';
  return part;
}

/** A tab as it arrives in another window: as after a restart. */
const arrived = (tab: TabSession, id: string): TabSession => ({ ...tab, id, loading: false, audible: false, media: undefined, capturing: undefined, progress: undefined, requestedUrl: undefined, risk: undefined, openerId: undefined });

/** An id not used in `taken` (and now used). */
function fresh(base: string, taken: Set<string>): string {
  let n = 2, id = `${base}-${n}`;
  while (taken.has(id)) id = `${base}-${++n}`;
  taken.add(id);
  return id;
}

/** Puts a profile's part into a window (mutates `state`), after the window's own tabs. Returns the tabs renamed (old id to new). */
export function addPart(state: BrowserSnapshot, part: ProfilePart): Map<string, string> {
  const taken = new Set(state.tabs.map(tab => tab.id)), renamed = new Map<string, string>();
  for (const tab of part.tabs) if (taken.has(tab.id)) renamed.set(tab.id, fresh(tab.id, taken)); else taken.add(tab.id);
  const name = (id: string) => renamed.get(id) ?? id;
  state.tabs = [...state.tabs, ...part.tabs.map(tab => arrived(tab, name(tab.id)))];
  const groupIds = new Set(state.tabGroups.map(group => group.id)), regrouped = new Map<string, string>();
  for (const group of part.tabGroups) if (groupIds.has(group.id)) regrouped.set(group.id, fresh(group.id, groupIds)); else groupIds.add(group.id);
  state.tabGroups = [...state.tabGroups, ...part.tabGroups.map(group => ({ ...group, id: regrouped.get(group.id) ?? group.id, ...(group.lastActiveTabId ? { lastActiveTabId: name(group.lastActiveTabId) } : {}) }))];
  const ui = state.windowUi, splitIds = new Set((ui.splitGroups ?? []).map(group => group.id));
  const splits = part.splitGroups.map(group => ({
    ...group,
    id: splitIds.has(group.id) ? fresh(group.id, splitIds) : (splitIds.add(group.id), group.id),
    tabIds: group.tabIds.map(name),
    ...(group.groupId ? { groupId: regrouped.get(group.groupId) ?? group.groupId } : {}),
    ...(group.home ? { home: name(group.home) } : {}),
    ...(group.linked ? { linked: group.linked.map(name) } : {}),
    ...(group.lastActiveTabId ? { lastActiveTabId: name(group.lastActiveTabId) } : {})
  }));
  const closedIds = new Set(state.closedTabs.map(tab => tab.id));
  const closed = part.closedTabs.map(tab => closedIds.has(tab.id) || taken.has(tab.id) ? { ...tab, id: fresh(tab.id, closedIds) } : (closedIds.add(tab.id), tab));
  state.closedTabs = [...closed, ...state.closedTabs];
  // A workspace both windows showed keeps the tab this window showed.
  const lastTabs = { ...Object.fromEntries(Object.entries(part.lastTabs).map(([workspace, id]) => [workspace, name(id)])), ...(ui.lastTabs ?? {}) };
  state.windowUi = { ...ui, ...(splits.length || ui.splitGroups ? { splitGroups: [...(ui.splitGroups ?? []), ...splits] } : {}), ...(Object.keys(lastTabs).length ? { lastTabs } : {}) };
  return renamed;
}
