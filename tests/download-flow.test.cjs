'use strict';
// The download flow's hard cases (browser-services/download-engine.cjs). Electron reads a download's save path once, right after the
// will-download handler returns: a path set later is reported by getSavePath() but the file is written where the first one said, and with
// no path at all Electron opens its own second Save panel and waits on it (seen on Electron 44 on 3 Nov). The fake item below keeps that rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {execFileSync} = require('node:child_process');
// The usual rig environment puts the engine in test mode (no Save dialog, a test download folder): these tests drive the real flow.
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads, dangerous, markOfTheWeb, quarantine} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');

class Item extends EventEmitter {
  constructor(name, {url = 'https://files.example/' + name, total = 10} = {}) {
    super(); Object.assign(this, {name, url, total, offset: 0, saved: '', paused: false, locked: null, nativePanel: false});
    // Electron reads the path after the handler returns (microtasks included) and never again.
    setImmediate(() => { this.locked = this.saved; this.nativePanel = !this.saved; });
  }
  getURL() { return this.url; } getURLChain() { return [this.url]; } getFilename() { return this.locked ? path.basename(this.locked) : this.name; } getSavePath() { return this.saved; }
  getReceivedBytes() { return this.offset; } getTotalBytes() { return this.total; } getMimeType() { return 'application/octet-stream'; } getETag() { return '"e"'; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return this.paused; } pause() { this.paused = true; } resume() { this.paused = false; }
  setSavePath(file) { this.saved = file; }
  cancel() { if (this.locked) fs.rmSync(this.locked, {force: true}); this.emit('done', {}, 'cancelled'); }
  /** The bytes arrive where Electron locked the path; with no locked path the transfer waits on Electron's own panel and never finishes. */
  finish(text = '0123456789') { if (!this.locked) return false; fs.mkdirSync(path.dirname(this.locked), {recursive: true}); fs.writeFileSync(this.locked, text); this.offset = this.total; this.emit('done', {}, 'completed'); return true; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return; await wait(5); } assert.fail(label); };

