'use strict';
// R3-68 Seamless: the edge reveal state machine on a fake clock. Every number is the spec's (SEAMLESS_MODE_SPEC.md §4.2 to §4.4):
// R4-24: 8px (top) / 10px (side) zones, 90ms dwell (40ms pushing or arriving fast), exit-across-edge reveal, 200 / 300ms grace,
// 400ms minimum visible, 250ms lockout, 200px / 2500ms outside.
const test = require('node:test'), assert = require('node:assert/strict');
const { createEdgeController, watchChromeEdges, EDGE, DWELL, DWELL_PUSH, APPROACH, SWEEP, EXIT, EXIT_DWELL, GRACE, KEY_GRACE, MIN_VISIBLE, LOCKOUT, OUTSIDE, OUTSIDE_CAP } = require('../desktop/edge-reveal.cjs');

const STEP = 16;
const win = { x: 100, y: 50, width: 1200, height: 800 };
const base = { focused: true, suspended: false, view: 'seamless', vertical: true, docked: false, edges: { top: true, side: true }, holds: { top: false, side: false }, size: { topHeight: 72, sideWidth: 240 }, bounds: win };
const at = (x, y) => ({ x: win.x + x, y: win.y + y });
const away = at(600, 400);                  // the middle of the page
for (const view of ['compact', 'focus', 'full']) test(view + ': moving from the sidebar into the connected toolbar keeps it open until the page is entered', () => {
  const r = rig({view, peek:{full:true,compact:true,focus:true}});
  assert.equal(r.hold(at(1,300),500).side,true);
  assert.equal(r.hold(at(180,300),800).side,true);
  assert.equal(r.hold(at(600,20),800).side,true);
  assert.equal(r.hold(away,800).side,false);
});
function rig(extra = {}) {
  const clock = { t: 10_000 };
  const controller = createEdgeController({ now: () => clock.t });
  let last = { top: false, side: false };
  /** Samples every STEP ms for `ms`, returns the last result. `point` may be a function of elapsed ms. */
  const hold = (point, ms, over = {}) => {
    for (let elapsed = 0; elapsed <= ms; elapsed += STEP) {
      last = controller.sample({ ...base, ...extra, ...over, point: typeof point === 'function' ? point(elapsed) : point });
      if (elapsed + STEP <= ms) clock.t += STEP;
    }
    clock.t += STEP;
    return last;
  };
  /** The first elapsed ms at which `zone` shows (null when it never does within `limit`). */
  const until = (zone, point, limit, over = {}) => {
    for (let elapsed = 0; elapsed <= limit; elapsed += STEP) {
      const r = controller.sample({ ...base, ...extra, ...over, point });
      if (r[zone]) return elapsed;
      clock.t += STEP;
    }
    return null;
  };
  const untilHidden = (zone, point, limit, over = {}) => {
    for (let elapsed = 0; elapsed <= limit; elapsed += STEP) {
      const r = controller.sample({ ...base, ...extra, ...over, point });
      if (!r[zone]) return elapsed;
      clock.t += STEP;
    }
    return null;
  };
  const wait = ms => { clock.t += ms; };
  return { clock, controller, hold, until, untilHidden, wait, get last() { return last; } };
}
const within = (value, expected, slack = STEP * 2) => assert.ok(value !== null && Math.abs(value - expected) <= slack, `expected about ${expected}ms, got ${value}`);

test('the numbers are the spec\'s', () => {
  assert.deepEqual(EDGE, { top: 8, side: 10 });
  assert.deepEqual(DWELL, { top: 90, side: 90 });
  assert.deepEqual(DWELL_PUSH, { top: 40, side: 40 });
  assert.deepEqual(EXIT, { top: 100, side: 160 });
  assert.equal(EXIT_DWELL, 50);
  assert.deepEqual(GRACE, { top: 300, side: 200 });
  assert.equal(KEY_GRACE, 400);
  assert.equal(MIN_VISIBLE, 400);
  assert.equal(LOCKOUT, 250);
  assert.equal(OUTSIDE, 200);
  assert.equal(OUTSIDE_CAP, 2500);
});

// ---- B. zones and timing -------------------------------------------------------------------------------------------------
test('9: crossing the left zone in under the dwell does not reveal; resting 90ms does; the top too', () => {
  const quick = rig();
  quick.hold(at(3, 300), 64);                          // 4 samples, ~64ms in the zone
  assert.deepEqual([quick.last.side, quick.last.top], [false, false]);
  quick.hold(away, 200);
  assert.equal(quick.last.side, false, 'nothing appears afterwards either');
  const rest = rig();
  within(rest.until('side', at(3, 300), 400), DWELL.side);
  const top = rig();
  within(top.until('top', at(400, 3), 400), DWELL.top);
  const early = rig();
  assert.equal(early.hold(at(400, 3), 64).top, false, '64ms is not enough at the top');
});

test('9: pressing against the screen edge means it: half the dwell', () => {
  const side = rig(), top = rig();
  within(side.until('side', at(0, 300), 400), DWELL_PUSH.side);
  within(top.until('top', at(400, 0), 400), DWELL_PUSH.top);
});

test('10: the corner belongs to the top; an edge switched off reveals nothing; the strip layout has no side zone', () => {
  const corner = rig();
  corner.hold(at(2, 2), 400);
  assert.deepEqual([corner.last.top, corner.last.side], [true, false], 'top wins in the corner');
  const topOff = rig({ edges: { top: false, side: true } });
  assert.equal(topOff.hold(at(400, 2), 600).top, false);
  const sideOff = rig({ edges: { top: true, side: false } });
  assert.equal(sideOff.hold(at(2, 300), 600).side, false);
  assert.equal(sideOff.hold(at(400, 2), 400).top, true, 'the other edge still works');
  const strip = rig({ vertical: false });
  assert.equal(strip.hold(at(2, 300), 600).side, false, 'tabs in the strip: no sidebar to reveal');
});

test('10: other views do not reveal the top; a closed sidebar still peeks, a docked one does not', () => {
  const full = rig({ view: 'full' });
  assert.equal(full.hold(at(400, 2), 600).top, false, 'Full has its toolbar already');
  assert.equal(full.hold(at(2, 300), 400).side, true, 'the closed sidebar peeks on the left edge, as before');
  const docked = rig({ view: 'full', docked: true });
  assert.equal(docked.hold(at(2, 300), 600).side, false, 'a docked sidebar is already there');
  const focus = rig({ view: 'focus' });
  assert.equal(focus.hold(at(400, 2), 600).top, false);
});

