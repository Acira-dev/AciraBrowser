import enMessages from '../i18n/en.json';
import { format as formatMessage } from '../i18n/format';
import { navigationTitle } from './navigation';
import { settleSpaces } from './profileSpaces';
import { leaveSplit, normalizeSplitGroups } from './splitGroups';
import { normalizeSplit } from './splitLayout';
import { TAB_GROUP_COLORS } from './tabGroups';
import { restoreClosedBatch } from './undoClose';
import type { BrowserAction, BrowserSnapshot, ClosedTabSession, StatusIcon, TabGroup, TabSession, Workspace } from './types';

/**
 * Workspaces (R3-57): modes inside one profile. A profile is who you are (sign-ins, history, bookmarks, extensions); a
 * workspace is what you are doing (its tabs, pinned tabs, groups, splits, name, icon, colour).
 *
 * How it is stored (docs/launch/proposals/R3-57_WORKSPACES.md): `state.workspaces` lists every profile's workspaces
 * (shared by all windows, like the profiles); each tab and tab group carries `workspaceId`; the tab on screen decides which
 * workspace is open (`activeWorkspaceId` always follows it), so every way of picking a tab (the address bar, the palette,
 * closing a tab, Undo) also keeps the workspace right. A tab or group with no `workspaceId` belongs to the profile's first
 * workspace: someone who never makes a second workspace has data exactly as before. Naming: "workspace" also means the
 * sidebar / page host inside the code (`workspaceOpen`, `openWorkspacePage`); those names are older and unrelated.
 */
export const MAX_WORKSPACES = 8;
export const WORKSPACE_NAME_MAX = 40;
/** The glyph choices: ids the interface draws from its own icon family (WorkspaceGlyph.tsx). Anything else stored in `icon` is one letter or emoji. */
export const WORKSPACE_GLYPHS = ['workspace', 'home', 'code', 'palette', 'book', 'flask', 'bag', 'globe', 'users', 'headphones', 'video', 'mail', 'star', 'bolt', 'terminal', 'file'] as const;
export type WorkspaceGlyphId = typeof WORKSPACE_GLYPHS[number];
/** The id the first workspace wore before R4-23 (the layers stack, which is also Rewind's mark). Still valid in saved data; it draws as the workspace glyph. */
export const LEGACY_WORKSPACE_GLYPH = 'layers';
/** The colour choices: the tab group palette, so one set of hues means "colour" everywhere. */
export const WORKSPACE_COLOR_NAMES = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'cyan', 'grey'] as const;
export const WORKSPACE_COLORS: readonly string[] = WORKSPACE_COLOR_NAMES.map(name => TAB_GROUP_COLORS[name]);

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const NEW_ID = /^workspace-[0-9a-f-]{36}$/;
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export const cleanWorkspaceName = (value: unknown): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WORKSPACE_NAME_MAX) : '';
export const validWorkspaceColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
/** A glyph id, or exactly one letter, number or emoji (the rule profile avatars use). */
export function validWorkspaceIcon(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 16) return false;
  if ((WORKSPACE_GLYPHS as readonly string[]).includes(value) || value === LEGACY_WORKSPACE_GLYPH) return true;
  return !!segmenter && [...segmenter.segment(value)].length === 1 && /^(?:\p{Extended_Pictographic}|\p{L}|\p{N})/u.test(value);
}

type Scoped = { workspaces?: Workspace[] };
export const workspacesFor = (state: Scoped, profileId: string): Workspace[] => (state.workspaces || []).filter(workspace => workspace.browserProfileId === profileId);
/** The workspace a tab (or group) is in: its own stamp when that workspace exists in its profile, else the profile's first. */
export function workspaceIdOf(state: Scoped, item: { browserProfileId: string; workspaceId?: string }): string {
  const own = workspacesFor(state, item.browserProfileId);
  return (item.workspaceId && own.some(workspace => workspace.id === item.workspaceId) ? item.workspaceId : own[0]?.id) ?? '';
}
/** True when `id` has a tab in this window (the interface only switches optimistically to a workspace that does). */
export const workspaceHasTabs = (state: Pick<BrowserSnapshot, 'tabs' | 'workspaces'>, id: string): boolean => state.tabs.some(tab => workspaceIdOf(state, tab) === id);
/** Settings › Profiles "Switch between: Profiles as spaces" (runtime/profileSpaces.ts): each profile is a space, there are no workspaces. */
export const profilesAsSpaces = (state: { settings?: Pick<BrowserSnapshot['settings'], 'spaces'> }): boolean => state.settings?.spaces === 'profiles';
type Listed = Pick<BrowserSnapshot, 'workspaces' | 'activeBrowserProfileId'> & Partial<Pick<BrowserSnapshot, 'settings' | 'browserProfiles'>>;
/** What the window's switcher lists (none in a private or Tor window): the window's profile's workspaces, or with profiles as
 *  spaces one space per ordinary profile, which is that profile's first workspace (its others are put away). */
export const windowWorkspaces = (state: Listed): Workspace[] => {
  if (profilesAsSpaces(state) && state.browserProfiles) {
    const ordinary = state.browserProfiles.filter(profile => !profile.private);
    if (!ordinary.some(profile => profile.id === state.activeBrowserProfileId)) return [];
    return ordinary.flatMap(profile => workspacesFor(state, profile.id).slice(0, 1));
  }
  return workspacesFor(state, state.activeBrowserProfileId).filter(workspace => !workspace.parked);
};
/** The workspace Ctrl+Alt+PageDown (1) or PageUp (-1) opens: the window's next / previous one, wrapping round (main's workspace-cycle). None with one workspace. */
export function cycledWorkspace(state: Pick<BrowserSnapshot, 'workspaces' | 'activeBrowserProfileId' | 'activeWorkspaceId'>, direction: 1 | -1): Workspace | undefined {
  const list = windowWorkspaces(state), at = list.findIndex(item => item.id === state.activeWorkspaceId);
  return list.length < 2 ? undefined : list[(Math.max(0, at) + direction + list.length) % list.length];
}
export const activeWorkspaceOf = (state: Pick<BrowserSnapshot, 'workspaces' | 'activeBrowserProfileId' | 'activeWorkspaceId'>): Workspace | undefined => windowWorkspaces(state).find(workspace => workspace.id === state.activeWorkspaceId);
/** Where the window is: its open workspace and the profile on screen. */
export interface WindowPlace { id: string; profile: string }
/** True when the window says a switch out loud (WorkspaceSwitchFeedback, "Work workspace, 12 tabs"): another of its two or more
 *  workspaces opened. With profiles as spaces every space switch also changes the profile on screen and is said the same way;
 *  with workspaces a change of profile (a window taking over from another) stays quiet. */
