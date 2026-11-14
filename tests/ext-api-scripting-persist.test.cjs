'use strict';
// chrome.scripting.registerContentScripts keeps its scripts across restarts (persistAcrossSessions, default true), as in Chromium.
// Chromium: extensions/browser/extension_user_script_loader.cc (DynamicScriptsStorageHelper Get/SetDynamicScripts, AddScriptsForExtensionLoad),
// extensions/browser/state_store.cc (the keys go at install, update and uninstall), extensions/browser/api/scripting/scripting_api.cc
// (persistAcrossSessions defaults to true), chrome/browser/extensions/user_script_listener.cc (no page loads before the scripts are in).
// This Electron has no store for them: after a restart getRegisteredContentScripts() answered [] and DeArrow, SponsorBlock and every extension that
// registers once at install lost their scripts for good (the YouTube extensions sweep, 12 Nov 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
// the module is new in 13.8: on 13.7 it is missing and each test below fails on its own, not the whole file on one require
let persist;
try { persist = require('../desktop/browser-services/ext-api/scripting/persist.cjs'); } catch { persist = {install() { throw new Error('13.7 has no persistent dynamic content scripts'); }, createStore() { throw new Error('13.7 has no persistent dynamic content scripts'); }, whenRestored() { throw new Error('13.7 has no persistent dynamic content scripts'); }, clear() { throw new Error('13.7 has no persistent dynamic content scripts'); }}; }
const {createExtensionManager} = require('../desktop/browser-services/extension-manager.cjs');
const {host, manifestExtension, ID, ID2} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

