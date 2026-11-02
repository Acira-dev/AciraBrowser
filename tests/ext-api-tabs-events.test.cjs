'use strict';
// chrome.tabs events (package P1): derived from the tab model, Chrome's order and payloads, scrubbed per extension.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRig} = require('./fixtures/ext-api-tabs/rig.cjs');
const {stationary} = require('../desktop/browser-services/ext-api/tabs/events.cjs');

async function settled(options = {}) {
  const rig = createRig(options);
  const one = rig.addWindow({focused: true}), two = rig.addWindow();
  const a = rig.addTab(one, {url: 'https://a.example.com/', title: 'A'});
  const b = rig.addTab(one, {url: 'https://b.example.com/', title: 'B'});
  const c = rig.addTab(one, {url: 'https://c.example.com/', title: 'C'});
  const x = rig.addTab(two, {url: 'https://x.example.com/', title: 'X'});
  one.state.activeTabId = a.id; two.state.activeTabId = x.id;
  rig.notify(); await rig.flush();   // baseline: nobody listens yet
  rig.listen('onCreated', 'onUpdated', 'onMoved', 'onActivated', 'onHighlighted', 'onDetached', 'onAttached', 'onRemoved', 'onZoomChange');
  rig.sent.length = 0;
  const wc = (window, tab) => window.pages.get(tab.id).view.webContents;
  const names = () => rig.sent.map(entry => entry.name.replace('tabs.', ''));
  return {rig, one, two, a, b, c, x, wc, names};
}

test('the stationary run picks the tabs that did not move', () => {
  assert.equal([...stationary([0, 1, 2, 3])].length, 4, 'nothing moved');
  assert.deepEqual([...stationary([1, 2, 3, 0])].sort(), [0, 1, 2], 'A moved to the end: only A is out of line');
  assert.deepEqual([...stationary([3, 0, 1, 2])].sort(), [1, 2, 3], 'D moved to the front');
});

test('a new tab: onCreated (scrubbed Tab), then onActivated and onHighlighted when it is the active one', async () => {
  const {rig, one, names} = await settled();
  rig.addTab(one, {url: 'https://new.example.com/', title: 'New'});
  one.state.activeTabId = one.state.tabs.at(-1).id;
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), ['onCreated', 'onActivated', 'onHighlighted']);
  const created = rig.sent[0].args[0];
  assert.equal(created.url, 'https://new.example.com/');
  assert.equal(created.index, 3);
  assert.equal(created.windowId, one.id);
  assert.deepEqual(rig.sent[1].args, [{tabId: created.id, windowId: one.id}]);
  assert.deepEqual(rig.sent[2].args, [{windowId: one.id, tabIds: [created.id]}]);
});

test('private and Tor tabs raise no event at all', async () => {
  const {rig, one, names} = await settled();
  rig.addTab(one, {url: 'https://secret.example/', title: 'Private', privacy: 'private'});
  rig.addTab(one, {url: 'https://onion.example/', title: 'Tor', privacy: 'tor'});
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), []);
});

test('a closed tab: onRemoved with the window, then the new active tab (Chrome\'s order); isWindowClosing when the window goes', async () => {
  const {rig, one, two, a, x, wc, names} = await settled();
  const aId = wc(one, a).id;
  rig.store.removeTab(wc(one, a));
  await rig.flush();
  assert.deepEqual(names(), ['onRemoved', 'onActivated', 'onHighlighted']);
  assert.deepEqual(rig.sent[0].args, [aId, {windowId: one.id, isWindowClosing: false}]);
  rig.sent.length = 0;
  const xId = wc(two, x).id;
  rig.store.removeTab(wc(two, x));
  two.win.destroyed = true;
  rig.notify(); await rig.flush();
  assert.deepEqual(rig.sent.filter(e => e.name === 'tabs.onRemoved').map(e => e.args), [[xId, {windowId: two.id, isWindowClosing: true}]]);
});