test('11: leaving the revealed chrome hides it after the grace (200 side, 300 top, never before 400ms shown); re-entering cancels', () => {
  const side = rig();
  side.hold(at(3, 300), 200);
  assert.equal(side.last.side, true);
  side.wait(500);                                       // visible long enough
  const gone = side.untilHidden('side', away, 1000);
  within(gone, GRACE.side);
  const top = rig();
  top.hold(at(400, 3), 200);
  top.wait(500);
  within(top.untilHidden('top', away, 1000), GRACE.top);
  // re-entering inside the grace cancels it
  const back = rig();
  back.hold(at(3, 300), 200); back.wait(500);
  back.hold(away, 100);                                 // grace running (100 of 200ms)
  assert.equal(back.last.side, true);
  back.hold(at(100, 300), 32);                          // back on the sidebar
  back.hold(away, 120);                                 // a new grace starts from here, not from the first exit
  assert.equal(back.last.side, true, 'the first exit\'s timer does not hide it');
});

test('11: jitter outside the chrome never restarts a running grace', () => {
  const r = rig();
  r.hold(at(3, 300), 200); r.wait(500);
  const jitter = elapsed => at(500 + (elapsed % 64 < 32 ? 0 : 80), 300 + (elapsed % 96 < 48 ? 0 : 60));
  const gone = r.untilHidden('side', jitter(0), 600);
  assert.ok(gone !== null);
  const r2 = rig();
  r2.hold(at(3, 300), 200); r2.wait(500);
  let elapsed = 0, hiddenAt = null;
  for (; elapsed < 800 && hiddenAt === null; elapsed += STEP) {
    const result = r2.controller.sample({ ...base, point: jitter(elapsed) });
    r2.clock.t += STEP;
    if (!result.side) hiddenAt = elapsed;
  }
  within(hiddenAt, GRACE.side);
});

test('12: visible for at least 400ms, and no re-reveal for 250ms after a hide', () => {
  const r = rig();
  r.hold(at(3, 300), 200);                              // revealed at ~120ms
  const shownFor = r.untilHidden('side', away, 1000);
  assert.ok(shownFor >= MIN_VISIBLE - STEP * 2 - 120, `hid after ${shownFor}ms of grace, which would cut the 400ms minimum`);
  // lockout: the pointer goes straight back to the edge after the hide
  const hiddenAt = r.clock.t;
  const again = r.until('side', at(3, 300), 1000);
  assert.ok(again >= LOCKOUT + DWELL.side - STEP * 3, `re-revealed after ${again}ms; the 250ms lockout plus the dwell was skipped`);
  assert.ok(r.clock.t - hiddenAt >= LOCKOUT);
});

test('13: leaving through the window edge stays within 200px and 2500ms, hides beyond either, and a blur hides at once', () => {
  const near = at(-50, 300), far = at(-260, 300);
  const stays = rig();
  stays.hold(at(3, 300), 200); stays.wait(500);
  assert.equal(stays.hold(near, 2200).side, true, 'within 200px outside, still there after 2.2s');
  const cap = rig();
  cap.hold(at(3, 300), 200); cap.wait(500);
  cap.hold(near, 2300);
  within(cap.untilHidden('side', near, 1500), OUTSIDE_CAP - 2300 + GRACE.side, 160);
  const beyond = rig();
  beyond.hold(at(3, 300), 200); beyond.wait(500);
  within(beyond.untilHidden('side', far, 1000), GRACE.side);
  const blur = rig();
  blur.hold(at(3, 300), 200);
  assert.equal(blur.hold(at(3, 300), 0, { focused: false }).side, false, 'deactivation hides at once, the pointer still on the edge');
  const kept = rig();
  kept.hold(at(3, 300), 200);
  assert.equal(kept.hold(away, 800, { focused: false, holds: { top: false, side: true } }).side, true, 'unless something holds it');
});

test('14: dragging the window\'s border does not pop the sidebar', () => {
  const r = rig();
  const grow = elapsed => at(3, 300);
  let bounds = { ...win }, shown = false;
  for (let elapsed = 0; elapsed < 600; elapsed += STEP) {
    bounds = { ...bounds, x: bounds.x - 1, width: bounds.width + 1 };        // the border follows the pointer: the window changes every sample
    const point = { x: bounds.x + 3, y: win.y + 300 };
    if (r.controller.sample({ ...base, bounds, point }).side) shown = true;
    r.clock.t += STEP;
  }
  assert.equal(shown, false, 'no reveal while the window geometry changes');
  // the pointer rests there after the drag: still blocked until it leaves the zone
  let after = false;
  for (let elapsed = 0; elapsed < 600; elapsed += STEP) { if (r.controller.sample({ ...base, bounds, point: { x: bounds.x + 3, y: win.y + 300 } }).side) after = true; r.clock.t += STEP; }
  assert.equal(after, false, 'blocked until the pointer leaves');
  r.controller.sample({ ...base, bounds, point: { x: bounds.x + 400, y: win.y + 300 } });
  r.clock.t += STEP;
  let again = false;
  for (let elapsed = 0; elapsed < 400; elapsed += STEP) { if (r.controller.sample({ ...base, bounds, point: { x: bounds.x + 3, y: win.y + 300 } }).side) again = true; r.clock.t += STEP; }
  assert.equal(again, true, 'then it works again');
  r.controller.geometryChanged();                                                  // the poller also hears the window's own resize and move events
});

test('15: crossing a shared monitor edge quickly does not reveal; resting inside the window does', () => {
  const r = rig();
  const crossing = elapsed => elapsed < 48 ? at(2, 300) : at(300 + elapsed, 300);
  const r1 = r.hold(crossing, 400);
  assert.equal(r1.side, false);
  const rest = rig();
  rest.hold(at(-30, 300), 200);                          // outside the window (on the neighbour): nothing
  assert.equal(rest.last.side, false);
  within(rest.until('side', at(3, 300), 400), DWELL.side);
});

// ---- C. holds ------------------------------------------------------------------------------------------------------------------
test('16: Ctrl+L (an address field with focus) shows the top with the pointer nowhere near; when focus leaves it hides 400ms later', () => {
  const r = rig();
  const asked = { keys: { top: true, side: false } };
  assert.equal(r.hold(away, 1500, asked).top, true, 'shown at once, and kept while the address has focus');
  within(r.untilHidden('top', away, 1500), KEY_GRACE, STEP * 3);
});

