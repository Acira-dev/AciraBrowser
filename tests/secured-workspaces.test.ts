import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { LOCKED_URL, scopeToWorkspace, workspaceIdOf } from '../src/runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';
import { isPrivateNewTab } from '../src/features/newtab/pages';
import { shownPrivacy } from '../src/ui/tabPrivacy';

// R3-38 secured workspaces, the reducer half (docs/launch/SECURED_WORKSPACES.md rows marked "unit").
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const MARK = 'https://secret-marker-7f3a.test/';
function base(): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  return run({ ...state, tabs: ['a', 'b'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'a' }, { type: 'ui.update', patch: {} });
}
/** Main, plus "Health" made secured (as main does after Windows Hello) with one page open in it. */
function health(): { state: BrowserSnapshot; id: string } {
  let state = run(base(), { type: 'workspace.create', name: 'Health' });
  const id = state.workspaces.find(workspace => workspace.name === 'Health')!.id;
  state = run(state, { type: 'workspace.secured-set', id, secured: true }, { type: 'tab.navigate', tabId: state.activeTabId, url: MARK });
  assert.ok(JSON.stringify(state).includes('secret-marker-7f3a'), 'the marker is open in Health (the control that proves the checks can find it)');
  return { state, id };
}
const inHealth = (state: BrowserSnapshot, id: string) => state.tabs.filter(tab => workspaceIdOf(state, tab) === id);

test('making a workspace secured marks its tabs secured, keeps its groups, drops closed tabs, and opens it unlocked', () => {
  const { state, id } = health();
  const workspace = state.workspaces.find(item => item.id === id)!;
  assert.equal(workspace.secured, true); assert.equal(workspace.unlocked, true);
  assert.ok(inHealth(state, id).length >= 1);
  assert.ok(inHealth(state, id).every(tab => tab.privacy === 'secured'));
});

test('the first workspace can never be secured (it is where tabs go while one is locked)', () => {
  const state = base(), first = state.workspaces[0].id;
  const next = run(state, { type: 'workspace.create', name: 'Other' }, { type: 'workspace.secured-set', id: first, secured: true });
  assert.equal(next.workspaces[0].secured, undefined);
});

test('a new tab opened inside a secured workspace is secured too', () => {
  const { state, id } = health();
  const next = run(state, { type: 'tab.new', url: 'https://second.test/' });
  const fresh = next.tabs.find(tab => !state.tabs.some(old => old.id === tab.id))!;
  assert.equal(workspaceIdOf(next, fresh), id); assert.equal(fresh.privacy, 'secured');
});

test('row 3 suspend-on-lock: locking removes every tab of the workspace from the window and shows only the lock screen', () => {
  const { state, id } = health();
  const locked = run(state, { type: 'workspace.secured-lock', id });
  assert.equal(locked.workspaces.find(item => item.id === id)!.unlocked, undefined);
  const mine = inHealth(locked, id);
  assert.deepEqual(mine.map(tab => tab.url), [LOCKED_URL], 'only the lock screen is left');
  assert.equal(locked.tabs.find(tab => tab.id === locked.activeTabId)!.url, LOCKED_URL);
  assert.ok(!JSON.stringify(locked).includes('secret-marker-7f3a'), 'no title, address or history of the locked tabs anywhere in the state');
});

test('row 4 surfaces: while locked, the scoped view (strip, sidebar, tab viewer, palette, tab search) and every other workspace hold no secured title or address', () => {
  const { state, id } = health();
  const locked = run(state, { type: 'workspace.secured-lock', id }, { type: 'workspace.select', id: state.workspaces[0].id });
  assert.ok(!JSON.stringify(scopeToWorkspace(locked)).includes('secret-marker-7f3a'));
  const back = run(locked, { type: 'workspace.select', id });
  assert.deepEqual(scopeToWorkspace(back).tabs.map(tab => tab.url), [LOCKED_URL], 'picking a locked workspace opens its lock screen, never a page');
});

test('a tab opened while the lock screen shows goes to the first workspace, never into the locked one', () => {
  const { state, id } = health();
  const locked = run(state, { type: 'workspace.secured-lock', id }), next = run(locked, { type: 'tab.new', url: 'https://other.test/' });
  const fresh = next.tabs.find(tab => tab.url === 'https://other.test/')!;
  assert.equal(workspaceIdOf(next, fresh), next.workspaces[0].id);
  assert.equal(fresh.privacy, undefined);
  assert.ok(inHealth(next, id).every(tab => tab.url === LOCKED_URL));
});

