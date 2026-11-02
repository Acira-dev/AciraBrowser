import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import type { BrowserSnapshot } from '../src/runtime/types';

/** Four tabs: first, second (split with first), third, fourth. */
function withSplit() {
  let s = createInitialState(); const first = s.activeTabId;
  for (const url of ['https://two.test/', 'https://three.test/', 'https://four.test/']) s = reduceBrowser(s, { type: 'tab.new', url });
  const [, second, third, fourth] = s.tabs.map(tab => tab.id);
  s = reduceBrowser(s, { type: 'tab.select', id: first });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [first, second] });
  return { s, first, second, third, fourth, group: s.windowUi.splitGroups![0].id };
}
const order = (s: BrowserSnapshot) => s.tabs.map(tab => tab.id);

test('split.unsplit: members become ordinary tabs in place and keep their tab group', () => {
  let { s, first, second, third, group } = withSplit();
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: third, name: 'Reading' });
  const before = order(s);
  s = reduceBrowser(s, { type: 'split.unsplit', groupId: group });
  assert.equal(s.windowUi.split, null, 'the open split is gone');
  assert.equal(s.windowUi.splitGroups, undefined, 'no saved group is left');
  assert.deepEqual(order(s), before, 'every tab stays where it was');
  assert.deepEqual([first, second].every(id => s.tabs.some(tab => tab.id === id)), true);
  assert.equal(s.tabs.find(tab => tab.id === third)?.group, 'Reading', 'tab groups are untouched');
});

test('split.unsplit keeps the tab group of a member that belongs to one', () => {
  let { s, first, group } = withSplit();
  s = reduceBrowser(s, { type: 'tab.group.create', tabId: first, name: 'Work' });
  const name = s.tabs.find(tab => tab.id === first)!.group;
  s = reduceBrowser(s, { type: 'split.unsplit', groupId: group });
  assert.equal(s.tabs.find(tab => tab.id === first)?.group, name);
  assert.equal(s.tabGroups.length, 1);
});

test('split.unsplit leaves another split alone, and an unknown group changes nothing', () => {
  let { s, third, fourth, group } = withSplit();
  s = reduceBrowser(s, { type: 'split.close' });
  s = reduceBrowser(s, { type: 'tab.select', id: third });
  s = reduceBrowser(s, { type: 'split.open', tabIds: [third, fourth] });
  const other = s.windowUi.splitGroups!.find(item => item.id !== group)!.id;
  s = reduceBrowser(s, { type: 'split.unsplit', groupId: group });
  assert.deepEqual(s.windowUi.splitGroups?.map(item => item.id), [other]);
  assert.deepEqual(s.windowUi.split?.tabIds, [third, fourth], 'the visible split is the other one');
  const same = reduceBrowser(s, { type: 'split.unsplit', groupId: 'split-missing' });
  assert.deepEqual(same.windowUi.splitGroups, s.windowUi.splitGroups);
});

test('split.close with a group closes its tabs as one undoable batch; Undo brings them back', () => {
  let { s, first, second, third, fourth, group } = withSplit();
  s = reduceBrowser(s, { type: 'split.close', groupId: group });
  assert.ok(s.tabs.some(tab => tab.id === third) && s.tabs.some(tab => tab.id === fourth), 'the other tabs remain');
  assert.ok(!s.tabs.some(tab => tab.id === first || tab.id === second), 'both members are closed');
  assert.equal(s.windowUi.split, null);
  assert.equal(s.windowUi.splitGroups, undefined);
  const command = s.toast?.action?.command;
  assert.equal(command?.type, 'tab.restore.batch', 'one Undo toast for the whole split');
  assert.equal(s.closedTabs.filter(tab => tab.id === first || tab.id === second).length, 2);
  assert.equal(new Set(s.closedTabs.slice(0, 2).map(tab => tab.closedBatch)).size, 1, 'the two closes share one batch');
  s = reduceBrowser(s, command as never);
  assert.ok(s.tabs.some(tab => tab.id === first) && s.tabs.some(tab => tab.id === second), 'Undo restores both tabs');
});

test('split.close without a group still only leaves split view; pinned members are not closed', () => {
  let { s, first, second, group } = withSplit();
  s = reduceBrowser(s, { type: 'split.close' });
  assert.equal(s.windowUi.split, null);
  assert.equal(s.windowUi.splitGroups?.[0].id, group, 'the saved group survives, as before');
  s = reduceBrowser(s, { type: 'tab.pin', id: second });
  s = reduceBrowser(s, { type: 'split.close', groupId: group });
  assert.ok(!s.tabs.some(tab => tab.id === first), 'the unpinned member closes');
  assert.ok(s.tabs.some(tab => tab.id === second), 'the pinned member stays');
  assert.equal(s.windowUi.splitGroups, undefined);
});

test('split.rename names the group, trims, caps the length, resets on empty, and survives a restart', () => {
  let { s, group } = withSplit();
  s = reduceBrowser(s, { type: 'split.rename', groupId: group, name: '  Research  ' });
  assert.equal(s.windowUi.splitGroups![0].name, 'Research');
  s = restoreSnapshot(persistedSnapshot(s));
  assert.equal(s.windowUi.splitGroups![0].name, 'Research', 'saved with the window');
  s = reduceBrowser(s, { type: 'split.rename', groupId: group, name: 'x'.repeat(200) });
  assert.equal(s.windowUi.splitGroups![0].name!.length, 60);
  s = reduceBrowser(s, { type: 'split.rename', groupId: group, name: '   ' });
  assert.equal(s.windowUi.splitGroups![0].name, undefined, 'an empty name is the default again');
});

test('split.addTab opens a new tab next to the last member and joins the split; a full split refuses', () => {
  let { s, first, second, group } = withSplit();
  const count = s.tabs.length;
  s = reduceBrowser(s, { type: 'split.addTab', groupId: group });
  assert.equal(s.tabs.length, count + 1);
  const added = s.activeTabId;
  assert.deepEqual(s.windowUi.split?.tabIds, [first, second, added]);
  assert.equal(s.windowUi.split?.layout, 'three-columns');
  assert.equal(s.tabs[s.tabs.findIndex(tab => tab.id === second) + 1].id, added, 'placed right after the last member');
  s = reduceBrowser(s, { type: 'split.addTab', groupId: group });
  assert.equal(s.windowUi.split?.tabIds.length, 4);
  const full = reduceBrowser(s, { type: 'split.addTab', groupId: group });
  assert.equal(full.tabs.length, s.tabs.length, 'no tab is created for a full split');
  assert.ok(full.toast, 'it says why');
});

test('the new actions pass the native validation boundary and nothing else does', () => {
  const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs');
  const { s, group } = withSplit();
  for (const action of [{ type: 'split.unsplit', groupId: group }, { type: 'split.close', groupId: group }, { type: 'split.close' }, { type: 'split.addTab', groupId: group }, { type: 'split.rename', groupId: group, name: 'Docs' }, { type: 'split.rename', groupId: group, name: '' }])
    assert.doesNotThrow(() => validateAction(action, s), JSON.stringify(action));
  for (const action of [{ type: 'split.unsplit' }, { type: 'split.unsplit', groupId: 'missing' }, { type: 'split.close', groupId: 'missing' }, { type: 'split.addTab', groupId: 5 }, { type: 'split.rename', groupId: group }, { type: 'split.rename', groupId: group, name: 'x'.repeat(61) }, { type: 'split.rename', groupId: group, name: 7 }, { type: 'split.unsplit', groupId: group, extra: true }])
    assert.throws(() => validateAction(action, s), /.+/, JSON.stringify(action));
});
