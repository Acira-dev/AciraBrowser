import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { DROP_EDGES, MAX_PANES, SPLIT_LAYOUTS, evenSizes, insertBeside, insertEdges, layoutsFor, paneRects, replaceAt, type DropEdge, type SplitLayoutId } from '../src/runtime/splitLayout';
import { PANE_CENTRE, paneZoneAction, paneZoneAt, paneZoneKey, paneZoneRect, type PaneBox } from '../src/ui/paneDropZones';
import { cardLift, onPickerCard, pickerGeometry, pickerZoneAt } from '../src/ui/splitDrop';
import { PANE_CARD_LIFT, arrangeLayouts, cancelPaneDrag, currentPaneDrag, paneDragPicker, startPaneDrag, type PaneRect } from '../src/ui/paneDrag';

const require = createRequire(import.meta.url);
const { validateAction } = require('../desktop/validation.cjs') as { validateAction: (action: unknown, snapshot?: unknown) => unknown };
const split = (layout: SplitLayoutId, ids: string[]) => ({ layout, tabIds: ids });
const PAGE = { width: 1480, height: 830 };
const boxesOf = (layout: SplitLayoutId, ids: string[]): PaneBox[] => paneRects({ layout, cols: evenSizes(SPLIT_LAYOUTS[layout].cols), rows: evenSizes(SPLIT_LAYOUTS[layout].rows) }, { x: 0, y: 0, ...PAGE }, 6).map((r, i) => ({ tabId: ids[i], ...r }));

test('R4-40: a tab dropped on an edge of a pane of two opens beside it in the layout that has that shape', () => {
  const columns = split('columns', ['a', 'b']), rows = split('rows', ['a', 'b']);
  const at = (s: typeof columns, pane: number, edge: DropEdge) => insertBeside(s, pane, edge, 'n');
  assert.deepEqual(at(columns, 1, 'right'), { layout: 'three-columns', tabIds: ['a', 'b', 'n'] });
  assert.deepEqual(at(columns, 0, 'left'), { layout: 'three-columns', tabIds: ['n', 'a', 'b'] });
  assert.deepEqual(at(columns, 0, 'right'), { layout: 'three-columns', tabIds: ['a', 'n', 'b'] });
  assert.deepEqual(at(columns, 1, 'left'), { layout: 'three-columns', tabIds: ['a', 'n', 'b'] });
  assert.deepEqual(at(columns, 0, 'top'), { layout: 'left-two-right-one', tabIds: ['n', 'a', 'b'] });
  assert.deepEqual(at(columns, 0, 'bottom'), { layout: 'left-two-right-one', tabIds: ['a', 'n', 'b'] });
  assert.deepEqual(at(columns, 1, 'top'), { layout: 'left-one-right-two', tabIds: ['a', 'n', 'b'] });
  assert.deepEqual(at(columns, 1, 'bottom'), { layout: 'left-one-right-two', tabIds: ['a', 'b', 'n'] });
  assert.deepEqual(at(rows, 1, 'bottom'), { layout: 'three-rows', tabIds: ['a', 'b', 'n'] });
  assert.deepEqual(at(rows, 0, 'top'), { layout: 'three-rows', tabIds: ['n', 'a', 'b'] });
  assert.deepEqual(at(rows, 0, 'left'), { layout: 'top-two-bottom-one', tabIds: ['n', 'a', 'b'] });
  assert.deepEqual(at(rows, 0, 'right'), { layout: 'top-two-bottom-one', tabIds: ['a', 'n', 'b'] });
  assert.deepEqual(at(rows, 1, 'left'), { layout: 'top-one-bottom-two', tabIds: ['a', 'n', 'b'] });
  assert.deepEqual(at(rows, 1, 'right'), { layout: 'top-one-bottom-two', tabIds: ['a', 'b', 'n'] });
  for (const s of [columns, rows]) for (let pane = 0; pane < 2; pane++) assert.deepEqual(insertEdges(s, pane), [...DROP_EDGES], 'two panes can take a third on every edge');
});

