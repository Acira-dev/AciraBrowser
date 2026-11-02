'use strict';
// Chromium's calling conventions for every extension API call (extension-api-signature.cjs, extension-runtime-patch.cjs):
// runtime.lastError during callbacks and "Unchecked runtime.lastError" when it is not read (api_last_error.cc), promise calls reject
// instead (api_request_handler.cc), event rules (event_emitter.cc), typed objects (storage areas, ChromeSetting), and the engine's calls:
// an error from the main process is no longer swallowed, and the engine no longer logs every call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sig = require('../desktop/browser-services/extension-api-signature.cjs');
const {patchPreload} = require('../desktop/browser-services/extension-runtime-patch.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function chromeWithConsole() {
  const logged = [];
  const chrome = {runtime: {id: ID}, extension: {}};
  const withLastError = sig.createLastError(() => chrome, () => ({error: message => logged.push(message)}));
  const bindings = sig.createBindings(name => sig.surface().namespaces[name], {withLastError, console: {error: message => logged.push(message)}});
  return {chrome, logged, withLastError, bindings};
}

test('runtime.lastError is set only during the callback, mirrored on extension.lastError, and an unread one is reported', () => {
  const {chrome, logged, withLastError} = chromeWithConsole();
  let seen;
  withLastError('No tab with id: 5.', () => { seen = chrome.runtime.lastError; assert.equal(chrome.extension.lastError.message, 'No tab with id: 5.'); });
  assert.deepEqual(seen, {message: 'No tab with id: 5.'});
  assert.equal(chrome.runtime.lastError, undefined, 'cleared after the callback');
  assert.equal(chrome.extension.lastError, undefined);
  assert.deepEqual(logged, [], 'read, so not reported');
  withLastError('The message port closed before a response was received.', () => {});
  assert.deepEqual(logged, ['Unchecked runtime.lastError: The message port closed before a response was received.']);
  withLastError(undefined, () => assert.equal(chrome.runtime.lastError, undefined));
  assert.equal(logged.length, 1, 'no error, no report');
  assert.equal(withLastError('x', () => { void chrome.runtime.lastError; return 7; }), 7, 'the callback result passes through');
});

test('buildNamespace: promise form resolves or rejects; callback form gets the value, or lastError with no arguments', async () => {
  const {chrome, logged, bindings} = chromeWithConsole();
  const alarms = bindings.buildNamespace('alarms', {functions: {get: async name => (name === 'a' ? {name: 'a'} : Promise.reject(new Error('No alarm.')))}});
  assert.deepEqual(await alarms.get('a'), {name: 'a'});
  await assert.rejects(alarms.get('b'), error => error instanceof Error && error.message === 'No alarm.');
  const seen = await new Promise(resolve => assert.equal(alarms.get('a', (...args) => resolve(args)), undefined, 'callback form returns undefined'));
  assert.deepEqual(seen, [{name: 'a'}]);
  const failed = await new Promise(resolve => alarms.get('b', (...args) => resolve({args, error: chrome.runtime.lastError})));
  assert.deepEqual(failed, {args: [], error: {message: 'No alarm.'}});
  await new Promise(resolve => alarms.get('b', () => resolve()));
  await tick();
  assert.deepEqual(logged, ['Unchecked runtime.lastError: No alarm.'], 'the second callback did not read lastError');
  // Unimplemented members answer like Chromium's dispatcher.
  await assert.rejects(alarms.clearAll(), {message: 'Access to extension API denied.'});
  // Arguments are checked synchronously, before anything runs.
  assert.throws(() => alarms.get(5), {name: 'TypeError', message: 'Error in invocation of alarms.get(optional string name, optional function callback): No matching signature.'});
});

