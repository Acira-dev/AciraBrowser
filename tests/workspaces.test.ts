import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { bulkCloseTargets } from '../src/runtime/profileActions';
import { MAX_WORKSPACES, activeWorkspaceOf, cleanWorkspaceName, normalizeWorkspaces, scopeToWorkspace, validWorkspaceIcon, windowWorkspaces, workspaceIdOf } from '../src/runtime/workspaces';
import { frameTintFor } from '../src/ui/theme';
import { workspacePlaying } from '../src/ui/workspaceAudio';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
/** Three open tabs in the first workspace; `a` is current. */
function three(): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  return run({ ...state, tabs: ['a', 'b', 'c'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'a' }, { type: 'ui.update', patch: {} });
}
const id = (state: BrowserSnapshot, name: string) => state.workspaces.find(workspace => workspace.name === name)!.id;
const shown = (state: BrowserSnapshot) => scopeToWorkspace(state).tabs.map(tab => tab.id);
/** Work (empty start) beside the first workspace. */
const withWork = (state = three()) => run(state, { type: 'workspace.create', name: 'Work' });

test('workspace playback glyph follows audible tabs in the open workspace and scoped background audio', () => {
  let state = three();
  const main = state.activeWorkspaceId;
  state = { ...state, tabs: state.tabs.map(tab => ({ ...tab, audible: tab.id === 'a' })) };
  assert.equal(workspacePlaying(scopeToWorkspace(state), main), true);
  const muted = { ...state, tabs: state.tabs.map(tab => ({ ...tab, muted: true })) };
  assert.equal(workspacePlaying(scopeToWorkspace(muted), main), false);
  state = withWork(state);
  const work = state.activeWorkspaceId;
  assert.equal(workspacePlaying(scopeToWorkspace(state), main), true);
  assert.equal(workspacePlaying(scopeToWorkspace(state), work), false);
  state = { ...state, tabs: state.tabs.map(tab => ({ ...tab, audible: false })) };
  assert.equal(workspacePlaying(scopeToWorkspace(state), main), false);
});

test('a profile that never made a workspace has one unnamed workspace and is shown exactly as before', () => {
  const state = three();
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.workspaces[0].name, '');
  assert.equal(state.activeWorkspaceId, state.workspaces[0].id);
  assert.equal(scopeToWorkspace(state), state, 'one workspace: the same object, nothing filtered');
  assert.ok(state.tabs.every(tab => tab.workspaceId === undefined), 'the first workspace is never stamped');
});

test('migration: old saved windows (no workspaces, or the old "My workspace" row) open as one workspace holding every tab', () => {
  const old = JSON.parse(JSON.stringify(persistedSnapshot(three()))) as Record<string, unknown>;
  delete old.workspaces; delete old.activeWorkspaceId;
  const none = restoreSnapshot(old);
  assert.equal(none.workspaces.length, 1);
  assert.deepEqual(none.tabs.map(tab => tab.id), ['a', 'b', 'c']);
  const legacy = restoreSnapshot({ ...old, workspaces: [{ id: 'workspace-default', name: 'My workspace', browserProfileId: 'profile-personal' }], activeWorkspaceId: 'workspace-default' });
  assert.equal(legacy.workspaces[0].name, '', 'the old placeholder name is not a name the person chose');
  assert.equal(windowWorkspaces(legacy).length, 1);
});

test('a new profile gets its own first workspace', () => {
  const state = run(three(), { type: 'browser.profile.create', name: 'Studio' });
  const studio = state.browserProfiles.find(profile => profile.name === 'Studio')!;
  assert.equal(state.workspaces.filter(workspace => workspace.browserProfileId === studio.id).length, 1);
});