export const switchSpoken = (state: Listed, before: WindowPlace | null, now: WindowPlace): boolean =>
  !!before && before.id !== now.id && (before.profile === now.profile || profilesAsSpaces(state)) && windowWorkspaces(state).length >= 2;
/** What the interface calls the first workspace until it is renamed. */
export const FIRST_WORKSPACE_NAME = 'Main';
export const workspaceName = (workspace: Pick<Workspace, 'name'>, unnamed: string = FIRST_WORKSPACE_NAME): string => workspace.name || unnamed;
const macLike = (): boolean => { try { return /Mac/i.test(globalThis.navigator?.platform ?? '') || (typeof process !== 'undefined' && process.platform === 'darwin'); } catch { return false; } };
/** The default key of the Nth workspace as a toast writes it (Alt+1 on Windows and Linux, ⌃1 on a Mac); the interface shows the live key where it can. */
export const workspaceKeyLabel = (index: number): string => index >= 0 && index < MAX_WORKSPACES ? (macLike() ? `⌃${index + 1}` : `Alt+${index + 1}`) : '';
/** R4-48 P0-6: the first workspace ("Main") wears the profile's colour unless it was given its own; the others only their own. */
export function workspaceColorOf(state: Pick<BrowserSnapshot, 'browserProfiles' | 'settings'> & Scoped, workspace: Workspace): string | undefined {
  if (workspace.color) return workspace.color;
  const own = workspacesFor(state, workspace.browserProfileId);
  if (own[0]?.id !== workspace.id) return undefined;
  const profile = state.browserProfiles.find(item => item.id === workspace.browserProfileId), fallback = state.settings.defaultProfileId || state.browserProfiles.find(item => !item.private && !(item as { tor?: boolean }).tor)?.id;
  return profile && !profile.private && profile.id !== fallback && validWorkspaceColor(profile.color) ? profile.color.toLowerCase() : undefined;
}
/** Tabs (and tabs with a page, not just a new tab) per workspace of the window's profile, from the full state. */
export function workspaceCounts(state: Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'activeBrowserProfileId'> & Partial<Pick<BrowserSnapshot, 'settings' | 'browserProfiles'>>): Record<string, { tabs: number; pages: number }> {
  const counts: Record<string, { tabs: number; pages: number }> = {};
  for (const workspace of windowWorkspaces(state)) counts[workspace.id] = { tabs: 0, pages: 0 };
  for (const tab of state.tabs) {
    // A favorite's own tab is the favorite's (favoriteTabs.ts), shown in its tile and not in any workspace's list. Every other tab
    // counts in its own profile's workspace, so only listed ones count (with profiles as spaces, every profile's).
    if (tab.favoriteId) continue;
    const entry = counts[workspaceIdOf(state, tab)];
    if (entry) { entry.tabs++; if (tab.url !== 'acira://new') entry.pages++; }
  }
  return counts;
}

function cleanEntry(raw: Workspace): Workspace {
  const legacyDefault = raw.id === 'workspace-default' && raw.name === 'My workspace';
  return { id: raw.id, browserProfileId: raw.browserProfileId, name: legacyDefault ? '' : cleanWorkspaceName(raw.name), ...(validWorkspaceIcon(raw.icon) ? { icon: raw.icon } : {}), ...(validWorkspaceColor(raw.color) ? { color: raw.color.toLowerCase() } : {}), ...(raw.secured === true ? { secured: true as const, ...(raw.unlocked === true ? { unlocked: true as const } : {}) } : {}), ...(raw.parked === true ? { parked: true as const } : {}) };
}
/** Step one of settling a window: the list itself. Every ordinary profile has at least one workspace and at most eight; entries are clean; legacy rows stay. */
function cleanWorkspaceList(s: BrowserSnapshot): void {
  const profiles = s.browserProfiles.filter(profile => !profile.private), ids = new Set<string>(), next: Workspace[] = [], counts = new Map<string, number>();
  for (const raw of Array.isArray(s.workspaces) ? s.workspaces : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id) || !profiles.some(profile => profile.id === raw.browserProfileId)) continue;
    const count = counts.get(raw.browserProfileId) ?? 0;
    if (count >= MAX_WORKSPACES) continue;
    counts.set(raw.browserProfileId, count + 1); ids.add(raw.id); next.push(cleanEntry(raw));
  }
  for (const profile of profiles) {
    if (counts.get(profile.id)) continue;
    let id = profile.id === 'profile-personal' ? 'workspace-default' : `workspace-${profile.id}`.slice(0, 120);
    while (ids.has(id)) id += '-new';
    ids.add(id); next.push({ id, name: '', browserProfileId: profile.id });
  }
  s.workspaces = next;
}
/** Step two: every tab and group names a workspace the canonical way (no stamp for the profile's first), the open workspace follows the tab on screen, and the remembered tabs are real. */
function settleWorkspaces(s: BrowserSnapshot): void {
  const first = new Map<string, string>(), known = new Map(s.workspaces.map(workspace => [workspace.id, workspace]));
  for (const workspace of s.workspaces) if (!first.has(workspace.browserProfileId)) first.set(workspace.browserProfileId, workspace.id);
  const canon = (item: { browserProfileId: string; workspaceId?: string }) => {
    const own = item.workspaceId ? known.get(item.workspaceId) : undefined;
    if (!own || own.browserProfileId !== item.browserProfileId || first.get(own.browserProfileId) === own.id) delete item.workspaceId;
  };
  for (const tab of s.tabs) canon(tab);
  // The tabs of a workspace waiting for its Undo keep naming it, though it is not in the list for now.
  const waiting = new Set((s.closedWorkspaces ?? []).map(entry => entry.batch));
  for (const tab of s.closedTabs) if (!tab.closedBatch || !waiting.has(tab.closedBatch)) canon(tab);
  for (const group of s.tabGroups) canon(group);
  const active = s.tabs.find(tab => tab.id === s.activeTabId);
  s.activeWorkspaceId = active ? workspaceIdOf(s, active) : first.get(s.activeBrowserProfileId) ?? '';
  // The tab each workspace showed last; only kept while the profile has more than one workspace.
  if (windowWorkspaces(s).length > 1) {
    const remembered: Record<string, string> = {};
    for (const [workspace, id] of Object.entries(s.windowUi.lastTabs ?? {})) {
      const tab = typeof id === 'string' ? s.tabs.find(item => item.id === id) : undefined;
      if (tab && known.has(workspace) && workspaceIdOf(s, tab) === workspace) remembered[workspace] = id;
    }
    if (active && s.activeWorkspaceId) remembered[s.activeWorkspaceId] = active.id;
    s.windowUi.lastTabs = remembered;
  } else if (s.windowUi.lastTabs) delete s.windowUi.lastTabs;
  if (!s.closedWorkspaces?.length) delete s.closedWorkspaces;
}
/** Makes a state's workspaces valid in place (restore, another window's change, the end of every action). */
export function normalizeWorkspaces(s: BrowserSnapshot): void { cleanWorkspaceList(s); settleSpaces(s); settleWorkspaces(s); }

