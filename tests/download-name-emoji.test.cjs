'use strict';
// 13.3 (9 Nov 2026). The "Downloading ..." / "... downloaded" toasts and the Delete-file message shorten a long name by UTF-16 units (28 + "…" + 24). A cut between the two
// halves of an emoji left a lone half on each side, which shows as "�". Names are shortened by characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

class Item extends EventEmitter {
  constructor(name) { super(); Object.assign(this, {name, saved: '', paused: false, offset: 0, total: 10}); }
  getURL() { return 'https://files.example/x'; } getURLChain() { return [this.getURL()]; } getFilename() { return this.name; } getSavePath() { return this.saved; }
  getReceivedBytes() { return this.offset; } getTotalBytes() { return this.total; } getMimeType() { return 'application/octet-stream'; } getETag() { return ''; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return false; } pause() { this.paused = true; } resume() { this.paused = false; } setSavePath(file) { this.saved = file; } cancel() { this.emit('done', {}, 'cancelled'); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('toasts shorten a long name by characters, never inside an emoji', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-emoji-')), folder = path.join(dir, 'Downloads'), toasts = [];
  fs.mkdirSync(folder, {recursive: true});
  try {
    const preferences = createDownloadPreferences({file: path.join(dir, 'prefs.json'), defaultFolder: folder}), session = new EventEmitter(), wc = {session, isDestroyed: () => false};
    const owner = {profileId: 'A', tabId: 't', window: {}, controller: {}, toast: text => toasts.push(text), record() {}};
    const service = createDownloads({getOwner: contents => (contents === wc ? owner : null), preferences, dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async () => ({response: 1})}, app: {getPath: () => folder, getFileIcon: async () => ({isEmpty: () => false})}, shell: {}, journalPath: path.join(dir, 'journal.json')});
    service.attach(session);
    // 27 plain characters, then an emoji whose two halves are characters 28 and 29 in UTF-16 units: the old cut at 28 splits it.
    const name = 'a'.repeat(27) + '😀' + 'b'.repeat(40) + '.pdf';
    session.emit('will-download', {preventDefault() {}}, new Item(name), wc);
    await wait(60);
    assert.ok(toasts.length >= 1, 'a toast was shown');
    for (const text of toasts) assert.ok(!lone.test(text), JSON.stringify(text));
    assert.ok(toasts.some(text => text.includes('😀')), 'the emoji is kept whole in the shortened name: ' + JSON.stringify(toasts));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
