'use strict';
// 13.8: the automatic extension updater never holds up or races shutdown (the Windows packaged exit-cleanup check, qa/release-profile-cleanup.mjs, "Native accepted global quit").
// Chromium's updater is a KeyedService destroyed with its browser process (ExtensionUpdater::Stop); its fetchers go with it and nothing starts once shutdown has begun.
// Here: no check starts once a quit has begun or while first-run setup is on screen, what is in flight is aborted when the quit begins (before the exit cleanup, which waits for the
// profile's requests), the download itself stops, there is one updater for the app and it ends with its window. No Electron: timers, the lifecycle, the window and the download are fakes.
const {test} = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os'), Module = require('node:module');
const {EventEmitter} = require('node:events');
const {createHash} = require('node:crypto');
const auto = require('../desktop/browser-services/extension-auto-update.cjs');
const {createExtensionManager} = require('../desktop/browser-services/extension-manager.cjs');
const {createSetupGate} = require('../desktop/browser-services/setup-gate.cjs');

const ID = 'a'.repeat(32);
function clock() {
  const timers = [];
  return {timers, setTimer: (fn, ms) => { const t = {fn, ms, cleared: false}; timers.push(t); return t; }, clearTimer: t => { t.cleared = true; },
    live: () => timers.filter(t => !t.cleared && !t.fired), fire(t) { t.fired = true; return t.fn(); }};
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

// ------------------------------------------------------------------------------------------------ the scheduler

test('a quit that begins aborts the check in flight (its signal), drops the held retries, and says and retries nothing about it', async () => {
  const c = clock(), logs = [];
  let signal = null, release;
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}], update: async (target, options) => { signal = options && options.signal; await new Promise(resolve => { release = resolve; }); return {delayed: true, version: '2.0'}; }, log: text => logs.push(text), setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  const pass = updater.checkNow();
  await flush();
  assert.ok(signal && typeof signal.aborted === 'boolean', 'the update is handed a signal');
  assert.equal(signal.aborted, false);
  updater.interrupt();
  assert.equal(signal.aborted, true, 'the quit aborted what was in flight');
  release(); await pass;
  assert.deepEqual(logs, [], 'an aborted check logs nothing');
  assert.equal(updater.pendingRetries(), 0, 'and is not retried');
  assert.equal(updater.started, true, 'the schedule stays: a quit that is called off resumes at the next tick');
});

test('stop() aborts the check in flight and no further extension of the pass is started', async () => {
  const c = clock(), started = [];
  let signal = null, release;
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}, {profileId: 'p', id: 'b'.repeat(32)}], update: async (target, options) => { started.push(target.id[0]); signal = options && options.signal; await new Promise(resolve => { release = resolve; }); return {upToDate: true}; }, setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  const pass = updater.checkNow();
  await flush();
  updater.stop();
  assert.equal(signal.aborted, true);
  release(); await pass;
  assert.deepEqual(started, ['a'], 'the second extension never started');
});

test('allowed() is asked before EVERY check: nothing starts while it says no (first check, periodic tick, retry), and the next tick goes on when it says yes', async () => {
  const c = clock(), calls = [];
  let allow = false;
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}], update: async target => { calls.push(target.id); return {delayed: true, version: '2.0'}; }, allowed: () => allow, random: () => 0.5, setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  c.fire(c.timers[0]); await flush();                       // CheckSoon
  assert.deepEqual(calls, [], 'the first check did not start (a quit or the setup says no)');
  assert.deepEqual(await updater.checkNow(), [], 'checkNow() starts nothing either');
  c.fire(c.timers[1]); await flush();                       // the periodic tick
  assert.deepEqual(calls, []);
  allow = true;
  const next = c.live().find(t => t.ms === 5 * 3600 * 1000);
  c.fire(next); await flush();
  assert.deepEqual(calls, [ID], 'the next tick goes on once it is allowed');
  allow = false;
  const retry = c.live().find(t => t.ms === auto.RETRY_MS);
  assert.ok(retry, 'a held update has its retry');
  c.fire(retry); await flush();
  assert.deepEqual(calls, [ID], 'the retry does not start while it is not allowed');
});

test('start({soon: false}) arms only the delayed check (a hand-over does not fetch the moment a window closes)', () => {
  const c = clock();
  const updater = auto.createAutoUpdater({targets: () => [], update: async () => ({upToDate: true}), random: () => 0.5, setTimer: c.setTimer, clearTimer: c.clearTimer});
  assert.equal(updater.start({soon: false}), true);
  assert.deepEqual(c.timers.map(t => t.ms), [5 * 3600 * 1000]);
});

test('a window that is gone ends its updater at the next tick, and the owner is told', async () => {
  const c = clock(), calls = [];
  let alive = true, stopped = 0;
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}], update: async target => { calls.push(target.id); return {upToDate: true}; }, alive: () => alive, onStopped: () => { stopped++; }, random: () => 0.5, setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  alive = false;
  c.fire(c.timers[0]); await flush();
  assert.deepEqual(calls, [], 'no check for a window that is gone');
  c.fire(c.timers[1]); await flush();
  assert.equal(stopped, 1);
  assert.equal(updater.started, false);
  assert.equal(c.live().length, 0, 'nothing is left armed');
});

