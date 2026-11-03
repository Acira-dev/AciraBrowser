import { TAB_GROUP_COLORS } from './tabGroups';
import { cleanWorkspaceName, profilesAsSpaces, securedLocked, workspaceIdOf, workspaceName, workspacesFor } from './workspaces';
import type { BrowserSnapshot, TabGroup, TabGroupColor, TabSession, Workspace } from './types';

/**
 * Profiles as spaces (plan-profile-spaces v3): the choice where each profile is a space and there are no workspaces. A profile's
 * space is its first workspace; its other workspaces are put away (`parked`) and their tabs shown as tab groups in the space, so
 * nothing leaves the screen and nothing new is drawn. Switching back makes them workspaces again, with what the person did
 * meanwhile: a tab dragged out of a workspace's group stays in the space, a tab dropped into it goes with it, a renamed group
 * renames. Pure; nothing calls these yet.
 *
 *   - a workspace's loose tabs become one group named after it, in its colour (the workspace colours are the group colours);
 *   - its own groups keep their tabs and are named after it too ("Work · Hiring"), since groups can't hold groups;
 *   - its pinned tabs stay pinned in the space, marked so they go back;
 *   - splits move with their panes (a split lives where its panes live);
 *   - a secured workspace is put away only while locked (it has no tabs then); an unlocked one is left for the caller to lock.
 */
export const SPACE_GROUP_JOIN = ' · ';
const GROUP_NAME_MAX = 64;

/** The group colour of a workspace colour: the same hue, since workspace colours are the group palette; no colour stays none. */
export function groupColorOf(color: string | undefined): TabGroupColor {
  const hex = color?.toLowerCase();
  const found = hex ? (Object.entries(TAB_GROUP_COLORS) as [TabGroupColor, string][]).find(([name, value]) => name !== 'none' && value.toLowerCase() === hex) : undefined;
  return found ? found[0] : 'none';
}

/** A group name not used yet in the space (the profile's first workspace); "Work", else "Work 2", "Work 3"… */
function freeName(base: string, taken: Set<string>): string {
  const stem = base.trim().slice(0, GROUP_NAME_MAX) || 'Workspace';
  let name = stem;
  for (let n = 2; taken.has(name); n++) name = `${stem.slice(0, GROUP_NAME_MAX - String(n).length - 1)} ${n}`;
  taken.add(name);
  return name;
}

function freeGroupId(s: BrowserSnapshot, workspace: Workspace): string {
  let id = `group-space-${workspace.id}`.slice(0, 120);
  while (s.tabGroups.some(group => group.id === id)) id += '-new';
  return id;
}

export interface ToGroupsResult {
  /** True when a workspace was put away. */
  changed: boolean;
  /** Secured workspaces still unlocked (they hold tabs): left as they are, for the caller to lock first and run this again. */
  unlockedSecured: string[];
}

