'use strict';
// 13.5. A download running when Acira quits (Cmd+Q, Quit, Install now) used to come back Interrupted with Retry from zero:
// Chromium cancels what is still running as the browser shuts down, and a cancel deletes the partial file. A crash never got that far and left the
// partial, which the journal resumes. keepForQuit (called by main at will-quit, when the quit is certain) leaves the bytes under a second name beside
// the file, and the next start puts them back. And an interruption Chromium is not resuming by itself (a full disk) says so with the failure toast.
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
  constructor(name, {url = 'https://files.example/' + name, total = 100} = {}) {
    super(); Object.assign(this, {name, url, total, offset: 0, saved: '', paused: false, locked: null, resumable: true});
    setImmediate(() => { this.locked = this.saved; });
  }
  getURL() { return this.url; } getURLChain() { return [this.url]; } getFilename() { return this.locked ? path.basename(this.locked) : this.name; } getSavePath() { return this.saved; }
  getReceivedBytes() { return this.offset; } getTotalBytes() { return this.total; } getMimeType() { return 'application/octet-stream'; } getETag() { return '"e"'; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return this.resumable; } pause() { this.paused = true; } resume() { this.paused = false; }
  setSavePath(file) { this.saved = file; }
  /** What Chromium does as it shuts down, and for a person's Cancel: the partial is deleted and the item is cancelled. */
  cancel() { if (this.locked) fs.rmSync(this.locked, {force: true}); this.emit('done', {}, 'cancelled'); }
  /** Bytes written so far, then a progress event. */
  write(text) { fs.writeFileSync(this.locked, text); this.offset = text.length; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return; await wait(5); } assert.fail(label); };

