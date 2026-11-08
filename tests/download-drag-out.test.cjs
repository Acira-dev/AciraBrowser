'use strict';
// Dragging a finished download out of its row (13.3, asked for on Discord "like Zen"): the downloads popup and the Downloads page start a native
// file drag from the row (webContents.startDrag with the file and its own icon), so the file can be dropped on a page's upload box, in Explorer or
// Finder, in a chat or mail, or on the desktop. This file tests the main-process half: the engine's `drag` command. Synthetic files in a temp folder
// only, and a recording sender instead of a real OS drag (an OS drag loop cannot be driven without OS-level input).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
// Under plain node `require('electron')` is only the binary's path: the grey stand-in icon needs a nativeImage, so a recording one is put in its place.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {id: electronPath, filename: electronPath, loaded: true, exports: {nativeImage: {createFromBitmap: (buffer, size) => ({stand: true, bytes: buffer.length, ...size, isEmpty: () => false})}}};
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');

const OWN_ICON = {own: true, isEmpty: () => false};
function rig({icon = async () => OWN_ICON, torWarning = () => false} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-drag-')), folder = path.join(dir, 'Downloads');
  fs.mkdirSync(folder, {recursive: true});
  const boxes = [], opened = [], shown = [], iconFor = [];
  const preferences = createDownloadPreferences({file: path.join(dir, 'prefs.json'), defaultFolder: folder});
  const service = createDownloads({getOwner: () => null, askSite() {}, preferences, torWarning,
    dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async (_window, options) => { boxes.push(options); return {response: 1}; }},
    app: {getPath: () => folder, getFileIcon: async (file, options) => { iconFor.push([file, options]); return icon(file); }},
    shell: {showItemInFolder: file => shown.push(file), openPath: async file => { opened.push(file); return ''; }, trashItem: async () => { throw new Error('a drag never trashes'); }},
    journalPath: path.join(dir, 'recovery.json')});
  const drags = [], sender = {destroyed: false, isDestroyed() { return this.destroyed; }, startDrag(details) { drags.push(details); }};
  const make = (name, extra = {}) => { const file = path.join(folder, name); fs.writeFileSync(file, 'synthetic ' + name); return {id: 'dl-' + name, browserProfileId: 'A', name, path: file, status: 'Ready', ...extra}; };
  const drag = (record, extra = [], context = {sender}) => service.command(record.id, 'drag', 'A', [record, ...extra], context);
  return {dir, folder, service, boxes, opened, shown, iconFor, drags, sender, make, drag, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('Drag out: a finished file is handed to the native drag by its exact path, with its own icon, and nothing else happens to it', async () => {
  const r = rig();
  try {
    const target = r.make('Quarterly report.pdf'), bystander = r.make('keep.png');
    assert.deepEqual(await r.drag(target, [bystander]), {});
    assert.equal(r.drags.length, 1, 'one native drag');
    assert.deepEqual(r.drags[0], {file: target.path, icon: OWN_ICON}, 'the record\'s own path and the file\'s own icon');
    assert.deepEqual(r.iconFor, [[target.path, {size: 'normal'}]], 'the icon of that file, asked once');
    assert.ok(fs.existsSync(target.path) && fs.existsSync(bystander.path), 'both files stay where they are');
    assert.equal(fs.readFileSync(target.path, 'utf8'), 'synthetic Quarterly report.pdf', 'the file is not touched');
    assert.deepEqual([r.boxes.length, r.opened.length, r.shown.length], [0, 0, 0], 'no question, nothing opened, nothing revealed');
  } finally { r.cleanup(); }
});

test('Drag out: a file with no icon of its own (or one that cannot be read) drags with a plain stand-in, not an empty image', async () => {
  for (const icon of [async () => ({isEmpty: () => true}), async () => null, async () => { throw new Error('no icon'); }]) {
    const r = rig({icon});
    try {
      const target = r.make('thing.bin');
      await r.drag(target);
      assert.equal(r.drags.length, 1);
      assert.equal(r.drags[0].file, target.path);
      assert.equal(r.drags[0].icon.stand, true, 'the stand-in');
      assert.deepEqual([r.drags[0].icon.width, r.drags[0].icon.height, r.drags[0].icon.bytes], [32, 32, 32 * 32 * 4]);
    } finally { r.cleanup(); }
  }
});

test('Drag out: only a finished download whose file is still there, and only in its own profile', async () => {
  const r = rig();
  try {
    for (const status of ['Downloading', 'Paused', 'Interrupted', 'Failed', 'Cancelled']) {
      const record = r.make('partial-' + status + '.bin', {status});
      await assert.rejects(r.drag(record), {message: 'The downloaded file is unavailable.'}, status);
    }
    const gone = r.make('gone.bin'); fs.rmSync(gone.path);
    await assert.rejects(r.drag(gone), {message: 'The downloaded file is unavailable.'}, 'a file that is already gone');
    await assert.rejects(r.drag({id: 'dl-none', browserProfileId: 'A', name: 'x', path: '', status: 'Ready'}), {message: 'The downloaded file is unavailable.'}, 'a row with no path');
    const other = r.make('theirs.bin', {browserProfileId: 'B'});
    await assert.rejects(r.drag(other), {message: 'Download is outside this profile.'}, 'another profile\'s row');
    assert.equal(r.drags.length, 0, 'none of them started a drag');
    assert.deepEqual(r.iconFor, [], 'and none read an icon');
  } finally { r.cleanup(); }
});

test('Drag out: a file that disappears while the drag is being set up, or a window that closes, starts no drag', async () => {
  const r = rig({icon: async file => { fs.rmSync(file); return OWN_ICON; }});
  try {
    const target = r.make('vanishing.zip');
    await assert.rejects(r.drag(target), {message: 'The downloaded file is unavailable.'}, 'the file went away at the last moment');
    assert.equal(r.drags.length, 0);
  } finally { r.cleanup(); }
  const closing = rig({icon: async () => { closing.sender.destroyed = true; return OWN_ICON; }});
  try {
    assert.deepEqual(await closing.drag(closing.make('closing.zip')), {}, 'the window closed meanwhile');
    assert.equal(closing.drags.length, 0);
  } finally { closing.cleanup(); }
  const bare = rig();
  try {
    const target = bare.make('nowhere.zip');
    assert.deepEqual(await bare.drag(target, [], {}), {}, 'a request with no window to drag from');
    bare.sender.destroyed = true;
    assert.deepEqual(await bare.drag(target), {}, 'a window that is already closed');
    assert.deepEqual([bare.drags.length, bare.iconFor.length], [0, 0]);
  } finally { bare.cleanup(); }
});

test('Drag out: a private or Tor download drags like any other, with no question (it is the same hand-over as Show in folder)', async () => {
  const r = rig({torWarning: () => true});
  try {
    const priv = r.make('private.pdf', {private: true, browserProfileId: 'A'}), tor = r.make('tor.pdf', {tor: true, private: true});
    await r.drag(priv, [tor]); await r.drag(tor, [priv]);
    assert.deepEqual(r.drags.map(d => d.file), [priv.path, tor.path]);
    assert.equal(r.boxes.length, 0, 'the Tor warning is for opening a file in another program; a drag asks nothing');
    // ...while Open still asks, so the decision is only about the drag.
    await r.service.command(tor.id, 'open', 'A', [tor], {owner: {window: {}}});
    assert.equal(r.boxes.length, 1, 'Open on a Tor download still shows the warning first');
  } finally { r.cleanup(); }
});

test('Drag out: the control is allowed through main.cjs and starts the drag from the window that asked', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const control = main.slice(main.indexOf("case 'downloads.command':"), main.indexOf("case 'downloads.command':") + 1800);
  assert.match(control, /'drag','delete'\]\.includes\(request\.command\)/, 'drag is an allowed download command');
  assert.match(control, /sender:event\.sender/, 'the drag starts from the window the request came from (the popup\'s page or the Downloads page)');
  assert.match(control, /item\.browserProfileId===state\.activeBrowserProfileId/, 'only a download of the active profile');
});