const say = (s: BrowserSnapshot, id: string, params?: Record<string, string | number>, extra: { action?: NonNullable<BrowserSnapshot['toast']>['action']; tone?: 'error' | 'info' | 'status'; icon?: StatusIcon } = {}) => {
  const now = Date.now();
  s.toast = { id: now, at: now, text: formatMessage('en', (enMessages as Record<string, string>)[id], params), i18n: { id, ...(params ? { params } : {}) }, ...(extra.tone ? { tone: extra.tone } : {}), ...(extra.icon ? { icon: extra.icon } : {}), ...(extra.action ? { action: extra.action } : {}) };
};
const undoAction = (command: BrowserAction) => ({ label: 'Undo', labelId: 'toast.undo', command });

type MakeTab = () => TabSession;

/*
 * Secured workspaces (R3-38, R4-48 P2-4: the one isolated kind). The reducer half: which tabs are secured, the lock screen, and
 * what locking and unlocking do to the window's lists. Main (desktop/secured-workspaces.cjs) owns the rest: it seals a
 * workspace's tabs into the vault BEFORE it sends `workspace.secured-lock`, and sends `workspace.secured-unlock` (with the tabs it
 * opened) only after Windows Hello. Neither internal action is accepted from the interface (desktop/validation.cjs).
 */
/** The one page a locked secured workspace shows ("Work is locked · Unlock with Windows Hello"). */
export const LOCKED_URL = 'acira://locked';
export const securedLocked = (workspace: Pick<Workspace, 'secured' | 'unlocked'> | undefined): boolean => !!workspace?.secured && !workspace.unlocked;
/** True when the profile's workspace `id` is secured (its tabs share one memory-only session and are never saved in plain form). */
export const isSecuredWorkspace = (state: Scoped, id: string | undefined): boolean => !!id && !!state.workspaces?.some(workspace => workspace.id === id && workspace.secured);
/** The lock screen tab of a locked workspace: reused when it exists, else made. Private, so it is never saved. */
function lockedTab(s: BrowserSnapshot, workspace: Workspace, fresh: MakeTab): TabSession {
  const existing = s.tabs.find(tab => tab.url === LOCKED_URL && tab.workspaceId === workspace.id);
  if (existing) return existing;
  const tab = fresh();
  Object.assign(tab, { url: LOCKED_URL, title: navigationTitle(LOCKED_URL), contentKind: 'internal', history: [LOCKED_URL], historyIndex: 0, searchDraft: '', favicon: '', workspaceId: workspace.id, privacy: 'secured' as const, pinned: false, group: '' });
  s.tabs.push(tab); return tab;
}
/** Where a tab goes when it may not stay in a locked workspace: the profile's first workspace (which is never secured). */
const openHome = (s: BrowserSnapshot, profile: string): string | undefined => workspacesFor(s, profile).find(workspace => !workspace.secured)?.id;
/** The tab a workspace shows when it opens: the one it showed last, else its first tab outside a collapsed group, else a new tab. */
function entryTab(s: BrowserSnapshot, workspace: string, fresh: MakeTab, mine: TabSession[] = s.tabs.filter(tab => workspaceIdOf(s, tab) === workspace)): TabSession {
  const last = mine.find(tab => tab.id === s.windowUi.lastTabs?.[workspace]);
  if (last) return last;
  const open = mine.find(tab => !s.tabGroups.some(group => group.name === tab.group && group.browserProfileId === tab.browserProfileId && (group.workspaceId ?? '') === (tab.workspaceId ?? '') && group.collapsed)) ?? mine[0];
  if (open) return open;
  const own = s.workspaces.find(item => item.id === workspace);
  if (own && securedLocked(own)) return lockedTab(s, own, fresh);
  const tab = fresh(); tab.workspaceId = workspace; if (own?.secured) tab.privacy = 'secured'; s.tabs.push(tab); return tab;
}
const activate = (s: BrowserSnapshot, tab: TabSession) => {
  s.activeTabId = tab.id; for (const other of s.tabs) delete other.openerId;
  const group = s.tabGroups.find(item => item.name === tab.group && item.browserProfileId === tab.browserProfileId && (item.workspaceId ?? '') === (tab.workspaceId ?? ''));
  if (group) { group.collapsed = false; group.lastActiveTabId = tab.id; }
  // A tab that belongs to a saved split opens it again, as a split shows in the workspace it was made in.
  const saved = s.windowUi.splitGroups?.find(item => item.tabIds.includes(tab.id));
  s.windowUi.split = saved ? normalizeSplit(saved, s.tabs.map(item => item.id), tab.id) : null;
  s.settings.zoom = tab.zoom;
};
const nameTaken = (s: BrowserSnapshot, profile: string, name: string, except?: string) => workspacesFor(s, profile).some(workspace => workspace.id !== except && workspaceName(workspace).toLowerCase() === name.toLowerCase());

