'use strict';
// chrome.downloads (package P7): Chromium's DownloadItem, search/query semantics and error strings, and the whole path from the real patched
// preload (extension side) through the package (main side) to a fake downloads manager.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');
const items = require('../desktop/browser-services/ext-api/downloads/item.cjs');
const host = require('../desktop/browser-services/ext-api/downloads/host.cjs');
const {createIdStore} = require('../desktop/browser-services/ext-api/downloads/ids.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const T0 = Date.parse('2026-10-28T10:00:00.000Z');
const rec = (n, patch = {}) => ({id: `download-${n}`, browserProfileId: 'profile-personal', name: `file${n}.zip`, path: `C:\\dl\\file${n}.zip`, receivedBytes: 100 * n, totalBytes: 100 * n,
  startedAt: T0 + n * 1000, url: `https://example.com/files/file${n}.zip`, status: 'Ready', size: '', endedAt: T0 + n * 1000 + 500, ...patch});
const itemFor = (record, id, exists = true) => items.toItem(record, id, {exists: () => exists});

// ------------------------------------------------------------------------------------------------ DownloadItem

test('a record becomes Chromium\'s DownloadItem: states, errors, sizes, times, extension attribution', () => {
  const done = itemFor(rec(1, {mime: 'application/zip', finalUrl: 'https://cdn.example.com/a.zip', byExtensionId: ID, byExtensionName: 'Fetcher'}), 7);
  assert.deepEqual(plain(done), {id: 7, url: 'https://example.com/files/file1.zip', finalUrl: 'https://cdn.example.com/a.zip', referrer: '', filename: 'C:\\dl\\file1.zip', incognito: false,
    danger: 'safe', mime: 'application/zip', startTime: '2026-10-28T10:00:01.000Z', endTime: '2026-10-28T10:00:01.500Z', state: 'complete', paused: false, canResume: false,
    bytesReceived: 100, totalBytes: 100, fileSize: 100, exists: true, byExtensionId: ID, byExtensionName: 'Fetcher'});
  const running = itemFor(rec(2, {status: 'Downloading', receivedBytes: 50, totalBytes: 0, endedAt: undefined, eta: 10, updatedAt: T0}), 8);
  const redirected = itemFor(rec(1, {url: 'https://cdn.example.com/b.zip', originalUrl: 'https://example.com/get?b'}), 3);
  assert.deepEqual([redirected.url, redirected.finalUrl], ['https://example.com/get?b', 'https://cdn.example.com/b.zip'], 'url is what was asked for, finalUrl where it ended (the manager keeps the end in url, the start in originalUrl)');
  assert.equal(running.state, 'in_progress');
  assert.equal(running.totalBytes, -1, 'unknown size is -1');
  assert.equal(running.fileSize, -1);
  assert.equal(running.endTime, undefined);
  assert.equal(running.estimatedEndTime, '2026-10-28T10:00:10.000Z');
  assert.equal(running.error, undefined);
  const paused = itemFor(rec(3, {status: 'Paused', canResume: true}), 9);
  assert.deepEqual([paused.state, paused.paused, paused.canResume], ['in_progress', true, true]);
  const cancelled = itemFor(rec(4, {status: 'Cancelled'}), 10);
  assert.deepEqual([cancelled.state, cancelled.error, cancelled.canResume], ['interrupted', 'USER_CANCELED', false]);
  const failed = itemFor(rec(5, {status: 'Interrupted', canResume: true}), 11);
  assert.deepEqual([failed.state, failed.error, failed.canResume], ['interrupted', 'NETWORK_FAILED', true]);
  assert.equal(itemFor(rec(6, {status: 'Interrupted', interruptReason: 'SERVER_FAILED'}), 12).error, 'SERVER_FAILED');
  assert.equal(itemFor(rec(1), 7, false).exists, false, 'a finished file that is gone says exists: false');
  assert.equal(itemFor(rec(2, {status: 'Downloading'}), 8, false).exists, true, 'only a finished file can be gone');
});

test('onChanged deltas: only the fields Chromium reports, previous/current only where there is a value, nothing when nothing changed', () => {
  const before = itemFor(rec(1, {status: 'Downloading', endedAt: undefined, receivedBytes: 10}), 1);
  assert.equal(items.deltaOf(before, itemFor(rec(1, {status: 'Downloading', endedAt: undefined, receivedBytes: 90}), 1)), null, 'bytesReceived alone is no event');
  const after = itemFor(rec(1, {receivedBytes: 100}), 1);
  assert.deepEqual(plain(items.deltaOf(before, after)), {id: 1, endTime: {current: '2026-10-28T10:00:01.500Z'}, state: {previous: 'in_progress', current: 'complete'}});
  const failed = itemFor(rec(1, {status: 'Cancelled'}), 1);
  assert.deepEqual(plain(items.deltaOf(before, failed)).error, {current: 'USER_CANCELED'});
  assert.deepEqual(plain(items.deltaOf(after, itemFor(rec(1), 1, false))), {id: 1, exists: {previous: true, current: false}});
});

// ------------------------------------------------------------------------------------------------ downloads.search

const corpus = () => [
  itemFor(rec(1, {path: 'C:\\dl\\Report.PDF', url: 'https://example.com/a/report.pdf', mime: 'application/pdf'}), 1),
  itemFor(rec(2, {path: 'C:\\dl\\café.txt', url: 'https://other.org/cafe.txt?x=1', status: 'Downloading', endedAt: undefined, totalBytes: 0, receivedBytes: 20}), 2),
  itemFor(rec(3, {path: 'C:\\dl\\movie.mp4', url: 'https://example.com/v/movie.mp4', finalUrl: 'https://cdn.example.net/m/movie.mp4', totalBytes: 5000, receivedBytes: 5000, mime: 'video/mp4'}), 3),
  itemFor(rec(4, {path: 'C:\\dl\\old.zip', url: 'https://example.com/old.zip', status: 'Cancelled', startedAt: T0 - 86400000, endedAt: T0 - 86400000 + 5}), 4)
];
const ids = (list, query) => items.search(list, query).map(item => item.id);

test('search: no query returns everything ordered by id; query terms match filename, url and finalUrl, case and accent insensitively', () => {
  const all = corpus();
  assert.deepEqual(ids(all, {}), [1, 2, 3, 4]);
  assert.deepEqual(ids(all, {query: ['REPORT']}), [1]);
  assert.deepEqual(ids(all, {query: ['cafe']}), [2], 'accents are ignored (café / cafe)');
  assert.deepEqual(ids(all, {query: ['example.com', 'movie']}), [3], 'every positive term must match');
  assert.deepEqual(ids(all, {query: ['cdn.example.net']}), [3], 'finalUrl counts');
  assert.deepEqual(ids(all, {query: ['example.com', '-old', '-report']}), [3], 'terms with a dash must not match');
  assert.deepEqual(ids(all, {query: []}), [1, 2, 3, 4]);
});

test('search: time, size and regex filters, and equality on any item field', () => {
  const all = corpus();
  assert.deepEqual(ids(all, {startedAfter: '2026-10-28T10:00:01.500Z'}), [2, 3]);
  assert.deepEqual(ids(all, {startedBefore: '2026-10-28T10:00:01.500Z'}), [1, 4]);
  assert.deepEqual(ids(all, {endedAfter: '2026-10-28T10:00:02.000Z'}), [3], 'a download that has not ended matches no ended* filter');
  assert.deepEqual(ids(all, {endedBefore: '2026-10-28T10:00:02.000Z'}), [1, 4]);
  assert.deepEqual(ids(all, {totalBytesGreater: 450}), [3]);
  assert.deepEqual(ids(all, {totalBytesGreater: 150}), [3, 4]);
  assert.deepEqual(ids(all, {totalBytesLess: 150}), [1, 2], 'unknown size (-1) is less');
  assert.deepEqual(ids(all, {filenameRegex: '\\.(pdf|mp4)$'}), [3], 'regular expressions are case sensitive, like RE2');
  assert.deepEqual(ids(all, {urlRegex: '^https://example\\.com/'}), [1, 3, 4]);
  assert.deepEqual(ids(all, {finalUrlRegex: 'cdn\\.'}), [3]);
  assert.deepEqual(ids(all, {state: 'in_progress'}), [2]);
  assert.deepEqual(ids(all, {state: 'interrupted', error: 'USER_CANCELED'}), [4]);
  assert.deepEqual(ids(all, {id: 3}), [3]);
  assert.deepEqual(ids(all, {mime: 'video/mp4'}), [3]);
  assert.deepEqual(ids(all, {paused: false, exists: true}), [1, 2, 3, 4]);
  assert.deepEqual(ids(all, {startTime: '2026-10-28T10:00:03.000Z'}), [3], 'time equality compares instants');
  assert.deepEqual(ids(all, {url: 'https://example.com/old.zip'}), [4]);
});

test('search: orderBy (ascending, descending with a dash, several keys), limit (default 1000, 0 = all)', () => {
  const all = corpus();
  assert.deepEqual(ids(all, {orderBy: ['startTime']}), [4, 1, 2, 3]);
  assert.deepEqual(ids(all, {orderBy: ['-startTime']}), [3, 2, 1, 4]);
  assert.deepEqual(ids(all, {orderBy: ['-totalBytes']}), [3, 4, 1, 2], 'biggest first; unknown size (-1) last');
  assert.deepEqual(ids(all, {orderBy: ['paused', '-id']}), [4, 3, 2, 1], 'ties fall back to the next key');
  assert.deepEqual(ids(all, {orderBy: ['state', 'id']}), [2, 1, 3, 4], 'state sorts in_progress, complete, interrupted');
  assert.deepEqual(ids(all, {orderBy: ['endTime']}), [2, 4, 1, 3], 'no end time sorts first');
  assert.deepEqual(ids(all, {orderBy: ['url']}), [1, 4, 3, 2], 'urls compare as text: example.com/a, /old, /v, then other.org');
  assert.deepEqual(ids(all, {limit: 2}), [1, 2]);
  assert.deepEqual(ids(all, {orderBy: ['-startTime'], limit: 1}), [3], 'the limit applies after sorting');
  const many = Array.from({length: 1200}, (_, n) => itemFor(rec(n + 1), n + 1));
  assert.equal(items.search(many, {}).length, 1000, 'default limit');
  assert.equal(items.search(many, {limit: 0}).length, 1200, 'limit 0 returns everything');
});

test('search: Chromium\'s errors for a bad orderBy, limit, time or regular expression', () => {
  const all = corpus();
  assert.throws(() => items.search(all, {orderBy: ['nope']}), {message: 'Invalid orderBy field'});
  assert.throws(() => items.search(all, {orderBy: ['-nope']}), {message: 'Invalid orderBy field'});
  assert.throws(() => items.search(all, {limit: -1}), {message: 'Invalid query limit'});
  assert.throws(() => items.search(all, {startedAfter: 'yesterday-ish'}), {message: 'Invalid query filter'});
  assert.throws(() => items.search(all, {endTime: 'x'}), {message: 'Invalid query filter'});
  assert.throws(() => items.search(all, {filenameRegex: '('}), {message: 'Invalid query filter'});
});

// ------------------------------------------------------------------------------------------------ downloads.download options

test('download options: Chromium\'s checks on url, filename (a safe relative path) and request headers', () => {
  const ok = items.normalizeDownloadOptions({url: 'https://example.com/a b?c=1', filename: 'sub/dir/file.txt', headers: [{name: 'X-Token', value: 'abc'}]});
  assert.deepEqual(plain(ok), {url: 'https://example.com/a%20b?c=1', conflictAction: 'uniquify', saveAs: false, method: 'GET', headers: [{name: 'X-Token', value: 'abc'}], filename: 'sub/dir/file.txt'});
  assert.equal(items.normalizeDownloadOptions({url: 'https://x.test/', conflictAction: 'overwrite', saveAs: true}).saveAs, true);
  for (const url of ['not a url', '', 'ftp://example.com/a', 'javascript:alert(1)', 'file:///C:/x', 'chrome://settings', 'chrome-extension://abc/page.html'])
    assert.throws(() => items.normalizeDownloadOptions({url}), {message: 'Invalid URL'}, url);
  for (const filename of ['', '/abs.txt', '\\abs.txt', 'C:\\x\\a.txt', 'C:a.txt', '../a.txt', 'a/../b', 'a/./b', 'dir/', 'a\\', 'a:b.txt', 'a*b', 'a?b', 'a|b', 'a<b>', 'a"b', 'CON', 'nul.txt', 'a/aux.x', 'name.', 'name ', ' lead', 'x\u0000y', 'x\ny'])
    assert.throws(() => items.normalizeDownloadOptions({url: 'https://x.test/', filename}), {message: 'Invalid filename'}, JSON.stringify(filename));
  for (const filename of ['a.txt', 'dir/sub/a.b.c', 'dir\\a.txt', 'ünï.txt', 'with space.txt', '.hidden'])
    assert.doesNotThrow(() => items.normalizeDownloadOptions({url: 'https://x.test/', filename}), filename);
  const bad = headers => () => items.normalizeDownloadOptions({url: 'https://x.test/', headers});
  assert.throws(bad([{name: 'bad name', value: 'x'}]), {message: 'Invalid request header name'});
  assert.throws(bad([{name: '', value: 'x'}]), {message: 'Invalid request header name'});
  for (const name of ['Cookie', 'host', 'Referer', 'Origin', 'Content-Length', 'Proxy-Authorization', 'Sec-Fetch-Mode', 'Accept-Encoding', 'Connection', 'Date', 'Via'])
    assert.throws(bad([{name, value: 'x'}]), {message: 'Unsafe request header name'}, name);
  assert.throws(bad([{name: 'X-A', value: 'x\r\nSet-Cookie: a=b'}]), {message: 'Invalid request header value'});
  assert.doesNotThrow(bad([{name: 'Authorization', value: 'Bearer t'}, {name: 'Accept', value: '*/*'}, {name: 'Range', value: 'bytes=0-9'}]));
  assert.equal(items.normalizeDownloadOptions({url: 'https://x.test/', method: 'POST', body: 'a=1'}).body, 'a=1');
});

// ------------------------------------------------------------------------------------------------ ids

test('integer ids are stable, unique and survive a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-ids-'));
  try {
    const file = path.join(dir, 'ids.json');
    const store = createIdStore({file});
    const a = store.idFor('download-a'), b = store.idFor('download-b');
    assert.deepEqual([a, b, store.idFor('download-a')], [1, 2, 1]);
    assert.equal(store.recordFor(2), 'download-b');
    store.flush();
    const again = createIdStore({file});
    assert.equal(again.idFor('download-b'), 2, 'same id after a restart');
    assert.equal(again.idFor('download-c'), 3, 'new ids continue');
    again.forget('download-b');
    assert.equal(again.recordFor(2), undefined);
    assert.equal(again.idFor('download-d'), 4, 'an id is never handed out twice');
    again.flush();
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// ------------------------------------------------------------------------------------------------ the whole path

const PROFILE = 'profile-personal';
/** A fake manager the package talks to through the host hook; remembers what it was asked. */
function fakeManager(initial = []) {
  const state = {records: [...initial], started: [], commands: [], erased: [], removed: [], folderOpened: 0};
  const manager = {
    records: profileId => state.records.filter(record => record.browserProfileId === profileId || record.private),
    async start(profileId, session, request) {
      state.started.push({profileId, request});
      if (request.url.includes('refuse')) throw new Error('NETWORK_INVALID_REQUEST');
      const record = rec(state.records.length + 1, {status: 'Downloading', endedAt: undefined, byExtensionId: request.extension.id, byExtensionName: request.extension.name, url: request.url});
      state.records.push(record);
      return record.id;
    },
    async command(profileId, recordId, action) { state.commands.push([profileId, recordId, action]); },
    async erase(profileId, recordIds) { state.erased.push(...recordIds); state.records = state.records.filter(record => !recordIds.includes(record.id)); },
    async removeFile(profileId, recordId) { state.removed.push(recordId); },
    showDefaultFolder() { state.folderOpened++; },
    exists: file => !file.includes('gone')
  };
  return {state, manager};
}

function rig({permissions = ['downloads'], manifest = {}, records = [], worker = true, userData} = {}) {
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-pkg-'));
  const handlers = new Map(), sent = [], listening = new Map();
  const router = {handlers, listeners: listening, handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  const session = {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  const runtime = {ctx: {router}};
  const apis = installExtensionApis(runtime, {session, userData: dir, storeKey: PROFILE, extApiDir: path.join(__dirname, '..', 'desktop', 'browser-services', 'ext-api')});
  const fake = fakeManager(records);
  const disconnect = host.connect(fake.manager);
  const fullManifest = {manifest_version: 3, name: 'Fetcher', permissions, ...manifest};
  const event = {type: worker ? 'service-worker' : 'frame', extension: {id: ID, name: 'Fetcher', manifest: fullManifest}};
  const packages = extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'downloads');
  const world = extensionWorld(fullManifest, {packages, worker, browser: {runtime: {id: ID}},
    answer: (name, args) => { const entry = handlers.get(name); return entry ? entry.callback(event, ...args) : undefined; }});
  return {...fake, world, chrome: world.chrome, sent, listening, handlers, event, apis, dir,
    listen: name => listening.set(name, [{extensionId: ID}]),
    close() { disconnect(); apis.dispose?.(); fs.rmSync(dir, {recursive: true, force: true}); }};
}

test('gating: chrome.downloads needs the "downloads" permission; open needs "downloads.open"', () => {
  const none = rig({permissions: []});
  try { assert.equal(none.chrome.downloads, undefined); } finally { none.close(); }
  const plainRig = rig();
  try {
    assert.equal(typeof plainRig.chrome.downloads.download, 'function');
    assert.equal(typeof plainRig.chrome.downloads.open, 'function', 'open exists with the downloads permission; calling it needs downloads.open');
    assert.equal(plainRig.world.browser.downloads, plainRig.chrome.downloads);
  } finally { plainRig.close(); }
  const opener = rig({permissions: ['downloads', 'downloads.open']});
  try { assert.equal(typeof opener.chrome.downloads.open, 'function'); } finally { opener.close(); }
});

test('downloads.download: starts a download of the manager with the options, answers an integer id, Chromium\'s errors otherwise', async () => {
  const r = rig();
  try {
    const id = await r.chrome.downloads.download({url: 'https://example.com/a.zip', filename: 'docs/a.zip', conflictAction: 'overwrite', saveAs: false, headers: [{name: 'X-Key', value: '1'}]});
    assert.equal(id, 1);
    assert.equal(r.state.started.length, 1);
    assert.deepEqual(plain(r.state.started[0]), {profileId: PROFILE, request: {url: 'https://example.com/a.zip', conflictAction: 'overwrite', saveAs: false, method: 'GET',
      headers: [{name: 'X-Key', value: '1'}], filename: 'docs/a.zip', extension: {id: ID, name: 'Fetcher'}}});
    const found = plain(await r.chrome.downloads.search({id}));
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].byExtensionId, found[0].byExtensionName, found[0].state], [ID, 'Fetcher', 'in_progress']);
    // callback form
    const viaCallback = await new Promise(resolve => r.chrome.downloads.download({url: 'https://example.com/b.zip'}, value => resolve(value)));
    assert.equal(viaCallback, 2);
    await assert.rejects(r.chrome.downloads.download({url: 'nope'}), {message: 'Invalid URL'});
    await assert.rejects(r.chrome.downloads.download({url: 'https://x.test/', filename: '../x'}), {message: 'Invalid filename'});
    await assert.rejects(r.chrome.downloads.download({url: 'https://x.test/', headers: [{name: 'Cookie', value: 'a=b'}]}), {message: 'Unsafe request header name'});
    await assert.rejects(r.chrome.downloads.download({url: 'https://x.test/refuse'}), {message: 'NETWORK_INVALID_REQUEST'}, 'the manager\'s refusal reaches the extension');
    assert.throws(() => r.chrome.downloads.download({}), {name: 'TypeError', message: /Error in invocation of downloads\.download\(downloads\.DownloadOptions options, optional function callback\): Error at parameter 'options': Missing required property 'url'/});
    assert.throws(() => r.chrome.downloads.download({url: 'https://x.test/', saveAs: 'yes'}), {name: 'TypeError', message: /Error at parameter 'options': Error at property 'saveAs'/});
    assert.throws(() => r.chrome.downloads.download({url: 'https://x.test/', conflictAction: 'merge'}), {name: 'TypeError'});
    assert.equal(r.state.started.length, 3, 'only the valid calls and the refused one reached the manager');
    const error = await new Promise(resolve => r.chrome.downloads.download({url: 'zzz'}, () => resolve(r.chrome.runtime.lastError && r.chrome.runtime.lastError.message)));
    assert.equal(error, 'Invalid URL');
  } finally { r.close(); }
});