test('16: a menu, a drag or focus in the chrome only keep what is showing: a right-click in the page never pops the toolbar', () => {
  const r = rig();
  const kept = { holds: { top: true, side: true } };
  assert.deepEqual([r.hold(away, 800, kept).top, r.last.side], [false, false], 'nothing is showing, so nothing is kept');
});

test('17: a popup anchored in the chrome holds it; closing it with the pointer outside the window waits for the pointer to return', () => {
  const r = rig();
  r.hold(at(400, 3), 200); r.wait(500);                  // revealed by the pointer
  assert.equal(r.hold(away, 2000, { holds: { top: true, side: false } }).top, true);
  // the menu closes while the pointer is outside the window
  const outside = at(-400, -300);
  assert.equal(r.hold(outside, 1500).top, true, 'waits for the pointer, however long');
  r.hold(away, 100);                                      // back in the window, off the chrome: now the grace runs
  assert.equal(r.last.top, true);
  within(r.untilHidden('top', away, 1000), GRACE.top - 100, STEP * 3);
});

test('17: when a popup closes with the pointer inside the window, the normal grace starts then', () => {
  const r = rig();
  r.hold(at(400, 3), 200); r.wait(500);
  r.hold(away, 2000, { holds: { top: true, side: false } });
  within(r.untilHidden('top', away, 1000), GRACE.top, STEP * 3);
});

test('18: a drag from the revealed sidebar holds it through the drop, then it leaves', () => {
  const r = rig();
  r.hold(at(3, 300), 200); r.wait(500);
  assert.equal(r.hold(away, 3000, { holds: { top: false, side: true } }).side, true);
  within(r.untilHidden('side', away, 1000), GRACE.side, STEP * 3);
});

test('20: keyboard focus inside the revealed chrome holds it, and releasing it lets it go', () => {
  const r = rig();
  r.hold(at(400, 3), 200); r.wait(500);
  assert.equal(r.hold(away, 1500, { holds: { top: true, side: false } }).top, true);
  assert.ok(r.untilHidden('top', away, 1000) !== null);
});

test('pins: Ctrl+Shift+E pins the floating sidebar without the pointer, and it is cleared when Seamless ends', () => {
  const r = rig();
  r.controller.pin('side', true);
  assert.equal(r.hold(away, 1500).side, true);
  assert.equal(r.controller.pinned('side'), true);
  r.controller.pin('side', false);
  within(r.untilHidden('side', away, 1500), KEY_GRACE, STEP * 3);
  const other = rig();
  other.controller.pin('side', true);
  other.hold(away, 200);
  assert.equal(other.hold(away, 200, { view: 'full', docked: true }).side, false, 'leaving Seamless drops the pin');
  assert.equal(other.controller.pinned('side'), false);
});

test('dismiss (Esc, a click in the page) hides at once and clears a pin; the zone stays quiet until the pointer has left and the lockout is over', () => {
  const r = rig();
  r.controller.pin('side', true);
  assert.equal(r.hold(away, 200).side, true);
  r.controller.dismiss('side');
  assert.equal(r.hold(away, 0).side, false, 'gone at once');
  assert.equal(r.controller.pinned('side'), false, 'and unpinned');
  const still = rig();
  still.hold(at(3, 300), 200);
  still.controller.dismiss('side');
  assert.equal(still.hold(at(3, 300), 1000).side, false, 'the pointer still resting on the edge does not bring it back');
  still.hold(away, 300);
  within(still.until('side', at(3, 300), 600), DWELL_PUSH.side);   // the jump back to the edge is a fast arrival: the short dwell
});

test('zones are off while the window is unfocused, minimized, in HTML fullscreen or in setup (suspended)', () => {
  const unfocused = rig();
  assert.equal(unfocused.hold(at(400, 2), 600, { focused: false }).top, false);
  const suspended = rig();
  assert.equal(suspended.hold(at(400, 2), 600, { suspended: true }).top, false);
  const going = rig();
  going.hold(at(400, 3), 200);
  assert.equal(going.hold(at(400, 3), 0, { suspended: true }).top, false, 'a reveal in progress ends at once');
});

test('top and side can both show (Tier B glide); the top\'s corner does not start the sidebar', () => {
  const r = rig();
  r.hold(at(400, 3), 200);
  const both = r.hold(at(3, 300), 300);
  assert.deepEqual([both.top, both.side], [true, true]);
});

