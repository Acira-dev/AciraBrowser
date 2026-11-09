'use strict';
// 13.3 (9 Nov 2026). Retry starts its transfer in the profile's source tab. With no website tab open that tab is not on a web page, and the 13.2 safety net (navigation-rescue.cjs)
// took a Retry of an image or a page (no attachment header) for a navigation that became a download by itself: it cancelled the transfer and loaded the address in the tab instead.
// The Retry did nothing the first time (no new row, no message). A Retry is a save the person asked for.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');
const {createNavigationRescue} = require('../desktop/browser-services/navigation-rescue.cjs');

class Item extends EventEmitter {
  constructor(name, url) { super(); Object.assign(this, {name, url, saved: '', paused: false, locked: null, offset: 0, total: 10}); setImmediate(() => { this.locked = this.saved; }); }
  getURL() { return this.url; } getURLChain() { return [this.url]; } getFilename() { return this.name; } getSavePath() { return this.saved; } getContentDisposition() { return ''; }
  getReceivedBytes() { return this.offset; } getTotalBytes() { return this.total; } getMimeType() { return 'image/png'; } getETag() { return ''; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return this.paused; } pause() { this.paused = true; } resume() { this.paused = false; } setSavePath(file) { this.saved = file; }
  cancel() { if (this.locked) fs.rmSync(this.locked, {force: true}); this.emit('done', {}, 'cancelled'); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return; await wait(5); } assert.fail(label); };

test('Retry of an image from a source tab that is not on a web page starts a download, as a save the person asked for', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-retry-rescue-')), folder = path.join(dir, 'Downloads'), records = [], loaded = [], rescued = [];
  fs.mkdirSync(folder, {recursive: true});
  try {
    const preferences = createDownloadPreferences({file: path.join(dir, 'prefs.json'), defaultFolder: folder}), session = new EventEmitter();
    const rescue = createNavigationRescue({record: (kind, error) => rescued.push(error.message)});
    const url = 'https://images.example/pic.png', started = [];
    // The source tab: only the New tab page is open, so it is on no web page.
    const wc = {session, id: 7, isDestroyed: () => false, getURL: () => 'about:blank', loadURL: async address => { loaded.push(address); },
      downloadURL: address => { const item = new Item('pic.png', address); started.push(item); session.emit('will-download', {preventDefault() { rescued.push('prevented'); }}, item, wc); }};
    const owner = {profileId: 'A', tabId: 'tab-1', window: {}, controller: {}, toast() {}, record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }};
    const service = createDownloads({getOwner: contents => (contents === wc ? owner : null), preferences, rescue, dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async () => ({response: 1})},
      app: {getPath: () => folder, getFileIcon: async () => ({isEmpty: () => false})}, shell: {}, journalPath: path.join(dir, 'journal.json')});
    service.attach(session);
    // the first download: Save image as announces itself, so it is a save and not a rescue
    rescue.expectSave(url); wc.downloadURL(url);
    await until(() => started[0] && !started[0].paused && records[0]?.status === 'Downloading', 'the first download runs');
    started[0].cancel(); await until(() => records[0].status === 'Cancelled', 'cancelled');
    await service.command(records[0].id, 'retry', 'A', records, {webContents: wc});
    await wait(80);
    assert.deepEqual(rescued, [], 'the safety net did not take the Retry for a navigation: ' + JSON.stringify(rescued));
    assert.deepEqual(loaded, [], 'and loaded nothing in the tab');
    assert.equal(started.length, 2, 'a second transfer started');
    await until(() => !started[1].paused, 'the retry flows');
    assert.ok(records.some(r => r.id !== records[0].id && r.status === 'Downloading'), 'and the list has a running row');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
