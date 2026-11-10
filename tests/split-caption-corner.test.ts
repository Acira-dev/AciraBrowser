// Windows, Sidebar mode (reported 10 Nov 2026: split view in the Sidebar + address layout "doesn't work, it's really glitchy and weird"): the window's
// caption buttons are a notch over the window's top-right corner, which in a split is the title row of the top-right pane: its reload and close sat under minimise / maximise /
// close. That one pane's title row now keeps its buttons left of the corner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captionCornerPane, captionOverPage } from '../src/features/split/captionCorner';
import { captionNotchWanted } from '../src/ui/addressInSidebar';
import { SPLIT_LAYOUTS, type SplitLayoutId } from '../src/runtime/splitLayout';

const split = (layout: SplitLayoutId) => ({ layout, tabIds: Array.from({ length: SPLIT_LAYOUTS[layout].panes }, (_, i) => `t${i}`) });

test('the pane whose title row reaches the window\'s top-right corner, for every layout', () => {
  const want: Partial<Record<SplitLayoutId, number>> = { columns: 1, rows: 0, 'three-columns': 2, 'three-rows': 0, 'top-two-bottom-one': 1, 'top-one-bottom-two': 0, 'left-one-right-two': 1, 'left-two-right-one': 2, grid: 1, 'four-columns': 3, 'four-rows': 0, 'left-one-right-three': 1, 'left-three-right-one': 3, 'top-one-bottom-three': 0 };
  for (const [layout, index] of Object.entries(want)) assert.equal(captionCornerPane(split(layout as SplitLayoutId), true), index, layout);
  // Every layout names a pane that exists and sits in the top row.
  for (const layout of Object.keys(SPLIT_LAYOUTS) as SplitLayoutId[]) { const i = captionCornerPane(split(layout), true); assert.ok(i >= 0 && i < SPLIT_LAYOUTS[layout].panes && SPLIT_LAYOUTS[layout].areas[0].includes(i), layout); }
});

test('no notch, no split, or one pane: no pane is marked', () => {
  assert.equal(captionCornerPane(split('three-columns'), false), -1);
  assert.equal(captionCornerPane(null, true), -1);
  assert.equal(captionCornerPane({ layout: 'columns', tabIds: ['a'] }, true), -1);
  assert.equal(captionCornerPane({ layout: 'nope' as SplitLayoutId, tabIds: ['a', 'b'] }, true), -1);
});

test('only Windows in Sidebar mode has the notch (the Mac\'s buttons are at the left, the toolbar layouts keep their row)', () => {
  assert.equal(captionNotchWanted('win32', true, false, 'left', false), true);
  assert.equal(captionNotchWanted('darwin', true, false, 'left', false), false);
  assert.equal(captionNotchWanted('win32', false, false, 'left', false), false);
  assert.equal(captionNotchWanted('win32', true, true, 'left', false), false, 'full screen');
});

test('the interface marks that pane and the title row keeps its buttons left of the caption buttons, at any interface scale', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), css = readFileSync(new URL('../src/features/split/split.css', import.meta.url), 'utf8');
  assert.match(app, /data-caption-corner=\{split && splitPair && captionCornerPane\(splitPair, captionOverPage\(document\.documentElement\.dataset\.platform \|\| 'darwin', captionNotch, topSeam, windowFullscreen\)\) === index \? '' : undefined\}/);
  assert.match(css, /\.app \.page-pane\[data-caption-corner\]>\.split-label\{padding-right:calc\(150px \/ var\(--interface-scale, 1\)\)\}/);
});

test('Windows with the toolbar hidden over the page (Seamless, Hide the toolbar) has the caption box over the corner too; never on the Mac or in full screen', () => {
  assert.equal(captionOverPage('win32', false, true, false), true, 'Seamless / Hide the toolbar on Windows');
  assert.equal(captionOverPage('win32', true, false, false), true, 'the Sidebar-mode notch');
  assert.equal(captionOverPage('win32', false, false, false), false, 'the toolbar row holds the buttons');
  assert.equal(captionOverPage('darwin', false, true, false), false, 'the Mac: buttons at the left');
  assert.equal(captionOverPage('linux', false, true, false), false);
  assert.equal(captionOverPage('win32', false, true, true), false, 'full screen: no caption buttons');
});