// ---- the poller ----------------------------------------------------------------------------------------------------------------
test('the poller emits chrome-edge when an edge changes, polls at 16ms only while it has work, and idles at 250ms', () => {
  const emitted = [], delays = [];
  let timeout = null;
  const clock = { t: 5000 };
  const screen = { point: { x: 0, y: 0 }, getCursorScreenPoint() { return this.point; } };
  const win = { destroyed: false, focused: true, isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; }, isMinimized: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on() {} };
  const state = { settings: { verticalTabs: true } };
  const item = { window: win, state, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false };
  let view = 'seamless';
  const app = { whenReady: () => Promise.resolve(), on() {} };
  const poller = watchChromeEdges({ app, windows: () => [item], screen, view: () => view, now: () => clock.t, schedule: (fn, delay) => { delays.push(delay); timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  return Promise.resolve().then(() => {
    timeout();                                           // the first look-around
    screen.point = { x: 600, y: 400 };
    run(64);
    assert.equal(delays.at(-1), 16, 'fast while a focused Seamless window exists');
    assert.deepEqual(emitted.filter(event => event.type === 'chrome-edge'), [], 'nothing shown while the pointer is in the page');
    screen.point = { x: 400, y: 2 };
    run(160);
    assert.deepEqual(emitted.filter(event => event.type === 'chrome-edge'), [{ type: 'chrome-edge', top: true, side: false, pinned: { top: false, side: false } }]);
    screen.point = { x: 600, y: 400 };
    run(1200);
    assert.deepEqual(emitted.filter(event => event.type === 'chrome-edge').at(-1), { type: 'chrome-edge', top: false, side: false, pinned: { top: false, side: false } });
    view = 'full'; state.settings.verticalTabs = false;
    run(32);
    assert.equal(delays.at(-1), 250, 'idle again: no per-frame work');
    win.focused = false; view = 'seamless'; state.settings.verticalTabs = true;
    run(32);
    assert.equal(delays.at(-1), 250, 'an unfocused window is not polled');
    assert.ok(poller.entryFor(item));
  });
});

test('the page keeps its woken pixel back while an edge shows and gives it back when the edge has gone', () => {
  const wakes = [];
  let timeout = null;
  const clock = { t: 5000 };
  const screen = { point: { x: 600, y: 400 }, getCursorScreenPoint() { return this.point; } };
  const win = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on() {} };
  const item = { window: win, state: { settings: { verticalTabs: false } }, emit() {}, size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false, wake: on => wakes.push(on) };
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [item], screen, view: () => 'seamless', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  return Promise.resolve().then(() => {
    timeout();
    run(64);
    screen.point = { x: 400, y: 2 };
    run(64);
    assert.deepEqual(wakes, [true], 'the dwell wakes the interface');
    run(400);
    assert.deepEqual(wakes, [true], 'still showing: the page keeps the pixel');
    screen.point = { x: 600, y: 400 };
    run(1200);
    assert.deepEqual(wakes, [true, false], 'the edge has gone: the page gets its pixel back');
  });
});

// ---- macOS fullscreen: the notch band above the window, and a fullscreen window that does not hold the keyboard -----------------------------------

test('fullscreen on a notched display: the pointer in the band above the window (the menu bar\'s) shows the top, holds it while it rests there, and a jump from the middle of the page counts', () => {
  const r = rig({ band: 29 });
  // The window's top is at win.y; the band is the 29px above it.
  const band = x => ({ x: win.x + x, y: win.y - 10 });
  assert.equal(r.hold(away, 200).top, false);
  // A jump (no sample close to the edge before it, which the exit-across-the-edge rule needs): the band alone shows the bar, at the short dwell.
  const shown = r.until('top', band(300), 400);
  assert.ok(shown !== null && shown <= DWELL_PUSH.top + STEP * 2, 'shown after the short dwell, got ' + shown);
  assert.equal(r.hold(band(300), OUTSIDE_CAP + 1500).top, true, 'it stays while the pointer rests in the band, past the usual outside tolerance');
  assert.equal(r.hold(away, GRACE.top + 300).top, false, 'and goes after the usual grace once the pointer is back in the page');
});

test('fullscreen band: only the band above the window counts (not beside it, not past its height), and a window without a band behaves as before', () => {
  const r = rig({ band: 29 });
  assert.equal(r.until('top', { x: win.x + 300, y: win.y - 40 }, 700), null, 'above the band: another screen, not the edge');
  assert.equal(r.until('top', { x: win.x - 30, y: win.y - 10 }, 700), null, 'beside the window');
  assert.equal(r.until('top', { x: win.x + win.width + 30, y: win.y - 10 }, 700), null, 'beside the window, right');
  const plain = rig({ band: 0 });
  assert.equal(plain.until('top', { x: win.x + 300, y: win.y - 10 }, 700), null, 'no band (a window that starts at the top of its display): a jump out of the window is no reveal');
});

test('fullscreen band: the band does not reveal while a button is held, and a hold ends only after the pointer has left and returned', () => {
  const r = rig({ band: 29 });
  const band = { x: win.x + 300, y: win.y - 10 };
  assert.equal(r.hold(band, 700, { pressed: true }).top, false);
  assert.equal(r.hold(band, 700).top, false, 'a release in the band is not a rest');
  r.hold(away, 600);
  assert.equal(r.hold(band, 500).top, true, 'after leaving and coming back it shows');
});

test('a fullscreen window whose Space is showing is live without the keyboard: its edges work and its band is read from the display; a windowed one stays idle', () => {
  const emitted = [];
  let timeout = null;
  const clock = { t: 5000 };
  const screen = { point: { x: 600, y: 429 }, getCursorScreenPoint() { return this.point; }, getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1352, height: 878 } }) };
  const win = { focused: false, fullscreen: true, isDestroyed: () => false, isFocused() { return this.focused; }, isFullScreen() { return this.fullscreen; }, isMinimized: () => false, getContentBounds: () => ({ x: 0, y: 29, width: 1352, height: 849 }), on() {} };
  let live = true;
  const item = { window: win, state: { settings: { verticalTabs: true } }, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false, live: () => live };
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [item], screen, view: () => 'seamless', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  const edges = () => emitted.filter(event => event.type === 'chrome-edge');
  return Promise.resolve().then(() => {
    timeout();
    run(64);
    screen.point = { x: 3, y: 429 };                                // the left edge, another app holds the keyboard
    run(320);
    assert.deepEqual(edges().at(-1), { type: 'chrome-edge', top: false, side: true, pinned: { top: false, side: false } }, 'the sidebar shows although the window is not key');
    screen.point = { x: 600, y: 429 };
    run(1200);
    assert.equal(edges().at(-1).side, false);
    screen.point = { x: 600, y: 10 };                               // in the menu bar\'s band above the window (the display starts at y 0, the window at 29)
    run(320);
    assert.equal(edges().at(-1).top, true, 'the band shows the top bar');
    screen.point = { x: 600, y: 429 };
    run(1200);
    assert.equal(edges().at(-1).top, false);
    live = false; win.fullscreen = false;                           // windowed, not key: idle as before
    const before = edges().length;
    screen.point = { x: 3, y: 429 };
    run(480);
    assert.equal(edges().length, before, 'a window that is not fullscreen and not key reveals nothing');
  });
});

// ---- R4-24: the wider zone, intent, and a push out across the edge -----------------------------------------------------------
test('R4-24: the zone reaches 10px into the window on the left and 8px at the top; 11px and 9px are the page', () => {
  within(rig().until('side', at(10, 300), 400), DWELL.side);
  assert.equal(rig().hold(at(11, 300), 400).side, false);
  within(rig().until('top', at(400, 8), 400), DWELL.top);
  assert.equal(rig().hold(at(400, 9), 400).top, false);
});

test('R4-24: arriving fast toward the edge is intent (the short dwell); sliding along the edge is a pass and never reveals', () => {
  // 30px in one 16ms step = 1.9px/ms toward the left edge, then resting in the zone
  const fast = rig();
  fast.hold(at(38, 300), 16);
  within(fast.until('side', at(6, 300), 400), DWELL_PUSH.side);
  // a slow arrival waits the full dwell
  const slow = rig();
  slow.hold(at(12, 300), 16);
  within(slow.until('side', at(8, 300), 400), DWELL.side);
  // a sweep down the edge at 2px/ms (scrolling with the pointer parked at the edge, or heading for the taskbar): nothing
  const sweep = rig();
  assert.equal(sweep.hold(elapsed => at(5, 120 + elapsed * 2), 300).side, false, 'a pass along the edge is not a rest');
  assert.ok(SWEEP <= 32 && APPROACH < 1.9);
  // a slow drift (0.5px/ms, 25px per 50ms) is still a pass: the dwell needs the pointer to stay put along the edge
  const drift = rig();
  assert.equal(drift.hold(elapsed => at(5, 120 + Math.floor(elapsed / 48) * 25), 600).side, false, 'stepping 25px every 48ms along the edge never rests 90ms');
  // resting with a little jitter along the edge (a hand on the mouse) still reveals
  const jitter = rig();
  assert.ok(jitter.until('side', at(5, 300 + 0), 400) !== null);
});

