'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createOpenWindows, GRACE_MS } = require('../desktop/open-windows.cjs');

// Live finding (settings-target-routing, Round 3 source re-run): after a normal quit with three windows open, only the last window
// came back, because every window that closed during the quit shrank the recorded list before the app knew it was quitting.
function rig() {
  const saved = new Map(), meta = new Map(), clock = { at: 1000 };
  const database = { setMetadata: (key, value) => meta.set(key, value), getMetadata: key => meta.get(key) ?? null, readWindow: id => saved.get(id) ?? null };
  const controllers = new Set();
  let quitting = false;
  const windows = createOpenWindows({ getDatabase: () => database, getControllers: () => controllers, isQuitting: () => quitting, now: () => clock.at, warn() {} });
  const open = (windowId, extra = {}) => { const controller = { windowId, ...extra }; controllers.add(controller); saved.set(windowId, { tabs: 1 }); windows.persist(); return controller; };
  const close = controller => { controller.closing = true; controllers.delete(controller); windows.persist(); };
  return { windows, open, close, meta, clock, setQuitting: value => { quitting = value; } };
}
const recorded = r => JSON.parse(r.meta.get('open-windows') || '[]');

test('windows open now are recorded, ordinary ones only', () => {
  const r = rig(); r.open('main'); r.open('window-a'); r.open('window-private', { privateMode: true }); r.open('window-app', { webApp: { id: 'x' } });
  assert.deepEqual(recorded(r), ['main', 'window-a']);
});

test('a window closed on purpose leaves the list; the last window stays as the last one', () => {
  const r = rig(); const main = r.open('main'), second = r.open('window-a');
  r.close(second); assert.deepEqual(recorded(r), ['main']);
  r.close(main); assert.deepEqual(recorded(r), ['main'], 'an empty list never replaces it');
  assert.deepEqual(r.windows.restorable(), ['main']);
});

test('windows that close one by one while the app quits all come back', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b'), c = r.open('window-c');
  r.windows.begin(); // before-quit
  r.close(a); r.close(b); r.close(c); // Electron closes them in turn
  assert.deepEqual(recorded(r), ['main', 'window-b', 'window-c']);
  assert.deepEqual(r.windows.restorable(), ['main', 'window-b', 'window-c']);
});

test('a quit that was called off lets the list follow the windows again after a moment', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  r.windows.begin(); r.close(b); assert.deepEqual(recorded(r), ['main', 'window-b'], 'frozen while the quit may still go through');
  r.clock.at += GRACE_MS + 1; r.close(a); r.open('window-d'); assert.deepEqual(recorded(r), ['window-d']);
});

test('nothing is written once the app is already quitting', () => {
  const r = rig(); r.open('main'); r.setQuitting(true); r.open('window-late');
  assert.deepEqual(recorded(r), ['main']);
});

test('start reads back only windows that were saved, at most twelve, and falls back to the first window', () => {
  const r = rig();
  assert.deepEqual(r.windows.restorable(), ['main'], 'nothing recorded');
  r.meta.set('open-windows', JSON.stringify(['gone', 'window-ok', 'bad id!', 7]));
  assert.deepEqual(r.windows.restorable(), ['main'], 'nothing recorded can be read back');
  const many = Array.from({ length: 15 }, (_, i) => 'window-' + i);
  const full = rig(); for (const id of many) full.open(id);
  assert.equal(full.windows.restorable().length, 12);
  r.open('window-ok'); r.meta.set('open-windows', JSON.stringify(['gone', 'window-ok'])); assert.deepEqual(r.windows.restorable(), ['window-ok']);
});

test('main.cjs hands the quit to the module before it saves the windows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(source, /createOpenWindows\(\{getDatabase:\(\)=>database,getControllers:\(\)=>controllers,isQuitting:\(\)=>quitting\}\)/);
  assert.match(source, /const beginQuit=\(\)=>\{closeSplash\(\);openWindows\.begin\(\);/);
  assert.match(source, /app\.on\('before-quit',beginQuit\);/);
  assert.match(source, /require\('electron'\)\.autoUpdater\.on\('before-quit-for-update',\(\)=>\{[^\n]*beginQuit\(\);\}\);/, 'Install now closes the windows before before-quit; they still come back');
  assert.match(source, /function restorableWindowIds\(\)\{return openWindows\.restorable\(\);\}/);
});
