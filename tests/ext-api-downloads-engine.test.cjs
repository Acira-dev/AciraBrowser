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
    assert.equal(item.saved, path.join(g.folder, 's2.bin'));
    assert.equal(g.records[0].status, 'Downloading');
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