test('R4-24: a push out across the left edge (two monitors) reveals when the pointer stops just past it; going on to the neighbour does not', () => {
  // inside, moving left fast, crosses the edge and stops 60px into the other monitor
  const push = rig();
  push.hold(at(80, 300), 16); push.hold(at(30, 300), 16);
  const shownAt = push.until('side', at(-60, 300), 400);
  within(shownAt, EXIT_DWELL + STEP, STEP * 3);
  assert.equal(push.hold(at(-60, 300), 600).side, true, 'it stays while the pointer is just outside (the outside tolerance)');
  push.hold(at(100, 300), 32);
  assert.equal(push.last.side, true, 'and the pointer comes back onto the sidebar');
  // the same push, but the pointer carries on 300px into the other monitor: no reveal
  const away = rig();
  away.hold(at(80, 300), 16); away.hold(at(30, 300), 16);
  assert.equal(away.hold(elapsed => at(-40 - elapsed * 3, 300), 400).side, false, 'heading for the other monitor is not a reveal');
  // across the top edge (a monitor above)
  const top = rig();
  top.hold(at(400, 60), 16); top.hold(at(400, 20), 16);
  assert.ok(top.until('top', at(400, -40), 400) !== null, 'a push out across the top edge reveals the toolbar');
  // a pointer that was never inside this window (it comes from the neighbour) reveals nothing from outside
  const neighbour = rig();
  assert.equal(neighbour.hold(at(-60, 300), 400).side, false);
  // the window not in use: nothing
  const blurred = rig();
  blurred.hold(at(30, 300), 16, { focused: false });
  assert.equal(blurred.hold(at(-60, 300), 400, { focused: false }).side, false);
});

test('R5: a flick that overshoots onto the neighbouring monitor and comes straight back near the edge reveals at once', () => {
  const { BOUNCE, BOUNCE_WINDOW } = require('../desktop/edge-reveal.cjs');
  assert.deepEqual(BOUNCE, { top: 96, side: 96 }); assert.equal(BOUNCE_WINDOW, 1200);
  const flick = (r, back, gone = 200) => { r.hold(at(80, 300), 16); r.hold(at(30, 300), 16); r.hold(elapsed => at(-40 - elapsed * 3, 300), gone); return r.hold(back, 16); };
  // out 640px onto the other monitor in 200ms, then back in 40px from the edge: shown on the first sample inside
  const back = rig();
  assert.equal(flick(back, at(40, 300)).side, true, 'the overshoot came back: the sidebar shows');
  assert.equal(back.hold(at(120, 300), 400).side, true, 'and stays while the pointer is on it');
  // back in, but far from the edge (heading into the page): nothing
  const far = rig();
  assert.equal(flick(far, at(300, 300)).side, false);
  // back in near the edge, but only after a real trip to the other monitor: the normal dwell rules
  const late = rig();
  assert.equal(flick(late, at(40, 300), BOUNCE_WINDOW + 200).side, false);
  // the top edge (a monitor above)
  const top = rig();
  top.hold(at(400, 60), 16); top.hold(at(400, 20), 16); top.hold(elapsed => at(400, -40 - elapsed * 3), 160);
  assert.equal(top.hold(at(400, 50), 16).top, true);
  // the window not in use: nothing
  const blurred = rig();
  blurred.hold(at(80, 300), 16, { focused: false }); blurred.hold(at(30, 300), 16, { focused: false });
  blurred.hold(elapsed => at(-40 - elapsed * 3, 300), 200, { focused: false });
  assert.equal(blurred.hold(at(40, 300), 16, { focused: false }).side, false);
});

test('R4-24: the hidden caption buttons\' corner (Windows) shows the top at once, so the buttons are back before a click', () => {
  const caption = { width: 140, height: 36 };
  const r = rig({ caption });
  const shown = r.until('top', at(win.width - 30, 20), 200);
  assert.ok(shown !== null && shown <= STEP, `the corner reveals on the first sample, got ${shown}`);
  const none = rig();
  assert.equal(none.hold(at(win.width - 30, 20), 400).top, false, 'without a hidden caption the corner is page');
});

// ---- R5: "Show the closed sidebar at the left edge", one switch per view (Full off, Compact and Focus on) ---------------------
// Founder: "if I close the sidebar, it must not open automatically when the mouse nears the edge, especially in Full view".
const PEEK = { full: false, compact: true, focus: true };

test('R5: in Full a closed sidebar stays closed at the left edge: resting, pressing, a push past the edge and a flick back reveal nothing', () => {
  const full = rig({ view: 'full', peek: PEEK });
  assert.equal(full.hold(at(2, 300), 2000).side, false, 'resting in the zone for 2s');
  assert.equal(full.hold(at(0, 300), 600).side, false, 'pressing against the edge');
  full.hold(away, 300);
  full.hold(at(80, 300), 16); full.hold(at(30, 300), 16);
  assert.equal(full.hold(at(-60, 300), 600).side, false, 'a push out across the edge that stops just past it');
  full.hold(away, 300);
  full.hold(at(80, 300), 16); full.hold(at(30, 300), 16); full.hold(elapsed => at(-40 - elapsed * 3, 300), 200);
  assert.equal(full.hold(at(40, 300), 16).side, false, 'a flick that comes straight back');
  assert.equal(full.controller.active(), false, 'nothing dwelling, nothing showing');
  assert.equal(full.hold(at(400, 2), 600).top, false, 'and Full never reveals the top');
  // The switch is only about a closed sidebar: one opened for good (the keyboard, the toolbar button) is simply there.
  assert.equal(full.hold(at(2, 300), 600, { docked: true }).side, false);
  // Turned on, Full shows it like the other views.
  const on = rig({ view: 'full', peek: { ...PEEK, full: true } });
  within(on.until('side', at(2, 300), 400), DWELL.side);
});

