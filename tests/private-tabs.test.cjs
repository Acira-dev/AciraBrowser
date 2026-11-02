'use strict';
// Private tabs, reducer and validation rows of docs/launch/PRIVATE_TABS.md: nothing a private tab does may reach saved state.
const {test} = require('node:test'), assert = require('node:assert/strict');
const {createInitialState, reduceBrowser, persistedSnapshot, restoreSnapshot} = require('../desktop/runtime.cjs');
const {validateAction} = require('../desktop/validation.cjs');
const {project} = require('../desktop/rewind/checkpoint-model.cjs');

const step = (state, action) => reduceBrowser(state, action);
const open = (state, url, privacy) => { const before = new Set(state.tabs.map(t => t.id)); const next = step(state, {type: 'tab.new', url, ...(privacy ? {privacy} : {})}); return {state: next, tab: next.tabs.find(t => !before.has(t.id))}; };
const navigate = (state, tab, url) => step(state, {type: 'browser.event', event: {type: 'state', tabId: tab.id, url, title: 'Visited'}});
const withPrivate = () => { const normal = open(createInitialState(), 'https://news.example/'); const priv = open(normal.state, 'https://secret.example/', 'private'); return {state: priv.state, normal: normal.tab, priv: priv.tab}; };

test('a private tab is a tab with a private flag, in the same profile as the window', () => {
  const {state, priv, normal} = withPrivate();
  assert.equal(priv.privacy, 'private'); assert.equal(normal.privacy, undefined);
  assert.equal(priv.browserProfileId, normal.browserProfileId); assert.equal(priv.pinned, false); assert.equal(priv.group, '');
  assert.equal(state.activeTabId, priv.id);
});

test('history: a private tab adds no visit, a normal tab does', () => {
  let {state, priv, normal} = withPrivate();
  state = navigate(state, priv, 'https://secret.example/page-2'); assert.deepEqual(state.browsingHistory.filter(v => v.url.includes('secret')), []);
  state = navigate(state, normal, 'https://news.example/story'); assert.ok(state.browsingHistory.some(v => v.url === 'https://news.example/story'));
});

test('saved state: private tabs, their closed copies and their downloads never reach disk', () => {
  let {state, priv} = withPrivate();
  state = step(state, {type: 'browser.event', event: {type: 'download', tabId: priv.id, id: 'd1', name: 'secret.pdf', size: '1 MB', status: 'complete', private: true, browserProfileId: priv.browserProfileId}});
  state = step(state, {type: 'browser.event', event: {type: 'download', tabId: state.tabs[0].id, id: 'd2', name: 'public.pdf', size: '1 MB', status: 'complete', browserProfileId: priv.browserProfileId}});
  const saved = persistedSnapshot(state), text = JSON.stringify(saved);
  assert.ok(!text.includes('secret.example') && !text.includes('secret.pdf'), 'nothing of the private tab is saved');
  assert.ok(saved.downloads.some(d => d.id === 'd2') && !saved.downloads.some(d => d.id === 'd1'));
  assert.ok(saved.tabs.length >= 1 && saved.tabs.some(t => t.id === saved.activeTabId), 'a valid active tab remains');
  const alone = persistedSnapshot(step(createInitialState(), {type: 'tab.new', url: 'https://only.example/', privacy: 'private'}));
  assert.ok(!JSON.stringify(alone).includes('only.example') && alone.tabs.length >= 1, 'a window with only a private tab saves a blank tab');
  const tampered = JSON.parse(JSON.stringify(state)); // a file that somehow still holds a private tab
  const restored = restoreSnapshot(tampered);
  assert.ok(!restored.tabs.some(t => t.privacy) && !JSON.stringify(restored.tabs).includes('secret.example'), 'even a hand-edited file cannot bring one back');
});

test('closing a private tab keeps nothing to undo', () => {
  let {state, priv} = withPrivate();
  state = step(state, {type: 'tab.close', id: priv.id});
  assert.equal(state.closedTabs.length, 0); assert.equal(state.toast, null, 'no "Tab closed · Undo" offer'); assert.ok(!state.tabs.some(t => t.id === priv.id));
  const control = open(createInitialState(), 'https://news.example/'), closed = step(control.state, {type: 'tab.close', id: control.tab.id});
  assert.equal(closed.closedTabs.length, 1, 'a normal tab still can be undone');
});

