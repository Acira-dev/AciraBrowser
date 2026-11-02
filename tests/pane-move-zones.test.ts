import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { DROP_EDGES, SPLIT_LAYOUTS, evenSizes, moveBeside, paneRects, sameArrangement, type DropEdge, type SplitLayoutId } from '../src/runtime/splitLayout';
import { paneMoveZoneAt, paneZoneAction, paneZoneKey, paneZoneRect, type PaneBox } from '../src/ui/paneDropZones';
import { cancelPaneDrag, currentPaneDrag, endPaneDrag, movePaneDrag, paneDragPicker, panePreviewRects, startPaneDrag, type PaneRect } from '../src/ui/paneDrag';

const require = createRequire(import.meta.url);
const { validateAction } = require('../desktop/validation.cjs') as { validateAction: (action: unknown, snapshot?: unknown) => unknown };
const PAGE = { width: 1480, height: 830 };
const boxesOf = (layout: SplitLayoutId, ids: string[]): PaneBox[] => paneRects({ layout, cols: evenSizes(SPLIT_LAYOUTS[layout].cols), rows: evenSizes(SPLIT_LAYOUTS[layout].rows) }, { x: 0, y: 0, ...PAGE }, 6).map((r, i) => ({ tabId: ids[i], ...r }));
/** A point on the named side of a pane's box (inside its outer eighth), or its middle. */
const spot = (box: PaneBox, where: DropEdge | 'centre') => ({ x: where === 'left' ? box.x + box.width * .06 : where === 'right' ? box.x + box.width * .94 : box.x + box.width / 2, y: where === 'top' ? box.y + box.height * .06 : where === 'bottom' ? box.y + box.height * .94 : where === 'centre' ? box.y + box.height / 2 : box.y + box.height * .2 });

test('moving a pane beside another: two panes become side by side or stacked, the moved pane on the named side', () => {
  const columns = { layout: 'columns' as const, tabIds: ['a', 'b'] };
  assert.deepEqual(moveBeside(columns, 'a', 'b', 'right'), { layout: 'columns', tabIds: ['b', 'a'] });
  assert.deepEqual(moveBeside(columns, 'a', 'b', 'left'), { layout: 'columns', tabIds: ['a', 'b'] });
  assert.deepEqual(moveBeside(columns, 'a', 'b', 'top'), { layout: 'rows', tabIds: ['a', 'b'] });
  assert.deepEqual(moveBeside(columns, 'a', 'b', 'bottom'), { layout: 'rows', tabIds: ['b', 'a'] });
  assert.deepEqual(moveBeside(columns, 'b', 'a', 'left'), { layout: 'columns', tabIds: ['b', 'a'] });
  assert.equal(moveBeside(columns, 'a', 'a', 'left'), null, 'a pane cannot open beside itself');
  assert.equal(moveBeside(columns, 'a', 'zzz', 'left'), null);
  assert.equal(moveBeside(columns, 'zzz', 'a', 'left'), null);
  assert.equal(moveBeside({ layout: 'rows', tabIds: ['a', 'b'] }, 'a', 'b', 'left')!.layout, 'columns');
  assert.ok(sameArrangement(columns, { layout: 'columns', tabIds: ['a', 'b'] }));
  assert.ok(!sameArrangement(columns, { layout: 'rows', tabIds: ['a', 'b'] }));
});

