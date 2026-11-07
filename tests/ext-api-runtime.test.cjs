'use strict';
// chrome.runtime and chrome.extension (P3): setUninstallURL (kept and opened on removal), openOptionsPage, requestUpdateCheck, getContexts,
// extension.getViews / isAllowedFileSchemeAccess / isAllowedIncognitoAccess. Chromium's own messaging (sendMessage, connect, onMessage,
// onMessageExternal, onConnectExternal, externally_connectable) stays native and is verified in the real app (qa/p3-runtime-live.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const runtimePackage = require('../desktop/browser-services/ext-api/runtime.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const packages = () => extApi.loadPackages({fresh: true}).filter(p => ['runtime', 'extension'].includes(p.name));

/** Chromium's runtime as the preload sees it: the members the engine leaves native, callback form. */
function nativeRuntime(manifest, {contexts = []} = {}) {
  const seen = {setUninstallURL: [], listeners: {}};
  return {
    seen,
    runtime: {
      id: ID, getManifest: () => manifest,
      setUninstallURL(...rest) {
        const callback = rest.pop();
        seen.setUninstallURL.push(rest[0]);
        let url = null; try { url = new URL(rest[0]); } catch { /* invalid */ }
        queueMicrotask(() => callback(undefined));
        if (!url && rest[0] !== '') seen.fail = rest[0];
      },
      getContexts(filter, callback) {
        const list = contexts.filter(c => !filter || !Array.isArray(filter.contextTypes) || filter.contextTypes.includes(c.contextType));
        if (typeof callback === 'function') { queueMicrotask(() => callback(list)); return undefined; }
        return Promise.resolve(list);
      },
      ...Object.fromEntries(['onMessage', 'onConnect', 'onMessageExternal', 'onConnectExternal', 'onInstalled', 'onUpdateAvailable'].map(name => {
        const listeners = [];
        seen.listeners[name] = listeners;
        return [name, {addListener(fn) { listeners.push(fn); }, removeListener(fn) { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); }, hasListener(fn) { return listeners.includes(fn); }}];
      }))
    }
  };
}

function setup(manifestExtra = {}, {worker = true, answer = () => undefined, contexts, incognito = false} = {}) {
  const manifest = {manifest_version: 3, permissions: [], ...manifestExtra};
  const native = nativeRuntime(manifest, {contexts});
  const world = extensionWorld(manifest, {packages: packages(), worker, answer, incognito, native: {runtime: native.runtime}, browser: {runtime: {id: ID}}});
  return {world, chrome: world.chrome, native};
}

test('both packages load: runtime (main + renderer), extension (renderer)', () => {
  const found = extApi.loadPackages({fresh: true});
  const runtime = found.find(p => p.name === 'runtime'), extension = found.find(p => p.name === 'extension');
  assert.deepEqual([runtime.namespaces, !!runtime.install, !!runtime.renderer], [['runtime'], true, true]);
  assert.deepEqual([extension.namespaces, !!extension.install, !!extension.renderer], [['extension'], false, true]);
});

test('setUninstallURL: Chromium\'s argument checks, then Acira keeps the URL (promise and callback forms)', async () => {
  const {chrome, world} = setup({}, {answer: () => undefined});
  await chrome.runtime.setUninstallURL('https://example.com/bye?x=1');
  assert.deepEqual(world.calls.filter(c => c.name === 'runtime.setUninstallURL').map(c => plain(c.args)), [['https://example.com/bye?x=1']]);
  await new Promise(resolve => chrome.runtime.setUninstallURL('', () => resolve()));
  assert.equal(world.calls.filter(c => c.name === 'runtime.setUninstallURL').length, 2, 'an empty string clears it');
  assert.throws(() => chrome.runtime.setUninstallURL(5), /Error in invocation of runtime\.setUninstallURL\(string url, optional function callback\): No matching signature\./);
  assert.throws(() => chrome.runtime.setUninstallURL('https://example.com/' + 'a'.repeat(1100)), /Error at parameter 'url': String must have at most 1023 characters; found 1120\./);
  assert.throws(() => chrome.runtime.setUninstallURL(), /Error in invocation of runtime\.setUninstallURL/);
  // the main process refusing (not a web URL) is the extension's error
  const refused = setup({}, {answer: name => (name === 'runtime.setUninstallURL' ? {__acira_error: 'Invalid URL: "ftp://x".'} : undefined)});
  await assert.rejects(refused.chrome.runtime.setUninstallURL('ftp://x'), /^Error: Invalid URL: "ftp:\/\/x"\.$/);
  const lastError = await new Promise(resolve => refused.chrome.runtime.setUninstallURL('ftp://x', (...args) => resolve({args, message: refused.chrome.runtime.lastError && refused.chrome.runtime.lastError.message})));
  assert.deepEqual(lastError, {args: [], message: 'Invalid URL: "ftp://x".'});
});