// ------------------------------------------------------------------------------------------------ the download

function withElectron(fake, body) {
  const load = Module._load;
  Module._load = function (request, ...rest) { return request === 'electron' ? fake : load.call(this, request, ...rest); };
  return Promise.resolve().then(body).finally(() => { Module._load = load; });
}
const within = (promise, ms = 400) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('still waiting: the download did not stop')), ms))]);

test('downloadStorePackage: aborting the signal stops the request (request.abort) and rejects at once; an already aborted signal never makes a request', async () => {
  const {downloadStorePackage} = require('../desktop/browser-services/extension-packages.cjs');
  const requests = [];
  const net = {request() { const request = new EventEmitter(); request.aborted = 0; request.abort = () => { request.aborted++; }; request.end = () => {}; request.followRedirect = () => {}; requests.push(request); return request; }};
  await withElectron({net}, async () => {
    const controller = new AbortController();
    const pending = downloadStorePackage(ID, path.join(os.tmpdir(), 'acira-never-written'), {}, {signal: controller.signal});
    assert.equal(requests.length, 1, 'the request was made');
    controller.abort();
    await assert.rejects(within(pending), /download was stopped/);
    assert.equal(requests[0].aborted, 1, 'the request itself was aborted');
    const before = requests.length;
    await assert.rejects(downloadStorePackage(ID, path.join(os.tmpdir(), 'acira-never-written'), {}, {signal: AbortSignal.abort()}), /download was stopped/);
    assert.equal(requests.length, before, 'no request for a signal that is already aborted');
  });
});

// ------------------------------------------------------------------------------------------------ the manager: lifecycle, setup, one updater per app

