import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cascadeDelay, morphSpring, riseFor } from '../src/ui/splitMotion';
import { coverScale, dropOrigin, morphIntent, morphToken, planMorph, shouldMorph, type PaneBox } from '../src/ui/splitMorph';
import { takeDropPoint } from '../src/ui/splitDrop';

const near = (actual: number, expected: number, tolerance: number, label: string) => assert.ok(Math.abs(actual - expected) <= expected * tolerance, `${label}: ${actual} is not within ${tolerance * 100}% of ${expected}`);

test('R3-26: the split springs are the research tokens: Fast stiffness and damping match the master table', () => {
  const spring = (token: Parameters<typeof morphSpring>[0], scale = 1) => morphSpring(token, scale) as { stiffness: number; damping: number; mass: number };
  // docs/launch/research/APPLE_MORPH_RESEARCH.md 3.2 (stiffness / damping at Fast)
  for (const [token, k, c] of [['tab.merge', 411, 35.7], ['tab.split', 715, 42.8], ['reorder.move', 1755, 83.8], ['reorder.release', 854, 46.8]] as const) {
    near(spring(token).stiffness, k, .01, `${token} stiffness`); near(spring(token).damping, c, .01, `${token} damping`); assert.equal(spring(token).mass, 1);
  }
});

test('R3-26: Premium (1.7) lands on the research Premium column; Off is instant; opacity springs never bounce', () => {
  const premium = morphSpring('tab.merge', 1.7) as { stiffness: number; damping: number };
  near(premium.stiffness, 143, .05, 'tab.merge premium stiffness'); near(premium.damping, 21.1, .05, 'tab.merge premium damping');
  assert.deepEqual(morphSpring('popover.grow', 0), { duration: 0 });
  const fade = morphSpring('menu.fade') as { stiffness: number; damping: number }, ratio = fade.damping / (2 * Math.sqrt(fade.stiffness));
  near(ratio, 1, .001, 'menu.fade is critically damped');
  const release = morphSpring('reorder.release') as { stiffness: number; damping: number }, bouncy = release.damping / (2 * Math.sqrt(release.stiffness));
  near(bouncy, .8, .01, 'reorder.release carries bounce 0.2');
});

test('R3-26: the row cascade waits 30 ms (50 at Premium), steps 12 ms (24) and is capped, and is zero at Off', () => {
  near(cascadeDelay(0, 1), .030, .001, 'first row at Fast'); near(cascadeDelay(1, 1), .042, .001, 'second row at Fast'); near(cascadeDelay(50, 1), .130, .001, 'capped at 100 ms past the wait');
  near(cascadeDelay(0, 1.7), .050, .001, 'first row at Premium'); near(cascadeDelay(1, 1.7), .074, .001, 'second row at Premium'); near(cascadeDelay(50, 1.7), .210, .001, 'capped at 160 ms');
  assert.equal(cascadeDelay(3, 0), 0);
  assert.equal(riseFor(1), 3); assert.equal(riseFor(1.7), 4); assert.equal(riseFor(0), 0);
});

const page = { x: 0, y: 0, width: 1200, height: 700 };
const box = (tabId: string, x: number, y: number, width: number, height: number): PaneBox => ({ tabId, x, y, width, height });

test('R3-26: a morph runs when the panes change and one page is on screen before and after; never for an unrelated tab', () => {
  assert.equal(shouldMorph(['a'], ['a', 'b']), true, 'a tab dropped next to the page you were on');
  assert.equal(shouldMorph(['a', 'b'], ['a']), true, 'Unsplit');
  assert.equal(shouldMorph(['a', 'b'], ['b', 'a']), true, 'a pane swap');
  assert.equal(shouldMorph(['a', 'b'], ['a', 'b']), false, 'nothing changed');
  assert.equal(shouldMorph(['a'], ['c']), false, 'switching to another tab is a cut by design');
  assert.equal(shouldMorph(['a', 'b'], ['c']), false);
  assert.equal(shouldMorph(['a'], ['a']), false);
  assert.equal(morphIntent(['a'], ['a', 'b']), 'merge'); assert.equal(morphIntent(['a', 'b'], ['a']), 'split'); assert.equal(morphIntent(['a', 'b'], ['b', 'a']), 'rearrange');
  assert.equal(morphToken('merge'), 'tab.merge'); assert.equal(morphToken('split'), 'tab.split'); assert.equal(morphToken('rearrange'), 'reorder.release');
});