test('downloads.download: a POST download is refused in plain words (not silently turned into a GET)', async () => {
  const r = rig();
  try {
    await assert.rejects(r.chrome.downloads.download({url: 'https://example.com/form', method: 'POST', body: 'a=1'}), {message: /POST downloads/});
    assert.equal(r.state.started.length, 0);
  } finally { r.close(); }
});

test('downloads.search sees every download of the profile and nothing else: not another profile\'s, not a private one', async () => {
  const mine = [rec(1), rec(2, {status: 'Downloading', endedAt: undefined}), rec(3, {path: 'C:\\dl\\gone.zip'})];
  const others = [rec(4, {browserProfileId: 'profile-work'}), rec(5, {private: true}), rec(6, {browserProfileId: 'private-abc', private: true}), rec(7, {browserProfileId: 'private-secured-xyz'})];
  const r = rig({records: [...mine, ...others]});
  try {
    const found = plain(await r.chrome.downloads.search({}));
    assert.deepEqual(found.map(item => item.url.split('/').pop()), ['file1.zip', 'file2.zip', 'file3.zip']);
    assert.deepEqual(found.map(item => item.id), [1, 2, 3]);
    assert.equal(found[2].exists, false, 'a finished file that is gone');
    assert.deepEqual(plain(await r.chrome.downloads.search({exists: false})).map(item => item.id), [3]);
    assert.deepEqual(plain(await r.chrome.downloads.search({query: ['file1'], limit: 5})).map(item => item.id), [1]);
    assert.deepEqual(plain(await r.chrome.downloads.search({orderBy: ['-startTime'], limit: 1})).map(item => item.id), [3]);
    await assert.rejects(r.chrome.downloads.search({orderBy: ['x']}), {message: 'Invalid orderBy field'});
    assert.throws(() => r.chrome.downloads.search({bogus: 1}), {name: 'TypeError', message: /Unexpected property: 'bogus'/});
    // a record the extension should not see cannot be reached by guessing its id either
    await assert.rejects(r.chrome.downloads.cancel(4), {message: 'Invalid downloadId'});
  } finally { r.close(); }
});