test('openOptionsPage: asks the main process; its error is the extension\'s error; the call forms are Chromium\'s', async () => {
  const ok = setup({options_ui: {page: 'o.html'}});
  assert.equal(await ok.chrome.runtime.openOptionsPage(), undefined);
  assert.equal(await new Promise(resolve => ok.chrome.runtime.openOptionsPage((...args) => resolve(args.length))), 0);
  assert.equal(ok.world.calls.filter(c => c.name === 'runtime.openOptionsPage').length, 2);
  const none = setup({}, {answer: name => (name === 'runtime.openOptionsPage' ? {__acira_error: 'Could not create an options page.'} : undefined)});
  await assert.rejects(none.chrome.runtime.openOptionsPage(), /^Error: Could not create an options page\.$/);
  assert.throws(() => ok.chrome.runtime.openOptionsPage('extra'), /Error in invocation of runtime\.openOptionsPage\(optional function callback\)/);
});

test('requestUpdateCheck: no_update (Acira updates Web Store extensions on request, never in the background), both forms', async () => {
  const {chrome} = setup();
  assert.deepEqual(plain(await chrome.runtime.requestUpdateCheck()), {status: 'no_update'});
  assert.deepEqual(plain(await new Promise(resolve => chrome.runtime.requestUpdateCheck(resolve))), {status: 'no_update'});
  assert.throws(() => chrome.runtime.requestUpdateCheck(1), /Error in invocation of runtime\.requestUpdateCheck/);
  assert.equal(typeof chrome.runtime.onUpdateAvailable.addListener, 'function');
});

test('getContexts: Chromium\'s argument checks; the background context is listed once', async () => {
  const contexts = [
    {contextType: 'BACKGROUND', documentUrl: `chrome-extension://${ID}/sw.js`, contextId: 'a'},
    {contextType: 'BACKGROUND', documentUrl: '', contextId: 'b'},
    {contextType: 'TAB', documentUrl: `chrome-extension://${ID}/o.html`, contextId: 'c'},
    {contextType: 'TAB', documentUrl: `chrome-extension://${ID}/o.html`, contextId: 'c2'},
    {contextType: 'TAB', documentUrl: `chrome-extension://${ID}/p.html`, contextId: 'd'}
  ];
  const {chrome} = setup({}, {contexts});
  assert.deepEqual(plain(await chrome.runtime.getContexts({})).map(c => c.contextId), ['a', 'c', 'd']);
  assert.deepEqual(plain(await new Promise(resolve => chrome.runtime.getContexts({contextTypes: ['TAB']}, resolve))).length, 2);
  assert.throws(() => chrome.runtime.getContexts({contextTypes: ['NOPE']}), /Error in invocation of runtime\.getContexts\(runtime\.ContextFilter filter, optional function callback\): Error at parameter 'filter': Error at property 'contextTypes': Error at index 0: Value must be one of/);
  assert.throws(() => chrome.runtime.getContexts(), /Error in invocation of runtime\.getContexts/);
});

test('what stays native stays: getURL, id, getManifest, messaging members, events all present', () => {
  const {chrome, world} = setup();
  assert.equal(chrome.runtime.id, ID);
  assert.equal(typeof chrome.runtime.getManifest, 'function');
  for (const name of ['onMessage', 'onConnect', 'onMessageExternal', 'onConnectExternal', 'onInstalled', 'onUpdateAvailable'])
    assert.equal(typeof chrome.runtime[name].addListener, 'function', name);
  assert.equal(world.browser.runtime.setUninstallURL, chrome.runtime.setUninstallURL, 'browser.runtime mirrors');
});