test('moving a pane beside another: with three panes the others close up like split.remove, then it opens as a dropped tab would', () => {
  // [A | B | C]: C onto the top of A: A over C is the left column, B the right one.
  assert.deepEqual(moveBeside({ layout: 'three-columns', tabIds: ['a', 'b', 'c'] }, 'c', 'a', 'top'), { layout: 'left-two-right-one', tabIds: ['c', 'a', 'b'] });
  assert.deepEqual(moveBeside({ layout: 'three-columns', tabIds: ['a', 'b', 'c'] }, 'c', 'a', 'bottom'), { layout: 'left-two-right-one', tabIds: ['a', 'c', 'b'] });
  assert.deepEqual(moveBeside({ layout: 'three-columns', tabIds: ['a', 'b', 'c'] }, 'a', 'c', 'right'), { layout: 'three-columns', tabIds: ['b', 'c', 'a'] });
  // One left, two right: the top right pane onto the left pane's bottom: left column holds A over B, C on the right.
  assert.deepEqual(moveBeside({ layout: 'left-one-right-two', tabIds: ['a', 'b', 'c'] }, 'c', 'a', 'bottom'), { layout: 'left-two-right-one', tabIds: ['a', 'c', 'b'] });
  // Every edge of a four-pane grid has a real result now: A under D closes A's cell from below (C grows into it) and cuts D in half.
  assert.deepEqual(moveBeside({ layout: 'grid', tabIds: ['a', 'b', 'c', 'd'] }, 'a', 'd', 'bottom'), { layout: 'left-one-right-three', tabIds: ['c', 'b', 'd', 'a'] });
  // A pane already on that side of the target: nothing to do (not a jump to four columns, nor a reshuffle of the others).
  assert.ok(sameArrangement({ layout: 'grid', tabIds: ['a', 'b', 'c', 'd'] }, moveBeside({ layout: 'grid', tabIds: ['a', 'b', 'c', 'd'] }, 'a', 'b', 'left')!));
  // Four panes keep their shape around a move: D onto the right of B in a grid: C closes over D's cell (the whole bottom row), B is cut in half, D on its right.
  assert.deepEqual(moveBeside({ layout: 'grid', tabIds: ['a', 'b', 'c', 'd'] }, 'd', 'b', 'right'), { layout: 'top-three-bottom-one', tabIds: ['a', 'b', 'd', 'c'] });
  // Every result is a real layout with the same panes.
  for (const layout of ['columns', 'three-columns', 'left-one-right-two', 'top-two-bottom-one', 'grid', 'four-rows'] as SplitLayoutId[]) {
    const ids = ['a', 'b', 'c', 'd'].slice(0, SPLIT_LAYOUTS[layout].panes);
    for (const from of ids) for (const to of ids) for (const edge of DROP_EDGES) {
      const result = moveBeside({ layout, tabIds: ids }, from, to, edge);
      if (!result) continue;
      assert.equal(SPLIT_LAYOUTS[result.layout].panes, ids.length, `${layout} ${from}>${to} ${edge}`);
      assert.deepEqual([...result.tabIds].sort(), [...ids].sort(), `${layout} ${from}>${to} ${edge} keeps the same panes`);
    }
  }
});

test('the same zones as a tab drag: the middle of another pane swaps, an edge moves the pane beside it, its own box and a no-change edge are nothing', () => {
  const ids = ['a', 'b', 'c'], boxes = boxesOf('three-columns', ids), s = { layout: 'three-columns' as const, tabIds: ids };
  assert.deepEqual(paneMoveZoneAt(boxes, s, 'c', spot(boxes[0], 'centre'), PAGE), { kind: 'replace', pane: 'a' });
  const top = paneMoveZoneAt(boxes, s, 'c', spot(boxes[0], 'top'), PAGE);
  assert.deepEqual(top, { kind: 'move', pane: 'a', edge: 'top', layout: 'left-two-right-one', order: ['c', 'a', 'b'] });
  assert.equal(paneMoveZoneAt(boxes, s, 'c', spot(boxes[2], 'centre'), PAGE), null, 'its own box');
  assert.equal(paneMoveZoneAt(boxes, s, 'c', spot(boxes[1], 'right'), PAGE), null, 'beside B on the right is where C already is');
  assert.equal(paneMoveZoneAt(boxes, s, 'c', { x: -5, y: 10 }, PAGE), null, 'off every pane');
  assert.equal(paneMoveZoneAt(boxes, s, 'zzz', spot(boxes[0], 'top'), PAGE), null, 'a tab that is not in the split');
  // An edge never stands in for the middle: the bottom of D in a grid is a move.
  const gridIds = ['a', 'b', 'c', 'd'], grid = boxesOf('grid', gridIds);
  assert.equal(paneMoveZoneAt(grid, { layout: 'grid', tabIds: gridIds }, 'a', spot(grid[3], 'bottom'), PAGE)?.kind, 'move');
  // A layout too big for the page lights nothing (it used to swap silently).
  const small = { width: 600, height: 500 };
  assert.equal(paneMoveZoneAt(boxes.map(b => ({ ...b, width: b.width / 2.2, x: b.x / 2.2 })), s, 'c', { x: boxes[0].x / 2.2 + 50, y: 10 }, small), null, 'a three-pane result needs more width than 600px');
});

