'use strict';
// 13.3 (9 Nov 2026). Retry is the person's own click in Acira's Downloads list, but the transfer it starts runs in a website tab
// (the profile's source tab). The "wants to download several files" rule (a second download from one tab within 10 s) counted it as the page's
// doing: a Retry soon after the first download of that tab was held behind a question card that sits on the website tab, out of sight while
// the person is on the Downloads page. The row stayed Paused at 0 KB, with Cancel as the only way out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');

class Item extends EventEmitter {
  constructor(name, {url = 'https://files.example/' + name, total = 10} = {}) {
    super(); Object.assign(this, {name, url, total, offset: 0, saved: '', paused: false, locked: null});
    setImmediate(() => { this.locked = this.saved; });
  }
  getURL() { return this.url; } getURLChain() { return [this.url]; } getFilename() { return this.locked ? path.basename(this.locked) : this.name; } getSavePath() { return this.saved; }
  getReceivedBytes() { return this.offset; } getTotalBytes() { return this.total; } getMimeType() { return 'application/octet-stream'; } getETag() { return '"e"'; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return this.paused; } pause() { this.paused = true; } resume() { this.paused = false; }
  setSavePath(file) { this.saved = file; }
  cancel() { if (this.locked) fs.rmSync(this.locked, {force: true}); this.emit('done', {}, 'cancelled'); }
  finish(text = '0123456789') { this.locked ||= this.saved; fs.mkdirSync(path.dirname(this.locked), {recursive: true}); fs.writeFileSync(this.locked, text); this.offset = this.total; this.emit('done', {}, 'completed'); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return; await wait(5); } assert.fail(label); };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-retry-')), folder = path.join(dir, 'Downloads'), userData = path.join(dir, 'userData'), records = [], asked = [], started = [];
  fs.mkdirSync(folder, {recursive: true});
  const preferences = createDownloadPreferences({file: path.join(userData, 'download-preferences.json'), defaultFolder: folder});
  const session = new EventEmitter(), clock = {now: 1_000_000};
  const begin = item => { started.push(item); session.emit('will-download', {preventDefault() { throw new Error('refused'); }}, item, wc); return item; };
  // The source tab: downloadURL starts the next transfer in it, like Electron's.
  const wc = {session, isDestroyed: () => false, downloadURL: url => begin(new Item(path.basename(url), {url}))};
  const owner = {profileId: 'A', tabId: 'tab-1', window: {}, controller: {}, toast() {},
    record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }};
  // The question card never answers: it sits on a website tab the person is not looking at.
  const service = createDownloads({getOwner: contents => (contents === wc ? owner : null), askSite: async (...args) => { asked.push(args); return new Promise(() => {}); }, preferences,
    dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async () => ({response: 1})},
    app: {getPath: () => folder, getFileIcon: async () => ({isEmpty: () => false})}, shell: {showItemInFolder() {}, openPath: async () => ''}, journalPath: path.join(userData, 'download-recovery.json'), now: () => clock.now});
  service.attach(session);
  return {dir, folder, records, asked, started, service, wc, begin, clock, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('Retry soon after the first download of the source tab is not held behind the "several files" question', async () => {
  const f = setup();
  try {
    const first = f.begin(new Item('report.bin'));
    await until(() => !first.paused && f.records[0]?.status === 'Downloading', 'the first download runs');
    first.cancel();
    await until(() => f.records[0].status === 'Cancelled', 'cancelled');
    f.clock.now += 3000; // a few seconds later: well inside the 10 s window
    await f.service.command(f.records[0].id, 'retry', 'A', f.records, {webContents: f.wc});
    const again = f.started[1];
    assert.ok(again, 'Retry started a new transfer');
    await until(() => !again.paused, 'the retry flows (it was held behind a question nobody can see)');
    assert.equal(f.asked.length, 0, 'the person pressed Retry themselves: no "wants to download several files" question');
    again.finish();
    await until(() => f.records.some(r => r.id !== f.records[0].id && r.status === 'Ready'), 'the retry finishes');
  } finally { f.cleanup(); }
});

test('Retry does not open the door to a page: a second download the page starts right after still asks', async () => {
  const f = setup();
  try {
    const first = f.begin(new Item('one.bin'));
    await until(() => !first.paused, 'first runs');
    first.cancel();
    await until(() => f.records[0].status === 'Cancelled', 'cancelled');
    await f.service.command(f.records[0].id, 'retry', 'A', f.records, {webContents: f.wc});
    await until(() => !f.started[1].paused, 'retry flows');
    f.begin(new Item('two.bin')); // the page starts another one right away: this is a burst
    await until(() => f.asked.length === 1, 'the page\'s second download is asked about');
  } finally { f.cleanup(); }
});

test('a transfer held behind the question offers Cancel, not a Resume that can only answer "Choose a download destination first."', async () => {
  const f = setup();
  try {
    const first = f.begin(new Item('one.bin'));
    await until(() => !first.paused, 'first runs');
    const second = f.begin(new Item('two.bin')); // a second download from the same tab within 10 s: held behind the question nobody answers
    await until(() => f.asked.length === 1, 'the question is asked');
    second.emit('updated', {}, 'progressing'); // the pause we made is reported, and the row appears as Paused
    await until(() => f.records.some(r => r.name === 'two.bin'), 'the held row is listed');
    const held = f.service.reconcile(f.records, 'A').find(r => r.name === 'two.bin');
    assert.equal(held.status, 'Paused');
    assert.equal(held.canResume, false, 'nothing can be resumed before the question is answered');
    assert.equal(held.canCancel, true, 'Cancel stays');
    assert.equal(held.canPause, false);
    await assert.rejects(f.service.command(held.id, 'resume', 'A', f.records, {}), /destination/i, 'and the command would only have refused');
  } finally { f.cleanup(); }
});
