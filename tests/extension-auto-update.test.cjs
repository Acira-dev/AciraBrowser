'use strict';
// 13.8: automatic extension updates on Chromium's schedule (desktop/browser-services/extension-auto-update.cjs, a port of
// chrome/browser/extensions/updater/extension_updater.cc and extensions/browser/delayed_install_manager.cc) and the manager's automatic update
// (extension-manager.cjs command(..., {automatic})). No Electron, no network: timers and the package download are fakes.
const {test} = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os'), {createHash} = require('node:crypto');
const auto = require('../desktop/browser-services/extension-auto-update.cjs');
const {createExtensionManager} = require('../desktop/browser-services/extension-manager.cjs');

const ID = 'a'.repeat(32), ID2 = 'b'.repeat(32), ID3 = 'c'.repeat(32);

function clock() {
  const timers = [];
  return {timers, setTimer: (fn, ms) => { const t = {fn, ms, cleared: false}; timers.push(t); return t; }, clearTimer: t => { t.cleared = true; },
    live: () => timers.filter(t => !t.cleared && !t.fired), fire(t) { t.fired = true; return t.fn(); }};
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

test('Chromium\'s schedule: 5 hours by default, clamped to 30 s .. 7 days, jittered by +/- 20%', () => {
  assert.equal(auto.DEFAULT_FREQUENCY_MS, 5 * 3600 * 1000);
  assert.equal(auto.clampFrequency(1), 30 * 1000);
  assert.equal(auto.clampFrequency(99 * 24 * 3600 * 1000), 7 * 24 * 3600 * 1000);
  assert.equal(auto.clampFrequency(NaN), auto.DEFAULT_FREQUENCY_MS);
  assert.equal(auto.nextDelay(auto.DEFAULT_FREQUENCY_MS, () => 0), 0.8 * 5 * 3600 * 1000);
  assert.equal(auto.nextDelay(auto.DEFAULT_FREQUENCY_MS, () => 1), 1.2 * 5 * 3600 * 1000);
  assert.equal(auto.nextDelay(auto.DEFAULT_FREQUENCY_MS, () => 0.5), 5 * 3600 * 1000);
});

test('start(): the first check is posted at once (CheckSoon), the next one is armed with the jittered delay, and each check arms the next (NextCheck)', async () => {
  const c = clock(), calls = [];
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}], update: async t => { calls.push(t.id); return {upToDate: true}; }, random: () => 0.5, setTimer: c.setTimer, clearTimer: c.clearTimer});
  assert.equal(updater.start(), true);
  assert.equal(updater.start(), false, 'once');
  assert.deepEqual(c.timers.map(t => t.ms), [0, 5 * 3600 * 1000]);
  c.fire(c.timers[0]); await flush();
  assert.deepEqual(calls, [ID], 'the first check ran without waiting 5 hours');
  c.fire(c.timers[1]); await flush();
  assert.deepEqual(calls, [ID, ID]);
  assert.equal(c.timers.length, 3, 'the next check is armed again');
  assert.equal(c.timers[2].ms, 5 * 3600 * 1000);
  updater.stop();
  assert.equal(c.timers[2].cleared, true);
});

test('only Web Store extensions of an ordinary profile that are turned on are checked: never a local folder, never a disabled one, never a private profile', () => {
  const saved = [
    {id: ID, profileId: 'p', source: 'Chrome Web Store', enabled: true},
    {id: ID2, profileId: 'p', source: 'Local folder', enabled: true},
    {id: ID3, profileId: 'p', source: 'Chrome Web Store', enabled: false},
    {id: 'd'.repeat(32), profileId: 'private-1', source: 'Chrome Web Store', enabled: true},
    {id: 'not an id', profileId: 'p', source: 'Chrome Web Store'}
  ];
  assert.deepEqual(auto.updatableEntries(saved, profileId => profileId === 'p').map(e => e.id), [ID]);
});

test('a pass checks one extension at a time; a failure does not stop the rest; two passes never overlap', async () => {
  const c = clock(), order = [], logs = [];
  let release;
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}, {profileId: 'p', id: ID2}, {profileId: 'p', id: ID3}],
    update: async t => { order.push('start ' + t.id[0]); if (t.id === ID) { await new Promise(resolve => { release = resolve; }); throw new Error('network down'); } order.push('end ' + t.id[0]); return {upToDate: true}; },
    log: text => logs.push(text), setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  const first = updater.checkNow(), second = updater.checkNow();
  assert.equal(first, second, 'the pass already running is the one asked for');
  await flush();
  assert.deepEqual(order, ['start a'], 'the next waits for the one before');
  release(); await first;
  assert.deepEqual(order, ['start a', 'start b', 'end b', 'start c', 'end c']);
  assert.match(logs[0], /automatic update failed: network down/);
});