test('extension.isAllowedFileSchemeAccess / isAllowedIncognitoAccess: false, promise and callback; getViews as Chromium has it', async () => {
  const page = setup({}, {worker: false});
  const extension = page.chrome.extension;
  assert.equal(await extension.isAllowedFileSchemeAccess(), false);
  assert.equal(await extension.isAllowedIncognitoAccess(), false);
  assert.equal(await new Promise(resolve => extension.isAllowedFileSchemeAccess(resolve)), false);
  assert.equal(await new Promise(resolve => extension.isAllowedIncognitoAccess(resolve)), false);
  assert.throws(() => extension.isAllowedFileSchemeAccess(1), /Error in invocation of extension\.isAllowedFileSchemeAccess\(optional function callback\)/);
  assert.equal(extension.getViews().length, 1, 'a page lists itself');
  assert.equal(extension.getViews({type: 'popup'}).length, 0);
  assert.equal(extension.getViews({}).length, 1);
  assert.throws(() => extension.getViews({type: 'nope'}), /Error in invocation of extension\.getViews\(optional object fetchProperties\)/);
  const worker = setup({}, {worker: true});
  assert.equal(worker.chrome.extension.getViews, undefined, 'a service worker has no getViews');
  assert.equal(await worker.chrome.extension.isAllowedIncognitoAccess(), false);
});

const tabsAnswer = tabs => name => (name === 'runtime.tabs' ? tabs : undefined);
const aTab = (id, extra = {}) => ({id, index: 3, windowId: 7, active: true, pinned: false, highlighted: true, incognito: false, groupId: -1, url: 'https://a.example/', title: 'A', ...extra});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('sender.tab of a content script message is the tab model\'s tab (index, windowId), in the same turn, with the listener\'s own return value', async () => {
  const {chrome, native, world} = setup({}, {answer: tabsAnswer([aTab(5), aTab(6, {index: 0, windowId: 7, active: false})])});
  const heard = [];
  const listener = (message, sender, sendResponse) => { heard.push({message: plain(message), sender: plain(sender), sendResponse: typeof sendResponse}); return true; };
  chrome.runtime.onMessage.addListener(listener);
  chrome.runtime.onMessage.addListener(listener);
  assert.equal(native.seen.listeners.onMessage.length, 1, 'added once');
  assert.equal(chrome.runtime.onMessage.hasListener(listener), true);
  await tick();                                   // the table arrives (one call to the main process)
  assert.equal(world.calls.filter(c => c.name === 'runtime.tabs').length, 1);
  const nativeSender = {id: ID, url: 'https://a.example/page', origin: 'https://a.example', frameId: 0, tab: {id: 5, index: 0, windowId: 0, active: false, url: 'https://a.example/page'}};
  const result = native.seen.listeners.onMessage[0]({hello: 1}, nativeSender, () => {});
  assert.equal(result, true, 'the native event gets the listener\'s own return value');
  assert.deepEqual(heard[0].sender.tab, plain(aTab(5)));
  assert.equal(heard[0].sender.frameId, 0);
  assert.equal(heard[0].sender.url, 'https://a.example/page');
  assert.equal(heard[0].sender.id, ID);
  assert.equal(heard[0].sendResponse, 'function');
  assert.equal(nativeSender.tab.windowId, 0, 'the engine\'s sender is not touched');
  // a tab the table does not know (or a message without a tab): the engine\'s sender as it is
  const unknown = {id: ID, tab: {id: 99, index: 0, windowId: 0}}, noTab = {id: ID, url: 'chrome-extension://x/page.html'};
  native.seen.listeners.onMessage[0]('m', unknown, () => {}); native.seen.listeners.onMessage[0]('m', noTab, () => {});
  assert.deepEqual(heard[1].sender, plain(unknown));
  assert.deepEqual(heard[2].sender, plain(noTab));
  // updates and removals reach the table
  world.emit('runtime.tabs', {tabs: [aTab(5, {index: 1, active: false})], removed: [6]});
  native.seen.listeners.onMessage[0]('m', {id: ID, tab: {id: 5, index: 0, windowId: 0}}, () => {});
  native.seen.listeners.onMessage[0]('m', {id: ID, tab: {id: 6, index: 0, windowId: 0}}, () => {});
  assert.equal(heard[3].sender.tab.index, 1);
  assert.equal(heard[3].sender.tab.active, false);
  assert.equal(heard[4].sender.tab.windowId, 0, 'a removed tab is the engine\'s again');
  chrome.runtime.onMessage.removeListener(listener);
  assert.equal(native.seen.listeners.onMessage.length, 0);
  assert.equal(chrome.runtime.onMessage.hasListener(listener), false);
  assert.equal(chrome.runtime.onMessage.hasListeners(), false);
  chrome.runtime.onMessage.addListener('not a function');
  assert.equal(native.seen.listeners.onMessage.length, 0);
});