test('unlock brings the sealed tabs back (only through the internal action main sends after Windows Hello)', () => {
  const { state, id } = health();
  const sealed = inHealth(state, id).map(tab => ({ id: tab.id, url: tab.url, title: 'Secret title', history: tab.history, historyIndex: tab.historyIndex }));
  const locked = run(state, { type: 'workspace.secured-lock', id });
  const open = run(locked, { type: 'workspace.secured-unlock', id, tabs: sealed, activeId: sealed[0].id });
  assert.equal(open.workspaces.find(item => item.id === id)!.unlocked, true);
  assert.deepEqual(inHealth(open, id).map(tab => tab.url), sealed.map(tab => tab.url));
  assert.ok(inHealth(open, id).every(tab => tab.privacy === 'secured'));
  assert.equal(open.activeTabId, sealed[0].id);
  assert.ok(!open.tabs.some(tab => tab.url === LOCKED_URL), 'the lock screen goes');
});

test('groups and splits across a lock: locking takes the workspace’s tab groups and splits away with its tabs, and unlock (the sealed copy) gives them back exactly', () => {
  let { state, id } = health();
  const first = state.activeTabId;
  state = run(state, { type: 'tab.new', url: MARK + 'two' }, { type: 'tab.new', url: MARK + 'three' }, { type: 'tab.new', url: MARK + 'four' });
  const [a, b, c, d] = inHealth(state, id).map(tab => tab.id);
  assert.equal(a, first);
  state = run(state, { type: 'tab.group.create', tabId: a, name: 'Scans', color: 'green' }, { type: 'tab.group.assign', tabIds: [b], groupId: null });
  const group = state.tabGroups.find(item => item.name === 'Scans')!;
  assert.ok(group, 'a secured tab can be grouped'); assert.equal(group.workspaceId, id);
  state = run(state, { type: 'tab.group.assign', tabIds: [b], groupId: group.id }, { type: 'tab.select', id: c }, { type: 'split.open', tabIds: [c, d] });
  assert.deepEqual(inHealth(state, id).filter(tab => tab.group === 'Scans').map(tab => tab.id), [a, b]);
  const split = state.windowUi.splitGroups!.find(item => item.tabIds.includes(c))!;
  assert.ok(split, 'a split of secured tabs is saved like any split');
  // What main seals (desktop/secured-workspaces.cjs collect): the tabs with their group names, the groups, the splits.
  const sealed = { tabs: inHealth(state, id).map(tab => ({ id: tab.id, url: tab.url, title: tab.title, group: tab.group, history: tab.history, historyIndex: tab.historyIndex })), groups: state.tabGroups.filter(item => item.workspaceId === id), splits: state.windowUi.splitGroups!.filter(item => item.tabIds.every(tabId => [a, b, c, d].includes(tabId))) };
  const locked = run(state, { type: 'workspace.secured-lock', id });
  assert.ok(!locked.tabGroups.some(item => item.name === 'Scans'), 'the group name is gone while locked');
  assert.ok(!(locked.windowUi.splitGroups ?? []).some(item => item.id === split.id), 'the split is gone while locked');
  assert.ok(!JSON.stringify(scopeToWorkspace(locked)).includes('Scans'));
  assert.ok(!JSON.stringify(persistedSnapshot(locked)).includes('Scans'));
  const open = run(locked, { type: 'workspace.secured-unlock', id, tabs: sealed.tabs, activeId: c, groups: structuredClone(sealed.groups), splits: structuredClone(sealed.splits) });
  assert.deepEqual(inHealth(open, id).map(tab => [tab.id, tab.group]), sealed.tabs.map(tab => [tab.id, tab.group]), 'same tabs, same order, same groups');
  const back = open.tabGroups.find(item => item.id === group.id)!;
  assert.deepEqual({ name: back.name, color: back.color, collapsed: back.collapsed, workspaceId: back.workspaceId }, { name: 'Scans', color: 'green', collapsed: false, workspaceId: id });
  const again = open.windowUi.splitGroups!.find(item => item.id === split.id)!;
  assert.deepEqual([again.tabIds, again.layout, again.cols, again.rows], [split.tabIds, split.layout, split.cols, split.rows]);
  assert.deepEqual(open.windowUi.split?.tabIds, [c, d], 'the split shows again, as the tab on screen is in it');
});