test('a move zone: its box is the dragged pane\'s new cell, the key tells it from a tab drop on the same edge, and a release arranges the split', () => {
  const ids = ['a', 'b', 'c'], boxes = boxesOf('three-columns', ids), s = { layout: 'three-columns' as const, tabIds: ids };
  const zone = paneMoveZoneAt(boxes, s, 'c', spot(boxes[0], 'top'), PAGE)!;
  assert.equal(zone.kind, 'move');
  const rect = paneZoneRect(zone, boxes, 'c', PAGE)!, cells = paneRects({ layout: 'left-two-right-one', cols: evenSizes(2), rows: evenSizes(2) }, { x: 0, y: 0, ...PAGE }, 6);
  assert.deepEqual(rect, cells[0], 'C takes the top-left cell');
  assert.notEqual(paneZoneKey(zone), paneZoneKey({ kind: 'insert', pane: 'a', edge: 'top', layout: 'left-two-right-one', order: ['c', 'a', 'b'] }));
  assert.deepEqual(paneZoneAction(zone, 'c'), { type: 'split.arrange', layout: 'left-two-right-one', order: ['c', 'a', 'b'] });
});

test('the pane drag store: an edge release arranges the split, the middle swaps, and Esc / outside / the pane\'s own box do nothing', () => {
  const ids = ['a', 'b', 'c'], boxes = boxesOf('three-columns', ids), rects: PaneRect[] = boxes;
  const split = { layout: 'three-columns' as const, tabIds: ids };
  // Edge: C dragged to the top of A.
  startPaneDrag('c', rects, { x: 1300, y: 10 }, PAGE, split);
  movePaneDrag(spot(boxes[0], 'top'));
  let drag = currentPaneDrag()!;
  assert.equal(drag.move?.kind, 'move');
  assert.equal(drag.over, null, 'not a swap target while an edge is lit');
  // R5: no lit box with a label — the frames show the result: the dragged pane's frame sits where the old landing box was.
  assert.equal(paneDragPicker(drag)?.pane, null, 'no in-place zone box for a pane drag');
  const landing = panePreviewRects(drag).find(rect => rect.tabId === 'c')!, box = paneZoneRect(drag.move!, rects, 'c', PAGE)!;
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(landing[key] - box[key]) <= 1, `landing ${key} ${landing[key]} vs ${box[key]}`);
  assert.deepEqual(endPaneDrag(0), { type: 'split.arrange', layout: 'left-two-right-one', order: ['c', 'a', 'b'] });
  assert.equal(currentPaneDrag(), null);
  // Middle: swap.
  startPaneDrag('c', rects, { x: 1300, y: 10 }, PAGE, split);
  movePaneDrag(spot(boxes[0], 'centre'));
  drag = currentPaneDrag()!;
  assert.equal(drag.over, 'a'); assert.equal(drag.move, null);
  assert.deepEqual(endPaneDrag(0), { type: 'split.swap', a: 'c', b: 'a' });
  // The pane's own box, and a no-change edge: nothing.
  startPaneDrag('c', rects, { x: 1300, y: 10 }, PAGE, split);
  movePaneDrag(spot(boxes[2], 'left')); assert.equal(currentPaneDrag()!.over, null); assert.equal(currentPaneDrag()!.move, null);
  movePaneDrag(spot(boxes[1], 'right')); assert.equal(currentPaneDrag()!.move, null, 'right of B is where C already sits');
  assert.equal(endPaneDrag(0), null);
  // Esc (the ribbon calls cancelPaneDrag): nothing is dispatched.
  startPaneDrag('c', rects, { x: 1300, y: 10 }, PAGE, split);
  movePaneDrag(spot(boxes[0], 'top')); assert.equal(currentPaneDrag()!.move?.kind, 'move');
  cancelPaneDrag(); assert.equal(currentPaneDrag(), null); assert.equal(endPaneDrag(0), null);
  // Without the split (older callers) a pane is still just a swap target.
  startPaneDrag('c', rects, { x: 1300, y: 10 });
  movePaneDrag(spot(boxes[0], 'top')); assert.equal(currentPaneDrag()!.over, 'a'); assert.equal(currentPaneDrag()!.move, null);
  cancelPaneDrag();
});

