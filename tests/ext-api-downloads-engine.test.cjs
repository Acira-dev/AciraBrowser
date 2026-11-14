'use strict';
// chrome.downloads on Acira's real downloads manager (browser-services/download-engine.cjs): an extension's download is matched to its
// will-download, lands where the options say, shows up in the Downloads page's records, and is announced to the extension API; page downloads,
// private ones and strays are unchanged. The Electron DownloadItem and session are fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
// The usual rig environment puts the engine in test mode (no Save dialog, a test download folder): these tests drive the real flow.
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createAppHost} = require('../desktop/browser-services/ext-api/downloads/app-host.cjs');
const hostModule = require('../desktop/browser-services/ext-api/downloads/host.cjs');
const destination = require('../desktop/browser-services/ext-api/downloads/destination.cjs');

class Item extends EventEmitter {
  constructor(url, {name = 'a.txt', total = 10, mime = 'text/plain', chain} = {}) {
    super(); Object.assign(this, {url, name, total, mime, chain: chain || [url], offset: 0, saved: '', paused: false});
  }
  getURL() { return this.chain.at(-1); }
  getURLChain() { return this.chain; }
  getFilename() { return this.name; }
  getSavePath() { return this.saved; }
  getReceivedBytes() { return this.offset; }
  getTotalBytes() { return this.total; }
  getMimeType() { return this.mime; }
  getETag() { return ''; }
  getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; }
  canResume() { return this.paused; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  cancel() { this.emit('done', {}, 'cancelled'); }
  setSavePath(file) { this.saved = file; }
  finish(text = '0123456789') { fs.writeFileSync(this.saved, text); this.offset = this.total; this.emit('done', {}, 'completed'); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({dialogAnswer, preferences} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-engine-'));
  const folder = path.join(dir, 'Downloads');
  fs.mkdirSync(folder);
  const records = [], toasts = [], dialogs = [], downloadURLCalls = [];
  const session = Object.assign(new EventEmitter(), {downloadURL: (url, options) => downloadURLCalls.push([url, options])});
  const owner = profileId => ({profileId, tabId: undefined, window: {id: 1}, controller: {}, toast: (text, options) => toasts.push({text, ...options}),
    record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }});
  const pageOwner = {...owner('profile-a'), tabId: 'tab-1'};
  const wc = {session};
  const service = createDownloads({
    getOwner: contents => (contents === wc ? pageOwner : null),
    dialog: {showSaveDialog: async (window, options) => { dialogs.push(options); return dialogAnswer ? dialogAnswer(options) : {canceled: true}; }, showMessageBox: async () => ({response: 0})},
    app: {getPath: () => folder}, shell: {}, preferences: preferences || {get: () => ({askWhere: true, folder}), destination: name => path.join(folder, name)},
    journalPath: path.join(dir, 'journal.json')
  });
  service.attach(session);
  const events = [];
  service.observe(event => events.push(event));
  const prevented = [];
  const willDownload = async (item, contents = null) => { session.emit('will-download', {preventDefault: () => prevented.push(item)}, item, contents); await tick(); };
  return {dir, folder, records, toasts, dialogs, downloadURLCalls, session, owner, wc, service, events, prevented, willDownload,
    cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const extension = {id: 'abcdefghijklmnopabcdefghijklmnop', name: 'Fetcher'};

test('an extension download: session.downloadURL with the headers, matched to its will-download, saved in the Downloads folder, recorded and announced', async () => {
  const f = setup();
  try {
    const started = f.service.startExtension({session: f.session, url: 'https://example.com/files/a.txt', headers: {'X-Key': '1'}, owner: f.owner('profile-a'),
      request: {extension, conflictAction: 'uniquify'}});
    assert.deepEqual(f.downloadURLCalls, [['https://example.com/files/a.txt', {headers: {'X-Key': '1'}}]]);
    const item = new Item('https://example.com/files/a.txt', {chain: ['https://example.com/files/a.txt', 'https://cdn.example.com/a.txt'], mime: 'text/plain'});
    await f.willDownload(item);
    const id = await started;
    assert.match(id, /^download-/);
    assert.equal(item.saved, path.join(f.folder, 'a.txt'), 'straight into the folder, even with "ask where to save" on');
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.records.length, 1);
    const record = f.records[0];
    assert.deepEqual([record.id, record.browserProfileId, record.status, record.byExtensionId, record.byExtensionName, record.mime, record.originalUrl, record.url],
      [id, 'profile-a', 'Downloading', extension.id, 'Fetcher', 'text/plain', 'https://example.com/files/a.txt', 'https://cdn.example.com/a.txt']);
    item.finish();
    assert.equal(record.status, 'Ready');
    assert.equal(typeof record.endedAt, 'number');
    assert.deepEqual(f.events.map(e => [e.type, e.profileId, e.record.status]), [['created', 'profile-a', 'Downloading'], ['changed', 'profile-a', 'Ready']]);
    assert.equal(f.toasts[0].text.includes('a.txt'), true, 'the person is told, like for any download');
  } finally { f.cleanup(); }
});

test('filename (in subfolders) and conflictAction: uniquify, overwrite; the path never leaves the Downloads folder', async () => {
  const f = setup();
  try {
    const run = async (request, url = 'https://example.com/x') => {
      const started = f.service.startExtension({session: f.session, url, headers: {}, owner: f.owner('profile-a'), request: {extension, ...request}});
      const item = new Item(url, {name: 'server-name.bin'});
      await f.willDownload(item);
      await started;
      return item;
    };
    const first = await run({filename: 'docs/2026/report.pdf', conflictAction: 'uniquify'});
    assert.equal(first.saved, path.join(f.folder, 'docs', '2026', 'report.pdf'));
    first.finish('one');
    const second = await run({filename: 'docs/2026/report.pdf', conflictAction: 'uniquify'});
    assert.equal(second.saved, path.join(f.folder, 'docs', '2026', 'report (1).pdf'), 'uniquify: a counter before the extension');
    second.finish('two');
    const third = await run({filename: 'docs/2026/report.pdf', conflictAction: 'overwrite'});
    assert.equal(third.saved, path.join(f.folder, 'docs', '2026', 'report.pdf'), 'overwrite keeps the name');
    third.finish('three');
    assert.equal(fs.readFileSync(third.saved, 'utf8'), 'three');
    const named = await run({conflictAction: 'uniquify'});
    assert.equal(named.saved, path.join(f.folder, 'server-name.bin'), 'no filename: the server\'s suggestion');
    // a hostile name can only land inside the folder
    await assert.rejects(destination.chooseDestination({item: new Item('https://x/'), preferences: {get: () => ({folder: f.folder})}, app: {getPath: () => f.folder},
      request: {filename: '..\\..\\evil.txt'}}).then(result => { assert.ok(result.filePath.startsWith(f.folder + path.sep), result.filePath); throw new Error('contained'); }), {message: 'contained'});
  } finally { f.cleanup(); }
});

test('saveAs shows the Save dialog with a default path; cancelling it cancels the download and says so in the record', async () => {
  const f = setup({dialogAnswer: () => ({canceled: true})});
  try {
    const started = f.service.startExtension({session: f.session, url: 'https://example.com/s.bin', headers: {}, owner: f.owner('profile-a'), request: {extension, filename: 'pick/s.bin', saveAs: true}});
    const item = new Item('https://example.com/s.bin');
    await f.willDownload(item);
    await started;
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.dialogs[0].defaultPath, path.join(f.folder, 'pick', 's.bin'));
    assert.equal(f.records[0].status, 'Cancelled');
    assert.equal(f.events.at(-1).record.status, 'Cancelled');
  } finally { f.cleanup(); }
  const g = setup({dialogAnswer: options => ({canceled: false, filePath: options.defaultPath})});
  try {
    const started = g.service.startExtension({session: g.session, url: 'https://example.com/s2.bin', headers: {}, owner: g.owner('profile-a'), request: {extension, saveAs: true}});
    const item = new Item('https://example.com/s2.bin', {name: 's2.bin'});
    await g.willDownload(item);
    await started;
    /* Electron reads the path when the handler returns, long before the answer: the file is parked in staging and lands on the answer when it finishes. */
    assert.equal(g.records[0].path, path.join(g.folder, 's2.bin'));
    assert.match(item.saved, /download-staging/);
    assert.equal(g.records[0].status, 'Downloading');
    item.finish('chosen');
    const readyDeadline = Date.now() + 5000;
    while (g.records[0].status !== 'Ready' && Date.now() < readyDeadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(g.records[0].status, 'Ready', 'the asynchronous staging move completed before reading its destination');
    assert.equal(fs.readFileSync(path.join(g.folder, 's2.bin'), 'utf8'), 'chosen');
    assert.equal(g.records[0].path, path.join(g.folder, 's2.bin'));
  } finally { g.cleanup(); }
});

test('extension downloads are not a page\'s burst: many in a row never ask the "allow multiple downloads" question', async () => {
  const asked = [];
  const f = setup();
  try {
    const service = createDownloads({getOwner: () => null, askSite: async () => { asked.push(1); return false; }, dialog: {showSaveDialog: async () => ({canceled: true})},
      app: {getPath: () => f.folder}, shell: {}, preferences: {get: () => ({askWhere: false, folder: f.folder}), destination: name => path.join(f.folder, name)}, journalPath: path.join(f.dir, 'j2.json')});
    const session = Object.assign(new EventEmitter(), {downloadURL() {}});
    service.attach(session);
    for (let n = 0; n < 5; n++) {
      const url = `https://example.com/f${n}.bin`;
      const started = service.startExtension({session, url, headers: {}, owner: f.owner('profile-a'), request: {extension}});
      const item = new Item(url, {name: `f${n}.bin`});
      session.emit('will-download', {preventDefault() {}}, item, null);
      await started;
    }
    assert.equal(asked.length, 0);
  } finally { f.cleanup(); }
});

test('strays and neighbours: a download nobody asked for with no page is refused; page downloads and private ones are not announced to extensions; same address claims in order', async () => {
  const f = setup();
  try {
    await f.willDownload(new Item('https://example.com/stray.bin'));
    assert.equal(f.prevented.length, 1, 'no page, no extension asked: refused as before');
    assert.equal(f.records.length, 0);
    // a page download is an ordinary download: announced (profile-a) with no extension attached
    const page = new Item('https://example.com/page.bin', {name: 'page.bin'});
    await f.willDownload(page, f.wc);
    assert.equal(f.events.at(-1).type, 'created');
    assert.equal(f.events.at(-1).record.byExtensionId, undefined);
    // private owner: nothing is announced
    const before = f.events.length;
    const privateWc = {session: f.session};
    const privateOwner = {...f.owner('profile-a'), private: true, tabId: 'tab-p'};
    const service = createDownloads({getOwner: contents => (contents === privateWc ? privateOwner : null), dialog: {showSaveDialog: async () => ({filePath: path.join(f.folder, 'p.bin')})},
      app: {getPath: () => f.folder}, shell: {}, journalPath: path.join(f.dir, 'j3.json')});
    const events = [];
    service.observe(event => events.push(event));
    const session = new EventEmitter();
    service.attach(session);
    session.emit('will-download', {preventDefault() {}}, new Item('https://example.com/p.bin', {name: 'p.bin'}), privateWc);
    await tick();
    assert.deepEqual(events, [], 'a private tab\'s download is never announced');
    assert.equal(f.events.length, before);
    const secured = {...f.owner('private-secured-1'), tabId: 'tab-s'};
    const securedService = createDownloads({getOwner: () => secured, dialog: {showSaveDialog: async () => ({filePath: path.join(f.folder, 's.bin')})}, app: {getPath: () => f.folder}, shell: {}, journalPath: path.join(f.dir, 'j4.json')});
    const securedEvents = [];
    securedService.observe(event => securedEvents.push(event));
    const securedSession = new EventEmitter();
    securedService.attach(securedSession);
    securedSession.emit('will-download', {preventDefault() {}}, new Item('https://example.com/s.bin', {name: 's.bin'}), {});
    await tick();
    assert.deepEqual(securedEvents, [], 'a secured workspace\'s download is never announced');
    // two extension downloads of one address claim their will-downloads in order
    const a = f.service.startExtension({session: f.session, url: 'https://example.com/same', headers: {}, owner: f.owner('profile-a'), request: {extension, filename: 'one.txt'}});
    const b = f.service.startExtension({session: f.session, url: 'https://example.com/same', headers: {}, owner: f.owner('profile-a'), request: {extension, filename: 'two.txt'}});
    const itemA = new Item('https://example.com/same'), itemB = new Item('https://example.com/same');
    await f.willDownload(itemA);
    await f.willDownload(itemB);
    await Promise.all([a, b]);
    assert.deepEqual([path.basename(itemA.saved), path.basename(itemB.saved)], ['one.txt', 'two.txt']);
  } finally { f.cleanup(); }
});

test('startExtension: a bad address is refused, downloadURL throwing rejects, and a response that never starts times out without leaking', async () => {
  const f = setup();
  try {
    await assert.rejects(f.service.startExtension({session: f.session, url: 'not a url', headers: {}, owner: f.owner('profile-a'), request: {extension}}), {message: 'Invalid URL'});
    const throwing = Object.assign(new EventEmitter(), {downloadURL() { throw new Error('boom'); }});
    f.service.attach(throwing);
    await assert.rejects(f.service.startExtension({session: throwing, url: 'https://example.com/x', headers: {}, owner: f.owner('profile-a'), request: {extension}}), {message: 'boom'});
    await assert.rejects(f.service.startExtension({session: f.session, url: 'https://example.com/never', headers: {}, owner: f.owner('profile-a'), request: {extension}, timeout: 20}), {message: 'NETWORK_FAILED'});
    // the timed-out entry is gone: a later will-download for that address is a stray
    await f.willDownload(new Item('https://example.com/never'));
    assert.equal(f.prevented.length, 1);
  } finally { f.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ the app host

test('app host: records of the profile (never private), start through the manager, erase cancels a running transfer first, removeFile deletes the file', async () => {
  const f = setup();
  try {
    const committed = [];
    const state = {downloads: [], tabs: [], browserProfiles: []};
    const controller = {profileId: 'profile-a', privateMode: false, closing: false, window: {id: 1}, state, pages: new Map(), record: f.owner('profile-a').record, toast: () => {},
      commitAction: action => { committed.push(action); if (action.type === 'downloads.erase') state.downloads = state.downloads.filter(r => !action.ids.includes(r.id)); }};
    const privateController = {...controller, profileId: 'profile-a', privateMode: true, state: {downloads: [{id: 'download-priv', browserProfileId: 'profile-a', status: 'Ready', private: true}], tabs: []}};
    const host = createAppHost({engine: f.service, controllers: new Set([privateController, controller]), shell: {openPath: async folder => { host.opened = folder; return ''; }}, preferences: {get: () => ({folder: f.folder})}, app: {getPath: () => f.folder}});
    // start: through the engine, owner is the profile's ordinary window
    const started = host.start('profile-a', f.session, {url: 'https://example.com/h.txt', filename: 'h.txt', conflictAction: 'uniquify', headers: [{name: 'A', value: '1'}, {name: 'A', value: '2'}], extension});
    assert.deepEqual(f.downloadURLCalls.at(-1), ['https://example.com/h.txt', {headers: {A: '1, 2'}}]);
    const item = new Item('https://example.com/h.txt', {name: 'h.txt'});
    await f.willDownload(item);
    const recordId = await started;
    state.downloads.push(...f.records);
    assert.deepEqual(host.records('profile-a').map(r => r.id), [recordId]);
    assert.deepEqual(host.records('profile-b'), []);
    assert.deepEqual(host.records('private-x'), []);
    await assert.rejects(host.start('private-x', f.session, {url: 'https://example.com/p', extension}), {message: 'NETWORK_INVALID_REQUEST'});
    // erase: the running transfer is cancelled first, then forgotten
    await host.erase('profile-a', [recordId, 'download-priv', 'download-not-mine']);
    assert.equal(f.records.find(r => r.id === recordId).status, 'Cancelled', 'the running transfer was cancelled before its record was forgotten');
    assert.deepEqual(committed, [{type: 'downloads.erase', ids: [recordId]}]);
    assert.equal(host.records('profile-a').length, 0);
    // removeFile
    const file = path.join(f.folder, 'gone.txt');
    fs.writeFileSync(file, 'x');
    state.downloads.push({id: 'download-file', browserProfileId: 'profile-a', status: 'Ready', path: file});
    await host.removeFile('profile-a', 'download-file');
    assert.equal(fs.existsSync(file), false);
    await assert.rejects(host.removeFile('profile-a', 'download-priv'), {message: 'Download is outside this profile.'});
    host.showDefaultFolder();
    assert.equal(host.opened, f.folder);
    assert.equal(host.exists(file), false);
    // pause / resume go to the engine
    const live = new Item('https://example.com/live.bin', {name: 'live.bin', total: 100});
    const startedLive = host.start('profile-a', f.session, {url: 'https://example.com/live.bin', extension});
    await f.willDownload(live);
    const liveId = await startedLive;
    state.downloads.push(...f.records.filter(r => r.id === liveId));
    await host.command('profile-a', liveId, 'pause');
    assert.equal(live.paused, true);
    assert.equal(f.records.find(r => r.id === liveId).status, 'Paused');
    await host.command('profile-a', liveId, 'resume');
    assert.equal(live.paused, false);
    await host.command('profile-a', liveId, 'cancel');
    assert.equal(f.records.find(r => r.id === liveId).status, 'Cancelled');
    assert.equal(typeof hostModule.connect, 'function');
  } finally { f.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ onDeterminingFilename (13.5)
// The extensions that listen are asked for a name before the file gets one. The transfer waits (parked, paused) and lands where they said,
// inside the Downloads folder; "ask where to save" still asks; private downloads are never offered; a download that is being held paused while
// its destination is chosen is not "paused" to an extension.
const itemsModule = require('../desktop/browser-services/ext-api/downloads/item.cjs');
const waitFor = async (check, ms = 5000) => { const until = Date.now() + ms; while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5)); return check(); };
function direct() {
  const ref = {};
  const f = setup({preferences: {get: () => ({askWhere: false, folder: ref.folder}), destination: name => path.join(ref.folder, name)}});
  ref.folder = f.folder;
  return f;
}
/** A determiner for a profile; `answer` decides what the extensions say. */
function determiner(profileId, answer, log = []) {
  const off = hostModule.setDeterminer(profileId, {listening: () => true, determine: async record => { log.push({...record}); return typeof answer === 'function' ? answer(record) : answer; }});
  return {off, log};
}

test('a page download is named by the extension: parked while it answers, announced first, and it lands where the extension said', async () => {
  const f = direct(), order = [];
  const asked = determiner('profile-a', async record => { order.push(['asked', f.events.map(e => e.type)]); return {filename: 'invoices/2026/renamed.txt'}; }, []);
  try {
    const item = new Item('https://example.com/files/a.txt', {name: 'a.txt', mime: 'text/plain', total: 10});
    await f.willDownload(item, f.wc);
    assert.equal(asked.log.length, 1, 'asked once');
    assert.deepEqual([asked.log[0].url, asked.log[0].mime, asked.log[0].status, asked.log[0].path, asked.log[0].totalBytes],
      ['https://example.com/files/a.txt', 'text/plain', 'Downloading', path.join(f.folder, 'a.txt'), 10], 'it is told the download as Chrome shows it: the tentative path in the Downloads folder');
    assert.deepEqual(order, [['asked', ['created']]], 'onCreated came first, then the question');
    assert.match(item.saved, /download-staging/, 'Electron needs a path at once: parked until the answer');
    assert.equal(f.dialogs.length, 0, 'no Save dialog: "ask where" is off');
    assert.equal(f.records[0].path, path.join(f.folder, 'invoices', '2026', 'renamed.txt'));
    item.finish('hello');
    assert.equal(await waitFor(() => f.records[0].status === 'Ready'), true, 'the parked file was moved to its place');
    assert.equal(fs.readFileSync(path.join(f.folder, 'invoices', '2026', 'renamed.txt'), 'utf8'), 'hello');
    assert.equal(fs.existsSync(path.join(f.folder, 'a.txt')), false);
    const [created] = f.events;
    assert.equal(created.type, 'created');
    assert.equal(itemsModule.toItem(created.record, 1).paused, false, 'not paused');
  } finally { asked.off(); f.cleanup(); }
});

test('nothing suggested: the download is named and placed as it always was', async () => {
  for (const answer of [{}, null]) {
    const f = direct();
    const asked = determiner('profile-a', answer);
    try {
      const item = new Item('https://example.com/files/plain.txt', {name: 'plain.txt'});
      await f.willDownload(item, f.wc);
      assert.equal(f.records[0].path, path.join(f.folder, 'plain.txt'));
      item.finish();
      assert.equal(await waitFor(() => f.records[0].status === 'Ready'), true);
      assert.equal(fs.readFileSync(path.join(f.folder, 'plain.txt'), 'utf8'), '0123456789');
    } finally { asked.off(); f.cleanup(); }
  }
});

test('a suggestion cannot leave the Downloads folder, and "uniquify" and "overwrite" work as they do for downloads.download', async () => {
  const f = direct();
  const answers = [{filename: 'x/same.txt'}, {filename: 'x/same.txt'}, {filename: 'x/same.txt', conflictAction: 'overwrite'}, {filename: '..\\..\\evil.txt'}];
  const asked = determiner('profile-a', () => answers.shift());
  try {
    // started by an extension, so that following one another is not a page's burst (the "allow multiple downloads" question)
    const run = async name => { const url = 'https://example.com/' + name, started = f.service.startExtension({session: f.session, url, headers: {}, owner: f.owner('profile-a'), request: {extension}}); const item = new Item(url, {name}); await f.willDownload(item); await started; return item; };
    const first = await run('1.txt'); first.finish('one'); await waitFor(() => f.records[0].status === 'Ready');
    const second = await run('2.txt'); second.finish('two'); await waitFor(() => f.records[1].status === 'Ready');
    assert.deepEqual(f.records.slice(0, 2).map(r => r.path), [path.join(f.folder, 'x', 'same.txt'), path.join(f.folder, 'x', 'same (1).txt')], 'uniquify, the default');
    const third = await run('3.txt'); third.finish('three'); await waitFor(() => f.records[2].status === 'Ready');
    assert.equal(f.records[2].path, path.join(f.folder, 'x', 'same.txt'), 'overwrite keeps the name');
    assert.equal(fs.readFileSync(path.join(f.folder, 'x', 'same.txt'), 'utf8'), 'three');
    // a result that somehow carried a path out of the folder (the package refuses those before it gets here) is still contained by the engine
    const fourth = await run('4.txt');
    assert.ok(f.records[3].path.startsWith(f.folder + path.sep), f.records[3].path);
    fourth.finish('four');
  } finally { asked.off(); f.cleanup(); }
});

test('"ask where to save" still asks, with the extension\'s name as the default; cancelling cancels', async () => {
  const f = setup({dialogAnswer: options => ({canceled: false, filePath: options.defaultPath})});
  const asked = determiner('profile-a', {filename: 'sorted/by-extension.txt'});
  try {
    const item = new Item('https://example.com/ask.txt', {name: 'ask.txt'});
    await f.willDownload(item, f.wc);
    assert.equal(f.dialogs.length, 1);
    assert.equal(f.dialogs[0].defaultPath, path.join(f.folder, 'sorted', 'by-extension.txt'));
    assert.equal(f.records[0].path, path.join(f.folder, 'sorted', 'by-extension.txt'));
    item.finish('x');
    assert.equal(await waitFor(() => f.records[0].status === 'Ready'), true);
  } finally { asked.off(); f.cleanup(); }
  const g = setup({dialogAnswer: () => ({canceled: true})});
  const again = determiner('profile-a', {filename: 'never.txt'});
  try {
    const item = new Item('https://example.com/no.txt', {name: 'no.txt'});
    await g.willDownload(item, g.wc);
    assert.equal(g.records[0].status, 'Cancelled');
    assert.equal(fs.existsSync(path.join(g.folder, 'never.txt')), false);
  } finally { again.off(); g.cleanup(); }
});

test('an extension\'s own download can be renamed by another extension: the suggestion wins over the options\' filename and conflictAction', async () => {
  const f = direct();
  fs.writeFileSync(path.join(f.folder, 'moved.bin'), 'older');
  const asked = determiner('profile-a', {filename: 'moved.bin', conflictAction: 'overwrite'});
  try {
    const started = f.service.startExtension({session: f.session, url: 'https://example.com/o.bin', headers: {}, owner: f.owner('profile-a'), request: {extension, filename: 'original/o.bin', conflictAction: 'uniquify'}});
    const item = new Item('https://example.com/o.bin', {name: 'server.bin'});
    await f.willDownload(item);
    await started;
    assert.equal(asked.log[0].byExtensionId, extension.id);
    assert.equal(asked.log[0].path, path.join(f.folder, 'server.bin'), '13.8: it is told the name Chromium generated from the response (NotifyExtensions: virtual_path.BaseName()), not the folder or name the starting extension asked for: that is the lowest-priority suggestion');
    assert.equal(f.records[0].path, path.join(f.folder, 'moved.bin'));
    item.finish('newer');
    assert.equal(await waitFor(() => f.records[0].status === 'Ready'), true);
    assert.equal(fs.readFileSync(path.join(f.folder, 'moved.bin'), 'utf8'), 'newer');
  } finally { asked.off(); f.cleanup(); }
});

test('private and Tor downloads are never offered to an extension, and a download with nobody listening is not held', async () => {
  const f = direct(), privateOwner = {...f.owner('private-tab-1'), private: true, tabId: 'tab-p'};
  const asked = determiner('private-tab-1', {filename: 'leak.txt'}), other = determiner('profile-a', {filename: 'x.txt'});
  other.off();
  const idle = hostModule.setDeterminer('profile-a', {listening: () => false, determine: async () => { throw new Error('asked'); }});
  try {
    const privateService = createDownloads({getOwner: () => privateOwner, dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async () => ({response: 0})}, app: {getPath: () => f.folder}, shell: {},
      preferences: {get: () => ({askWhere: false, folder: f.folder}), destination: name => path.join(f.folder, name)}, journalPath: path.join(f.dir, 'private-journal.json')});
    const session = Object.assign(new EventEmitter(), {downloadURL() {}});
    privateService.attach(session);
    const item = new Item('https://example.com/p.txt', {name: 'p.txt'});
    session.emit('will-download', {preventDefault() {}}, item, {});
    await tick(); await tick();
    assert.equal(asked.log.length, 0, 'not asked');
    assert.equal(item.saved, path.join(f.folder, 'p.txt'), 'straight to its place, as before');
    // nobody listening on the ordinary profile: the same, with no parking
    const plainItem = new Item('https://example.com/q.txt', {name: 'q.txt'});
    await f.willDownload(plainItem, f.wc);
    assert.equal(plainItem.saved, path.join(f.folder, 'q.txt'));
  } finally { idle(); asked.off(); f.cleanup(); }
});

test('a download held while its destination is chosen is reported to extensions as running, not paused', async () => {
  const f = setup({dialogAnswer: () => new Promise(() => {})});   // the Save dialog is open and unanswered
  try {
    const item = new Item('https://example.com/held.txt', {name: 'held.txt'});
    await f.willDownload(item, f.wc);
    assert.equal(item.paused, true, 'the manager really holds it');
    item.emit('updated', {}, 'progressing');
    const created = f.events.find(e => e.type === 'created');
    assert.ok(created, 'announced');
    assert.equal(itemsModule.toItem(created.record, 1).paused, false);
    assert.equal(itemsModule.toItem(created.record, 1).state, 'in_progress');
  } finally { f.cleanup(); }
});

test('cancelling while the extensions are still answering ends the download cleanly', async () => {
  const f = direct();
  let release;
  const asked = determiner('profile-a', () => new Promise(resolve => { release = () => resolve({filename: 'late/name.txt'}); }));
  try {
    const item = new Item('https://example.com/c.txt', {name: 'c.txt'});
    await f.willDownload(item, f.wc);
    assert.equal(f.records[0]?.status === 'Ready', false);
    item.cancel();
    release();
    await tick(); await tick();
    assert.equal(f.records.find(r => r.status === 'Cancelled') !== undefined, true);
  } finally { asked.off(); f.cleanup(); }
});

test('cancelling while the destination is still being chosen cancels, even when the small file has already arrived (the Save dialog, or the extensions asked for a name)', async () => {
  for (const via of ['save dialog', 'extension suggestion']) {
    let release;
    const f = via === 'save dialog' ? setup({dialogAnswer: options => new Promise(resolve => { release = () => resolve({canceled: false, filePath: options.defaultPath}); })}) : direct();
    const asked = via === 'save dialog' ? null : determiner('profile-a', () => new Promise(resolve => { release = () => resolve({filename: 'late/name.txt'}); }));
    try {
      const item = new Item('https://example.com/small.txt', {name: 'small.txt'});
      await f.willDownload(item, f.wc);
      assert.equal(typeof release, 'function', via + ': the destination is still being chosen');
      item.emit('updated', {}, 'progressing');   // as Electron does at once: the row exists while the destination is being chosen
      item.cancel = () => {};   // all of its bytes have arrived: Electron's cancel() on a finished item does nothing
      item.finish('hello');
      const record = f.records[0];
      await f.service.command(record.id, 'cancel', 'profile-a', f.records, {});
      release();
      await waitFor(() => record.status === 'Cancelled' || record.status === 'Ready', 3000);
      assert.equal(record.status, 'Cancelled', via + ': cancelled, not saved');
      await tick(); await tick();
      const left = []; (function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else left.push(path.relative(f.dir, file)); } })(f.dir);
      assert.deepEqual(left.filter(name => !/journal/.test(name)), [], via + ': nothing of it is left on disk');
    } finally { asked?.off(); f.cleanup(); }
  }
});

test('a suggestion that cannot be written is dropped and the download keeps its own name: a folder name over the file system limit, a "folder" that is already a file', async () => {
  const f = direct();
  fs.writeFileSync(path.join(f.folder, 'already-a-file'), 'x');
  const answers = [{filename: 'q'.repeat(300) + '/long.txt'}, {filename: 'already-a-file/inside.txt'}, {filename: 'q'.repeat(300) + '/own.txt'}, {filename: 'already-a-file/own2.txt'}];
  const asked = determiner('profile-a', () => answers.shift());
  try {
    // an extension's own download (not a page's burst) and a page download, each with both kinds
    const viaExtension = async (name) => { const url = 'https://example.com/' + name, started = f.service.startExtension({session: f.session, url, headers: {}, owner: f.owner('profile-a'), request: {extension}}); const item = new Item(url, {name}); await f.willDownload(item); await started; return item; };
    for (const name of ['one.txt', 'two.txt']) {
      const item = await viaExtension(name);
      const record = f.records.find(r => r.path && r.path.endsWith(name));
      assert.ok(record, name + ': it was not cancelled');
      assert.equal(record.path, path.join(f.folder, name), name + ': it keeps its own name');
      item.finish('ok');
      assert.equal(await waitFor(() => record.status === 'Ready'), true, name + ': it completes');
      assert.equal(fs.readFileSync(path.join(f.folder, name), 'utf8'), 'ok');
    }
    const item = new Item('https://example.com/own.txt', {name: 'own.txt'});
    await f.willDownload(item, f.wc);
    const record = f.records.find(r => r.path && r.path.endsWith('own.txt'));
    assert.ok(record && record.status !== 'Cancelled', 'a page download is not cancelled either');
    assert.equal(record.path, path.join(f.folder, 'own.txt'));
    item.finish('page');
    assert.equal(await waitFor(() => record.status === 'Ready'), true);
    assert.ok(!f.toasts.some(toast => /couldn|not saved/i.test(String(toast.text))), 'no "could not save" for it');
  } finally { asked.off(); f.cleanup(); }
});