test('Acira\'s storage messages from content scripts reach only its own listener, never the extension\'s onMessage listeners', () => {
  const {chrome, native} = setup();
  const theirs = [], own = [];
  chrome.runtime.onMessage.addListener(message => { theirs.push(plain(message)); return true; });
  const inbox = message => { own.push(plain(message)); return false; };
  inbox.__acira = true;
  chrome.runtime.onMessage.addListener(inbox);
  const results = native.seen.listeners.onMessage.map(listener => listener({__acira_storage: {area: 'local', changes: {}}}, {id: ID}, () => {}));
  assert.deepEqual(theirs, [], 'the extension never hears it');
  assert.equal(own.length, 1);
  assert.deepEqual(results, [undefined, false]);
  for (const listener of native.seen.listeners.onMessage) listener({hello: 1}, {id: ID}, () => {});
  assert.deepEqual(theirs, [{hello: 1}], 'ordinary messages still reach every listener');
  assert.equal(own.length, 2);
  // not for the other events: an external message is the extension\'s own business
  const external = [];
  chrome.runtime.onMessageExternal.addListener(message => { external.push(plain(message)); });
  native.seen.listeners.onMessageExternal[0]({__acira_storage: 1}, {id: 'other'}, () => {});
  assert.equal(external.length, 1);
});

test('sender.tab: the table is requested only when a listener exists, and onMessageExternal / onConnect / onConnectExternal get the same sender', async () => {
  const {chrome, native, world} = setup({}, {answer: tabsAnswer([aTab(5)])});
  await tick();
  assert.equal(world.calls.filter(c => c.name === 'runtime.tabs').length, 0, 'no listener, no table');
  const seen = [];
  chrome.runtime.onMessageExternal.addListener((m, sender) => { seen.push(['external', plain(sender).tab.index]); });
  chrome.runtime.onConnect.addListener(port => { seen.push(['connect', port.sender.tab.index, port.name]); });
  chrome.runtime.onConnectExternal.addListener(port => { seen.push(['connectExternal', port.sender.tab.windowId]); });
  await tick();
  assert.equal(world.calls.filter(c => c.name === 'runtime.tabs').length, 1, 'one table for all of them');
  native.seen.listeners.onMessageExternal[0]('m', {id: 'other', tab: {id: 5, index: 0, windowId: 0}}, () => {});
  const portOf = () => ({name: 'p', sender: {id: ID, tab: {id: 5, index: 0, windowId: 0}}});
  native.seen.listeners.onConnect[0](portOf());
  native.seen.listeners.onConnectExternal[0](portOf());
  assert.deepEqual(seen, [['external', 3], ['connect', 3, 'p'], ['connectExternal', 7]]);
  // a port that refuses a new sender keeps the engine's
  const frozen = Object.freeze({name: 'f', sender: Object.freeze({id: ID, tab: {id: 5, index: 0, windowId: 0}})});
  assert.doesNotThrow(() => native.seen.listeners.onConnect[0](frozen));
});

// ------------------------------------------------------------------------------------------------ main side

