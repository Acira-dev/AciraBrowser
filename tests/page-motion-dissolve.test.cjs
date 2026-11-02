'use strict';
// A held slide (the docked sidebar, the toolbar rows) dissolves its one re-layout under a picture of the old layout when the clock
// brings a `dissolve` (desktop/page-dissolve.cjs): the page changes size only once the picture stands over it, and the picture
// follows the page's near edge until it has faded. Without a picture the slide is exactly what it was.
const test = require('node:test'); const assert = require('node:assert/strict');
const { placePageBounds } = require('../desktop/page-motion.cjs');

const OPEN = { x: 240, y: 36, width: 1026, height: 716 }, CLOSED = { x: 0, y: 36, width: 1272, height: 722 };

/** A fake picture: `ready` and the layout report are settled by the test, and every call is logged next to the page's own setBounds. */
function fakeDissolve({ ready = true, readyAfter = 0 } = {}) {
  const log = [], covers = [];
  const dissolve = {
    begin(view, area) {
      let settle; const cover = { area, shown: [], dropped: false, released: null, ready: new Promise(resolve => { settle = resolve; }), laidOut: Promise.resolve(true),
        show(bounds, radius) { if (this.dropped) return false; this.shown.push({ ...bounds, radius }); log.push('show ' + bounds.x + ',' + bounds.width + 'x' + bounds.height); return true; },
        release(done) { this.released = done; log.push('release'); },
        drop() { this.dropped = true; log.push('drop'); } };
      cover.settle = settle; covers.push(cover); log.push('begin ' + (area ? area.width + 'x' + area.height : 'view'));
      if (readyAfter === 0) settle(ready); else cover.after = readyAfter;
      return cover;
    },
  };
  return { dissolve, log, covers };
}
async function glide(start, target, dissolve, { radius = 12, hideAt = -1 } = {}) {
  let now = 0, queued = null, wait = 0; const bounds = [], entry = { view: null, radius };
  const view = { bounds: { ...start }, visible: true, getVisible() { return this.visible; }, getBounds() { return { ...this.bounds }; }, setBounds(next) { this.bounds = { ...next }; bounds.push({ ...next, at: Math.round(now) }); dissolve.log?.push('size ' + next.width + 'x' + next.height); }, setBorderRadius() {}, webContents: { isDestroyed: () => false } };
  entry.view = view;
  const clock = { now: () => now, later: (fn, delay) => { queued = fn; wait = delay; return 7; }, cancel: () => { queued = null; }, dissolve: dissolve.dissolve };
  placePageBounds(entry, target, true, clock, 1000 / 60, 'slide', undefined, radius, true);
  for (let i = 0; i < 400 && queued; i++) {
    if (i === hideAt) view.visible = false;
    for (let k = 0; k < 6; k++) await Promise.resolve();
    for (const cover of dissolve.covers) if (cover.after !== undefined && now >= cover.after) { cover.settle(true); cover.after = undefined; }
    if (!queued) break;
    const fn = queued; queued = null; now += wait; fn();
  }
  for (let k = 0; k < 6; k++) await Promise.resolve();
  return { view, bounds, entry };
}

test('a widening: the page glides at its old size until the picture stands, then takes its final size under it, and the picture follows the near edge', async () => {
  const d = fakeDissolve({ readyAfter: 50 }), { view, bounds } = await glide(OPEN, CLOSED, d);
  assert.deepEqual(d.covers[0].area, { width: 1272, height: 722 }, 'the picture\'s layer is as large as the page will be: it only moves');
  const firstFinal = bounds.findIndex(b => b.width === 1272), before = bounds.slice(0, firstFinal);
  assert.ok(before.length >= 2 && before.every(b => b.width === 1026 && b.height === 716), 'at its old size while the picture is made: ' + JSON.stringify(before.map(b => b.width)));
  assert.ok(d.log.indexOf('show ' + bounds[firstFinal].x + ',1272x722') >= 0 && d.log.indexOf('show ' + bounds[firstFinal].x + ',1272x722') < d.log.indexOf('size 1272x722'), 'the picture is up before the page changes size');
  assert.ok(bounds.slice(firstFinal).every(b => b.width === 1272 && b.height === 722), 'one layout');
  assert.deepEqual(view.bounds, CLOSED, 'lands exactly');
  const shown = d.covers[0].shown; assert.ok(shown.length > 4 && shown.every(s => s.width === 1272 && s.height === 722 && s.radius === 12), 'the picture keeps its size');
  assert.ok(shown.every((s, i) => i === 0 || s.x <= shown[i - 1].x), 'and follows the near edge');
  assert.equal(shown.at(-1).x, 0);
  assert.ok(d.covers[0].released, 'it is released to dissolve once the page lays out'); assert.equal(d.covers[0].dropped, false);
});

test('a widening whose picture is not ready in time, or cannot be made, takes its final size anyway', async () => {
  const never = fakeDissolve({ readyAfter: 1e9 }), slow = await glide(OPEN, CLOSED, never);
  assert.ok(slow.bounds.some(b => b.width === 1272), 'resized after the bound'); assert.deepEqual(slow.view.bounds, CLOSED);
  assert.equal(never.covers[0].dropped, true); assert.equal(never.covers[0].shown.length, 0, 'nothing shown');
  assert.ok(slow.bounds.find(b => b.width === 1272).at <= 180, 'not much later than the bound: ' + slow.bounds.find(b => b.width === 1272).at);
  const failed = fakeDissolve({ ready: false }), bad = await glide(OPEN, CLOSED, failed);
  assert.equal(failed.covers[0].dropped, true); assert.deepEqual(bad.view.bounds, CLOSED);
  assert.ok(bad.bounds[1] ? bad.bounds.slice(0, 4).filter(b => b.width === 1272).length >= 2 : true, 'no picture: the page takes its size from the first frames');
});

