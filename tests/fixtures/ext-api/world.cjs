'use strict';
// Runs the patched engine preload (extension-runtime-patch.cjs) in a vm context, the way an extension's service worker or page sees it.
// Used by the ext-api tests (docs/launch/EXTENSION_WORK_PACKAGES.md, "Test pattern").
//   const world = extensionWorld(manifest, {answer: (name, args) => value, packages, grants, native: {storage: …}, browser, worker: true});
//   world.chrome / world.browser / world.calls / world.logged / world.emit(eventName, ...args)
const fs = require('node:fs');
const v8 = require('node:v8');
const vm = require('node:vm');
const {patchPreload} = require('../../../desktop/browser-services/extension-runtime-patch.cjs');

// Node 24.13's V8 (13.6) crashes with SIGSEGV in a mark-compact GC (ClearStaleLeftTrimmedPointerVisitor, reached from a baseline-compiled
// function's stack check) when a test builds many of these contexts: 5 of 8 runs of a 300-world loop, and about 1 run in 25 of
// tests/ext-api-storage.test.cjs, which node:test reports only as "test failed" with signal SIGSEGV. Electron 44's V8 (15.2) runs the same
// loop clean, so the app is not affected. Without the baseline compiler (Sparkplug) the loop never crashes.
v8.setFlagsFromString('--no-sparkplug');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
let engineText = null;

function extensionWorld(manifest, {answer = () => undefined, packages, grants = {}, native = {}, browser, worker = true, id = ID, userGesture = false, globals = {}, incognito = false} = {}) {
  engineText = engineText || fs.readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8');
  const text = patchPreload(engineText, {userScriptsAllowed: [], grants, ...(incognito ? {incognito: true} : {}), ...(packages ? {packages} : {})});
  if (!text) throw new Error('the preload patch no longer matches the pinned engine');
  const calls = [], listeners = new Map(), logged = {log: [], warn: [], error: []};
  const electron = {
    ipcRenderer: {
      invoke: async (channel, extensionId, name, ...args) => { calls.push({channel, extensionId, name, args}); return answer(name, args); },
      send: (channel, ...args) => calls.push({channel, args}),
      addListener: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, []); listeners.get(channel).push(fn); },
      on: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, []); listeners.get(channel).push(fn); },
      once() {}, off() {}, removeListener() {}
    },
    contextBridge: {executeInMainWorld: ({func}) => func()}, webFrame: {}
  };
  const chrome = {runtime: {id, getManifest: () => manifest}, i18n: {getMessage: n => n}, ...native};
  const record = kind => (...args) => logged[kind].push(args.map(value => (value && value.stack ? value.stack : String(value))).join(' '));
  class ServiceWorkerGlobalScope {}
  const context = {
    require: n => { if (n === 'electron') return electron; throw new Error(n); },
    process: {type: worker ? 'service-worker' : 'renderer', contextIsolated: false},
    location: {href: `chrome-extension://${id}/${worker ? 'sw.js' : 'page.html'}`},
    console: {log: record('log'), warn: record('warn'), error: record('error'), debug() {}},
    URL, Promise, queueMicrotask, setTimeout, clearTimeout, JSON, Proxy, Reflect, Symbol, WeakSet, WeakMap, Map, Set,
    crypto: {randomUUID: () => '00000000-0000-4000-8000-000000000000'}, chrome,
    navigator: {userActivation: {get isActive() { return userGesture; }}}
  };
  if (browser) context.browser = browser;
  if (!worker) { context.document = {}; context.window = context; }
  Object.assign(context, globals); // page globals a package uses (navigator.mediaDevices, speechSynthesis, …)
  if (worker) { context.ServiceWorkerGlobalScope = ServiceWorkerGlobalScope; Object.setPrototypeOf(context, ServiceWorkerGlobalScope.prototype); }
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(text, context);
  /** Delivers an event the main process sent with router.sendEvent (api.emit) to every listener in this context. */
  const emit = (name, ...args) => { for (const fn of listeners.get(`crx-${name}`) || []) fn({}, ...args); };
  return {chrome: context.chrome, browser: context.browser, calls, logged, emit, context, text, setGesture: value => { userGesture = value; }};
}

/** A value made inside the vm, as plain data (deepEqual compares prototypes across realms). */
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

module.exports = {extensionWorld, plain, ID};