function fixture({windows = 1, gate = createSetupGate(), hang = true} = {}) {
  let browsing = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-shutdown-')), registryPath = path.join(dir, 'extensions.json');
  const root = path.join(dir, 'extension-packages', createHash('sha256').update('p').digest('hex').slice(0, 8), ID, 'v1');
  fs.mkdirSync(root, {recursive: true});
  const manifest = {manifest_version: 3, name: 'Ext', version: '1.0', permissions: ['storage']};
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(registryPath, JSON.stringify({version: 2, entries: [{id: ID, profileId: 'p', path: root, name: 'Ext', version: '1.0', permissions: ['storage'], enabled: true, pinned: false, source: 'Chrome Web Store', packageHash: 'old'}]}));
  const loaded = [{id: ID, name: 'Ext', version: '1.0', manifest}];
  const api = {getAllExtensions: () => loaded, loadExtension: async () => loaded[0], removeExtension: () => {}};
  const session = {extensions: api, serviceWorkers: {getAllRunning: () => ({})}};
  const downloads = [], signals = [];
  const downloadPackage = (id, folder, _session, options) => {
    downloads.push(id); signals.push(options && options.signal);
    return new Promise((resolve, reject) => {
      const signal = options && options.signal;
      if (signal) signal.addEventListener('abort', () => reject(new Error('The extension download was stopped.')), {once: true});
      if (!hang) { fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Ext', version: '2.0', permissions: ['storage']})); resolve({path: folder, source: 'Chrome Web Store', sourceURL: 'https://clients2.google.com/x', packageHash: 'new', publisherVerified: true}); }
    });
  };
  const events = new EventEmitter(); let now = 1000000, open = true;
  const lifecycle = {now: () => now, windowsOpen: () => open, onQuit(fn) { events.on('quit', fn); return () => events.removeListener('quit', fn); }};
  const c = clock();
  const makeWindow = () => { const window = new EventEmitter(); window.destroyed = false; window.isDestroyed = () => window.destroyed; window.close = () => { window.destroyed = true; window.emit('closed'); }; return window; };
  const wins = Array.from({length: windows}, makeWindow);
  const managers = wins.map(window => createExtensionManager({getSession: () => session, getProfiles: () => (browsing ? [{id: 'p', name: 'Personal', partition: 'persist:p'}] : []), getWindow: () => window, dialog: {showMessageBox: async () => ({response: 1})}, registryPath, createRuntime: () => ({}), downloadPackage, isBusy: () => false,
    autoUpdate: {enabled: true, gate, lifecycle, options: {setTimer: c.setTimer, clearTimer: c.clearTimer, random: () => 0.5}}}));
  return {managers, wins, c, gate, events, downloads, signals, endBrowsing() { browsing = false; }, quit() { events.emit('quit'); now += 1; }, tick(ms) { now += ms; }, setOpen(value) { open = value; }, saved: () => JSON.parse(fs.readFileSync(registryPath, 'utf8')).entries[0], cleanup: () => { for (const manager of managers) manager.stopAutoUpdate(); fs.rmSync(dir, {recursive: true, force: true}); }};
}

test('manager: a quit that begins aborts the download in flight and installs nothing; no check starts afterwards, not even from a timer that was already armed', async () => {
  const f = fixture();
  try {
    f.managers[0].startAutoUpdate();
    f.c.fire(f.c.timers[0]); await flush();
    assert.equal(f.downloads.length, 1, 'the first check started its download');
    assert.equal(f.signals[0].aborted, false);
    f.quit(); await flush();
    assert.equal(f.signals[0].aborted, true, 'the quit aborted the download before anything else could run');
    assert.equal(f.saved().version, '1.0', 'nothing was installed');
    const next = f.c.live().find(t => t.ms === 5 * 3600 * 1000);
    f.c.fire(next); await flush();
    assert.equal(f.downloads.length, 1, 'no new check once the quit has begun');
    assert.equal(f.c.live().filter(t => t.ms === auto.RETRY_MS).length, 0);
  } finally { f.cleanup(); }
});

test('manager: a quit that was called off (windows still open a minute later) lets the updater go on; one that is still going on does not', async () => {
  const f = fixture();
  try {
    f.managers[0].startAutoUpdate();
    f.c.fire(f.c.timers[0]); await flush();
    f.quit(); await flush();
    f.tick(5000); f.c.fire(f.c.live().find(t => t.ms === 5 * 3600 * 1000)); await flush();
    assert.equal(f.downloads.length, 1, 'seconds after the quit began: still held');
    f.tick(61000);
    f.c.fire(f.c.live().find(t => t.ms === 5 * 3600 * 1000)); await flush();
    assert.equal(f.downloads.length, 2, 'a minute later with windows open: the quit was called off, the check goes on');
  } finally { f.cleanup(); }
});

test('manager: nothing is checked while first-run setup is on screen; the first check follows the moment it is done', async () => {
  const gate = createSetupGate({open: false});
  const f = fixture({gate});
  try {
    f.managers[0].startAutoUpdate();
    assert.equal(f.c.timers.length, 0, 'no timer, no check while setup is on screen');
    assert.equal(f.downloads.length, 0);
    gate.release();
    assert.deepEqual(f.c.timers.map(t => t.ms).slice(0, 2), [0, 5 * 3600 * 1000]);
    f.c.fire(f.c.timers[0]); await flush();
    assert.equal(f.downloads.length, 1);
  } finally { f.cleanup(); }
});

test('manager: one updater for the app, not one per window; it ends with its window and the next window takes over without fetching at once', async () => {
  const f = fixture({windows: 2});
  try {
    const first = f.managers[0].startAutoUpdate();
    assert.ok(first);
    assert.equal(f.managers[1].startAutoUpdate(), null, 'the second window does not start a second updater');
    f.c.fire(f.c.timers[0]); await flush();
    assert.equal(f.downloads.length, 1);
    const armed = f.c.timers.length;
    f.wins[0].close(); await flush();
    assert.equal(f.signals[0].aborted, true, 'the closed window\'s download in flight was aborted');
    assert.equal(first.started, false);
    const after = f.c.timers.slice(armed);
    assert.deepEqual(after.map(t => t.ms), [5 * 3600 * 1000], 'the other window\'s updater is armed for its jittered time, with no check at once');
    assert.equal(f.downloads.length, 1, 'no fetch the moment a window closes');
  } finally { f.cleanup(); }
});

test('manager: a window that closes during a quit hands nothing over that can start (the quit holds every check)', async () => {
  const f = fixture({windows: 2});
  try {
    f.managers[0].startAutoUpdate();
    f.managers[1].startAutoUpdate();
    f.quit();
    f.wins[0].close(); await flush();
    for (const timer of f.c.live()) { f.c.fire(timer); await flush(); }
    assert.equal(f.downloads.length, 0, 'not one download once the quit began');
  } finally { f.cleanup(); }
});

test('wiring: the manager passes the signal to the store download and checks it after the download; restore() still starts the updater; no change to main.cjs is needed', () => {
  const manager = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'extension-manager.cjs'), 'utf8');
  assert.match(manager, /downloadPackage\(request\.extensionId,packageFolder,session,signal\?\{signal\}:undefined\);if\(signal&&signal\.aborted\)throw/);
  assert.match(manager, /command\(input,\{confirmed=false,automatic=false,signal=null\}/);
  assert.match(manager, /await sweepUnregisteredPackages\(\)\.catch\(\(\)=>\{\}\);startAutoUpdate\(\);/);
  assert.match(manager, /'before-quit'/);
  assert.match(manager, /setup-gate\.cjs/);
});

test('once the exit cleanup has begun (main.cjs getProfiles lists no profile that may browse) a check starts nothing, whatever else is true: a second layer under the quit hold', async () => {
  const f = fixture();
  try {
    f.managers[0].startAutoUpdate();
    f.endBrowsing();                                           // profileCleanup.finish(): exiting = true, mayBrowse(id) is false for every ordinary profile
    f.c.fire(f.c.timers[0]); await flush();                    // the first check
    f.c.fire(f.c.live().find(t => t.ms === 5 * 3600 * 1000)); await flush();   // a periodic tick
    assert.equal(f.downloads.length, 0, 'no request on any profile\'s session between the start of the cleanup and the flush');
  } finally { f.cleanup(); }
});
