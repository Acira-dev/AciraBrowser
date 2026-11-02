import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clipOf, MIN_VISIBLE, visibleAnchor, type ClipNode } from '../src/ui/visibleAnchor';

// R7: in a compact strip at a narrow window and 150%, a group's editor opened under the part of its chip the strip had
// scrolled out of view. It must hang from what is on screen: the chip's visible part, else the strip's overflow control on
// the chip's side, else the strip's edge there.
const node = (box: { x: number; y: number; width: number; height: number }, parent: ClipNode | null, overflow = 'visible'): ClipNode & { overflow: string } =>
  ({ parentElement: parent, getBoundingClientRect: () => box, overflow });
const styleOf = (item: ClipNode) => { const value = (item as ClipNode & { overflow: string }).overflow; return { overflowX: value, overflowY: value === 'visible' ? 'visible' : value }; };
const viewport = { width: 900, height: 720 };
// A compact row: ‹ at 128-152, the scrolling viewport at 154-250 (overflow hidden), › at 252-276.
const before = { x: 128, y: 1, width: 24, height: 30 }, after = { x: 252, y: 1, width: 24, height: 30 };
const strip = node({ x: 154, y: 1, width: 96, height: 30 }, node({ x: 0, y: 0, width: 900, height: 34 }, null), 'hidden');

test('clipOf intersects the window with every ancestor that clips', () => {
  assert.deepEqual(clipOf(node({ x: 100, y: 1, width: 96, height: 30 }, strip), viewport, styleOf), { left: 154, top: 1, right: 250, bottom: 31 });
  // An axis that is not clipped keeps the window's extent on that axis.
  const sideways = node({ x: 0, y: 40, width: 260, height: 400 }, null);
  (sideways as ClipNode & { overflow: string }).overflow = 'visible';
  const list = { parentElement: sideways, getBoundingClientRect: () => ({ x: 0, y: 40, width: 260, height: 400 }) };
  const style = (item: ClipNode) => item === list ? { overflowX: 'visible', overflowY: 'auto' } : { overflowX: 'visible', overflowY: 'visible' };
  assert.deepEqual(clipOf(node({ x: 8, y: 30, width: 220, height: 32 }, list), viewport, style), { left: 0, top: 40, right: 900, bottom: 440 });
});

test('a chip in full view anchors as itself', () => {
  const chip = { x: 160, y: 1, width: 80, height: 30 };
  assert.deepEqual(visibleAnchor(chip, { left: 154, top: 1, right: 250, bottom: 31 }, { before, after }), { rect: chip, via: 'item' });
});

test('a half-hidden chip anchors on the part in view, never on its hidden part (the R7 bug)', () => {
  // The founder's case measured by qa/group-editor-visible.mjs: chip 154-250 scrolled so only its right half shows.
  const chip = { x: 106, y: 1, width: 96, height: 30 }, pick = visibleAnchor(chip, { left: 154, top: 1, right: 250, bottom: 31 }, { before, after });
  assert.equal(pick.via, 'part');
  assert.deepEqual(pick.rect, { x: 154, y: 1, width: 48, height: 30 });
  assert.ok(pick.rect.x >= 154, 'the editor never starts left of the strip');
});

test('a chip scrolled out of view anchors on the overflow control on its side', () => {
  const clip = { left: 154, top: 1, right: 250, bottom: 31 };
  assert.deepEqual(visibleAnchor({ x: 40, y: 1, width: 21, height: 30 }, clip, { before, after }), { rect: before, via: 'control' });
  assert.deepEqual(visibleAnchor({ x: 300, y: 1, width: 96, height: 30 }, clip, { before, after }), { rect: after, via: 'control' });
  // A sliver under MIN_VISIBLE is not something to point at either.
  assert.equal(visibleAnchor({ x: 154 - 96 + MIN_VISIBLE - 1, y: 1, width: 96, height: 30 }, clip, { before, after }).via, 'control');
});

test('with no control on that side it hangs from the strip edge, inside the window', () => {
  const clip = { left: 154, top: 1, right: 250, bottom: 31 };
  assert.deepEqual(visibleAnchor({ x: 40, y: 1, width: 21, height: 30 }, clip, { after }), { rect: { x: 154, y: 1, width: MIN_VISIBLE, height: 30 }, via: 'edge' });
  assert.deepEqual(visibleAnchor({ x: 300, y: 1, width: 96, height: 30 }, clip, { before, after: null }), { rect: { x: 250 - MIN_VISIBLE, y: 1, width: MIN_VISIBLE, height: 30 }, via: 'edge' });
  // A hidden (zero-width) control does not count.
  assert.equal(visibleAnchor({ x: 40, y: 1, width: 21, height: 30 }, clip, { before: { x: 154, y: 1, width: 0, height: 30 } }).via, 'edge');
});

test('a sidebar header scrolled out of its list anchors on the list edge it went past', () => {
  const clip = { left: 0, top: 120, right: 900, bottom: 600 };
  assert.deepEqual(visibleAnchor({ x: 8, y: 60, width: 220, height: 32 }, clip), { rect: { x: 8, y: 120, width: 220, height: MIN_VISIBLE }, via: 'edge' });
  assert.deepEqual(visibleAnchor({ x: 8, y: 104, width: 220, height: 32 }, clip).via, 'part');
});

test('App opens every group popup through the visible anchor (chip, header, member tab, condensed compact row)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /groupAnchorBox = \(node: HTMLElement\)/);
  assert.match(app, /kind === 'group-context' && node\.matches\('\.tab-group-badge,\.sb-group-header,\.browser-tab,\.sb-tab,\.acira-compact-tab'\) \? groupAnchorBox\(node\)/);
  assert.match(app, /rect = node \? groupAnchorBox\(node\) : undefined/);
  assert.match(app, /groupEditorPlacement\(header \? groupAnchorBox\(header\) : beside/);
  assert.match(app, /\|\| tabsOverviewButton\(\) \|\| node;/);
  assert.doesNotMatch(app, /groupEditorPlacement\(header \? settledBox\(header\)/);
});
