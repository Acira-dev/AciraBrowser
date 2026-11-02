'use strict';
// Extension API quick wins from docs/launch/EXTENSION_API_COVERAGE.md: tabs.query honours currentWindow / lastFocusedWindow / windowType,
// and every constant and enum Chromium 152 defines is present on the namespaces an extension has (from the generated Chromium surface).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const {patchPreload} = require('../desktop/browser-services/extension-runtime-patch.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');
const {chromiumConstants} = require('../desktop/browser-services/extension-apis-renderer.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';

function withRouter(tabs, {lastFocusedWindowId = 2, windows = [1, 2]} = {}) {
  const handlers = new Map();
  handlers.set('tabs.query', {callback: (_event, info = {}) => tabs.filter(t => info.active === undefined || t.active === info.active)});
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback}); }, sendEvent() {}};
  const store = {lastFocusedWindowId, windows: new Set(windows), getWindowById: id => (windows.includes(id) ? {id} : null), addWindow() {}};
  installExtensionApis({ctx: {router, store}}, {session: {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}}, userData: os.tmpdir()});
  return (info, event = {extension: {id: ID, manifest: {permissions: ['tabs']}}}) => handlers.get('tabs.query').callback(event, info);
}

test('tabs.query: currentWindow / lastFocusedWindow pick the last focused window, windowType normal', async () => {
  const tabs = [{id: 1, windowId: 1, active: true}, {id: 2, windowId: 1, active: false}, {id: 3, windowId: 2, active: true}, {id: 4, windowId: 2, active: false}];
  const query = withRouter(tabs);
  assert.deepEqual((await query({active: true, currentWindow: true})).map(t => t.id), [3]);
  assert.deepEqual((await query({active: true, currentWindow: false})).map(t => t.id), [1]);
  assert.deepEqual((await query({lastFocusedWindow: true})).map(t => t.id), [3, 4]);
  assert.deepEqual((await query({active: true})).map(t => t.id), [1, 3], 'without window filters every window is searched');
  assert.deepEqual((await query({windowType: 'normal', active: true})).map(t => t.id), [1, 3]);
  assert.deepEqual(await query({windowType: 'popup'}), []);
});

test('tabs.query: an engine that answers with a promise is narrowed too', async () => {
  const handlers = new Map();
  handlers.set('tabs.query', {callback: async () => [{id: 1, windowId: 1}, {id: 2, windowId: 5}]});
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback}); }, sendEvent() {}};
  installExtensionApis({ctx: {router, store: {lastFocusedWindowId: 5, windows: new Set([5]), getWindowById: id => (id === 5 ? {id} : null)}}},
    {session: {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}}, userData: os.tmpdir()});
  assert.deepEqual((await handlers.get('tabs.query').callback({}, {currentWindow: true})).map(t => t.id), [2]);
});