test('R5: Compact and Focus still show the closed sidebar at the left edge with the same timing; each view follows its own switch', () => {
  for (const view of ['compact', 'focus']) {
    const r = rig({ view, peek: PEEK });
    within(r.until('side', at(2, 300), 400), DWELL.side);
    assert.equal(r.hold(at(120, 300), 400).side, true, `${view}: it stays while the pointer is on it`);
    const pressing = rig({ view, peek: PEEK });
    within(pressing.until('side', at(0, 300), 400), DWELL_PUSH.side);
    const off = rig({ view, peek: { ...PEEK, [view]: false } });
    assert.equal(off.hold(at(2, 300), 1000).side, false, `${view} with its switch off`);
  }
  // Seamless ignores these switches: its own "Show the sidebar at the left edge" decides, as before.
  const seamless = rig({ view: 'seamless', peek: { full: false, compact: false, focus: false } });
  within(seamless.until('side', at(2, 300), 400), DWELL.side);
  const seamlessOff = rig({ view: 'seamless', peek: { full: true, compact: true, focus: true }, edges: { top: true, side: false } });
  assert.equal(seamlessOff.hold(at(2, 300), 600).side, false);
});

test('R5: switching views applies at once: a showing sidebar goes when the view becomes Full, and Compact shows it again', () => {
  const r = rig({ peek: PEEK });
  within(r.until('side', at(2, 300), 400, { view: 'compact' }), DWELL.side);
  assert.equal(r.hold(at(120, 300), 16, { view: 'full' }).side, false, 'Full: gone on the next sample, no grace');
  assert.equal(r.hold(at(2, 300), 1000, { view: 'full' }).side, false, 'and the edge stays quiet in Full');
  // Back in Compact with the pointer already parked in the zone: no surprise reveal until it leaves and comes back.
  assert.equal(r.hold(at(2, 300), 400, { view: 'compact' }).side, false, 'the pointer was already there');
  r.hold(away, 300, { view: 'compact' });
  within(r.until('side', at(2, 300), 400, { view: 'compact' }), DWELL_PUSH.side, STEP);   // it arrives fast from the page
  // Turning Compact's switch off while the sidebar shows: gone at once.
  assert.equal(r.hold(at(120, 300), 16, { view: 'compact', peek: { ...PEEK, compact: false } }).side, false);
  // Dwelling in Compact, then Full before the dwell is up: nothing.
  const mid = rig({ peek: PEEK });
  mid.hold(at(2, 300), 48, { view: 'compact' });
  assert.equal(mid.hold(at(2, 300), 600, { view: 'full' }).side, false);
});

test('R5: the keyboard is unaffected: Seamless\'s pin shows the sidebar whatever the other views\' switches say', () => {
  const pin = rig({ view: 'seamless', peek: { full: false, compact: false, focus: false } });
  pin.controller.pin('side', true);
  assert.equal(pin.hold(away, 32).side, true, 'Ctrl+Shift+E in Seamless');
  pin.controller.pin('side', false);
  // In Full the keyboard opens the sidebar for good (docked), which the edge never touches.
  const full = rig({ view: 'full', peek: PEEK, docked: true });
  assert.equal(full.hold(at(2, 300), 600).side, false);
});

test('R5: the poller passes each view\'s switch to the controller; Full with a closed sidebar is idle at the edge and shows nothing', () => {
  const emitted = [], delays = [];
  let timeout = null, view = 'full', peek = { ...PEEK };
  const clock = { t: 5000 };
  const screen = { point: { x: 600, y: 400 }, getCursorScreenPoint() { return this.point; } };
  const win = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on() {} };
  const state = { settings: { verticalTabs: true } };
  const item = { window: win, state, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), peek: () => peek, docked: () => false, suspended: () => false };
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [item], screen, view: () => view, now: () => clock.t, schedule: (fn, delay) => { delays.push(delay); timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  const sides = () => emitted.filter(event => event.type === 'chrome-edge').map(event => event.side);
  return Promise.resolve().then(() => {
    timeout();
    screen.point = { x: 2, y: 300 };
    run(2000);
    assert.equal(delays.at(-1), 250, 'Full with its switch off: nothing to watch, no per-frame work');
    assert.deepEqual(sides(), [], 'the pointer rested at the edge for 2s and nothing showed');
    view = 'compact'; screen.point = { x: 600, y: 400 }; run(64);
    assert.equal(delays.at(-1), 16, 'Compact watches the edge');
    screen.point = { x: 2, y: 300 }; run(160);
    assert.deepEqual(sides(), [true], 'Compact shows it as before');
    view = 'full'; run(16);
    assert.deepEqual(sides(), [true, false], 'switching to Full hides it at once');
    run(64);
    assert.equal(delays.at(-1), 250, 'and idles again');
    peek = { ...peek, full: true }; screen.point = { x: 600, y: 400 }; run(64); screen.point = { x: 2, y: 300 }; run(160);
    assert.deepEqual(sides(), [true, false, true], 'Full with its switch turned on shows it');
  });
});

test('a held button keeps the edge down: a drag reaching the side does not bring the sidebar up, nor its release there', () => {
  const { createEdgeController } = require('../desktop/edge-reveal.cjs');
  let t = 1000; const edge = createEdgeController({ now: () => t });
  const bounds = { x: 0, y: 0, width: 1200, height: 800 }, base = { bounds, focused: true, view: 'compact', vertical: true, peek: { full: true, compact: true, focus: true }, edges: { top: true, side: true } };
  const at = (x, pressed) => { t += 16; return edge.sample({ ...base, point: { x: bounds.x + x, y: 400 }, pressed }); };
  for (let i = 0; i < 60; i++) assert.equal(at(1, true).side, false, 'held at the edge');
  for (let i = 0; i < 60; i++) assert.equal(at(1, false).side, false, 'released at the edge: waits for the pointer to leave it');
  for (let i = 0; i < 10; i++) at(600, false);
  let shown = false; for (let i = 0; i < 60 && !shown; i++) shown = at(1, false).side;
  assert.equal(shown, true, 'a rest at the edge after that brings it up');
});

