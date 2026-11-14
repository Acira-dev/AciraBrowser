'use strict';
// 13.8, seen in the whole-app check of the toolbar listener fix: the MAIN process printed "MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 destroyed
// listeners added to [WebContents]" during tab switches (trace: node_modules/electron-chrome-extensions/dist/cjs/index.js:402, the router's browserAction.addObserver handler).
// The library's handlers:
//   browserAction.addObserver:    this.observers.add(observer); observer.once("destroyed", () => this.observers.delete(observer));
//   browserAction.removeObserver: this.observers.delete(observer);
// A "destroyed" listener is added to the interface's WebContents at every addObserver and never taken off. The interface calls addObserver whenever the buttons of a partition go from
// none to one, and the toolbar and the sidebar row are rebuilt together at each tab switch: one more listener per tab switch, for as long as the window lives.
// extension-action-observers.cjs replaces the two handlers on the session's router when the toolbar is attached (extension-toolbar.cjs): one listener for each observer, taken off at
// removeObserver. These tests run the library's REAL BrowserActionAPI (the real ElectronChromeExtensions class, built against a fake electron and a fake session, no Electron) and
// call its real handlers the way the router does, before and after the replacement; and read the installed library, so that a library update that renames or fixes these handlers fails
// here instead of silently dropping (or double-applying) the replacement.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const {EventEmitter} = require('node:events');
const root = path.join(__dirname, '..');
const libraryDir = fs.realpathSync(path.join(root, 'node_modules', 'electron-chrome-extensions'));
const {installObserverFix, ADD, REMOVE} = require('../desktop/browser-services/extension-action-observers.cjs');

const dummy = () => new Proxy(function () {}, {get: (target, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : dummy()), apply: () => dummy(), construct: () => dummy()});
const fakeElectron = () => ({
  ipcMain: Object.assign(new EventEmitter(), {handle() {}, on() {}}), session: {defaultSession: {}},
  app: Object.assign(new EventEmitter(), {getVersion: () => '44.9.3', isReady: () => true, whenReady: () => Promise.resolve(), getPath: () => '/tmp'}),
  webContents: {fromId: () => null, getAllWebContents: () => []}, BrowserWindow: {getAllWindows: () => []}, Menu: class {}, MenuItem: class {}, nativeImage: {}, shell: {}, net: {}, dialog: {}, protocol: {},
  Notification: class {}, screen: {}, clipboard: {}, WebContentsView: class {}, BaseWindow: class {}, powerMonitor: new EventEmitter(), systemPreferences: {},
});
const fakeSession = () => Object.assign(new EventEmitter(), {
  extensions: Object.assign(new EventEmitter(), {getExtension: () => null, getAllExtensions: () => []}), protocol: {isProtocolHandled: () => false, handle() {}, unhandle() {}},
  registerPreloadScript() {}, getPreloadScripts: () => [], serviceWorkers: Object.assign(new EventEmitter(), {on() {}}), cookies: new EventEmitter(), webRequest: {}, getStoragePath: () => null,
});
/** The library's real runtime (its own BrowserActionAPI and router) on a fake session. */
function realRuntime() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(libraryDir)) delete require.cache[key];
  const load = Module._load, electron = fakeElectron();
  Module._load = function (request, parent, isMain) { return request === 'electron' ? electron : load.call(this, request, parent, isMain); };
  try {
    const {ElectronChromeExtensions} = require('electron-chrome-extensions');
    return new ElectronChromeExtensions({license: 'GPL-3.0', session: fakeSession()});
  } finally { Module._load = load; }
}
/** An interface window as the router hands it to the handler: its WebContents is an event emitter that can be destroyed. */
function windowOf() {
  const contents = Object.assign(new EventEmitter(), {sent: [], isDestroyed: () => contents.destroyed, destroyed: false, send(...args) { contents.sent.push(args[0]); }});
  contents.setMaxListeners(0);   // (the warning is not what these tests read: the count is)
  return contents;
}
const call = (runtime, name, observer, type = 'frame') => runtime.ctx.router.handlers.get(name).callback({type, sender: observer, extension: undefined});
const destroyedListeners = observer => observer.listenerCount('destroyed');