test('bookmarks: a private tab cannot be bookmarked', () => {
  let {state, normal} = withPrivate();
  const before = state.bookmarkNodes.length;
  state = step(state, {type: 'bookmark.toggle', url: 'https://secret.example/'}); assert.equal(state.bookmarkNodes.length, before);
  state = step(state, {type: 'tab.select', id: normal.id}); state = step(state, {type: 'bookmark.toggle', url: 'https://news.example/'}); assert.equal(state.bookmarkNodes.length, before + 1, 'a normal tab still can');
});

test('zoom: a private tab does not write the per-site zoom table', () => {
  let {state, priv} = withPrivate();
  state = step(state, {type: 'browser.event', event: {type: 'state', tabId: priv.id, zoom: 150}});
  assert.equal(state.tabs.find(t => t.id === priv.id).zoom, 150); assert.ok(!JSON.stringify(state.originZooms).includes('secret.example'), JSON.stringify(state.originZooms));
});

test('zoom: ordinary and private tabs on the same site keep independent zoom', () => {
  let {state, tab: normal} = open(createInitialState(), 'https://news.example/');
  const zoom = (id, value) => { state = step(state, {type: 'browser.event', event: {type: 'state', tabId: id, zoom: value}}); };
  zoom(normal.id, 200);
  const opened = open(state, 'https://news.example/private', 'private'); state = opened.state;
  const priv = opened.tab;
  assert.equal(priv.zoom, 100, 'a private tab does not inherit the ordinary site preference');
  zoom(priv.id, 150);
  assert.equal(state.tabs.find(t => t.id === normal.id).zoom, 200, 'private zoom leaves the ordinary tab alone');
  zoom(normal.id, 250);
  assert.equal(state.tabs.find(t => t.id === priv.id).zoom, 150, 'ordinary zoom leaves the private tab alone');
  state = step(state, {type: 'tab.navigate', tabId: priv.id, url: 'https://news.example/next'});
  assert.equal(state.tabs.find(t => t.id === priv.id).zoom, 150, 'private navigation keeps its own zoom');
  const saved = persistedSnapshot(state);
  assert.equal(saved.originZooms[normal.browserProfileId]['https://news.example'], 250);
  assert.ok(!saved.tabs.some(t => t.id === priv.id), 'private zoom never needs a saved tab or site preference');
});

test('pinning and groups: a private tab cannot be pinned or grouped, by any route', () => {
  let {state, priv, normal} = withPrivate();
  state = step(state, {type: 'tab.pin', id: priv.id}); assert.equal(state.tabs.find(t => t.id === priv.id).pinned, false);
  state = step(state, {type: 'tab.group.create', tabId: priv.id, name: 'Work'}); assert.equal(state.tabGroups.length, 0);
  state = step(state, {type: 'tab.group.create', tabId: normal.id, name: 'Work'}); const group = state.tabGroups[0]; assert.ok(group);
  state = step(state, {type: 'tab.group.assign', tabIds: [priv.id, normal.id], groupId: group.id});
  assert.equal(state.tabs.find(t => t.id === priv.id).group, ''); assert.equal(state.tabs.find(t => t.id === normal.id).group, group.name);
  state = step(state, {type: 'tab.drop', from: priv.id, to: normal.id, groupId: group.id}); assert.equal(state.tabs.find(t => t.id === priv.id).group, '');
});

test('duplicating a private tab makes another private tab', () => {
  let {state, priv} = withPrivate();
  state = step(state, {type: 'tab.duplicate', id: priv.id}); const copies = state.tabs.filter(t => t.url === priv.url);
  assert.equal(copies.length, 2); assert.ok(copies.every(t => t.privacy === 'private'));
});

test('Rewind never sees a private tab', () => {
  const {state, normal} = withPrivate();
  const view = JSON.stringify(project(state, normal.browserProfileId) || {});
  assert.ok(view.includes('news.example') && !view.includes('secret.example'), view);
});

test('the action boundary accepts "private" and "tor" and nothing else', () => {
  const state = createInitialState();
  assert.doesNotThrow(() => validateAction({type: 'tab.new', url: 'https://example.org/', privacy: 'private'}, state));
  assert.doesNotThrow(() => validateAction({type: 'tab.new'}, state));
  assert.doesNotThrow(() => validateAction({type: 'tab.new', url: 'https://example.org/', privacy: 'tor'}, state));
  for (const bad of ['Tor', 'Private', '', true, 1, null, {}]) assert.throws(() => validateAction({type: 'tab.new', privacy: bad}, state), /privacy|Tab privacy|unsupported/i, JSON.stringify(bad));
});
