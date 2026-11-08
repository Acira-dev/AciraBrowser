import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { groupMembers, moveBlock, workspaceIdOf } from '../src/runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Item 16: a whole tab group goes to another workspace (workspace.move-group), and the rules a drop on a workspace's icon follows.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
/** Main holds a, b, c, d and e; a and b are in the group "Research" (blue); a is current. Work and Study are empty. */
function base(): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  let next = run({ ...state, tabs: ['a', 'b', 'c', 'd', 'e'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'a' }, { type: 'ui.update', patch: {} });
  next = run(next, { type: 'tab.group.create', tabId: 'a', name: 'Research', color: 'blue' });
  return run(next, { type: 'tab.group.assign', tabIds: ['b'], groupId: next.tabGroups[0].id });
}
function withSpaces(): { state: BrowserSnapshot; main: string; work: string; study: string; group: string } {
  let state = base();
  const main = state.workspaces[0].id, group = state.tabGroups.find(item => item.name === 'Research')!.id;
  state = run(state, { type: 'workspace.create', name: 'Work' }, { type: 'workspace.select', id: main }, { type: 'workspace.create', name: 'Study' }, { type: 'workspace.select', id: main });
  const find = (name: string) => state.workspaces.find(item => item.name === name)!.id;
  return { state, main, work: find('Work'), study: find('Study'), group };
}
const inGroup = (state: BrowserSnapshot, name: string, workspace: string) => state.tabs.filter(tab => tab.group === name && workspaceIdOf(state, tab) === workspace).map(tab => tab.id);

test('base: the group holds a and b', () => {
  const { state, main, group } = withSpaces();
  assert.deepEqual(inGroup(state, 'Research', main), ['a', 'b']);
  assert.equal(state.tabGroups.find(item => item.id === group)!.color, 'blue');
});

test('a group moves whole: the group record, its colour and fold, and every tab in it keep their group in the new workspace', () => {
  const { state, main, work, group } = withSpaces();
  const next = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: work });
  const moved = next.tabGroups.find(item => item.id === group)!;
  assert.equal(workspaceIdOf(next, moved), work);
  assert.equal(moved.color, 'blue');
  assert.equal(moved.name, 'Research');
  assert.deepEqual(inGroup(next, 'Research', work), ['a', 'b'], 'both tabs are in Work, still in Research');
  assert.deepEqual(inGroup(next, 'Research', main), [], 'nothing of it is left in Main');
  assert.deepEqual(next.tabs.filter(tab => workspaceIdOf(next, tab) === main).map(tab => tab.id), ['c', 'd', 'e'], 'the loose tabs stay');
  assert.equal(next.activeWorkspaceId, main, 'the workspace on screen stays open');
  assert.ok(['c', 'd', 'e'].includes(next.activeTabId), 'a was current, so a neighbour in Main takes over');
});

test('the toast says what moved and Undo puts the group back with its own name', () => {
  const { state, main, work, group } = withSpaces();
  const next = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: work });
  assert.equal(next.toast?.text, 'Moved Research (2 tabs) to Work');
  assert.equal(next.toast?.i18n?.id, 'runtime.workspaceGroupMoved');
  assert.deepEqual(next.toast?.i18n?.params, { group: 'Research', count: 2, name: 'Work' });
  assert.equal(next.toast?.action?.label, 'Undo');
  const undone = run(next, next.toast!.action!.command);
  assert.deepEqual(inGroup(undone, 'Research', main), ['a', 'b']);
  assert.equal(workspaceIdOf(undone, undone.tabGroups.find(item => item.id === group)!), main);
  assert.equal(undone.tabs.some(tab => tab.group === 'Research' && workspaceIdOf(undone, tab) === work), false);
});

test('a group of the same name in the target keeps its name: the one that comes is "Research 2", and Undo gives the name back', () => {
  let { state, main, work, group } = withSpaces();
  state = run(state, { type: 'workspace.select', id: work }, { type: 'tab.new', url: 'https://w.test/' });
  const w = state.tabs.at(-1)!.id;
  state = run(state, { type: 'tab.group.create', tabId: w, name: 'Research', color: 'red' }, { type: 'workspace.select', id: main });
  const theirs = state.tabGroups.find(item => item.name === 'Research' && item.id !== group)!;
  const next = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: work });
  assert.equal(next.tabGroups.find(item => item.id === group)!.name, 'Research 2');
  assert.deepEqual(inGroup(next, 'Research 2', work), ['a', 'b'], 'its tabs follow the new name');
  assert.deepEqual(inGroup(next, 'Research', work), [w], 'the group that was there is untouched');
  assert.equal(next.tabGroups.find(item => item.id === theirs.id)!.color, 'red');
  assert.equal(next.toast?.i18n?.params?.group, 'Research 2');
  const undone = run(next, next.toast!.action!.command);
  assert.equal(undone.tabGroups.find(item => item.id === group)!.name, 'Research');
  assert.deepEqual(inGroup(undone, 'Research', main), ['a', 'b']);
});

test('a group can go back to the first workspace (the canonical stamp: none)', () => {
  const { state, main, work, group } = withSpaces();
  const there = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: work });
  const back = run(there, { type: 'workspace.move-group', groupId: group, workspaceId: main });
  assert.equal(back.tabGroups.find(item => item.id === group)!.workspaceId, undefined);
  assert.deepEqual(inGroup(back, 'Research', main), ['a', 'b']);
});

