'use strict';
// The beta.10 review of the download flow (browser-services/download-engine.cjs): files that finish before the person has answered, two
// downloads aimed at one name, moves that fail or cross drives, Cancel on an old crash row, long names while parked, and what a crash
// leaves behind a held or parked transfer. The fake item keeps Electron's rules: the save path is read once, right after will-download
// returns; getFilename() is the server's name whatever the path; a paused item can still finish with what had already arrived; Cancel on a
// finished item does nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
// The usual rig environment puts the engine in test mode (no Save dialog, a test download folder): these tests drive the real flow.
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');

class Item extends EventEmitter {
  constructor(name, {url = 'https://files.example/' + encodeURIComponent(name), total = 10} = {}) {
    super(); Object.assign(this, {name, url, total, offset: 0, saved: '', paused: false, locked: null, finished: false});
    setImmediate(() => { this.locked = this.saved; });
  }
  getURL() { return this.url; } getURLChain() { return [this.url]; } getFilename() { return this.name; } getSavePath() { return this.saved; }
  getReceivedBytes() { return this.offset; } getTotalBytes() { return this.total; } getMimeType() { return 'application/octet-stream'; } getETag() { return '"e"'; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return this.paused; } pause() { this.paused = true; } resume() { this.paused = false; }
  setSavePath(file) { this.saved = file; }
  cancel() { if (this.finished) return; this.finished = true; if (this.locked) fs.rmSync(this.locked, {force: true}); this.emit('done', {}, 'cancelled'); }
  /** Bytes arrive where Electron locked the path, paused or not (what had arrived before the pause still finishes). */
  write(text) { fs.mkdirSync(path.dirname(this.locked), {recursive: true}); fs.writeFileSync(this.locked, text); this.offset = Buffer.byteLength(text); }
  finish(text = '0123456789') { this.write(text); this.total = this.offset; this.finished = true; this.emit('done', {}, 'completed'); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return; await wait(5); } assert.fail(label); };
const list = folder => { try { return fs.readdirSync(folder).sort(); } catch { return []; } };

