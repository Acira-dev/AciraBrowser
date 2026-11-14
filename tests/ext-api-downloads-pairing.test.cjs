'use strict';
// 13.8, Image Downloader and every extension that starts downloads: chrome.downloads.download() is paired with Electron's download the way Chromium
// writes an address (ext-api/downloads/pairing.cjs, a port of url/url_canon_path.cc), a download is never cancelled as a stray because two spellings of
// one address differ, an extension that stopped listening no longer holds a download, and downloads.download takes "%" out of a filename as
// downloads_api.cc does. Each case below failed on 13.7. The Electron DownloadItem and session are fakes (same ones as ext-api-downloads-engine.test.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const pairing = require('../desktop/browser-services/ext-api/downloads/pairing.cjs');
const {createDeterminer, TIMEOUT_MS} = require('../desktop/browser-services/ext-api/downloads/determine.cjs');
const items = require('../desktop/browser-services/ext-api/downloads/item.cjs');

class Item extends EventEmitter {
  constructor(url, {name = 'a.png', total = 10, mime = 'image/png', chain} = {}) {
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
const extension = {id: 'abcdefghijklmnopabcdefghijklmnop', name: 'Image Downloader'};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-pair-'));
  const folder = path.join(dir, 'Downloads');
  fs.mkdirSync(folder);
  const records = [];
  const session = Object.assign(new EventEmitter(), {downloadURL: () => {}});
  const owner = {profileId: 'profile-a', tabId: undefined, window: {id: 1}, controller: {}, toast: () => {},
    record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }};
  const service = createDownloads({
    getOwner: () => null,
    dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async () => ({response: 0})},
    app: {getPath: () => folder}, shell: {}, preferences: {get: () => ({askWhere: true, folder}), destination: name => path.join(folder, name)},
    journalPath: path.join(dir, 'journal.json')
  });
  service.attach(session);
  const prevented = [];
  const willDownload = async (item, contents = null) => { session.emit('will-download', {preventDefault: () => prevented.push(item)}, item, contents); await tick(); };
  return {dir, folder, records, session, owner, service, prevented, willDownload, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const settled = (promise, ms = 400) => Promise.race([promise.then(value => ({value})), new Promise(resolve => setTimeout(() => resolve({timedOut: true}), ms))]);

// ------------------------------------------------------------------------------------------------ the pairing rule

test('pairing: the address is compared the way Chromium writes it (url_canon_path.cc): | ^ { } ` in a path are %XX, a valid %XX stays, a stray % passes through', () => {
  assert.equal(pairing.canonicalPath('/img/a|b.png'), '/img/a%7Cb.png');
  assert.equal(pairing.canonicalPath('/img/a^b{c}d`e.png'), '/img/a%5Eb%7Bc%7Dd%60e.png');
  assert.equal(pairing.canonicalPath('/img/a%7cb.png'), '/img/a%7cb.png', 'a valid escape is copied exactly');
  assert.equal(pairing.canonicalPath('/img/100%.png'), '/img/100%.png', 'a stray % passes through unchanged');
  assert.equal(pairing.canonicalPath('/img/ü.png'), '/img/%C3%BC.png', 'above 0x7f: UTF-8 escapes');
  assert.equal(pairing.canonicalUrl('http://x.test/img/a|b.png?q=a|b#frag'), pairing.canonicalUrl('http://x.test/img/a%7Cb.png?q=a|b'), 'the fragment never matters');
  assert.equal(pairing.canonicalUrl('not a url'), null);
});

test('pairing: oldest request first; the same string, then the same canonical address, then the same address with every escape decoded, then the same origin', () => {
  const queue = [{href: 'http://x.test/img/a|b.png'}, {href: 'http://x.test/img/a%7Cb.png'}, {href: 'http://y.test/other.png'}];
  assert.equal(pairing.indexOf(queue, ['http://x.test/img/a|b.png']), 0, 'the same string');
  assert.equal(pairing.indexOf(queue, ['http://x.test/img/a%7Cb.png']), 1, 'the same string wins over a later spelling of the same address');
  assert.equal(pairing.indexOf([{href: 'http://x.test/img/a|b.png'}], ['http://x.test/img/a%7Cb.png']), 0, 'Chromium spells | as %7C');
  assert.equal(pairing.indexOf([{href: 'http://x.test/img/a%7cb.png'}], ['http://x.test/img/a%7Cb.png']), 0, 'hex case does not matter');
  assert.equal(pairing.indexOf([{href: 'http://x.test/a|b.png'}], ['http://x.test/a%7Cb.png#top']), 0);
  assert.equal(pairing.indexOf([{href: 'http://x.test/a/b.png'}], ['http://x.test/a%2Fb.png']), 0, 'decoded, it is the same address');
  assert.equal(pairing.indexOf([{href: 'http://x.test/one.png'}], ['http://x.test/something-else.png']), 0, 'last resort: the same origin');
  assert.equal(pairing.indexOf([{href: 'http://x.test/one.png'}], ['http://z.test/one.png']), -1, 'another origin is never claimed');
  assert.equal(pairing.indexOf([], ['http://x.test/one.png']), -1);
  assert.equal(pairing.indexOf([{href: 'data:image/png;base64,AAAA'}], ['data:image/png;base64,AAAA']), 0);
  assert.equal(pairing.indexOf([{href: 'data:image/png;base64,AAAA'}], ['blob:http://x.test/uuid']), -1, 'data: and blob: are different origins');
});

// ------------------------------------------------------------------------------------------------ the engine

test('a download of an address with | in its path is claimed: it lands, the extension gets its id, nothing is cancelled as a stray (13.7: cancelled, NETWORK_FAILED after 60 s)', async () => {
  const f = setup();
  try {
    const requested = 'http://127.0.0.1:9870/img/shape|one.png';
    const started = f.service.startExtension({session: f.session, url: new URL(requested).href, headers: {}, owner: f.owner, request: {extension, conflictAction: 'uniquify'}});
    // Chromium reports its own spelling of the address
    const item = new Item('http://127.0.0.1:9870/img/shape%7Cone.png', {name: 'shape%7Cone.png'});
    await f.willDownload(item);
    assert.deepEqual(f.prevented, [], 'not dropped as a stray');
    const answer = await settled(started);
    assert.ok(answer.value && /^download-/.test(answer.value), 'the extension is answered at once: ' + JSON.stringify(answer));
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0].byExtensionId, extension.id);
    item.finish();
    assert.equal(f.records[0].status, 'Ready');
  } finally { f.cleanup(); }
});