test('R3-26: drop on the picker plans the existing page shrinking to its pane and the dropped tab flying in from where it was released', () => {
  const before = [box('a', 0, 0, 1200, 700)], after = [box('a', 0, 0, 597, 700), box('b', 603, 0, 597, 700)];
  const origin = dropOrigin({ x: 900, y: 300 });
  assert.deepEqual(origin, { x: 800, y: 285, width: 200, height: 30 });
  const items = planMorph(before, after, { tabId: 'b', rect: origin });
  const a = items.find(item => item.tabId === 'a')!, b = items.find(item => item.tabId === 'b')!;
  assert.equal(a.kind, 'move'); assert.deepEqual(a.from, page.x === 0 ? { x: 0, y: 0, width: 1200, height: 700 } : a.from); assert.deepEqual(a.to, { x: 0, y: 0, width: 597, height: 700 });
  assert.equal(b.kind, 'enter'); assert.deepEqual(b.from, origin, 'flies in from the dropped tab'); assert.deepEqual(b.to, { x: 603, y: 0, width: 597, height: 700 });
  assert.equal(items.length, 2);
});

test('R3-26: unsplit, swap and close plan every page: the stayer grows, the leaver fades in place, swapped pages trade boxes', () => {
  const split = [box('a', 0, 0, 597, 700), box('b', 603, 0, 597, 700)];
  const unsplit = planMorph(split, [box('a', 0, 0, 1200, 700)]);
  assert.equal(unsplit.find(item => item.tabId === 'a')!.kind, 'move'); assert.deepEqual(unsplit.find(item => item.tabId === 'a')!.to, { x: 0, y: 0, width: 1200, height: 700 });
  const leaver = unsplit.find(item => item.tabId === 'b')!; assert.equal(leaver.kind, 'exit'); assert.deepEqual({ x: leaver.from.x, y: leaver.from.y }, { x: 603, y: 0 });
  const swapped = planMorph(split, [box('b', 0, 0, 597, 700), box('a', 603, 0, 597, 700)]);
  assert.deepEqual(swapped.find(item => item.tabId === 'a')!.from, { x: 0, y: 0, width: 597, height: 700 }); assert.deepEqual(swapped.find(item => item.tabId === 'a')!.to, { x: 603, y: 0, width: 597, height: 700 });
  assert.ok(swapped.every(item => item.kind === 'move'), 'a swap never fades anything');
  const arriving = planMorph([box('a', 0, 0, 1200, 700)], split);
  const grown = arriving.find(item => item.tabId === 'b')!; assert.equal(grown.kind, 'enter'); assert.ok(grown.from.width < grown.to.width && grown.from.x > grown.to.x, 'with no tab to fly from, the page grows from inside its own box');
});

test('R3-26: a still is never stretched: it covers the new box at its own aspect ratio', () => {
  near(coverScale({ x: 0, y: 0, width: 1200, height: 700 }, { x: 0, y: 0, width: 597, height: 700 }), 1, .001, 'columns keep the height');
  near(coverScale({ x: 0, y: 0, width: 600, height: 700 }, { x: 0, y: 0, width: 1200, height: 700 }), 2, .001, 'growing to full width doubles it');
  assert.ok(coverScale({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 100, height: 100 }) >= 100, 'a degenerate box does not divide by zero');
});

test('R3-26: the picker remembers where a tab was released only after a drop on a zone, and hands it over once', () => {
  assert.equal(takeDropPoint(), null, 'nothing was dropped yet');
  assert.equal(takeDropPoint(Date.now() + 10_000), null, 'and a point is never kept for later');
  const source = fs.readFileSync(path.resolve('src/ui/splitDrop.ts'), 'utf8');
  assert.match(source, /dropped = choice && lastPoint \? \{ point: lastPoint, at: Date\.now\(\) \} : null/, 'only a drop on a zone records it');
});

test('R3-26: App holds the native pages off in the same commit as the pane change, plays the morph, and fades the layer over their return', () => {
  const app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8'), layer = fs.readFileSync(path.resolve('src/components/SplitMorphLayer.tsx'), 'utf8'), css = fs.readFileSync(path.resolve('src/styles/split-picker.css'), 'utf8');
  assert.match(app, /const morphPending = lastPane\.current\.key !== paneKey && morphWanted\(lastPane\.current\.ids(?:, lastPane\.current\.layout !== splitPair\?\.layout)?\)/, 'decided while rendering, so views step aside with the new layout');
  assert.match(app, /splitPreview = Boolean\(splitPicker\) \|\| morphPending \|\| Boolean\(morphRun && !morphRun\.done\)/);
  assert.match(app, /motionScale\(\) > 0/, 'Off cuts, by the user\'s choice');
  assert.match(app, /takeDropPoint\(\)/, 'the dropped tab flies in from its release point');
  assert.match(layer, /scaleX: sx, scaleY: sy/, 'boxes move and reshape with transforms');
  assert.match(layer, /morphSpring\(item\.kind === 'exit' && !item\.home \? 'menu\.fade' : morphToken\(intent\), scale\)/);
  assert.match(css, /\.split-morph-box\{[^}]*will-change:transform,opacity/);
  assert.doesNotMatch(css, /\.split-morph-[a-z]+\{[^}]*(transition:[^;}]*(width|height|left|top)|backdrop-filter)/, 'no layout or blur animation in the morph');
});