test('R4-40: from three panes the simple edges give the four-pane layouts; edges with no listed layout are not offered; four panes are full', () => {
  assert.deepEqual(insertBeside(split('three-columns', ['a', 'b', 'c']), 2, 'right', 'n'), { layout: 'four-columns', tabIds: ['a', 'b', 'c', 'n'] });
  assert.deepEqual(insertBeside(split('three-rows', ['a', 'b', 'c']), 0, 'top', 'n'), { layout: 'four-rows', tabIds: ['n', 'a', 'b', 'c'] });
  assert.deepEqual(insertBeside(split('left-one-right-two', ['a', 'b', 'c']), 1, 'bottom', 'n'), { layout: 'left-one-right-three', tabIds: ['a', 'b', 'n', 'c'] });
  assert.deepEqual(insertBeside(split('left-two-right-one', ['a', 'b', 'c']), 1, 'bottom', 'n'), { layout: 'left-three-right-one', tabIds: ['a', 'b', 'n', 'c'] });
  assert.deepEqual(insertBeside(split('top-one-bottom-two', ['a', 'b', 'c']), 2, 'right', 'n'), { layout: 'top-one-bottom-three', tabIds: ['a', 'b', 'c', 'n'] });
  // Every way four panes tile the page has a layout now (the extra shapes the picker does not list), so a cut across the middle of three columns lands too.
  assert.deepEqual(insertBeside(split('three-columns', ['a', 'b', 'c']), 1, 'top', 'n'), { layout: 'three-columns-split-middle', tabIds: ['a', 'n', 'c', 'b'] });
  assert.deepEqual(insertBeside(split('top-two-bottom-one', ['a', 'b', 'c']), 2, 'top', 'n'), { layout: 'three-rows-split-top', tabIds: ['a', 'b', 'n', 'c'] }, 'a new full row between the two');
  assert.deepEqual(insertBeside(split('left-one-right-two', ['a', 'b', 'c']), 0, 'right', 'n'), { layout: 'three-columns-split-right', tabIds: ['a', 'n', 'b', 'c'] }, 'a new full-height column beside the tall pane');
  assert.equal(insertBeside(split('grid', ['a', 'b', 'c', 'd']), 0, 'right', 'n'), null, 'four panes are full');
  assert.equal(insertBeside(split('columns', ['a', 'b']), 0, 'right', 'a'), null, 'a tab already in the split');
  assert.equal(insertBeside(split('columns', ['a', 'b']), 5, 'right', 'n'), null);
  assert.equal(insertBeside(split('columns', ['a', 'b']), 0, 'sideways' as DropEdge, 'n'), null);
  assert.equal(insertBeside(split('three-columns', ['a', 'b']), 0, 'right', 'n'), null, 'a layout for another pane count');
});

test('R4-40: every cut that gives a layout puts the new pane on that edge of the pane, keeps the others, and is a permutation', () => {
  for (const count of [2, 3]) for (const layout of layoutsFor(count)) {
    const ids = ['a', 'b', 'c'].slice(0, count);
    for (let pane = 0; pane < count; pane++) for (const edge of DROP_EDGES) {
      const result = insertBeside(split(layout, ids), pane, edge, 'n'); if (!result) continue;
      const label = `${layout} pane ${pane} ${edge}`;
      assert.equal(SPLIT_LAYOUTS[result.layout].panes, count + 1, label); assert.deepEqual([...result.tabIds].sort(), [...ids, 'n'].sort(), `${label}: a permutation`);
      const rects = paneRects({ layout: result.layout, cols: evenSizes(SPLIT_LAYOUTS[result.layout].cols), rows: evenSizes(SPLIT_LAYOUTS[result.layout].rows) }, { x: 0, y: 0, width: 1200, height: 800 }, 6);
      const fresh = rects[result.tabIds.indexOf('n')], old = rects[result.tabIds.indexOf(ids[pane])];
      const overlapX = Math.min(fresh.x + fresh.width, old.x + old.width) - Math.max(fresh.x, old.x), overlapY = Math.min(fresh.y + fresh.height, old.y + old.height) - Math.max(fresh.y, old.y);
      if (edge === 'left') assert.ok(fresh.x + fresh.width <= old.x + 1 && overlapY > 0, `${label}: the new pane is on its left`);
      if (edge === 'right') assert.ok(old.x + old.width <= fresh.x + 1 && overlapY > 0, `${label}: on its right`);
      if (edge === 'top') assert.ok(fresh.y + fresh.height <= old.y + 1 && overlapX > 0, `${label}: above it`);
      if (edge === 'bottom') assert.ok(old.y + old.height <= fresh.y + 1 && overlapX > 0, `${label}: below it`);
    }
  }
  assert.deepEqual(replaceAt(['a', 'b', 'c'], 1, 'n'), ['a', 'n', 'c']); assert.equal(replaceAt(['a', 'b'], 0, 'b'), null); assert.equal(replaceAt(['a', 'b'], 2, 'n'), null);
});