test('many at once, some with | in the path, some not: every request gets its own item, none is dropped or swapped', async () => {
  const f = setup();
  try {
    const names = ['a.png', 'b|c.png', 'd.png', 'e|f|g.png', 'h^i.png', 'j.png'];
    const base = 'http://img.test/x/';
    const started = names.map(name => f.service.startExtension({session: f.session, url: new URL(base + name).href, headers: {}, owner: f.owner, request: {extension, filename: 'pics/' + name.replace(/[|^]/g, '_')}}));
    const spell = name => base + name.replace(/\|/g, '%7C').replace(/\^/g, '%5E');
    const objects = names.map(name => new Item(spell(name), {name: name.replace(/[|^]/g, '_')}));
    for (const item of [...objects].reverse()) await f.willDownload(item); // they do not arrive in the order they were asked
    assert.deepEqual(f.prevented, []);
    const answers = await Promise.all(started.map(promise => settled(promise)));
    assert.deepEqual(answers.map(a => !!a.value), names.map(() => true));
    assert.equal(new Set(answers.map(a => a.value)).size, names.length, 'six different downloads');
    for (const [index, item] of objects.entries()) assert.equal(item.saved, path.join(f.folder, 'pics', names[index].replace(/[|^]/g, '_')), 'each landed under its own filename option');
  } finally { f.cleanup(); }
});