// ---- what the installed library does (a library update that changes it fails here) -----------------------------------------------------------------------------------------

test('the installed library\'s handlers are the ones the replacement is written for: addObserver adds a "destroyed" listener at every call, removeObserver takes none off (when this fails, the library changed: read extension-action-observers.cjs)', () => {
  const text = fs.readFileSync(path.join(libraryDir, 'dist', 'cjs', 'index.js'), 'utf8');
  assert.match(text, /handle\(\s*"browserAction\.addObserver",\s*\(event\) => \{\s*if \(event\.type != "frame"\) return;\s*const observer = event\.sender;\s*this\.observers\.add\(observer\);\s*observer\.once\?\.\("destroyed", \(\) => \{\s*this\.observers\.delete\(observer\);\s*\}\);\s*\},\s*preloadOpts\s*\);/, 'addObserver');
  assert.match(text, /handle\(\s*"browserAction\.removeObserver",\s*\(event\) => \{\s*if \(event\.type != "frame"\) return;\s*const \{ sender: observer \} = event;\s*this\.observers\.delete\(observer\);\s*\},\s*preloadOpts\s*\);/, 'removeObserver');
  assert.match(text, /this\.observers = \/\* @__PURE__ \*\/ new Set\(\);/, 'the set of observers');
  assert.match(text, /handle\(name, callback, opts\) \{\s*this\.handlers\.set\(name, \{/, 'the router keeps its handlers in a map that handle() replaces by name');
  assert.match(text, /const preloadOpts = \{ allowRemote: true, extensionContext: false \};/, 'the options of the two handlers');
});

test('the library alone: every addObserver / removeObserver cycle leaves a "destroyed" listener on the window (30 cycles, 30 listeners: the leak)', () => {
  const runtime = realRuntime(), observer = windowOf();
  for (let i = 0; i < 30; i++) { call(runtime, ADD, observer); call(runtime, REMOVE, observer); }
  assert.equal(destroyedListeners(observer), 30);
  assert.equal(runtime.api.browserAction.observers.size, 0, 'the set itself is kept right');
});

// ---- the replacement -----------------------------------------------------------------------------------------------------------------------------------------------------------

test('after the replacement 30 addObserver / removeObserver cycles leave no "destroyed" listener, and one is held while the window is an observer', () => {
  const runtime = realRuntime(), observer = windowOf();
  assert.equal(installObserverFix(runtime), true);
  for (let i = 0; i < 30; i++) {
    call(runtime, ADD, observer);
    assert.equal(destroyedListeners(observer), 1, `observing, round ${i}`);
    assert.equal(runtime.api.browserAction.observers.has(observer), true);
    call(runtime, REMOVE, observer);
    assert.equal(destroyedListeners(observer), 0, `removed, round ${i}`);
    assert.equal(runtime.api.browserAction.observers.has(observer), false);
  }
});

test('asking again while already an observer adds nothing (the toolbar and the sidebar row ask together), and one removeObserver takes the listener off', () => {
  const runtime = realRuntime(), observer = windowOf();
  installObserverFix(runtime);
  call(runtime, ADD, observer); call(runtime, ADD, observer); call(runtime, ADD, observer);
  assert.equal(destroyedListeners(observer), 1);
  assert.equal(runtime.api.browserAction.observers.size, 1);
  call(runtime, REMOVE, observer);
  assert.equal(destroyedListeners(observer), 0);
  call(runtime, REMOVE, observer);   // a second remove (a list that was never counted): nothing to take off, nothing thrown
  assert.equal(destroyedListeners(observer), 0);
});

test('windows are independent: each has its own listener, and removing one leaves the other\'s', () => {
  const runtime = realRuntime(), first = windowOf(), second = windowOf();
  installObserverFix(runtime);
  call(runtime, ADD, first); call(runtime, ADD, second);
  assert.deepEqual([destroyedListeners(first), destroyedListeners(second)], [1, 1]);
  call(runtime, REMOVE, first);
  assert.deepEqual([destroyedListeners(first), destroyedListeners(second)], [0, 1]);
  assert.equal(runtime.api.browserAction.observers.has(second), true);
});

test('a window that is destroyed while it observes leaves the set (the listener does its work), and asking again afterwards works', () => {
  const runtime = realRuntime(), observer = windowOf();
  installObserverFix(runtime);
  call(runtime, ADD, observer);
  observer.destroyed = true; observer.emit('destroyed');
  assert.equal(runtime.api.browserAction.observers.size, 0);
  assert.equal(destroyedListeners(observer), 0);
  observer.destroyed = false;
  call(runtime, ADD, observer);
  assert.equal(destroyedListeners(observer), 1);
  assert.equal(runtime.api.browserAction.observers.size, 1);
});

test('what the library does with its observers is unchanged: the toolbar update reaches an observer and stops reaching it after removeObserver', async () => {
  const runtime = realRuntime(), engine = runtime.api.browserAction, observer = windowOf();
  installObserverFix(runtime);
  call(runtime, ADD, observer);
  engine.onUpdate(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observer.sent, ['browserAction.update']);
  call(runtime, REMOVE, observer);
  engine.onUpdate(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observer.sent, ['browserAction.update'], 'nothing more');
});

test('only a frame is an observer (a service worker\'s call is ignored, as in the library), and the handlers keep the library\'s options (callable from another session, from a page that is no extension)', () => {
  const runtime = realRuntime(), observer = windowOf(), handlers = runtime.ctx.router.handlers;
  const before = {add: {...handlers.get(ADD)}, remove: {...handlers.get(REMOVE)}};
  installObserverFix(runtime);
  call(runtime, ADD, observer, 'service-worker'); call(runtime, REMOVE, observer, 'service-worker');
  assert.equal(runtime.api.browserAction.observers.size, 0);
  assert.equal(destroyedListeners(observer), 0);
  for (const [name, key] of [[ADD, 'add'], [REMOVE, 'remove']]) {
    const now = handlers.get(name);
    assert.deepEqual([now.allowRemote, now.extensionContext, now.permission], [before[key].allowRemote, before[key].extensionContext, before[key].permission], name);
    assert.notEqual(now.callback, before[key].callback, `${name} is the replacement`);
  }
  assert.deepEqual([handlers.get(ADD).allowRemote, handlers.get(ADD).extensionContext], [true, false]);
});

test('installing twice replaces once: the second call is a no-op that says it is in place', () => {
  const runtime = realRuntime(), handlers = runtime.ctx.router.handlers;
  assert.equal(installObserverFix(runtime), true);
  const callback = handlers.get(ADD).callback;
  assert.equal(installObserverFix(runtime), true);
  assert.equal(handlers.get(ADD).callback, callback);
  const observer = windowOf();
  call(runtime, ADD, observer); call(runtime, REMOVE, observer);
  assert.equal(destroyedListeners(observer), 0);
});

test('a library that is not shaped as expected is left as it is, the call says so and nothing throws (and the trace says it)', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'acira-observers-')), file = path.join(dir, 'extension-windows.log');
  const trace = require('../desktop/browser-services/ext-trace.cjs');
  trace.setFile(file);
  try {
    assert.equal(installObserverFix(null), false);
    assert.equal(installObserverFix({}), false);
    assert.equal(installObserverFix({api: {browserAction: {observers: new Set(), ctx: {router: {handlers: new Map(), handle() {}}}}}}), false, 'no handlers registered under those names');
    assert.equal(installObserverFix({api: {browserAction: {observers: [], ctx: {router: {handlers: new Map([[ADD, {callback() {}}], [REMOVE, {callback() {}}]]), handle() {}}}}}}), false, 'observers is not a Set');
    assert.match(fs.readFileSync(file, 'utf8'), /toolbar observers: the library is not as expected/);
  } finally { trace.setFile(null); fs.rmSync(dir, {recursive: true, force: true}); }
});