test("Chromium's constants and enums reach the namespaces the engine builds", () => {
  const constants = chromiumConstants();
  assert.equal(constants.tabs.SPLIT_VIEW_ID_NONE, -1);
  assert.equal(constants.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT, 6);
  assert.equal(constants.declarativeNetRequest.RuleActionType.MODIFY_HEADERS, 'modifyHeaders');
  assert.equal(constants.runtime.OnInstalledReason.CHROME_UPDATE, 'chrome_update');
  const manifest = {manifest_version: 3, action: {}, permissions: ['tabs', 'contextMenus', 'storage']};
  const text = patchPreload(fs.readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8'), {userScriptsAllowed: []});
  const electron = {ipcRenderer: {invoke: async () => undefined, send() {}, addListener() {}, on() {}, once() {}, off() {}, removeListener() {}},
    contextBridge: {executeInMainWorld: ({func}) => func()}, webFrame: {}};
  const nativeRuntime = {id: ID, getManifest: () => manifest, OnInstalledReason: Object.freeze({INSTALL: 'install'})};
  const chrome = {runtime: nativeRuntime, i18n: {getMessage: n => n}, storage: {local: {get() {}}}};
  const context = {require: n => { if (n === 'electron') return electron; throw new Error(n); }, process: {type: 'service-worker', contextIsolated: false},
    location: {href: `chrome-extension://${ID}/sw.js`}, console: {log() {}, warn() {}, error() {}, debug() {}}, URL, Promise, queueMicrotask,
    crypto: {randomUUID: () => '00000000-0000-4000-8000-000000000000'}, chrome};
  context.globalThis = context; vm.createContext(context); vm.runInContext(text, context);
  const c = context.chrome;
  assert.equal(c.tabs.SPLIT_VIEW_ID_NONE, -1);
  assert.equal(c.tabs.TAB_ID_NONE, -1, 'existing constants unchanged');
  assert.equal(c.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT, 6);
  assert.deepEqual({...c.runtime.OnInstalledReason}, {INSTALL: 'install'}, 'what the engine already defines is left alone');
  assert.equal(c.runtime.PlatformOs.WIN, 'win');
  assert.equal(c.storage.AccessLevel.TRUSTED_CONTEXTS, 'TRUSTED_CONTEXTS');
});

function engineWorld(manifest, answer = () => undefined, native = {}) {
  const text = patchPreload(fs.readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8'), {userScriptsAllowed: []});
  const calls = [];
  const electron = {ipcRenderer: {invoke: async (channel, extensionId, name, ...args) => { calls.push({name, args}); return answer(name, args); }, send() {}, addListener() {}, on() {}, once() {}, off() {}, removeListener() {}},
    contextBridge: {executeInMainWorld: ({func}) => func()}, webFrame: {}};
  const local = {get: async () => ({mine: 1}), set: async () => {}};
  const chrome = {runtime: {id: ID, getManifest: () => manifest}, i18n: {getMessage: n => n}, storage: {local}, ...native};
  const context = {require: n => { if (n === 'electron') return electron; throw new Error(n); }, process: {type: 'service-worker', contextIsolated: false},
    location: {href: `chrome-extension://${ID}/sw.js`}, console: {log() {}, warn() {}, error() {}, debug() {}}, URL, Promise, queueMicrotask,
    crypto: {randomUUID: () => '00000000-0000-4000-8000-000000000000'}, chrome};
  context.globalThis = context; vm.createContext(context); vm.runInContext(text, context);
  return {chrome: context.chrome, calls, local};
}

// downloads.search is no longer a quick-win stub: the P7 package answers it from the real download manager (tests/ext-api-downloads.test.cjs).
// notifications.getAll's map and the main-side badge colour handlers moved into the P8 packages (tests/ext-api-notifications.test.cjs, tests/ext-api-action.test.cjs).
test('storage.managed is empty and read-only (no longer the local store)', async () => {
  // (Chrome answers an extension without storage.managed_schema with "Managed storage manifest not found"; ext-api/storage-renderer.cjs, tests/ext-api-storage.test.cjs.)
  const {chrome, local} = engineWorld({manifest_version: 3, action: {}, storage: {managed_schema: 'schema.json'}, permissions: ['storage', 'downloads', 'notifications']},
    name => (name === 'notifications.getAll' ? ['a', 'b'] : undefined));
  assert.notEqual(chrome.storage.managed, local);
  const plain = value => JSON.parse(JSON.stringify(value)); // values made inside the vm realm
  assert.deepEqual(plain(await chrome.storage.managed.get(null)), {});
  assert.deepEqual(plain(await chrome.storage.managed.get({policy: 'default'})), {policy: 'default'});
  assert.deepEqual(plain(await chrome.storage.managed.getKeys()), []);
  await assert.rejects(chrome.storage.managed.set({x: 1}), {message: 'This is a read-only store.'});
  assert.equal(typeof chrome.storage.managed.onChanged.addListener, 'function');
  await new Promise(resolve => chrome.storage.managed.get(null, value => { assert.deepEqual(plain(value), {}); resolve(); }));
});

test('action.setBadgeTextColor / getBadgeTextColor / isEnabled exist and go to the main process', async () => {
  // Chromium's own (unanswered) bindings may be on the engine's action object: isEnabled said false. Acira's replace them.
  const {chrome, calls} = engineWorld({manifest_version: 3, action: {}, permissions: []}, name => (name === 'action.getBadgeTextColor' ? [1, 2, 3, 255] : name === 'action.isEnabled' ? true : undefined),
    {action: {isEnabled: async () => false, getBadgeTextColor: async () => []}});
  await chrome.action.setBadgeTextColor({color: '#fff'});
  assert.deepEqual(await chrome.action.getBadgeTextColor({}), [1, 2, 3, 255]);
  assert.equal(await chrome.action.isEnabled(), true);
  assert.equal(typeof chrome.action.onUserSettingsChanged.addListener, 'function');
  assert.ok(calls.some(c => c.name === 'action.setBadgeTextColor'));
});

test('main: Chrome colour parsing for badges', async () => {
  const {parseBadgeColor} = require('../desktop/browser-services/extension-apis.cjs');
  assert.deepEqual(parseBadgeColor('#fff'), [255, 255, 255, 255]);
  assert.deepEqual(parseBadgeColor('#11223380'), [17, 34, 51, 128]);
  assert.deepEqual(parseBadgeColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 128]);
  assert.deepEqual(parseBadgeColor([1, 2, 3, 4]), [1, 2, 3, 4]);
  assert.equal(parseBadgeColor('nope'), null);
});