test('changed properties: onUpdated carries only what changed plus the whole Tab', async () => {
  const {rig, one, b, wc, names} = await settled();
  b.title = 'B (3)'; b.loading = true; b.favicon = 'data:b';
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), ['onUpdated']);
  const [id, info, tab] = rig.sent[0].args;
  assert.equal(id, wc(one, b).id);
  assert.deepEqual(info, {title: 'B (3)', favIconUrl: 'data:b', status: 'loading'});
  assert.equal(tab.title, 'B (3)');
  assert.equal(tab.status, 'loading');
  rig.sent.length = 0;
  b.loading = false; b.audible = true; b.muted = true;
  rig.notify(); await rig.flush();
  assert.deepEqual(rig.sent[0].args[1], {status: 'complete', audible: true, mutedInfo: {muted: true, reason: 'user'}});
});

test('pin and group changes are updates too (the engine never saw them); pinning also moves the tab', async () => {
  const {rig, one, c, wc, names} = await settled();
  one.dispatch({type: 'tab.pin', id: c.id});
  await rig.flush();
  assert.deepEqual(names(), ['onMoved', 'onUpdated']);
  assert.deepEqual(rig.sent[0].args, [wc(one, c).id, {windowId: one.id, fromIndex: 2, toIndex: 0}]);
  assert.deepEqual(rig.sent[1].args[1], {pinned: true});
  rig.sent.length = 0;
  c.group = 'Reading'; one.state.tabGroups.push({id: 'g1', name: 'Reading', color: 'blue', collapsed: false, browserProfileId: 'p'});
  rig.notify(); await rig.flush();
  assert.equal(rig.sent[0].args[1].groupId > 0, true);
});

test('a moved tab: one onMoved for the tab that moved, none for the ones it passed', async () => {
  const {rig, one, a, wc, names} = await settled();
  one.dispatch({type: 'tab.reorder', from: a.id, to: one.state.tabs[2].id});
  await rig.flush();
  assert.deepEqual(names(), ['onMoved']);
  assert.deepEqual(rig.sent[0].args, [wc(one, a).id, {windowId: one.id, fromIndex: 0, toIndex: 2}]);
});

test('a tab that changes window: onDetached then onAttached', async () => {
  const {rig, one, two, b, wc, names} = await settled();
  const page = one.pages.get(b.id);
  one.pages.delete(b.id); one.state.tabs.splice(one.state.tabs.indexOf(b), 1);
  two.pages.set(b.id, page); two.state.tabs.push(b); rig.store.tabToWindow.set(wc(two, b), two.win);
  rig.notify(); await rig.flush();
  assert.deepEqual(names().filter(name => name !== 'onActivated' && name !== 'onHighlighted'), ['onDetached', 'onAttached']);
  const id = wc(two, b).id;
  assert.deepEqual(rig.sent.find(e => e.name === 'tabs.onDetached').args, [id, {oldWindowId: one.id, oldPosition: 1}]);
  assert.deepEqual(rig.sent.find(e => e.name === 'tabs.onAttached').args, [id, {newWindowId: two.id, newPosition: 1}]);
});

test('activation: onActivated + onHighlighted when the person selects another tab', async () => {
  const {rig, one, c, wc, names} = await settled();
  one.dispatch({type: 'tab.select', id: c.id});
  await rig.flush();
  assert.deepEqual(names(), ['onActivated', 'onHighlighted']);
  assert.deepEqual(rig.sent[0].args, [{tabId: wc(one, c).id, windowId: one.id}]);
});

test('each extension gets a Tab scrubbed for it; an update with nothing visible left is not delivered', async () => {
  const bare = await settled({manifest: {manifest_version: 3, permissions: []}});
  bare.b.title = 'Secret title'; bare.b.url = 'https://b.example.com/next';
  bare.rig.notify(); await bare.rig.flush();
  assert.deepEqual(bare.names(), [], 'url and title changes are invisible to an extension without access: nothing is sent');
  bare.b.loading = true;
  bare.rig.notify(); await bare.rig.flush();
  const [, info, tab] = bare.rig.sent[0].args;
  assert.deepEqual(info, {status: 'loading'});
  assert.equal('url' in tab, false);
  assert.equal('title' in tab, false);
  bare.rig.addTab(bare.one, {url: 'https://n.example.com/', title: 'N'});
  bare.rig.notify(); await bare.rig.flush();
  const created = bare.rig.sent.find(e => e.name === 'tabs.onCreated').args[0];
  assert.equal('url' in created, false);
});