test('a drop on the group\'s own workspace, an unknown group or an unknown workspace changes nothing', () => {
  const { state, main, work, group } = withSpaces();
  for (const action of [{ type: 'workspace.move-group', groupId: group, workspaceId: main }, { type: 'workspace.move-group', groupId: 'nope', workspaceId: work }, { type: 'workspace.move-group', groupId: group, workspaceId: 'nope' }] as BrowserAction[]) {
    const next = run(state, action);
    assert.deepEqual(next.tabs.map(tab => [tab.id, tab.workspaceId, tab.group]), state.tabs.map(tab => [tab.id, tab.workspaceId, tab.group]));
    assert.equal(next.toast?.text, state.toast?.text);
  }
});

test('a locked workspace takes nothing: the group stays and the toast says to unlock first (the same for a tab)', () => {
  let { state, main, study, group } = withSpaces();
  state = run(state, { type: 'workspace.secured-set', id: study, secured: true }, { type: 'workspace.secured-lock', id: study }, { type: 'workspace.select', id: main });
  assert.equal(state.workspaces.find(item => item.id === study)!.unlocked, undefined, 'Study is locked');
  const next = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: study });
  assert.deepEqual(inGroup(next, 'Research', main), ['a', 'b']);
  assert.equal(next.toast?.i18n?.id, 'workspaces.unlockFirst');
  const tab = run(state, { type: 'workspace.move-tabs', tabIds: ['c'], workspaceId: study });
  assert.equal(workspaceIdOf(tab, tab.tabs.find(item => item.id === 'c')!), main);
  assert.equal(tab.toast?.i18n?.id, 'workspaces.unlockFirst');
});

test('an open secured workspace takes a group (its tabs become secured); a secured group never leaves for an ordinary workspace', () => {
  let { state, main, study, group } = withSpaces();
  state = run(state, { type: 'workspace.secured-set', id: study, secured: true }, { type: 'workspace.select', id: main });
  assert.equal(state.workspaces.find(item => item.id === study)!.unlocked, true, 'Study is open');
  const into = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: study });
  assert.deepEqual(inGroup(into, 'Research', study), ['a', 'b']);
  assert.ok(into.tabs.filter(tab => tab.group === 'Research').every(tab => tab.privacy === 'secured'));
  const out = run(into, { type: 'workspace.select', id: study }, { type: 'workspace.move-group', groupId: group, workspaceId: main });
  assert.deepEqual(inGroup(out, 'Research', study), ['a', 'b'], 'a secured group stays in a secured workspace');
  assert.equal(out.toast?.i18n?.id, 'workspaces.securedStays');
});

test('private and Tor tabs never change workspace: the action ignores them, with no toast', () => {
  const { state, main, work } = withSpaces();
  for (const privacy of ['private', 'tor'] as const) {
    const marked = { ...state, tabs: state.tabs.map(tab => tab.id === 'c' ? { ...tab, privacy } : tab) };
    const next = run(marked, { type: 'workspace.move-tabs', tabIds: ['c'], workspaceId: work });
    assert.equal(workspaceIdOf(next, next.tabs.find(tab => tab.id === 'c')!), main, privacy);
    assert.equal(next.toast?.text, marked.toast?.text, 'no toast');
    const mixed = run(marked, { type: 'workspace.move-tabs', tabIds: ['c', 'd'], workspaceId: work });
    assert.equal(workspaceIdOf(mixed, mixed.tabs.find(tab => tab.id === 'c')!), main);
    assert.equal(workspaceIdOf(mixed, mixed.tabs.find(tab => tab.id === 'd')!), work, 'the ordinary tab beside it still goes');
  }
});

test('moveBlock is the one rule the actions and the drop banner share', () => {
  const open = {}, locked = { secured: true as const }, secured = { secured: true as const, unlocked: true as const };
  assert.equal(moveBlock({ tabs: [], workspaces: [] }, [{}], open), null);
  assert.equal(moveBlock({ tabs: [], workspaces: [] }, [{}], locked), 'locked');
  assert.equal(moveBlock({ tabs: [], workspaces: [] }, [{ privacy: 'secured' }], open), 'secured');
  assert.equal(moveBlock({ tabs: [], workspaces: [] }, [{ privacy: 'secured' }], secured), null);
  assert.equal(moveBlock({ tabs: [], workspaces: [] }, [{ privacy: 'tor' }], locked), 'private', 'a Tor tab says nothing, even over a locked workspace');
  assert.equal(moveBlock({ tabs: [], workspaces: [] }, [{ privacy: 'private' }, {}], open), null, 'one ordinary tab is enough to move');
});

test('a group tab drawn in a loose split leaves that split when the group moves; the split\'s own panes stay together', () => {
  let { state, work, group } = withSpaces();
  // c and d are a loose split; a (in Research) is drawn into it as a linked copy.
  state = run(state, { type: 'tab.select', id: 'c' }, { type: 'split.open', tabIds: ['c', 'd'] });
  const split = state.windowUi.splitGroups![0];
  state = { ...state, windowUi: { ...state.windowUi, splitGroups: [{ ...split, tabIds: [...split.tabIds, 'a'], linked: ['a'] }] } };
  const next = run(state, { type: 'workspace.move-group', groupId: group, workspaceId: work });
  assert.equal(workspaceIdOf(next, next.tabs.find(tab => tab.id === 'a')!), work);
  assert.equal(workspaceIdOf(next, next.tabs.find(tab => tab.id === 'c')!) !== work, true, 'the loose split stays where it was');
  assert.equal(workspaceIdOf(next, next.tabs.find(tab => tab.id === 'd')!) !== work, true);
  assert.ok(!next.windowUi.splitGroups?.some(item => item.tabIds.includes('a')) || next.windowUi.splitGroups!.every(item => !item.linked?.includes('a')), 'a is no longer drawn in the split');
  assert.deepEqual(groupMembers(next, next.tabGroups.find(item => item.id === group)!).map(tab => tab.id).sort(), ['a', 'b']);
});
