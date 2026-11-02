import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { MAX_PANES, SPLIT_LAYOUTS, arrangeOrder, arrangeSplit, layoutsFor, normalizeSplit, type SplitLayoutId } from '../src/runtime/splitLayout';
import { PANE_CARD_LIFT, PANE_DRAG_THRESHOLD, PANE_DROP_MS, arrangeLayouts, cancelPaneDrag, currentPaneDrag, endPaneDrag, movePaneDrag, paneDragPicker, pastDragThreshold, startPaneDrag, type PaneDragState, type PaneRect } from '../src/ui/paneDrag';
import { onPickerCard, pickerGeometry, pickerZoneAt, splitTabsFor } from '../src/ui/splitDrop';
import { shouldMorph } from '../src/ui/splitMorph';

const require = createRequire(import.meta.url);
const { validateAction } = require('../desktop/validation.cjs') as { validateAction: (action: unknown, snapshot?: unknown) => unknown };

/** The drag on screen right now (the store is module-level); a null drag reads as an empty object for the assertions that follow a release. */
const snapshot = () => currentPaneDrag() as PaneDragState;
const ids = ['a', 'b', 'c', 'd'];
const PAGE = { width: 1280, height: 720 };
/** Panes laid out left to right, the way the ribbon reports them (page-area coordinates). */
const rectsFor = (list: string[]): PaneRect[] => list.map((tabId, index) => ({ tabId, x: index * 320, y: 0, width: 314, height: 700 }));

test('R4-29: every layout x slot gives the order with the dragged pane in that slot and the others in their old order around it', () => {
  for (const count of [2, 3, 4]) {
    const list = ids.slice(0, count), layouts = layoutsFor(count);
    assert.ok(layouts.length >= 1, `${count} panes have a layout`);
    for (const layout of layouts) for (const dragged of list) for (let slot = 0; slot < count; slot++) {
      const order = arrangeOrder(list, dragged, slot)!;
      assert.equal(order.length, count, `${layout}: ${dragged} to slot ${slot} keeps every pane`);
      assert.equal(order[slot], dragged, `${layout}: ${dragged} lands in slot ${slot}`);
      assert.deepEqual(order.filter(id => id !== dragged), list.filter(id => id !== dragged), `${layout}: the others keep their order`);
      assert.deepEqual(order, splitTabsFor(list, dragged, slot), 'the same rule as the Snap picker drop, so its preview is what you get');
    }
  }
});

test('R4-29: every layout name is a catalog string (the picker and menus translate it by its English text)', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const english = Object.values(JSON.parse(fs.readFileSync(path.resolve('src/i18n/en.json'), 'utf8')) as Record<string, string>);
  const labels = Object.values(SPLIT_LAYOUTS).map(spec => spec.label);
  assert.equal(new Set(labels).size, labels.length, 'one name per layout');
  // The extra four-pane shapes a moved pane can land in are never named on screen (the picker, the menus and the shortcuts list layoutsFor only).
  for (const spec of Object.values(SPLIT_LAYOUTS)) if (!spec.extra) assert.ok(english.includes(spec.label), `"${spec.label}" is in en.json`);
  for (const count of [2, 3, 4]) assert.ok(layoutsFor(count).every(id => !SPLIT_LAYOUTS[id].extra), `no extra shape is offered for ${count} panes`);
});

