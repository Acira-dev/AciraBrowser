'use strict';
// 13.5: chrome.downloads.onDeterminingFilename never fired, so download managers and renamers that suggest a file name or folder did
// nothing; and onCreated said paused:true for the first moments of every download (the manager holds it paused while its destination is chosen).
// Here: the pure part (suggestions, who wins, the time limit) and the whole path from the real extension-side preload through the package to the host.
// The manager's side (the transfer waits, lands where the extension said) is in tests/ext-api-downloads-engine.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');
const items = require('../desktop/browser-services/ext-api/downloads/item.cjs');
const host = require('../desktop/browser-services/ext-api/downloads/host.cjs');
const {readSuggestion, combine, createDeterminer, TIMEOUT_MS} = require('../desktop/browser-services/ext-api/downloads/determine.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);

// ---- the pure part

test('a suggestion is a safe relative path inside the Downloads folder and one of Chromium\'s three conflict actions; anything else is refused or ignored', () => {
  assert.deepEqual(readSuggestion(undefined), {});
  assert.deepEqual(readSuggestion(null), {});
  assert.deepEqual(readSuggestion({}), {}, 'suggest() with nothing keeps the name');
  assert.deepEqual(readSuggestion({filename: 'invoices/2026/a.pdf', conflictAction: 'overwrite'}), {filename: 'invoices/2026/a.pdf', conflictAction: 'overwrite'});
  assert.deepEqual(readSuggestion({filename: 'a.pdf'}), {filename: 'a.pdf'});
  assert.deepEqual(readSuggestion({conflictAction: 'prompt'}), {conflictAction: 'prompt'});
  assert.deepEqual(readSuggestion({filename: '', conflictAction: 'uniquify'}), {conflictAction: 'uniquify'}, 'an empty name is no name');
  assert.deepEqual(readSuggestion({conflictAction: 'delete-everything'}), {}, 'an unknown action is ignored');
  for (const bad of ['/etc/passwd', 'C:\\Windows\\a.exe', '..\\..\\evil.txt', 'a/../../b', 'a/./b', 'a//b', 'dir/', 'con.txt', 'a:b', 'x\u0000y'])
    assert.deepEqual(readSuggestion({filename: bad, conflictAction: 'overwrite'}), {error: items.ERRORS.invalidFilename}, JSON.stringify(bad));
});

test('the extension installed last decides the name; the conflict action is decided on its own', () => {
  const s = (filename, conflictAction) => ({suggestion: {...(filename ? {filename} : {}), ...(conflictAction ? {conflictAction} : {})}});
  assert.deepEqual(combine([]), {});
  assert.deepEqual(combine([s('old/a.pdf'), s('new/b.pdf')]), {filename: 'new/b.pdf'});
  assert.deepEqual(combine([s('old/a.pdf', 'overwrite'), s('new/b.pdf')]), {filename: 'new/b.pdf', conflictAction: 'overwrite'}, 'a later extension that only names the file does not take back "overwrite"');
  assert.deepEqual(combine([s('old/a.pdf'), s(null, 'prompt')]), {filename: 'old/a.pdf', conflictAction: 'prompt'});
  assert.deepEqual(combine([{suggestion: null}, s(null, null)]), {});
});

function determinerRig({ids = [A], order = [], timeout = 50} = {}) {
  const sent = [], timers = [];
  const determiner = createDeterminer({listening: () => ids, send: (id, payload) => sent.push([id, payload]), order: () => order, timeout,
    setTimer: (fn, ms) => { const timer = {fn, ms, cleared: false, unref() {}}; timers.push(timer); return timer; }, clearTimer: timer => { if (timer) timer.cleared = true; }, token: (() => { let n = 0; return () => 'k' + (++n); })()});
  return {determiner, sent, timers};
}

test('every extension that listens is asked once and the download waits for all of them; the first answer of each counts', async () => {
  const r = determinerRig({ids: [A, B], order: [B, A]});   // B was installed first, A last
  let result;
  const asked = r.determiner.determine({id: 1}).then(value => { result = value; });
  assert.deepEqual(r.sent.map(([id, payload]) => [id, payload.k, payload.item.id]), [[A, 'k1', 1], [B, 'k1', 1]]);
  r.determiner.answer(A, 'k1', {filename: 'from-a/x.txt'});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(result, undefined, 'B has not answered yet: the download waits');
  r.determiner.answer(A, 'k1', {filename: 'second-try.txt'});
  assert.equal(result, undefined, 'a second answer of A changes nothing and does not count for B');
  r.determiner.answer(C, 'k1', {filename: 'not-asked.txt'});
  r.determiner.answer(B, 'k1', {filename: 'from-b/x.txt', conflictAction: 'overwrite'});
  await asked;
  assert.deepEqual(result, {filename: 'from-a/x.txt', conflictAction: 'overwrite'}, 'A was installed last, so its name wins; B\'s conflict action is still the only one given');
  assert.equal(r.timers.every(timer => timer.cleared), true, 'the time limit is dropped when everyone has answered');
  r.determiner.answer(A, 'k1', {filename: 'late.txt'});   // an answer for a download that has moved on is ignored
});

test('nobody listening: no wait. An extension that never answers cannot hold the download beyond the time limit. A bad filename counts as an answer and is refused', async () => {
  const none = determinerRig({ids: []});
  assert.equal(none.determiner.listening(), false);
  assert.deepEqual(await none.determiner.determine({id: 1}), {});
  assert.deepEqual(none.sent, []);

  const slow = determinerRig({ids: [A, B], timeout: TIMEOUT_MS});
  assert.equal(slow.timers.length, 0);
  const waiting = slow.determiner.determine({id: 2});
  assert.equal(slow.timers[0].ms, TIMEOUT_MS, 'the limit is the one in the module');
  assert.ok(TIMEOUT_MS >= 5000 && TIMEOUT_MS <= 30000);
  slow.determiner.answer(A, 'k1', {filename: 'a-answered.txt'});
  slow.timers[0].fn();   // B never answers
  assert.deepEqual(await waiting, {filename: 'a-answered.txt'}, 'the answers that came are used');

  const bad = determinerRig({ids: [A]});
  const asked = bad.determiner.determine({id: 3});
  assert.throws(() => bad.determiner.answer(A, 'k1', {filename: '../../x', conflictAction: 'overwrite'}), {message: items.ERRORS.invalidFilename});
  assert.deepEqual(await asked, {}, 'the refused suggestion is dropped whole, and the download goes on with its own name');

  const gone = determinerRig({ids: [A, B]});
  const closing = gone.determiner.determine({id: 4});
  gone.determiner.answer(A, 'k1', {filename: 'kept.txt'});
  gone.determiner.forget(B);   // B was turned off or reloaded while it was being asked
  assert.deepEqual(await closing, {filename: 'kept.txt'});
});

// ---- through the real preload, package and host

const PROFILE = 'profile-personal';
function rig({permissions = ['downloads'], worker = true, listenerIds = [ID], userData} = {}) {
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-determine-'));
  const handlers = new Map(), sent = [], listening = new Map();
  const router = {handlers, listeners: listening, handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  const session = {extensions: {getExtension: () => null, on() {}, removeListener() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  const runtime = {ctx: {router}};
  const apis = installExtensionApis(runtime, {session, userData: dir, storeKey: PROFILE, extApiDir: path.join(__dirname, '..', 'desktop', 'browser-services', 'ext-api')});
  const manifest = {manifest_version: 3, name: 'Renamer', permissions};
  const event = {type: worker ? 'service-worker' : 'frame', extension: {id: ID, name: 'Renamer', manifest}};
  const packages = extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'downloads');
  const world = extensionWorld(manifest, {packages, worker, browser: {runtime: {id: ID}},
    answer: (name, args) => { const entry = handlers.get(name); return entry ? entry.callback(event, ...args) : undefined; }});
  const record = {id: 'download-7', browserProfileId: PROFILE, name: 'report.pdf', path: '/Users/x/Downloads/report.pdf', receivedBytes: 0, totalBytes: 1000, startedAt: Date.parse('2026-11-09T10:00:00Z'),
    url: 'https://example.com/report.pdf', status: 'Downloading', mime: 'application/pdf', size: ''};
  return {world, chrome: world.chrome, sent, listening, handlers, apis, record, event,
    listen: () => listening.set('downloads.onDeterminingFilename', listenerIds.map(extensionId => ({extensionId}))),
    /** Delivers what the package sent to the extension's listeners, as the engine would. */
    deliver() { for (const entry of sent.splice(0)) if (entry[1] === 'downloads.onDeterminingFilename') world.emit(entry[1], ...entry.slice(2)); },
    close() { apis.dispose?.(); fs.rmSync(dir, {recursive: true, force: true}); }};
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

test('onDeterminingFilename exists on chrome.downloads, and the manager can ask: the listener gets (item, suggest) and its suggestion comes back', async () => {
  const r = rig();
  try {
    assert.equal(typeof r.chrome.downloads.onDeterminingFilename.addListener, 'function');
    const determiner = host.determiner(PROFILE);
    assert.ok(determiner, 'the package says how its extensions are asked');
    assert.equal(determiner.listening(), false, 'nobody listens yet: the download is not held for anything');
    const seen = [];
    r.chrome.downloads.onDeterminingFilename.addListener((item, suggest) => { seen.push(plain(item)); suggest({filename: 'invoices/2026/report.pdf', conflictAction: 'overwrite'}); });
    r.listen();
    assert.equal(determiner.listening(), true);
    const result = determiner.determine(r.record);
    r.deliver();
    assert.deepEqual(await result, {filename: 'invoices/2026/report.pdf', conflictAction: 'overwrite'});
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].state, seen[0].paused, seen[0].url, seen[0].mime, seen[0].filename, seen[0].incognito, seen[0].danger], ['in_progress', false, 'https://example.com/report.pdf', 'application/pdf', 'report.pdf' /* 13.8: the BASE name, as ChromeDownloadManagerDelegate::NotifyExtensions passes virtual_path.BaseName() */, false, 'safe']);
    assert.equal(typeof seen[0].id, 'number');
  } finally { r.close(); }
});

test('suggest can be called later when the listener returns true; a listener that neither calls it nor returns true, or throws, suggests nothing', async () => {
  const r = rig();
  try {
    const determiner = host.determiner(PROFILE);
    let later;
    r.chrome.downloads.onDeterminingFilename.addListener((item, suggest) => { later = suggest; return true; });
    r.listen();
    let done = false;
    const pending = determiner.determine(r.record).then(value => { done = true; return value; });
    r.deliver();
    await flush();
    assert.equal(done, false, 'the download waits for the asynchronous suggest');
    later({filename: 'async/name.pdf'});
    later({filename: 'twice.pdf'});   // only the first call counts
    assert.deepEqual(await pending, {filename: 'async/name.pdf'});

    for (const make of [() => () => {}, () => () => { throw new Error('boom'); }]) {
      const fresh = rig();
      try {
        const quiet = console.error; console.error = () => {};
        try {
          fresh.chrome.downloads.onDeterminingFilename.addListener(make());
          fresh.listen();
          const result = host.determiner(PROFILE).determine(fresh.record);
          fresh.deliver();
          assert.deepEqual(await result, {}, 'no suggestion, and the download is not held');
        } finally { console.error = quiet; }
      } finally { fresh.close(); }
    }
  } finally { r.close(); }
});

test('an invalid filename is refused to the extension and the download goes on with its own name', async () => {
  const r = rig();
  try {
    r.chrome.downloads.onDeterminingFilename.addListener((item, suggest) => suggest({filename: '../../outside.txt'}));
    r.listen();
    const quiet = console.error; console.error = () => {};
    try {
      const result = host.determiner(PROFILE).determine(r.record);
      r.deliver();
      assert.deepEqual(await result, {});
    } finally { console.error = quiet; }
  } finally { r.close(); }
});

test('only the extensions that are asked can answer, and each is sent a token of its own download', async () => {
  const r = rig();
  try {
    r.chrome.downloads.onDeterminingFilename.addListener((item, suggest) => suggest({filename: 'ok.txt'}));
    r.listen();
    const result = host.determiner(PROFILE).determine(r.record);
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0][0], ID, 'sent to the listening extension only');
    assert.equal(r.sent[0][1], 'downloads.onDeterminingFilename');
    assert.match(r.sent[0][2].k, /^[0-9a-f-]{36}$/);
    // a made-up token, or a download nobody asked about, is not an answer and not an error the package raises
    assert.equal(await r.handlers.get('downloads.determineFilename').callback(r.event, 'guess', {filename: 'x.txt'}), undefined);
    r.deliver();
    assert.deepEqual(await result, {filename: 'ok.txt'});
  } finally { r.close(); }
});

