'use strict';
// Settings > Appearance > Layout > Hide the toolbar: with tabs in a sidebar, Full / Compact / Focus hide their toolbar like Seamless's. The edge controller treats it as Seamless's top edge
// (same zone, dwell, grace and lock-out) and keeps a closed sidebar's left edge on whatever the per-view switch says. Seamless itself and the other layouts are untouched.
const test = require('node:test'), assert = require('node:assert/strict');
const { createEdgeController, watchChromeEdges, DWELL, GRACE, EDGE } = require('../desktop/edge-reveal.cjs');

const STEP = 16, win = { x: 100, y: 50, width: 1200, height: 800 };
const base = { focused: true, suspended: false, view: 'full', vertical: true, docked: true, edges: { top: true, side: true }, peek: { full: false, compact: false, focus: false }, holds: { top: false, side: false }, size: { topHeight: 36, sideWidth: 240 }, band: 0, bounds: win, topAuto: true };
const at = (x, y) => ({ x: win.x + x, y: win.y + y }), away = at(700, 400);
function rig(extra = {}) {
  const clock = { t: 10_000 }, controller = createEdgeController({ now: () => clock.t });
  let last = { top: false, side: false };
  const hold = (point, ms, over = {}) => { for (let e = 0; e <= ms; e += STEP) { last = controller.sample({ ...base, ...extra, ...over, point }); if (e + STEP <= ms) clock.t += STEP; } clock.t += STEP; return last; };
  const until = (zone, point, limit, over = {}) => { for (let e = 0; e <= limit; e += STEP) { if (controller.sample({ ...base, ...extra, ...over, point })[zone]) return e; clock.t += STEP; } return null; };
  return { clock, controller, hold, until, get last() { return last; } };
}

for (const view of ['full', 'compact', 'focus']) test(view + ': the top edge shows the toolbar when the toolbar is hidden (Seamless\'s rest), whatever the Seamless switches say', () => {
  const r = rig({ view, edges: { top: false, side: false } });
  const t = r.until('top', at(700, 2), 400);
  assert.ok(t !== null && t <= DWELL.top + STEP * 3, 'shows after the rest: ' + t);
  r.hold(at(700, 20), 300);
  assert.equal(r.last.top, true, 'resting on the bar keeps it');
  r.hold(away, GRACE.top + 400);
  assert.equal(r.last.top, false, 'leaving it hides it after the grace');
});

test('without the option the top edge belongs to Seamless alone: Full never reveals the toolbar at the top', () => {
  const r = rig({ topAuto: false });
  r.hold(at(700, 2), 600);
  assert.equal(r.last.top, false);
});

test('Seamless is unchanged by the flag (its own switches decide), and a Seamless window ignores it', () => {
  const off = rig({ view: 'seamless', topAuto: true, edges: { top: false, side: true } });
  off.hold(at(700, 2), 600);
  assert.equal(off.last.top, false, 'Seamless\'s "Show the toolbar at the top edge" off still means off');
  const on = rig({ view: 'seamless', topAuto: false });
  assert.notEqual(on.until('top', at(700, 2), 400), null);
});

test('a closed sidebar comes back from its edge with the toolbar hidden, although the view\'s switch is off', () => {
  const r = rig({ docked: false });
  assert.notEqual(r.until('side', at(2, 300), 400), null);
  const plain = rig({ docked: false, topAuto: false });
  plain.hold(at(2, 300), 600);
  assert.equal(plain.last.side, false, 'without the option Full\'s switch (off) still decides');
});

test('an open (docked) sidebar never floats in, and the top edge still works beside it', () => {
  const r = rig({ docked: true });
  r.hold(at(2, 300), 600);
  assert.equal(r.last.side, false);
  assert.notEqual(rig({ docked: true }).until('top', at(700, 2), 400), null);
});

test('with the toolbar hidden there is no connected frame: the closed sidebar goes when the pointer leaves it for the top strip, as in Seamless', () => {
  const r = rig({ docked: false });
  r.hold(at(2, 300), 300);
  assert.equal(r.last.side, true);
  r.hold(at(600, 20), 800);
  assert.equal(r.last.side, false, 'the strip over the page is not the sidebar\'s frame now');
  const framed = rig({ docked: false, topAuto: false, peek: { full: true, compact: true, focus: true } });
  framed.hold(at(2, 300), 300);
  framed.hold(at(600, 20), 800);
  assert.equal(framed.last.side, true, 'with the toolbar in place Full keeps it (the connected frame)');
});

test('Windows: the caption corner shows the bar at once (the buttons come with it)', () => {
  const r = rig({ caption: { width: 144, height: 36 } });
  const t = r.until('top', at(1190, 10), 300);
  assert.ok(t !== null && t <= STEP * 2, 'at once: ' + t);
});

test('the poller passes the option on: main\'s topAuto() reaches the controller', () => {
  const items = []; let ticks = [];
  const win2 = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => win, on() {} };
  const state = { settings: { verticalTabs: true } };
  const item = { window: win2, state, emit: e => items.push(e), size: () => ({ topHeight: 36, sideWidth: 240 }), holds: () => ({ top: false, side: false }), keys: () => ({ top: false, side: false }), docked: () => true, topAuto: () => true, peek: () => ({ full: false, compact: false, focus: false }), edges: () => ({ top: false, side: false }), speed: () => 'premium', pressed: () => false, engaged: () => false };
  let cursor = at(700, 2), now = 1000;
  const poll = watchChromeEdges({ app: { whenReady: () => new Promise(() => {}), on() {} }, windows: () => [item], screen: { getCursorScreenPoint: () => cursor }, view: () => 'full', now: () => now, schedule: (fn, ms) => { ticks.push(ms); return { unref() {} }; }, cancel() {} });
  for (let i = 0; i < 20; i++) { poll.tick(); now += 16; }
  assert.ok(items.some(e => e.type === 'chrome-edge' && e.top === true), 'the bar was asked for at the top edge');
  const plain = { ...item, topAuto: () => false }; const items2 = []; plain.emit = e => items2.push(e);
  const poll2 = watchChromeEdges({ app: { whenReady: () => new Promise(() => {}), on() {} }, windows: () => [plain], screen: { getCursorScreenPoint: () => cursor }, view: () => 'full', now: () => now, schedule: () => ({ unref() {} }), cancel() {} });
  for (let i = 0; i < 20; i++) { poll2.tick(); now += 16; }
  assert.equal(items2.filter(e => e.top).length, 0);
});