test('the engine\'s own tabs events are dropped (ours replace them); other namespaces pass', async () => {
  const {rig} = await settled();
  rig.router.broadcastEvent('tabs.onUpdated', 1, {}, {});
  rig.router.broadcastEvent('windows.onFocusChanged', 1);
  assert.deepEqual(rig.sent.map(e => e.name), ['windows.onFocusChanged']);
  rig.installed.dispose();
  rig.router.broadcastEvent('tabs.onUpdated', 1, {}, {});
  assert.equal(rig.sent.at(-1).name, 'tabs.onUpdated', 'disposing the package gives the engine its events back');
});

test('pinning a middle tab: the pinned tab is the one that moved, not the one it passed', async () => {
  const {rig, one, b, wc, names} = await settled();
  one.dispatch({type: 'tab.pin', id: b.id});
  await rig.flush();
  assert.deepEqual(names(), ['onMoved', 'onUpdated']);
  assert.deepEqual(rig.sent[0].args, [wc(one, b).id, {windowId: one.id, fromIndex: 1, toIndex: 0}]);
});

test('the new-tab page is a tab with an index and an id: pinning another tab past it is a move', async () => {
  const rig = createRig();
  const one = rig.addWindow({focused: true});
  rig.addTab(one, {url: 'acira://newtab', title: '', page: false, contentKind: 'internal'});
  const a = rig.addTab(one, {url: 'https://a.example.com/', title: 'A'});
  rig.addTab(one, {url: 'https://b.example.com/', title: 'B'});
  one.state.activeTabId = a.id;
  rig.notify(); await rig.flush();
  const listed = JSON.parse(JSON.stringify(await rig.call('tabs.query', {})));
  assert.deepEqual(listed.map(t => [t.url, t.index]), [['chrome://newtab/', 0], ['https://a.example.com/', 1], ['https://b.example.com/', 2]]);
  rig.listen('onMoved', 'onUpdated');
  rig.sent.length = 0;
  one.dispatch({type: 'tab.pin', id: a.id});
  await rig.flush();
  const moved = rig.sent.filter(e => e.name === 'tabs.onMoved');
  assert.equal(moved.length, 1);
  assert.deepEqual([moved[0].args[1].fromIndex, moved[0].args[1].toIndex], [1, 0]);
});

test('a tab that sleeps is updated (discarded, unloaded), not removed; waking it keeps its id and is another update', async () => {
  const {rig, one, b, wc, names} = await settled();
  const id = wc(one, b).id, page = one.pages.get(b.id);
  one.pages.delete(b.id); rig.store.tabs.delete(page.view.webContents); page.view.webContents.destroyed = true;
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), ['onUpdated']);
  assert.deepEqual(rig.sent[0].args.slice(0, 2), [id, {status: 'unloaded', discarded: true}]);
  assert.equal(rig.sent[0].args[2].discarded, true);
  rig.sent.length = 0;
  const woken = rig.makeWc(b.url, b.title);
  one.pages.set(b.id, {view: {webContents: woken}}); rig.store.tabs.add(woken); rig.store.tabToWindow.set(woken, one.win);
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), ['onUpdated']);
  assert.deepEqual(rig.sent[0].args.slice(0, 2), [id, {status: 'complete', discarded: false}]);
  assert.equal(JSON.parse(JSON.stringify(await rig.call('tabs.get', woken.id))).id, id, 'the new page answers to the same tab');
});

