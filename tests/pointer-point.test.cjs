'use strict';
// desktop/pointer-point.cjs: where the pointer is, for the edge reveal, where the system will not say (native Wayland: Electron 44.9.3 answers (0, 0) to
// screen.getCursorScreenPoint()). The poller side is tests/edge-reveal-wayland.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createPointerSource, pointerSourceFor, waylandSession, forgetForTests, LEARN_READS, LEARN_FAR } = require('../desktop/pointer-point.cjs');
const { popupHostFor } = require('../desktop/browser-services/extension-popup-host.cjs');

const WAYLAND = { XDG_SESSION_TYPE: 'wayland' };
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const moduleText = fs.readFileSync(path.join(__dirname, '../desktop/pointer-point.cjs'), 'utf8');

test('which sessions are Wayland: the same answer as the extension popup host gives', () => {
  const cases = [
    { platform: 'linux', env: WAYLAND, ozone: '', wayland: true },
    { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, ozone: '', wayland: true },                // WSLg sets the display, not always the session type
    { platform: 'linux', env: { ...WAYLAND, WAYLAND_DISPLAY: 'wayland-0' }, ozone: 'auto', wayland: true },
    { platform: 'linux', env: WAYLAND, ozone: 'x11', wayland: false },                                       // --ozone-platform=x11 (XWayland): the screen call works
    { platform: 'linux', env: {}, ozone: 'wayland', wayland: true },                                         // forced on the command line
    { platform: 'linux', env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, ozone: '', wayland: false },
    { platform: 'linux', env: {}, ozone: '', wayland: false },
    { platform: 'darwin', env: WAYLAND, ozone: '', wayland: false },
    { platform: 'win32', env: WAYLAND, ozone: '', wayland: false },
  ];
  for (const c of cases) {
    assert.equal(waylandSession({ platform: c.platform, env: c.env, ozone: c.ozone }), c.wayland, JSON.stringify(c));
    if (c.platform === 'linux') assert.equal(popupHostFor({ platform: 'linux', env: c.env, ozone: c.ozone }) === 'parent', c.wayland, 'popup host agrees: ' + JSON.stringify(c));
  }
});

test('the source before anything is learned: events on Wayland, the screen everywhere else; a test switch only on a test profile', () => {
  assert.equal(pointerSourceFor({ platform: 'linux', env: WAYLAND }), 'events');
  assert.equal(pointerSourceFor({ platform: 'linux', env: {} }), 'screen');
  assert.equal(pointerSourceFor({ platform: 'darwin', env: {} }), 'screen');
  assert.equal(pointerSourceFor({ platform: 'win32', env: {} }), 'screen');
  assert.equal(pointerSourceFor({ platform: 'darwin', env: { ACIRA_BROWSER_TEST_DATA: '/tmp/x', ACIRA_POINTER_SOURCE: 'events' } }), 'events', 'a Mac rig may run the Wayland path');
  assert.equal(pointerSourceFor({ platform: 'darwin', env: { ACIRA_POINTER_SOURCE: 'events' } }), 'screen', 'not on the person\'s own profile');
  assert.equal(pointerSourceFor({ platform: 'linux', env: { ...WAYLAND, ACIRA_BROWSER_TEST_DATA: '/tmp/x', ACIRA_POINTER_SOURCE: 'screen' } }), 'screen');
  assert.equal(pointerSourceFor({ platform: 'linux', env: { ...WAYLAND, ACIRA_BROWSER_TEST_DATA: '/tmp/x', ACIRA_POINTER_SOURCE: 'nonsense' } }), 'events', 'an unknown value is ignored');
});

test('Mac and Windows: nothing is listened to, nothing is learned, the screen stays the pointer', () => {
  for (const platform of ['darwin', 'win32']) {
    const source = createPointerSource({ platform, env: WAYLAND });
    assert.equal(source.listening, false, platform);
    assert.equal(source.eventsMode(), false);
    source.note({}, { type: 'mouseMove', x: 3, y: 4 }, { x: 0, y: 0 });
    assert.equal(source.point(), null, 'an event is not recorded');
    for (let i = 0; i < 200; i++) source.noteCursorRead({ x: 0, y: 0 });
    assert.equal(source.eventsMode(), false, 'and a constant (0, 0) is not read as a Wayland session there');
  }
  // What a Linux window learned in the same run (one process is one platform, but the rule is written so) never turns the events on for them.
  forgetForTests();
  const clock = { t: 1000 };
  const linux = createPointerSource({ platform: 'linux', env: {}, now: () => clock.t });
  for (let i = 0; i < LEARN_READS + 2; i++) { clock.t += 16; linux.note({}, { type: 'mouseMove', x: 400, y: 400 }, { x: 0, y: 0 }); linux.noteCursorRead({ x: 0, y: 0 }); }
  assert.equal(linux.eventsMode(), true);
  for (const platform of ['darwin', 'win32']) assert.equal(createPointerSource({ platform, env: {} }).eventsMode(), false, platform + ' is not moved by what Linux learned');
  forgetForTests();
});