/** The workspace actions. Returns true when it handled the action (the reducer then finishes), 'ignore' when nothing changed, false when the action is not a workspace one. */
export function applyWorkspaceAction(s: BrowserSnapshot, action: BrowserAction, fresh: MakeTab): boolean | 'ignore' {
  const profile = s.activeBrowserProfileId, owner = s.browserProfiles.find(item => item.id === profile);
  if (action.type === 'tab.restore') {
    // Reopen closed tab brings back the newest tab closed in the workspace on screen (the base action takes the first closed tab).
    if (windowWorkspaces(s).length < 2) return false;
    const at = s.closedTabs.findIndex(tab => workspaceIdOf(s, tab) === s.activeWorkspaceId);
    if (at > 0) s.closedTabs.unshift(...s.closedTabs.splice(at, 1));
    return false;
  }
  if (!action.type.startsWith('workspace.')) return false;
  if (!owner || owner.private) return 'ignore';
  if (profilesAsSpaces(s)) {
    // Profiles as spaces: there are no workspaces to make, edit or move tabs to; picking a space opens that profile's tab, in this
    // window (the one it showed last there, else its first, else a new tab of that profile). A secured workspace still open always
    // locks (main seals it before profiles become spaces; its workspace.secured-lock must never be dropped, or its page stays up).
    // A tab dropped on another profile's space stays where it is (its pages are its profile's): a toast says so and offers to open its
    // address in that profile (QA #10). A private, Tor or secured page is never opened elsewhere.
    if (action.type === 'workspace.move-tabs') {
      const space = windowWorkspaces(s).find(item => item.id === action.workspaceId), tab = s.tabs.find(item => item.id === s.activeTabId && action.tabIds.includes(item.id)) ?? s.tabs.find(item => item.id === action.tabIds[0]);
      const other = space && s.browserProfiles.find(item => item.id === space.browserProfileId && item.id !== tab?.browserProfileId);
      if (!tab || !other) return 'ignore';
      const name = { name: other.name };
      say(s, 'workspaces.tabsStayInProfile', undefined, { tone: 'info', ...(tab.privacy ? {} : { action: { label: formatMessage('en', (enMessages as Record<string, string>)['workspaces.openInProfile'], name), labelId: 'workspaces.openInProfile', labelParams: name, command: { type: 'tab.new', url: tab.url, browserProfileId: other.id } } }) });
      return true;
    }
    if (action.type !== 'workspace.select' && action.type !== 'workspace.lock' && action.type !== 'workspace.secured-lock') return 'ignore';
  }
  if (profilesAsSpaces(s) && action.type === 'workspace.select') {
    const space = windowWorkspaces(s).find(item => item.id === action.id);
    if (!space || space.id === s.activeWorkspaceId) return 'ignore';
    const own = s.tabs.filter(tab => tab.browserProfileId === space.browserProfileId && workspaceIdOf(s, tab) === space.id);
    activate(s, entryTab(s, space.id, () => Object.assign(fresh(), { browserProfileId: space.browserProfileId }), own));
    return true;
  }
  const mine = workspacesFor(s, profile);
  switch (action.type) {
    case 'workspace.create': {
      const name = cleanWorkspaceName(action.name);
      if (!name) return 'ignore';
      if (mine.length >= MAX_WORKSPACES) { say(s, 'runtime.workspaceLimit', { count: MAX_WORKSPACES }, { tone: 'info' }); return true; }
      if (nameTaken(s, profile, name)) { say(s, 'runtime.workspaceNameTaken', { name }, { tone: 'info' }); return true; }
      let id = typeof action.id === 'string' && NEW_ID.test(action.id) && !s.workspaces.some(item => item.id === action.id) ? action.id : `workspace-${crypto.randomUUID()}`;
      while (s.workspaces.some(item => item.id === id)) id = `workspace-${crypto.randomUUID()}`;
      const workspace: Workspace = { id, name, browserProfileId: profile, ...(validWorkspaceIcon(action.icon) ? { icon: action.icon } : {}), ...(validWorkspaceColor(action.color) ? { color: action.color.toLowerCase() } : {}) };
      const from = s.activeWorkspaceId, previous = mine.find(item => item.id === from) ?? mine[0], fromIndex = previous ? mine.indexOf(previous) : 0;
      // "This tab": the tab asked for (the tab menu's Move to › New workspace…), else the one on screen; a split comes along whole.
      const picked = action.tabs === 'current' ? s.tabs.find(tab => tab.id === (action.tabId ?? s.activeTabId) && tab.browserProfileId === profile && !tab.privacy) : undefined;
      s.workspaces.push(workspace);
      // The tab Main (or whichever was open) showed, so Go back lands on it: with one workspace nothing was remembered yet.
      if (from && action.tabs !== 'move' && !(picked && picked.id === s.activeTabId)) s.windowUi.lastTabs = { ...(s.windowUi.lastTabs ?? {}), [from]: s.activeTabId };
      let moved = 0;
      if (action.tabs === 'move') {
        for (const tab of s.tabs) if (tab.browserProfileId === profile && workspaceIdOf(s, tab) === from) { tab.workspaceId = id; moved++; }
        for (const group of s.tabGroups) if (group.browserProfileId === profile && workspaceIdOf(s, group) === from) group.workspaceId = id;
      } else if (picked) {
        const ids = new Set([picked.id]);
        // A split moves with its own panes; a linked copy (a group tab also drawn in it) stays in its group's workspace and leaves the split,
        // and a copy's tab moves alone.
        for (const group of s.windowUi.splitGroups ?? []) if (group.tabIds.includes(picked.id)) {
          const copies = group.linked ?? [];
          if (copies.includes(picked.id)) leaveSplit(s, group.id, picked.id);
          else { group.tabIds.filter(tabId => !copies.includes(tabId)).forEach(tabId => ids.add(tabId)); copies.forEach(tabId => leaveSplit(s, group.id, tabId)); }
        }
        for (const tab of s.tabs) if (ids.has(tab.id)) { tab.workspaceId = id; tab.group = ''; }
        activate(s, picked);
      } else {
        const tab = fresh(); tab.workspaceId = id; s.tabs.push(tab); activate(s, tab);
      }
      // R4-48 P0-1: say where everything went, the previous workspace's key, and a way straight back.
      if (previous) {
        const back = { label: 'Go back', labelId: 'workspaces.goBack', command: { type: 'workspace.select', id: previous.id } as BrowserAction };
        if (action.tabs === 'move') say(s, 'workspaces.createdAll', { name, previous: workspaceName(previous), count: moved, key: workspaceKeyLabel(fromIndex) }, { action: back });
        else say(s, 'workspaces.created', { name, previous: workspaceName(previous), key: workspaceKeyLabel(fromIndex) }, { action: back });
      }
      return true;
    }
    case 'workspace.select': {
      const workspace = mine.find(item => item.id === action.id);
      if (!workspace || workspace.id === s.activeWorkspaceId) return 'ignore';
      activate(s, entryTab(s, workspace.id, fresh));
      return true;
    }
    case 'workspace.update': {
      const workspace = s.workspaces.find(item => item.id === action.id && item.browserProfileId === profile);
      if (!workspace) return 'ignore';
      // A locked workspace can't be renamed or recoloured by whoever is at the PC: it needs Windows Hello first.
      if (securedLocked(workspace)) { say(s, 'workspaces.unlockFirst', { name: workspaceName(workspace) }, { tone: 'info' }); return true; }
      const before = JSON.stringify(workspace), patch = action.patch || {};
      if (Object.hasOwn(patch, 'name')) {
        const name = cleanWorkspaceName(patch.name);
        if (!name) return 'ignore';
        if (nameTaken(s, profile, name, workspace.id)) { say(s, 'runtime.workspaceNameTaken', { name }, { tone: 'info' }); return true; }
        workspace.name = name;
      }
      if (Object.hasOwn(patch, 'icon') && validWorkspaceIcon(patch.icon)) workspace.icon = patch.icon;
      if (Object.hasOwn(patch, 'color')) { if (patch.color === null) delete workspace.color; else if (validWorkspaceColor(patch.color)) workspace.color = patch.color.toLowerCase(); }
      return JSON.stringify(workspace) === before ? 'ignore' : true;
    }
    case 'workspace.lock': return 'ignore'; // main seals the tabs first, then sends workspace.secured-lock
    case 'workspace.secured-set': {
      const workspace = mine.find(item => item.id === action.id);
      if (!workspace || !!workspace.secured === action.secured) return 'ignore';
      if (action.secured) {
        // The first workspace is where tabs go when a secured one locks; it stays an ordinary one.
        if (mine[0]?.id === workspace.id) { say(s, 'workspaces.securedNotFirst', undefined, { tone: 'info' }); return true; }
        workspace.secured = true; workspace.unlocked = true;
        // Its tabs move to the workspace's own memory-only session (main reloads them there) with their groups and splits; pins and closed tabs stay behind.
        for (const tab of s.tabs) if (tab.browserProfileId === profile && workspaceIdOf(s, tab) === workspace.id) { tab.privacy = 'secured'; tab.pinned = false; }
        s.closedTabs = s.closedTabs.filter(tab => !(tab.browserProfileId === profile && workspaceIdOf(s, tab) === workspace.id));
        if (s.closedPrivateTabs) s.closedPrivateTabs = s.closedPrivateTabs.filter(tab => !(tab.browserProfileId === profile && workspaceIdOf(s, tab) === workspace.id));
        say(s, 'workspaces.securedOn', { name: workspaceName(workspace) });
      } else {
        if (!workspace.unlocked) return 'ignore';
        delete workspace.secured; delete workspace.unlocked;
        for (const tab of s.tabs) if (tab.privacy === 'secured' && workspaceIdOf(s, tab) === workspace.id) delete tab.privacy;
        say(s, 'workspaces.securedOff', { name: workspaceName(workspace) });
      }
      return true;
    }
    case 'workspace.secured-lock': {
      const workspace = mine.find(item => item.id === action.id && item.secured);
      if (!workspace || !workspace.unlocked) return 'ignore';
      delete workspace.unlocked;
      const wasOpen = s.activeWorkspaceId === workspace.id;
      // Its tabs, tab groups and splits leave the window's lists entirely (main sealed them first): nothing can show a title, group name or icon that is not there.
      s.tabs = s.tabs.filter(tab => workspaceIdOf(s, tab) !== workspace.id);
      s.tabGroups = s.tabGroups.filter(group => workspaceIdOf(s, group) !== workspace.id);
      if (s.windowUi.splitGroups) s.windowUi.splitGroups = s.windowUi.splitGroups.filter(group => group.tabIds.every(id => s.tabs.some(tab => tab.id === id)));
      if (s.windowUi.lastTabs) delete s.windowUi.lastTabs[workspace.id];
      if (wasOpen || !s.tabs.some(tab => tab.id === s.activeTabId)) {
        if (wasOpen) activate(s, lockedTab(s, workspace, fresh));
        else { const home = openHome(s, profile); activate(s, home ? entryTab(s, home, fresh) : lockedTab(s, workspace, fresh)); }
      }
      // A lock the person asked for says so; one that happened while they were away (idle, minimised, Windows locked) only
      // clears an older workspace toast ("…is unlocked" must not greet them over the lock screen), which says it on its own.
      if (!action.reason || action.reason === 'manual') say(s, 'workspaces.lockedToast', { name: workspaceName(workspace) }, { tone: 'info' });
      else if (s.toast?.i18n?.id?.startsWith('workspaces.')) s.toast = null;
      return true;
    }
    case 'workspace.secured-unlock': {
      const workspace = mine.find(item => item.id === action.id && item.secured);
      if (!workspace || workspace.unlocked) return 'ignore';
      workspace.unlocked = true;
      const wasOpen = s.activeWorkspaceId === workspace.id;
      s.tabs = s.tabs.filter(tab => !(tab.url === LOCKED_URL && tab.workspaceId === workspace.id));
      const known = new Set(s.tabs.map(tab => tab.id)), back: TabSession[] = [];
      for (const raw of Array.isArray(action.tabs) ? action.tabs : []) {
        if (!raw || typeof raw.id !== 'string' || known.has(raw.id) || typeof raw.url !== 'string') continue;
        const tab = fresh(), url = raw.url, web = /^https?:\/\//i.test(url);
        Object.assign(tab, { id: raw.id, url, title: typeof raw.title === 'string' ? raw.title : '', history: Array.isArray(raw.history) && raw.history.length ? raw.history : [url], historyIndex: typeof raw.historyIndex === 'number' ? raw.historyIndex : 0, zoom: typeof raw.zoom === 'number' ? raw.zoom : tab.zoom, muted: raw.muted === true, workspaceId: workspace.id, privacy: 'secured' as const, pinned: false, group: typeof raw.group === 'string' ? raw.group : '' });
        if (web) { tab.contentKind = 'web'; tab.searchDraft = url; }
        if (typeof raw.customTitle === 'string' && raw.customTitle) tab.customTitle = raw.customTitle;
        known.add(tab.id); back.push(tab);
      }
      s.tabs.push(...back);
      // Its tab groups and splits come back exactly as they were sealed (the reducer's reconcile and windowUiState check them).
      for (const raw of Array.isArray(action.groups) ? action.groups : []) {
        if (!raw || typeof raw.id !== 'string' || !ID.test(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || s.tabGroups.some(group => group.id === raw.id || (group.name === raw.name && group.browserProfileId === profile && group.workspaceId === workspace.id))) continue;
        s.tabGroups.push({ id: raw.id, name: raw.name, color: typeof raw.color === 'string' ? raw.color as TabGroup['color'] : 'none', collapsed: raw.collapsed === true, browserProfileId: profile, workspaceId: workspace.id, ...(typeof raw.lastActiveTabId === 'string' && back.some(tab => tab.id === raw.lastActiveTabId) ? { lastActiveTabId: raw.lastActiveTabId } : {}) });
      }
      const splits = normalizeSplitGroups(Array.isArray(action.splits) ? action.splits : [], back), present = s.windowUi.splitGroups ?? [];
      if (splits.length) s.windowUi.splitGroups = [...present, ...splits.filter(split => !present.some(item => item.id === split.id))];
      if (wasOpen || !s.tabs.some(tab => tab.id === s.activeTabId)) activate(s, back.find(tab => tab.id === action.activeId) ?? back[0] ?? entryTab(s, workspace.id, fresh));
      // A brief status pill, not a queued toast: it never waits out a minimised window to greet the person over a lock screen later.
      say(s, 'workspaces.unlockedToast', { name: workspaceName(workspace) }, { tone: 'status', icon: 'workspace' });
      return true;
    }
    case 'workspace.delete': {
      const workspace = mine.find(item => item.id === action.id);
      if (!workspace) return 'ignore';
      if (mine.length < 2) { say(s, 'runtime.workspaceKeepOne', undefined, { tone: 'info' }); return true; }
      // A passer-by can't throw away a locked workspace: deleting it needs it open.
      if (securedLocked(workspace)) { say(s, 'workspaces.unlockFirst', { name: workspaceName(workspace) }, { tone: 'info' }); return true; }
      const doomed = s.tabs.filter(tab => tab.browserProfileId === profile && workspaceIdOf(s, tab) === workspace.id), gone = new Set(doomed.map(tab => tab.id));
      const neighbour = mine[mine.indexOf(workspace) - 1] ?? mine[mine.indexOf(workspace) + 1];
      const batch = `close-${Date.now()}-${workspace.id}`.slice(0, 150), groups = s.tabGroups.filter(group => group.browserProfileId === profile && workspaceIdOf(s, group) === workspace.id).map(group => structuredClone(group));
      const wasActive = gone.has(s.activeTabId);
      for (const tab of doomed) {
        const index = s.tabs.indexOf(tab); s.tabs.splice(index, 1);
        if (!tab.privacy) s.closedTabs.unshift({ ...tab, workspaceId: workspace.id, closedIndex: index, closedBatch: batch, closedRev: s.revision } as ClosedTabSession);
      }
      s.closedTabs = s.closedTabs.slice(0, Math.max(50, doomed.length));
      if (s.closedPrivateTabs) s.closedPrivateTabs = s.closedPrivateTabs.filter(tab => !(tab.browserProfileId === profile && workspaceIdOf(s, tab) === workspace.id));
      s.tabGroups = s.tabGroups.filter(group => !(group.browserProfileId === profile && workspaceIdOf(s, group) === workspace.id));
      const index = s.workspaces.indexOf(workspace); s.workspaces.splice(index, 1);
      s.closedWorkspaces = [{ workspace, index, batch, groups }, ...(s.closedWorkspaces ?? [])].slice(0, 5);
      if (wasActive || !s.tabs.some(tab => tab.id === s.activeTabId)) activate(s, entryTab(s, neighbour.id, fresh));
      say(s, 'runtime.workspaceDeleted', { name: workspaceName(workspace) }, { action: undoAction({ type: 'workspace.restore', id: workspace.id }) });
      return true;
    }
    case 'workspace.restore': {
      const entry = s.closedWorkspaces?.find(item => item.workspace.id === action.id);
      if (!entry || s.workspaces.some(item => item.id === entry.workspace.id) || !s.browserProfiles.some(item => item.id === entry.workspace.browserProfileId && !item.private)) return 'ignore';
      if (workspacesFor(s, entry.workspace.browserProfileId).length >= MAX_WORKSPACES) { say(s, 'runtime.workspaceLimit', { count: MAX_WORKSPACES }, { tone: 'info' }); return true; }
      const workspace = { ...entry.workspace };
      // A name taken while it was in the Undo list comes back as "Work 2", "Work 3"...; the number always fits (a 40-character name loses its tail, not its suffix).
      for (let n = 2, base = workspaceName(workspace); nameTaken(s, workspace.browserProfileId, workspaceName(workspace)); n++) workspace.name = `${base.slice(0, WORKSPACE_NAME_MAX - String(n).length - 1)} ${n}`;
      // Coming back into the first place changes what "no stamp" means: whoever has none now stays in the workspace they are in.
      const first = workspacesFor(s, workspace.browserProfileId)[0];
      if (first) for (const item of [...s.tabs, ...s.closedTabs, ...s.tabGroups]) if (item.browserProfileId === workspace.browserProfileId && !item.workspaceId) item.workspaceId = first.id;
      s.workspaces.splice(Math.min(entry.index, s.workspaces.length), 0, workspace);
      for (const group of entry.groups) if (!s.tabGroups.some(item => item.id === group.id)) s.tabGroups.push({ ...group, workspaceId: workspace.id });
      for (const tab of s.closedTabs) if (tab.closedBatch === entry.batch) tab.workspaceId = workspace.id;
      s.closedWorkspaces = s.closedWorkspaces!.filter(item => item !== entry);
      if (!restoreClosedBatch(s, entry.batch, { activate: true })) { const tab = fresh(); tab.workspaceId = workspace.id; s.tabs.push(tab); activate(s, tab); }
      else activate(s, s.tabs.find(tab => tab.id === s.activeTabId) ?? entryTab(s, workspace.id, fresh));
      if (s.toast?.action?.command.type === 'workspace.restore') s.toast = null;
      return true;
    }
    case 'workspace.move-tabs': {
      const target = mine.find(item => item.id === action.workspaceId);
      if (!target) return 'ignore';
      if (securedLocked(target)) { say(s, 'workspaces.unlockFirst', { name: workspaceName(target) }, { tone: 'info' }); return true; }
      // A secured workspace's tabs stay in it: their session is its own.
      if (action.tabIds.some(id => s.tabs.find(tab => tab.id === id)?.privacy === 'secured') && !target.secured) { say(s, 'workspaces.securedStays', undefined, { tone: 'info' }); return true; }
      const asked = new Set(action.tabIds);
      // A split moves whole: its panes live in one workspace.
      // (Linked copies stay in their groups: they leave the split instead of travelling with it.)
      for (const group of [...(s.windowUi.splitGroups ?? [])]) {
        const copies = group.linked ?? [], own = group.tabIds.filter(id => !copies.includes(id));
        if (own.some(id => asked.has(id))) { own.forEach(id => asked.add(id)); copies.filter(id => !asked.has(id)).forEach(id => leaveSplit(s, group.id, id)); }
        else copies.filter(id => asked.has(id)).forEach(id => leaveSplit(s, group.id, id));
      }
      const moving = s.tabs.filter(tab => asked.has(tab.id) && tab.browserProfileId === profile && workspaceIdOf(s, tab) !== target.id);
      if (!moving.length) return 'ignore';
      const from = workspaceIdOf(s, moving[0]), movedIds = new Set(moving.map(tab => tab.id)), wasActive = movedIds.has(s.activeTabId), order = s.tabs.map(tab => tab.id), anchor = order.indexOf(s.activeTabId);
      for (const tab of moving) { tab.workspaceId = target.id; tab.group = ''; }
      if (wasActive) {
        const left = s.tabs.filter(tab => workspaceIdOf(s, tab) === from && !movedIds.has(tab.id) && tab.browserProfileId === profile);
        const next = left.find(tab => order.indexOf(tab.id) > anchor) ?? left.at(-1);
        if (next) activate(s, next); else { const tab = fresh(); tab.workspaceId = from; s.tabs.push(tab); activate(s, tab); }
      }
      say(s, 'runtime.workspaceMoved', { name: workspaceName(target) }, { action: undoAction({ type: 'workspace.move-tabs', tabIds: moving.map(tab => tab.id), workspaceId: from }) });
      return true;
    }
    default: return false;
  }
}

/** Run at the end of every action: new tabs land in the workspace they were opened in, closing the tab on screen stays in its workspace, and the open workspace, canonical stamps and remembered tabs are settled. */
export function finishWorkspaces(s: BrowserSnapshot, previous: BrowserSnapshot, action: BrowserAction, fresh: MakeTab): void {
  cleanWorkspaceList(s);
  if (s.workspaces.length) {
    const known = new Set(previous.tabs.map(tab => tab.id)), reopened = new Set(previous.closedTabs.map(tab => tab.id));
    for (const tab of s.tabs) {
      if (known.has(tab.id) || reopened.has(tab.id) || tab.workspaceId) continue;
      const own = workspacesFor(s, tab.browserProfileId);
      const asked = action.type === 'tab.new' && action.workspaceId ? own.find(workspace => workspace.id === action.workspaceId)?.id : undefined;
      const opener = !asked && action.type === 'tab.new' && action.afterId ? previous.tabs.find(item => item.id === action.afterId) : undefined;
      const home = asked ?? (opener && opener.browserProfileId === tab.browserProfileId ? workspaceIdOf(previous, opener) : own.some(workspace => workspace.id === previous.activeWorkspaceId) ? previous.activeWorkspaceId : own[0]?.id);
      if (home) tab.workspaceId = home;
    }
    if (action.type === 'tab.close' && previous.activeTabId === action.id) {
      const closed = previous.tabs.find(tab => tab.id === action.id), shown = s.tabs.find(tab => tab.id === s.activeTabId);
      if (closed) {
        const home = workspaceIdOf(previous, closed);
        if (!shown || workspaceIdOf(s, shown) !== home) {
          // The base action picked a neighbour in another workspace: stay in this one.
          const mine = s.tabs.filter(tab => workspaceIdOf(s, tab) === home && tab.browserProfileId === closed.browserProfileId), order = previous.tabs.map(tab => tab.id), at = order.indexOf(closed.id), has = (id: string) => mine.some(tab => tab.id === id);
          const nextId = (closed.openerId && has(closed.openerId) ? closed.openerId : undefined) ?? order.slice(at + 1).find(has) ?? order.slice(0, at).reverse().find(has);
          let next = mine.find(tab => tab.id === nextId);
          if (!next) { next = fresh(); next.workspaceId = home; s.tabs.push(next); }
          s.activeTabId = next.id; s.settings.zoom = next.zoom;
        }
      }
    }
  }
  guardSecured(s, previous, fresh);
  // Profiles as spaces (profileSpaces.ts): the workspaces follow the "Switch between" choice; nothing to do while they match.
  settleSpaces(s);
  settleWorkspaces(s);
}
/** The secured rules every action ends with: a locked workspace holds only its lock screen (a tab opened into it goes to the first workspace), every tab of a secured workspace is secured, and a lock screen that is no longer needed goes. */
function guardSecured(s: BrowserSnapshot, previous: BrowserSnapshot, fresh: MakeTab): void {
  if (!s.workspaces.some(workspace => workspace.secured) && !s.tabs.some(tab => tab.privacy === 'secured')) return;
  const known = new Set(previous.tabs.map(tab => tab.id)), byId = new Map(s.workspaces.map(workspace => [workspace.id, workspace]));
  for (const tab of [...s.tabs]) {
    const workspace = byId.get(workspaceIdOf(s, tab));
    if (tab.url === LOCKED_URL) {
      if (!workspace || !securedLocked(workspace) || tab.workspaceId !== workspace.id) { s.tabs.splice(s.tabs.indexOf(tab), 1); }
      continue;
    }
    if (!workspace?.secured) continue;
    if (securedLocked(workspace)) {
      if (known.has(tab.id)) continue;
      const home = openHome(s, tab.browserProfileId);
      if (home) { tab.workspaceId = home; if (tab.privacy === 'secured') delete tab.privacy; }
      continue;
    }
    // A tab that arrives keeps a group of this workspace (a new tab opened in one); a tab moved in from elsewhere came without one.
    if (tab.privacy !== 'secured') { tab.privacy = 'secured'; tab.pinned = false; }
  }
  if (!s.tabs.some(tab => tab.id === s.activeTabId)) {
    const home = openHome(s, s.activeBrowserProfileId);
    const next = home ? entryTab(s, home, fresh) : s.tabs[0];
    if (next) activate(s, next);
  }
}

/** The workspaces whose tabs another window holds (R4-48 P1-6; a workspace's tabs live in one window). A window holds a workspace when it is the one on screen or has a
 *  page open in it (a lone new tab is an empty twin, not tabs). */
export function windowHoldsWorkspace(state: Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'activeWorkspaceId' | 'activeBrowserProfileId'>, id: string): boolean {
  if (state.activeWorkspaceId === id) return true;
  // The workspace's own profile (with profiles as spaces, a window holds every profile's space).
  const profile = (state.workspaces || []).find(workspace => workspace.id === id)?.browserProfileId ?? state.activeBrowserProfileId;
  return state.tabs.some(tab => tab.browserProfileId === profile && !tab.privacy && tab.url !== 'acira://new' && workspaceIdOf(state, tab) === id);
}
/** The window (by its number) that holds each of this window's workspaces that this window does not: the popover marks them "window 2", and choosing one brings that
 *  window forward on it instead of opening an empty copy here. `others` are the other ordinary windows of the same profile. A window that shows the workspace wins. */
export function workspaceHolders(self: Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'activeWorkspaceId' | 'activeBrowserProfileId'>, others: readonly { number: number; state: Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'activeWorkspaceId' | 'activeBrowserProfileId'> }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const workspace of windowWorkspaces(self)) {
    if (windowHoldsWorkspace(self, workspace.id)) continue;
    const holder = others.find(other => other.state.activeWorkspaceId === workspace.id) ?? others.find(other => windowHoldsWorkspace(other.state, workspace.id));
    if (holder) out[workspace.id] = holder.number;
  }
  return out;
}

