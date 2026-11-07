import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { isGroupFold } from '../src/runtime/tabGroups';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Beta.12, item 13 (a GitHub user: "a small delay when closing a tab group in the sidebar"). A header click sent tab.group.update to main and drew nothing until
// main's snapshot came back (the IPC round trip, then the interface's once-a-frame batching): 1 to 3 frames on an idle Mac, 100 ms and more while main was busy
// (page loads), so the folder icon, the chevron and the rows fading all started late. The interface now applies the fold itself on the click's own frame
// (runtime/client.ts), like tab.select; main's snapshot replaces it.

/** Loose tab, a group "Work" of two tabs (g1, g2), another group "Play" of one tab (p1), a loose tail tab; the current tab is as given. */
function withGroups(active: string): BrowserSnapshot {
  let state = createInitialState();
  const profile = state.activeBrowserProfileId;
  state = { ...state, tabs: ['a', 'g1', 'g2', 'p1', 'b'].map(id => makeTab(id, 'https://' + id + '.test/', undefined, profile)), activeTabId: active };
  state = reduceBrowser(state, { type: 'tab.group.create', tabId: 'g1', name: 'Work' });
  const work = state.tabGroups.find(item => item.name === 'Work')!;
  state = reduceBrowser(state, { type: 'tab.group.assign', tabIds: ['g2'], groupId: work.id });
  state = reduceBrowser(state, { type: 'tab.group.create', tabId: 'p1', name: 'Play' });
  return { ...state, activeTabId: active };
}
const groupId = (state: BrowserSnapshot, name: string) => state.tabGroups.find(item => item.name === name)!.id;
const fold = (id: string, collapsed: boolean, keepActive?: boolean): BrowserAction => ({ type: 'tab.group.update', id, ...(keepActive ? { keepActive } : {}), patch: { collapsed } });

test('the sidebar header click (keepActive) is drawn at once, collapse and expand, wherever the current tab is', () => {
  for (const active of ['a', 'g2', 'p1']) {
    const state = withGroups(active), work = groupId(state, 'Work');
    assert.equal(isGroupFold(state, fold(work, true, true)), true, 'collapse, current tab ' + active);
    assert.equal(isGroupFold(state, fold(work, false, true)), true, 'expand, current tab ' + active);
  }
});

test('a fold the strip makes (no keepActive) is drawn at once unless it would move the selection', () => {
  const outside = withGroups('a'), work = groupId(outside, 'Work');
  assert.equal(isGroupFold(outside, fold(work, true)), true, 'the current tab is outside the group: nothing else changes');
  assert.equal(isGroupFold(outside, fold(work, false)), true);
  const inside = withGroups('g2');
  assert.equal(isGroupFold(inside, fold(work, true)), false, 'collapsing the current tab\'s group: main picks the next tab, or makes one with an id only it chooses');
  assert.equal(isGroupFold(inside, fold(work, false)), true, 'expanding it moves nothing');
  assert.equal(isGroupFold(inside, fold(groupId(inside, 'Play'), true)), true, 'folding another group leaves the current tab alone');
});

test('a current tab inside a group that is already collapsed is left to main when the strip folds another group (the reducer would make a fresh tab)', () => {
  const base = withGroups('g2'), work = groupId(base, 'Work'), play = groupId(base, 'Play');
  const collapsed = reduceBrowser(base, fold(work, true, true));
  assert.equal(collapsed.activeTabId, 'g2', 'the sidebar collapse kept the current tab');
  assert.equal(isGroupFold(collapsed, fold(play, true)), false, 'no keepActive: the reducer replaces a current tab hidden in a collapsed group');
  assert.equal(reduceBrowser(collapsed, fold(play, true)).tabs.length, collapsed.tabs.length + 1, 'and it does: a fresh tab, with an id only main can choose');
  assert.equal(isGroupFold(collapsed, fold(play, true, true)), true, 'with keepActive the current tab stays: drawn at once');
});

test('only the collapsed flag counts: a rename, a colour, a mixed patch, an unknown group, or another action goes through main as before', () => {
  const state = withGroups('a'), work = groupId(state, 'Work');
  assert.equal(isGroupFold(state, { type: 'tab.group.update', id: work, patch: { name: 'Renamed' } }), false);
  assert.equal(isGroupFold(state, { type: 'tab.group.update', id: work, patch: { color: 'blue' } }), false);
  assert.equal(isGroupFold(state, { type: 'tab.group.update', id: work, patch: { collapsed: true, name: 'Renamed' } }), false);
  assert.equal(isGroupFold(state, { type: 'tab.group.update', id: work, patch: {} }), false);
  assert.equal(isGroupFold(state, fold('group-that-is-gone', true, true)), false, 'main would ignore it: nothing to show');
  assert.equal(isGroupFold(state, { type: 'tab.group.remove', id: work }), false);
  assert.equal(isGroupFold(state, { type: 'tab.close', id: 'g1' }), false);
});

test('what the interface draws is what main will answer: the same reducer, the same fold, a revision apart', () => {
  const state = withGroups('g2'), work = groupId(state, 'Work');
  for (const action of [fold(work, true, true), fold(work, false, true)]) {
    assert.equal(isGroupFold(state, action), true);
    const local = reduceBrowser(state, action), remote = reduceBrowser(structuredClone(state), action);
    assert.deepEqual(local.tabGroups, remote.tabGroups);
    assert.deepEqual(local.tabs.map(tab => tab.id), remote.tabs.map(tab => tab.id), 'no tab made or lost');
    assert.equal(local.activeTabId, 'g2');
    assert.equal(local.revision, state.revision + 1);
  }
  // Two quick clicks in one frame: the second reads the first's result.
  const once = reduceBrowser(state, fold(work, true, true));
  assert.equal(isGroupFold(once, fold(work, false, true)), true);
  assert.equal(reduceBrowser(once, fold(work, false, true)).tabGroups.find(item => item.id === work)!.collapsed, false);
});

test('the client draws a group fold on the click\'s frame: it asks isGroupFold with the state on screen, next to the actions that were already optimistic', () => {
  const client = readFileSync(new URL('../src/runtime/client.ts', import.meta.url), 'utf8');
  assert.match(client, /import \{ isGroupFold \} from '\.\/tabGroups';/);
  assert.match(client, /if\(native&&\(OPTIMISTIC\.has\(action\.type\)\|\|isGroupFold\(latest\.current,action\)\)&&!location\.search\.includes\('view=overlay'\)/, 'the optimistic branch takes a group fold; the overlay (the group menu) still waits for main');
  assert.match(client, /const OPTIMISTIC=new Set<string>\(\['tab\.select','tab\.new','tab\.close','workspace\.select','split\.resize','sidebar\.mode'\]\);/, 'the set itself is unchanged');
  const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /dispatch\(\{type:'tab\.group\.update',id:group\.id,keepActive:true,patch:\{collapsed:!group\.collapsed\}\}\)/, 'the header click sends exactly the action the predicate knows');
});