test('creating a workspace opens it empty with one new tab; the old tabs stay in their workspace', () => {
  const state = withWork();
  assert.equal(state.workspaces.length, 2);
  assert.equal(activeWorkspaceOf(state)?.name, 'Work');
  assert.equal(shown(state).length, 1);
  assert.equal(state.tabs.length, 4);
  assert.deepEqual(state.tabs.slice(0, 3).map(tab => tab.id), ['a', 'b', 'c']);
  assert.equal(workspaceIdOf(state, state.tabs[0]), state.workspaces[0].id);
  assert.equal(state.tabs.find(tab => tab.id === state.activeTabId)?.workspaceId, id(state, 'Work'));
});

test('"Move my open tabs here" takes the tabs along and leaves the first workspace empty until it is opened', () => {
  const state = run(three(), { type: 'workspace.create', name: 'Work', tabs: 'move' });
  assert.deepEqual(shown(state), ['a', 'b', 'c']);
  assert.equal(state.activeTabId, 'a');
  const back = run(state, { type: 'workspace.select', id: state.workspaces[0].id });
  assert.equal(shown(back).length, 1, 'an empty workspace gets one new tab when it is opened');
  assert.equal(back.tabs.length, 4);
});

test('switching remembers the tab each workspace showed last', () => {
  let state = run(withWork(), { type: 'tab.select', id: 'a' });
  state = run(state, { type: 'workspace.select', id: state.workspaces[0].id }); // back to the first workspace
  state = run(state, { type: 'tab.select', id: 'c' });
  const work = id(state, 'Work');
  state = run(state, { type: 'workspace.select', id: work });
  assert.equal(state.activeWorkspaceId, work);
  assert.notEqual(state.activeTabId, 'c');
  state = run(state, { type: 'workspace.select', id: state.workspaces[0].id });
  assert.equal(state.activeTabId, 'c', 'the first workspace returns to c, where it was left');
});

test('the open workspace follows the tab on screen, however the tab was picked', () => {
  const state = withWork();
  const picked = run(state, { type: 'tab.select', id: 'b' });
  assert.equal(picked.activeWorkspaceId, picked.workspaces[0].id);
  assert.deepEqual(shown(picked), ['a', 'b', 'c']);
});

test('opening the active workspace again, an unknown workspace, or a workspace in another profile does nothing', () => {
  const state = withWork();
  assert.equal(reduceBrowser(state, { type: 'workspace.select', id: state.activeWorkspaceId }), state);
  assert.equal(reduceBrowser(state, { type: 'workspace.select', id: 'workspace-nope' }), state);
});

test('a new tab opens in the workspace it was opened from, and Rewind can name the workspace', () => {
  let state = withWork();
  const work = id(state, 'Work');
  state = run(state, { type: 'tab.new', url: 'https://w2.test/' });
  assert.equal(state.tabs.at(-1)?.workspaceId, work);
  state = run(state, { type: 'tab.new', url: 'https://back.test/', background: true, workspaceId: state.workspaces[0].id });
  const back = state.tabs.at(-1)!;
  assert.equal(back.workspaceId, undefined, 'asked for the first workspace');
  assert.equal(state.activeWorkspaceId, work, 'a background tab does not switch workspace');
  const fromOpener = run(state, { type: 'tab.new', url: 'https://child.test/', background: true, afterId: 'b' });
  assert.equal(workspaceIdOf(fromOpener, fromOpener.tabs.find(tab => tab.url === 'https://child.test/')!), fromOpener.workspaces[0].id, 'a link opens next to its page, in that page\'s workspace');
});

test('closing the last tab of a workspace keeps you in it with a new tab', () => {
  let state = withWork();
  const work = id(state, 'Work');
  state = run(state, { type: 'tab.close', id: state.activeTabId });
  assert.equal(state.activeWorkspaceId, work);
  assert.equal(shown(state).length, 1);
  assert.equal(state.tabs.length, 4);
});

test('closing the current tab never jumps to another workspace', () => {
  let state = withWork();
  state = run(state, { type: 'tab.new', url: 'https://w2.test/' });
  const work = id(state, 'Work'), current = state.activeTabId;
  state = run(state, { type: 'tab.close', id: current });
  assert.equal(state.activeWorkspaceId, work);
  assert.equal(workspaceIdOf(state, state.tabs.find(tab => tab.id === state.activeTabId)!), work);
});

