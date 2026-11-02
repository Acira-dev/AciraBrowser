'use strict';
// Who may listen to an event (ext-api/index.cjs installEventGate). The engine's router registers any extension for any event name and
// delivers broadcasts to every registered listener; an extension page can name an event of its own with an ExtensionEvent it builds from
// chrome.tabs.onReplaced.constructor. Without this gate a extension that holds no permission at all heard downloads, history visits,
// navigations, the idle state and the engine's cookies.onChanged (the value of every cookie of the profile).
const test = require('node:test');
const assert = require('node:assert/strict');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {extensionWorld, ID} = require('./fixtures/ext-api/world.cjs');

const SPY = 'abcdefghijklmnopabcdefghijklmnoa';   // holds nothing
const HOLDER = 'abcdefghijklmnopabcdefghijklmnob'; // downloads, history, webNavigation, idle, cookies + all hosts

/** The engine's ExtensionRouter, reduced to what the gate touches (electron-chrome-extensions dist/cjs/index.js, class ExtensionRouter). */
function engineRouter() {
  const sent = [];
  return {
    listeners: new Map(), sent, handlers: new Map(),
    addListener(listener, extensionId, eventName) {
      if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
      const list = this.listeners.get(eventName);
      if (!list.some(item => item.extensionId === extensionId && item.type === listener.type)) list.push(listener);
    },
    sendEvent(targetExtensionId, eventName, ...args) {
      for (const listener of this.listeners.get(eventName) || []) {
        if (targetExtensionId && targetExtensionId !== listener.extensionId) continue;
        sent.push({to: listener.extensionId, name: eventName, args});
      }
    },
    broadcastEvent(eventName, ...args) { this.sendEvent(undefined, eventName, ...args); }
  };
}

function rig({holderPermissions = ['downloads', 'history', 'webNavigation', 'idle', 'cookies'], holderVersion = 3} = {}) {
  const extensions = {
    [SPY]: {id: SPY, manifest: {manifest_version: 3, name: 'spy', version: '1', permissions: []}},
    [HOLDER]: {id: HOLDER, manifest: {manifest_version: holderVersion, name: 'holder', version: '1', permissions: holderPermissions, host_permissions: ['<all_urls>']}}
  };
  const held = new Map(Object.entries(extensions).map(([id, extension]) => [id, new Set(extension.manifest.permissions)]));
  const permissions = {has: (extension, name) => !!held.get(extension.id)?.has(name), hasOrigin: () => true};
  const router = engineRouter();
  const installed = extApi.installPackages({router, getExtension: id => extensions[id] || null, permissions}, {packages: []});
  const listen = (extensionId, eventName, type = 'frame') => router.addListener({type, extensionId, ...(type === 'frame' ? {host: {}} : {})}, extensionId, eventName);
  return {router, installed, listen, held, extensions};
}
const heardBy = (router, name) => router.sent.filter(entry => entry.name === name).map(entry => entry.to);

test('an extension without the permission cannot register for downloads, history, webNavigation or idle events, however it names them', () => {
  const {router, listen} = rig();
  for (const name of ['downloads.onCreated', 'downloads.onChanged', 'history.onVisited', 'aciraWebNavigation.onCommitted', 'webNavigation.onCommitted', 'idle.onStateChanged']) {
    listen(SPY, name);
    listen(HOLDER, name);
    router.broadcastEvent(name, {url: 'https://bank.example/account?token=secret'});
    assert.deepEqual(heardBy(router, name), [HOLDER], `${name}: only the extension that holds the permission hears it`);
  }
  assert.deepEqual([...router.listeners.get('downloads.onCreated')].map(item => item.extensionId), [HOLDER], 'the spy was never registered');
});

test('the engine\'s raw cookies.onChanged (every cookie of the profile, no host check) reaches nobody; the per-host acira.cookies.onChanged still does', () => {
  const {router, listen} = rig();
  listen(SPY, 'cookies.onChanged');
  listen(HOLDER, 'cookies.onChanged');
  listen(HOLDER, 'acira.cookies.onChanged');
  listen(SPY, 'acira.cookies.onChanged');
  router.broadcastEvent('cookies.onChanged', {cookie: {name: 'sid', value: 'secret', domain: 'bank.example'}});
  assert.deepEqual(heardBy(router, 'cookies.onChanged'), [], 'not even an extension with the cookies permission: the engine broadcast has no host-permission check');
  router.sendEvent(HOLDER, 'acira.cookies.onChanged', {cookie: {name: 'sid'}});
  assert.deepEqual(heardBy(router, 'acira.cookies.onChanged'), [HOLDER]);
});