test('an update held because the extension is in use is tried again in 5 minutes, for that extension only, and logged once', async () => {
  const c = clock(), logs = [], calls = [];
  let busy = true;
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}, {profileId: 'p', id: ID2}],
    update: async t => { calls.push(t.id[0]); return t.id === ID && busy ? {delayed: true, version: '2.0'} : {upToDate: true}; },
    log: text => logs.push(text), setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  await updater.checkNow();
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(updater.pendingRetries(), 1);
  const retry = c.live().find(t => t.ms === auto.RETRY_MS);
  assert.ok(retry, 'a retry in 5 minutes');
  assert.match(logs[0], /in use; it will be installed when it is idle or at the next start/);
  busy = false;
  c.fire(retry); await flush();
  assert.deepEqual(calls, ['a', 'b', 'a'], 'only the held one');
  assert.equal(updater.pendingRetries(), 0);
});

test('an update that asks for new access is not applied, and the log says so once per version, not every pass', async () => {
  const c = clock(), logs = [];
  const updater = auto.createAutoUpdater({targets: () => [{profileId: 'p', id: ID}], update: async () => ({skipped: 'permissions', version: '3.0', added: ['tabs', 'https://*/*']}), log: text => logs.push(text), setTimer: c.setTimer, clearTimer: c.clearTimer});
  updater.start();
  await updater.checkNow(); await updater.checkNow(); await updater.checkNow();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /asks for new access \(tabs, https:\/\/\*\/\*\)/);
  assert.match(logs[0], /Check for update/);
});

// ------------------------------------------------------------------------------------------------ the manager