test('a download that no request asked for is still dropped (another origin, or a page with no request pending)', async () => {
  const f = setup();
  try {
    const started = f.service.startExtension({session: f.session, url: 'http://img.test/x/a.png', headers: {}, owner: f.owner, request: {extension}, timeout: 50});
    const stray = new Item('http://evil.test/payload.exe');
    await f.willDownload(stray);
    assert.deepEqual(f.prevented, [stray], 'a stray from another origin is cancelled');
    await assert.rejects(started, {message: 'NETWORK_FAILED'});
    const none = new Item('http://img.test/x/a.png');
    await f.willDownload(none);
    assert.deepEqual(f.prevented, [stray, none], 'with nothing pending, nothing is claimed');
  } finally { f.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ a listener that went away

test('an extension that stopped listening while it was asked is no longer waited for: the download goes on at once with what the others said (13.7: held for the whole 10 s)', async () => {
  const listeners = new Set(['popup-ext', 'worker-ext']);
  const sent = [];
  const determiner = createDeterminer({listening: () => [...listeners], send: (id, payload) => sent.push([id, payload]), order: () => ['popup-ext', 'worker-ext'], timeout: 60000, pollMs: 5});
  const started = Date.now();
  const result = determiner.determine({id: 1, filename: 'a.png'});
  const key = sent[0][1].k;
  determiner.answer('worker-ext', key, {filename: 'Folder/a.png'});
  listeners.delete('popup-ext'); // its popup was closed before it answered
  const outcome = await settled(result, 1000);
  assert.ok(outcome.value, 'released without the time limit');
  assert.deepEqual(outcome.value, {filename: 'Folder/a.png'});
  assert.ok(Date.now() - started < 1000);
  determiner.dispose();
});

test('a listener that is only briefly missing (a worker restarting between two checks) keeps its place', async () => {
  const state = {listening: ['ext']};
  const sent = [];
  const determiner = createDeterminer({listening: () => state.listening, send: (id, payload) => sent.push([id, payload]), timeout: 60000, pollMs: 20});
  const result = determiner.determine({id: 1, filename: 'a.png'});
  const key = sent[0][1].k;
  state.listening = []; await new Promise(resolve => setTimeout(resolve, 25)); state.listening = ['ext']; // one check missed it, the next found it
  await new Promise(resolve => setTimeout(resolve, 60));
  determiner.answer('ext', key, {filename: 'x/a.png'});
  assert.deepEqual((await settled(result, 500)).value, {filename: 'x/a.png'}, 'its answer still counted');
  determiner.dispose();
});

test('an extension answering with item.filename or a folder in front of it (Image Downloader) is accepted, backslashes too', () => {
  const determiner = createDeterminer({listening: () => ['ext'], send: () => {}, timeout: 60000, pollMs: 1000});
  const ask = value => { const out = []; const d = createDeterminer({listening: () => ['ext'], send: (id, payload) => out.push(payload), timeout: 60000, pollMs: 1000}); const result = d.determine({id: 1}); d.answer('ext', out[0].k, value); d.dispose(); return result; };
  return Promise.all([ask({filename: 'a.png'}), ask({filename: 'Imager - My page/a.png'}), ask({filename: 'Imager - My page\\a.png'})]).then(results => {
    assert.deepEqual(results, [{filename: 'a.png'}, {filename: 'Imager - My page/a.png'}, {filename: 'Imager - My page/a.png'}]);
    determiner.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ downloads.download's options

test('downloads.download takes % out of the filename, as downloads_api.cc does ("it affects environment variables"), and still refuses unsafe paths', () => {
  assert.equal(items.normalizeDownloadOptions({url: 'https://x.test/a.png', filename: 'sales 100%/a.png'}).filename, 'sales 100_/a.png');
  assert.equal(items.normalizeDownloadOptions({url: 'https://x.test/a.png', filename: '%TEMP%\\a.png'}).filename, '_TEMP_\\a.png');
  assert.throws(() => items.normalizeDownloadOptions({url: 'https://x.test/a.png', filename: '../%a.png'}), {message: 'Invalid filename'});
  assert.throws(() => items.normalizeDownloadOptions({url: 'https://x.test/a.png', filename: '/abs/a.png'}), {message: 'Invalid filename'});
});

test('the limit an extension has to answer onDeterminingFilename is Chromium\'s 15 s (ExtensionDownloadsEventRouterData::determine_filename_timeout_), not 10', () => {
  assert.equal(TIMEOUT_MS, 15000);
});