test('pause / resume / cancel / erase / removeFile / show / open: Chromium\'s rules and errors', async () => {
  const r = rig({permissions: ['downloads', 'downloads.open'], records: [rec(1), rec(2, {status: 'Downloading', endedAt: undefined}), rec(3, {status: 'Paused', canResume: true, endedAt: undefined}),
    rec(4, {status: 'Interrupted', canResume: false}), rec(5, {path: 'C:\\dl\\gone.zip'})]});
  try {
    const d = r.chrome.downloads;
    assert.equal((await d.search({})).length, 5, 'an extension learns ids from search / onCreated / download before using them');
    await assert.rejects(d.pause(99), {message: 'Invalid downloadId'});
    await assert.rejects(d.pause(1), {message: 'Download must be in progress'});
    await d.pause(2);
    await d.pause(3);
    assert.deepEqual(r.state.commands, [[PROFILE, 'download-2', 'pause']], 'pausing a paused download is a no-op');
    await d.resume(3);
    await assert.rejects(d.resume(2), {message: 'DownloadItem.canResume must be true'});
    await assert.rejects(d.resume(4), {message: 'DownloadItem.canResume must be true'});
    await d.cancel(2);
    await d.cancel(1);
    assert.deepEqual(r.state.commands.map(c => c[2]), ['pause', 'resume', 'cancel'], 'cancelling a finished download is not an error and does nothing');
    await assert.rejects(d.open(2), {message: 'Download must be complete'});
    await assert.rejects(d.open(5), {message: 'Download file already deleted'});
    await d.open(1);
    assert.deepEqual(r.state.commands.at(-1), [PROFILE, 'download-1', 'open']);
    assert.equal(d.show(1), undefined, 'show answers nothing');
    assert.equal(d.showDefaultFolder(), undefined);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(r.state.commands.at(-1), [PROFILE, 'download-1', 'show']);
    assert.equal(r.state.folderOpened, 1);
    await assert.rejects(d.removeFile(2), {message: 'Download must be complete'});
    await assert.rejects(d.removeFile(5), {message: 'Download file already deleted'});
    await d.removeFile(1);
    assert.deepEqual(r.state.removed, ['download-1']);
    r.listen('downloads.onErased');
    const erased = await d.erase({query: ['file1', 'file4']});
    assert.deepEqual(plain(erased), [], 'terms must all match');
    assert.deepEqual(plain(await d.erase({state: 'interrupted'})), [4]);
    assert.deepEqual(r.state.erased, ['download-4']);
    assert.deepEqual(r.sent.filter(entry => entry[1] === 'downloads.onErased'), [['*', 'downloads.onErased', 4]]);
    assert.deepEqual(plain(await d.search({})).map(item => item.id), [1, 2, 3, 5]);
  } finally { r.close(); }
});

