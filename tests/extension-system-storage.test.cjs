'use strict';
// P0 (28 Oct): chrome.system.storage.getInfo() ended Acira's main process, because Chromium's implementation needs a StorageMonitor that
// Electron never creates (the same holds for getAvailableCapacity, ejectDevice and onAttached/onDetached listeners). The namespace is now
// Acira's on both `chrome` and `browser`; the native one is never reached. Real-app check: node qa/extension-api-probe/run.mjs --only system
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {patchPreload} = require('../desktop/browser-services/extension-runtime-patch.cjs');
const {installExtensionApis, createSystemStorage} = require('../desktop/browser-services/extension-apis.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const explode = name => () => { throw new Error('native ' + name + ' reached'); };
const nativeSystem = () => ({
  cpu: {getInfo: async () => ({numOfProcessors: 8})},
  memory: {getInfo: async () => ({capacity: 1})},
  display: {getInfo: async () => []},
  storage: {getInfo: explode('getInfo'), getAvailableCapacity: explode('getAvailableCapacity'), ejectDevice: explode('ejectDevice'),
    onAttached: {addListener: explode('onAttached'), removeListener() {}}, onDetached: {addListener: explode('onDetached'), removeListener() {}}}
});

function extensionWorld(manifest, {answer = () => undefined, frozen = false} = {}) {
  const text = patchPreload(fs.readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8'), {userScriptsAllowed: []});
  const calls = [];
  const electron = {
    ipcRenderer: {invoke: async (channel, extensionId, name, ...args) => { calls.push({channel, name, args}); return answer(name, args); },
      send: (channel, ...args) => calls.push({channel, args}), addListener() {}, on() {}, once() {}, off() {}, removeListener() {}},
    contextBridge: {executeInMainWorld: ({func}) => func()}, webFrame: {}
  };
  const system = nativeSystem(), browserSystem = nativeSystem();
  if (frozen) Object.freeze(system);
  const chrome = {runtime: {id: ID, getManifest: () => manifest}, i18n: {getMessage: n => n}, system};
  const browser = {runtime: {id: ID, getManifest: () => manifest}, system: browserSystem};
  const context = {require: n => { if (n === 'electron') return electron; throw new Error(n); }, process: {type: 'service-worker', contextIsolated: false},
    location: {href: `chrome-extension://${ID}/sw.js`}, console: {log() {}, warn() {}, error() {}, debug() {}}, URL, Promise, queueMicrotask,
    crypto: {randomUUID: () => '00000000-0000-4000-8000-000000000000'}, chrome, browser};
  context.globalThis = context; vm.createContext(context); vm.runInContext(text, context);
  return {chrome: context.chrome, browser: context.browser, calls, nativeCpu: system.cpu};
}

test('system.storage never reaches the native implementation, on chrome and on browser', async () => {
  const units = [{id: 'x', name: 'C:\\', type: 'fixed', capacity: 100}];
  const world = extensionWorld({manifest_version: 3, permissions: ['system.storage', 'system.cpu']}, {answer: name => (name === 'system.storage.getInfo' ? units : undefined)});
  for (const root of [world.chrome, world.browser]) {
    const storage = root.system.storage;
    assert.deepEqual(await storage.getInfo(), units);
    await storage.getAvailableCapacity('x');
    await storage.ejectDevice('x');
    const listener = () => {};
    storage.onAttached.addListener(listener); storage.onDetached.addListener(listener);
    storage.onAttached.removeListener(listener);
    assert.equal(storage.StorageUnitType.FIXED, 'fixed');
    assert.equal(storage.EjectDeviceResultCode.NO_SUCH_DEVICE, 'no_such_device');
  }
  assert.equal(world.chrome.system.storage, world.browser.system.storage);
  assert.equal(world.chrome.system.cpu, world.nativeCpu, 'cpu stays native (it works in Electron)');
  const names = world.calls.filter(c => c.channel === 'crx-msg').map(c => c.name);
  assert.ok(names.filter(n => n === 'system.storage.getInfo').length === 2, JSON.stringify(names));
});

test('a namespace object that refuses the property still ends up with Acira\'s storage', async () => {
  const world = extensionWorld({manifest_version: 3, permissions: ['system.storage']}, {frozen: true, answer: () => []});
  assert.deepEqual(await world.chrome.system.storage.getInfo(), []);
  assert.equal(typeof world.chrome.system.cpu.getInfo, 'function');
});

test('without the permission nothing is touched', () => {
  const world = extensionWorld({manifest_version: 3, permissions: ['storage']});
  assert.throws(() => world.chrome.system.storage.getInfo(), /native getInfo reached/);
});

test('createSystemStorage lists drives that answer, with sizes; unknown ids and eject answer like Chrome', async () => {
  const stats = {'C:\\': {blocks: 1000, bsize: 4096, bavail: 250}, 'D:\\': {blocks: 10, bsize: 512, bavail: 1}};
  const storage = createSystemStorage({platform: 'win32', timeout: 50,
    statfs: root => (root === 'E:\\' ? new Promise(() => {}) : stats[root] ? Promise.resolve(stats[root]) : Promise.reject(new Error('ENOENT')))});
  const info = await storage.getInfo();
  assert.deepEqual(info.map(u => [u.name, u.type, u.capacity]), [['C:\\', 'fixed', 4096000], ['D:\\', 'fixed', 5120]]);
  assert.match(info[0].id, /^[0-9a-f]{32}$/);
  assert.deepEqual(await storage.getAvailableCapacity(info[0].id), {id: info[0].id, availableCapacity: 1024000});
  assert.deepEqual(await storage.getAvailableCapacity('nope'), {__acira_error: 'Error occurred when querying available capacity.'});
  assert.equal(await storage.ejectDevice(info[0].id), 'no_such_device');
  const posix = createSystemStorage({platform: 'darwin', statfs: async root => (root === '/' ? {blocks: 2, bsize: 10, bavail: 1} : null)});
  assert.deepEqual((await posix.getInfo()).map(u => u.name), ['/']);
});

test('the main process answers system.storage.* behind the permission', async () => {
  const handlers = new Map();
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback}); }, sendEvent() {}};
  const extensions = {getExtension: () => null, on() {}};
  installExtensionApis({ctx: {router}}, {session: {extensions, serviceWorkers: {getAllRunning: () => ({})}}, userData: require('node:os').tmpdir()});
  for (const name of ['system.storage.getInfo', 'system.storage.getAvailableCapacity', 'system.storage.ejectDevice']) assert.ok(handlers.has(name), name);
  const denied = await handlers.get('system.storage.getInfo').callback({extension: {id: ID, manifest: {permissions: []}}});
  assert.deepEqual(denied, {__acira_error: "'system.storage' permission is required."});
  const info = await handlers.get('system.storage.getInfo').callback({extension: {id: ID, manifest: {permissions: ['system.storage']}}});
  assert.ok(Array.isArray(info) && info.length >= 1 && info.every(u => u.type === 'fixed' && u.capacity > 0), JSON.stringify(info));
});
