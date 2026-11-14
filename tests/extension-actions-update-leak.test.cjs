'use strict';
// 13.8, the Windows laptop: the interface printed "MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 -actions-update listeners" five times.
// The toolbar's button list (electron-chrome-extensions' <browser-action-list>) adds a listener for the engine's action updates to the preload's `process` when it is connected and
// removes it when it is disconnected, by calling window.browserAction.addEventListener / removeEventListener with the same function. window.browserAction is a context bridge: a
// function that crosses it is a NEW proxy at every call, so the proxy removed was never the proxy added, nothing was ever removed, and every list that was ever connected (every
// rebuild of the toolbar or the sidebar's extension row: a tab switch, a change of the pinned extensions) stayed as a listener, with the detached list it holds, and ran at every update.
// (Measured in a bare Electron with the library's own preload and context isolation: 12 connects and removes of the element, 12 listeners left; a plain function added and removed
// through the bridge: still there.)
//
// These tests run the library's REAL browser-action code and the toolbar preload the interface ships (extension-toolbar-preload.cjs) in node, against a fake `electron` whose
// context bridge behaves as measured (a new proxy for every function argument of every call, a property that cannot be replaced once exposed, the page's world a separate
// vm context with a small stand-in for the DOM). No Electron is started.
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const Module = require('node:module');
const root = path.join(__dirname, '..');
const preloadPath = path.join(root, 'desktop', 'browser-services', 'extension-toolbar-preload.cjs');
const libraryPath = require.resolve('electron-chrome-extensions/browser-action');
const bridgePath = path.join(root, 'desktop', 'browser-services', 'extension-actions-bridge.cjs');
const EVENT = '-actions-update';

/** What crosses the context bridge: functions become a new function at every call (also the ones passed IN), objects are copied, promises are followed. */
function cross(value) {
  if (typeof value === 'function') return (...args) => cross(value(...args.map(argument => (typeof argument === 'function' ? (...inner) => argument(...inner) : argument))));
  if (value && typeof value.then === 'function') return value.then(cross);
  if (value && typeof value === 'object' && !Array.isArray(value)) { const copy = {}; for (const key of Object.keys(value)) copy[key] = cross(value[key]); return copy; }
  return value;
}

