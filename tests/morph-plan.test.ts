import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { atRest, disclosureFrames, glideAt, glideStart, negligible, planList, type Box, type Glide } from '../src/ui/morphPlan';
import { classScales, frequentStretch, springFor, springForFrequent } from '../src/ui/motionTokens';

const box = (x: number, y: number, w = 100, h = 30): Box => ({ x, y, w, h });
const near = (actual: number, expected: number, tolerance: number, label: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);

test('R3-70: planList sorts every element into glides, entries and leavers by layout place', () => {
  const before = new Map([['a', box(0, 0)], ['b', box(0, 36)], ['c', box(0, 72)]]);
  const after = new Map([['a', box(0, 0)], ['c', box(0, 36)], ['d', box(0, 72)]]);
  const plan = planList(before, after);
  assert.deepEqual([...plan.glide.entries()], [['c', { dx: 0, dy: 36 }]], 'c moved up 36px; a stayed');
  assert.deepEqual(plan.enter, ['d']);
  assert.deepEqual(plan.leave, [['b', box(0, 36)]]);
});

test('R3-70: planList ignores sub-pixel layout noise and reports horizontal moves (the bookmarks bar)', () => {
  const before = new Map([['a', box(0, 0)], ['b', box(104, 0)]]);
  const after = new Map([['a', box(0, .3)], ['b', box(160, 0)]]);
  const plan = planList(before, after);
  assert.equal(plan.glide.has('a'), false);
  assert.deepEqual(plan.glide.get('b'), { dx: -56, dy: 0 });
});

const spec = { duration: .15, bounce: 0 };
const glide = (fromY: number, startedAt = 0, pv = 0): Glide => ({ fromX: 0, fromY, startedAt, spec, pv });

test('R3-70: a glide starts at its offset, settles to its layout place, and approaches without crossing it', () => {
  const g = glide(100);
  near(glideAt(g, 0).y, 100, 1e-9, 'start');
  let previous = 100;
  for (const t of [20, 50, 80, 120, 200, 400]) { const y = glideAt(g, t).y; assert.ok(y <= previous + 1e-9 && y >= -1e-6, `monotonic at ${t} ms: ${y}`); previous = y; }
  near(glideAt(g, 1000).y, 0, .05, 'rest');
});

test('R3-70: retargeting a glide mid-flight keeps the drawn position and the speed (no stop, no jump)', () => {
  const g1 = glide(100), at = 60, now = glideAt(g1, at);
  assert.ok(now.vy < 0 && now.y > 0, 'still moving towards its place');
  // the layout place moves 40px further up while it is drawn at now.y: it is drawn at now.y + (−40·−1)... shift is previous place − new place
  const start = glideStart(now, { x: 0, y: -40 }), g2: Glide = { fromX: start.fromX, fromY: start.fromY, startedAt: at, spec, pv: start.pv };
  const after = glideAt(g2, at);
  near(after.y, now.y - 40, 1e-9, 'drawn position relative to the new layout place');
  near(after.vy, now.vy, 1e-6, 'speed carried over');
  // and it keeps moving the same way next frame (a restart from rest would have a speed of 0)
  const next = glideAt(g2, at + 16);
  assert.ok(Math.abs(next.y - after.y) > 0, 'moves on the next frame');
});

test('R3-70: glideStart projects the incoming speed on the new direction; rest stays rest', () => {
  assert.deepEqual(glideStart(atRest, { x: 0, y: 50 }), { fromX: 0, fromY: 50, pv: 0 });
  // moving up at 300 px/s, offset 50 px the same way: the progress speed is 6 per second
  const start = glideStart({ x: 0, y: 50, vx: 0, vy: -300 }, { x: 0, y: 0 });
  near(start.pv, 6, 1e-9, 'pv');
  // moving the opposite way: negative progress speed (it first travels away a little, as a spring does)
  assert.ok(glideStart({ x: 0, y: 50, vx: 0, vy: 300 }, { x: 0, y: 0 }).pv < 0);
  assert.equal(negligible({ fromX: .2, fromY: .1 }), true);
  assert.equal(negligible({ fromX: 0, fromY: 3 }), false);
});

test('R3-70: frequent surfaces take 40% of the Premium stretch: 1.28 spatial, 1.16 effects, Fast and Off unchanged', () => {
  near(frequentStretch(classScales.premium.S), 1.28, 1e-9, 'S');
  near(frequentStretch(classScales.premium.E), 1.16, 1e-9, 'E');
  assert.equal(frequentStretch(classScales.premium.L), 1);
  assert.equal(frequentStretch(1), 1);
  assert.equal(frequentStretch(0), 0);
  assert.deepEqual(springForFrequent('reorder.move', 'fast'), springFor('reorder.move', 'fast'));
  const premium = springForFrequent('reorder.move', 'premium')!, full = springFor('reorder.move', 'premium')!, fast = springFor('reorder.move', 'fast')!;
  near(premium.duration, .19, .006, 'reorder.move frequent Premium (150 ms · 1.28, rounded to 5 ms)');
  assert.ok(premium.duration > fast.duration && premium.duration < full.duration, 'between Fast and full Premium');
  assert.equal(springForFrequent('reorder.move', 'off'), null);
});

test('R3-70: a disclosure sweep clips from the top and keeps its bleed once open', () => {
  const frames = disclosureFrames(120);
  assert.equal(frames.collapsed, 'inset(0px -8px 120px -8px)');
  assert.equal(frames.open, 'inset(0px -8px -8px -8px)');
  assert.equal(disclosureFrames(80.456, 4).collapsed, 'inset(0px -4px 80.46px -4px)');
});

test('R3-70: the sweep is wired where it matters (list hook options, speed-aware strips, the disclosure listener)', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  for (const file of ['src/components/CommandPalette.tsx', 'src/components/AddressSuggestions.tsx', 'src/components/TabResults.tsx']) assert.match(read(file), /frequent:\s*true/, `${file} is a frequent surface`);
  for (const file of ['src/features/Library.tsx', 'src/features/BookmarksManager.tsx']) assert.match(read(file), /followers:\s*true/, `${file}: the section below the list glides`);
  assert.match(read('src/components/BookmarksBar.tsx'), /useListMotion\(root/);
  assert.match(read('src/features/settings/SiteListEditor.tsx'), /useListMotion\(rows/);
  assert.match(read('src/main.tsx'), /installDisclosureMotion\(\)/);
  assert.match(read('src/styles/tab-motion.css'), /--tab-duration:calc\(\.48s \* var\(--motion-f,1\)\)/);
  assert.doesNotMatch(read('src/components/BrowserTabsHorizontal.tsx'), /speed=1;/, 'the strip follows the speed setting');
  assert.match(read('src/components/sidebar/AciraSidebar.tsx'), /springMs=\(\)=>stripMs\*frequentStretch/);
});