test('R4-40: split.replace keeps the replaced tab open and the layout; split.insert opens beside; both refuse what cannot work', () => {
  let s = createInitialState(); const ids = [s.activeTabId];
  for (let i = 0; i < 3; i++) { s = reduceBrowser(s, { type: 'tab.new' }); ids.push(s.activeTabId); }
  const [a, b, c, d] = ids; s = reduceBrowser(s, { type: 'tab.select', id: a }); s = reduceBrowser(s, { type: 'split.open', tabIds: [a, b] });
  const before = s;
  s = reduceBrowser(s, { type: 'split.replace', paneId: b, tabId: c });
  assert.deepEqual(s.windowUi.split?.tabIds, [a, c]); assert.equal(s.windowUi.split?.layout, 'columns'); assert.equal(s.tabs.length, 4, 'nothing is closed'); assert.ok(s.tabs.some(t => t.id === b), 'the replaced tab is an ordinary tab again');
  assert.deepEqual(s.windowUi.splitGroups![0].tabIds, [a, c], 'the saved split follows'); assert.equal(s.activeTabId, a, 'the current tab stays');
  s = reduceBrowser(s, { type: 'split.replace', paneId: a, tabId: b }); assert.deepEqual(s.windowUi.split?.tabIds, [b, c]); assert.equal(s.activeTabId, b, 'replacing the current tab makes the new one current');
  for (const bad of [{ type: 'split.replace', paneId: d, tabId: a }, { type: 'split.replace', paneId: b, tabId: c }, { type: 'split.replace', paneId: b, tabId: 'ghost' }] as const) assert.equal(reduceBrowser(s, bad), s, JSON.stringify(bad));
  assert.equal(reduceBrowser(before, { type: 'tab.close', id: d }).windowUi.split?.tabIds.length, 2);
  s = reduceBrowser(s, { type: 'split.insert', tabId: d, beside: c, edge: 'bottom' });
  assert.equal(s.windowUi.split?.layout, 'left-one-right-two'); assert.deepEqual(s.windowUi.split?.tabIds, [b, c, d]); assert.deepEqual(s.windowUi.split?.cols, [.5, .5], 'a new layout starts even');
  assert.deepEqual(s.windowUi.splitGroups![0].tabIds, [b, c, d]);
  for (const bad of [{ type: 'split.insert', tabId: b, beside: c, edge: 'left' }, { type: 'split.insert', tabId: d, beside: 'ghost', edge: 'left' }, { type: 'split.insert', tabId: d, beside: c, edge: 'top' }] as const) assert.equal(reduceBrowser(s, bad), s, `${JSON.stringify(bad)} changes nothing`);
  const plain = reduceBrowser(before, { type: 'tab.select', id: a }); assert.equal(reduceBrowser(createInitialState(), { type: 'split.insert', tabId: d, beside: c, edge: 'left' }).windowUi.split, null); void plain; void MAX_PANES;
});

test('R4-40: the boundary accepts the two actions with real tabs and an edge, and rejects the rest', () => {
  let s = createInitialState(); const first = s.activeTabId; s = reduceBrowser(s, { type: 'tab.new' }); const second = s.activeTabId;
  const ok = (action: unknown) => { try { validateAction(action, s); return true; } catch { return false; } };
  assert.equal(ok({ type: 'split.replace', paneId: first, tabId: second }), true);
  assert.equal(ok({ type: 'split.replace', paneId: first, tabId: first }), false); assert.equal(ok({ type: 'split.replace', paneId: first, tabId: 'ghost' }), false); assert.equal(ok({ type: 'split.replace', paneId: first }), false);
  for (const edge of DROP_EDGES) assert.equal(ok({ type: 'split.insert', tabId: second, beside: first, edge }), true, edge);
  assert.equal(ok({ type: 'split.insert', tabId: second, beside: first, edge: 'middle' }), false); assert.equal(ok({ type: 'split.insert', tabId: second, beside: second, edge: 'left' }), false);
  assert.equal(ok({ type: 'split.insert', tabId: second, beside: first }), false); assert.equal(ok({ type: 'split.insert', tabId: second, beside: first, edge: 'left', extra: 1 }), false);
});