test('without the downloads permission there is no chrome.downloads.onDeterminingFilename to listen to', () => {
  const r = rig({permissions: []});
  try { assert.equal(r.chrome.downloads, undefined); } finally { r.close(); }
});

// ---- onCreated's paused

test('a download the manager is holding while its destination is chosen is in progress, not paused (Chrome\'s onCreated says paused:false)', () => {
  const record = {id: 'download-1', url: 'https://example.com/a.zip', status: 'Paused', canPause: false, canResume: false, path: '', receivedBytes: 0, totalBytes: 100, startedAt: 1};
  const held = items.toItem(record, 1);
  assert.deepEqual([held.state, held.paused, held.canResume], ['in_progress', false, false]);
  // the person's own pause is still a pause, and so is a record without the manager's flags
  assert.equal(items.toItem({...record, canResume: true}, 1).paused, true);
  assert.equal(items.toItem({...record, canPause: undefined, canResume: undefined}, 1).paused, true);
  // the hold ending is no change an extension is told about
  assert.equal(items.deltaOf(items.toItem(record, 1), items.toItem({...record, status: 'Downloading', canPause: true, canResume: false}, 1)), null);
});

test('onCreated says paused:false for a download the manager holds while it names the file, and onChanged never reports the end of that hold as a change', async () => {
  const r = rig();
  try {
    const created = [], changed = [];
    r.chrome.downloads.onCreated.addListener(item => created.push(plain(item)));
    r.chrome.downloads.onChanged.addListener(delta => changed.push(plain(delta)));
    r.listening.set('downloads.onCreated', [{extensionId: ID}]); r.listening.set('downloads.onChanged', [{extensionId: ID}]);
    const held = {...r.record, id: 'download-9', status: 'Paused', canPause: false, canResume: false, path: ''};   // what the engine sends for the first update
    host.emit({type: 'created', profileId: PROFILE, record: held});
    // later updates while it is still held, then the hold ends: the manager's own records are recomputed live, so a stored copy would now say canResume:true
    host.emit({type: 'changed', profileId: PROFILE, record: {...held, receivedBytes: 10}});
    host.emit({type: 'changed', profileId: PROFILE, record: {...held, status: 'Downloading', canPause: false, canResume: true, path: '/Users/x/Downloads/sub/report.pdf'}});
    for (const entry of r.sent) r.world.emit(entry[1], ...entry.slice(2));
    assert.equal(created.length, 1);
    assert.deepEqual([created[0].state, created[0].paused], ['in_progress', false]);
    assert.deepEqual(changed.map(delta => Object.keys(delta).filter(key => key !== 'id')), [['filename']], 'the new file name, and nothing about pausing');
    // a pause the person asks for is still reported
    host.emit({type: 'changed', profileId: PROFILE, record: {...held, status: 'Paused', canPause: false, canResume: true, path: '/Users/x/Downloads/sub/report.pdf'}});
    r.sent.splice(0, r.sent.length - 1); for (const entry of r.sent) r.world.emit(entry[1], ...entry.slice(2));
    assert.deepEqual(plain(changed.at(-1)).paused, {previous: false, current: true});
  } finally { r.close(); }
});