// ---- the product path: the toolbar attaches the session, and the interface's window is watched once ---------------------------------------------------------------------------------

/** extension-toolbar.cjs with the library's static lookup answered from `runtimes` (the real runtimes built above). */
function loadToolbar(runtimes) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron-chrome-extensions') return {ElectronChromeExtensions: {fromSession: session => runtimes.get(session) || null, handleCRXProtocol() {}}, setSessionPartitionResolver() {}};
    return original.call(this, request, ...rest);
  };
  const file = require.resolve('../desktop/browser-services/extension-toolbar.cjs');
  delete require.cache[file];
  try { return require(file); } finally { Module._load = original; }
}
function cycles(runtime, count = 30) {
  const observer = windowOf();
  for (let i = 0; i < count; i++) { call(runtime, ADD, observer); call(runtime, REMOVE, observer); }
  return destroyedListeners(observer);
}

test('an ordinary profile attached by the toolbar (profileTarget): 30 observer cycles of the interface leave no "destroyed" listener; before it is attached they do (the real library runtime)', () => {
  const runtime = realRuntime(), session = {name: 'profile session'};
  const {createExtensionToolbar} = loadToolbar(new Map([[session, runtime]]));
  const manager = {list: () => ({extensions: []})};
  const toolbar = createExtensionToolbar({getContext: () => null, getProfiles: () => [{id: 'p1', partition: 'persist:p1', private: false}], getSession: () => session, manager});
  assert.equal(cycles(runtime), 30, 'the library alone leaks');
  toolbar.profileTarget('p1');
  assert.equal(cycles(runtime), 0, 'attached by the toolbar: flat');
});

