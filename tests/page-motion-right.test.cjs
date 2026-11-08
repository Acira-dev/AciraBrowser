'use strict';
// The sidebar on the right: the card's near edge is its RIGHT edge (it follows the sidebar's edge) and its far edge the left one, which stays.
// The held glide (page-motion.cjs `hold`: the page keeps the larger of its two sizes and moves like a picture while it lays out once) is a left-sidebar
// move: mirrored, the page would slide out from under its own left edge and the site's text would jump when it landed, and kept at its larger size
// at the left it would stand over the sidebar (the page is a native view above the interface). So with the sidebar on the right the slide is the live one:
// the viewport follows the spring a frame at a time, the left edge never moving, and a busy page is resized less often (the thinning in page-motion.cjs).
const test = require('node:test'), assert = require('node:assert/strict');
const { placePageBounds } = require('../desktop/page-motion.cjs');

function run(start, target, { smooth = true, busy, radius0 } = {}) {
  let now = 0, queued = null, wait = 1000 / 60;
  const bounds = [], radii = [], view = { bounds: { ...start }, getBounds() { return { ...this.bounds }; }, setBounds(next) { this.bounds = { ...next }; bounds.push({ ...next }); }, setBorderRadius(r) { radii.push(r); }, webContents: { isDestroyed: () => false } };
  const clock = { now: () => now, later: (fn, delay) => { queued = fn; wait = delay; return 1; }, cancel: () => { queued = null; }, ...(busy ? { busy } : {}) };
  const entry = { view, ...(radius0 === undefined ? {} : { radius: radius0 }) };
  placePageBounds(entry, target, true, clock, 1000 / 60, 'slide', undefined, target === whole ? 0 : 8, smooth);
  for (let i = 0; i < 400 && queued; i++) { now += wait; const fn = queued; queued = null; fn(); }
  return { view, bounds, radii, frames: bounds.length };
}
const window = { width: 1280, height: 800 };

// the docked card beside a right sidebar: 6px in from the window's left edge, flush against the sidebar; closed: the whole window under the toolbar
const docked = { x: 6, y: 36, width: 1034, height: 758 }, whole = { x: 0, y: 36, width: 1280, height: 764 };

for (const [name, start, target] of [['close', docked, whole], ['open', whole, docked]]) test(`sidebar on the right, ${name}: the viewport follows the spring a frame at a time and is never held at its larger size`, () => {
  const { view, bounds, frames } = run(start, target);
  assert.ok(frames > 20, 'one viewport per display frame, not one move');
  assert.deepEqual(view.bounds, target);
  const widths = bounds.map(b => b.width), lo = Math.min(start.width, target.width), hi = Math.max(start.width, target.width);
  assert.ok(new Set(widths).size > 10, 'the site lays out at many sizes on the way');
  assert.ok(widths.every(w => w >= lo && w <= hi), 'no frame is wider than the wider resting place or narrower than the narrower one');
  assert.ok(widths.every((w, i) => i === 0 || (target.width < start.width ? w <= widths[i - 1] : w >= widths[i - 1])), 'the width moves one way only');
  const lefts = bounds.map(b => b.x);
  assert.ok(lefts.every(x => x >= Math.min(start.x, target.x) && x <= Math.max(start.x, target.x)), 'the left edge only moves between its two resting places (the 6px inset)');
  assert.ok(bounds.every(b => b.x + b.width <= window.width && b.y + b.height <= window.height), 'the viewport stays inside the window on every frame, so it never stands over the sidebar');
  const rights = bounds.map(b => b.x + b.width);
  assert.ok(rights.every((r, i) => i === 0 || (target.width < start.width ? r <= rights[i - 1] : r >= rights[i - 1])), 'the right edge follows the sidebar in one direction, without overshoot');
});

test('sidebar on the right: a busy page is resized about every 33ms instead of every frame, and still lands exactly', () => {
  // the renderer's share of one core is reported by clock.busy; above 60% on two checks in a row the slide thins out
  const normal = run(docked, whole), strained = run(docked, whole, { busy: () => 1 });
  assert.deepEqual(strained.view.bounds, whole);
  assert.ok(strained.frames < normal.frames, `thinned: ${strained.frames} moves against ${normal.frames}`);
});

test('sidebar on the right: the held glide is not used (it needs the far RIGHT edge to stay), with or without smooth', () => {
  for (const smooth of [true, false]) {
    const { bounds } = run(docked, whole, { smooth });
    assert.ok(bounds.every(b => b.width <= whole.width && b.x >= 0), 'the page never stands wider than its target nor off the left edge');
  }
});

test('sidebar on the right: opening takes the card\'s round corners from the first frame (the card the interface draws is round from its first frame), closing eases them out', () => {
  const opened = run(whole, docked, { radius0: 0 }), closed = run(docked, whole, { radius0: 8 });
  assert.equal(opened.radii[0], 8, 'the first frame of the opening already has the card\'s radius');
  assert.ok(opened.radii.every(r => r === 8), 'and keeps it');
  assert.equal(closed.radii.at(-1), 0, 'closing ends square under the toolbar, as the whole-window page is');
  assert.ok(closed.radii.length > 3 && closed.radii.every((r, i) => i === 0 || r <= closed.radii[i - 1]), 'closing eases the radius down, never up');
});
