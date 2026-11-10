'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createOpenWindows, HOLD_LIMIT_MS } = require('../desktop/open-windows.cjs');

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

test('a quit that was called off lets the list follow the windows again at once', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  r.windows.begin(); r.close(b); assert.deepEqual(recorded(r), ['main', 'window-b'], 'frozen while the quit may still go through');
  assert.equal(r.windows.calledOff(), true);
  assert.deepEqual(recorded(r), ['main'], 'the window that is gone is no longer listed, without waiting for the next window event');
  r.close(a); r.open('window-d'); assert.deepEqual(recorded(r), ['window-d'], 'and it keeps following');
});

// beta.13: the freeze used to last five seconds from the start of the quit. A quit held by a question (a page that asks "Leave this
// site?") for longer than that let the windows that closed afterwards shrink the list, so only the last ones came back.
test('a quit held by a question for longer than five seconds still brings every window back', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b'), c = r.open('window-c');
  r.windows.begin(); // before-quit
  r.close(a); // closes at once
  r.clock.at += 60 * 1000; // window-b asks "Leave this site?" and waits a minute for the answer
  r.close(b);
  r.clock.at += 4 * 60 * 1000; // window-c asks too, and the person is away for four more minutes
  r.close(c);
  assert.deepEqual(recorded(r), ['main', 'window-b', 'window-c']);
  assert.deepEqual(r.windows.restorable(), ['main', 'window-b', 'window-c']);
  assert.equal(r.windows.quitting(), true, 'closing windows are still part of the quit');
});

test('the freeze lasts until the quit is called off, not for a fixed time', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  r.windows.begin();
  r.clock.at += HOLD_LIMIT_MS - 1000;
  r.close(b); assert.deepEqual(recorded(r), ['main', 'window-b']);
  assert.equal(r.windows.calledOff(), true, 'Stay was chosen long after the quit began');
  assert.deepEqual(recorded(r), ['main']);
  r.close(a);
});

test('a quit that nobody reports as called off is let go of after the fallback limit', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  assert.ok(HOLD_LIMIT_MS >= 5 * 60 * 1000, 'far longer than the five seconds it was');
  r.windows.begin(); r.close(b);
  r.clock.at += HOLD_LIMIT_MS - 1; r.windows.persist(); assert.deepEqual(recorded(r), ['main', 'window-b'], 'still held just before the limit');
  r.clock.at += 2; r.close(a); r.open('window-d'); assert.deepEqual(recorded(r), ['window-d']);
  assert.equal(r.windows.quitting(), false);
});

test('calling the quit off when none was held writes nothing and says so', () => {
  const r = rig(); r.open('main'); r.open('window-b');
  const before = r.meta.get('open-windows');
  assert.equal(r.windows.calledOff(), false, 'a window close that was only a Stay on one window');
  assert.equal(r.meta.get('open-windows'), before);
  r.windows.begin(); assert.equal(r.windows.calledOff(), true);
  assert.equal(r.windows.calledOff(), false, 'told twice (every window that asked says it): the second is nothing');
});

test('begin told twice (the quit question, then before-quit) is one quit, and one calledOff ends it', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  r.windows.begin(); r.windows.begin();
  r.close(b); assert.deepEqual(recorded(r), ['main', 'window-b']);
  assert.equal(r.windows.calledOff(), true);
  assert.deepEqual(recorded(r), ['main']);
  assert.equal(r.windows.quitting(), false);
  r.close(a);
});

test('a quit that goes through leaves the list as it was when the app is quitting', () => {
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  r.windows.begin(); r.close(a); r.setQuitting(true); r.close(b);
  assert.deepEqual(recorded(r), ['main', 'window-b']);
  assert.equal(r.windows.calledOff(), true);
  assert.deepEqual(recorded(r), ['main', 'window-b'], 'too late to follow the windows: the app has quit');
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

test('restart.cjs tells the list every time a quit is called off, and a list that throws changes nothing', () => {
  const { createRestart } = require('../desktop/restart.cjs');
  const { EventEmitter } = require('node:events');
  const app = Object.assign(new EventEmitter(), { relaunches: [], quit() { this.emit('before-quit'); }, relaunch(options) { this.relaunches.push(options); } });
  const r = rig(); const a = r.open('main'), b = r.open('window-b');
  const restart = createRestart({ app, now: () => 1e12, argv: ['/Apps/Acira'], defaultApp: false, execPath: '/Apps/Acira', onCalledOff: () => r.windows.calledOff() });
  r.windows.begin(); // Cmd+Q: before-quit
  r.close(b); // window-b leaves at once; window-a asks "Leave this site?"
  r.clock.at += 90 * 1000; // ...and waits a minute and a half for the person, who then chooses Stay
  restart.calledOff();
  assert.deepEqual(recorded(r), ['main'], 'the list follows the windows again as soon as the quit is called off');
  assert.equal(r.windows.quitting(), false);
  r.close(a);
  const broken = createRestart({ app, argv: ['/Apps/Acira'], defaultApp: false, execPath: '/Apps/Acira', onCalledOff: () => { throw new Error('list'); } });
  broken.request(); assert.doesNotThrow(() => broken.calledOff());
  app.quit(); app.emit('will-quit');
  assert.equal(app.relaunches.length, 0, 'a restart that was called off still restarts nothing');
  assert.doesNotThrow(() => createRestart({ app, argv: [], defaultApp: false, execPath: '/x' }).calledOff(), 'no list to tell is fine too');
});

test('main.cjs: the one place that calls a quit off also tells the list of open windows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  // (13.5: the same call also tells the updater, so Install now works again once its quit is called off: the list of open windows is told last, always)
  assert.match(source, /const restart=require\('\.\/restart\.cjs'\)\.createRestart\(\{app,onCalledOff:\(\)=>\{[^\n]*?try\{appUpdater\?\.installCancelled\(\);\}catch\{\}openWindows\.calledOff\(\);\}\}\);/);
});