test('R4-40: a pane is its middle half (replace) and four edge bands; the zone, its action and its highlight', () => {
  const ids = ['a', 'b'], panes = boxesOf('columns', ids), left = panes[0], page = { width: PAGE.width, height: PAGE.height };
  const at = (x: number, y: number, s = split('columns', ids)) => paneZoneAt(panes, s, 'n', { x, y }, page);
  const mid = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
  assert.deepEqual(at(mid.x, mid.y), { kind: 'replace', pane: 'a' });
  assert.equal(at(left.x + left.width * (PANE_CENTRE + .02), left.y + left.height / 2)?.kind, 'replace', 'just inside the middle');
  assert.deepEqual(at(left.x + 20, mid.y), { kind: 'insert', pane: 'a', edge: 'left', layout: 'three-columns', order: ['n', 'a', 'b'] });
  assert.equal((at(left.x + left.width - 20, mid.y) as { edge: DropEdge }).edge, 'right'); assert.equal((at(mid.x, left.y + 20) as { edge: DropEdge }).edge, 'top'); assert.equal((at(mid.x, left.y + left.height - 20) as { edge: DropEdge }).edge, 'bottom');
  assert.equal(at(left.x + left.width + 3, mid.y), null, 'the gap between panes is no pane'); assert.equal(at(-5, 10), null);
  assert.equal(paneZoneAt(panes, split('columns', ids), 'a', mid, page), null, 'a tab already in the split is not dropped on it');
  assert.deepEqual(paneZoneAction({ kind: 'replace', pane: 'a' }, 'n'), { type: 'split.replace', paneId: 'a', tabId: 'n' });
  assert.deepEqual(paneZoneAction(at(left.x + 20, mid.y)!, 'n'), { type: 'split.insert', tabId: 'n', beside: 'a', edge: 'left' });
  assert.notEqual(paneZoneKey({ kind: 'replace', pane: 'a' }), paneZoneKey({ kind: 'insert', pane: 'a', edge: 'left', layout: 'three-columns', order: [] })); assert.equal(paneZoneKey(null), '');
  // The highlight: the pane itself, or the new pane's cell in the result.
  assert.deepEqual(paneZoneRect({ kind: 'replace', pane: 'a' }, panes, 'n', page), { x: left.x, y: left.y, width: left.width, height: left.height });
  const cell = paneZoneRect(at(left.x + 20, mid.y)!, panes, 'n', page)!; assert.equal(cell.x, 0); assert.ok(Math.abs(cell.width - (PAGE.width - 12) / 3) < 1.5, 'one third of the page, the first of three columns');
  // Four panes: only replace, even on an edge. An edge with no listed layout is the pane's middle: replace.
  const four = boxesOf('grid', ['a', 'b', 'c', 'd']); assert.deepEqual(paneZoneAt(four, split('grid', ['a', 'b', 'c', 'd']), 'n', { x: four[0].x + 10, y: four[0].y + 200 }, page), { kind: 'replace', pane: 'a' });
  const three = boxesOf('three-columns', ['a', 'b', 'c']); assert.equal(paneZoneAt(three, split('three-columns', ['a', 'b', 'c']), 'n', { x: three[1].x + 200, y: three[1].y + 8 }, page)?.kind, 'insert', 'a cut across the middle column lands in the extra shape');
  assert.equal(paneZoneAt(three, split('three-columns', ['a', 'b', 'c']), 'n', { x: three[2].x + three[2].width - 8, y: three[2].y + 300 }, page)?.kind, 'insert');
  assert.equal(paneZoneAt(three, split('three-columns', ['a', 'b', 'c']), 'n', { x: three[2].x + three[2].width - 8, y: three[2].y + 300 }, { width: 1200, height: 830 })?.kind, 'replace', 'four columns need 1298px: a page that cannot hold the result offers only replace');
});