test('the layout card still takes priority: a cell of the picker beats a pane edge under it', () => {
  const ids = ['a', 'b'], boxes = boxesOf('columns', ids);
  startPaneDrag('a', boxes, { x: 100, y: 100 }, PAGE, { layout: 'columns', tabIds: ids });
  movePaneDrag({ x: PAGE.width / 2, y: PAGE.height / 2 });
  const drag = currentPaneDrag()!;
  assert.equal(drag.move, null, 'on the card no pane is a drop target');
  assert.equal(drag.over, null);
  cancelPaneDrag();
});

test('split.arrange from a move zone is valid for main and reshapes the split in the reducer', () => {
  let s = createInitialState(); const first = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://two.test/' }); const second = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://three.test/' }); const third = s.activeTabId;
  s = reduceBrowser(s, { type: 'split.open', tabIds: [first, second, third], layout: 'three-columns' });
  const result = moveBeside(s.windowUi.split!, third, first, 'top')!;
  const action = paneZoneAction({ kind: 'move', pane: first, edge: 'top', layout: result.layout, order: result.tabIds }, third);
  assert.doesNotThrow(() => validateAction(action, s));
  const next = reduceBrowser(s, action);
  assert.equal(next.windowUi.split!.layout, 'left-two-right-one');
  assert.deepEqual(next.windowUi.split!.tabIds, [third, first, second]);
  assert.deepEqual(next.windowUi.splitGroups![0].tabIds, [third, first, second], 'the saved split follows');
});

test('wiring: the ribbon passes the open split, Esc cancels, and the pane drag draws the shared in-place zone', () => {
  const ribbon = fs.readFileSync(path.resolve('src/components/SplitRibbon.tsx'), 'utf8'), app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8'), zone = fs.readFileSync(path.resolve('src/components/SplitPaneZone.tsx'), 'utf8');
  assert.match(ribbon, /startPaneDrag\(.*splitDropLayout\(\)\)/);
  assert.match(ribbon, /event\.key === 'Escape' && press\.current\?\.started/);
  assert.match(app, /picker=\{paneDragPicker\(paneDrag\)\}.*veil=\{false\}.*<SplitPaneZone pane=\{paneDragPicker\(paneDrag\)\?\.pane/);
  for (const edge of ['Left', 'Right', 'Top', 'Bottom']) assert.match(zone, new RegExp(`splitzone\\.move${edge}`));
  for (const locale of ['en', 'de', 'ja', 'ar']) { const catalog = JSON.parse(fs.readFileSync(path.resolve(`src/i18n/${locale}.json`), 'utf8')); for (const edge of ['Left', 'Right', 'Top', 'Bottom']) assert.ok(catalog[`splitzone.move${edge}`], `${locale} splitzone.move${edge}`); }
});