function setup({owner: ownerPatch = {}, interruptedAfter = 40} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-quit-')), folder = path.join(dir, 'Downloads'), userData = path.join(dir, 'userData'), records = [], toasts = [];
  fs.mkdirSync(folder, {recursive: true});
  const preferences = createDownloadPreferences({file: path.join(userData, 'download-preferences.json'), defaultFolder: folder});
  const session = new EventEmitter(), wc = {session, isDestroyed: () => false}, clock = {now: 1_000_000};
  const owner = {profileId: 'A', tabId: 'tab-1', window: {}, controller: {}, toast: (text, options) => toasts.push({text, ...options}),
    record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }, ...ownerPatch};
  const make = () => createDownloads({getOwner: contents => (contents === wc ? owner : null), askSite: async () => true, preferences, interruptedAfter,
    dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async () => ({response: 1})},
    app: {getPath: () => folder, getFileIcon: async () => ({isEmpty: () => false})}, shell: {showItemInFolder() {}, openPath: async () => ''}, journalPath: path.join(userData, 'download-recovery.json'), now: () => clock.now});
  const service = make();
  service.attach(session);
  const begin = item => { session.emit('will-download', {preventDefault() { throw new Error('refused'); }}, item, wc); return item; };
  const journal = () => JSON.parse(fs.readFileSync(path.join(userData, 'download-recovery.json'), 'utf8')).entries;
  return {dir, folder, userData, records, toasts, service, session, wc, begin, make, clock, journal, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
/** A transfer that is half done: 40 of 100 bytes on disk, the journal written. */
async function halfDone(f, name = 'big.bin') {
  const item = f.begin(new Item(name));
  await tick(); await tick();
  item.write('x'.repeat(40)); f.clock.now += 2000; item.emit('updated', {}, 'progressing');
  // (this file predates the simulated restart, as in download-flow.test.cjs)
  const before = new Date(Date.now() - 1000); fs.utimesSync(item.locked, before, before);
  return item;
}
const hidden = f => fs.readdirSync(f.folder).filter(name => name.endsWith('.acira-partial'));

test('a download running at a clean quit is still there after the restart: the partial survives Chromium\'s shutdown cancel and Resume is offered', async () => {
  const f = setup();
  try {
    const item = await halfDone(f);
    const records = f.records.map(r => ({...r}));
    assert.equal(records[0].status, 'Downloading');
    assert.equal(f.service.keepForQuit(), true, 'main tells the engine the quit is certain');
    assert.equal(hidden(f).length, 1, 'the bytes have a second name beside the file');
    item.cancel(); // Chromium, shutting down: deletes its name and cancels
    assert.equal(fs.existsSync(item.locked), false, 'Chromium took its own name');
    const saved = f.journal();
    assert.equal(saved.length, 1, 'the cancel at shutdown did not clear the journal (it is not the person\'s Cancel)');
    assert.equal(saved[0].offset, 40);
    assert.equal(f.records[0].status, 'Downloading', 'and wrote no Cancelled row');
    // the next start
    const next = f.make();
    assert.equal(fs.readFileSync(item.locked, 'utf8'), 'x'.repeat(40), 'the bytes are back under the real name');
    assert.deepEqual(hidden(f), [], 'the second name is gone');
    const shown = next.reconcile(records, 'A')[0];
    assert.equal(shown.status, 'Interrupted');
    assert.equal(shown.canResume, true, 'Resume works after the restart');
    assert.equal(shown.canCancel, true);
    await next.command(shown.id, 'cancel', 'A', records);
    assert.equal(fs.existsSync(item.locked), false, 'Cancel still removes the partial');
  } finally { f.cleanup(); }
});

test('a private download is not kept across a quit', async () => {
  const f = setup({owner: {profileId: 'private-1', private: true, recordProfileId: 'A'}});
  try {
    const item = await halfDone(f, 'secret.bin');
    assert.equal(f.service.keepForQuit(), false);
    assert.deepEqual(hidden(f), [], 'no second name for a private transfer');
    item.cancel();
    assert.equal(fs.readdirSync(f.folder).length, 0, 'Chromium\'s cancel deleted it, as it always did');
  } finally { f.cleanup(); }
});

test('a folder that cannot hold a second name keeps the old behaviour for that file, and the journal is left clean', async () => {
  const f = setup();
  const link = fs.linkSync;
  try {
    const item = await halfDone(f);
    fs.linkSync = () => { throw Object.assign(new Error('not supported'), {code: 'EPERM'}); };
    f.service.keepForQuit();
    fs.linkSync = link;
    item.cancel();
    assert.deepEqual(f.journal(), [], 'nothing to resume from: no stale entry');
  } finally { fs.linkSync = link; f.cleanup(); }
});

test('the start puts the second name back only for a name this engine made, in the transfer\'s own folder', async () => {
  const f = setup();
  try {
    const item = await halfDone(f);
    const outside = path.join(f.dir, 'precious.txt'); fs.writeFileSync(outside, 'mine');
    const journalFile = path.join(f.userData, 'download-recovery.json'), entries = f.journal();
    entries[0].quitLink = outside; // a journal that points somewhere else
    fs.writeFileSync(journalFile, JSON.stringify({version: 1, entries}));
    f.make();
    assert.equal(fs.readFileSync(outside, 'utf8'), 'mine', 'a file the engine did not make is never moved or removed');
    assert.equal(fs.readFileSync(item.locked, 'utf8'), 'x'.repeat(40), 'and the real file was not touched');
  } finally { f.cleanup(); }
});

test('a start that finds both the file and the second name (Chromium did not delete) keeps the file and drops the second name', async () => {
  const f = setup();
  try {
    const item = await halfDone(f);
    f.service.keepForQuit(); // no cancel: the process was killed before Chromium shut down
    assert.equal(hidden(f).length, 1);
    f.make();
    assert.deepEqual(hidden(f), []);
    assert.equal(fs.readFileSync(item.locked, 'utf8'), 'x'.repeat(40));
  } finally { f.cleanup(); }
});

test('an interruption that does not go away says so: the failure toast with Resume, once for each interruption', async () => {
  const f = setup();
  try {
    const item = f.begin(new Item('disk.bin'));
    await tick(); await tick();
    item.write('x'.repeat(40)); f.clock.now += 2000; item.emit('updated', {}, 'progressing');
    f.toasts.length = 0;
    // a blip: Chromium's own retry gets it moving again inside the wait
    item.emit('updated', {}, 'interrupted'); await wait(10); item.emit('updated', {}, 'progressing'); await wait(90);
    assert.equal(f.toasts.length, 0, 'a transfer that moves again says nothing');
    // the disk is full: it stays interrupted
    f.clock.now += 2000; item.emit('updated', {}, 'interrupted');
    await until(() => f.toasts.length === 1, 'the failure toast');
    assert.match(f.toasts[0].text, /disk\.bin couldn.t be downloaded/);
    assert.equal(f.toasts[0].tone, 'error');
    assert.deepEqual(f.toasts[0].action.command, {type: 'download.act', id: f.records[0].id, command: 'resume'});
    // the command has to get through the interface's own validation and main's handler (13.4's list allowed only open and retry: the button did nothing)
    const {validateAction} = require('../desktop/validation.cjs');
    assert.doesNotThrow(() => validateAction({...f.toasts[0].action.command, id: 'download-' + f.records[0].id.replace(/^download-/, '')}), 'the toast\'s Resume passes validation');
    const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), act = main.slice(main.indexOf("if(action.type==='download.act')"), main.indexOf("if(action.type==='tab.move-window')"));
    assert.match(act, /\['retry','resume'\]\.includes\(action\.command\)\?await downloadSource/, 'and gets the profile\'s source page like the Downloads page\'s own Resume');
    assert.equal(f.records[0].status, 'Interrupted');
    f.clock.now += 2000; item.emit('updated', {}, 'interrupted'); await wait(90);
    assert.equal(f.toasts.length, 1, 'told once for this interruption');
    // it moves, then stops again: a new interruption, told again
    item.emit('updated', {}, 'progressing'); f.clock.now += 2000; item.emit('updated', {}, 'interrupted');
    await until(() => f.toasts.length === 2, 'told again for the next interruption');
  } finally { f.cleanup(); }
});