test('a private session attached by the toolbar (privateProfileTarget): the same, flat', () => {
  const runtime = realRuntime(), session = {name: 'private session'};
  const {createExtensionToolbar} = loadToolbar(new Map([[session, runtime]]));
  const given = {supported: true, profileId: 'private-1', partition: 'persist:acira-private-ext-window-1', webContentsId: -1, pinnedIds: [], actionIds: []};
  const manager = {privateProfileTarget: own => (own === session ? given : null), isPrivateSession: own => own === session, list: () => ({extensions: []})};
  const toolbar = createExtensionToolbar({getContext: () => null, getProfiles: () => [], getSession: () => null, manager, getWindow: () => ({id: 5, isDestroyed: () => false})});
  assert.equal(cycles(runtime), 30, 'the library alone leaks');
  assert.deepEqual(toolbar.privateProfileTarget(session), given);
  assert.equal(cycles(runtime), 0, 'attached by the toolbar: flat');
});

// ---- the wiring ---------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the toolbar installs the replacement on every session it attaches: an ordinary profile\'s and a private session\'s', () => {
  const source = fs.readFileSync(path.join(root, 'desktop', 'browser-services', 'extension-toolbar.cjs'), 'utf8');
  assert.match(source, /\{installObserverFix\}=require\('\.\/extension-action-observers\.cjs'\)/);
  const attach = source.slice(source.indexOf('function attach('), source.indexOf('function attachPrivate('));
  const attachPrivate = source.slice(source.indexOf('function attachPrivate('), source.indexOf('function target('));
  assert.ok(/installPopupFrames\(runtime\);[^]*installObserverFix\(runtime\);/.test(attach), 'attach');
  assert.ok(/installPopupFrames\(runtime,\{getWindow\}\);installObserverFix\(runtime\);/.test(attachPrivate), 'attachPrivate');
});