function setup({askWhere = false, askSite = async () => true, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-review-'))} = {}) {
  const folder = path.join(dir, 'Downloads'), userData = path.join(dir, 'userData'), records = [], toasts = [], defaults = [], replies = [];
  fs.mkdirSync(folder, {recursive: true});
  const preferences = createDownloadPreferences({file: path.join(userData, 'download-preferences.json'), defaultFolder: folder});
  if (askWhere) preferences.set({askWhere: true});
  const session = new EventEmitter(), retried = [], wc = {session, isDestroyed: () => false, downloadURL: url => retried.push(url)}, clock = {now: Date.now()};
  const owner = {profileId: 'A', tabId: 'tab-1', window: {}, controller: {}, toast: (text, options) => toasts.push({text, ...options}),
    record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }};
  // Each Save dialog waits for the test to answer it: reply(n, answer).
  const make = () => createDownloads({getOwner: contents => (contents === wc ? owner : null), askSite, preferences,
    dialog: {showSaveDialog: (_window, options) => { defaults.push(options.defaultPath); return new Promise(resolve => replies.push(resolve)); }, showMessageBox: async () => ({response: 1})},
    app: {getPath: () => folder}, shell: {showItemInFolder() {}, openPath: async () => ''}, journalPath: path.join(userData, 'download-recovery.json'), now: () => clock.now});
  const service = make();
  service.attach(session);
  const begin = item => { session.emit('will-download', {preventDefault() {}}, item, wc); return item; };
  const reply = (n, answer) => replies[n](answer);
  const journal = () => { try { return JSON.parse(fs.readFileSync(path.join(userData, 'download-recovery.json'), 'utf8')).entries; } catch { return []; } };
  const staging = path.join(userData, 'download-staging');
  return {dir, folder, userData, staging, records, toasts, defaults, replies, retried, reply, service, session, wc, begin, make, clock, journal, preferences, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const byName = (f, name) => f.records.find(r => path.basename(r.path) === name);

test('1. a small file that finishes while the "several files" question is open: Block deletes it, Allow keeps it where its row says', async () => {
  for (const allow of [false, true]) {
    let answer;
    const f = setup({askSite: () => new Promise(resolve => { answer = resolve; })});
    try {
      const first = f.begin(new Item('one.txt'));
      await tick(); await tick(); first.finish('one');
      const held = f.begin(new Item('two.txt'));
      await until(() => typeof answer === 'function', 'the question is up');
      await tick(); await tick();
      held.finish('two, all of it had arrived');
      await wait(30);
      assert.notEqual(f.records[1]?.status, 'Ready', 'not finished before the answer');
      answer(allow);
      await until(() => ['Ready', 'Cancelled'].includes(f.records[1]?.status), 'answered');
      if (allow) {
        assert.equal(f.records[1].status, 'Ready');
        assert.equal(f.records[1].path, path.join(f.folder, 'two.txt'), 'the row has its path');
        assert.equal(fs.readFileSync(path.join(f.folder, 'two.txt'), 'utf8'), 'two, all of it had arrived');
      } else {
        assert.equal(f.records[1].status, 'Cancelled');
        assert.deepEqual(list(f.folder), ['one.txt'], 'Block leaves nothing');
        assert.ok(!f.toasts.some(t => t.text === 'two.txt downloaded'), 'no "downloaded" toast for a blocked file');
        assert.ok(f.toasts.some(t => /Blocked repeated downloads/.test(t.text)));
      }
      assert.deepEqual(f.journal().filter(e => e.id === f.records[1].id), [], 'nothing left in the journal');
    } finally { f.cleanup(); }
  }
});

test('2. two "Ask where" downloads of one name answered with the same name: two files, both intact, nothing replaced', async () => {
  const f = setup({askWhere: true});
  try {
    const a = f.begin(new Item('attachment.pdf')), b = f.begin(new Item('attachment.pdf'));
    await until(() => f.replies.length === 2, 'both dialogs open');
    const same = path.join(f.folder, 'attachment.pdf');
    f.reply(0, {canceled: false, filePath: same}); f.reply(1, {canceled: false, filePath: same});
    await until(() => !a.paused && !b.paused, 'both answered');
    a.finish('FIRST'); b.finish('SECOND');
    await until(() => f.records.length === 2 && f.records.every(r => r.status === 'Ready'), 'both Ready');
    assert.deepEqual(list(f.folder), ['attachment (1).pdf', 'attachment.pdf']);
    assert.deepEqual(f.records.map(r => fs.readFileSync(r.path, 'utf8')).sort(), ['FIRST', 'SECOND']);
    assert.notEqual(f.records[0].path, f.records[1].path);
    // A third dialog opened while the name is taken suggests the next free one.
    const c = f.begin(new Item('attachment.pdf'));
    await until(() => f.replies.length === 3, 'third dialog');
    assert.equal(path.basename(f.defaults[2]), 'attachment (2).pdf');
    f.reply(2, {canceled: true}); await tick(); c.cancel();
  } finally { f.cleanup(); }
});

test('2. an "Ask where" download and a direct one of the same name: the direct one takes the next free name', async () => {
  const f = setup({askWhere: true});
  try {
    const asked = f.begin(new Item('x.bin'));
    await until(() => f.replies.length === 1, 'dialog');
    f.reply(0, {canceled: false, filePath: path.join(f.folder, 'x.bin')});
    await until(() => !asked.paused, 'answered');
    f.preferences.set({askWhere: false});
    const direct = f.begin(new Item('x.bin'));
    await tick(); await tick();
    assert.equal(path.basename(direct.locked), 'x (1).bin', 'the answered name is taken while its file is still coming');
    direct.finish('DIRECT'); asked.finish('ASKED');
    await until(() => f.records.length === 2 && f.records.every(r => r.status === 'Ready'), 'both Ready');
    assert.equal(fs.readFileSync(path.join(f.folder, 'x.bin'), 'utf8'), 'ASKED');
    assert.equal(fs.readFileSync(path.join(f.folder, 'x (1).bin'), 'utf8'), 'DIRECT');
  } finally { f.cleanup(); }
});

test('2. a file that appears at the chosen place after the answer keeps its place; one that was there when the person answered (Replace) is replaced', async () => {
  for (const when of ['after', 'before']) {
    const f = setup({askWhere: true});
    try {
      const chosen = path.join(f.dir, 'Elsewhere', 'report.pdf');
      fs.mkdirSync(path.dirname(chosen), {recursive: true});
      if (when === 'before') fs.writeFileSync(chosen, 'OLD');
      const item = f.begin(new Item('report.pdf'));
      await until(() => f.replies.length === 1, 'dialog');
      f.reply(0, {canceled: false, filePath: chosen});
      await until(() => !item.paused, 'answered');
      if (when === 'after') fs.writeFileSync(chosen, 'ANOTHER PROGRAM');
      item.finish('NEW');
      await until(() => f.records[0]?.status === 'Ready', 'Ready');
      if (when === 'after') {
        assert.equal(fs.readFileSync(chosen, 'utf8'), 'ANOTHER PROGRAM', 'not overwritten');
        assert.equal(f.records[0].path, path.join(path.dirname(chosen), 'report (1).pdf'));
        assert.equal(fs.readFileSync(f.records[0].path, 'utf8'), 'NEW');
      } else {
        assert.equal(fs.readFileSync(chosen, 'utf8'), 'NEW', 'the person confirmed Replace in the dialog');
        assert.equal(f.records[0].path, chosen);
      }
    } finally { f.cleanup(); }
  }
});

/** fs.promises.rename / copyFile / unlink stubbed for one test: rules(from, to) returns an error code to throw, or nothing to let it through. */
async function withFs(rules, run) {
  const real = {rename: fs.promises.rename, copyFile: fs.promises.copyFile, unlink: fs.promises.unlink};
  const fail = code => Object.assign(new Error(code), {code});
  fs.promises.rename = async (from, to) => { const code = rules.rename?.(from, to); if (code) throw fail(code); return real.rename(from, to); };
  fs.promises.copyFile = async (from, to, mode) => { const code = rules.copyFile?.(from, to); if (code) { fs.writeFileSync(to, 'PART'); throw fail(code); } return real.copyFile(from, to, mode); };
  fs.promises.unlink = async file => { const code = rules.unlink?.(file); if (code) throw fail(code); return real.unlink(file); };
  try { return await run(); } finally { Object.assign(fs.promises, real); }
}

test('3. when neither the chosen place nor the download folder can take the file, the download fails with Retry; nothing points into staging', async () => {
  const f = setup({askWhere: true});
  try {
    const chosen = path.join(f.dir, 'USB', 'big.iso');
    await withFs({rename: () => 'EACCES'}, async () => {
      const item = f.begin(new Item('big.iso'));
      await until(() => f.replies.length === 1, 'dialog');
      f.reply(0, {canceled: false, filePath: chosen});
      await until(() => !item.paused, 'answered');
      item.finish('FINISHED');
      await until(() => ['Ready', 'Interrupted'].includes(f.records[0]?.status), 'ended', 8000);
    });
    const row = f.records[0];
    assert.equal(row.status, 'Interrupted', 'not Ready');
    assert.equal(row.path, chosen, 'the row names where it was meant to go');
    assert.equal(row.canRetry, true);
    const toast = f.toasts.at(-1);
    assert.equal(toast.tone, 'error');
    assert.equal(toast.text, 'big.iso couldn’t be saved. Check the folder or drive, then retry.');
    assert.deepEqual(toast.action.command, {type: 'download.act', id: row.id, command: 'retry'});
    assert.ok(!stagedPath(f, row.path));
    assert.deepEqual(f.journal().filter(e => e.id === row.id), [], 'no journal entry for it');
    assert.deepEqual(list(f.staging), [], 'its staging folder is gone');
    assert.deepEqual(list(f.folder), []);
  } finally { f.cleanup(); }
});
const stagedPath = (f, file) => file.startsWith(f.staging + path.sep);

test('4. a move to another drive never leaves a cut-short file under the real name, never loses a file being replaced, and a held source after a good copy is a success', async () => {
  // The copy fails part-way (the stick is full): nothing under the chosen name, no temporary file left; the download folder takes it.
  {
    const f = setup({askWhere: true});
    try {
      const chosen = path.join(f.dir, 'USB', 'movie.mkv');
      await withFs({rename: (from, to) => (to === chosen && stagedPath(f, from) ? 'EXDEV' : null), copyFile: () => 'ENOSPC'}, async () => {
        const item = f.begin(new Item('movie.mkv'));
        await until(() => f.replies.length === 1, 'dialog');
        f.reply(0, {canceled: false, filePath: chosen});
        await until(() => !item.paused, 'answered');
        item.finish('FULL MOVIE');
        await until(() => f.records[0]?.status === 'Ready', 'Ready');
      });
      assert.deepEqual(list(path.dirname(chosen)), [], 'no cut-short file and no temporary one on the stick');
      assert.equal(f.records[0].path, path.join(f.folder, 'movie.mkv'));
      assert.equal(fs.readFileSync(f.records[0].path, 'utf8'), 'FULL MOVIE');
      assert.match(f.toasts.at(-1).text, /couldn’t be saved where you chose/);
    } finally { f.cleanup(); }
  }
  // Replace across drives, and the copy fails: the file being replaced is still whole.
  {
    const f = setup({askWhere: true});
    try {
      const chosen = path.join(f.dir, 'USB', 'notes.txt');
      fs.mkdirSync(path.dirname(chosen), {recursive: true}); fs.writeFileSync(chosen, 'THE ORIGINAL');
      await withFs({rename: (from, to) => (to === chosen && stagedPath(f, from) ? 'EXDEV' : null), copyFile: () => 'EIO'}, async () => {
        const item = f.begin(new Item('notes.txt'));
        await until(() => f.replies.length === 1, 'dialog');
        f.reply(0, {canceled: false, filePath: chosen});
        await until(() => !item.paused, 'answered');
        item.finish('NEW');
        await until(() => f.records[0]?.status === 'Ready', 'Ready');
      });
      assert.equal(fs.readFileSync(chosen, 'utf8'), 'THE ORIGINAL');
      assert.deepEqual(list(path.dirname(chosen)), ['notes.txt']);
    } finally { f.cleanup(); }
  }
  // The copy is in place but the source stays held (an antivirus scan of the staged file): one file, where chosen, and the usual toast.
  {
    const f = setup({askWhere: true});
    try {
      const chosen = path.join(f.dir, 'USB', 'tool.zip');
      await withFs({rename: (from, to) => (to === chosen && stagedPath(f, from) ? 'EXDEV' : null), unlink: file => (file.startsWith(f.staging) ? 'EBUSY' : null)}, async () => {
        const item = f.begin(new Item('tool.zip'));
        await until(() => f.replies.length === 1, 'dialog');
        f.reply(0, {canceled: false, filePath: chosen});
        await until(() => !item.paused, 'answered');
        item.finish('ZIP');
        await until(() => f.records[0]?.status === 'Ready', 'Ready');
      });
      assert.equal(f.records[0].path, chosen);
      assert.equal(fs.readFileSync(chosen, 'utf8'), 'ZIP');
      assert.deepEqual(list(f.folder), [], 'no second copy in the download folder');
      assert.equal(f.toasts.at(-1).text, 'tool.zip downloaded');
    } finally { f.cleanup(); }
  }
});

test('5. Cancel on an old crash row keeps a file of unknown size, and a file older than the transfer last wrote', async () => {
  for (const [label, total, content, age] of [['unknown size, complete copy', 0, 'COMPLETE FILE '.repeat(100), 60_000], ['known size, older than the journal', 100, 'x'.repeat(40), 60_000]]) {
    const f = setup();
    try {
      const item = f.begin(new Item('export.zip', {total}));
      await tick(); await tick();
      item.write('x'.repeat(40)); item.total = total; f.clock.now += 2000; item.emit('updated', {}, 'progressing');
      const records = f.records.map(r => ({...r}));
      fs.writeFileSync(item.locked, content);
      const old = new Date(Date.now() - age); fs.utimesSync(item.locked, old, old);
      const next = f.make();
      await next.command(records[0].id, 'cancel', 'A', records);
      assert.equal(fs.readFileSync(item.locked, 'utf8'), content, label + ': kept');
    } finally { f.cleanup(); }
  }
});

test('6. a parked transfer has a short name of its own, so a very long name never makes it fail; it lands under the chosen name', async () => {
  const f = setup({askWhere: true});
  try {
    const long = 'Quarterly report '.repeat(18) + 'final.pdf';
    assert.ok(Buffer.byteLength(long) > 255);
    const item = f.begin(new Item(long));
    await tick(); await tick();
    assert.equal(path.basename(item.locked), 'download.pdf');
    assert.ok(Buffer.byteLength(path.basename(f.defaults[0])) <= 255, 'the dialog suggests a name the file system takes');
    assert.equal(f.records.length, 0);
    const chosen = path.join(f.dir, 'Elsewhere', 'report.pdf');
    f.reply(0, {canceled: false, filePath: chosen});
    await until(() => !item.paused, 'answered');
    item.finish('PDF');
    await until(() => f.records[0]?.status === 'Ready', 'Ready');
    assert.equal(fs.readFileSync(chosen, 'utf8'), 'PDF');
    // Before the answer the row (if Electron reports progress) shows the real name, not the parked one.
    const g = setup({askWhere: true});
    try { const parked = g.begin(new Item(long)); await tick(); await tick(); parked.emit('updated', {}, 'progressing'); assert.equal(g.records[0].name, long); g.reply(0, {canceled: true}); }
    finally { g.cleanup(); }
  } finally { f.cleanup(); }
});

test('7a. a transfer held behind the "several files" question is journaled; what a crash leaves under its real name goes at the next start', async () => {
  const f = setup({askSite: () => new Promise(() => {})});
  try {
    const first = f.begin(new Item('one.bin', {total: 100}));
    await tick(); await tick(); first.finish('x'.repeat(100));
    const held = f.begin(new Item('two.bin', {total: 100}));
    await tick(); await tick();
    const entry = f.journal().find(e => e.path === path.join(f.folder, 'two.bin'));
    assert.ok(entry && entry.held, 'journaled as held: ' + JSON.stringify(f.journal()));
    held.write('y'.repeat(30));
    // The crash: no 'done'. The next start removes the partial file and forgets the entry; the finished file stays.
    f.make();
    assert.deepEqual(list(f.folder), ['one.bin']);
    assert.deepEqual(f.journal().filter(e => e.held), []);
  } finally { f.cleanup(); }
});

test('7b. an "Ask where" download a crash stopped can be resumed after the restart and lands where the person chose', async () => {
  const f = setup({askWhere: true});
  try {
    const chosen = path.join(f.dir, 'Elsewhere', 'big.bin');
    const item = f.begin(new Item('big.bin', {total: 20}));
    await until(() => f.replies.length === 1, 'dialog');
    f.reply(0, {canceled: false, filePath: chosen});
    await until(() => !item.paused, 'answered');
    item.write('0123456789'); f.clock.now += 2000; item.emit('updated', {}, 'progressing');
    const records = f.records.map(r => ({...r}));
    assert.ok(stagedPath(f, f.journal()[0].path), 'the journal points into staging');
    // The crash, then the next start: the parked half is kept for Resume.
    const next = f.make();
    const shown = next.reconcile(records, 'A')[0];
    assert.equal(shown.status, 'Interrupted');
    assert.equal(shown.canResume, true, 'Resume is offered');
    let resumed;
    f.session.createInterruptedDownload = options => {
      resumed = new Item('big.bin', {total: 20}); resumed.saved = options.path; resumed.offset = options.offset; resumed.paused = true;
      f.session.emit('will-download', {preventDefault() {}}, resumed, null);
    };
    next.attach(f.session);
    await next.command(shown.id, 'resume', 'A', records, {webContents: f.wc});
    await until(() => resumed && !resumed.paused, 'resumed');
    fs.appendFileSync(resumed.saved, 'ABCDEFGHIJ'); resumed.offset = 20; resumed.finished = true; resumed.emit('done', {}, 'completed');
    await until(() => f.records.find(r => r.id === shown.id)?.status === 'Ready', 'Ready after Resume');
    assert.equal(fs.readFileSync(chosen, 'utf8'), '0123456789ABCDEFGHIJ');
    assert.deepEqual(list(f.staging), []);
  } finally { f.cleanup(); }
});

// Second review.

/** An "Ask where" download answered, 400 of 1000 bytes in, then stopped (interrupted, or a crash when `crash`). */
async function parkedHalf(f, name = 'half.bin', {total = 1000} = {}) {
  const item = f.begin(new Item(name, {total}));
  await until(() => f.replies.length >= 1, 'dialog');
  f.reply(f.replies.length - 1, {canceled: false, filePath: path.join(f.dir, 'Elsewhere', name)});
  await until(() => !item.paused, 'answered');
  item.write('x'.repeat(400)); item.total = total; f.clock.now += 2000; item.emit('updated', {}, 'progressing');
  return item;
}

test('second review 1: Retry leaves no parked partial and no address in the journal', async () => {
  {
    const f = setup({askWhere: true});
    try {
      const item = await parkedHalf(f);
      item.finished = true; item.emit('done', {}, 'interrupted');
      await until(() => f.records[0]?.status === 'Interrupted', 'Interrupted');
      assert.equal(f.journal().length, 1); assert.equal(list(f.staging).length, 1, 'kept for Resume');
      await f.service.command(f.records[0].id, 'retry', 'A', f.records.map(r => ({...r})), {webContents: f.wc});
      assert.equal(f.retried.length, 1, 'a new transfer started');
      assert.deepEqual(f.journal(), [], 'the old entry and its address are gone');
      assert.deepEqual(list(f.staging), [], 'and its parked partial');
    } finally { f.cleanup(); }
  }
});

test('second review 1: a row taken off the list (Remove, Clear browsing data, an extension\'s erase) leaves no parked partial and no address in the journal', async () => {
  {
    const f = setup({askWhere: true});
    try {
      await parkedHalf(f);
      const records = f.records.map(r => ({...r}));
      const next = f.make();
      assert.equal(next.reconcile(records, 'A')[0].canResume, true);
      next.forget([records[0].id]);
      assert.deepEqual(f.journal(), []);
      assert.deepEqual(list(f.staging), []);
      f.make();
      assert.deepEqual(list(f.staging), [], 'nothing comes back at the next start');
    } finally { f.cleanup(); }
  }
});

test('second review 1: an interrupted transfer Chromium still holds (it could resume) leaves nothing when its row is taken off the list, and its row doesn\'t come back', async () => {
  const f = setup({askWhere: true});
  try {
    const item = await parkedHalf(f);
    item.emit('updated', {}, 'interrupted'); // a resumable interruption: Electron says so in 'updated' and keeps the item
    await until(() => f.records[0]?.status === 'Interrupted', 'Interrupted');
    assert.equal(list(f.staging).length, 1); assert.equal(f.journal().length, 1);
    const id = f.records[0].id; f.records.length = 0; // the row is off the list
    f.service.forget([id]);
    await wait(30);
    assert.equal(item.finished, true, 'Chromium lets it go');
    assert.deepEqual(list(f.staging), []);
    assert.deepEqual(f.journal(), []);
    assert.deepEqual(f.records, [], 'its row is not written back');
  } finally { f.cleanup(); }
});

test('second review 1: a parked transfer that can\'t be resumed (size unknown) is not kept at the next start', async () => {
  {
    const f = setup({askWhere: true});
    try {
      await parkedHalf(f, 'stream.bin', {total: 0});
      assert.equal(f.journal().length, 1);
      f.make();
      assert.deepEqual(list(f.staging), []);
      assert.deepEqual(f.journal(), []);
    } finally { f.cleanup(); }
  }
});

test('second review 1: main.cjs tells the engine about rows taken off the list (Remove, Clear browsing data, an extension\'s erase)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), at = main.indexOf('function commitAction(action)'), body = main.slice(at, at + 1500);
  assert.match(body, /action\.type==='downloads\.remove'\|\|action\.type==='downloads\.clear'\|\|action\.type==='downloads\.erase'/);
  assert.match(body, /downloads\?\.forget\(previous\.downloads\.filter\(item=>!kept\.has\(item\.id\)\)\.map\(item=>item\.id\)\)/);
});

test('second review 2: a long name saved to another drive lands there (the temporary copy has a short name of its own)', async () => {
  const f = setup({askWhere: true});
  try {
    // 237 bytes: the longest name the dialog suggests (255 less room for " (9999)" and ".crdownload"); the old temporary name added 20.
    const name = 'Annual report 2026, final version '.repeat(7).slice(0, 233) + '.pdf', chosen = path.join(f.dir, 'USB', name);
    assert.equal(Buffer.byteLength(name), 237);
    await withFs({rename: (from, to) => (to === chosen && stagedPath(f, from) ? 'EXDEV' : null)}, async () => {
      const item = f.begin(new Item(name));
      await until(() => f.replies.length === 1, 'dialog');
      f.reply(0, {canceled: false, filePath: chosen});
      await until(() => !item.paused, 'answered');
      item.finish('PDF');
      await until(() => f.records[0]?.status === 'Ready', 'Ready');
    });
    assert.equal(f.records[0].path, chosen, 'not sent to the download folder');
    assert.equal(fs.readFileSync(chosen, 'utf8'), 'PDF');
    assert.deepEqual(list(path.dirname(chosen)), [name]);
  } finally { f.cleanup(); }
});

test('second review 3: a new copy held for a moment on the other drive is renamed again, not copied again', async () => {
  const f = setup({askWhere: true});
  try {
    const chosen = path.join(f.dir, 'USB', 'big.iso');
    let copies = 0, locks = 3;
    await withFs({rename: (from, to) => (to === chosen && stagedPath(f, from) ? 'EXDEV' : to === chosen && locks-- > 0 ? 'EBUSY' : null), copyFile: () => { copies++; return null; }}, async () => {
      const item = f.begin(new Item('big.iso'));
      await until(() => f.replies.length === 1, 'dialog');
      f.reply(0, {canceled: false, filePath: chosen});
      await until(() => !item.paused, 'answered');
      item.finish('BIG');
      await until(() => f.records[0]?.status === 'Ready', 'Ready', 6000);
    });
    assert.equal(copies, 1, 'copied once');
    assert.equal(f.records[0].path, chosen);
    assert.deepEqual(list(path.dirname(chosen)), ['big.iso'], 'no temporary file left');
  } finally { f.cleanup(); }
});

test('second review 4: choosing the name a direct download is still writing (and confirming Replace) gives the next free name; both files stay', async () => {
  const f = setup();
  try {
    const direct = f.begin(new Item('x.bin'));
    await tick(); await tick();
    direct.write('DIR'); // Electron writes a direct download under its real name as it arrives
    f.preferences.set({askWhere: true});
    const asked = f.begin(new Item('x.bin'));
    await until(() => f.replies.length === 1, 'dialog');
    f.reply(0, {canceled: false, filePath: path.join(f.folder, 'x.bin')}); // the Save panel asked "Replace?" (the file is there) and the person said yes
    await until(() => !asked.paused, 'answered');
    direct.finish('DIRECT'); asked.finish('ASKED');
    await until(() => f.records.length === 2 && f.records.every(r => r.status === 'Ready'), 'both Ready');
    assert.notEqual(f.records[0].path, f.records[1].path, 'two rows, two files');
    assert.equal(fs.readFileSync(path.join(f.folder, 'x.bin'), 'utf8'), 'DIRECT');
    assert.equal(fs.readFileSync(path.join(f.folder, 'x (1).bin'), 'utf8'), 'ASKED');
  } finally { f.cleanup(); }
});

test('second review 6: Allow after a held transfer stopped keeps it resumable after a restart', async () => {
  {
    let answer;
    const f = setup({askSite: () => new Promise(resolve => { answer = resolve; })});
    try {
      const first = f.begin(new Item('one.bin', {total: 100}));
      await tick(); await tick(); first.finish('x'.repeat(100));
      const held = f.begin(new Item('two.bin', {total: 100}));
      await until(() => typeof answer === 'function', 'the question is up'); await tick(); await tick();
      held.write('y'.repeat(30)); held.paused = true; held.finished = true; held.emit('done', {}, 'interrupted');
      answer(true); await wait(30);
      const entry = f.journal().find(e => e.path === path.join(f.folder, 'two.bin'));
      assert.ok(entry && !entry.held, 'journaled, no longer held: ' + JSON.stringify(entry));
      const records = f.records.map(r => ({...r})), next = f.make();
      assert.equal(fs.existsSync(path.join(f.folder, 'two.bin')), true, 'its partial survives the restart');
      assert.equal(next.reconcile(records, 'A').find(r => r.id === entry.id).canResume, true);
    } finally { f.cleanup(); }
  }
});

test('second review 6: a resumed "Ask where" transfer holds its final name against a new download of that name', async () => {
  {
    const f = setup({askWhere: true});
    try {
      await parkedHalf(f, 'big.bin');
      const records = f.records.map(r => ({...r})), next = f.make();
      next.attach(f.session);
      f.session.createInterruptedDownload = options => { const resumed = new Item('big.bin', {total: 1000}); resumed.saved = options.path; resumed.offset = options.offset; resumed.paused = true; f.session.emit('will-download', {preventDefault() {}}, resumed, null); };
      await next.command(records[0].id, 'resume', 'A', records, {webContents: f.wc});
      await wait(20);
      fs.mkdirSync(path.join(f.dir, 'Elsewhere'), {recursive: true}); f.preferences.set({askWhere: false, folder: path.join(f.dir, 'Elsewhere')});
      const direct = f.begin(new Item('big.bin'));
      await tick(); await tick();
      assert.equal(path.basename(direct.locked), 'big (1).bin', 'the resumed one\'s name is held');
    } finally { f.cleanup(); }
  }
});

test('second review 6: a held transfer whose bytes had all arrived when Acira stopped was never allowed, so it goes at the next start', async () => {
  {
    const f = setup({askSite: () => new Promise(() => {})});
    try {
      const first = f.begin(new Item('one.bin', {total: 100}));
      await tick(); await tick(); first.finish('x'.repeat(100));
      const held = f.begin(new Item('two.bin', {total: 100}));
      await tick(); await tick();
      held.write('y'.repeat(100));
      f.make();
      assert.deepEqual(list(f.folder), ['one.bin']);
    } finally { f.cleanup(); }
  }
});