test('setUiOptions needs the downloads.ui permission and is otherwise accepted (Acira has no shelf to hide)', async () => {
  const r = rig();
  try {
    await assert.rejects(r.chrome.downloads.setUiOptions({enabled: false}), {message: 'downloads.setUiOptions requires the "downloads.ui" permission'});
  } finally { r.close(); }
  const ui = rig({permissions: ['downloads', 'downloads.ui']});
  try { assert.equal(await ui.chrome.downloads.setUiOptions({enabled: false}), undefined); } finally { ui.close(); }
});

test('main side: open without the downloads.open permission is refused with Chromium\'s message', async () => {
  const r = rig({records: [rec(1)]});
  try {
    const answer = await r.handlers.get('downloads.open').callback(r.event, 1);
    assert.deepEqual(answer, {__acira_error: 'The "downloads.open" permission is required'});
  } finally { r.close(); }
});

test('events: onCreated for a new download, onChanged with deltas computed against the Downloads page, nothing for private or other profiles', async () => {
  const r = rig({records: [rec(1, {status: 'Downloading', endedAt: undefined, receivedBytes: 10})]});
  try {
    const created = [], changed = [];
    assert.deepEqual(plain(await r.chrome.downloads.search({})).map(item => item.id), [1], 'the extension already knows download 1');
    r.chrome.downloads.onCreated.addListener(item => created.push(item));
    r.chrome.downloads.onChanged.addListener(delta => changed.push(delta));
    r.listen('downloads.onCreated'); r.listen('downloads.onChanged');
    // the manager announces a new download, then updates
    const fresh = rec(2, {status: 'Downloading', endedAt: undefined, receivedBytes: 0, byExtensionId: ID, byExtensionName: 'Fetcher'});
    host.emit({type: 'created', profileId: PROFILE, record: fresh});
    host.emit({type: 'created', profileId: 'profile-work', record: rec(3, {browserProfileId: 'profile-work'})});
    host.emit({type: 'created', profileId: PROFILE, record: rec(4, {private: true})});
    r.state.records.push(fresh);
    host.emit({type: 'changed', profileId: PROFILE, record: {id: 'download-1', receivedBytes: 80}});
    host.emit({type: 'changed', profileId: PROFILE, record: {id: 'download-1', status: 'Ready', endedAt: T0 + 9000, receivedBytes: 100}});
    host.emit({type: 'changed', profileId: PROFILE, record: {id: 'download-9', status: 'Ready'}});
    for (const entry of r.sent) r.world.emit(entry[1], ...entry.slice(2));
    assert.deepEqual(created.map(item => [item.id, item.state, item.byExtensionId]), [[2, 'in_progress', ID]]);
    assert.deepEqual(plain(changed), [{id: 1, endTime: {current: '2026-10-28T10:00:09.000Z'}, state: {previous: 'in_progress', current: 'complete'}}]);
    // no listener, no work and no event
    r.listening.clear(); r.sent.length = 0;
    host.emit({type: 'changed', profileId: PROFILE, record: {id: 'download-1', status: 'Cancelled'}});
    assert.deepEqual(r.sent, []);
  } finally { r.close(); }
});

test('the real folder loads with the downloads package and it claims only chrome.downloads', () => {
  const pkg = extApi.loadPackages({fresh: true}).find(entry => entry.name === 'downloads');
  assert.deepEqual([pkg.namespaces, !!pkg.install, !!pkg.renderer], [['downloads'], true, true]);
});