/** Puts away every profile's extra workspaces, their tabs shown as tab groups in the profile's space. Mutates `s`. */
export function workspacesToGroups(s: BrowserSnapshot): ToGroupsResult {
  const result: ToGroupsResult = { changed: false, unlockedSecured: [] };
  const onScreen = s.tabs.find(tab => tab.id === s.activeTabId);
  for (const profile of s.browserProfiles.filter(item => !item.private)) {
    const own = workspacesFor(s, profile.id), first = own[0];
    if (!first) continue;
    const taken = new Set(s.tabGroups.filter(group => group.browserProfileId === profile.id && !group.workspaceId).map(group => group.name));
    const moved: TabSession[] = [];
    for (const workspace of own.slice(1)) {
      // A workspace put away already (in another window, or before a restart) may still have tabs stamped with it here, or get one
      // (Rewind restores a tab into its workspace): they join its groups.
      const tabs = s.tabs.filter(tab => tab.browserProfileId === profile.id && workspaceIdOf(s, tab) === workspace.id);
      if (workspace.parked && !tabs.length) continue;
      if (workspace.secured) {
        // Locked, it holds at most its lock screen, which is only a placeholder; unlocked, its pages must be sealed first.
        if (!securedLocked(workspace)) { result.unlockedSecured.push(workspace.id); continue; }
        const screens = new Set(tabs.map(tab => tab.id));
        if (screens.size) s.tabs = s.tabs.filter(tab => !screens.has(tab.id));
        workspace.parked = true;
        result.changed = true;
        continue;
      }
      const label = workspaceName(workspace, 'Workspace');
      // Each own group's members are taken before anything is renamed: the loose tabs' group may take a name one of them had. A group
      // with no open tab (it stands for closed tabs, and comes back with one) is left where it is.
      const ownGroups = s.tabGroups.filter(group => group.browserProfileId === profile.id && group.workspaceId === workspace.id).map(group => ({ group, members: tabs.filter(tab => tab.group === group.name) })).filter(item => item.members.length);
      const loose = tabs.filter(tab => !tab.pinned && !tab.group && !tab.favoriteId);
      const standsFor = (original?: string) => s.tabGroups.find(group => group.browserProfileId === profile.id && !group.workspaceId && group.fromWorkspaceId === workspace.id && group.fromGroup === original);
      if (loose.length) {
        const existing = standsFor(undefined);
        const name = existing?.name ?? freeName(label, taken);
        if (!existing) s.tabGroups.push({ id: freeGroupId(s, workspace), name, color: groupColorOf(workspace.color), collapsed: !loose.some(tab => tab.id === s.activeTabId), browserProfileId: profile.id, fromWorkspaceId: workspace.id, fromName: name } satisfies TabGroup);
        for (const tab of loose) tab.group = name;
      }
      for (const { group, members } of ownGroups) {
        const original = group.name, existing = standsFor(original);
        if (existing) {
          // That group came back here (a closed tab reopened, another window's copy): its tabs join the one already standing for it.
          for (const tab of members) tab.group = existing.name;
          s.tabGroups.splice(s.tabGroups.indexOf(group), 1);
          continue;
        }
        const name = freeName(`${label}${SPACE_GROUP_JOIN}${original}`, taken);
        for (const tab of members) tab.group = name;
        delete group.workspaceId;
        Object.assign(group, { name, fromWorkspaceId: workspace.id, fromName: name, fromGroup: original });
      }
      // Places in the workspace: tabs that arrive later go after the ones it had.
      const after = Math.max(-1, ...s.tabs.filter(tab => tab.fromWorkspaceId === workspace.id && typeof tab.fromIndex === 'number').map(tab => tab.fromIndex!)) + 1;
      tabs.forEach((tab, index) => {
        delete tab.workspaceId;
        Object.assign(tab, { fromWorkspaceId: workspace.id, fromIndex: after + index });
        moved.push(tab);
      });
      workspace.parked = true;
      result.changed = true;
    }
    // The put-away workspaces' tabs follow the space's own, in workspace order (pinned ones still sit with the pinned).
    if (moved.length) { const ids = new Set(moved.map(tab => tab.id)); s.tabs = [...s.tabs.filter(tab => !ids.has(tab.id)), ...moved]; }
    if (onScreen && moved.includes(onScreen)) s.activeWorkspaceId = first.id;
  }
  // The tab on screen was a lock screen that went away: the space's first tab instead.
  if (!s.tabs.some(tab => tab.id === s.activeTabId) && s.tabs.length) {
    const space = s.tabs.find(tab => tab.browserProfileId === onScreen?.browserProfileId && !tab.workspaceId) ?? s.tabs[0];
    s.activeTabId = space.id;
    s.activeWorkspaceId = workspaceIdOf(s, space);
  }
  return result;
}

/** A workspace that came back puts its tabs in the order they had (grouping its loose tabs moved them together); a tab added
 *  meanwhile stays after the tab it followed. Only the slots its tabs hold in the window's list are used. */
function restoreOrder(s: BrowserSnapshot, workspace: Workspace): void {
  const slots: number[] = [], own: TabSession[] = [];
  s.tabs.forEach((tab, index) => { if (tab.browserProfileId === workspace.browserProfileId && tab.workspaceId === workspace.id) { slots.push(index); own.push(tab); } });
  let last = -1, added = 0;
  const keyed = own.map(tab => {
    const mine = tab.fromWorkspaceId === workspace.id && typeof tab.fromIndex === 'number';
    if (mine) { last = tab.fromIndex!; added = 0; }
    return { tab, key: mine ? last : last + 0.5 + ++added / 1e6 };
  });
  keyed.sort((a, b) => a.key - b.key).forEach((item, index) => { s.tabs[slots[index]] = item.tab; });
}