function fixture({version = '1.0', permissions = ['storage'], granted = ['storage'], enabled = true, source = 'Chrome Web Store', packageHash = 'old', busy = false, shown = {version: '2.0', permissions: ['storage']}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-auto-')), registryPath = path.join(dir, 'extensions.json');
  const root = path.join(dir, 'extension-packages', createHash('sha256').update('p').digest('hex').slice(0, 8), ID, 'v1');
  fs.mkdirSync(root, {recursive: true});
  const manifest = {manifest_version: 3, name: 'Ext', version, permissions};
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(registryPath, JSON.stringify({version: 2, entries: [{id: ID, profileId: 'p', path: root, name: 'Ext', version, permissions: granted, enabled, pinned: false, source, packageHash}]}));
  let loaded = enabled ? [{id: ID, name: 'Ext', version, manifest}] : [];
  const api = {getAllExtensions: () => loaded, loadExtension: async folder => { const m = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); loaded = [{id: ID, name: m.name, version: m.version, manifest: m}]; return loaded[0]; },
    removeExtension: id => { loaded = loaded.filter(e => e.id !== id); }};
  const session = {extensions: api, serviceWorkers: {getAllRunning: () => ({})}};
  const prompts = [], downloads = [];
  const downloadPackage = async (id, folder) => { downloads.push(id); fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Ext', ...shown})); return {path: folder, source: 'Chrome Web Store', sourceURL: 'https://clients2.google.com/', packageHash: 'new', publisherVerified: true}; };
  const manager = createExtensionManager({getSession: () => session, getProfiles: () => [{id: 'p', name: 'Personal', partition: 'persist:p'}], getWindow: () => null,
    dialog: {showMessageBox: async o => { prompts.push(o); return {response: 1}; }}, registryPath, createRuntime: () => ({}), downloadPackage, isBusy: () => busy, autoUpdate: {enabled: false}});
  const saved = () => JSON.parse(fs.readFileSync(registryPath, 'utf8')).entries[0];
  return {dir, manager, prompts, downloads, saved, loaded: () => loaded, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const update = (f, automatic = true) => f.manager.command({type: 'update', profileId: 'p', extensionId: ID}, {automatic});

test('manager, automatic: a new version with the access already granted is installed without asking anyone', async () => {
  const f = fixture();
  try {
    const result = await update(f);
    assert.equal(result.error, undefined);
    assert.deepEqual(f.prompts, [], 'no prompt');
    assert.equal(f.saved().version, '2.0');
    assert.equal(f.saved().packageHash, 'new');
    assert.equal(f.loaded()[0].version, '2.0');
  } finally { f.cleanup(); }
});

test('manager, automatic: an update that asks for new access is NOT applied; the running version stays and nothing is asked', async () => {
  const f = fixture({shown: {version: '2.0', permissions: ['storage', 'tabs'], host_permissions: ['https://*/*']}});
  try {
    const result = await update(f);
    assert.equal(result.skipped, 'permissions');
    assert.deepEqual(result.added.sort(), ['https://*/*', 'tabs']);
    assert.equal(f.saved().version, '1.0');
    assert.equal(f.loaded()[0].version, '1.0');
    assert.deepEqual(f.prompts, []);
    // the manual row still asks, as before
    const manual = await update(f, false);
    assert.equal(f.prompts.length, 1, 'Check for update asks');
    assert.equal(manual.error, undefined);
    assert.equal(f.saved().version, '2.0', 'and installs it once approved');
  } finally { f.cleanup(); }
});

test('manager, automatic: an extension with a page open is not replaced under the person: held, nothing changes, the downloaded copy is removed', async () => {
  const f = fixture({busy: true});
  try {
    const result = await update(f);
    assert.equal(result.delayed, true);
    assert.equal(result.version, '2.0');
    assert.equal(f.saved().version, '1.0');
    assert.equal(f.loaded()[0].version, '1.0');
    const packages = path.join(f.dir, 'extension-packages');
    const left = []; const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { if (e.isDirectory()) walk(path.join(d, e.name)); else left.push(path.join(d, e.name)); } }; walk(packages);
    assert.equal(left.filter(file => !file.includes(path.sep + 'v1' + path.sep)).length, 0, 'no half-installed folder is left behind');
  } finally { f.cleanup(); }
});

test('manager, automatic: never a turned-off extension (an update must not turn it on), never one whose granted access was not recorded, never a local folder', async () => {
  const off = fixture({enabled: false});
  try { const r = await update(off); assert.match(r.skipped, /turned off/); assert.equal(off.downloads.length, 0, 'nothing is even downloaded'); assert.equal(off.saved().enabled, false); } finally { off.cleanup(); }
  const unknown = fixture({granted: null});
  try { const r = await update(unknown); assert.match(r.skipped, /not recorded/); assert.equal(unknown.downloads.length, 0); } finally { unknown.cleanup(); }
  const local = fixture({source: 'Local folder'});
  try { const r = await update(local); assert.match(r.error, /Local folders update through Reload/); assert.equal(local.downloads.length, 0); } finally { local.cleanup(); }
});

test('manager: the same package (nothing new) is "up to date" and changes nothing; the updater is off in a test run and when switched off, and starts when asked', async () => {
  const f = fixture({shown: {version: '1.0', permissions: ['storage']}});
  try {
    const same = await f.manager.command({type: 'update', profileId: 'p', extensionId: ID}, {automatic: true});
    assert.equal(typeof same.skipped, 'undefined');
    assert.equal(f.manager.startAutoUpdate(), null, 'autoUpdate.enabled is false');
  } finally { f.cleanup(); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-auto-')), registryPath = path.join(dir, 'extensions.json');
  fs.writeFileSync(registryPath, JSON.stringify({version: 2, entries: []}));
  const previous = process.env.ACIRA_BROWSER_TEST_DATA;
  try {
    const base = {getSession: () => ({extensions: {}}), getProfiles: () => [], getWindow: () => null, dialog: {}, registryPath, createRuntime: () => ({})};
    process.env.ACIRA_BROWSER_TEST_DATA = '/tmp/x';
    assert.equal(createExtensionManager(base).startAutoUpdate(), null, 'a rig never reaches the Web Store by itself');
    delete process.env.ACIRA_BROWSER_TEST_DATA;
    const c = clock();
    const manager = createExtensionManager({...base, autoUpdate: {enabled: true, options: {setTimer: c.setTimer, clearTimer: c.clearTimer, random: () => 0.5}}});
    const updater = manager.startAutoUpdate();
    assert.ok(updater && updater.started);
    assert.deepEqual(c.timers.map(t => t.ms), [0, 5 * 3600 * 1000]);
    assert.equal(manager.startAutoUpdate(), updater, 'once');
    manager.stopAutoUpdate();
  } finally { if (previous === undefined) delete process.env.ACIRA_BROWSER_TEST_DATA; else process.env.ACIRA_BROWSER_TEST_DATA = previous; fs.rmSync(dir, {recursive: true, force: true}); }
});

test('restore() starts the updater once the extensions are back', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'extension-manager.cjs'), 'utf8');
  assert.match(source, /await sweepUnregisteredPackages\(\)\.catch\(\(\)=>\{\}\);startAutoUpdate\(\);\}/);
  assert.match(source, /wc\.getType\(\)!=='backgroundPage'/, 'a background page is not a page in use');
});