test('R4-41: the card is centred over the page area both ways; the pointer in its path moves it to the larger free side', () => {
  const layouts = layoutsFor(3), { card } = pickerGeometry(PAGE.width, PAGE.height, layouts);
  assert.equal(card.x, Math.round((PAGE.width - card.width) / 2)); assert.equal(card.y, Math.round((PAGE.height - card.height) / 2), 'vertically centred');
  const thumbs = pickerGeometry(PAGE.width, PAGE.height, layouts).thumbs; assert.ok(thumbs.every(t => t.x >= card.x && t.x + t.width <= card.x + card.width && t.y >= card.y && t.y + t.height <= card.y + card.height));
  assert.equal(cardLift(null, PAGE.width, PAGE.height, layouts), 0); assert.equal(cardLift({ x: 100, y: 100 }, PAGE.width, PAGE.height, layouts), 0, 'a pointer well away leaves it centred');
  const mid = { x: PAGE.width / 2, y: PAGE.height / 2 };
  const lifted = cardLift({ ...mid, y: mid.y - 30 }, PAGE.width, PAGE.height, layouts), movedAbove = pickerGeometry(PAGE.width, PAGE.height, layouts, lifted).card;
  assert.ok(lifted > 0 && movedAbove.y >= mid.y - 30 + 40, `a pointer a little above the middle: the card goes below it (${lifted})`);
  const low = cardLift({ ...mid, y: mid.y + 60 }, PAGE.width, PAGE.height, layouts), movedUp = pickerGeometry(PAGE.width, PAGE.height, layouts, low).card;
  assert.ok(low < 0 || movedUp.y + movedUp.height <= mid.y + 60 - 40 || movedUp.y >= mid.y + 60 + 40, `the card never stays under the pointer (${low})`);
  for (const point of [mid, { x: mid.x + 200, y: mid.y }, { x: mid.x - 120, y: mid.y + 40 }]) { const l = cardLift(point, PAGE.width, PAGE.height, layouts), c = pickerGeometry(PAGE.width, PAGE.height, layouts, l).card; assert.ok(point.y < c.y - 30 || point.y > c.y + c.height + 30, `the pointer is clear of the card at ${JSON.stringify(point)}`); }
  // The hit tests follow the lifted card.
  const shifted = pickerGeometry(PAGE.width, PAGE.height, layouts, 120), cell = shifted.thumbs[1].cells[0];
  assert.deepEqual(pickerZoneAt(cell.x + 2, cell.y + 2, PAGE.width, PAGE.height, layouts, 120), { layout: shifted.thumbs[1].layout, index: 0 }); assert.equal(pickerZoneAt(cell.x + 2, cell.y + 2, PAGE.width, PAGE.height, layouts), null, 'not where the unlifted card has it');
  assert.equal(onPickerCard(shifted.card.x + 3, shifted.card.y + 3, PAGE.width, PAGE.height, layouts, 120), true);
  // A short page keeps the card inside it.
  assert.ok(pickerGeometry(900, 200, layouts, 500).card.y + card.height <= 200);
});

test('R4-41: a pane drag never puts the card in the pointer\'s path: it waits docked at the top until the pointer goes past the top of the page', () => {
  const rects: PaneRect[] = [{ tabId: 'a', x: 0, y: 0, width: 490, height: 800 }, { tabId: 'b', x: 496, y: 0, width: 490, height: 800 }, { tabId: 'c', x: 992, y: 0, width: 490, height: 800 }];
  for (const start of [{ x: 60, y: 10 }, { x: PAGE.width / 2, y: PAGE.height / 2 }]) {
    startPaneDrag('a', rects, start, PAGE); const drag = currentPaneDrag()!;
    assert.equal(drag.lift, PANE_CARD_LIFT, 'docked at the top'); assert.equal(paneDragPicker(drag)?.card, false, 'away until summoned'); assert.equal(paneDragPicker(drag)?.lift, drag.lift); cancelPaneDrag();
  }
  assert.deepEqual(arrangeLayouts(3, PAGE.width, PAGE.height), layoutsFor(3));
});

test('R4-40/41: the zone is drawn inside the layout picker, between the preview and the card, and the context carries the layout', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const picker = fs.readFileSync(path.resolve('src/components/SplitPicker.tsx'), 'utf8'), app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8'), drop = fs.readFileSync(path.resolve('src/ui/splitDrop.ts'), 'utf8');
  assert.ok(picker.indexOf('<Preview') < picker.indexOf('{children}') && picker.indexOf('{children}') < picker.indexOf('<Card'), 'children sit between the preview and the card');
  assert.match(picker, /pickerGeometry\(picker\.width, picker\.height, picker\.layouts, picker\.lift\)/);
  assert.match(app, /<SplitPaneZone pane=\{splitPicker\?\.pane \?\? null\}/); assert.match(app, /layout: splitPair\?\.layout/);
  assert.match(drop, /querySelectorAll<HTMLElement>\('\.page-area \.split-pages \[data-pane\]'\)/);
});
