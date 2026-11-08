'use strict';
// The sidebar on the right is the left sidebar in a mirror (edge-reveal.cjs, `sidebarSide`): the pointer is mirrored across the window before any
// rule sees it. This runs every scenario of edge-reveal.test.cjs again with each pointer position mirrored and `sidebarSide: 'right'`, and expects
// the same answers, so the right edge reveals, holds, hides, pushes out across the edge and bounces back exactly as the left one does.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require.resolve('../desktop/edge-reveal.cjs'), real = require(path), { watchChromeEdges } = real;

const mirrorPoint = (point, bounds) => point && bounds ? { x: 2 * bounds.x + bounds.width - 1 - point.x, y: point.y } : point;
const mirrored = {
  ...real,
  createEdgeController(options) {
    const controller = real.createEdgeController(options);
    // The caption corner is the window's own top right (Windows), not part of the sidebar's mirror: a scenario that has one keeps its points.
    return { ...controller, sample: input => controller.sample({ ...input, point: input.caption ? input.point : mirrorPoint(input.point, input.bounds), sidebarSide: 'right' }) };
  },
};
require.cache[path].exports = mirrored;
// The scenarios of the left sidebar, run through the mirror.
require('./edge-reveal.test.cjs');

test('the poller reads the sidebar side from the settings: the right edge reveals the sidebar, the left edge does not', () => {
  const run = (sidebarSide, point) => {
    const emitted = [];
    let timeout = null;
    const clock = { t: 5000 };
    const screen = { point: { x: 600, y: 400 }, getCursorScreenPoint() { return this.point; } };
    const win = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on() {} };
    const item = { window: win, state: { settings: { verticalTabs: true, sidebarSide } }, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false };
    watchChromeEdges({ app: { whenReady: () => Promise.resolve(), on() {} }, windows: () => [item], screen, view: () => 'seamless', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
    const step = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
    return Promise.resolve().then(() => { timeout(); step(64); screen.point = point; step(240); return emitted.filter(event => event.type === 'chrome-edge').some(event => event.side); });
  };
  return Promise.all([run('right', { x: 1199, y: 400 }), run('right', { x: 0, y: 400 }), run('left', { x: 0, y: 400 }), run('left', { x: 1199, y: 400 })]).then(([rightAtRight, rightAtLeft, leftAtLeft, leftAtRight]) => {
    assert.equal(rightAtRight, true, 'sidebar on the right: the right edge reveals it');
    assert.equal(rightAtLeft, false, 'sidebar on the right: the left edge reveals nothing');
    assert.equal(leftAtLeft, true, 'sidebar on the left: the left edge reveals it (as always)');
    assert.equal(leftAtRight, false, 'sidebar on the left: the right edge reveals nothing');
  });
});

test('a pointer pressed against the right edge dwells and shows, the left edge does nothing', () => {
  let clock = 1000;
  const controller = real.createEdgeController({ now: () => clock });
  const win = { x: 100, y: 50, width: 1200, height: 800 };
  const base = { focused: true, suspended: false, view: 'seamless', vertical: true, docked: false, edges: { top: true, side: true }, holds: { top: false, side: false }, size: { topHeight: 72, sideWidth: 240 }, bounds: win, sidebarSide: 'right' };
  let shown = null;
  for (let elapsed = 0; elapsed <= 400; elapsed += 16) {
    const r = controller.sample({ ...base, point: { x: win.x + win.width - 1, y: win.y + 400 } });
    if (r.side && shown === null) shown = elapsed;
    clock += 16;
  }
  assert.ok(shown !== null && shown <= 120, 'pressing against the right edge reveals within the push dwell, got ' + shown);
  const other = real.createEdgeController({ now: () => clock });
  let leftShown = false;
  for (let elapsed = 0; elapsed <= 400; elapsed += 16) { leftShown = other.sample({ ...base, point: { x: win.x, y: win.y + 400 } }).side || leftShown; clock += 16; }
  assert.equal(leftShown, false, 'with the sidebar on the right the left edge reveals nothing');
});

test('the Windows caption corner stays at the top right whichever side the sidebar is on', () => {
  let clock = 1000;
  const controller = real.createEdgeController({ now: () => clock });
  const win = { x: 0, y: 0, width: 1200, height: 800 };
  const base = { focused: true, suspended: false, view: 'seamless', vertical: true, docked: false, edges: { top: true, side: true }, holds: { top: false, side: false }, size: { topHeight: 72, sideWidth: 240 }, bounds: win, sidebarSide: 'right', caption: { width: 144, height: 40 } };
  let top = false;
  for (let elapsed = 0; elapsed <= 200; elapsed += 16) { top = controller.sample({ ...base, point: { x: 1150, y: 20 } }).top || top; clock += 16; }
  assert.equal(top, true, 'resting on the caption buttons shows the top bar at once');
});

test('Windows, sidebar on the right: the caption corner shares its upper end with the side zone, and the top wins there; below the buttons the side zone is the sidebar\'s', () => {
  const win = { x: 0, y: 0, width: 1200, height: 800 };
  const base = { focused: true, suspended: false, view: 'seamless', vertical: true, docked: false, edges: { top: true, side: true }, holds: { top: false, side: false }, size: { topHeight: 72, sideWidth: 240 }, bounds: win, sidebarSide: 'right', caption: { width: 144, height: 40 } };
  const shows = point => {
    let clock = 1000;
    const controller = real.createEdgeController({ now: () => clock });
    let result = { top: false, side: false };
    for (let elapsed = 0; elapsed <= 300; elapsed += 16) { result = controller.sample({ ...base, point }); clock += 16; }
    return result;
  };
  const corner = shows({ x: 1199, y: 20 });
  assert.equal(corner.top, true, 'the pointer on the caption buttons shows the top');
  assert.equal(corner.side, false, 'and does not start the sidebar from the same spot');
  const below = shows({ x: 1199, y: 300 });
  assert.equal(below.side, true, 'against the right edge below the buttons it is the sidebar\'s');
  assert.equal(below.top, false);
});

test('the right edge keeps the speed\'s waits: a rest shows after 90ms at Premium, 60ms at Fast and None, 400ms with a control under the pointer at Fast', () => {
  const win = { x: 0, y: 0, width: 1200, height: 800 };
  const revealAfter = (speed, extra = {}) => {
    let clock = 1000;
    const controller = real.createEdgeController({ now: () => clock });
    const base = { focused: true, suspended: false, view: 'seamless', vertical: true, docked: false, edges: { top: true, side: true }, holds: { top: false, side: false }, size: { topHeight: 72, sideWidth: 240 }, bounds: win, sidebarSide: 'right', speed, ...extra };
    // the pointer arrives slowly and rests 6px in from the right edge (not pressing, not fast: the plain rest)
    for (let elapsed = 0; elapsed <= 1000; elapsed += 4) {
      const x = elapsed < 40 ? 1199 - 6 - (40 - elapsed) * 0.1 : 1199 - 6;
      if (controller.sample({ ...base, point: { x, y: 400 } }).side) return elapsed;
      clock += 4;
    }
    return null;
  };
  const premium = revealAfter('premium'), fast = revealAfter('fast'), none = revealAfter('off'), engaged = revealAfter('fast', { engaged: true });
  assert.ok(premium >= 88 && premium <= 110, 'Premium: about 90ms after the pointer is in the zone, got ' + premium);
  assert.ok(fast >= 56 && fast <= 80 && fast < premium, 'Fast: about 60ms after the pointer is in the zone, got ' + fast);
  assert.equal(none, fast, 'None shares the Fast waits');
  assert.ok(engaged >= 396 && engaged <= 430, 'Fast with a control under the pointer still waits about 400ms, got ' + engaged);
});
