import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { appendedTabs,changeLayoutActions,nameAndNote,newTabInGroupActions } from '../src/components/sidebar/sidebarActions';
import { layoutsFor } from '../src/runtime/splitLayout';
import type { BrowserAction } from '../src/runtime/types';
import { createInitialState,reduceBrowser } from '../src/runtime/core';
import { groupForTab } from '../src/runtime/tabGroups';

// R3-49 / R3-50: the sidebar's hover "+" on a group header and the actions of its split header menu.
test('the "+" on a group adds a tab after its last tab and joins it to the group, naming the tab once', () => {
  const actions = newTabInGroupActions({ id: 'group-1' }, 'tab-last', 'profile-1', 'tab-new');
  assert.deepEqual(actions, [
    { type: 'tab.new', id: 'tab-new', browserProfileId: 'profile-1', afterId: 'tab-last' },
    { type: 'tab.group.assign', tabIds: ['tab-new'], groupId: 'group-1' },
  ]);
});

test('the "+" on a collapsed group opens it first, so the new tab shows', () => {
  const actions = newTabInGroupActions({ id: 'group-1', collapsed: true }, undefined, 'profile-1', 'tab-new');
  assert.equal(actions[0].type, 'tab.group.update');
  assert.deepEqual((actions[0] as { patch: object }).patch, { collapsed: false });
  assert.deepEqual(actions.map(action => action.type), ['tab.group.update', 'tab.new', 'tab.group.assign']);
  assert.ok(!('afterId' in actions[1]), 'with no member to follow the tab is appended');
});

test('split group actions keep the contract names and fields and are in the reducer union (split.unsplit, split.close, split.rename, split.addTab)', () => {
  // Typed as BrowserAction with no cast: the union has them (tests/split-actions.test.ts runs them through the reducer and the native validation).
  const actions: BrowserAction[] = [{ type: 'split.unsplit', groupId: 'split-1' }, { type: 'split.close', groupId: 'split-1' }, { type: 'split.addTab', groupId: 'split-1' }, { type: 'split.rename', groupId: 'split-1', name: 'Research' }];
  assert.deepEqual(actions.map(action => action.type), ['split.unsplit', 'split.close', 'split.addTab', 'split.rename']);
  assert.deepEqual(actions.map(action => (action as { groupId: string }).groupId), ['split-1', 'split-1', 'split-1', 'split-1']);
});

test('changing a split\'s layout opens its saved arrangement, then applies the layout it does not already have', () => {
  const group = { id: 'split-1', layout: 'columns' as const };
  assert.deepEqual(changeLayoutActions(group, 'rows'), [{ type: 'split.group.select', id: 'split-1' }, { type: 'split.layout', layout: 'rows' }]);
  assert.deepEqual(changeLayoutActions(group, 'columns'), [{ type: 'split.group.select', id: 'split-1' }]);
});

test('the layouts offered for a split are the ones that fit its panes; three and four panes offer six each, default first', () => {
  assert.deepEqual(layoutsFor(2), ['columns', 'rows']);
  assert.equal(layoutsFor(3).length, 6);
  assert.equal(layoutsFor(4).length, 6);
  assert.equal(layoutsFor(4)[0], 'grid');
});

test('run through the reducer, the "+" puts one more tab in the group, after the last one', () => {
  let state = createInitialState();
  const first = state.tabs[0];
  state = reduceBrowser(state, { type: 'tab.new', url: 'https://example.com/b', id: 'tab-11111111-1111-4111-8111-111111111111' });
  state = reduceBrowser(state, { type: 'tab.group.create', tabId: first.id, name: 'Work', color: 'blue' });
  state = reduceBrowser(state, { type: 'tab.group.assign', tabIds: ['tab-11111111-1111-4111-8111-111111111111'], groupId: state.tabGroups[0].id });
  const group = state.tabGroups[0], members = () => state.tabs.filter(tab => groupForTab(state, tab)?.id === group.id);
  assert.equal(members().length, 2);
  const last = members().at(-1)!;
  for (const action of newTabInGroupActions(group, last.id, first.browserProfileId, 'tab-22222222-2222-4222-8222-222222222222')) state = reduceBrowser(state, action);
  assert.equal(members().length, 3, 'the new tab joined the group');
  assert.equal(members().at(-1)!.id, 'tab-22222222-2222-4222-8222-222222222222', 'after the previous last tab');
  assert.equal(state.activeTabId, 'tab-22222222-2222-4222-8222-222222222222', 'and it is the current tab');
});