function stubApi({store, tabs = [], dir} = {}) {
  const handlers = new Map(), logged = [];
  const api = {
    userData: dir, storeKey: 'profile one', session: {name: 'session'},
    handle: (name, fn) => handlers.set(name, fn), store: () => store, log: (...args) => logged.push(args.join(' '))
  };
  runtimePackage.internals.webContents = () => tabs;
  return {api, handlers, logged};
}
const event = (manifest, id = ID) => ({extension: {id, manifest}});

test('main: the uninstall URL is kept per extension and opened (once) in a new tab when the user removes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-p3-'));
  const opened = [];
  const store = {createTab: async details => { opened.push(details); }};
  const {api, handlers} = stubApi({store, dir});
  const result = runtimePackage.install(api);
  const set = handlers.get('runtime.setUninstallURL');
  set(event({}), 'https://example.com/bye');
  assert.throws(() => set(event({}), 'ftp://example.com/'), /^Error: Invalid URL: "ftp:\/\/example\.com\/"\.$/);
  assert.throws(() => set(event({}), 'javascript:alert(1)'), /Invalid URL/);
  const other = 'b'.repeat(32);
  set(event({}, other), 'https://example.org/gone');
  // survives a restart (a new install reads the same file)
  const second = stubApi({store, dir});
  const again = runtimePackage.install(second.api);
  again.forget(ID);
  assert.deepEqual(opened, [{url: 'https://example.com/bye', active: true}]);
  again.forget(ID);
  assert.equal(opened.length, 1, 'opened once');
  set(event({}, other), '');   // cleared
  result.forget(other);
  assert.equal(opened.length, 1, 'a cleared URL is not opened');
  result.forget('c'.repeat(32));
  assert.equal(opened.length, 1);
});

