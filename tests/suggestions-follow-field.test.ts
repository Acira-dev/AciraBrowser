import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { settleAnchor, type AnchorBox } from '../src/ui/settleAnchor';

// Address suggestions open while the tabs move between Top and Sidebar (a settings change while typing): the panel was placed
// from the field as it was at the commit, still in the old row (measured in the dev build, 1200x760 at 100%: the panel 36px
// above where the field ends up, over the field itself, and 51px to the side), and it stayed there however long one typed.
// The field is now read again once it has stopped moving.

/** Animation frames by hand: each `tick` runs what was queued for that frame. */
function frames() {
  let queue = new Map<number, () => void>(), next = 1;
  return {
    raf: (step: () => void) => { const id = next++; queue.set(id, step); return id; },
    cancel: (id: number) => { queue.delete(id); },
    tick() { const now = queue; queue = new Map(); for (const step of now.values()) step(); },
    pending: () => queue.size,
  };
}

test('the field read at the commit is replaced by where it settles, once it has stayed put for three frames', () => {
  // As measured: the anchor read at the commit (294, 4); the row slides down by its transform and lands at (240, 40).
  const path: AnchorBox[] = [{ x: 294, y: 4, width: 720, height: 28 }, { x: 270, y: 20, width: 720, height: 28 }, { x: 248, y: 34, width: 720, height: 28 }, { x: 240, y: 40, width: 720, height: 28 }];
  let frame = 0;
  const read = () => path[Math.min(frame, path.length - 1)];
  const kept: AnchorBox[] = [], f = frames();
  settleAnchor(read, anchor => kept.push(anchor), 3, 90, f.raf, f.cancel);
  for (let i = 0; i < 12 && f.pending(); i++) { f.tick(); frame++; }
  assert.deepEqual(kept, [{ x: 240, y: 40, width: 720, height: 28 }], 'kept once, where the field ended up');
  assert.equal(f.pending(), 0, 'it stops once settled');
});

test('sub-pixel jitter counts as settled, a field that never stops is taken after the limit, and a new layout cancels the old wait', () => {
  const f = frames(), kept: AnchorBox[] = [];
  let n = 0;
  settleAnchor(() => ({ x: 100 + (n++ % 2) * 0.2, y: 40, width: 300, height: 28 }), anchor => kept.push(anchor), 3, 90, f.raf, f.cancel);
  for (let i = 0; i < 5; i++) f.tick();
  assert.equal(kept.length, 1);
  const g = frames(), moving: AnchorBox[] = [];
  let m = 0;
  settleAnchor(() => ({ x: m++, y: 0, width: 10, height: 10 }), anchor => moving.push(anchor), 3, 90, g.raf, g.cancel);
  for (let i = 0; i < 200 && g.pending(); i++) g.tick();
  assert.equal(moving.length, 1, 'never waits forever');
  const h = frames(), never: AnchorBox[] = [];
  const stop = settleAnchor(() => ({ x: 0, y: 0, width: 1, height: 1 }), anchor => never.push(anchor), 3, 90, h.raf, h.cancel);
  h.tick(); stop();
  for (let i = 0; i < 10; i++) h.tick();
  assert.deepEqual(never, [], 'the effect\'s cleanup stops it');
});

test('the suggestions anchor is placed at once and again once the layout has settled, on every layout change', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf("useLayoutEffect(() => { if (overlay !== 'suggestions')");
  assert.ok(start > 0);
  const effect = app.slice(start, app.indexOf('workspaceOpen]);', start));
  assert.match(effect, /const read = \(\) => popupAnchor\('suggestions', state, undefined, effectiveMode\)/);
  assert.match(effect, /keep\(read\(\)\);\s*return settleAnchor\(read, keep\);/, 'at the commit, then settled; the cleanup cancels a wait a newer change replaces');
  assert.match(app, /\}, \[overlay, effectiveMode, size\.width, style, s\.showHome, s\.verticalTabs, workspaceOpen\]\);/);
});