// Scoped view: what the interface shows for a window with more than one workspace.
const scopedCache = new WeakMap<object, BrowserSnapshot>();
/**
 * The window as the open workspace sees it: its tabs, groups, closed tabs and splits. Everything that draws tabs reads this
 * (useBrowser applies it), so the strip, sidebar, tab viewer, palette and shortcuts need no workspace logic of their own;
 * actions still reach the full state in main. Returns the same object when the profile has a single workspace.
 */
export function scopeToWorkspace(state: BrowserSnapshot): BrowserSnapshot {
  const hit = scopedCache.get(state);
  if (hit) return hit;
  const own = windowWorkspaces(state), profile = state.activeBrowserProfileId;
  // A window that holds another profile's tabs (profiles as spaces) is scoped even when this profile has one workspace: the
  // other profile's tabs, groups and closed tabs are never the open workspace's. A window of one profile is unchanged.
  const mixed = state.tabs.some(tab => tab.browserProfileId !== profile);
  // Fails closed: a window left on a workspace the switcher doesn't list (profiles as spaces lists each profile's first only) shows the
  // profile on screen's space, never every tab.
  const active = own.some(workspace => workspace.id === state.activeWorkspaceId) ? state.activeWorkspaceId : (own.find(workspace => workspace.browserProfileId === profile) ?? (mixed ? undefined : own[0]))?.id;
  let scoped = state;
  if ((own.length > 1 || mixed) && active) {
    const inside = (item: { browserProfileId: string; workspaceId?: string }) => item.browserProfileId === profile && workspaceIdOf(state, item) === active;
    const tabs = state.tabs.filter(inside), ids = new Set(tabs.map(tab => tab.id));
    const ui = state.windowUi, groups = ui.splitGroups?.filter(group => group.tabIds.every(id => ids.has(id)));
    // The switcher replaces a background workspace's icon with its audio matrix
    // only while at least one unmuted tab there is actually audible.
    const audible = [...new Set(state.tabs.filter(tab => tab.audible && !tab.muted && !inside(tab)).map(tab => workspaceIdOf(state, tab)))];
    // And how many tabs each holds (the switcher's counts, the delete confirmation).
    // R4-48 P1-2: tab search (the command bar, the tab viewer) also looks in the other workspaces, so it needs their tabs (the same objects, not copies).
    // Only this profile's: another profile's tab titles never show in this one.
    const elsewhere = state.tabs.filter(tab => tab.browserProfileId === profile && !inside(tab) && !tab.privacy);
    scoped = { ...state, tabs, tabGroups: state.tabGroups.filter(inside), closedTabs: state.closedTabs.filter(inside), windowUi: { ...ui, split: ui.split && ui.split.tabIds.every(id => ids.has(id)) ? ui.split : null, ...(groups ? { splitGroups: groups } : {}) }, ...(audible.length ? { audibleWorkspaces: audible } : {}), ...(elsewhere.length ? { otherWorkspaceTabs: elsewhere } : {}), workspaceTabCounts: workspaceCounts(state) };
  }
  scopedCache.set(state, scoped);
  return scoped;
}
/** The tabs the open workspace shows, in order: what Ctrl+1…9, Ctrl+PageDown and Close other tabs act on. */
export const workspaceTabs = (state: BrowserSnapshot): TabSession[] => scopeToWorkspace(state).tabs;
/** Tab groups of the open workspace (used where only groups are needed). */
export const workspaceGroups = (state: BrowserSnapshot): TabGroup[] => scopeToWorkspace(state).tabGroups;