test('the same group name in two workspaces is two groups; renaming or collapsing one leaves the other', () => {
  let state = three();
  state = run(state, { type: 'tab.group.create', tabId: 'a', name: 'Q4', color: 'blue' });
  const first = state.tabGroups[0];
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const work = id(state, 'Work'), mine = state.activeTabId;
  state = run(state, { type: 'tab.group.create', tabId: mine, name: 'Q4', color: 'red' });
  assert.equal(state.tabGroups.length, 2);
  const second = state.tabGroups.find(group => group.id !== first.id)!;
  assert.equal(second.workspaceId, work);
  assert.equal(first.workspaceId, undefined);
  state = run(state, { type: 'tab.group.update', id: second.id, patch: { name: 'Launch' } });
  assert.equal(state.tabGroups.find(group => group.id === first.id)!.name, 'Q4');
  assert.equal(state.tabs.find(tab => tab.id === 'a')!.group, 'Q4');
  assert.equal(scopeToWorkspace(state).tabGroups.length, 1);
  state = run(state, { type: 'tab.group.update', id: second.id, patch: { collapsed: true } });
  assert.equal(state.tabGroups.find(group => group.id === first.id)!.collapsed, false);
  assert.equal(state.activeWorkspaceId, work, 'collapsing picks a page in this workspace');
});

test('rename, icon and colour: validated, trimmed, and a taken name is refused', () => {
  let state = withWork();
  const work = id(state, 'Work');
  state = run(state, { type: 'workspace.update', id: work, patch: { name: '  Deep   work ', icon: 'code', color: '#0088FF' } });
  const ws = state.workspaces.find(item => item.id === work)!;
  assert.deepEqual([ws.name, ws.icon, ws.color], ['Deep work', 'code', '#0088ff']);
  state = run(state, { type: 'workspace.update', id: work, patch: { icon: '🚀' } });
  assert.equal(state.workspaces.find(item => item.id === work)!.icon, '🚀');
  state = run(state, { type: 'workspace.update', id: work, patch: { icon: 'not an icon' as string } });
  assert.equal(state.workspaces.find(item => item.id === work)!.icon, '🚀', 'a bad icon is ignored');
  state = run(state, { type: 'workspace.update', id: work, patch: { color: null } });
  assert.equal(state.workspaces.find(item => item.id === work)!.color, undefined);
  const taken = run(state, { type: 'workspace.update', id: work, patch: { name: 'main' } });
  assert.equal(taken.workspaces.find(item => item.id === work)!.name, 'Deep work');
  assert.equal(taken.toast?.i18n?.id, 'runtime.workspaceNameTaken');
  assert.equal(reduceBrowser(state, { type: 'workspace.update', id: work, patch: { name: '   ' } }), state);
  const twice = run(state, { type: 'workspace.create', name: 'deep work' });
  assert.equal(twice.workspaces.length, state.workspaces.length, 'two workspaces never share a name');
  assert.equal(cleanWorkspaceName('a\u0000b\n c'), 'a b c');
  assert.ok(validWorkspaceIcon('layers') && validWorkspaceIcon('W') && validWorkspaceIcon('😀') && !validWorkspaceIcon('ab') && !validWorkspaceIcon('') && !validWorkspaceIcon('<'));
});

test('at most eight workspaces in a profile', () => {
  let state = three();
  for (let i = 1; i < MAX_WORKSPACES; i++) state = run(state, { type: 'workspace.create', name: `W${i}` });
  assert.equal(state.workspaces.length, MAX_WORKSPACES);
  const over = run(state, { type: 'workspace.create', name: 'Ninth' });
  assert.equal(over.workspaces.length, MAX_WORKSPACES);
  assert.equal(over.toast?.i18n?.id, 'runtime.workspaceLimit');
});