// QA audit: with "new tabs at the top" the sidebar moves a tab that arrives at the end of the list to the top. A reopened tab that was the last
// one (Ctrl+Shift+T, Undo) arrives at the end too, and went to the top instead of back to its own place.
test('a new tab at the end of the list is moved to the top; a reopened one is not', () => {
  const tab = (id: string) => ({ id });
  const before = new Set(['a', 'b', 'c']);
  assert.deepEqual(appendedTabs([tab('a'), tab('b'), tab('c'), tab('n')], before, new Set()).map(item => item.id), ['n'], 'a new tab at the end is new');
  assert.deepEqual(appendedTabs([tab('a'), tab('b'), tab('c'), tab('n')], before, new Set(['n'])), [], 'the same tab, reopened, keeps its place at the end');
  assert.deepEqual(appendedTabs([tab('a'), tab('n'), tab('b'), tab('c')], before, new Set()), [], 'a tab that arrives among the others was placed on purpose (reopened, duplicated, "new tab below")');
  assert.deepEqual(appendedTabs([tab('a'), tab('b'), tab('c'), tab('n'), tab('m')], before, new Set(['n'])).map(item => item.id), ['m'], 'only the reopened one stays');
});

// QA audit: the group menu's "New tab in group" made a plain new tab and then joined it to the group. In the sidebar (new tabs at the top) the
// plain tab was appended at the end of the list and moved to the top again, outside the group. It now sends the same actions as the header "+".
test('the group menu opens its new tab with the header "+" actions, not a plain tab joined afterwards', () => {
  const menu = fs.readFileSync(new URL('../src/components/TabGroupControls.tsx', import.meta.url), 'utf8');
  assert.ok(menu.includes("newTabInGroupActions(group,members.at(-1)?.id,tab.browserProfileId,"), 'the menu row uses newTabInGroupActions');
  assert.ok(!menu.includes("tabIds:[next.activeTabId]"), 'no plain tab.new followed by a separate assign of whatever became active');
});

// QA audit: "Add to Favorites · ⇧⌘D adds the current page" went into the tooltip's key cap whole (it holds only keys), so the name wrapped mid-word.
test('a "Name · keys what it does" tip becomes the name and a note, so the tooltip never takes the sentence for a key cap', async () => {
  const { parseTip } = await import('../src/components/transient/tooltipParse');
  const english = nameAndNote('Add to Favorites · ⇧⌘D adds the current page');
  assert.equal(english, 'Add to Favorites\n⇧⌘D adds the current page');
  assert.deepEqual(parseTip(english), { text: 'Add to Favorites', description: '⇧⌘D adds the current page' });
  assert.deepEqual(parseTip(nameAndNote('Add to Favorites · Ctrl+Shift+D adds the current page')), { text: 'Add to Favorites', description: 'Ctrl+Shift+D adds the current page' });
  assert.equal(nameAndNote('Add a favorite'), 'Add a favorite', 'a tip without the dot is left alone');
  assert.equal(nameAndNote('إضافة إلى المفضّلة · يضيف ⇧⌘D الصفحة الحالية'), 'إضافة إلى المفضّلة\nيضيف ⇧⌘D الصفحة الحالية', 'the sentence stays whole in every language');
});

// QA audit: a private or Tor tab takes no group, yet its menu offered Move to tab group, and "New tab group" opened an empty menu for a group that was never made.
test('the tab menu offers Move to tab group only to tabs that can be grouped', () => {
  const menu = fs.readFileSync(new URL('../src/components/TabGroupControls.tsx', import.meta.url), 'utf8');
  assert.ok(menu.includes("(!tab.privacy||tab.privacy==='secured')&&item(labels.groups"), 'private and Tor tabs get no group row; a secured workspace tab (which is grouped) does');
  const withPrivate = reduceBrowser(createInitialState(), { type: 'tab.new', url: 'https://a.test/', privacy: 'private' } as BrowserAction);
  const privateTab = withPrivate.tabs.at(-1)!;
  assert.equal(privateTab.privacy, 'private');
  const grouped = reduceBrowser(withPrivate, { type: 'tab.group.create', tabId: privateTab.id, name: 'G' } as BrowserAction);
  assert.equal(grouped.tabGroups.length, 0, 'the reducer refuses a group for a private tab, so the row could never work');
});