// ---- R8 edge intent: the pointer is busy, or over something the page can use ---------------------------------------------------
const { ENGAGED_DWELL, ENGAGED_PUSH } = require('../desktop/edge-reveal.cjs');
test('R8: over a control the page draws (a seek bar, a slider, text) a rest at the edge is not yet a request for the sidebar', () => {
  assert.deepEqual([ENGAGED_DWELL.side, ENGAGED_DWELL.top], [650, 650]);
  const calm = rig();
  within(calm.until('side', at(5, 300), 400), DWELL.side, 40);           // empty page: unchanged, instant
  const control = rig();
  assert.equal(control.until('side', at(5, 300), ENGAGED_DWELL.side - 40, { engaged: true }), null, 'no reveal inside the click window');
  const late = rig();
  within(late.until('side', at(5, 300), 900, { engaged: true }), ENGAGED_DWELL.side, 40);
  const top = rig();
  assert.equal(top.until('top', at(400, 3), ENGAGED_DWELL.top - 40, { engaged: true }), null);
  within(rig().until('top', at(400, 3), 900, { engaged: true }), ENGAGED_DWELL.top, 40);
});
test('R8: arriving fast at a control does not take the short dwell; pressing against the very edge does', () => {
  const fast = rig();
  const sweep = elapsed => at(Math.max(5, 120 - elapsed * 2), 300);     // 2px per ms toward the edge, then rests at 5
  assert.equal(fast.until('side', sweep, 300, { engaged: true }), null, 'a fast approach over a control still waits');
  within(rig().until('side', at(0, 300), 600, { engaged: true }), ENGAGED_PUSH.side, 40);
});
test('R8: a held button, in any frame, never reveals the sidebar or the top bar, and a release at the edge needs a leave and a return', () => {
  for (const [zone, edge, off] of [['side', at(4, 300), at(300, 300)], ['top', at(400, 3), at(400, 300)]]) {
    const r = rig();
    assert.equal(r.until(zone, edge, 1500, { pressed: true }), null, zone + ': pressed at the edge');
    assert.equal(r.until(zone, edge, 1500, { pressed: false }), null, zone + ': released at the edge');
    r.hold(off, 400, { pressed: false });
    assert.ok(r.until(zone, edge, 400, { pressed: false }) !== null, zone + ': back at the edge it comes up');
    const dragged = rig();       // pressed inside the page, the pointer carried to the edge and released there
    dragged.hold(off, 100, { pressed: true });
    assert.equal(dragged.until(zone, edge, 800, { pressed: true }), null);
    assert.equal(dragged.until(zone, edge, 800, { pressed: false }), null, zone + ': a drag that ends at the edge');
  }
});
test('R8: a busy pointer also stops the overshoot-and-return reveal, and a key press still shows the edge', () => {
  const r = rig();
  r.hold(at(6, 300), 40, { pressed: true });
  r.hold({ x: win.x - 90, y: win.y + 300 }, 160, { pressed: true });
  assert.equal(r.hold(at(4, 300), 200, { pressed: true }).side, false, 'busy: the return does not reveal');
  const keyed = rig();
  assert.equal(keyed.hold(away, 200, { pressed: true, keys: { top: true, side: false } }).top, true, 'Ctrl+L is not a pointer reveal');
});

// ---- Animation speed: the waits ------------------------------------------------------------------------------------------------
// Premium keeps today's numbers (the same objects); Fast and None (Off / Reduce motion) share the shorter ones. The floors come from the pass-through battery below.
const { WAITS, waitsFor, ENGAGED_DWELL: ENGAGED_REST, ENGAGED_PUSH: ENGAGED_PRESSED } = require('../desktop/edge-reveal.cjs');

test('speed: Premium keeps every wait exactly, Fast and None share the shorter ones, anything else is Premium', () => {
  assert.strictEqual(WAITS.premium.dwell, DWELL);
  assert.strictEqual(WAITS.premium.push, DWELL_PUSH);
  assert.strictEqual(WAITS.premium.engaged, ENGAGED_REST);
  assert.strictEqual(WAITS.premium.engagedPush, ENGAGED_PRESSED);
  assert.strictEqual(WAITS.premium.grace, GRACE);
  assert.equal(WAITS.premium.keyGrace, KEY_GRACE);
  assert.equal(WAITS.premium.minVisible, MIN_VISIBLE);
  assert.equal(WAITS.premium.lockout, LOCKOUT);
  assert.deepEqual(WAITS.fast, { dwell: { top: 60, side: 60 }, push: { top: 30, side: 30 }, engaged: { top: 400, side: 400 }, engagedPush: { top: 180, side: 180 }, grace: { top: 180, side: 120 }, keyGrace: 250, minVisible: 250, lockout: 150 });
  assert.strictEqual(WAITS.off, WAITS.fast, 'None waits as Fast does: the waits are about intent, not motion');
  for (const speed of [undefined, null, '', 'slow', 'constructor', '__proto__', 1]) assert.strictEqual(waitsFor(speed), WAITS.premium, `${String(speed)} is Premium`);
});

for (const speed of ['fast', 'off']) {
  test(`speed ${speed}: a rest shows after 60ms, an arrival or a press after 30ms (Premium 90 and 40)`, () => {
    within(rig({ speed }).until('side', at(5, 300), 400), 60);
    within(rig({ speed }).until('side', at(0, 300), 400), 30);
    within(rig({ speed }).until('top', at(400, 5), 400), 60);
    within(rig({ speed }).until('top', at(400, 0), 400), 30);
    within(rig({ speed: 'premium' }).until('side', at(5, 300), 400), DWELL.side);
    within(rig({ speed: 'premium' }).until('side', at(0, 300), 400), DWELL_PUSH.side);
    within(rig().until('side', at(5, 300), 400), DWELL.side, STEP * 2);
  });

  test(`speed ${speed}: a control under the pointer waits 400ms (180 pressed against the edge); Premium 650 / 260`, () => {
    within(rig({ speed }).until('side', at(5, 300), 900, { engaged: true }), 400, STEP * 2);
    within(rig({ speed }).until('side', at(0, 300), 900, { engaged: true }), 180, STEP * 2);
    within(rig({ speed }).until('top', at(400, 5), 900, { engaged: true }), 400, STEP * 2);
    assert.equal(rig({ speed }).until('side', at(5, 300), 300, { engaged: true }), null, 'no reveal before the click window is mostly over');
    within(rig({ speed: 'premium' }).until('side', at(5, 300), 900, { engaged: true }), ENGAGED_REST.side, STEP * 2);
    within(rig({ speed: 'premium' }).until('side', at(0, 300), 900, { engaged: true }), ENGAGED_PRESSED.side, STEP * 2);
  });

  test(`speed ${speed}: the grace is 120 (side) and 180 (top), the keyboard's 250; Premium 200, 300 and 400`, () => {
    const side = rig({ speed }); side.hold(at(3, 300), 200); side.wait(500);
    within(side.untilHidden('side', away, 1000), 120, STEP * 3);
    const top = rig({ speed }); top.hold(at(400, 3), 200); top.wait(500);
    within(top.untilHidden('top', away, 1000), 180, STEP * 3);
    const keyed = rig({ speed });
    assert.equal(keyed.hold(away, 1500, { keys: { top: true, side: false } }).top, true);
    within(keyed.untilHidden('top', away, 1500), 250, STEP * 3);
  });
}