test('R4-29: arrangeOrder refuses a pane that is not in the split and a slot that is not a cell', () => {
  assert.equal(arrangeOrder(['a', 'b', 'c'], 'x', 0), null);
  assert.equal(arrangeOrder(['a', 'b', 'c'], 'a', 3), null);
  assert.equal(arrangeOrder(['a', 'b', 'c'], 'a', -1), null);
  assert.equal(arrangeOrder(['a', 'b', 'c'], 'a', 1.5), null);
  assert.deepEqual(arrangeOrder(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(arrangeOrder(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(arrangeOrder(['a', 'b', 'c'], 'b', 1), ['a', 'b', 'c']);
});

test('R4-29: the picker offers every layout for the pane count (2: side by side or stacked; 3: six; 4: six)', () => {
  assert.deepEqual(layoutsFor(2), ['columns', 'rows']);
  assert.equal(layoutsFor(3).length, 6); assert.equal(layoutsFor(4).length, 6);
  // Every layout is a cell per pane, so a slot exists for each of them.
  for (const [layout, spec] of Object.entries(SPLIT_LAYOUTS)) assert.equal(pickerGeometry(1280, 720, [layout as SplitLayoutId]).thumbs[0].cells.length, spec.panes);
  // A narrow or short page drops the layouts whose smallest size cannot fit, never all of them.
  assert.deepEqual(arrangeLayouts(3, 1400), layoutsFor(3));
  assert.deepEqual(arrangeLayouts(3, 700), layoutsFor(3).filter(id => id !== 'three-columns'), 'three columns need 972px');
  assert.deepEqual(arrangeLayouts(3, 200), layoutsFor(3), 'when none fit the full list stays rather than an empty card');
  assert.deepEqual(arrangeLayouts(4, 1000, 900), layoutsFor(4).filter(id => id !== 'four-columns'), 'four columns need 1298px');
  assert.ok(!arrangeLayouts(4, 1400, 600).includes('four-rows'), 'four rows need 658px of height');
  assert.ok(arrangeLayouts(4, 1400, 700).includes('four-rows'));
});

test('R4-29: arrangeSplit changes the layout with even sizes and the order, or keeps the sizes when only the order changes', () => {
  const open = ['a', 'b', 'c'], split = normalizeSplit({ tabIds: open, layout: 'three-columns', cols: [.5, .3, .2] }, open, 'a')!;
  const moved = arrangeSplit(split, 'left-one-right-two', ['c', 'a', 'b'])!;
  assert.equal(moved.layout, 'left-one-right-two');
  assert.deepEqual(moved.tabIds, ['c', 'a', 'b']);
  assert.deepEqual(moved.cols, [.5, .5], 'a new layout starts even');
  assert.equal(moved.colRows, undefined);
  const reordered = arrangeSplit(split, 'three-columns', ['b', 'c', 'a'])!;
  assert.deepEqual(reordered.cols, [.5, .3, .2], 'the same layout keeps its sizes with its cells');
  assert.equal(arrangeSplit(split, 'three-columns', open), null, 'nothing changes');
  assert.equal(arrangeSplit(split, 'columns', ['a', 'b']), null, 'a layout for another pane count');
  assert.equal(arrangeSplit(split, 'nonsense', open), null);
  assert.equal(arrangeSplit(split, 'grid', open), null);
  assert.equal(arrangeSplit(split, 'left-one-right-two', ['a', 'b', 'x']), null, 'panes that are not the split\'s');
  assert.equal(arrangeSplit(split, 'left-one-right-two', ['a', 'a', 'b']), null, 'a pane twice');
  assert.equal(arrangeSplit(split, 'left-one-right-two', ['a', 'b']), null, 'a pane missing');
  assert.equal(arrangeSplit(split, 'left-one-right-two', 'abc'), null);
});

function threePanes() {
  let s = createInitialState(); const first = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://two.test/' }); const second = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://three.test/' }); const third = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.new', url: 'https://four.test/' }); const fourth = s.activeTabId;
  s = reduceBrowser(s, { type: 'tab.select', id: first }); // a split needs the current tab among its panes
  return { s, first, second, third, fourth };
}

test('R4-29: split.arrange in the reducer sets the layout and order and the saved split follows; bad requests change nothing', () => {
  const { s: base, first, second, third } = threePanes();
  let s = reduceBrowser(base, { type: 'split.open', tabIds: [first, second, third], layout: 'three-columns' });
  const before = s;
  s = reduceBrowser(s, { type: 'split.arrange', layout: 'top-two-bottom-one', order: [third, first, second] });
  assert.equal(s.windowUi.split!.layout, 'top-two-bottom-one');
  assert.deepEqual(s.windowUi.split!.tabIds, [third, first, second]);
  assert.deepEqual(s.windowUi.splitGroups![0].tabIds, [third, first, second], 'the saved split follows');
  assert.equal(s.windowUi.splitGroups![0].layout, 'top-two-bottom-one');
  assert.equal(s.activeTabId, before.activeTabId, 'the active tab stays');
  assert.equal(reduceBrowser(s, { type: 'split.arrange', layout: 'top-two-bottom-one', order: [third, first, second] }), s, 'the same arrangement is no change');
  assert.equal(reduceBrowser(s, { type: 'split.arrange', layout: 'columns', order: [third, first, second] }), s, 'a layout for another pane count');
  assert.equal(reduceBrowser(s, { type: 'split.arrange', layout: 'left-one-right-two', order: [third, first, 'ghost'] }), s, 'a pane that is not in the split');
  assert.equal(reduceBrowser(base, { type: 'split.arrange', layout: 'columns', order: [first, second] }), base, 'no split open');
});

test('R4-29: split.arrange works on four panes too (the grid takes any slot)', () => {
  const { s: base, first, second, third, fourth } = threePanes();
  let s = reduceBrowser(base, { type: 'split.open', tabIds: [first, second, third, fourth] });
  assert.equal(s.windowUi.split!.layout, 'grid');
  s = reduceBrowser(s, { type: 'split.arrange', layout: 'grid', order: arrangeOrder([first, second, third, fourth], first, 3)! });
  assert.deepEqual(s.windowUi.split!.tabIds, [second, third, fourth, first]);
});

test('R4-29: the main process accepts split.arrange only with a known layout and two to four distinct open tabs', () => {
  const { s, first: a, second: b, third: c, fourth: d } = threePanes();
  const ok = (order: string[], layout = 'columns') => { try { validateAction({ type: 'split.arrange', layout, order }, s); return true; } catch { return false; } };
  assert.equal(ok([a, b]), true);
  assert.equal(ok([c, a, b], 'left-one-right-two'), true);
  assert.equal(ok([d, c, b, a], 'grid'), true);
  assert.equal(ok([a, a]), false, 'a pane twice');
  assert.equal(ok([a]), false, 'one pane is not a split');
  assert.equal(ok([a, 'zzz']), false, 'an unknown tab');
  assert.equal(ok([a, b], 'diagonal'), false, 'an unknown layout');
  assert.equal(ok([a, b, c, d, a]), false, 'more than four');
  assert.throws(() => validateAction({ type: 'split.arrange', layout: 'columns', order: [a, b], extra: 1 }, s));
  assert.throws(() => validateAction({ type: 'split.arrange', order: [a, b] }, s));
  assert.equal(MAX_PANES, 4);
});

test('R4-29: the drag threshold: a press turns into a drag past 5px in any direction, not before', () => {
  assert.equal(PANE_DRAG_THRESHOLD, 5);
  assert.equal(pastDragThreshold(0, 0), false);
  assert.equal(pastDragThreshold(3, 3), false, 'about 4.2px');
  assert.equal(pastDragThreshold(4, 3), true, 'exactly 5px');
  assert.equal(pastDragThreshold(-6, 0), true);
  assert.equal(pastDragThreshold(0, 5), true);
  assert.equal(pastDragThreshold(0, 4.9), false);
});

test('R4-29: a pane drag lists every layout; the card comes down (docked at the top) once the pointer goes past the top of the page; a cell is the slot, the card is not a pane', () => {
  const rects = rectsFor(['a', 'b', 'c']);
  startPaneDrag('b', rects, { x: 500, y: 10 }, PAGE);
  const picker = paneDragPicker(snapshot())!;
  assert.deepEqual(picker.layouts, layoutsFor(3), 'all three-pane layouts');
  assert.equal(picker.tabId, 'b');
  assert.deepEqual(picker.current, ['a', 'b', 'c']);
  assert.equal(picker.zone, null, 'no cell yet');
  assert.equal(picker.card, false, 'the card waits above the page: the panes are drop zones edge to edge');
  const geo = pickerGeometry(PAGE.width, PAGE.height, picker.layouts, PANE_CARD_LIFT);
  assert.equal(geo.card.y, 12, 'docked at the top of the page');
  const cell = geo.thumbs[1].cells[2], at = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
  movePaneDrag(at);
  assert.equal(snapshot().zone, null, 'the card is away: its cells are not targets');
  movePaneDrag({ x: at.x, y: -8 });
  assert.equal(paneDragPicker(snapshot())!.card, true, 'past the top of the page: the card is out');
  assert.equal(snapshot().onCard, true, 'above the page is the card\'s, not a pane\'s');
  assert.deepEqual(pickerZoneAt(at.x, at.y, PAGE.width, PAGE.height, picker.layouts, PANE_CARD_LIFT), { layout: geo.thumbs[1].layout, index: 2 });
  movePaneDrag(at);
  assert.deepEqual(paneDragPicker(snapshot())!.zone, { layout: geo.thumbs[1].layout, index: 2 });
  assert.equal(snapshot().over, null, 'the card covers the panes under it');
  // The card's margin is on the card but no cell.
  const margin = { x: geo.card.x + 3, y: geo.card.y + 3 };
  assert.equal(onPickerCard(margin.x, margin.y, PAGE.width, PAGE.height, picker.layouts, PANE_CARD_LIFT), true);
  movePaneDrag(margin);
  assert.equal(snapshot().zone, null); assert.equal(snapshot().onCard, true); assert.equal(snapshot().over, null);
  assert.equal(endPaneDrag(0), null, 'released on the card but not a cell: nothing');
});

test('R4-29: releasing on a cell rearranges (that layout, the dragged pane in that slot); elsewhere keeps today\'s swap or nothing; Esc cancels', async () => {
  const rects = rectsFor(['a', 'b', 'c']), layouts = layoutsFor(3), geo = pickerGeometry(PAGE.width, PAGE.height, layouts, PANE_CARD_LIFT), summon = () => movePaneDrag({ x: PAGE.width / 2, y: -8 });
  for (const thumb of geo.thumbs) for (const cell of thumb.cells) {
    startPaneDrag('a', rects, { x: 20, y: 10 }, PAGE); summon();
    movePaneDrag({ x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 });
    assert.deepEqual(endPaneDrag(0), { type: 'split.arrange', layout: thumb.layout, order: arrangeOrder(['a', 'b', 'c'], 'a', cell.index) }, `${thumb.layout} slot ${cell.index}`);
    assert.equal(snapshot(), null, 'the zones clear at once; the pages morph');
  }
  // R5: with a settle time the frames hold the result (phase 'drop') while the pages are laid out under them, then clear.
  startPaneDrag('a', rects, { x: 20, y: 10 }, PAGE); summon();
  const first = geo.thumbs[0].cells[0]; movePaneDrag({ x: first.x + 4, y: first.y + 4 });
  assert.equal(endPaneDrag()?.type, 'split.arrange'); assert.equal(snapshot()?.phase, 'drop');
  await new Promise(resolve => setTimeout(resolve, PANE_DROP_MS + 60)); assert.equal(snapshot(), null);
  // Outside the picker the old behaviour: over another pane swaps, off every pane does nothing.
  startPaneDrag('a', rects, { x: 20, y: 10 }, PAGE); movePaneDrag({ x: 700, y: 500 });
  assert.equal(snapshot().over, 'c'); assert.equal(snapshot().zone, null);
  assert.deepEqual(endPaneDrag(0), { type: 'split.swap', a: 'a', b: 'c' });
  startPaneDrag('a', rects, { x: 20, y: 10 }, PAGE); movePaneDrag({ x: 700, y: 900 });
  assert.equal(endPaneDrag(0), null);
  startPaneDrag('a', rects, { x: 20, y: 10 }, PAGE); summon(); movePaneDrag({ x: first.x + 4, y: first.y + 4 });
  cancelPaneDrag();
  assert.equal(endPaneDrag(0), null, 'Escape cancels');
  assert.equal(snapshot(), null);
});

test('R4-29: without the page size (older callers) a pane drag has no picker and swaps as before', () => {
  startPaneDrag('a', rectsFor(['a', 'b']), { x: 20, y: 10 });
  assert.equal(paneDragPicker(snapshot()), null);
  movePaneDrag({ x: 400, y: 100 });
  assert.deepEqual(endPaneDrag(0), { type: 'split.swap', a: 'a', b: 'b' });
});

test('R4-29: a rearrangement that keeps the same panes in the same order still morphs when the layout changed, a resize does not', () => {
  assert.equal(shouldMorph(['a', 'b', 'c'], ['a', 'b', 'c']), false, 'a resize is the handles\' own');
  assert.equal(shouldMorph(['a', 'b', 'c'], ['a', 'b', 'c'], true), true, 'a new layout glides');
  assert.equal(shouldMorph(['a'], ['a'], true), false, 'no split');
  assert.equal(shouldMorph(['a', 'b'], ['b', 'a']), true);
});

test('R4-29: the ribbon starts the drag past the threshold with the page size, and the picker draws over the pane zones', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const ribbon = fs.readFileSync(path.resolve('src/components/SplitRibbon.tsx'), 'utf8'), app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8'), picker = fs.readFileSync(path.resolve('src/components/SplitPicker.tsx'), 'utf8');
  assert.match(ribbon, /pastDragThreshold\(/);
  assert.match(ribbon, /startPaneDrag\(tab\.id, rects, relative\(event, box\), \{ width: box\.width, height: box\.height \}, splitDropLayout\(\)\)/);
  assert.match(app, /<SplitPicker picker=\{paneDragPicker\(paneDrag\)\} panes=\{\[\]\} veil=\{false\}/, 'the picker is the existing component, fed by the pane drag, over the drag layer');
  assert.ok(app.indexOf('<SplitPaneDragLayer') < app.indexOf('paneDragPicker(paneDrag)'), 'drawn after (above) the pane zones');
  assert.match(picker, /veil = true/);
  assert.match(app, /morphWanted\(lastPane\.current\.ids, lastPane\.current\.layout !== splitPair\?\.layout\)/);
});
