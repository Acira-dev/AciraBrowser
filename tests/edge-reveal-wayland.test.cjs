'use strict';
// LINUX HOVER (reported on 13.6, CachyOS / KDE Plasma, 11 Nov 2026: "side bar nor url pop up on hovering").
//
// The edge reveal (Seamless, Hide the toolbar, a closed sidebar's edge) is decided by main from screen.getCursorScreenPoint(). On a native Wayland session
// (Electron 38 and later default to it) Electron 44.9.3 answers { x: 0, y: 0 } to that call every time (shell/browser/api/electron_api_screen.cc:
// `if (x11_util::IsWayland()) return {};`, electron#50092). A pointer fixed at (0, 0) is never at the sidebar's edge. These tests run the real poller
// (watchChromeEdges) with that stand-in answer: the screen says (0, 0) while the pointer, as the window's own pointer events report it, is somewhere else.
// The first test is the one that fails on 13.6: it uses only the poller's new item field (`pointerEvents`), so on 13.6 the field is ignored and nothing reveals.
const test = require('node:test'), assert = require('node:assert/strict');
const { watchChromeEdges } = require('../desktop/edge-reveal.cjs');

const W = 1280, H = 800;

/** A window, a clock and the poller at its 16 ms cadence. `screenAnswer` is what Electron's screen call says (the Wayland stand-in: always (0, 0)). */
function rig({ view = 'seamless', side = 'left', edges = { top: true, side: true }, peek = {}, topAuto = false, contentBox = { x: 0, y: 0, width: W, height: H }, screenAnswer = { x: 0, y: 0 }, events = null, cursorRead = null } = {}) {
  const emitted = [], clock = { t: 5000 };
  let timeout = null;
  const screen = { answer: screenAnswer, reads: 0, getCursorScreenPoint() { this.reads++; return this.answer; } };
  const w = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => contentBox, on() {} };
  const item = {
    window: w, state: { settings: { verticalTabs: true, sidebarSide: side } }, emit: event => emitted.push(event),
    size: () => ({ topHeight: 44, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => edges, docked: () => false, peek: () => peek, topAuto: () => topAuto,
    ...(events ? { pointerEvents: () => (typeof events === 'function' ? events() : events) } : {}), ...(cursorRead ? { cursorRead } : {}),
  };
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [item], screen, view: () => view, now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  const shown = () => { const last = emitted.filter(e => e.type === 'chrome-edge').at(-1); return last ? { top: last.top, side: last.side } : { top: false, side: false }; };
  const start = () => Promise.resolve().then(() => { timeout(); });
  return { emitted, clock, screen, run, shown, start, item };
}

test('Wayland stand-in: the screen says (0, 0), the pointer events say it rests at the left edge: the sidebar is revealed (fails on 13.6)', async () => {
  const pointer = { x: 600, y: 400 };
  const r = rig({ events: { point: () => pointer } });
  await r.start();
  r.run(160);
  assert.deepEqual(r.shown(), { top: false, side: false }, 'the pointer is over the page: nothing');
  pointer.x = 2;                       // the pointer rests in the left edge zone (10 px)
  r.run(320);
  assert.equal(r.shown().side, true, 'resting at the left edge shows the sidebar, whatever the screen call says');
  assert.equal(r.screen.reads, 0, 'the screen call is not asked at all when the window has its own pointer source');
});

test('Wayland stand-in: the same for the top edge in Seamless, and it hides again when the pointer goes back to the page (fails on 13.6)', async () => {
  const pointer = { x: 600, y: 400 };
  const r = rig({ events: { point: () => pointer } });
  await r.start();
  r.run(100);
  pointer.y = 2;
  r.run(320);
  assert.equal(r.shown().top, true, 'resting at the top edge shows the top bar');
  assert.equal(r.shown().side, false);
  pointer.y = 400;                     // the pointer goes back down into the page
  r.run(1500);
  assert.equal(r.shown().top, false, 'and it goes again (on 13.6 the (0, 0) the screen gives held it open for good)');
});

test('the cause, as it was on 13.6: with no pointer source the (0, 0) the screen gives never reveals the sidebar (and keeps the top zone pressed)', async () => {
  const r = rig({ edges: { top: false, side: true } });          // side edge only: the point (0, 0) is in the top-left corner, outside the side zone
  await r.start();
  r.run(2000);
  assert.deepEqual(r.shown(), { top: false, side: false }, 'a pointer stuck at (0, 0) never reveals the sidebar');
  const withTop = rig();
  await withTop.start();
  withTop.run(2000);
  assert.equal(withTop.shown().side, false, 'and with the top edge on, the sidebar still never shows');
});

test('the pointer leaving the window hides the revealed sidebar after its grace, and it does not come back by itself', async () => {
  const { createPointerSource } = require('../desktop/pointer-point.cjs');
  const source = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, now: () => r.clock.t });
  const page = {}, ui = {};
  const r = rig({ events: () => (source.eventsMode() ? source : null) });
  await r.start();
  source.note(page, { type: 'mouseMove', x: 700, y: 400 }, { x: 0, y: 0 }); r.run(100);
  source.note(page, { type: 'mouseMove', x: 3, y: 400 }, { x: 0, y: 0 }); r.run(320);
  assert.equal(r.shown().side, true, 'the pointer at the left edge: shown');
  source.note(ui, { type: 'mouseMove', x: 120, y: 400 }, { x: 0, y: 0 }); r.run(600);
  assert.equal(r.shown().side, true, 'the pointer is on the revealed sidebar (the interface reports it): it stays');
  source.note(ui, { type: 'mouseLeave', x: 0, y: 0 }, { x: 0, y: 0 });     // out of the window altogether
  r.run(1500);
  assert.equal(r.shown().side, false, 'the pointer left the window: the sidebar goes after its grace');
  r.run(1500);
  assert.equal(r.shown().side, false, 'with no pointer there is nothing to reveal it again');
});

