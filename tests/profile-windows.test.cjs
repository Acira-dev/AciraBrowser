'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createProfileWindows } = require('../desktop/profile-windows.cjs');
const { createOpenWindows } = require('../desktop/open-windows.cjs');

// Beta review (2 Nov 2026): "every time I closed the browser it emptied, 0 tabs ... a bug when you have more than one profile".
// Every profile has its own window, so the browser was closed one window at a time: the second profile's window closed first
// (not the last window, so no "Close Acira?"), was taken off every list, and its saved tabs never came back, not at the next
// start and not when that profile was opened again (an empty window opened instead).
function rig() {
  const saved = new Map(), meta = new Map(), controllers = new Set();
  const database = { setMetadata: (key, value) => meta.set(key, value), getMetadata: key => meta.get(key) ?? null, readWindow: id => saved.get(id) ?? null };
  const profileWindows = createProfileWindows({ getDatabase: () => database, getControllers: () => controllers, warn() {} });
  const openWindows = createOpenWindows({ getDatabase: () => database, getControllers: () => controllers, warn() {} });
  const open = (windowId, profileId, extra = {}) => { const controller = { windowId, profileId, closing: false, ...extra }; controllers.add(controller); saved.set(windowId, { tabs: [profileId] }); openWindows.persist(); return controller; };
  // main.cjs: the window closes, then 'closed' asks profileWindows before the controller leaves the set
  const close = controller => { controller.closing = true; const kept = profileWindows.closed(controller); controllers.delete(controller); openWindows.persist(); return kept; };
  return { profileWindows, openWindows, open, close, meta, controllers };
}
const map = r => JSON.parse(r.meta.get('profile-windows') || '{}');

test('two profiles, closed one window at a time: the first one closed comes back when its profile is opened', () => {
  const r = rig();
  const personal = r.open('main', 'profile-personal'), work = r.open('window-work', 'profile-work');
  assert.equal(r.close(work), true, 'the last window of Work is remembered for Work');
  assert.equal(r.close(personal), true, 'the last window of the app ("Close Acira?") too');
  assert.deepEqual(r.openWindows.restorable(), ['main'], 'the next start opens the window closed last, as before');
  // next start: main opens, then the person opens Work (the profile panel, or its own window)
  r.open('main', 'profile-personal');
  assert.equal(r.profileWindows.find('profile-work'), 'window-work', 'Work brings its own saved tabs back instead of an empty window');
});

test('either order: the profile closed first is the one kept for later', () => {
  const r = rig();
  const personal = r.open('main', 'profile-personal'), work = r.open('window-work', 'profile-work');
  r.close(personal); r.close(work);
  assert.deepEqual(r.openWindows.restorable(), ['window-work']);
  assert.equal(r.profileWindows.find('profile-personal'), 'main');
});

test('a window of a profile that still has another window open is forgotten, as before', () => {
  const r = rig();
  r.open('main', 'profile-personal'); const second = r.open('window-2', 'profile-personal');
  r.profileWindows.remember('profile-personal', 'window-2');
  assert.equal(r.close(second), false);
  assert.deepEqual(map(r), {}, 'one profile, two windows: closing one forgets it (nothing changes for a single profile)');
});

test('private windows and web apps are never remembered', () => {
  const r = rig();
  r.open('main', 'profile-personal');
  assert.equal(r.close(r.open('window-private', 'private-1', { privateMode: true })), false);
  assert.equal(r.close(r.open('window-app', 'profile-work', { webApp: { id: 'app' } })), false);
  assert.deepEqual(map(r), {});
});

test('a window that is open again, or whose record is gone, is not offered', () => {
  const r = rig();
  const work = r.open('window-work', 'profile-work'); r.open('main', 'profile-personal');
  r.close(work);
  r.open('window-work', 'profile-work');
  assert.equal(r.profileWindows.find('profile-work'), null, 'already open');
  r.meta.set('profile-windows', JSON.stringify({ 'profile-work': 'window-gone', 'profile-x': 'bad id!' }));
  assert.equal(r.profileWindows.find('profile-work'), null, 'no saved record');
  assert.equal(r.profileWindows.find('profile-x'), null, 'not an id');
  r.meta.set('profile-windows', '[1,2]'); assert.deepEqual(r.profileWindows.read(), {}, 'a damaged value reads as empty');
});

test('main.cjs: a window closed on purpose goes through closed(), and opening a profile in its own window uses its saved one', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /const profileWindows=require\('\.\/profile-windows\.cjs'\)\.createProfileWindows\(\{getDatabase:\(\)=>database,getControllers:\(\)=>controllers\}\);/);
  assert.match(main, /mainWindow\.on\('closed',\(\)=>\{pageDissolve\.destroy\(\);if\(!quitting&&!openWindows\.quitting\(\)\)profileWindows\.closed\(controller\);/);
  assert.match(main, /else\{const saved=profileWindows\.find\(action\.id\);createBrowserWindow\(saved\?\{windowId:saved,restore:true,profileId:action\.id\}:\{profileId:action\.id\}\);\}/);
  assert.match(main, /saved=open\?null:profileWindows\.find\(id\)/, 'the profile panel switch already used it');
});