test('main: openOptionsPage opens options_ui / options_page in a tab, brings an open one forward, and fails like Chrome without one', async () => {
  const created = [], selected = [];
  const store = {createTab: async details => { created.push(details); }, selectTab: wc => { selected.push(wc); }};
  const tabs = [];
  const {api, handlers} = stubApi({store, tabs, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-p3-'))});
  runtimePackage.install(api);
  const open = handlers.get('runtime.openOptionsPage');
  await open(event({options_ui: {page: 'options/index.html'}}));
  await open(event({options_page: '/legacy.html'}));
  await open(event({options_ui: {page: 'ui.html'}, options_page: 'legacy.html'}));
  assert.deepEqual(created.map(c => c.url), [`chrome-extension://${ID}/options/index.html`, `chrome-extension://${ID}/legacy.html`, `chrome-extension://${ID}/ui.html`]);
  assert.ok(created.every(c => c.active === true));
  const existing = {getURL: () => `chrome-extension://${ID}/options/index.html#section`, isDestroyed: () => false};
  tabs.push(existing);
  await open(event({options_ui: {page: 'options/index.html'}}));
  assert.deepEqual(selected, [existing]);
  assert.equal(created.length, 3, 'no second tab');
  await assert.rejects(async () => open(event({})), /^Error: Could not create an options page\.$/);
  await assert.rejects(async () => open(event({options_page: ''})), /Could not create an options page\./);
  await assert.rejects(async () => open(event({options_ui: {page: 'https://evil.example/x.html'}})), /Could not create an options page\./);
  await open(event({options_ui: {page: '//evil.example/x.html'}}));   // leading slashes are the extension's own root, never another host
  assert.equal(created.at(-1).url, `chrome-extension://${ID}/evil.example/x.html`);
});

test('main: the engine\'s store keeps selectTab on its host object (store.impl): an open options tab is found there', async () => {
  const created = [], selected = [], existing = {getURL: () => `chrome-extension://${ID}/o.html`, isDestroyed: () => false};
  const store = {createTab: async details => { created.push(details); }, impl: {selectTab(wc) { selected.push([this === store.impl, wc]); }}};
  const {api, handlers} = stubApi({store, tabs: [existing], dir: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-p3-'))});
  runtimePackage.install(api);
  await handlers.get('runtime.openOptionsPage')(event({options_ui: {page: 'o.html'}}));
  assert.deepEqual(selected, [[true, existing]]);
  assert.equal(created.length, 0);
});

test('main: runtime.tabs answers the tab list from tabs.get (P1) and then pushes only what changed, to extensions that listen', async () => {
  const session = {name: 's'}, extension = {id: ID, manifest: {}};
  const pages = [{id: 5, session, isDestroyed: () => false}, {id: 6, session, isDestroyed: () => false}, {id: 7, session: {name: 'other'}, isDestroyed: () => false}, {id: 8, session, isDestroyed: () => true}];
  const model = new Map([[5, aTab(5)], [6, aTab(6, {index: 1, active: false})], [7, aTab(7)]]);
  let notify = null;
  const store = {tabs: new Set(pages), impl: {tabModel: {onChange: fn => { notify = fn; return () => { notify = null; }; }}}, on() {}, off() {}};
  const sent = [], listening = new Set();
  const handlers = new Map();
  const api = {
    userData: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-p3-')), storeKey: 'k', session,
    handle: (name, fn) => handlers.set(name, fn), handler: name => handlers.get(name) || null, store: () => store, log() {},
    listening: () => [...listening], getExtension: id => (id === ID ? extension : null), emit: (id, name, ...args) => sent.push([id, name, ...args])
  };
  // P1's handler, as the loader hands it over: the tab as this extension may see it, or an error answer
  handlers.set('tabs.get', (_event, tabId) => (model.has(tabId) ? model.get(tabId) : {__acira_error: `No tab with id: ${tabId}.`}));
  const result = runtimePackage.install(api);
  const list = handlers.get('runtime.tabs')({type: 'service-worker', extension});
  assert.deepEqual(list.map(tab => tab.id), [5, 6], 'only live pages of this session that the model knows');
  assert.equal(typeof notify, 'function', 'the model is followed once a renderer asked');
  listening.add(ID);
  notify(); notify();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(sent, [], 'nothing changed');
  model.set(6, aTab(6, {index: 0, active: true}));
  model.delete(5);
  notify();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(sent, [[ID, 'runtime.tabs', {tabs: [aTab(6, {index: 0, active: true})], removed: [5]}]]);
  listening.clear();
  model.set(6, aTab(6, {index: 2}));
  notify();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(sent.length, 1, 'nobody listens: nothing is computed or sent');
  result.dispose();
  assert.equal(notify, null, 'the subscription is dropped');
});

// ------------------------------------------------------------------------------------------------ runtime.onInstalled

const { EventEmitter } = require('node:events');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One profile's runtime as the loader gives it: Electron's session.extensions events, the engine router's addListener, api.emit. */
function installedRig({dir, browser = '1.0.0', registry} = {}) {
  const extensions = new EventEmitter(), sent = [], registered = [];
  const router = {listeners: new Map(), addListener(listener, extensionId, eventName) { registered.push([extensionId, eventName]); }};
  const api = {
    userData: dir, storeKey: 'profile-1', session: {extensions}, runtime: {ctx: {router}},
    handle() {}, handler: () => null, store: () => null, log() {}, listening: () => [], getExtension: () => null,
    emit: (id, name, ...args) => sent.push([id, name, ...args])
  };
  runtimePackage.internals.browserVersion = () => browser;
  if (registry) fs.writeFileSync(path.join(dir, 'extensions.json'), JSON.stringify({entries: registry}));
  const result = runtimePackage.install(api);
  const extension = (id, version) => ({id, manifest: {version}});
  return {
    extensions, sent, result, router,
    load: (id, version) => extensions.emit('extension-loaded', {}, extension(id, version)),
    unload: (id, version) => extensions.emit('extension-unloaded', {}, extension(id, version)),
    listen: (id, name = 'runtime.onInstalled') => router.addListener({}, id, name)
  };
}
const A = 'a'.repeat(32), B = 'b'.repeat(32);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-p3-inst-'));

test('onInstalled: a first load is reason install, held until the worker registers its listener, then sent once', async () => {
  const rig = installedRig({dir: tmp()});
  rig.load(A, '1.0');
  await wait(80);
  assert.deepEqual(rig.sent, [], 'no listener yet: nothing is lost, nothing is sent');
  rig.listen(A);
  await wait(120);
  assert.deepEqual(rig.sent, [[A, 'runtime.onInstalled', {reason: 'install'}]]);
  rig.listen(A);                          // the worker restarts later and registers again: no second install
  await wait(120);
  assert.equal(rig.sent.length, 1);
  // a listener of another extension does not release it
  rig.load(B, '2.0');
  rig.listen(A);
  await wait(120);
  assert.equal(rig.sent.length, 1);
  rig.listen(B);
  await wait(120);
  assert.deepEqual(rig.sent[1], [B, 'runtime.onInstalled', {reason: 'install'}]);
  rig.result.dispose();
});

test('onInstalled: a worker that registered before the load event is answered at once; an unpacked extension is the same', async () => {
  const rig = installedRig({dir: tmp()});
  rig.listen(A);
  rig.load(A, '1.0');
  assert.deepEqual(rig.sent, [[A, 'runtime.onInstalled', {reason: 'install'}]]);
  rig.result.dispose();
});

test('onInstalled: a restart of the app does not announce an install; a new version is update with previousVersion; a reload is update', async () => {
  const dir = tmp();
  const first = installedRig({dir});
  first.load(A, '1.0'); first.listen(A);
  await wait(120);
  first.result.dispose();
  // the app starts again: same version
  const second = installedRig({dir});
  second.listen(A);
  second.load(A, '1.0');
  assert.deepEqual(second.sent, [], 'startup load of a known extension');
  // reload: unload then load, same version, a listener from the OLD worker is still registered
  await wait(5);
  second.unload(A, '1.0');
  second.load(A, '1.0');
  await wait(80);
  assert.deepEqual(second.sent, [], 'the old worker\'s registration does not count: wait for the new one');
  await wait(5);
  second.listen(A);
  await wait(120);
  assert.deepEqual(second.sent, [[A, 'runtime.onInstalled', {reason: 'update', previousVersion: '1.0'}]]);
  // update to 1.1
  second.unload(A, '1.0');
  second.load(A, '1.1');
  second.listen(A);
  await wait(120);
  assert.deepEqual(second.sent[1], [A, 'runtime.onInstalled', {reason: 'update', previousVersion: '1.0'}]);
  second.result.dispose();
  // the version the record keeps is the new one
  const third = installedRig({dir});
  third.listen(A); third.load(A, '1.1');
  assert.deepEqual(third.sent, []);
  // a version change without an unload (the extension came back from disk with another version)
  third.load(A, '1.2');
  assert.deepEqual(third.sent, [[A, 'runtime.onInstalled', {reason: 'update', previousVersion: '1.1'}]]);
  third.result.dispose();
});

test('onInstalled: chrome_update once per extension on the first run of a new Acira version; removing the extension makes the next load an install', async () => {
  const dir = tmp();
  const old = installedRig({dir, browser: '1.0.0'});
  old.load(A, '1.0'); old.listen(A);
  await wait(100);
  old.result.dispose();
  const next = installedRig({dir, browser: '1.1.0'});
  next.listen(A);
  next.load(A, '1.0');
  assert.deepEqual(next.sent, [[A, 'runtime.onInstalled', {reason: 'chrome_update'}]]);
  next.load(A, '1.0');                   // loaded again in the same run (enable): not announced again
  assert.equal(next.sent.length, 1);
  next.result.forget(A);
  next.load(A, '1.0');
  assert.deepEqual(next.sent[1], [A, 'runtime.onInstalled', {reason: 'install'}], 'removed and added again is a new install');
  next.result.dispose();
  const after = installedRig({dir, browser: '1.1.0'});
  after.listen(A); after.load(A, '1.0');
  assert.deepEqual(after.sent, [], 'the browser version is recorded');
  after.result.dispose();
});

test('onInstalled: extensions the person already has (registry from before this existed) are not announced as installs', async () => {
  const dir = tmp(), folder = path.join(dir, 'pkg');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'x', version: '3.4'}));
  const rig = installedRig({dir, registry: [{id: A, profileId: 'profile-1', path: folder}, {id: B, profileId: 'other-profile', path: folder}]});
  rig.listen(A); rig.listen(B);
  rig.load(A, '3.4');
  assert.deepEqual(rig.sent, [], 'known from the registry');
  rig.load(B, '3.4');
  assert.deepEqual(rig.sent, [[B, 'runtime.onInstalled', {reason: 'install'}]], 'another profile\'s entry is not this profile\'s');
  rig.result.dispose();
});

test('onStartup: once per profile start for an extension the profile already had; not on install, reload, enabling later or a worker restart; held for a lazy worker', async () => {
  const dir = tmp();
  const startup = (rig, id) => rig.sent.filter(entry => entry[0] === id && entry[1] === 'runtime.onStartup');
  const first = installedRig({dir});
  first.listen(A); first.listen(A, 'runtime.onStartup');
  first.load(A, '1.0');
  assert.equal(startup(first, A).length, 0, 'a fresh install is not a startup');
  first.result.dispose();
  // the app starts again; the worker has not run yet (lazy): the event waits for its first registration
  const second = installedRig({dir});
  second.load(A, '1.0');
  await wait(80);
  assert.deepEqual(second.sent, [], 'nothing is sent, nothing is lost');
  second.listen(A, 'runtime.onStartup');
  await wait(120);
  assert.deepEqual(second.sent, [[A, 'runtime.onStartup']], 'exactly one onStartup, and no onInstalled');
  second.listen(A, 'runtime.onStartup');             // the worker restarts and registers again
  await wait(120);
  assert.equal(second.sent.length, 1);
  second.unload(A, '1.0'); second.load(A, '1.0');    // a reload
  second.listen(A, 'runtime.onStartup');
  await wait(120);
  assert.equal(startup(second, A).length, 1, 'a reload is not a startup');
  second.result.dispose();
  // a worker that registered before the load event is answered at once
  const third = installedRig({dir});
  third.listen(A, 'runtime.onStartup');
  third.load(A, '1.0');
  assert.deepEqual(third.sent, [[A, 'runtime.onStartup']]);
  third.result.dispose();
  // an extension first loaded long after the profile started (enabled by the person later) is not a startup
  const fourth = installedRig({dir});
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60000;
  try { fourth.listen(A, 'runtime.onStartup'); fourth.load(A, '1.0'); } finally { Date.now = realNow; }
  assert.deepEqual(fourth.sent, []);
  fourth.result.dispose();
  // chrome_update and startup both go out on the first run of a new Acira version
  const fifth = installedRig({dir, browser: '2.0.0'});
  fifth.listen(A); fifth.listen(A, 'runtime.onStartup');
  fifth.load(A, '1.0');
  assert.deepEqual(fifth.sent, [[A, 'runtime.onInstalled', {reason: 'chrome_update'}], [A, 'runtime.onStartup']]);
  fifth.result.dispose();
});

test('onStartup: the page-side event is the main process\'', () => {
  const {chrome, world} = setup();
  let calls = 0;
  chrome.runtime.onStartup.addListener((...args) => { calls += 1; assert.equal(args.length, 0); });
  world.emit('runtime.onStartup');
  assert.equal(calls, 1);
});

test('onInstalled: the page-side event is the main process\' (Chromium\'s never fires in Electron)', async () => {
  const {chrome, world} = setup();
  const heard = [];
  chrome.runtime.onInstalled.addListener(details => heard.push(plain(details)));
  world.emit('runtime.onInstalled', {reason: 'install'});
  world.emit('runtime.onInstalled', {reason: 'update', previousVersion: '1.0'});
  assert.deepEqual(heard, [{reason: 'install'}, {reason: 'update', previousVersion: '1.0'}]);
  assert.equal(chrome.runtime.onInstalled.hasListeners(), true);
});

test('inside a private session that runs the extension (Allow in private tabs) it is allowed in incognito, and says it is in an incognito context', async () => {
  for (const worker of [false, true]) {
    const {chrome} = setup({}, {worker, incognito: true});
    assert.equal(await chrome.extension.isAllowedIncognitoAccess(), true);
    assert.equal(await new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)), true);
    assert.equal(await chrome.extension.isAllowedFileSchemeAccess(), false, 'file access is still never given');
    assert.equal(chrome.extension.inIncognitoContext, true);
  }
  assert.notEqual(setup({}, {worker: false}).chrome.extension.inIncognitoContext, true, 'an ordinary profile is not an incognito context');
});