test('the pointer moving from the page to the revealed interface: the page\'s late leave does not hide the sidebar', async () => {
  const { createPointerSource } = require('../desktop/pointer-point.cjs');
  const source = createPointerSource({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, now: () => r.clock.t });
  const page = {}, ui = {};
  const r = rig({ events: () => (source.eventsMode() ? source : null) });
  await r.start();
  source.note(page, { type: 'mouseMove', x: 3, y: 300 }, { x: 0, y: 0 }); r.run(320);
  assert.equal(r.shown().side, true);
  source.note(ui, { type: 'mouseEnter', x: 4, y: 300 }, { x: 0, y: 0 });   // the interface, raised over the page, has the pointer
  source.note(page, { type: 'mouseLeave', x: 0, y: 0 }, { x: 0, y: 0 });   // the page says so after
  r.run(1200);
  assert.equal(r.shown().side, true, 'the pointer is still on the sidebar');
});

test('the sidebar on the right: the right edge reveals it, the left edge does not', async () => {
  const { createPointerSource } = require('../desktop/pointer-point.cjs');
  const source = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, now: () => r.clock.t });
  const page = {};
  const r = rig({ side: 'right', events: () => (source.eventsMode() ? source : null) });
  await r.start();
  source.note(page, { type: 'mouseMove', x: 3, y: 400 }, { x: 0, y: 0 }); r.run(500);
  assert.equal(r.shown().side, false, 'the left edge is not the sidebar\'s');
  source.note(page, { type: 'mouseMove', x: W - 3, y: 400 }, { x: 0, y: 0 }); r.run(400);
  assert.equal(r.shown().side, true, 'the right edge is');
});

test('a page view that does not start at the window\'s origin: the view\'s offset is added to the event position', async () => {
  const { createPointerSource } = require('../desktop/pointer-point.cjs');
  const source = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, now: () => r.clock.t });
  const page = {};
  const r = rig({ events: () => (source.eventsMode() ? source : null) });
  await r.start();
  source.note(page, { type: 'mouseMove', x: 3, y: 90 }, { x: 0, y: 0 }); r.run(320);
  assert.equal(r.shown().side, true);
  const second = rig({ events: () => (second.source.eventsMode() ? second.source : null) });
  second.source = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, now: () => second.clock.t });
  await second.start();
  second.source.note(page, { type: 'mouseMove', x: 3, y: 90 }, { x: 300, y: 0 }); second.run(600);   // the same local position in a view that starts 300 px in: it is not at the edge
  assert.equal(second.shown().side, false);
});