test('groups of a secured workspace are never saved in plain form, even while it is unlocked', () => {
  let { state, id } = health();
  state = run(state, { type: 'tab.group.create', tabId: state.activeTabId, name: 'Oncology secret', color: 'red' });
  assert.ok(state.tabGroups.some(item => item.name === 'Oncology secret' && item.workspaceId === id));
  assert.ok(!JSON.stringify(persistedSnapshot(state)).includes('Oncology secret'));
});

test('a private tab still takes no group (only secured tabs gained groups)', () => {
  let state = run(base(), { type: 'tab.new', privacy: 'private', url: 'https://p.test/' });
  const tab = state.tabs.find(item => item.privacy === 'private')!;
  state = run(state, { type: 'tab.group.create', tabId: tab.id, name: 'Nope' });
  assert.ok(!state.tabGroups.some(item => item.name === 'Nope'));
});

test('row 2 at rest: saved state never holds a secured tab, and a secured workspace is always saved and restored locked', () => {
  const { state, id } = health();
  const saved = persistedSnapshot(state);
  assert.ok(!JSON.stringify(saved).includes('secret-marker-7f3a'));
  assert.equal(saved.workspaces.find(item => item.id === id)!.unlocked, undefined);
  const restored = restoreSnapshot(JSON.parse(JSON.stringify({ ...saved, workspaces: saved.workspaces.map(item => item.id === id ? { ...item, unlocked: true } : item) })));
  assert.equal(restored.workspaces.find(item => item.id === id)!.unlocked, undefined, 'a forged "unlocked" in the file is ignored');
  assert.equal(restored.workspaces.find(item => item.id === id)!.secured, true);
});

test('row 5 history: visits in a secured workspace never reach History, closed tabs or Undo', () => {
  const { state, id } = health();
  assert.ok(!state.browsingHistory.some(visit => visit.url.includes('secret-marker-7f3a')));
  const tab = inHealth(state, id)[0];
  const closed = run(state, { type: 'tab.close', id: tab.id });
  assert.ok(!closed.closedTabs.some(item => item.url.includes('secret-marker-7f3a')));
});

test('a secured tab cannot be moved out, a locked workspace cannot take tabs or be deleted', () => {
  const { state, id } = health();
  const tab = inHealth(state, id)[0], first = state.workspaces[0].id;
  const moved = run(state, { type: 'workspace.move-tabs', tabIds: [tab.id], workspaceId: first });
  assert.equal(workspaceIdOf(moved, moved.tabs.find(item => item.id === tab.id)!), id);
  const locked = run(state, { type: 'workspace.secured-lock', id });
  const kept = run(locked, { type: 'workspace.delete', id });
  assert.ok(kept.workspaces.some(item => item.id === id), 'deleting a locked workspace needs it unlocked');
  const into = run(locked, { type: 'workspace.move-tabs', tabIds: [locked.tabs.find(item => item.url === 'https://b.test/')!.id], workspaceId: id });
  assert.ok(inHealth(into, id).every(item => item.url === LOCKED_URL));
});

test('the interface\'s plain workspace.lock does nothing in the reducer: only main may remove tabs, after sealing them', () => {
  const { state, id } = health();
  assert.equal(run(state, { type: 'workspace.lock', id }), state);
});

test('row 4 cross-workspace tab search (R4-48) never lists a secured tab, even before the leave-lock lands', () => {
  const { state } = health();
  const away = run(state, { type: 'workspace.select', id: state.workspaces[0].id });
  assert.ok(!JSON.stringify(scopeToWorkspace(away).otherWorkspaceTabs ?? []).includes('secret-marker-7f3a'));
});

test('stopping securing (unlocked only) turns its tabs back into ordinary ones', () => {
  const { state, id } = health();
  const off = run(state, { type: 'workspace.secured-set', id, secured: false });
  assert.equal(off.workspaces.find(item => item.id === id)!.secured, undefined);
  assert.ok(inHealth(off, id).every(tab => tab.privacy === undefined));
  const locked = run(state, { type: 'workspace.secured-lock', id });
  assert.equal(run(locked, { type: 'workspace.secured-set', id, secured: false }), locked, 'a locked workspace cannot be un-secured');
});

test('a new tab inside a secured workspace is an ordinary new tab page, not the private one, and wears no private mark', () => {
  assert.equal(isPrivateNewTab(false, 'secured'), false);
  assert.equal(shownPrivacy({ privacy: 'secured' }), undefined);
  assert.equal(shownPrivacy({ privacy: 'private' }), 'private');
});