test('functions with a synchronous result and a callback, and callbacks with several arguments', async () => {
  const {bindings} = chromeWithConsole();
  const menus = bindings.buildNamespace('contextMenus', {functions: {create: props => bindings.later(props.id || 'generated', Promise.resolve())}});
  let called = false;
  assert.equal(menus.create({id: 'x', title: 'X'}, () => { called = true; }), 'x');
  await tick();
  assert.equal(called, true);
  assert.equal(menus.create({title: 'Y'}), 'generated', 'callback-only function without a callback still returns its value');
  const capture = bindings.buildNamespace('desktopCapture', {functions: {chooseDesktopMedia: () => bindings.later(3, Promise.resolve(bindings.callbackArgs('stream-1', {canRequestAudioTrack: false})))}});
  const args = await new Promise(resolve => assert.equal(capture.chooseDesktopMedia(['screen'], (...values) => resolve(values)), 3));
  assert.deepEqual(args, ['stream-1', {canRequestAudioTrack: false}]);
  assert.throws(() => capture.chooseDesktopMedia(['screen']), /No matching signature/, 'its callback is required');
});

test("events follow Chromium's rules (event_emitter.cc)", () => {
  const added = [];
  const event = sig.createEvent('tabs.onUpdated', {add: listener => added.push(listener)});
  const listener = () => {};
  event.addListener();
  event.addListener('not a function');
  assert.equal(event.hasListeners(), false, 'no function: nothing happens, no error');
  event.addListener(listener); event.addListener(listener);
  assert.equal(added.length, 1, 'a listener is added once');
  assert.equal(event.hasListener(listener), true);
  assert.throws(() => event.addListener(() => {}, {}), {name: 'TypeError', message: 'This event does not support filters'});
  const filtered = sig.createEvent('webNavigation.onCommitted', {supportsFilters: true});
  filtered.addListener(() => {}, {url: [{hostSuffix: 'example.com'}]});
  assert.throws(() => filtered.addListener(() => {}, 5), {message: 'Invalid invocation'});
  const calls = [];
  const {logged, bindings} = chromeWithConsole();
  const reported = bindings.createEvent('tabs.onRemoved');
  reported.addListener(() => { throw new Error('one listener fails'); });
  reported.addListener(() => calls.push('other'));
  reported.dispatch(4, {});
  assert.deepEqual(calls, ['other'], 'a failing listener does not stop the others');
  assert.match(logged[0], /^Error in event handler: Error: one listener fails/);
  event.removeListener(listener);
  assert.equal(event.hasListener(listener), false);
  assert.ok(!Object.keys(event).includes('dispatch'), 'dispatch is not part of the public surface');
  const ns = sig.buildNamespace('webNavigation');
  assert.doesNotThrow(() => ns.onCompleted.addListener(() => {}, {url: [{schemes: ['https']}]}), 'schema filters are allowed');
});

test('typed objects: storage areas and ChromeSettings, with their constants and Chromium labels', async () => {
  const storage = sig.buildNamespace('storage', {objects: {sync: {functions: {get: async () => ({theme: 'dark'})}}}});
  assert.equal(storage.sync.QUOTA_BYTES, 102400);
  assert.equal(storage.sync.MAX_ITEMS, 512);
  assert.equal(storage.local.QUOTA_BYTES, 10485760);
  assert.deepEqual(await storage.sync.get(null), {theme: 'dark'});
  assert.throws(() => storage.sync.get(5), {message: /^Error in invocation of storage\.get\(optional \[string\|array\|object\] keys, optional function callback\): /});
  await assert.rejects(storage.local.get('x'), {message: 'Access to extension API denied.'});
  assert.equal(typeof storage.sync.onChanged.addListener, 'function');
  const privacy = sig.buildNamespace('privacy');
  assert.throws(() => privacy.network.webRTCIPHandlingPolicy.get(5), {message: /^Error in invocation of types\.ChromeSetting\.get\(object details, optional function callback\)/});
  await assert.rejects(privacy.network.webRTCIPHandlingPolicy.get({}), {message: 'Access to extension API denied.'});
  assert.equal(privacy.IPHandlingPolicy.DISABLE_NON_PROXIED_UDP, 'disable_non_proxied_udp');
  const settings = sig.buildNamespace('contentSettings');
  assert.throws(() => settings.cookies.get({}), /contentSettings\.ContentSetting\.get.*Missing required property 'primaryUrl'/);
});