test('the window\'s box on Wayland can sit anywhere (a frame drawn inside the window): the controller is given the content size at the origin, the events\' own space', async () => {
  const pointer = { x: 600, y: 400 };
  const r = rig({ contentBox: { x: 8, y: 37, width: W, height: H }, events: { point: () => pointer } });
  await r.start();
  r.run(100);
  pointer.x = 2;
  r.run(320);
  assert.equal(r.shown().side, true, 'a box that starts at (8, 37) in the system\'s coordinates does not matter');
});

test('WSLg, as measured: the window\'s x and y are a made-up constant (460, 190) and may even change between looks; only its size is used', async () => {
  const pointer = { x: 600, y: 400 };
  let looks = 0;
  // The size is real, the origin is not: a different made-up origin on every look (a resize-like change each tick, if the origin were used).
  const contentBox = { get x() { return 460 + (looks++ % 3); }, get y() { return 190 + (looks % 2); }, width: W, height: H };
  const r = rig({ contentBox, events: { point: () => pointer } });
  await r.start();
  r.run(100);
  pointer.x = 2;
  r.run(320);
  assert.equal(r.shown().side, true, 'the wobbling origin neither shifts the zone nor blocks it as "the window moved"');
  assert.equal(looks, 0, 'the window\'s x and y are never read on the events path, only its width and height');
});

test('the events\' globalX and globalY are never read: they are x and y plus the made-up origin on Wayland', async () => {
  const { createPointerSource } = require('../desktop/pointer-point.cjs');
  const source = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, now: () => r.clock.t });
  const page = {};
  const r = rig({ contentBox: { x: 460, y: 190, width: W, height: H }, events: () => (source.eventsMode() ? source : null) });
  await r.start();
  // The pointer is at the left edge of the page (x 3); the event's global fields say (463, 400): the made-up origin plus x. Reading them would put the pointer 463 px in.
  source.note(page, { type: 'mouseMove', x: 3, y: 400, globalX: 463, globalY: 590 }, { x: 0, y: 0 });
  assert.deepEqual(source.point(), { x: 3, y: 400 });
  r.run(320);
  assert.equal(r.shown().side, true, 'revealed from x, which is what the view says');
  const far = createPointerSource({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } });
  far.note(page, { type: 'mouseMove', x: 700, y: 400, globalX: 3 + 460, globalY: 400 + 190 }, { x: 0, y: 0 });
  assert.deepEqual(far.point(), { x: 700, y: 400 }, 'and not the other way round either');
});

test('learned: a Linux session not recognised as Wayland whose screen call is a constant (0, 0) while the pointer moves switches to the events, once', async () => {
  const { createPointerSource, forgetForTests } = require('../desktop/pointer-point.cjs');
  forgetForTests();
  const logs = [];
  const source = createPointerSource({ platform: 'linux', env: {}, now: () => r.clock.t, log: m => logs.push(m) });
  const page = {};
  const r = rig({ events: () => (source.eventsMode() ? source : null), cursorRead: p => source.noteCursorRead(p) });
  assert.equal(source.eventsMode(), false, 'not Wayland by the environment: the screen call, as before');
  await r.start();
  source.note(page, { type: 'mouseMove', x: 3, y: 400 }, { x: 0, y: 0 });   // the pointer is at the edge; the screen says (0, 0)
  r.run(100);
  assert.equal(r.shown().side, false, 'the first looks still read the screen: (0, 0)');
  for (let i = 0; i < 8; i++) { source.note(page, { type: 'mouseMove', x: 3, y: 400 + (i % 2) }, { x: 0, y: 0 }); r.run(160); }
  assert.equal(source.eventsMode(), true, 'after a short run of constant (0, 0) answers the events are used');
  assert.equal(r.shown().side, true, 'and the sidebar is revealed');
  assert.equal(logs.length, 1, 'said once');
  forgetForTests();
});

test('Mac, Windows and X11: no pointer source, the screen call is the pointer, as before', async () => {
  const reads = [];
  const r = rig({ screenAnswer: { x: 2, y: 400 }, events: () => null, cursorRead: p => reads.push(p) });
  await r.start();
  r.run(320);
  assert.equal(r.shown().side, true, 'the screen call reveals the sidebar');
  assert.ok(r.screen.reads > 5 && reads.length === r.screen.reads, 'every screen answer is passed on to be learned from, none is dropped');
  const bare = rig({ screenAnswer: { x: 2, y: 400 } });             // an item with neither field (every other platform's)
  await bare.start();
  bare.run(320);
  assert.equal(bare.shown().side, true);
});