/** The page's world: a vm context with a stand-in for the parts of the DOM the library's elements use, and the elements that are connected. */
function makeWorld({state = {actions: [], activeTabId: 7}} = {}) {
  const world = {state, defined: new Map(), body: [], invoked: [], logged: []};
  const connect = element => { if (!element.isConnected) { element.isConnected = true; if (element.connectedCallback) element.connectedCallback(); } };
  const disconnect = element => { if (element.isConnected) { element.isConnected = false; if (element.disconnectedCallback) element.disconnectedCallback(); } };
  class HTMLElement {
    constructor() { this.attributes = new Map(); this.isConnected = false; this.children = []; }
    setAttribute(name, value) { const old = this.attributes.get(name) ?? null; this.attributes.set(name, String(value)); if (this.constructor.observedAttributes?.includes(name) && old !== String(value) && this.attributeChangedCallback) this.attributeChangedCallback(name, old, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener() {}
    attachShadow() { const owner = this; const shadow = {children: [], append(node) { shadow.children.push(node); }, appendChild(node) { shadow.children.push(node); return node; }, querySelector: () => null, querySelectorAll: () => []}; owner.shadowRoot = shadow; return shadow; }
    append(child) { this.children.push(child); if (this.isRoot) connect(child); }
    remove() { world.body = world.body.filter(element => element !== this); disconnect(this); }
  }
  class HTMLButtonElement extends HTMLElement {}
  const customElements = {define: (name, definition) => world.defined.set(name, definition), whenDefined: () => Promise.resolve(), get: name => world.defined.get(name)};
  const document = {
    createElement(tag, options) { const Definition = world.defined.get(options?.is || tag); return Definition ? new Definition() : Object.assign(new HTMLElement(), {tagName: tag}); },
    body: {append(element) { world.body.push(element); connect(element); }},
  };
  world.context = vm.createContext({HTMLElement, HTMLButtonElement, customElements, document, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, console});
  world.global = vm.runInContext('globalThis', world.context);
  world.document = document;
  /** What the page does: a <browser-action-list> in the page, connected (the interface's component) and later removed. */
  world.connectList = (partition = 'persist:main', tab = 7) => {
    const list = document.createElement('browser-action-list');
    list.setAttribute('partition', partition); list.setAttribute('tab', String(tab));
    list.updates = 0;
    const update = list.update; list.update = value => { list.updates++; return update(value); };   // what a connected list receives
    document.body.append(list);
    return list;
  };
  const exposed = new Set();
  world.electron = {
    contextBridge: {
      exposeInMainWorld(key, api) {
        if (key in world.global || exposed.has(key)) throw new Error(`Cannot bind an API on top of an existing property on the window object: ${key}`);
        exposed.add(key);
        Object.defineProperty(world.global, key, {value: cross(api), enumerable: true, configurable: false, writable: false});
      },
      executeInMainWorld({func, args = []}) { if (world.failMainWorld && world.failMainWorld(func)) throw new Error('executeInMainWorld failed'); vm.runInContext(`(${func})(...${JSON.stringify(args)});`, world.context); },
    },
    webFrame: {executeJavaScript(code) { vm.runInContext(code, world.context); }},
    ipcRenderer: {
      invoke: async (channel, partition, name, ...args) => { world.invoked.push([name, partition, ...args]); return name === 'browserAction.getState' ? JSON.parse(JSON.stringify(world.state)) : undefined; },
      on() {},
    },
  };
  return world;
}

/** Loads a module fresh, with require('electron') answered by the world's fake. */
function loadFresh(file, world, {isolated = true, location = {protocol: 'acira-browser-ui:', hostname: 'ui', pathname: '/index.html'}} = {}) {
  for (const key of Object.keys(require.cache)) if (/electron-chrome-extensions|extension-actions-bridge|extension-toolbar-preload/.test(key)) delete require.cache[key];
  const load = Module._load, hadIsolated = Object.prototype.hasOwnProperty.call(process, 'contextIsolated'), previous = process.contextIsolated, hadLocation = 'location' in globalThis;
  Module._load = function (request, parent, isMain) { return request === 'electron' ? world.electron : load.call(this, request, parent, isMain); };
  process.contextIsolated = isolated; globalThis.location = location;
  try { return require(file); } finally {
    Module._load = load;
    if (hadIsolated) process.contextIsolated = previous; else delete process.contextIsolated;
    if (!hadLocation) delete globalThis.location;
  }
}
const count = () => process.listenerCount(EVENT);
const tick = () => new Promise(resolve => setImmediate(resolve));
function clean() { process.removeAllListeners(EVENT); }
async function withProcessClean(fn) { clean(); const warnings = []; const onWarning = warning => { if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning); }; process.on('warning', onWarning); try { return await fn(warnings); } finally { process.off('warning', onWarning); clean(); } }

// ---- the model: the library alone, through a bridge that behaves as measured ---------------------------------------------------------------------------------------------

test('the model: the library alone behind a bridge that makes a new function of every argument leaves a listener for every list that was connected and removed (12 and 12, as measured)', () => withProcessClean(async () => {
  const world = makeWorld();
  const library = loadFresh(libraryPath, world, {isolated: true});
  process.contextIsolated = true;   // (injectBrowserAction reads it when it runs)
  try { library.injectBrowserAction(); } finally { delete process.contextIsolated; }
  for (let i = 0; i < 12; i++) { const list = world.connectList(); list.remove(); }
  assert.equal(count(), 12, 'one left for each of them');
  const plain = () => {};
  world.global.browserAction.addEventListener('update', plain); world.global.browserAction.removeEventListener('update', plain);
  assert.equal(count(), 13, 'a plain function added and removed with the same function object: still there');
  await tick();   // (the warning for the eleventh listener is emitted on the next turn: it is this test's, not the next one's)
}));

// ---- the toolbar preload the interface ships -------------------------------------------------------------------------------------------------------------------------------

test('a <browser-action-list> that is connected and removed leaves no listener: 40 times in a row, the count is the number of lists that are connected, and there is no warning', () => withProcessClean(async warnings => {
  const world = makeWorld();
  loadFresh(preloadPath, world);
  assert.equal(count(), 0);
  for (let i = 0; i < 40; i++) {
    const list = world.connectList('persist:main', 7 + i);
    assert.equal(count(), 1, `connected, round ${i}`);
    list.remove();
    assert.equal(count(), 0, `removed, round ${i}`);
  }
  const kept = [world.connectList(), world.connectList('persist:other')];
  for (let i = 0; i < 15; i++) world.connectList().remove();
  assert.equal(count(), 2, 'only the two that are still connected');
  kept[0].remove(); kept[1].remove();
  assert.equal(count(), 0);
  await tick();
  assert.deepEqual(warnings.map(String), [], 'no MaxListenersExceededWarning');
}));

test('the interface\'s own listener (BrowserExtensionActions: window.browserAction.addEventListener(\'update\', later), removed when its effect re-runs): 40 rebuilds leave none', () => withProcessClean(async () => {
  const world = makeWorld();
  loadFresh(preloadPath, world);
  const bridge = () => world.global.browserAction;
  for (let i = 0; i < 40; i++) {
    const later = () => {};
    bridge().addEventListener('update', later);
    assert.equal(count(), 1);
    bridge().removeEventListener('update', later);
    assert.equal(count(), 0, `round ${i}`);
  }
}));

test('a toolbar rebuilt the way the interface does it (the list and the component\'s own listener, 25 tab switches) is flat: nothing grows with the number of rebuilds', () => withProcessClean(async warnings => {
  const world = makeWorld();
  loadFresh(preloadPath, world);
  let list, later;
  for (let tab = 1; tab <= 25; tab++) {
    if (list) { world.global.browserAction.removeEventListener('update', later); list.remove(); }
    list = world.connectList('persist:main', tab);
    later = () => {}; world.global.browserAction.addEventListener('update', later);
    assert.equal(count(), 2, `after switch ${tab}`);
    assert.equal(world.global.__aciraBrowserActionBridge.count(), 2, `the bridge's own count, after switch ${tab}`);
  }
  await tick();
  assert.deepEqual(warnings, []);
}));

test('the lists that are connected still receive the engine\'s updates, and one that was removed does not', () => withProcessClean(async () => {
  const world = makeWorld();
  loadFresh(preloadPath, world);
  const first = world.connectList(), second = world.connectList();
  await tick(); first.updates = 0; second.updates = 0;   // (connecting a list reads the state once)
  await world.global.browserAction.getState('persist:main');
  await tick();
  assert.deepEqual([first.updates, second.updates], [1, 1], 'both heard it');
  first.remove();
  await world.global.browserAction.getState('persist:main');
  await tick();
  assert.deepEqual([first.updates, second.updates], [1, 2], 'only the one that is still connected heard the next');
  second.remove();
}));

test('everything else on the bridge is passed through: getState, getAction, activate, and the observers of a partition (one request for the first list, one when the last goes)', () => withProcessClean(async () => {
  const world = makeWorld({state: {actions: [{id: 'abc', tabs: {}}], activeTabId: 3}});
  loadFresh(preloadPath, world);
  const bridge = world.global.browserAction;
  assert.deepEqual(Object.keys(bridge).sort(), ['activate', 'addEventListener', 'addObserver', 'getAction', 'getState', 'removeEventListener', 'removeObserver']);
  assert.equal(typeof world.global.__aciraBrowserActionBridge.listen, 'function');
  assert.equal(world.global.__aciraBrowserActionBridge.count(), 0, 'the private bridge counts the listeners the page has');
  assert.equal('count' in bridge, false, 'and the page\'s own browserAction does not carry it');
  const state = await bridge.getState('persist:main');
  assert.deepEqual(state.actions.map(action => action.id), ['abc']);
  assert.equal(bridge.getAction('abc').id, 'abc');
  await bridge.activate('persist:main', {extensionId: 'abc'});
  assert.ok(world.invoked.some(call => call[0] === 'browserAction.activate'), 'activate reached the engine');
  const names = () => world.invoked.filter(call => /Observer$/.test(call[0])).map(call => call[0]);
  const a = world.connectList(), b = world.connectList();
  assert.deepEqual(names(), ['browserAction.addObserver'], 'one request for the first list of a partition');
  a.remove(); assert.deepEqual(names(), ['browserAction.addObserver']);
  b.remove(); assert.deepEqual(names(), ['browserAction.addObserver', 'browserAction.removeObserver'], 'and one when the last one goes');
}));

test('the same function added twice is one listener, and removing one that was never added changes nothing and does not throw', () => withProcessClean(async () => {
  const world = makeWorld();
  loadFresh(preloadPath, world);
  const bridge = world.global.browserAction, f = () => {};
  bridge.addEventListener('update', f); bridge.addEventListener('update', f);
  assert.equal(count(), 1);
  bridge.removeEventListener('update', () => {}); bridge.removeEventListener('other', f); bridge.addEventListener('update', 'not a function'); bridge.addEventListener('update');
  assert.equal(count(), 1);
  bridge.removeEventListener('update', f); bridge.removeEventListener('update', f);
  assert.equal(count(), 0);
}));

// ---- the cases around it ----------------------------------------------------------------------------------------------------------------------------------------------------

test('an Electron without executeInMainWorld uses webFrame.executeJavaScript for the page\'s script, and is flat too', () => withProcessClean(async () => {
  const world = makeWorld();
  delete world.electron.contextBridge.executeInMainWorld;
  loadFresh(preloadPath, world);
  for (let i = 0; i < 20; i++) world.connectList().remove();
  assert.equal(count(), 0);
}));

test('if the page\'s adapter cannot be put in place the library\'s own bridge is exposed, as it was: the toolbar still works (and the error is written to the console)', () => withProcessClean(async () => {
  const world = makeWorld();
  world.failMainWorld = func => /Object\.defineProperty\(globalThis, 'browserAction'/.test(String(func));
  const logged = []; const error = console.error; console.error = (...args) => logged.push(args.join(' '));
  try { loadFresh(preloadPath, world); } finally { console.error = error; }
  assert.ok(logged.some(line => /listeners that can be removed are not available/.test(line)), logged.join('\n'));
  const list = world.connectList();
  assert.equal(count(), 1, 'the list works');
  await world.global.browserAction.getState('persist:main'); await tick();
  assert.ok(list.updates >= 1, 'and hears the engine');
  list.remove();
}));

test('without context isolation the library is called as it is, and the context bridge is not touched', () => {
  const calls = [];
  const bridge = require(bridgePath);
  const contextBridge = {exposeInMainWorld: (...args) => calls.push(args)};
  const original = contextBridge.exposeInMainWorld;
  const fakeProcess = {contextIsolated: false};
  let injected = 0;
  bridge.injectWithRemovableListeners(() => { injected++; contextBridge.exposeInMainWorld('browserAction', {}); }, {contextBridge, webFrame: {}}, fakeProcess);
  assert.equal(injected, 1);
  assert.equal(contextBridge.exposeInMainWorld, original);
  assert.deepEqual(calls.map(call => call[0]), ['browserAction'], 'exposed as the library asked');
});

test('only the library\'s own "browserAction" is changed while it runs; other keys pass through, and the context bridge is put back afterwards, also when the library throws', () => {
  const bridge = require(bridgePath);
  const exposed = [];
  const contextBridge = {exposeInMainWorld: (...args) => exposed.push(args[0]), executeInMainWorld: () => {}};
  const original = contextBridge.exposeInMainWorld;
  const fakeProcess = Object.assign(new (require('node:events'))(), {contextIsolated: true});
  bridge.injectWithRemovableListeners(() => { contextBridge.exposeInMainWorld('acira', {}); contextBridge.exposeInMainWorld('browserAction', {addEventListener() {}}); }, {contextBridge, webFrame: {}}, fakeProcess);
  assert.deepEqual(exposed, ['acira', bridge.PRIVATE], 'the library\'s bridge goes under the private name; the adapter is the page\'s browserAction');
  assert.equal(contextBridge.exposeInMainWorld, original);
  assert.throws(() => bridge.injectWithRemovableListeners(() => { throw new Error('library failed'); }, {contextBridge, webFrame: {}}, fakeProcess), /library failed/);
  assert.equal(contextBridge.exposeInMainWorld, original, 'put back after a throw');
});

test('the preload does nothing outside the interface page (a website or an extension frame never gets the bridge)', () => withProcessClean(async () => {
  const world = makeWorld();
  loadFresh(preloadPath, world, {location: {protocol: 'https:', hostname: 'example.com', pathname: '/'}});
  assert.equal('browserAction' in world.global, false);
  assert.equal('__aciraBrowserActionBridge' in world.global, false);
}));

test('the sandboxed interface preload is bundled from desktop/ui-preload-entry.cjs: the bridge module is in it (a sandboxed preload cannot require a sibling file at runtime)', async () => {
  const {build} = require('esbuild');
  const result = await build({entryPoints: [path.join(root, 'desktop', 'ui-preload-entry.cjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], write: false, logLevel: 'silent'});
  const text = result.outputFiles[0].text;
  assert.ok(text.includes('__aciraBrowserActionBridge') && text.includes('injectWithRemovableListeners'), 'the bridge is bundled');
  assert.ok(text.includes('-actions-update'), 'and so is the library');
  assert.doesNotMatch(text, /require\(["']\.\/extension-actions-bridge/, 'not left as a require of a sibling file');
});