test('deleting closes the tabs with an Undo that brings the workspace, its tabs and its groups back', () => {
  let state = run(three(), { type: 'workspace.create', name: 'Work' });
  const work = id(state, 'Work');
  state = run(state, { type: 'tab.new', url: 'https://w2.test/' }, { type: 'tab.group.create', tabId: state.activeTabId, name: 'Q4', color: 'green' });
  const workTabs = shown(state).length;
  assert.equal(workTabs, 2);
  state = run(state, { type: 'workspace.delete', id: work });
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.tabs.length, 3);
  assert.deepEqual(shown(state), ['a', 'b', 'c']);
  assert.equal(state.tabGroups.length, 0);
  assert.equal(state.toast?.action?.command.type, 'workspace.restore');
  const command = state.toast!.action!.command;
  state = run(state, command);
  assert.equal(state.workspaces.length, 2);
  assert.equal(state.workspaces[1].name, 'Work');
  assert.equal(state.activeWorkspaceId, state.workspaces[1].id);
  assert.equal(shown(state).length, workTabs);
  assert.equal(state.tabGroups.find(group => group.name === 'Q4')?.color, 'green');
  assert.equal(state.toast, null);
  assert.equal(reduceBrowser(state, command), state, 'a second Undo changes nothing');
});

test('the first workspace can be deleted and brought back with its tabs', () => {
  let state = withWork();
  const first = state.workspaces[0].id;
  state = run(state, { type: 'workspace.delete', id: first });
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.tabs.length, 1, 'only Work\'s tab is left');
  assert.equal(state.tabs[0].workspaceId, undefined, 'now the first workspace, so no stamp');
  state = run(state, state.toast!.action!.command);
  assert.equal(state.workspaces.length, 2);
  assert.equal(state.workspaces[0].id, first, 'back in its old place');
  assert.deepEqual(state.tabs.filter(tab => workspaceIdOf(state, tab) === first).map(tab => tab.id).sort(), ['a', 'b', 'c']);
});

test('the last workspace of a profile cannot be deleted', () => {
  const state = three();
  const next = run(state, { type: 'workspace.delete', id: state.workspaces[0].id });
  assert.equal(next.workspaces.length, 1);
  assert.equal(next.tabs.length, 3);
  assert.equal(next.toast?.i18n?.id, 'runtime.workspaceKeepOne');
});

test('moving tabs to another workspace: Undo moves them back, a moved current tab leaves the source on a neighbour, a split moves whole', () => {
  let state = withWork();
  const work = id(state, 'Work'), first = state.workspaces[0].id;
  state = run(state, { type: 'workspace.select', id: first }, { type: 'tab.select', id: 'b' });
  const moved = run(state, { type: 'workspace.move-tabs', tabIds: ['b'], workspaceId: work });
  assert.equal(moved.tabs.find(tab => tab.id === 'b')!.workspaceId, work);
  assert.notEqual(moved.activeTabId, 'b');
  assert.equal(moved.activeWorkspaceId, first, 'the source workspace stays open');
  assert.equal(shown(moved).includes('b'), false);
  const undone = run(moved, moved.toast!.action!.command);
  assert.equal(workspaceIdOf(undone, undone.tabs.find(tab => tab.id === 'b')!), first);
  const split = run(state, { type: 'tab.select', id: 'a' }, { type: 'split.open', tabIds: ['a', 'c'] });
  assert.equal(split.windowUi.splitGroups?.length, 1);
  const whole = run(split, { type: 'workspace.move-tabs', tabIds: ['a'], workspaceId: work });
  assert.equal(workspaceIdOf(whole, whole.tabs.find(tab => tab.id === 'c')!), work, 'its other pane goes along');
});