test('a tab moved to another window by Acira (it opens the address there and closes the old tab) keeps its id: onDetached then onAttached', async () => {
  const {rig, one, two, b, wc, names} = await settled();
  const id = wc(one, b).id;
  rig.handoff(b.id, b.url);                                        // main.cjs announces the move before it opens the address in the other window
  const born = rig.addTab(two, {url: b.url, title: b.title});    // the new tab, with a new page, in the other window
  rig.notify(); await rig.flush();
  const gone = one.state.tabs.indexOf(b), page = one.pages.get(b.id);
  one.state.tabs.splice(gone, 1); one.pages.delete(b.id); rig.store.tabs.delete(page.view.webContents); page.view.webContents.destroyed = true;
  rig.notify(); await rig.flush();
  const list = names().filter(name => name !== 'onActivated' && name !== 'onHighlighted');
  assert.deepEqual(list, ['onDetached', 'onAttached'], 'neither a removal nor a creation');
  assert.deepEqual(rig.sent.find(e => e.name === 'tabs.onDetached').args, [id, {oldWindowId: one.id, oldPosition: 1}]);
  assert.equal(rig.sent.find(e => e.name === 'tabs.onAttached').args[0], id);
  const tab = JSON.parse(JSON.stringify(await rig.call('tabs.get', id)));
  assert.equal(tab.windowId, two.id);
  assert.equal(JSON.parse(JSON.stringify(await rig.call('tabs.get', wc(two, born).id))).id, id, 'the new page is an alias of the old id');
});

test('the new window\'s first tab starts as the new-tab page and navigates a moment later: still the same tab (held back, never announced)', async () => {
  const {rig, one, two, b, wc, names} = await settled();
  const id = wc(one, b).id;
  rig.handoff(b.id, b.url);
  const fresh = rig.addTab(two, {url: 'acira://new', title: '', page: false, contentKind: 'internal'});
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), [], 'a new-tab page that may be the continuation is not announced yet');
  fresh.url = b.url; fresh.contentKind = 'web'; fresh.title = b.title;
  const page = rig.makeWc(b.url, b.title); two.pages.set(fresh.id, {view: {webContents: page}}); rig.store.tabs.add(page); rig.store.tabToWindow.set(page, two.win);
  const gone = one.state.tabs.indexOf(b), old = one.pages.get(b.id);
  one.state.tabs.splice(gone, 1); one.pages.delete(b.id); rig.store.tabs.delete(old.view.webContents); old.view.webContents.destroyed = true;
  rig.notify(); await rig.flush();
  assert.deepEqual(names().filter(name => name !== 'onActivated' && name !== 'onHighlighted'), ['onDetached', 'onAttached']);
  assert.equal(JSON.parse(JSON.stringify(await rig.call('tabs.get', id))).windowId, two.id);
});

test('zoom changes made in Acira raise onZoomChange', async () => {
  const {rig, one, c, wc, names} = await settled();
  c.zoom = 100;
  rig.notify(); await rig.flush();
  rig.sent.length = 0;
  c.zoom = 150;
  rig.notify(); await rig.flush();
  assert.deepEqual(names(), ['onZoomChange']);
  assert.deepEqual(rig.sent[0].args, [{tabId: wc(one, c).id, oldZoomFactor: 1, newZoomFactor: 1.5, zoomSettings: {mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1}}]);
});

test('events reach a page through the real preload: addListener receives Chromium\'s arguments', async () => {
  const {rig, one, b, wc} = await settled();
  const heard = [];
  rig.world.chrome.tabs.onUpdated.addListener((id, info, tab) => heard.push([id, info, tab.title]));
  rig.world.chrome.tabs.onActivated.addListener(info => heard.push(['activated', info]));
  rig.world.emit('tabs.onUpdated', wc(one, b).id, {status: 'loading'}, {title: 'B'});
  rig.world.emit('tabs.onActivated', {tabId: 1, windowId: 2});
  assert.deepEqual(JSON.parse(JSON.stringify(heard)), [[wc(one, b).id, {status: 'loading'}, 'B'], ['activated', {tabId: 1, windowId: 2}]]);
  assert.throws(() => rig.world.chrome.tabs.onUpdated.addListener(() => {}, {urls: []}), {message: 'This event does not support filters'});
});