test('no failure toast for a transfer the person paused, one that is over, or one whose browser is quitting', async () => {
  const f = setup();
  try {
    const paused = f.begin(new Item('p.bin')); await tick(); await tick();
    paused.write('x'.repeat(40)); paused.emit('updated', {}, 'progressing'); f.toasts.length = 0;
    paused.paused = true; paused.emit('updated', {}, 'interrupted');
    const over = f.begin(new Item('o.bin')); await tick(); await tick();
    over.write('x'.repeat(40)); over.emit('updated', {}, 'progressing');
    over.emit('updated', {}, 'interrupted'); over.cancel(); // the person cancelled before the wait ended
    const going = f.begin(new Item('q.bin')); await tick(); await tick();
    going.write('x'.repeat(40)); going.emit('updated', {}, 'progressing');
    going.emit('updated', {}, 'interrupted'); f.service.keepForQuit();
    f.toasts.length = 0; await wait(120);
    assert.deepEqual(f.toasts.map(toast => toast.text), []);
  } finally { f.cleanup(); }
});

test('a paused download, a download of another window and a second call: all kept, none twice', async () => {
  const f = setup();
  try {
    const one = await halfDone(f, 'one.bin'), two = f.begin(new Item('two.bin'));
    await tick(); await tick(); two.write('y'.repeat(30)); f.clock.now += 2000; two.emit('updated', {}, 'progressing');
    const before = new Date(Date.now() - 1000); fs.utimesSync(two.locked, before, before);
    one.pause(); one.emit('updated', {}, 'progressing'); // a paused transfer reports its state as progressing with isPaused()
    assert.equal(f.service.keepForQuit(), true);
    assert.equal(f.service.keepForQuit(), true, 'asked again (a second will-quit): the same two second names');
    assert.equal(hidden(f).length, 2);
    one.cancel(); two.cancel();
    assert.equal(f.journal().length, 2);
    const next = f.make(), shown = next.reconcile(f.records.map(r => ({...r})), 'A');
    assert.deepEqual(shown.map(r => r.canResume), [true, true]);
    assert.equal(fs.readFileSync(one.locked, 'utf8'), 'x'.repeat(40)); assert.equal(fs.readFileSync(two.locked, 'utf8'), 'y'.repeat(30));
    assert.deepEqual(hidden(f), []);
  } finally { f.cleanup(); }
});

test('a download the person cancelled before the quit does not come back, and a finished one is left alone', async () => {
  const f = setup();
  try {
    const cancelled = await halfDone(f, 'no.bin');
    cancelled.cancel(); // the person's Cancel: the journal entry goes at once
    assert.deepEqual(f.journal(), []);
    const finished = f.begin(new Item('done.bin', {total: 5}));
    await tick(); await tick(); finished.write('abcde'); finished.offset = 5; finished.emit('done', {}, 'completed');
    await until(() => f.records.find(r => r.name === 'done.bin')?.status === 'Ready', 'ready');
    assert.equal(f.service.keepForQuit(), false, 'nothing is running');
    assert.deepEqual(hidden(f), []);
    assert.equal(fs.readFileSync(finished.locked, 'utf8'), 'abcde');
    finished.emit('done', {}, 'completed'); // a stray second event after the quit began changes nothing
    const next = f.make();
    assert.deepEqual(next.reconcile(f.records.map(r => ({...r})), 'A').filter(r => r.canResume), []);
    assert.equal(fs.readFileSync(finished.locked, 'utf8'), 'abcde');
  } finally { f.cleanup(); }
});

test('Resume after the restart hands the native resume the real name, the held offset, the length and the validators', async () => {
  const f = setup();
  try {
    const item = await halfDone(f, 'r.bin');
    f.service.keepForQuit(); item.cancel();
    const next = f.make(), records = f.records.map(r => ({...r}));
    next.attach(f.session);
    let made = null; f.session.createInterruptedDownload = options => { made = options; };
    await next.command(records[0].id, 'resume', 'A', records, {webContents: f.wc});
    assert.equal(made.path, item.locked); assert.equal(made.offset, 40); assert.equal(made.length, 100); assert.equal(made.eTag, '"e"');
    assert.deepEqual(made.urlChain, ['https://files.example/r.bin']);
  } finally { f.cleanup(); }
});