test('a narrowing: the picture is made as the glide nears its end, and the page takes its final size only once it stands over the held layout', async () => {
  const d = fakeDissolve(), { view, bounds } = await glide(CLOSED, OPEN, d);
  assert.equal(d.covers.length, 1); assert.equal(d.covers[0].area, undefined, 'a picture of the page as it is, at the size it holds');
  const begin = d.log.indexOf('begin view'), lastHeld = d.log.lastIndexOf('size 1272x722');
  assert.ok(begin > 0 && begin < lastHeld, 'begun while the page is still on its way');
  const show = d.log.findIndex(entry => entry.startsWith('show ')), final = d.log.indexOf('size 1026x716');
  assert.ok(show >= 0 && show < final, 'the picture is up before the page changes size');
  const shown = d.covers[0].shown; assert.equal(shown[0].width, 1272, 'over the layout the page held'); assert.equal(shown[0].x, bounds.at(-2).x, 'exactly where the page stood');
  assert.equal(shown.at(-1).x, 240, 'and it goes with the page to its final place, so the two layouts never stand apart'); assert.equal(shown.at(-1).width, 1272);
  assert.deepEqual(bounds.at(-1), { ...OPEN, at: bounds.at(-1).at }); assert.deepEqual(view.bounds, OPEN);
  assert.equal(bounds.filter(b => b.width === 1026).length, 1, 'laid out once'); assert.ok(d.covers[0].released);
});

test('a narrowing whose picture never comes lands without it, after a bound', async () => {
  const d = fakeDissolve({ readyAfter: 1e9 }), { view, bounds } = await glide(CLOSED, OPEN, d);
  assert.deepEqual(view.bounds, OPEN); assert.equal(d.covers[0].dropped, true); assert.equal(d.covers[0].shown.length, 0);
  const landed = bounds.findIndex(b => b.width === 1026), glideEnd = bounds[landed - 1].at;
  assert.ok(bounds[landed].at - glideEnd <= 400, 'the wait for it is bounded: ' + (bounds[landed].at - glideEnd));
});

test('no picture is made for a slide that is not held, nor without a dissolve on the clock', async () => {
  const d = fakeDissolve();
  let now = 0, queued = null, wait = 0;
  const view = { bounds: { ...OPEN }, getBounds() { return { ...this.bounds }; }, setBounds(next) { this.bounds = { ...next }; }, webContents: { isDestroyed: () => false } }, entry = { view };
  const clock = { now: () => now, later: (fn, delay) => { queued = fn; wait = delay; return 7; }, cancel: () => { queued = null; }, dissolve: d.dissolve };
  placePageBounds(entry, CLOSED, true, clock, 1000 / 60, 'slide', undefined, undefined, false);
  for (let i = 0; i < 200 && queued; i++) { const fn = queued; queued = null; now += wait; fn(); }
  assert.equal(d.covers.length, 0, 'Compact, Focus and a split resize live');
  const split = fakeDissolve(); await glide({ x: 0, y: 36, width: 1272, height: 722 }, { x: 0, y: 36, width: 600, height: 722 }, split);
  assert.equal(split.covers.length, 0, 'a far edge that moves is not held');
});

test('a new move while a picture stands takes the picture down', async () => {
  const d = fakeDissolve(), { entry } = await glide(OPEN, CLOSED, d);
  assert.ok(entry.cover, 'the picture is still up after the glide, fading');
  let now = 0, queued = null;
  const view = entry.view, clock = { now: () => now, later: fn => { queued = fn; return 7; }, cancel: () => { queued = null; }, dissolve: d.dissolve };
  placePageBounds(entry, OPEN, false, clock, 1000 / 60, 'slide', undefined, undefined, true);
  assert.equal(d.covers[0].dropped, true); assert.deepEqual(view.bounds, OPEN);
});

test('a slide whose page a tab switch hid makes no picture at its end, and brings down the one it has', async () => {
  const narrowing = fakeDissolve(), n = await glide(CLOSED, OPEN, narrowing, { hideAt: 2 });
  assert.equal(narrowing.covers.length, 0, 'no picture is begun for a page that is not shown: the layer stood over the new tab page');
  assert.deepEqual(n.view.bounds, OPEN, 'the slide still lands');
  const widening = fakeDissolve({ readyAfter: 60 }), w = await glide(OPEN, CLOSED, widening, { hideAt: 3 });
  assert.equal(widening.covers[0].dropped, true, 'the one begun before the switch comes down'); assert.equal(widening.covers[0].shown.length, 0);
  assert.deepEqual(w.view.bounds, CLOSED);
  const late = fakeDissolve(), l = await glide(CLOSED, OPEN, late, { hideAt: 14 });
  assert.ok(late.covers[0].dropped, 'hidden after its picture was begun: dropped before it is shown'); assert.equal(late.covers[0].shown.length, 0);
  assert.deepEqual(l.view.bounds, OPEN);
});