const SAVED = [
  {id: 'dearrow', matches: ['https://*.youtube.com/*'], js: ['content.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true},
  {id: 'styles', matches: ['https://www.youtube.com/*'], css: ['content.css'], world: 'ISOLATED', persistAcrossSessions: true}
];
const manifestWith = (permissions = ['scripting']) => ({manifest_version: 3, name: 'Reg', version: '1', permissions, host_permissions: ['https://*.youtube.com/*'], background: {service_worker: 'sw.js'}});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-persist-'));

/** A stand-in for chrome.scripting's native members, with Chromium's rules for ids and the defaults getRegisteredContentScripts reports. */
function nativeScripting(initial = [], {rejectIds = []} = {}) {
  const registered = initial.map(script => ({...script}));
  const calls = [];
  const norm = script => ({allFrames: false, matchOriginAsFallback: false, runAt: 'document_idle', world: 'ISOLATED', persistAcrossSessions: true, ...script});
  const api = {
    registerContentScripts: async scripts => {
      calls.push(['register', scripts.map(script => script.id)]);
      for (const script of scripts) {
        if (rejectIds.includes(script.id)) throw new Error(`Could not load file: '${script.js && script.js[0]}'.`);
        if (registered.some(item => item.id === script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
      }
      registered.push(...scripts.map(norm));
    },
    getRegisteredContentScripts: async filter => { calls.push(['get']); return registered.filter(script => !filter || !filter.ids || filter.ids.includes(script.id)).map(script => ({...script})); },
    unregisterContentScripts: async filter => {
      calls.push(['unregister', filter && filter.ids]);
      for (let at = registered.length - 1; at >= 0; at--) if (!filter || !filter.ids || filter.ids.includes(registered[at].id)) registered.splice(at, 1);
    },
    updateContentScripts: async scripts => { calls.push(['update', scripts.map(script => script.id)]); for (const script of scripts) { const at = registered.findIndex(item => item.id === script.id); if (at < 0) throw new Error(`Nonexistent script ID '${script.id}'`); registered[at] = {...registered[at], ...script}; } }
  };
  return {registered, calls, api};
}
const scriptingPackage = () => extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'scripting');
function renderer({saved = SAVED, native = nativeScripting(), worker = true, manifest = manifestWith()} = {}) {
  const asked = [], stored = [];
  const world = extensionWorld(manifest, {packages: scriptingPackage(), worker, native: {scripting: native.api},
    answer: (name, args) => {
      asked.push(name);
      if (name === 'scripting.persist.get') return saved;
      if (name === 'scripting.persist.set') { stored.push(plain(args[0])); return undefined; }
      return undefined;
    }});
  return {world, asked, stored, native};
}

// ------------------------------------------------------------------------------------------------ the extension's own context

test('a service worker that starts after a restart gets the scripts it registered for good back, before its own code asks (getRegisteredContentScripts)', async () => {
  const r = renderer();
  const list = await r.world.chrome.scripting.getRegisteredContentScripts();
  assert.deepEqual(plain(list).map(script => script.id).sort(), ['dearrow', 'styles'], 'on 13.7 this list was empty after every restart');
  assert.deepEqual(r.native.calls.filter(call => call[0] === 'register'), [['register', ['dearrow', 'styles']]], 'put back with the same native call, once');
  assert.ok(r.asked.includes('scripting.persist.get'), 'asked the browser for the saved set');
  assert.ok(r.asked.includes('scripting.persist.restored'), 'told the browser the scripts are in (the extension manager waits for it before the first page)');
  const dearrow = plain(list).find(script => script.id === 'dearrow');
  assert.deepEqual([dearrow.runAt, dearrow.allFrames, dearrow.persistAcrossSessions], ['document_start', true, true]);
});

test('the worker restores at its start even when the extension never calls chrome.scripting (the first page after launch needs the scripts)', async () => {
  const r = renderer();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(r.native.registered.map(script => script.id), ['dearrow', 'styles']);
  assert.ok(r.asked.includes('scripting.persist.restored'));
});

test('nothing is registered twice: scripts already in the engine (a worker that restarts in the same session) are left alone', async () => {
  const r = renderer({native: nativeScripting([{id: 'dearrow', matches: ['https://*.youtube.com/*'], js: ['content.js']}])});
  await r.world.chrome.scripting.getRegisteredContentScripts();
  assert.deepEqual(r.native.calls.filter(call => call[0] === 'register'), [['register', ['styles']]], 'only the missing one');
});

test('a saved script whose file the package no longer has is dropped, the others still come back', async () => {
  const saved = [...SAVED, {id: 'gone', matches: ['https://www.youtube.com/*'], js: ['removed.js'], persistAcrossSessions: true}];
  const r = renderer({saved, native: nativeScripting([], {rejectIds: ['gone']})});
  const list = await r.world.chrome.scripting.getRegisteredContentScripts();
  assert.deepEqual(plain(list).map(script => script.id).sort(), ['dearrow', 'styles']);
});

test('every register, update and unregister hands the whole persistent set to the browser (Chromium: SetDynamicScripts); persistAcrossSessions:false is never kept', async () => {
  const r = renderer({saved: []});
  const {scripting} = r.world.chrome;
  await scripting.registerContentScripts([
    {id: 'keep', matches: ['https://www.youtube.com/*'], js: ['a.js']},
    {id: 'session-only', matches: ['https://www.youtube.com/*'], js: ['b.js'], persistAcrossSessions: false}
  ]);
  assert.deepEqual(r.stored.at(-1).map(script => script.id), ['keep'], 'default is to persist; false is not kept');
  assert.equal(r.stored.at(-1)[0].persistAcrossSessions, true);
  await scripting.updateContentScripts([{id: 'keep', runAt: 'document_start'}]);
  assert.equal(r.stored.at(-1)[0].runAt, 'document_start', 'an update is kept');
  await scripting.unregisterContentScripts({ids: ['keep']});
  assert.deepEqual(r.stored.at(-1), [], 'an unregistered script is gone from the saved set');
  // the callback form of the API behaves the same
  await new Promise(resolve => scripting.registerContentScripts([{id: 'cb', matches: ['https://www.youtube.com/*'], css: ['c.css']}], resolve));
  assert.deepEqual(r.stored.at(-1).map(script => script.id), ['cb']);
  const seen = await new Promise(resolve => scripting.getRegisteredContentScripts(resolve));
  assert.deepEqual(plain(seen).map(script => script.id), ['session-only', 'cb'], 'a script that is not persistent is still registered in this session');
});

test('a call Chromium rejects (a duplicate id) rejects the same way and saves nothing', async () => {
  const r = renderer();
  await r.world.chrome.scripting.getRegisteredContentScripts();
  const before = r.stored.length;
  await assert.rejects(() => r.world.chrome.scripting.registerContentScripts([{id: 'dearrow', matches: ['https://www.youtube.com/*'], js: ['x.js']}]), /Duplicate script ID 'dearrow'/);
  assert.equal(r.stored.length, before);
});

test('a popup or options page registering before the worker ran does not lose the saved scripts: it restores first, then saves the whole set', async () => {
  const r = renderer({worker: false});
  assert.equal(r.asked.includes('scripting.persist.get'), false, 'a page does not restore on its own');
  await r.world.chrome.scripting.registerContentScripts([{id: 'fresh', matches: ['https://www.youtube.com/*'], js: ['f.js']}]);
  assert.deepEqual(r.native.registered.map(script => script.id), ['dearrow', 'styles', 'fresh']);
  assert.deepEqual(r.stored.at(-1).map(script => script.id), ['dearrow', 'styles', 'fresh']);
});

// ------------------------------------------------------------------------------------------------ the main process

test('main: scripts are kept in <profile>/Extension Scripts/<id>.json under "dynamic_scripts" and come back for a new session of the same profile (a restart)', async () => {
  const dir = tmp();
  try {
    const make = () => host({packages: ['scripting'], extensions: [manifestExtension(ID, manifestWith(), 'Reg'), manifestExtension(ID2, manifestWith(), 'Other')], seed: ({session}) => { session.storagePath = dir; }});
    const first = make();
    const dirty = [...SAVED, {id: 'no-matches', js: ['x.js']}, {id: 'bad-world', matches: ['https://a/*'], world: 'PAGE'}, {id: 'dearrow', matches: ['https://dup/*']}, {matches: ['https://a/*']}, 'junk', {id: 'x', matches: ['https://a/*'], persistAcrossSessions: false, evil: {__proto__: 1}}];
    await first.call('scripting.persist.set', null, dirty);
    const file = path.join(dir, 'Extension Scripts', ID + '.json');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(onDisk.dynamic_scripts.map(script => script.id), ['dearrow', 'styles', 'x'], 'invalid and duplicate entries are not kept');
    assert.equal(onDisk.dynamic_scripts.every(script => script.persistAcrossSessions === true && !('evil' in script)), true);
    first.dispose();
    const second = make();   // the app restarted: a new session over the same folder
    assert.deepEqual((await second.call('scripting.persist.get', null)).map(script => script.id), ['dearrow', 'styles', 'x']);
    assert.deepEqual(await second.call('scripting.persist.get', second.ext(ID2)), [], 'another extension has its own set');
    // removed with the extension (Chromium: StateStore::OnExtensionUninstalled)
    second.installed.forget(ID);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(await second.call('scripting.persist.get', null), []);
    second.dispose();
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('main: an empty set removes the file; an update of the extension starts without the old scripts (Chromium: StateStore::OnExtensionWillBeInstalled)', async () => {
  const dir = tmp();
  try {
    const h = host({packages: ['scripting'], seed: ({session}) => { session.storagePath = dir; }});
    await h.call('scripting.persist.set', null, SAVED);
    const file = path.join(dir, 'Extension Scripts', ID + '.json');
    assert.equal(fs.existsSync(file), true);
    await h.call('scripting.persist.set', null, []);
    assert.equal(fs.existsSync(file), false, 'nothing left to keep');
    await h.call('scripting.persist.set', null, SAVED);
    persist.clear(h.session, ID);
    assert.equal(fs.existsSync(file), false, 'cleared by an update');
    assert.deepEqual(await h.call('scripting.persist.get', null), []);
    h.dispose();
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('main: a private session (no folder) keeps the set in memory only and writes nothing', async () => {
  const h = host({packages: ['scripting']});
  assert.equal(h.session.storagePath, undefined);
  await h.call('scripting.persist.set', null, SAVED);
  assert.equal((await h.call('scripting.persist.get', null)).length, 2);
  h.dispose();
});

test('main: the extension\'s worker is started when it loads, and the wait ends when the worker says the scripts are in', async () => {
  const dir = tmp();
  try {
    const events = [], handlers = new Map();
    const session = {storagePath: dir, extensions: {on() {}, removeListener() {}}};
    const api = {session, handle: (name, callback) => handlers.set(name, callback), available: (id, namespace, options) => { events.push(['available', namespace, options.isWorker]); return true; }};
    const store = persist.createStore({session});
    store.save(ID, SAVED);
    const installed = persist.install(api, {startWorker: async scope => { events.push(['start', scope]); setTimeout(() => { events.push(['restored']); handlers.get('scripting.persist.restored')({extension: {id: ID}}); }, 30); }, waitMs: 5000});
    const extension = {id: ID, manifest: manifestWith()};
    const started = Date.now();
    await persist.whenRestored(session, extension);
    assert.ok(Date.now() - started >= 25, 'waited for the worker');
    assert.deepEqual(events.filter(event => event[0] !== 'available'), [['start', `chrome-extension://${ID}/`], ['restored']]);
    await persist.whenRestored(session, extension);   // the same load: nothing more to wait for
    assert.equal(events.filter(event => event[0] === 'start').length, 1, 'one worker start per load');
    // an extension with nothing saved, or without a service worker, is not waited for and no worker is started
    events.length = 0;
    await persist.whenRestored(session, {id: ID2, manifest: manifestWith()});
    await persist.whenRestored(session, {id: ID, manifest: {manifest_version: 3, name: 'x', version: '1'}});
    assert.deepEqual(events.filter(event => event[0] === 'start'), []);
    installed.dispose();
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('main: a worker that never answers does not hold the browser longer than the limit', async () => {
  const dir = tmp();
  try {
    const session = {storagePath: dir, extensions: {on() {}, removeListener() {}}};
    const api = {session, handle() {}, available: () => true};
    persist.createStore({session}).save(ID, SAVED);
    const installed = persist.install(api, {startWorker: async () => { throw new Error('the engine is not ready'); }, waitMs: 120});
    const started = Date.now();
    await persist.whenRestored(session, {id: ID, manifest: manifestWith()});
    const waited = Date.now() - started;
    assert.ok(waited >= 100 && waited < 1000, `waited ${waited} ms`);
    installed.dispose();
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// ------------------------------------------------------------------------------------------------ the extension manager

function managerFixture() {
  const dir = tmp(), registryPath = path.join(dir, 'extensions.json'), pkg = path.join(dir, 'pkg');
  fs.mkdirSync(pkg, {recursive: true});
  const manifest = manifestWith();
  fs.writeFileSync(path.join(pkg, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(registryPath, JSON.stringify({version: 2, entries: [{id: ID, profileId: 'p', path: pkg, name: 'Reg', version: '1', permissions: [...manifest.permissions, ...manifest.host_permissions].sort(), enabled: true, pinned: false, source: 'Local folder'}]}));
  let loaded = [];
  const events = [], handlers = new Map();
  const session = {storagePath: path.join(dir, 'Partitions', 'p'), extensions: {
    getAllExtensions: () => loaded, loadExtension: async () => { events.push('load'); const extension = {id: ID, name: 'Reg', version: '1', manifest}; loaded = [extension]; return extension; },
    removeExtension: () => { loaded = []; }, on() {}, removeListener() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  return {dir, registryPath, session, events, handlers, manifest};
}

test('restore() starts every extension\'s worker without holding the browser; a page that matches a saved script waits for it, any other page does not (UserScriptListener::ShouldDelayRequest)', async () => {
  const f = managerFixture();
  try {
    persist.createStore({session: f.session}).save(ID, SAVED);
    const installed = persist.install({session: f.session, handle: (name, callback) => f.handlers.set(name, callback), available: () => true},
      {startWorker: async () => { f.events.push('worker started'); setTimeout(() => { f.events.push('scripts registered'); f.handlers.get('scripting.persist.restored')({extension: {id: ID}}); }, 60); }, waitMs: 5000});
    const manager = createExtensionManager({getSession: () => f.session, getProfiles: () => [{id: 'p', name: 'Personal', partition: 'persist:p'}], getWindow: () => null,
      dialog: {showMessageBox: async () => ({response: 1})}, registryPath: f.registryPath, createRuntime: () => ({})});
    await manager.restore();
    f.events.push('restore() returned');
    assert.ok(f.events.indexOf('restore() returned') < f.events.indexOf('scripts registered') || !f.events.includes('scripts registered'), 'restore() does not wait for the worker');
    // the page loads: a YouTube address (matches the saved scripts) waits, anything else is not held
    const started = Date.now();
    await persist.holdFor(f.session, 'https://example.org/page');
    assert.ok(Date.now() - started < 30, 'a page that matches nothing starts at once');
    await persist.holdFor(f.session, 'https://www.youtube.com/');
    assert.ok(f.events.includes('scripts registered'), 'a matching page waited until the scripts were in');
    assert.deepEqual(f.events.filter(event => event !== 'restore() returned'), ['load', 'worker started', 'scripts registered']);
    const again = Date.now();
    await persist.holdFor(f.session, 'https://www.youtube.com/watch?v=1');
    assert.ok(Date.now() - again < 30, 'nothing left to wait for after the scripts are in');
    installed.dispose();
  } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
});

test('holdFor follows Chrome match patterns: only an address a saved script matches is held; <all_urls> holds web pages, not Acira pages; no session or no controller never holds', async () => {
  const dir = tmp();
  try {
    const session = {storagePath: dir, extensions: {on() {}, removeListener() {}}};
    const handlers = new Map();
    persist.createStore({session}).save(ID, [{id: 'a', matches: ['*://*.youtube.com/*', 'https://music.example/play/*'], js: ['a.js'], persistAcrossSessions: true}]);
    persist.createStore({session}).save(ID2, [{id: 'b', matches: ['<all_urls>'], js: ['b.js'], persistAcrossSessions: true}]);
    const installed = persist.install({session, handle: (name, callback) => handlers.set(name, callback), available: () => true}, {startWorker: async () => {}, waitMs: 400});
    void persist.whenRestored(session, {id: ID, manifest: manifestWith()});
    const held = async url => { const t = Date.now(); await persist.holdFor(session, url); return Date.now() - t >= 300; };
    assert.equal(await held('https://www.youtube.com/'), true, '*.youtube.com');
    assert.equal(await held('https://music.example/play/1'), false, 'the wait is over (one wait ends for every address it covers)');
    // a second extension with <all_urls>
    void persist.whenRestored(session, {id: ID2, manifest: manifestWith()});
    assert.equal(await held('https://anything.example/'), true, '<all_urls> holds a web page');
    assert.equal(await persist.holdFor(session, 'acira://new'), undefined);
    assert.equal(await persist.holdFor(null, 'https://www.youtube.com/'), undefined);
    assert.equal(await persist.holdFor({}, 'https://www.youtube.com/'), undefined);
    installed.dispose();
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('main.cjs: loadPage waits for the saved scripts before it loads an address, and never in a private window', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const start = source.indexOf('async function loadPage(tab,entry){');
  const end = source.indexOf('// Memory saver: hidden pages freeze', start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  const hold = body.indexOf("await require('./browser-services/ext-api/scripting/persist.cjs').holdFor(wc.session,targetURL)");
  assert.ok(hold > 0, 'loadPage holds the address it is about to load (targetURL)');
  assert.match(body.slice(Math.max(0, hold - 24), hold), /if\(!profile\.private\)/, 'not for a private window');
  assert.ok(hold < body.indexOf('wc.loadURL(') && hold < body.indexOf('navigationHistory.restore'), 'before the page is asked to load, also a restored one');
  assert.ok(hold > body.indexOf('await cookieRestore.attach('), 'after the profile\'s cookies are back, next to the staleness check that follows');
});

test('an update of a store extension clears the scripts it registered; a reload keeps them', async () => {
  const f = managerFixture();
  try {
    const store = persist.createStore({session: f.session});
    const installed = persist.install({session: f.session, handle() {}, available: () => true}, {startWorker: async () => {}, waitMs: 50});
    // a reload (not an update) leaves them
    const registry = JSON.parse(fs.readFileSync(f.registryPath, 'utf8'));
    registry.entries[0].source = 'Chrome Web Store'; registry.entries[0].packageHash = 'old';
    fs.writeFileSync(f.registryPath, JSON.stringify(registry));
    const fresh = path.join(f.dir, 'update');
    const manager = createExtensionManager({getSession: () => f.session, getProfiles: () => [{id: 'p', name: 'Personal', partition: 'persist:p'}], getWindow: () => null,
      dialog: {showMessageBox: async () => ({response: 1})}, registryPath: f.registryPath, createRuntime: () => ({}),
      downloadPackage: async (id, folder) => { fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(f.manifest)); return {path: folder, packageHash: 'new'}; }});
    await manager.restore();
    persist.whenRestored(f.session, {id: ID, manifest: f.manifest});
    store.save(ID, SAVED);
    await manager.command({type: 'reload', profileId: 'p', extensionId: ID});
    assert.equal(persist.createStore({session: f.session}).read(ID).length, 2, 'a reload keeps the registered scripts');
    const result = await manager.command({type: 'update', profileId: 'p', extensionId: ID}, {confirmed: true});
    assert.equal(result.error, undefined);
    assert.equal(persist.createStore({session: f.session}).read(ID).length, 0, 'an update starts without the old scripts');
    installed.dispose();
    void fresh;
  } finally { fs.rmSync(f.dir, {recursive: true, force: true}); }
});
