'use strict';
// Downloads from Tor tabs: the record says it came from Tor, opening such a file asks first (Tor Browser's download warning) until "Got it" is chosen, the choice is
// one saved Tor preference that sits beside the security level, and nothing about the warning applies to an ordinary download.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {EventEmitter} = require('node:events');
// The usual rig environment puts the engine in test mode (no Save dialog, a test download folder): these tests drive the real flow.
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/downloads.cjs');
const {createTorWindows} = require('../desktop/browser-services/tor-window.cjs');

class Item extends EventEmitter {
  constructor(file, url = 'https://check.torproject.org/api/ip') { super(); this.file = file; this.url = url; this.saved = ''; this.paused = false; }
  getURL() { return this.url; } getURLChain() { return [this.url]; } getFilename() { return path.basename(this.file); } getSavePath() { return this.saved; } getReceivedBytes() { return 10; } getTotalBytes() { return 10; }
  getMimeType() { return 'text/plain'; } getETag() { return ''; } getLastModifiedTime() { return ''; } isPaused() { return this.paused; } canResume() { return false; } pause() { this.paused = true; } resume() { this.paused = false; } cancel() { this.emit('done', {}, 'cancelled'); } setSavePath(p) { this.saved = p; }
}
function setup({tor, warning = () => true}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tor-dl-')), records = [], opened = [], boxes = [], session = new EventEmitter(), wc = {session, isDestroyed: () => false};
  let answer = 1;
  const owner = {profileId: 'A', tabId: 't1', window: {}, controller: {}, private: tor || undefined, tor: tor || undefined, toast() {}, record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push(record); }};
  const service = createDownloads({getOwner: contents => contents === wc ? owner : null, torWarning: warning,
    dialog: {showSaveDialog: async () => ({filePath: path.join(dir, 'ip.json')}), showMessageBox: async (_window, options) => { boxes.push(options); return {response: answer}; }},
    app: {getPath: () => dir, getFileIcon: async () => ({isEmpty: () => false})}, shell: {showItemInFolder() {}, openPath: async file => { opened.push(file); return ''; }}, journalPath: path.join(dir, 'journal.json')});
  service.attach(session);
  return {dir, records, opened, boxes, service, setAnswer: value => { answer = value; },
    async finish() { const item = new Item(path.join(dir, 'ip.json')); session.emit('will-download', {preventDefault() { throw new Error('denied'); }}, item, wc); await new Promise(setImmediate); fs.writeFileSync(item.saved, '{"IsTor":true}'); item.emit('done', {}, 'completed'); /* the Save dialog's answer came after Electron read the path: the file was parked and moves there now */ for (const end = Date.now() + 5000; records[0]?.status !== 'Ready' && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 5)); return records[0]; }};
}
const ask = (f, record) => f.service.command(record.id, 'open', 'A', f.records, {owner: {window: {}}});

test('a download from a Tor tab is recorded as one; an ordinary one is not', async () => {
  const tor = setup({tor: true}), plain = setup({tor: false});
  assert.equal((await tor.finish()).tor, true);assert.equal((await plain.finish()).tor, undefined);
});

test('macOS: a download from a Tor tab carries the quarantine mark like any other, with no address', {skip: process.platform !== 'darwin' && 'macOS only'}, async () => {
  const f = setup({tor: true}), record = await f.finish(), read = name => { try { return require('node:child_process').execFileSync('/usr/bin/xattr', ['-p', name, record.path], {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch { return null; } };
  assert.equal(record.status, 'Ready');
  assert.match(read('com.apple.quarantine') || 'none', /^0081;[0-9a-f]{8};Acira Browser;$/);
  assert.equal(read('com.apple.metadata:kMDItemWhereFroms'), null);
});

test('opening a Tor download asks first; Cancel opens nothing, Open file opens it', async () => {
  const f = setup({tor: true}), record = await f.finish();
  f.setAnswer(0);assert.deepEqual(await ask(f, record), {cancelled: true});assert.equal(f.opened.length, 0);
  assert.equal(f.boxes.length, 1);assert.equal(f.boxes[0].title, 'Open a file from a Tor tab?');assert.equal(f.boxes[0].message, 'Be careful opening downloads');assert.match(f.boxes[0].detail, /outside Tor/);
  f.setAnswer(1);await ask(f, record);assert.deepEqual(f.opened, [record.path]);
});

test('after "Got it" the file opens without asking; an ordinary download never asks', async () => {
  const f = setup({tor: true, warning: () => false}), record = await f.finish();
  await ask(f, record);assert.equal(f.boxes.length, 0);assert.equal(f.opened.length, 1);
  const plain = setup({tor: false}), ordinary = await plain.finish();
  await ask(plain, ordinary);assert.equal(plain.boxes.length, 0);assert.equal(plain.opened.length, 1);
});

const engine = () => ({status: () => ({state: 'ready', progress: 100, socksPort: 9150, error: null, version: '0.4.9.14'}), onStatus() { return () => {}; }, acquire() { return async () => {}; }, retry() {}, async newIdentity() { return {ok: true}; }});

test('the warning shows until "Got it", which is saved beside the security level and survives a restart', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tor-warning-'));
  try {
    const tor = createTorWindows({engine: engine(), userData});
    assert.equal(tor.handle({type: 'tor.download-warning'}).torDownloadWarning.show, true);assert.equal(tor.downloadWarning(), true);
    tor.handle({type: 'tor.level-set', level: 'safer'});
    assert.equal(tor.handle({type: 'tor.download-warning-dismiss'}).torDownloadWarning.show, false);assert.equal(tor.downloadWarning(), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, 'tor', 'settings.json'), 'utf8')), {level: 'safer', downloadWarning: false, preferOnion: false}, 'all the preferences are in the file');
    const next = createTorWindows({engine: engine(), userData});
    assert.equal(next.downloadWarning(), false);assert.equal(next.level(), 'safer');
  } finally { fs.rmSync(userData, {recursive: true, force: true}); }
});

test('a dismissal that cannot be saved is refused and the warning stays', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tor-warning-'));
  fs.writeFileSync(path.join(userData, 'tor'), 'a file where the folder should be');
  try {
    const tor = createTorWindows({engine: engine(), userData});
    assert.throws(() => tor.handle({type: 'tor.download-warning-dismiss'}), /couldn.t be saved/);
    assert.equal(tor.downloadWarning(), true);
  } finally { fs.rmSync(userData, {recursive: true, force: true}); }
});