test('events: the view\'s origin plus the event position, the last one wins, mouseLeave clears it only from the view that has the pointer', () => {
  const source = createPointerSource({ platform: 'linux', env: WAYLAND });
  const page = {}, ui = {};
  assert.equal(source.eventsMode(), true);
  assert.equal(source.point(), null, 'no pointer seen yet');
  source.note(page, { type: 'mouseMove', x: 10, y: 20 }, { x: 5, y: 7 });
  assert.deepEqual(source.point(), { x: 15, y: 27 });
  source.note(ui, { type: 'mouseEnter', x: 1, y: 2 }, { x: 0, y: 0 });
  assert.deepEqual(source.point(), { x: 1, y: 2 }, 'the interface has it now');
  source.note(page, { type: 'mouseLeave', x: 0, y: 0 }, { x: 5, y: 7 });
  assert.deepEqual(source.point(), { x: 1, y: 2 }, 'the page\'s late leave does not take it away from the interface');
  source.note(ui, { type: 'mouseLeave', x: 0, y: 0 }, { x: 0, y: 0 });
  assert.equal(source.point(), null, 'the view that had it says it left: the pointer is not over the window');
  for (const type of ['mouseDown', 'mouseUp', 'mouseWheel', 'contextMenu']) { source.note(page, { type, x: 4, y: 4 }, { x: 0, y: 0 }); assert.deepEqual(source.point(), { x: 4, y: 4 }, type); source.forget(page); assert.equal(source.point(), null, type + ' then the view goes away'); }
  source.note(page, { type: 'mouseMove', x: 1, y: 1 }, { x: 0, y: 0 });
  source.forget(ui);
  assert.deepEqual(source.point(), { x: 1, y: 1 }, 'a view that never had it going away changes nothing');
});

test('events that carry no usable position are ignored', () => {
  const source = createPointerSource({ platform: 'linux', env: WAYLAND });
  const page = {};
  source.note(page, { type: 'mouseMove', x: 5, y: 5 }, { x: 0, y: 0 });
  for (const [event, origin] of [
    [{ type: 'mouseMove', x: NaN, y: 1 }, { x: 0, y: 0 }], [{ type: 'mouseMove', x: 1, y: undefined }, { x: 0, y: 0 }], [{ type: 'mouseMove', x: 1, y: 1 }, null],
    [{ type: 'mouseMove', x: 1, y: 1 }, { x: 'a', y: 0 }], [{ type: 'keyDown', x: 1, y: 1 }, { x: 0, y: 0 }], [{ type: 7, x: 1, y: 1 }, { x: 0, y: 0 }], [null, { x: 0, y: 0 }], [undefined, undefined],
  ]) { source.note(page, event, origin); assert.deepEqual(source.point(), { x: 5, y: 5 }, JSON.stringify([event, origin])); }
  const copy = source.point(); copy.x = 99;
  assert.deepEqual(source.point(), { x: 5, y: 5 }, 'point() hands out a copy');
});

test('learned: a constant (0, 0) from the screen while the pointer events put the pointer elsewhere, on Linux not recognised as Wayland', () => {
  forgetForTests();
  const clock = { t: 1000 }, logs = [];
  const source = createPointerSource({ platform: 'linux', env: {}, now: () => clock.t, log: m => logs.push(m) });
  const page = {};
  assert.equal(source.eventsMode(), false);
  source.note(page, { type: 'mouseMove', x: 300, y: 300 }, { x: 0, y: 0 });
  const read = point => { clock.t += 16; source.note(page, { type: 'mouseMove', x: 300, y: 300 }, { x: 0, y: 0 }); source.noteCursorRead(point); };
  for (let i = 0; i < LEARN_READS - 1; i++) read({ x: 0, y: 0 });
  assert.equal(source.eventsMode(), false, 'one answer short');
  read({ x: 640, y: 400 });
  for (let i = 0; i < LEARN_READS - 1; i++) read({ x: 0, y: 0 });
  assert.equal(source.eventsMode(), false, 'a real answer in between starts the count again');
  read({ x: 0, y: 0 });
  assert.equal(source.eventsMode(), true, 'learned');
  assert.equal(logs.length, 1);
  source.noteCursorRead({ x: 0, y: 0 });
  assert.equal(logs.length, 1, 'said once');
  const other = createPointerSource({ platform: 'linux', env: {} });
  assert.equal(other.eventsMode(), true, 'every window of the run uses the events from then on');
  forgetForTests();
  assert.equal(other.eventsMode(), false);
});