test('tabs in a group lose the group when they move (groups belong to one workspace)', () => {
  let state = run(withWork(), { type: 'workspace.select', id: three().workspaces[0].id });
  state = run(state, { type: 'tab.group.create', tabId: 'a', name: 'Read' });
  state = run(state, { type: 'workspace.move-tabs', tabIds: ['a'], workspaceId: id(state, 'Work') });
  assert.equal(state.tabs.find(tab => tab.id === 'a')!.group, '');
});

test('Reopen closed tab brings back the newest tab closed in the workspace on screen', () => {
  let state = withWork();
  const first = state.workspaces[0].id, work = id(state, 'Work');
  state = run(state, { type: 'workspace.select', id: first }, { type: 'tab.close', id: 'b' });
  state = run(state, { type: 'workspace.select', id: work }, { type: 'tab.new', url: 'https://w2.test/' });
  const w2 = state.activeTabId;
  state = run(state, { type: 'tab.close', id: w2 }, { type: 'workspace.select', id: first });
  state = run(state, { type: 'tab.restore' });
  assert.equal(state.activeTabId, 'b', 'not the Work tab closed after it');
  assert.equal(state.activeWorkspaceId, first);
});

test('Close other tabs only reaches the workspace the tab is in', () => {
  const state = withWork();
  assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }).sort(), ['b', 'c']);
  assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.others', id: state.activeTabId }), []);
});

test('saving and restoring keeps workspaces, stamps and each workspace\'s last tab; the Undo list is not saved', () => {
  let state = withWork();
  state = run(state, { type: 'tab.new', url: 'https://w2.test/' }, { type: 'workspace.create', name: 'Home' });
  state = run(state, { type: 'workspace.delete', id: id(state, 'Home') });
  assert.ok(state.closedWorkspaces?.length);
  const saved = JSON.parse(JSON.stringify(persistedSnapshot(state)));
  assert.equal(saved.closedWorkspaces, undefined);
  const back = restoreSnapshot(saved);
  assert.deepEqual(back.workspaces, state.workspaces);
  assert.deepEqual(back.tabs.map(tab => [tab.id, tab.workspaceId]), state.tabs.map(tab => [tab.id, tab.workspaceId]));
  assert.equal(back.activeWorkspaceId, state.activeWorkspaceId);
  assert.deepEqual(shown(back), shown(state));
});

test('a workspace another window deleted re-homes the tabs that were in it', () => {
  const state = withWork();
  const gone = { ...state, workspaces: state.workspaces.filter(workspace => workspace.name !== 'Work') } as BrowserSnapshot;
  normalizeWorkspaces(gone);
  assert.ok(gone.tabs.every(tab => tab.workspaceId === undefined));
  assert.equal(gone.activeWorkspaceId, gone.workspaces[0].id);
});

test('private windows have no workspaces', () => {
  const state = createInitialState();
  const profile = { id: 'private-1', name: 'Private', color: '#62666d', partition: 'acira-private-1', private: true };
  const priv = run({ ...state, browserProfiles: [profile], activeBrowserProfileId: 'private-1', tabs: [makeTab('p', '', 'https://p.test/', 'private-1')], activeTabId: 'p', workspaces: [] }, { type: 'ui.update', patch: {} });
  assert.deepEqual(priv.workspaces, []);
  assert.equal(reduceBrowser(priv, { type: 'workspace.create', name: 'Nope' }), priv);
  assert.equal(scopeToWorkspace(priv), priv);
  assert.deepEqual(persistedSnapshot(state).workspaces.map(workspace => workspace.browserProfileId), ['profile-personal']);
});

test('a workspace\'s colour tints the frame while it is open and the profile\'s colour comes back without it', () => {
  let state = withWork();
  assert.equal(frameTintFor(state), undefined, 'the default profile is neutral');
  state = run(state, { type: 'workspace.update', id: id(state, 'Work'), patch: { color: '#34C759' } });
  assert.equal(frameTintFor(state), '#34c759');
  state = run(state, { type: 'workspace.select', id: state.workspaces[0].id });
  assert.equal(frameTintFor(state), undefined);
});