test('a permission taken back (permissions.remove) stops events at once, without the page being reloaded', () => {
  const {router, listen, held} = rig();
  listen(HOLDER, 'downloads.onCreated');
  router.broadcastEvent('downloads.onCreated', {id: 1});
  assert.deepEqual(heardBy(router, 'downloads.onCreated'), [HOLDER]);
  held.get(HOLDER).delete('downloads');
  router.broadcastEvent('downloads.onCreated', {id: 2});
  assert.equal(router.sent.filter(entry => entry.name === 'downloads.onCreated').length, 1, 'the second event was not delivered');
  assert.equal(router.listeners.get('downloads.onCreated').length, 1, 'the registration itself is untouched (the permission may come back)');
  held.get(HOLDER).add('downloads');
  router.broadcastEvent('downloads.onCreated', {id: 3});
  assert.equal(router.sent.filter(entry => entry.name === 'downloads.onCreated').length, 2);
});

test('events every extension may hear keep working: runtime, permissions, browserAction (MV3 action clicks), Acira\'s internal names', () => {
  const {router, listen} = rig();
  for (const name of ['runtime.onInstalled', 'permissions.onAdded', 'browserAction.onClicked', 'acira.permissions.changed', 'tabs.onUpdated', 'windows.onFocusChanged']) {
    listen(SPY, name);
    router.sendEvent(SPY, name, {});
    assert.deepEqual(heardBy(router, name), [SPY], name);
  }
});

test('a service worker listener is judged as a worker (notInServiceWorkers), a page listener as a page; one listener never hides another', () => {
  const {router, listen} = rig();
  listen(HOLDER, 'downloads.onCreated', 'service-worker');
  listen(HOLDER, 'downloads.onCreated', 'frame');
  listen(SPY, 'downloads.onCreated', 'frame');
  router.broadcastEvent('downloads.onCreated', {id: 7});
  assert.equal(heardBy(router, 'downloads.onCreated').filter(id => id === HOLDER).length, 2);
  assert.equal(heardBy(router, 'downloads.onCreated').includes(SPY), false);
});

test('the gate never throws into the engine\'s ipcMain handler, restores the router on dispose, and leaves a router without addListener alone', () => {
  const {router, installed, listen} = rig();
  assert.doesNotThrow(() => listen('ffffffffffffffffffffffffffffffff', 'downloads.onCreated'), 'an unknown extension id is refused quietly');
  assert.doesNotThrow(() => listen('ffffffffffffffffffffffffffffffff', 'runtime.onMessage'), 'also for an event nobody gates (the engine throws for an extension that is not loaded)');
  assert.equal((router.listeners.get('runtime.onMessage') || []).length, 0);
  assert.doesNotThrow(() => router.addListener(undefined, HOLDER, 'downloads.onCreated'));
  installed.dispose();
  assert.equal(router.addListener.name, 'addListener', 'the engine\'s own method is back');
  const bare = {sendEvent() {}, listeners: new Map()};
  const before = bare.sendEvent;
  extApi.installPackages({router: bare, getExtension: () => null}, {packages: []});
  assert.equal(bare.sendEvent, before, 'no addListener: nothing to guard');
});

test('the renderer proof: an extension with no permission can build the event (that is why the main process has to refuse it)', () => {
  const world = extensionWorld({manifest_version: 3, name: 'x', version: '1', permissions: []}, {worker: true});
  const vm = require('node:vm');
  vm.runInContext(`const E = chrome.tabs.onReplaced.constructor; new E('downloads.onCreated').addListener(() => {});`, world.context);
  assert.ok(world.calls.some(call => call.channel === 'crx-add-listener' && call.args[1] === 'downloads.onCreated'), 'crx-add-listener leaves the page');
  assert.equal(ID.length, 32);
});

test('namespaceOfEvent names the namespace whose permission an event needs', () => {
  assert.equal(extApi.namespaceOfEvent('downloads.onCreated'), 'downloads');
  assert.equal(extApi.namespaceOfEvent('aciraWebNavigation.onCommitted'), 'webNavigation');
  assert.equal(extApi.namespaceOfEvent('acira.cookies.onChanged'), 'cookies');
  assert.equal(extApi.namespaceOfEvent('system.display.onDisplayChanged'), 'system.display');
  assert.equal(extApi.namespaceOfEvent('browserAction.onClicked'), null);
  assert.equal(extApi.namespaceOfEvent('acira.permissions.changed'), null);
});