test('guardLegacy: Chromium checks first, then the existing implementation with exactly the arguments it was given', () => {
  const calls = [];
  const original = (...args) => { calls.push(args); return 'engine answer'; };
  const fn = sig.surface().namespaces.tabs.functions.query;
  const guarded = sig.guardLegacy('tabs.query', fn, original);
  const cb = () => {};
  assert.equal(guarded({active: true}, cb), 'engine answer');
  assert.deepEqual(calls, [[{active: true}, cb]]);
  assert.throws(() => guarded({bogus: 1}), {message: "Error in invocation of tabs.query(object queryInfo, optional function callback): Error at parameter 'queryInfo': Unexpected property: 'bogus'."});
  assert.throws(() => guarded({}, cb, 'extra'), /No matching signature/);
  assert.equal(calls.length, 1, 'a rejected call never reaches the implementation');
  assert.equal(sig.guardLegacy('tabs.query', fn, guarded), guarded, 'already checked');
  assert.equal(sig.guardLegacy('tabs.query', fn, Math.max), Math.max, "Chromium's own functions are left alone");
});

function engineWorld(manifest, answer) {
  const text = patchPreload(fs.readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8'), {userScriptsAllowed: []});
  assert.ok(text, 'the patch matches the pinned engine');
  const logged = {log: [], error: [], warn: []};
  const electron = {ipcRenderer: {invoke: async (channel, extensionId, name, ...args) => answer(name, args), send() {}, addListener() {}, on() {}, once() {}, off() {}, removeListener() {}},
    contextBridge: {executeInMainWorld: ({func}) => func()}, webFrame: {}};
  const chrome = {runtime: {id: ID, getManifest: () => manifest}, i18n: {getMessage: n => n}};
  const record = kind => (...args) => logged[kind].push(args.map(String).join(' '));
  const context = {require: n => { if (n === 'electron') return electron; throw new Error(n); }, process: {type: 'service-worker', contextIsolated: false},
    location: {href: `chrome-extension://${ID}/sw.js`}, console: {log: record('log'), warn: record('warn'), error: record('error'), debug() {}}, URL, Promise, queueMicrotask,
    crypto: {randomUUID: () => '00000000-0000-4000-8000-000000000000'}, chrome};
  context.globalThis = context; vm.createContext(context); vm.runInContext(text, context);
  return {chrome: context.chrome, logged};
}

test("the engine's calls: a main-process error rejects or sets lastError (it was swallowed), values arrive as before, nothing is logged", async () => {
  const {chrome, logged} = engineWorld({manifest_version: 3, permissions: ['tabs']}, name => {
    if (name === 'tabs.get') throw new Error("Error invoking remote method 'crx-msg': Error: No tab with id: 5.");
    if (name === 'windows.getAll') return [{id: 1}];
    return undefined;
  });
  await assert.rejects(chrome.tabs.get(5), error => error.message === 'No tab with id: 5.');
  const failed = await new Promise(resolve => assert.equal(chrome.tabs.get(5, (...args) => resolve({args, error: chrome.runtime.lastError && chrome.runtime.lastError.message})), undefined));
  assert.deepEqual(failed, {args: [], error: 'No tab with id: 5.'});
  assert.equal(chrome.runtime.lastError, undefined);
  await new Promise(resolve => chrome.tabs.get(5, () => resolve()));
  await tick();
  assert.ok(logged.error.includes('Unchecked runtime.lastError: No tab with id: 5.'), logged.error.join('\n'));
  assert.deepEqual(JSON.parse(JSON.stringify(await chrome.windows.getAll())), [{id: 1}]);
  const viaCallback = await new Promise(resolve => chrome.windows.getAll(value => resolve(value)));
  assert.deepEqual(JSON.parse(JSON.stringify(viaCallback)), [{id: 1}]);
  assert.deepEqual(logged.log, [], 'the engine no longer logs each call and result');
  assert.ok(!logged.error.some(line => /Error invoking remote method/.test(line)), 'no raw IPC error on the console');
});
