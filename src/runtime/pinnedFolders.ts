import type { BrowserSnapshot, TabGroup, TabSession } from './types';

/**
 * Beta 14, pinned folders (Arc's pinned folders; VAZZ, 18 Nov 2026).
 *
 * A pinned folder is a top-level tab group that lives in the Pinned block: one flag on the folder (`TabGroup.pinned`), nothing on its tabs. Its tabs keep `pinned:false` and
 * `group:<name>`; they COUNT as pinned because their folder is (`tabIsPinned`). An inner folder (runtime/groupNesting.ts) has no flag of its own: it stands where its parent stands.
 *
 * Why a flag on the folder and not "pinned tabs that have a group": every group rule assumes a pinned tab has no group (tabGroups.ts), so the group code (nesting, fold, rename, colour, carry)
 * works unchanged and only the places that ask "is this tab pinned?" use `tabIsPinned`. Those places are listed in tests/pinned-folders-inventory.test.ts: a raw `.pinned` read in
 * src/runtime or desktop that is not in that list fails the test.
 *
 * Saved windows have no flag, so nothing changes on update. A 13.x build ignores the flag and shows the folder at the top of its list: a downgrade loses only the pinning.
 */
type GroupsOf = Pick<BrowserSnapshot, 'tabGroups'>;

/** Is this folder in the pinned area? A top-level folder says so itself; an inner folder stands where its parent stands. */
export function groupPinned(state: GroupsOf, group: Pick<TabGroup, 'pinned' | 'parentGroupId'> | undefined): boolean {
  if (!group) return false;
  const parent = group.parentGroupId ? state.tabGroups.find(item => item.id === group.parentGroupId) : undefined;
  return !!(parent ?? group).pinned;
}

/** The folder a tab stands in (profile + workspace + name, as tabGroups.ts groupForTab), without importing it (that module imports this one's neighbours). */
function folderOf(state: GroupsOf, tab: Pick<TabSession, 'group' | 'browserProfileId' | 'workspaceId'>): TabGroup | undefined {
  return tab.group ? state.tabGroups.find(group => group.name === tab.group && group.browserProfileId === tab.browserProfileId && (group.workspaceId ?? '') === (tab.workspaceId ?? '')) : undefined;
}

/** The tab is pinned: it carries the flag itself, or it stands in a pinned folder. THE question every pinned rule asks (close puts it to sleep, Close other tabs spares it, startup keeps it...). */
export function tabIsPinned(state: GroupsOf, tab: Pick<TabSession, 'pinned' | 'group' | 'browserProfileId' | 'workspaceId'>): boolean {
  return !!tab.pinned || groupPinned(state, folderOf(state, tab));
}

/** The tab stands in a pinned folder (not a loose pinned tab). */
export function inPinnedFolder(state: GroupsOf, tab: Pick<TabSession, 'pinned' | 'group' | 'browserProfileId' | 'workspaceId'>): boolean {
  return !tab.pinned && groupPinned(state, folderOf(state, tab));
}