/** Brings every put-away workspace back with the tabs its groups hold now. Mutates `s`; true when one came back. */
export function groupsToWorkspaces(s: BrowserSnapshot): boolean {
  let changed = false;
  // The put-away workspaces, and those this window's groups and tabs still stand for (another window may have brought the shared
  // list back already).
  const named = new Set([...s.tabGroups.map(group => group.fromWorkspaceId), ...s.tabs.map(tab => tab.fromWorkspaceId)].filter(Boolean));
  for (const workspace of (s.workspaces || []).filter(item => item.parked || named.has(item.id))) {
    const profile = workspace.browserProfileId;
    delete workspace.parked;
    changed = true;
    for (const group of s.tabGroups.filter(item => item.fromWorkspaceId === workspace.id && item.browserProfileId === profile)) {
      const members = s.tabs.filter(tab => tab.browserProfileId === profile && !tab.workspaceId && !tab.pinned && tab.group === group.name);
      const renamed = group.name !== group.fromName;
      for (const tab of members) tab.workspaceId = workspace.id;
      if (group.fromGroup === undefined) {
        // The group of its loose tabs: they are loose again, and a name given meanwhile becomes the workspace's.
        for (const tab of members) tab.group = '';
        const name = renamed ? cleanWorkspaceName(group.name) : '';
        if (name && !workspacesFor(s, profile).some(other => other.id !== workspace.id && workspaceName(other).toLowerCase() === name.toLowerCase())) workspace.name = name;
        s.tabGroups.splice(s.tabGroups.indexOf(group), 1);
      } else {
        const name = renamed ? group.name : group.fromGroup;
        for (const tab of members) tab.group = name;
        group.name = name;
        group.workspaceId = workspace.id;
        delete group.fromWorkspaceId; delete group.fromName; delete group.fromGroup;
      }
    }
    for (const tab of s.tabs) if (tab.fromWorkspaceId === workspace.id && tab.pinned && tab.browserProfileId === profile && !tab.workspaceId) tab.workspaceId = workspace.id;
    restoreOrder(s, workspace);
    for (const tab of s.tabs) if (tab.fromWorkspaceId === workspace.id) { delete tab.fromWorkspaceId; delete tab.fromIndex; }
  }
  // Marks naming a workspace that is gone (deleted elsewhere, its profile removed) are dropped; the groups stay ordinary groups.
  for (const group of s.tabGroups) if (group.fromWorkspaceId) { delete group.fromWorkspaceId; delete group.fromName; delete group.fromGroup; changed = true; }
  for (const tab of s.tabs) if (tab.fromWorkspaceId !== undefined || tab.fromIndex !== undefined) { delete tab.fromWorkspaceId; delete tab.fromIndex; changed = true; }
  if (changed) { const onScreen = s.tabs.find(tab => tab.id === s.activeTabId); if (onScreen) s.activeWorkspaceId = workspaceIdOf(s, onScreen); }
  return changed;
}

/** True when the window's workspaces don't match the choice yet: with profiles as spaces, an extra workspace still open (or tabs
 *  or groups still in one); with workspaces, anything still put away or marked. An unlocked secured workspace waits for its lock. */
function unsettled(s: BrowserSnapshot): boolean {
  if (profilesAsSpaces(s)) {
    return s.browserProfiles.some(profile => !profile.private && workspacesFor(s, profile.id).slice(1).some(workspace => {
      if (workspace.secured && !securedLocked(workspace)) return false;
      return !workspace.parked || s.tabs.some(tab => tab.browserProfileId === profile.id && workspaceIdOf(s, tab) === workspace.id);
    }));
  }
  return (s.workspaces || []).some(workspace => workspace.parked) || s.tabGroups.some(group => group.fromWorkspaceId) || s.tabs.some(tab => tab.fromWorkspaceId !== undefined);
}

/** Makes a window's workspaces match the "Switch between" choice. Run with every action and whenever a window settles its
 *  workspaces (start, restore, another window's change), so each window turns its own tabs over when the choice reaches it, and a
 *  switch cut short (a crash) is finished at the next start. Does nothing while they match: every window today. */
export function settleSpaces(s: BrowserSnapshot): void {
  if (!unsettled(s)) return;
  if (profilesAsSpaces(s)) workspacesToGroups(s); else groupsToWorkspaces(s);
}

/** The one toast after "Switch between" changes (plan v3 §3, step 6), from the state before the change. Turned on, it names whose
 *  other workspaces became tab groups (the profile on screen first; secured ones are put away, not grouped). Turned off, each profile
 *  has its own window again. */
export function spacesChangedToast(before: BrowserSnapshot, next: 'profiles' | 'workspaces'): { id: 'profiles.spacesOn' | 'profiles.spacesOnPlain' | 'profiles.spacesOff'; params?: { name: string } } {
  if (next === 'workspaces') return { id: 'profiles.spacesOff' };
  const grouped = before.browserProfiles.filter(profile => !profile.private && workspacesFor(before, profile.id).slice(1).some(workspace => !workspace.secured));
  const named = grouped.find(profile => profile.id === before.activeBrowserProfileId) ?? grouped[0];
  return named ? { id: 'profiles.spacesOn', params: { name: named.name } } : { id: 'profiles.spacesOnPlain' };
}
