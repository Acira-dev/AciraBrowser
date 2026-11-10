'use strict';
// An extension page opened as a window of a PRIVATE session (privateExtensionBrowser.createTab in main.cjs) read `window.webContents` inside its 'closed'
// handler. A closed window's webContents throws "Object has been destroyed", the exception stopped the other 'closed' listeners of that window, and
// closeOwnedWindow (owned-window-close.cjs) waits for one of them: closing the private window with an extension page open never finished (the window stayed
// hidden and alive with its private pages). Found by the 13.5 edge runs; the same code is on 13.4.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {EventEmitter} = require('node:events');
const {closeOwnedWindow} = require('../desktop/owned-window-close.cjs');
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const start = main.indexOf('function privateExtensionBrowser(ses)'), body = main.slice(start, main.indexOf('/** Loads the extensions allowed in private', start));
const piece = body.slice(body.indexOf("const key='extension-'+window.id"), body.indexOf('window.webContents.on(', body.indexOf("const key='extension-'+window.id")));

function fakeWindow() {
  const window = new EventEmitter(), contents = Object.assign(new EventEmitter(), {id: 5});
  let destroyed = false;
  Object.defineProperty(window, 'webContents', {get() { if (destroyed) throw new TypeError('Object has been destroyed'); return contents; }});
  Object.assign(window, {id: 9, setMenu() {}, isDestroyed: () => destroyed, close() { destroyed = true; window.emit('closed'); }});
  return {window, contents};
}

test('the private extension window\'s closed handler never touches a destroyed window, so it frees its entries and the other listeners still run', () => {
  assert.ok(start > 0 && piece.length > 100, 'the private extension window code is where the test looks for it');
  const {window, contents} = fakeWindow();
  const auxiliaries = new Map(), opened = new Set();
  new Function('window', 'auxiliaries', 'opened', piece)(window, auxiliaries, opened);
  assert.deepEqual([auxiliaries.has('extension-9'), opened.has(contents)], [true, true]);
  let second = false;
  window.once('closed', () => { second = true; });
  assert.doesNotThrow(() => window.close());
  assert.deepEqual([auxiliaries.size, opened.size], [0, 0], 'both entries are gone');
  assert.equal(second, true, 'a later listener still hears the close');
});

test('closing the private window with an extension window open finishes: closeOwnedWindow hears the close', async () => {
  const {window} = fakeWindow();
  new Function('window', 'auxiliaries', 'opened', piece)(window, new Map(), new Set());
  const result = await Promise.race([closeOwnedWindow(window, () => true), new Promise(resolve => setTimeout(() => resolve('hung'), 1500))]);
  assert.equal(result, true);
});
