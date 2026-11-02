import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { PANE_DROP_MS, cancelPaneDrag, endPaneDrag, movePaneDrag, paneAt, paneDropAction, startPaneDrag, swappedRects, type PaneRect } from '../src/ui/paneDrag';

const rects: PaneRect[] = [
  { tabId: 'a', x: 0, y: 0, width: 400, height: 600 },
  { tabId: 'b', x: 406, y: 0, width: 400, height: 600 },
  { tabId: 'c', x: 812, y: 0, width: 400, height: 600 },
];

test('R3-60: the pane under the pointer is the drop zone; gaps and the outside are none', () => {
  assert.equal(paneAt(rects, { x: 10, y: 10 }), 'a');
  assert.equal(paneAt(rects, { x: 600, y: 300 }), 'b');
  assert.equal(paneAt(rects, { x: 1200, y: 599 }), 'c');
  assert.equal(paneAt(rects, { x: 403, y: 300 }), null, 'the 6px gap between panes');
  assert.equal(paneAt(rects, { x: 600, y: 700 }), null);
});

test('R3-60: dropping on another pane swaps the two tabs; onto itself or nothing is no change', () => {
  assert.deepEqual(paneDropAction({ tabId: 'a', over: 'c' }), { type: 'split.swap', a: 'a', b: 'c' });
  assert.equal(paneDropAction({ tabId: 'a', over: 'a' }), null);
  assert.equal(paneDropAction({ tabId: 'a', over: null }), null);
  const moved = swappedRects(rects, 'a', 'c');
  assert.deepEqual(moved.find(rect => rect.tabId === 'a'), { ...rects[2], tabId: 'a' }, 'a takes c\'s cell');
  assert.deepEqual(moved.find(rect => rect.tabId === 'c'), { ...rects[0], tabId: 'c' }, 'c takes a\'s cell');
  assert.deepEqual(moved.find(rect => rect.tabId === 'b'), rects[1], 'the others stay put');
  assert.deepEqual(swappedRects(rects, 'a', 'missing'), rects);
});

test('R3-60: the drag store follows the pointer, ends in a swap on release over another pane and clears after the glide', async () => {
  startPaneDrag('a', rects, { x: 20, y: 10 });
  movePaneDrag({ x: 1000, y: 300 });
  const action = endPaneDrag();
  assert.deepEqual(action, { type: 'split.swap', a: 'a', b: 'c' });
  assert.equal(endPaneDrag(), null, 'a second release does nothing');
  await new Promise(resolve => setTimeout(resolve, PANE_DROP_MS + 60));
  startPaneDrag('b', rects, { x: 500, y: 10 });
  movePaneDrag({ x: 700, y: 700 });
  assert.equal(endPaneDrag(), null, 'released outside every pane: nothing changes');
  startPaneDrag('b', rects, { x: 500, y: 10 });
  cancelPaneDrag();
  assert.equal(endPaneDrag(), null, 'Escape cancels');
});

test('R3-60: split.swap in the reducer trades the cells and keeps layout and sizes', () => {
  let s = createInitialState(); const first = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://two.test/' }); const second = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://three.test/' }); const third = s.activeTabId;
  s = reduceBrowser(s, { type: 'split.open', tabIds: [first, second, third], layout: 'three-columns' });
  const before = s.windowUi.split!;
  s = reduceBrowser(s, { type: 'split.swap', a: first, b: third });
  assert.deepEqual(s.windowUi.split!.tabIds, [third, second, first]);
  assert.equal(s.windowUi.split!.layout, before.layout);
  assert.deepEqual(s.windowUi.split!.cols, before.cols);
  assert.deepEqual(s.windowUi.splitGroups![0].tabIds, [third, second, first], 'the saved split follows');
});

test('R3-60: the ribbon is about 25px, one left-aligned icon+title unit with the close button on the same centre line, and a drag handle', () => {
  const css = fs.readFileSync(path.resolve('src/features/split/split.css'), 'utf8'), ribbon = fs.readFileSync(path.resolve('src/components/SplitRibbon.tsx'), 'utf8'), app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  assert.match(css, /\.app \.split-label\{height:26px;gap:6px;padding:0 6px 0 10px;/);
  assert.match(css, /\.split-label>span\{flex:1 1 auto;[^}]*text-align:left\}/);
  assert.match(css, /\.split-label>\.split-label-close\.icon-button\{flex:0 0 20px;width:20px;min-width:20px;height:20px;/);
  assert.match(ribbon, /touch-action|setPointerCapture/, 'it is a pointer-captured drag handle');
  assert.match(app, /<SplitRibbon tab=\{t\}/);
  assert.match(app, /ribbonHeight=\{26\}/, 'the stills under a drag sit below a 26px ribbon');
  assert.match(app, /data-pane=\{split \? t\.id : undefined\}/);
});