test('learned: not from a pointer that really is at the top-left corner, not from old events, not from no events', () => {
  forgetForTests();
  const clock = { t: 1000 };
  const source = createPointerSource({ platform: 'linux', env: {}, now: () => clock.t });
  const page = {};
  source.note(page, { type: 'mouseMove', x: Math.floor(LEARN_FAR / 2), y: 3 }, { x: 0, y: 0 });                          // near the origin: (0, 0) is a believable answer
  for (let i = 0; i < 200; i++) { clock.t += 16; source.noteCursorRead({ x: 0, y: 0 }); source.note(page, { type: 'mouseMove', x: 10, y: 3 }, { x: 0, y: 0 }); }
  assert.equal(source.eventsMode(), false, 'a pointer in the corner');
  source.note(page, { type: 'mouseMove', x: 500, y: 500 }, { x: 0, y: 0 });
  clock.t += 2000;                                                                                                          // the events are old: the pointer may have gone anywhere
  for (let i = 0; i < 200; i++) { clock.t += 16; source.noteCursorRead({ x: 0, y: 0 }); }
  assert.equal(source.eventsMode(), false, 'old events');
  const none = createPointerSource({ platform: 'linux', env: {}, now: () => clock.t });
  for (let i = 0; i < 200; i++) { clock.t += 16; none.noteCursorRead({ x: 0, y: 0 }); }
  assert.equal(none.eventsMode(), false, 'no events at all (a window nobody has moved over)');
  const x11 = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' }, ozone: 'x11', now: () => clock.t });
  x11.note(page, { type: 'mouseMove', x: 500, y: 500 }, { x: 0, y: 0 });
  for (let i = 0; i < 5; i++) { clock.t += 16; x11.noteCursorRead({ x: 500, y: 500 }); }
  assert.equal(x11.eventsMode(), false, 'X11: a working screen answer is used');
  forgetForTests();
});

test('a test switch forcing the screen on a Wayland-looking session never learns', () => {
  forgetForTests();
  const clock = { t: 1000 };
  const source = createPointerSource({ platform: 'linux', env: { ...WAYLAND, ACIRA_BROWSER_TEST_DATA: '/tmp/x', ACIRA_POINTER_SOURCE: 'screen' }, now: () => clock.t });
  source.note({}, { type: 'mouseMove', x: 400, y: 400 }, { x: 0, y: 0 });
  for (let i = 0; i < 100; i++) { clock.t += 16; source.noteCursorRead({ x: 0, y: 0 }); }
  assert.equal(source.eventsMode(), false);
  forgetForTests();
});

test('main wires it: the pages and the interface report their pointer events, the poller item offers the source, a closed page lets go', () => {
  assert.match(main, /const pointerSource=require\('\.\/pointer-point\.cjs'\)\.createPointerSource\(\{platform:process\.platform,env:process\.env,ozone:/, 'one source per window, told the ozone platform Chromium was given');
  assert.match(main, /getSwitchValue\('ozone-platform'\)\|\|app\.commandLine\.getSwitchValue\('ozone-platform-hint'\)/);
  assert.match(main, /wc\.on\('before-mouse-event',\(_e,mouse\)=>\{pointerHeld\.note\(mouse\);notePointer\(wc,mouse,entry\.view\);/, 'a tab\'s page');
  assert.match(main, /chromeView\.webContents\.on\('before-mouse-event',\(_e,mouse\)=>\{pointerHeld\.note\(mouse\);if\(chromeView\)notePointer\(chromeView\.webContents,mouse,chromeView\);/, 'the interface');
  assert.match(main, /pointerEvents:\(\)=>pointerSource\.eventsMode\(\)\?pointerSource:null,cursorRead:point=>pointerSource\.noteCursorRead\(point\)/, 'the poller\'s item');
  assert.match(main, /wc\.on\('destroyed',\(\)=>pointerSource\.forget\(wc\)\);return entry;\}/, 'a closed page');
  assert.match(main, /const notePointer=\(owner,mouse,view\)=>\{if\(!pointerSource\.listening\)return;try\{pointerSource\.note\(owner,mouse,view\.getBounds\(\)\);\}catch\{\}\};/, 'nothing is recorded where the source does not listen (Mac, Windows)');
});

test('no screen coordinate is read anywhere in the new path: no globalX / globalY, no getCursorScreenPoint, no window x and y', () => {
  const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/global[XY]/.test(code(moduleText)), false, 'pointer-point.cjs');
  assert.equal(/getCursorScreenPoint|getContentBounds|getBounds\(\)|screen\./.test(code(moduleText)), false, 'pointer-point.cjs asks the window system nothing');
  const poller = fs.readFileSync(path.join(__dirname, '../desktop/edge-reveal.cjs'), 'utf8');
  const events = poller.slice(poller.indexOf('const content = win.getContentBounds()'), poller.indexOf('const result = entry.edge.sample('));
  assert.match(events, /width: content\.width, height: content\.height/, 'the box is the content size at the origin');
  assert.equal(/content\.x|content\.y|global[XY]/.test(code(events)), false, 'the content box\'s own x and y are not used on the events path');
  const wiring = main.slice(main.indexOf('const pointerSource='), main.indexOf('const pointerHeld='));
  assert.equal(/global[XY]/.test(wiring), false, 'main passes the event and the view\'s own layout bounds, nothing else');
});

test('the new module is plain ASCII (a non-ASCII character makes the main process hold its script twice) and has no Electron import', () => {
  assert.equal(/[^\x00-\x7F]/.test(moduleText), false);
  assert.equal(/require\(['"]electron['"]\)/.test(moduleText), false, 'pure: everything injected');
});