/** One bar's life: shown by `enter`, left for `leave` once it has stood `stay` ms; the ms it stood and the ms from leaving to hiding. */
function life(speed, enter, leave, stay) {
  const clock = { t: 10_000 }, controller = createEdgeController({ now: () => clock.t });
  let shownAt = null, leftAt = null, hiddenAt = null;
  for (let elapsed = 0; elapsed < 3000 && hiddenAt === null; elapsed += STEP) {
    const point = leftAt !== null || (shownAt !== null && clock.t - shownAt >= stay) ? leave : enter;
    if (point === leave && leftAt === null) leftAt = clock.t;
    const result = controller.sample({ ...base, speed, point });
    if (result.side && shownAt === null) shownAt = clock.t;
    if (shownAt !== null && !result.side) hiddenAt = clock.t;
    clock.t += STEP;
  }
  return { stood: hiddenAt - shownAt, afterLeaving: hiddenAt - leftAt };
}

test('speed: a bar stands at least 250ms in Fast and None (400 in Premium), and a hide locks the edge for 150ms (250 in Premium)', () => {
  within(life('fast', at(3, 300), away, 0).stood, 250, STEP * 2);
  within(life('off', at(3, 300), away, 0).stood, 250, STEP * 2);
  within(life('premium', at(3, 300), away, 0).stood, MIN_VISIBLE, STEP * 2);
  // after the bar has stood long enough, only the grace is left
  within(life('fast', at(3, 300), away, 600).afterLeaving, 120, STEP * 3);
  within(life('premium', at(3, 300), away, 600).afterLeaving, GRACE.side, STEP * 3);
  for (const [speed, lockout, dwell] of [['fast', 150, 60], ['off', 150, 60], ['premium', LOCKOUT, DWELL.side]]) {
    const r = rig({ speed });
    r.hold(at(3, 300), 200);
    r.untilHidden('side', away, 1000);
    const hiddenAt = r.clock.t, again = r.until('side', at(3, 300), 1000);
    assert.ok(again >= lockout + dwell - STEP * 3, `${speed}: re-revealed after ${again}ms, the ${lockout}ms lockout plus the ${dwell}ms wait was skipped`);
    assert.ok(again <= lockout + dwell + STEP * 3, `${speed}: re-revealed only after ${again}ms`);
    assert.ok(r.clock.t - hiddenAt >= lockout);
  }
});

// ---- Animation speed: a passing pointer still passes ---------------------------------------------------------------------------
// desktop/edge-reveal.cjs picks 60/30ms because these traces (the poller's 16ms samples) must not reveal at those waits. The numbers are the simulation's
// (a throwaway harness fed the real controller touches, slides and crossings): below them touches of 20 to 30ms and slides up to 0.5px/ms revealed.
function reveals(speed, trace, ms) {
  const clock = { t: 10_000 }, controller = createEdgeController({ now: () => clock.t });
  for (let elapsed = 0; elapsed <= ms; elapsed += STEP) {
    const result = controller.sample({ ...base, speed, point: trace(elapsed) });
    clock.t += STEP;
    if (result.side || result.top) return true;
  }
  return false;
}
const LEFT = win.x, MID = win.y + 400;
/** Arrives at `v` px/ms, stays `stay` ms in the zone's inner third, then goes back at `v`. */
const touch = (stay, v) => elapsed => { const arrive = 120 / v, x = elapsed < arrive ? LEFT + 124 - v * elapsed : elapsed < arrive + stay ? LEFT + 4 : LEFT + 4 + v * (elapsed - arrive - stay); return { x: Math.max(LEFT + 4, x), y: MID }; };

for (const speed of ['fast', 'off']) {
  test(`speed ${speed}: touching the edge for 30ms or less, sliding along it faster than 0.4px/ms, crossing it on to another screen: all passes`, () => {
    for (const v of [0.4, 1, 3]) for (const stay of [0, 10, 20, 30]) assert.equal(reveals(speed, touch(stay, v), 120 / v + stay + 300), false, `a ${stay}ms touch arriving at ${v}px/ms`);
    for (const v of [0.4, 0.5, 0.7, 1, 2]) assert.equal(reveals(speed, elapsed => ({ x: LEFT + 5, y: win.y + 200 + v * elapsed }), 400 / v), false, `a slide at ${v}px/ms`);
    for (const v of [0.3, 0.5, 1, 3]) assert.equal(reveals(speed, elapsed => ({ x: LEFT + 40 - v * elapsed, y: MID }), 40 / v + 600), false, `crossing to the left at ${v}px/ms`);
    for (const v of [0.3, 0.5, 1, 3]) assert.equal(reveals(speed, elapsed => ({ x: win.x + 600, y: win.y + 40 - v * elapsed }), 40 / v + 600), false, `crossing upward at ${v}px/ms`);
    // and a person who waits at the edge still gets the bar
    assert.equal(reveals(speed, touch(130, 1), 120 + 130 + 300), true);
    assert.equal(reveals(speed, elapsed => ({ x: LEFT + 5, y: MID }), 300), true);
  });
}

test('the poller reads the speed from the window and the shorter waits reach the controller', () => {
  const revealAfter = speed => {
    const emitted = [];
    let timeout = null;
    const clock = { t: 5000 };
    const screen = { getCursorScreenPoint: () => ({ x: 400, y: 2 }) };
    const win = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on() {} };
    const item = { window: win, state: { settings: { verticalTabs: true } }, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false, ...(speed ? { speed: () => speed } : {}) };
    watchChromeEdges({ app: { whenReady: () => Promise.resolve(), on() {} }, windows: () => [item], screen, view: () => 'seamless', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
    return Promise.resolve().then(() => {
      timeout();
      const start = clock.t;
      for (let i = 0; i < 40; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); if (emitted.some(event => event.type === 'chrome-edge' && event.top)) return clock.t - start; }
      return null;
    });
  };
  return Promise.all([revealAfter('premium'), revealAfter(undefined), revealAfter('fast'), revealAfter('off')]).then(([premium, none, fast, off]) => {
    within(premium, DWELL.top, STEP * 3); within(none, DWELL.top, STEP * 3);
    within(fast, 60, STEP * 3); within(off, 60, STEP * 3);
  });
});