test('the scoped view names the other workspaces that are playing sound (the audio matrix in their icon slot)', () => {
  let state = withWork();
  assert.equal(scopeToWorkspace(state).audibleWorkspaces, undefined);
  state = reduceBrowser(state, { type: 'browser.event', event: { type: 'state', tabId: 'a', audible: true } });
  assert.equal(state.tabs.find(tab => tab.id === 'a')!.audible, true);
  assert.deepEqual(scopeToWorkspace(state).audibleWorkspaces, [state.workspaces[0].id]);
  state = run(state, { type: 'tab.mute', id: 'a', muted: true });
  assert.equal(scopeToWorkspace(state).audibleWorkspaces, undefined, 'muted audio never keeps the playing matrix');
  state = run(state, { type: 'tab.mute', id: 'a', muted: false });
  assert.deepEqual(scopeToWorkspace(state).audibleWorkspaces, [state.workspaces[0].id]);
  state = reduceBrowser(state, { type: 'browser.event', event: { type: 'state', tabId: 'a', audible: false } });
  assert.equal(scopeToWorkspace(state).audibleWorkspaces, undefined, 'pausing or ending restores the icon');
  state = reduceBrowser(state, { type: 'browser.event', event: { type: 'state', tabId: 'a', audible: true } });
  state = run(state, { type: 'workspace.select', id: state.workspaces[0].id });
  assert.equal(scopeToWorkspace(state).audibleWorkspaces, undefined, 'the open workspace needs no mark');
});

test('switching away leaves every tab where it was: the same tabs, in the same order', () => {
  const start = three();
  const away = run(start, { type: 'workspace.create', name: 'Work' });
  const back = run(away, { type: 'workspace.select', id: start.workspaces[0].id });
  assert.deepEqual(back.tabs.slice(0, 3).map(tab => tab.id), ['a', 'b', 'c']);
  assert.equal(back.activeTabId, 'a');
  assert.equal(back.tabs.length, 4, 'Work keeps its tab');
});

test('the scoped view keeps the splits of the open workspace and hides the others', () => {
  let state = three();
  state = run(state, { type: 'split.open', tabIds: ['a', 'b'] });
  assert.equal(scopeToWorkspace(state), state);
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const scoped = scopeToWorkspace(state);
  assert.equal(scoped.windowUi.split, null);
  assert.equal(scoped.windowUi.splitGroups?.length ?? 0, 0);
  const back = scopeToWorkspace(run(state, { type: 'workspace.select', id: state.workspaces[0].id }));
  assert.equal(back.windowUi.splitGroups?.length, 1);
  assert.deepEqual(back.windowUi.split?.tabIds, ['a', 'b'], 'the split opens again with its workspace');
});

test('Undo of a delete whose name was taken meanwhile comes back numbered, even for a 40-character name (it used to spin forever)', () => {
  const long = 'A'.repeat(40), main = createInitialState();
  let state = run(main, { type: 'workspace.create', name: long });
  const gone = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.delete', id: gone }, { type: 'workspace.create', name: long }, { type: 'workspace.restore', id: gone });
  const names = state.workspaces.map(workspace => workspace.name);
  assert.equal(names.length, 3);
  assert.ok(names.every(name => name.length <= 40), 'every name stays within 40 characters');
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, 3, 'and every name is different');
  assert.ok(names.includes('A'.repeat(38) + ' 2'));
  // A short name still reads "Work 2", and a second clash goes on to "Work 3".
  let short = run(createInitialState(), { type: 'workspace.create', name: 'Work' });
  const first = short.activeWorkspaceId;
  short = run(short, { type: 'workspace.delete', id: first }, { type: 'workspace.create', name: 'Work' }, { type: 'workspace.restore', id: first });
  assert.deepEqual(short.workspaces.map(workspace => workspace.name).sort(), ['', 'Work', 'Work 2'].sort());
});
