import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import type { BrowserSnapshot } from '../src/runtime/types';
import {tabStripEntries} from '../src/ui/tabStripEntries';

/** Two loose tabs and a group of two, with the current tab inside the group. */
function withGroup(): BrowserSnapshot {
  let state = createInitialState();
  const profile = state.activeBrowserProfileId;
  state = { ...state, tabs: ['a', 'g1', 'g2', 'b'].map(id => makeTab(id, 'https://' + id + '.test/', undefined, profile)), activeTabId: 'g2' };
  state = reduceBrowser(state, { type: 'tab.group.create', tabId: 'g1', name: 'Work' });
  const group = state.tabGroups.find(item => item.name === 'Work')!;
  return reduceBrowser(state, { type: 'tab.group.assign', tabIds: ['g2'], groupId: group.id });
}

test('collapsing the group of the current tab moves the selection out (strip, Chrome)', () => {
  const state = withGroup(), group = state.tabGroups[0];
  const next = reduceBrowser(state, { type: 'tab.group.update', id: group.id, patch: { collapsed: true } });
  assert.equal(next.tabGroups[0].collapsed, true);
  assert.notEqual(next.activeTabId, 'g2');
});

test('the sidebar collapses it with keepActive: the current tab stays current and no fallback tab is made (Arc)', () => {
  const state = withGroup(), group = state.tabGroups[0];
  const next = reduceBrowser(state, { type: 'tab.group.update', id: group.id, keepActive: true, patch: { collapsed: true } });
  assert.equal(next.tabGroups[0].collapsed, true);
  assert.equal(next.activeTabId, 'g2');
  assert.equal(next.tabs.length, state.tabs.length);
});

test('saved split entries retain a separate parent and individual children outside the active split',()=>{
 let state=createInitialState();const first=state.activeTabId;
 state=reduceBrowser(state,{type:'tab.new'});const second=state.activeTabId;
 state=reduceBrowser(state,{type:'split.open',tabIds:[first,second]});const group=state.windowUi.splitGroups![0].id;
 state=reduceBrowser(state,{type:'tab.new'});
 let entries=tabStripEntries(state.tabs,state.tabGroups,false,state.windowUi.splitGroups);
 assert.equal(entries.filter(entry=>entry.header&&entry.splitGroup?.id===group).length,1);
 assert.deepEqual(entries.filter(entry=>!entry.header&&entry.splitGroup?.id===group).map(entry=>entry.tab.id),[first,second]);
 state=reduceBrowser(state,{type:'split.group.toggle',id:group});
 entries=tabStripEntries(state.tabs,state.tabGroups,false,state.windowUi.splitGroups);
 assert.equal(entries.filter(entry=>entry.header&&entry.splitGroup?.id===group).length,1);
 assert.equal(entries.filter(entry=>!entry.header&&entry.splitGroup?.id===group).length,0);
 assert.equal(state.tabs.length,3);
});