function setup({askWhere = false, answer, askSite, owner: ownerPatch = {}, onOpen = () => {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-flow-'))} = {}) {
  const folder = path.join(dir, 'Downloads'), userData = path.join(dir, 'userData'), records = [], toasts = [], dialogs = [];
  fs.mkdirSync(folder, {recursive: true});
  const preferences = createDownloadPreferences({file: path.join(userData, 'download-preferences.json'), defaultFolder: folder});
  if (askWhere) preferences.set({askWhere: true});
  const session = new EventEmitter(), wc = {session, isDestroyed: () => false}, clock = {now: 1_000_000};
  const owner = {profileId: 'A', tabId: 'tab-1', window: {}, controller: {}, toast: (text, options) => toasts.push({text, ...options}),
    record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }, ...ownerPatch};
  const make = () => createDownloads({getOwner: contents => (contents === wc ? owner : null), askSite, preferences,
    dialog: {showSaveDialog: async (_window, options) => { dialogs.push(options); return answer ? answer(options) : {canceled: true}; }, showMessageBox: async () => ({response: 1})},
    app: {getPath: () => folder, getFileIcon: async () => ({isEmpty: () => false})}, shell: {showItemInFolder() {}, openPath: async file => { onOpen(file); return ''; }}, journalPath: path.join(userData, 'download-recovery.json'), now: () => clock.now});
  const service = make();
  service.attach(session);
  const begin = item => { session.emit('will-download', {preventDefault() { throw new Error('refused'); }}, item, wc); return item; };
  return {dir, folder, userData, records, toasts, dialogs, service, session, wc, begin, make, clock, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const staging = f => path.join(f.userData, 'download-staging');
const stagedFiles = f => { try { return fs.readdirSync(staging(f), {recursive: true}).filter(name => fs.statSync(path.join(staging(f), name)).isFile()); } catch { return []; } };

test('"Ask where to save": an answer that comes after Electron has read the path still lands the file where the person chose, under that name', async () => {
  let reply;
  const f = setup({askWhere: true, answer: () => new Promise(resolve => { reply = resolve; })});
  try {
    const chosen = path.join(f.dir, 'Elsewhere', 'my name.bin');
    const item = f.begin(new Item('server.bin'));
    await tick(); await tick();
    assert.equal(item.nativePanel, false, 'a path was set before Electron read it, so Electron opens no Save panel of its own');
    assert.equal(item.paused, true, 'nothing flows before the answer');
    await wait(30); reply({canceled: false, filePath: chosen}); await until(() => !item.paused, 'resumed after the answer');
    assert.equal(f.records[0].path, chosen, 'the record shows the chosen place while the file arrives');
    assert.equal(f.records[0].name, 'my name.bin');
    assert.equal(item.finish('late answer'), true);
    await until(() => f.records[0].status === 'Ready', 'Ready');
    assert.equal(fs.readFileSync(chosen, 'utf8'), 'late answer');
    assert.equal(f.records[0].path, chosen);
    assert.equal(f.records[0].name, 'my name.bin', 'the finished row keeps the chosen name (Electron still reports the staging name)');
    assert.deepEqual(stagedFiles(f), [], 'nothing left behind');
    assert.equal(fs.existsSync(path.join(staging(f), f.records[0].id.slice(-8))), false, 'its staging folder is gone');
    assert.deepEqual(fs.readdirSync(f.folder), [], 'nothing in the download folder');
    assert.equal(f.toasts.at(-1).text, 'my name.bin downloaded');
  } finally { f.cleanup(); }
});

test('"Ask where to save": Cancel in the Save dialog, even late, leaves no file and no staging folder', async () => {
  let reply;
  const f = setup({askWhere: true, answer: () => new Promise(resolve => { reply = resolve; })});
  try {
    const item = f.begin(new Item('never.bin'));
    await tick(); await tick();
    assert.equal(item.nativePanel, false);
    await wait(30); reply({canceled: true});
    await until(() => f.records[0]?.status === 'Cancelled', 'Cancelled');
    await wait(20);
    assert.deepEqual(stagedFiles(f), []);
    assert.deepEqual(fs.existsSync(staging(f)) ? fs.readdirSync(staging(f)) : [], [], 'no staging folder left');
    assert.deepEqual(fs.readdirSync(f.folder), []);
  } finally { f.cleanup(); }
});

test('"Ask where to save": a small file that finishes while the Save dialog is still open waits for the answer, then lands where the person chose', async () => {
  let reply;
  const f = setup({askWhere: true, answer: () => new Promise(resolve => { reply = resolve; })});
  try {
    const chosen = path.join(f.dir, 'Elsewhere', 'chosen.pdf');
    const item = f.begin(new Item('small.pdf'));
    await tick(); await tick();
    // Pausing holds back what is still to come: a file that had fully arrived finishes anyway (seen in the real app with a 6 KB file).
    assert.equal(item.finish('small'), true);
    await wait(60);
    assert.notEqual(f.records[0]?.status, 'Ready', 'not finished before the person has answered');
    assert.deepEqual(fs.readdirSync(f.folder), [], 'nothing put in the download folder meanwhile');
    reply({canceled: false, filePath: chosen});
    await until(() => f.records[0]?.status === 'Ready', 'Ready after the answer');
    assert.equal(fs.readFileSync(chosen, 'utf8'), 'small');
    assert.equal(f.records[0].path, chosen);
    assert.equal(f.records[0].name, 'chosen.pdf');
    assert.deepEqual(stagedFiles(f), [], 'nothing left behind');
    assert.deepEqual(fs.readdirSync(f.folder), [], 'nothing in the download folder');
    assert.equal(f.toasts.at(-1).text, 'chosen.pdf downloaded');
  } finally { f.cleanup(); }
});

test('"Ask where to save": Cancel, or Block on the "several files" question, after a small file has already finished leaves no file anywhere', async () => {
  let reply;
  const f = setup({askWhere: true, answer: () => new Promise(resolve => { reply = resolve; })});
  try {
    const item = f.begin(new Item('gone.pdf'));
    await tick(); await tick();
    item.finish('x'); await wait(30); reply({canceled: true});
    await until(() => f.records[0]?.status === 'Cancelled', 'Cancelled');
    await wait(20);
    assert.deepEqual(stagedFiles(f), []);
    assert.deepEqual(fs.readdirSync(f.folder), [], 'not kept in the download folder');
  } finally { f.cleanup(); }
  let block;
  const g = setup({askWhere: true, answer: async options => ({canceled: false, filePath: options.defaultPath}), askSite: () => new Promise(resolve => { block = resolve; })});
  try {
    const first = g.begin(new Item('one.bin'));
    await until(() => !first.paused, 'the first one is answered');
    first.finish('one');
    await until(() => g.records[0]?.status === 'Ready', 'first Ready');
    const held = g.begin(new Item('two.bin'));
    await until(() => typeof block === 'function', 'the several-files question is up');
    held.finish('two'); await wait(30); block(false);
    await until(() => g.records[1]?.status === 'Cancelled', 'Block cancels it');
    await wait(20);
    assert.deepEqual(fs.readdirSync(g.folder), ['one.bin']);
    assert.deepEqual(stagedFiles(g), []);
  } finally { g.cleanup(); }
});

test('a download held behind the "several files" question keeps its save path, finishes after Allow, and Block leaves nothing', async () => {
  for (const allow of [true, false]) {
    let reply;
    const f = setup({askSite: () => new Promise(resolve => { reply = resolve; })});
    try {
      const first = f.begin(new Item('one.bin'));
      await tick(); await tick();
      assert.equal(first.finish('one'), true, 'the first download goes straight through');
      const held = f.begin(new Item('two.bin'));
      await tick(); await tick();
      assert.equal(held.nativePanel, false, 'the held download already has its path when Electron reads it');
      assert.equal(held.paused, true, 'held until the answer');
      await wait(30); reply(allow);
      if (!allow) {
        await until(() => f.records[1]?.status === 'Cancelled', 'Block cancels it');
        assert.deepEqual(fs.readdirSync(f.folder), ['one.bin']);
        continue;
      }
      await until(() => !held.paused, 'resumed after Allow');
      assert.equal(held.finish('two'), true);
      await until(() => f.records[1]?.status === 'Ready', 'Ready after Allow');
      assert.equal(fs.readFileSync(path.join(f.folder, 'two.bin'), 'utf8'), 'two');
      assert.equal(f.records[1].path, path.join(f.folder, 'two.bin'));
    } finally { f.cleanup(); }
  }
});

test('downloads of the same name that start together each get their own file', async () => {
  const f = setup({askSite: async () => true});
  try {
    const items = [f.begin(new Item('report.pdf')), f.begin(new Item('report.pdf')), f.begin(new Item('Report.pdf'))];
    await tick(); await tick();
    const saved = items.map(item => item.locked);
    assert.equal(new Set(saved.map(file => file.toLowerCase())).size, 3, 'three different files: ' + saved.map(file => path.basename(file)).join(', '));
    items.forEach((item, n) => item.finish('copy ' + n));
    assert.deepEqual(saved.map(file => fs.readFileSync(file, 'utf8')), ['copy 0', 'copy 1', 'copy 2']);
    assert.deepEqual(f.records.map(r => path.basename(r.path)), ['report.pdf', 'report (1).pdf', 'Report (2).pdf']);
    // Once a file is done its name is free again for the next check (the file on disk is what keeps it taken).
    const later = f.begin(new Item('notes.txt'));
    await tick(); await tick(); later.finish();
    fs.rmSync(later.locked);
    const again = f.begin(new Item('notes.txt'));
    await tick(); await tick();
    assert.equal(path.basename(again.locked), 'notes.txt');
  } finally { f.cleanup(); }
});

test('a transfer parked in staging when Acira stopped is gone at the next start; other files are left alone', () => {
  const f = setup();
  try {
    const left = path.join(staging(f), 'abc12345', 'secret.pdf');
    fs.mkdirSync(path.dirname(left), {recursive: true}); fs.writeFileSync(left, 'left behind');
    fs.writeFileSync(path.join(f.folder, 'kept.pdf'), 'mine');
    f.make();
    assert.equal(fs.existsSync(staging(f)), false);
    assert.deepEqual(fs.readdirSync(f.folder), ['kept.pdf']);
  } finally { f.cleanup(); }
});

test('a half-finished download left by a crash: Cancel at the next start deletes the partial file and the row says Cancelled', async () => {
  const f = setup();
  try {
    const item = f.begin(new Item('half.bin', {total: 100}));
    await tick(); await tick();
    fs.writeFileSync(item.locked, 'x'.repeat(40)); item.offset = 40; f.clock.now += 2000; item.emit('updated', {}, 'progressing');
    const records = f.records.map(r => ({...r}));
    assert.equal(records[0].status, 'Downloading');
    // The crash: no 'done', the journal has the transfer, and Chromium kept writing for a moment after the last journal write.
    fs.appendFileSync(item.locked, 'y'.repeat(10));
    // This file predates the simulated restart. NTFS's sub-ms clock can otherwise
    // put its write just after Date.now() at engine creation and trigger the
    // deliberate "changed after startup" safety guard under parallel load.
    const beforeRestart = new Date(Date.now() - 1000); fs.utimesSync(item.locked, beforeRestart, beforeRestart);
    const next = f.make();
    const shown = next.reconcile(records, 'A')[0];
    assert.equal(shown.status, 'Interrupted');
    assert.equal(shown.canResume, true, 'it can still be resumed');
    assert.equal(shown.canCancel, true);
    await next.command(shown.id, 'cancel', 'A', records);
    assert.equal(fs.existsSync(item.locked), false, 'no half file left under the real name');
    const after = next.reconcile(records, 'A')[0];
    assert.equal(after.status, 'Cancelled');
    assert.equal(after.canCancel, false);
    assert.equal(after.canResume, false);
  } finally { f.cleanup(); }
});

test('Cancel on an old row never deletes a file that is complete or no longer the partial one', async () => {
  for (const [label, content] of [['complete', 'x'.repeat(100)], ['replaced by something smaller', 'x'.repeat(5)]]) {
    const f = setup();
    try {
      const item = f.begin(new Item('kept.bin', {total: 100}));
      await tick(); await tick();
      fs.writeFileSync(item.locked, 'x'.repeat(40)); item.offset = 40; f.clock.now += 2000; item.emit('updated', {}, 'progressing');
      const records = f.records.map(r => ({...r}));
      fs.writeFileSync(item.locked, content);
      const next = f.make();
      await next.command(records[0].id, 'cancel', 'A', records);
      assert.equal(fs.readFileSync(item.locked, 'utf8'), content, label);
    } finally { f.cleanup(); }
  }
});

test('Windows script, shortcut, installer and disk-image types ask before they open, in any letter case; ordinary files do not', () => {
  for (const ext of ['hta', 'msc', 'pif', 'scf', 'wsh', 'chm', 'inf', 'application', 'appref-ms', 'library-ms', 'settingcontent-ms', 'iso', 'img', 'vhd', 'vhdx', 'msp',
    'appxbundle', 'msixbundle', 'ws', 'wsc', 'sct', 'diagcab', 'xll', 'jnlp', 'searchconnector-ms', 'exe', 'msi', 'lnk', 'url'])
    assert.equal(dangerous('file.' + ext), true, ext), assert.equal(dangerous('FILE.' + ext.toUpperCase()), true, ext.toUpperCase());
  for (const name of ['report.pdf', 'photo.png', 'notes.txt', 'archive.zip', 'iso.txt', 'chm', 'setup.exe.txt', 'image.imgx', 'movie.mkv', 'page.html'])
    assert.equal(dangerous(name), false, name);
});

test('mark of the web on Windows: filled only when missing, zone 3 and no address; never on other systems or for a missing file', () => {
  const files = new Map([['C:\\d\\a.exe', 'x'], ['C:\\d\\b.exe', 'x'], ['C:\\d\\b.exe:Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.test/\r\n']]);
  const fake = {existsSync: file => files.has(file), readFileSync: file => { if (!files.has(file)) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'}); return files.get(file); }, writeFileSync: (file, text) => files.set(file, text)};
  assert.equal(markOfTheWeb('C:\\d\\a.exe', 'darwin', fake), false);
  assert.equal(files.has('C:\\d\\a.exe:Zone.Identifier'), false);
  assert.equal(markOfTheWeb('C:\\d\\a.exe', 'win32', fake), true);
  assert.equal(files.get('C:\\d\\a.exe:Zone.Identifier'), '[ZoneTransfer]\r\nZoneId=3\r\n');
  assert.equal(markOfTheWeb('C:\\d\\b.exe', 'win32', fake), false, 'a mark Chromium wrote is kept');
  assert.match(files.get('C:\\d\\b.exe:Zone.Identifier'), /HostUrl=/);
  assert.equal(markOfTheWeb('C:\\d\\gone.exe', 'win32', fake), false);
  assert.equal(files.has('C:\\d\\gone.exe:Zone.Identifier'), false);
  const broken = {...fake, writeFileSync() { throw new Error('FAT32 has no streams'); }};
  assert.equal(markOfTheWeb('C:\\d\\a2.exe', 'win32', {...broken, existsSync: () => true}), false, 'a drive without streams is not an error');
});

const xattrOf = (file, name = 'com.apple.quarantine') => { try { return execFileSync('/usr/bin/xattr', ['-p', name, file], {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch { return null; } };
const MARK = /^0081;[0-9a-f]{8};Acira Browser;$/;

test('quarantine on macOS: a file with no mark gets 0081, the time and Acira Browser, with no address and no event id; a mark that is there is kept; never elsewhere', async () => {
  const calls = [], names = new Map([['/d/a.dmg', ''], ['/d/b.dmg', 'com.apple.provenance\ncom.apple.quarantine\n']]), now = () => Date.UTC(2026, 10, 3, 22, 0, 0);
  const run = async args => { calls.push(args); if (args.length > 1) return ''; if (!names.has(args[0])) throw new Error('No such file'); return names.get(args[0]); };
  assert.equal(await quarantine('/d/a.dmg', {platform: 'darwin', run, now}), true);
  assert.deepEqual(calls, [['/d/a.dmg'], ['-w', 'com.apple.quarantine', '0081;' + (now() / 1000).toString(16) + ';Acira Browser;', '/d/a.dmg']]);
  calls.length = 0;
  assert.equal(await quarantine('/d/b.dmg', {platform: 'darwin', run, now}), false, 'a mark that is there is kept');
  assert.deepEqual(calls, [['/d/b.dmg']], 'only looked at');
  calls.length = 0;
  assert.equal(await quarantine('/d/gone.dmg', {platform: 'darwin', run, now}), true, 'a listing that fails (a timeout under heavy disk use) still gets the mark written');
  assert.deepEqual(calls.map(args => args[0]), ['/d/gone.dmg', '-w']);
  calls.length = 0;
  const missing = async args => { calls.push(args); throw new Error('No such file'); };
  assert.equal(await quarantine('/d/really-gone.dmg', {platform: 'darwin', run: missing, now}), false, 'a file that isn\'t there is not an error');
  calls.length = 0;
  for (const platform of ['win32', 'linux']) assert.equal(await quarantine('/d/a.dmg', {platform, run, now}), false, platform);
  assert.equal(await quarantine('relative.dmg', {platform: 'darwin', run, now}), false);
  assert.deepEqual(calls, [], 'Windows keeps its Zone.Identifier; nothing runs elsewhere');
  const noAttributes = async args => { if (args.length === 1) return ''; throw new Error('Operation not supported'); };
  assert.equal(await quarantine('/d/a.dmg', {platform: 'darwin', run: noAttributes, now}), false, 'a drive that takes no extended attributes is not an error');
});

test('macOS: every finished download carries the quarantine mark (ordinary, private, moved after "Ask where to save"), Open and drag wait for it, and no address', {skip: process.platform !== 'darwin' && 'macOS only'}, async () => {
  for (const [label, options] of [['ordinary', {}], ['private', {owner: {profileId: 'private-1', private: true}}]]) {
    const seen = [], f = setup({...options, onOpen: file => seen.push(xattrOf(file))});
    try {
      const item = f.begin(new Item(label + '.dmg'));
      await tick(); await tick();
      item.finish();
      await until(() => f.records[0]?.status === 'Ready', label + ' Ready', 5000);
      // Opened (or dragged out) the moment its row says Ready: the mark is already there when the file is handed over.
      await f.service.command(f.records[0].id, 'open', f.records[0].browserProfileId, f.records, {owner: {}});
      assert.match(seen[0] || 'none', MARK, label + ': marked when it opens');
      await f.service.command(f.records[0].id, 'drag', f.records[0].browserProfileId, f.records, {sender: {isDestroyed: () => false, startDrag: details => seen.push(xattrOf(details.file))}});
      assert.match(seen[1] || 'none', MARK, label + ': marked when the drag starts');
      await until(() => MARK.test(xattrOf(f.records[0].path) || ''), label + ' marked', 5000);
      assert.equal(xattrOf(f.records[0].path, 'com.apple.metadata:kMDItemWhereFroms'), null, label + ': no address on disk');
    } finally { f.cleanup(); }
  }
  let reply;
  const f = setup({askWhere: true, answer: () => new Promise(resolve => { reply = resolve; })});
  try {
    const chosen = path.join(f.dir, 'Elsewhere', 'asked.pkg');
    const item = f.begin(new Item('asked.pkg'));
    await tick(); await tick(); reply({canceled: false, filePath: chosen});
    await until(() => !item.paused, 'answered'); item.finish();
    await until(() => f.records[0]?.status === 'Ready', 'asked Ready', 5000);
    assert.equal(f.records[0].path, chosen);
    // Marked a few milliseconds after Ready (one xattr call); a loaded machine can take longer, as the ordinary case above allows for.
    await until(() => MARK.test(xattrOf(chosen) || ''), 'the moved file is marked where it landed', 5000);
  } finally { f.cleanup(); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-qtn-')), file = path.join(dir, 'kept.dmg');
  try {
    fs.writeFileSync(file, 'x'); execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0083;6a000000;Safari;8F1B2C3D-0000-4000-8000-000000000000', file]);
    assert.equal(await quarantine(file), false);
    assert.equal(xattrOf(file), '0083;6a000000;Safari;8F1B2C3D-0000-4000-8000-000000000000', 'an existing mark is kept as it was');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a person\'s own click or key press in the page between two downloads means no "several files" question; a page starting several from one click is still asked', async () => {
  const asked = [];
  const f = setup({askSite: async () => { asked.push(1); return true; }});
  try {
    const first = f.begin(new Item('first.pdf'));
    await tick(); await tick(); first.finish();
    f.service.userActed('tab-1');
    const second = f.begin(new Item('second.pdf'));
    await tick(); await tick();
    assert.equal(asked.length, 0, 'the second click is the person\'s, not a burst');
    second.finish();
    const third = f.begin(new Item('third.pdf'));
    await tick(); await tick(); third.finish();
    assert.equal(asked.length, 1, 'with no input in between the page is asked about, as before');
    f.service.userActed('another-tab');
    f.begin(new Item('fourth.pdf'));
    await tick(); await tick();
    assert.equal(asked.length, 2, 'input in another tab changes nothing here');
  } finally { f.cleanup(); }
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /wc\.on\('input-event',\(_e,input\)=>\{pointerHeld\.note\(input\);if\(input\.type==='mouseDown'\|\|input\.type==='rawKeyDown'\|\|input\.type==='touchStart'\)downloads\?\.userActed\(tab\.id\);\}\);/, 'each page tells downloads about the person\'s clicks and key presses');
});

test('a just-finished file held for a moment (a Windows antivirus scan) still moves to the chosen place, not the fallback', async () => {
  let reply, busy = 3;
  const f = setup({askWhere: true, answer: () => new Promise(resolve => { reply = resolve; })}), rename = fs.promises.rename;
  fs.promises.rename = async (...args) => { if (busy-- > 0) throw Object.assign(new Error('EBUSY: resource busy or locked'), {code: 'EBUSY'}); return rename(...args); };
  try {
    const chosen = path.join(f.dir, 'Chosen', 'scan.bin'), item = f.begin(new Item('scan.bin'));
    await tick(); await tick(); reply({canceled: false, filePath: chosen}); await until(() => !item.paused, 'resumed');
    item.finish('held a moment');
    await until(() => f.records[0].status === 'Ready', 'Ready', 5000);
    assert.equal(f.records[0].path, chosen);
    assert.equal(fs.readFileSync(chosen, 'utf8'), 'held a moment');
    assert.equal(f.toasts.at(-1).text, 'scan.bin downloaded', 'no "couldn’t be saved where you chose"');
  } finally { fs.promises.rename = rename; f.cleanup(); }
});
