import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { SPLIT_LAYOUTS, blendSizes, composeSizes, equalizeSplit, evenSizes, handleKey, layoutsFor, minimumSize, movesWith, normalizeSplit, paneEdges, paneRects, resizeSplit, resolveLinear, rowFloor, rowSets, splitHandles, type SplitHandle, type SplitLayoutId } from '../src/runtime/splitLayout';

// R3-81: per-segment dividers. Usable page area: 1206 × 806 with a 6px gap, so 1200 across and 800 down.
const area = { x: 0, y: 72, width: 1206, height: 806 };
const grid = (colRows?: number[][], rows = [.5, .5], cols = [.5, .5]) => ({ layout: 'grid' as const, cols, rows, ...(colRows ? { colRows } : {}) });
const pick = (handles: SplitHandle[], kind: SplitHandle['kind'], column?: number) => handles.find(h => h.kind === kind && (column === undefined || h.column === column))!;
const heights = (split: ReturnType<typeof grid>) => paneRects(split, area, 6).map(r => r.height);

test('migration: a single-ratio grid is read exactly as it was; per-column rows appear only when the columns differ', () => {
  const open = ['a', 'b', 'c', 'd'];
  const old = normalizeSplit({ tabIds: open, layout: 'grid', cols: [.4, .6], rows: [.3, .7] }, open, 'a')!;
  assert.deepEqual([old.cols, old.rows, old.colRows], [[.4, .6], [.3, .7], undefined], 'nothing is added to a split saved before');
  assert.equal(JSON.stringify(normalizeSplit(JSON.parse(JSON.stringify(old)), open, 'a')), JSON.stringify(old), 'stable through a save and a load');
  const rects = paneRects(old, area), left = [rects[0].height, rects[2].height], right = [rects[1].height, rects[3].height];
  assert.deepEqual(left, right, 'both columns still share the one row split');
  const same = normalizeSplit({ tabIds: open, layout: 'grid', cols: [.5, .5], rows: [.5, .5], colRows: [[.3, .7], [.3, .7]] }, open, 'a')!;
  assert.equal(same.colRows, undefined); assert.deepEqual(same.rows, [.3, .7], 'equal per-column rows collapse to the shared rows');
  const apart = normalizeSplit({ tabIds: open, layout: 'grid', cols: [.5, .5], rows: [.9, .1], colRows: [[.3, .7], [.6, .4]] }, open, 'a')!;
  assert.deepEqual(apart.colRows, [[.3, .7], [.6, .4]]); assert.deepEqual(apart.rows, [.3, .7], 'rows mirrors the first column for anything that only reads rows');
  for (const junk of ['x', [[.5, .5]], [[.5, .5], 'x'], [[0, 1], [.5, .5]], null]) {
    const repaired = normalizeSplit({ tabIds: open, layout: 'grid', cols: [.5, .5], rows: [.4, .6], colRows: junk }, open, 'a')!;
    assert.ok(repaired.cols.length === 2 && repaired.rows.length === 2, JSON.stringify(junk));
    assert.ok(rowSets(repaired).every(set => set.length === 2 && Math.abs(set[0] + set[1] - 1) < 1e-3 && set.every(v => v >= .15)), `${JSON.stringify(junk)} leaves usable sizes`);
  }
  const three = normalizeSplit({ tabIds: ['a', 'b', 'c'], layout: 'left-one-right-two', cols: [.5, .5], rows: [.4, .6], colRows: [[.2, .8], [.7, .3]] }, open, 'a')!;
  assert.equal(three.colRows, undefined, 'only the grid keeps a row split per column'); assert.deepEqual(three.rows, [.4, .6]);
  assert.deepEqual(normalizeSplit({ tabIds: ['a', 'b'], ratio: .3 }, open, 'a'), { tabIds: ['a', 'b'], layout: 'columns', cols: [.3, .7], rows: [1] }, 'the two-pane ratio is still read');
});

test('panes are placed by percentages that match the pixel layout', () => {
  const cases: [SplitLayoutId, ReturnType<typeof grid>][] = [
    ['grid', grid([[.6, .4], [.35, .65]], [.6, .4], [.3, .7])], ['grid', grid()], ['columns', { layout: 'columns' as never, cols: [.37, .63], rows: [1] }],
    ['three-columns', { layout: 'three-columns' as never, cols: [.2, .5, .3], rows: [1] }], ['top-two-bottom-one', { layout: 'top-two-bottom-one' as never, cols: [.4, .6], rows: [.55, .45] }], ['left-one-right-two', { layout: 'left-one-right-two' as never, cols: [.45, .55], rows: [.3, .7] }],
  ];
  for (const [layout, split] of cases) {
    const pixels = paneRects({ ...split, layout }, { x: 0, y: 0, width: 1206, height: 806 }, 6), edges = paneEdges({ ...split, layout }, 6);
    pixels.forEach((r, i) => {
      const e = edges[i], at = [resolveLinear(e.left, 1206), resolveLinear(e.top, 806), resolveLinear(e.width, 1206), resolveLinear(e.height, 806)];
      [r.x, r.y, r.width, r.height].forEach((v, k) => assert.ok(Math.abs(v - at[k]) <= 1.01, `${layout} pane ${i} value ${k}: ${v} vs ${at[k]}`));
    });
  }
  const panes = paneEdges(grid([[.6, .4], [.35, .65]]), 6), left = resolveLinear(panes[0].height, 806), right = resolveLinear(panes[1].height, 806);
  assert.ok(Math.abs(left - 480) < 1 && Math.abs(right - 280) < 1, 'the two columns have their own heights');
});

test('a segment resizes only its own column; the column edge stays shared; the other column keeps its split', () => {
  const start = grid(), handles = splitHandles(start, area, 6, 10);
  const down = resizeSplit(start, pick(handles, 'row', 0), 0, 80, area, 6, 240);
  assert.deepEqual(down.colRows, [[.6, .4], [.5, .5]]); assert.deepEqual(down.cols, [.5, .5]); assert.deepEqual(down.rows, [.6, .4]);
  assert.deepEqual(heights({ ...start, ...down }), [480, 400, 320, 400], 'only the left panes changed height');
  const right = resizeSplit({ ...start, ...down }, pick(splitHandles({ ...start, ...down }, area, 6, 10), 'row', 1), 0, -40, area, 6, 240);
  assert.deepEqual(right.colRows, [[.6, .4], [.45, .55]], 'the right column moves on its own and the left keeps what it had');
  const across = resizeSplit({ ...start, ...down, ...right }, pick(handles, 'col'), 120, 55, area, 6, 240);
  assert.deepEqual(across.cols, [.6, .4], 'the vertical line moves both columns together'); assert.deepEqual(across.colRows, [[.6, .4], [.45, .55]], 'and leaves the segments alone (dy is ignored)');
});

test('the junction moves both axes and every segment touching it, keeping their offset', () => {
  const aligned = splitHandles(grid(), area, 6, 10), corner = pick(aligned, 'corner');
  assert.deepEqual(corner.segments, [{ row: 0, column: 0 }, { row: 0, column: 1 }]);
  const moved = resizeSplit(grid(), corner, -120, 40, area, 6, 240);
  assert.deepEqual(moved.cols, [.4, .6]); assert.deepEqual(moved.rows, [.55, .45]); assert.equal(moved.colRows, undefined, 'still aligned, so one shared split');
  const near = grid([[.5, .5], [.51, .49]]), joined = splitHandles(near, area, 6, 10).filter(h => h.kind === 'corner');
  assert.equal(joined.length, 1, 'segments under 16px apart share a junction');
  const together = resizeSplit(near, joined[0], 0, 40, area, 6, 240);
  assert.deepEqual(together.colRows, [[.55, .45], [.56, .44]], 'both moved by the same distance');
  const far = splitHandles(grid([[.5, .5], [.6, .4]]), area, 6, 10).filter(h => h.kind === 'corner');
  assert.equal(far.length, 2, 'segments further apart each get their own T junction');
  const t = resizeSplit(grid([[.5, .5], [.6, .4]]), far[0], 100, 40, area, 6, 240);
  assert.deepEqual(t.colRows, [[.55, .45], [.6, .4]], 'a T junction takes the column line and its own segment only');
  assert.ok(t.cols[0] > .5);
  for (const layout of ['top-two-bottom-one', 'left-one-right-two'] as const) {
    const split = { layout, cols: [.5, .5], rows: [.5, .5] }, one = pick(splitHandles(split, area, 6, 10), 'corner'), result = resizeSplit(split, one, 60, 40, area, 6, 240);
    assert.ok(result.cols[0] > .5 && result.rows[0] > .5, `${layout}: both axes follow the junction`); assert.equal(result.colRows, undefined);
  }
});

test('handle geometry: segments run along their own column, reach the column edge, and a junction is a 16px square on it', () => {
  const handles = splitHandles(grid(), area, 6, 10, 16), left = pick(handles, 'row', 0), right = pick(handles, 'row', 1), col = pick(handles, 'col'), corner = pick(handles, 'corner');
  assert.deepEqual([left.rect.x, left.rect.width], [0, 603]); assert.deepEqual([right.rect.x, right.rect.width], [603, 603]);
  assert.equal(left.rect.y, right.rect.y); assert.deepEqual([col.rect.y, col.rect.height], [72, 806], 'the column edge is one full-length line');
  assert.deepEqual([corner.rect.width, corner.rect.height], [16, 16]);
  assert.equal(corner.rect.x + 8, 603, 'centred on the column edge'); assert.equal(corner.rect.y + 8, Math.round(left.rect.y + 5));
  const uneven = splitHandles(grid([[.5, .5], [.65, .35]]), area, 6, 10);
  assert.notEqual(pick(uneven, 'row', 0).rect.y, pick(uneven, 'row', 1).rect.y);
  const lr = splitHandles({ layout: 'left-one-right-two', cols: [.5, .5], rows: [.5, .5] }, area, 6, 10);
  assert.deepEqual(lr.map(h => h.kind), ['col', 'row', 'corner']); assert.equal(pick(lr, 'row').column, 1, 'the segment is only on the right');
  assert.deepEqual(splitHandles({ layout: 'three-columns', cols: [.2, .5, .3], rows: [1] }, area).map(h => h.kind), ['col', 'col']);
  assert.deepEqual(splitHandles({ layout: 'rows', cols: [1], rows: [.5, .5] }, area).map(h => h.kind), ['row']);
  const keys = splitHandles(grid(), area).map(handleKey); assert.equal(new Set(keys).size, keys.length, 'every handle has its own key');
  assert.deepEqual(movesWith(corner), [handleKey(col), handleKey(left), handleKey(right)]); assert.deepEqual(movesWith(left), []);
});

test('minimum pane size clamps every kind of drag', () => {
  const start = grid(), handles = splitHandles(start, area, 6, 10);
  assert.deepEqual(resizeSplit(start, pick(handles, 'row', 0), 0, 5000, area, 6, 240).colRows, [[.775, .225], [.5, .5]], 'the pane below keeps 180px: three quarters of the minimum width, as minimumSize counts');
  assert.deepEqual(resizeSplit(start, pick(handles, 'row', 1), 0, -5000, area, 6, 240).colRows, [[.5, .5], [.225, .775]]);
  assert.deepEqual(resizeSplit(start, pick(handles, 'row', 1), 0, -5000, area, 6, 240, 0, 320).colRows, [[.5, .5], [.4, .6]], 'a taller minimum is honoured');
  assert.deepEqual(resizeSplit(start, pick(handles, 'col'), 5000, 0, area, 6, 240).cols, [.8, .2]);
  const far = resizeSplit(start, pick(handles, 'corner'), -5000, 5000, area, 6, 240);
  assert.deepEqual([far.cols, far.rows], [[.2, .8], [.775, .225]]);
  const small = resizeSplit(start, pick(handles, 'row', 0), 0, 5000, { x: 0, y: 0, width: 1206, height: 300 }, 6, 240);
  assert.ok(small.rows.every(v => v >= .15 && v <= .85) && Math.abs(small.rows[0] + small.rows[1] - 1) < 1e-3, 'a short window falls back to the fraction floor');
  const bad = resizeSplit(start, { kind: 'row', row: 9, column: 7 }, 0, 100, area, 6, 240); assert.deepEqual(bad.rows, [.5, .5], 'a handle that does not exist moves nothing');
  const three = { layout: 'three-columns' as const, cols: [.2, .5, .3], rows: [1] }, edge = resizeSplit(three, { kind: 'col', col: 1 }, 5000, 0, area, 6, 240);
  assert.ok(Math.abs(edge.cols[2] - 240 / 1194) < 1e-3 && edge.cols[0] === .2, 'only the two neighbours trade space');
});

test('soft detents: an even split, equal thirds, and lining up with the neighbouring segment; Alt (snap off) moves freely', () => {
  const start = grid(), left = pick(splitHandles(start, area, 6, 10), 'row', 0);
  assert.equal(resizeSplit(start, left, 0, 3, area, 6, 240, 8).colRows, undefined, 'within 8px of the middle lands on the middle');
  assert.equal(resizeSplit(start, left, 0, 3, area, 6, 240, 0).colRows?.[0][0], .5038, 'with snapping off it stays where the pointer is');
  assert.deepEqual(resizeSplit(start, left, 0, 20, area, 6, 240, 8).colRows?.[0], [.525, .475], 'past the detent it lets go');
  const apart = grid([[.5, .5], [.7, .3]]), moved = resizeSplit(apart, pick(splitHandles(apart, area, 6, 10), 'row', 0), 0, 158, area, 6, 240, 8);
  assert.equal(moved.colRows, undefined); assert.deepEqual(moved.rows, [.7, .3], 'it lines up with the right column and they become one edge again');
  const three = { layout: 'three-columns' as const, cols: [.3, .4, .3], rows: [1] };
  assert.deepEqual(resizeSplit(three, { kind: 'col', col: 0 }, 38, 0, area, 6, 240, 8).cols.map(v => Math.round(v * 1000) / 1000), [.333, .367, .3], 'equal thirds');
  const corner = pick(splitHandles(grid(), area, 6, 10), 'corner');
  assert.deepEqual(resizeSplit(grid(), corner, 4, -4, area, 6, 240, 8).cols, [.5, .5]);
});

test('double-click evens just the panes a handle separates', () => {
  const split = grid([[.2, .8], [.6, .4]], [.2, .8], [.3, .7]), handles = splitHandles(split, area, 6, 10);
  const one = equalizeSplit(split, pick(handles, 'row', 0));
  assert.deepEqual(one.colRows, [[.5, .5], [.6, .4]]); assert.deepEqual(one.cols, [.3, .7], 'the other column and the widths are untouched');
  assert.deepEqual(equalizeSplit(split, pick(handles, 'col')), { cols: [.5, .5], rows: [.2, .8], colRows: [[.2, .8], [.6, .4]] });
  const all = equalizeSplit(split, { kind: 'corner', col: 0, segments: [{ row: 0, column: 0 }, { row: 0, column: 1 }] });
  assert.deepEqual([all.cols, all.rows, all.colRows], [[.5, .5], [.5, .5], undefined], 'a junction evens everything touching it');
  const three = { layout: 'three-columns' as const, cols: [.2, .5, .3], rows: [1] };
  assert.deepEqual(equalizeSplit(three, { kind: 'col', col: 0 }).cols, [.35, .35, .3]); assert.deepEqual(equalizeSplit(three, { kind: 'col', col: 1 }).cols, [.2, .4, .4]);
  const shared = { layout: 'top-two-bottom-one' as const, cols: [.3, .7], rows: [.2, .8] };
  assert.deepEqual(equalizeSplit(shared, { kind: 'row', row: 0, column: 0 }), { cols: [.3, .7], rows: [.5, .5] });
});

test('the equalise glide passes through valid sizes from where it was to where it is going', () => {
  const from = grid([[.2, .8], [.7, .3]], [.2, .8], [.3, .7]), to = equalizeSplit(from, { kind: 'corner', col: 0, segments: [{ row: 0, column: 0 }, { row: 0, column: 1 }] });
  assert.deepEqual(blendSizes('grid', from, to, 0), { cols: [.3, .7], rows: [.2, .8], colRows: [[.2, .8], [.7, .3]] });
  assert.deepEqual(blendSizes('grid', from, to, 1), to);
  for (const t of [.1, .25, .5, .75, .9]) {
    const mid = blendSizes('grid', from, to, t), sets = rowSets({ layout: 'grid', ...mid });
    assert.ok(Math.abs(mid.cols[0] + mid.cols[1] - 1) < 1e-3 && sets.every(set => Math.abs(set[0] + set[1] - 1) < 1e-3), `t=${t}`);
    assert.ok(Math.abs(mid.cols[0] - (.3 + .2 * t)) < 1e-3);
  }
  assert.deepEqual(composeSizes('columns', [.5, .5], [[1]]), { cols: [.5, .5], rows: [1] });
});

test('reducer: per-column rows persist with the saved split, reload, and clear when the split is evened or re-laid-out', () => {
  let s = createInitialState(); const ids = [s.activeTabId];
  for (let i = 0; i < 3; i++) { s = reduceBrowser(s, { type: 'tab.new' }); ids.push(s.activeTabId); }
  s = reduceBrowser(s, { type: 'tab.select', id: ids[0] }); s = reduceBrowser(s, { type: 'split.open', tabIds: ids });
  const group = s.windowUi.splitGroups![0].id; assert.equal(s.windowUi.split?.layout, 'grid'); assert.equal(s.windowUi.split?.colRows, undefined);
  s = reduceBrowser(s, { type: 'split.resize', cols: [.4, .6], rows: [.6, .4], colRows: [[.6, .4], [.35, .65]] });
  assert.deepEqual(s.windowUi.split?.colRows, [[.6, .4], [.35, .65]]); assert.deepEqual(s.windowUi.splitGroups![0].colRows, [[.6, .4], [.35, .65]]);
  s = reduceBrowser(s, { type: 'split.close' }); s = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
  s = reduceBrowser(s, { type: 'split.group.select', id: group });
  assert.deepEqual([s.windowUi.split?.cols, s.windowUi.split?.colRows], [[.4, .6], [[.6, .4], [.35, .65]]], 'saved and reloaded');
  s = reduceBrowser(s, { type: 'split.resize', cols: [.5, .5], rows: [.5, .5] });
  assert.equal(s.windowUi.split?.colRows, undefined, 'a plain rows update evens the columns together'); assert.equal(s.windowUi.splitGroups![0].colRows, undefined, 'and the saved parent forgets them too');
  s = reduceBrowser(s, { type: 'split.resize', colRows: [[.5, .5], [.3, .7]] }); assert.deepEqual(s.windowUi.split?.colRows, [[.5, .5], [.3, .7]]);
  s = reduceBrowser(s, { type: 'split.layout', layout: 'grid' }); assert.equal(s.windowUi.split?.colRows, undefined, 'a new layout starts even');
  s = reduceBrowser(s, { type: 'split.resize', cols: [.5, .5], rows: [.5, .5], colRows: [[.5, .5], [.3, .7]] }); s = reduceBrowser(s, { type: 'split.remove', tabId: ids[3] });
  assert.equal(s.windowUi.split?.colRows, undefined); assert.equal(s.windowUi.split?.layout, 'three-columns');
});

test('native boundary accepts per-column sizes and rejects malformed ones', () => {
  const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs');
  let state = createInitialState(); const first = state.activeTabId;
  state = reduceBrowser(state, { type: 'tab.new' }); state = reduceBrowser(state, { type: 'split.open', tabIds: [first, state.activeTabId] });
  for (const action of [{ type: 'split.resize', cols: [.5, .5], rows: [.5, .5], colRows: [[.5, .5], [.4, .6]] }, { type: 'split.resize', colRows: [[.5, .5], [.4, .6]] }, { type: 'split.resize', cols: [.5, .5] }]) assert.doesNotThrow(() => validateAction(action, state), JSON.stringify(action));
  for (const action of [{ type: 'split.resize', colRows: 'x' }, { type: 'split.resize', colRows: [[2, -1]] }, { type: 'split.resize', colRows: [['x']] }, { type: 'split.resize', colRows: [[.1, .1, .1, .1, .1], [.5, .5]] }, { type: 'split.resize', colRows: [[], [], [], [], []] }, { type: 'split.resize', other: 1 }]) assert.throws(() => validateAction(action, state), JSON.stringify(action));
  assert.equal(Object.values(SPLIT_LAYOUTS).filter(spec => spec.columnRows).length, 1, 'only the 2×2 grid keeps rows per column');
});

// R4-29 follow-up: the layouts the picker was missing (three rows, the mirrored 1+2 and 2+1, four columns and rows, 1+3, 3+1 and one over three).
const NEW_LAYOUTS: SplitLayoutId[] = ['three-rows', 'top-one-bottom-two', 'left-two-right-one', 'four-columns', 'four-rows', 'left-one-right-three', 'left-three-right-one', 'top-one-bottom-three'];
const evenSplit = (layout: SplitLayoutId) => ({ layout, cols: evenSizes(SPLIT_LAYOUTS[layout].cols), rows: evenSizes(SPLIT_LAYOUTS[layout].rows) });
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('new layouts: every pane is placed once, inside the page area, never over another, and the shapes are what their names say', () => {
  for (const layout of NEW_LAYOUTS) {
    const rects = paneRects(evenSplit(layout), area, 6), spec = SPLIT_LAYOUTS[layout];
    assert.equal(rects.length, spec.panes, layout);
    for (const r of rects) assert.ok(r.width > 0 && r.height > 0 && r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height, `${layout} stays inside`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `${layout}: panes ${i} and ${j} do not overlap`);
    // The edges of the area are all reached (a pane touches each side), so nothing is left unused.
    assert.equal(Math.min(...rects.map(r => r.x)), area.x); assert.equal(Math.min(...rects.map(r => r.y)), area.y);
    assert.equal(Math.max(...rects.map(r => r.x + r.width)), area.x + area.width); assert.equal(Math.max(...rects.map(r => r.y + r.height)), area.y + area.height);
  }
  const at = (layout: SplitLayoutId) => paneRects(evenSplit(layout), area, 6);
  const tall = at('left-two-right-one'); assert.equal(tall[2].height, 806, 'the one on the right spans the full height'); assert.equal(tall[0].width, 600); assert.deepEqual([tall[0].y, tall[1].y > tall[0].y], [72, true], 'two stacked on the left, in order');
  const wide = at('top-one-bottom-two'); assert.equal(wide[0].width, 1206, 'the one on top spans the full width'); assert.ok(wide[1].x < wide[2].x && wide[1].y === wide[2].y && wide[1].y > wide[0].y, 'two below, left then right');
  assert.deepEqual(at('four-columns').map(r => r.width), [297, 297, 297, 297]); assert.deepEqual(at('four-rows').map(r => r.height), [197, 197, 197, 197]);
  const rail = at('left-one-right-three'); assert.equal(rail[0].height, 806); assert.ok(rail[1].y < rail[2].y && rail[2].y < rail[3].y && rail.slice(1).every(r => r.x === rail[1].x), 'three stacked on the right, in order');
  assert.equal(rail[1].height + rail[2].height + rail[3].height + 12, 806, 'the stack fills the height with its two gaps');
  const left = at('left-three-right-one'); assert.equal(left[3].height, 806); assert.ok(left[0].y < left[1].y && left[1].y < left[2].y && left.slice(0, 3).every(r => r.x === left[0].x), 'three stacked on the left, in order');
  const shelf = at('top-one-bottom-three'); assert.equal(shelf[0].width, 1206); assert.deepEqual(shelf.slice(1).map(r => r.width), [398, 398, 398]); assert.ok(shelf[1].x < shelf[2].x && shelf[2].x < shelf[3].x, 'three below, left to right');
  assert.deepEqual(at('three-rows').map(r => r.width), [1206, 1206, 1206]);
});

test('new layouts: every edge between two panes is a handle, a junction sits where a column edge meets a row segment', () => {
  const kinds = (layout: SplitLayoutId) => { const handles = splitHandles(evenSplit(layout), area, 6, 10, 16); return { col: handles.filter(h => h.kind === 'col').length, row: handles.filter(h => h.kind === 'row').length, corner: handles.filter(h => h.kind === 'corner').length, handles }; };
  const expected: Record<string, [number, number, number]> = { 'three-rows': [0, 2, 0], 'top-one-bottom-two': [1, 1, 1], 'left-two-right-one': [1, 1, 1], 'four-columns': [3, 0, 0], 'four-rows': [0, 3, 0], 'left-one-right-three': [1, 2, 2], 'left-three-right-one': [1, 2, 2], 'top-one-bottom-three': [2, 1, 2] };
  for (const layout of NEW_LAYOUTS) { const k = kinds(layout); assert.deepEqual([k.col, k.row, k.corner], expected[layout], `${layout} has [col, row, corner] handles`); assert.equal(new Set(k.handles.map(handleKey)).size, k.handles.length, `${layout}: every handle has its own key`); }
  // A column edge runs only where it separates two panes: the bottom row of "one on top, three below", the full height beside a stack.
  const shelf = kinds('top-one-bottom-three').handles.filter(h => h.kind === 'col'), shelfPanes = paneRects(evenSplit('top-one-bottom-three'), area, 6);
  assert.ok(shelf.every(h => Math.abs(h.rect.y - shelfPanes[1].y) < 1 && Math.abs(h.rect.height - shelfPanes[1].height) < 1), 'the edges between the three stop at the one above');
  const rail = kinds('left-one-right-three').handles, edge = rail.find(h => h.kind === 'col')!;
  assert.ok(Math.abs(edge.rect.height - 806) < 1, 'the edge beside a stack runs the full height'); assert.ok(rail.filter(h => h.kind === 'row').every(h => h.column === 1 && h.to === 1), 'each row edge is a segment of the stack only');
  const left = kinds('left-three-right-one').handles; assert.ok(left.filter(h => h.kind === 'row').every(h => h.column === 0 && h.to === 0), 'and of the stack on the left too');
  const wide = kinds('top-one-bottom-two').handles.find(h => h.kind === 'row')!; assert.ok(Math.abs(wide.rect.width - 1206) < 1, 'the edge under a pane that spans the width is one segment across it');
  // A corner moves with the edge and the segments it touches.
  for (const h of rail.filter(h => h.kind === 'corner')) assert.ok(movesWith(h).includes(handleKey({ kind: 'col', col: 0 })) && movesWith(h).length === 2, 'a corner takes the column edge and one segment');
});

test('new layouts: dragging a segment moves only its two panes; a corner moves its column edge and its segment; minimums and detents hold', () => {
  const rail = evenSplit('left-one-right-three'), handles = splitHandles(rail, area, 6, 10), segments = handles.filter(h => h.kind === 'row');
  const down = resizeSplit(rail, segments[0], 0, 100, area, 6, 240), third = 1 / 3;
  assert.ok(Math.abs(down.rows[0] - (third + 100 / 794)) < 1e-3 && Math.abs(down.rows[1] - (third - 100 / 794)) < 1e-3 && Math.abs(down.rows[2] - third) < 1e-3, `the two panes either side trade space and the third keeps its share ${down.rows}`);
  assert.deepEqual(down.cols, [.5, .5]); assert.equal(down.colRows, undefined, 'only the 2×2 grid keeps rows per column');
  assert.equal(paneRects({ ...rail, ...down }, area, 6)[0].height, 806, 'the tall pane never changes');
  const corner = resizeSplit(rail, handles.find(h => h.kind === 'corner')!, 60, 50, area, 6, 240);
  assert.ok(Math.abs(corner.cols[0] - (.5 + 60 / 1200)) < 1e-3 && corner.rows[0] > third + .04 && Math.abs(corner.rows[2] - third) < 1e-3, 'a corner moves the column edge and the row segment together');
  const cols = evenSplit('four-columns'), four = resizeSplit(cols, splitHandles(cols, area, 6, 10).filter(h => h.kind === 'col')[1], 100, 0, area, 6, 240);
  assert.equal(four.cols[0], .25); assert.equal(four.cols[3], .25); assert.ok(Math.abs(four.cols[1] - .298) < 2e-3 && Math.abs(four.cols[2] - .202) < 2e-3, `only the two panes the edge separates move, and the narrower keeps 240px ${four.cols}`);
  const rows = evenSplit('four-rows'), grab = splitHandles(rows, area, 6, 10).filter(h => h.kind === 'row')[0];
  assert.equal(rowFloor(4, 320), 160, 'a stack of four keeps 160px per pane at the app\'s 320px floor');
  const floor = resizeSplit(rows, grab, 0, 5000, area, 6, 320), heights = paneRects({ ...rows, ...floor }, area, 6).map(r => r.height);
  assert.ok(heights[1] >= 159 && heights[0] + heights[1] === 394, `the pane under the drag keeps its floor ${heights}`);
  const short = { x: 0, y: 0, width: 1206, height: 400 };
  for (const dy of [5000, -5000]) assert.deepEqual(resizeSplit(rows, grab, 0, dy, short, 6, 320).rows, [.25, .25, .25, .25], 'a pair too small for two floors stays even rather than flipping');
  const three = { layout: 'three-rows' as const, cols: [1], rows: [.3, .4, .3] }, edge = splitHandles(three, area, 6, 10).filter(h => h.kind === 'row')[0];
  assert.equal(resizeSplit(three, edge, 0, 27, area, 6, 240, 8).rows[0], .3333, 'an edge near equal thirds settles on them');
  assert.equal(resizeSplit(three, edge, 0, 27, area, 6, 240, 0).rows[0], .334, 'Alt (snap off) moves freely');
  const shelfStart = { layout: 'top-one-bottom-three' as const, cols: [.2, .5, .3], rows: [.7, .3] }, even = equalizeSplit(shelfStart, splitHandles(shelfStart, area, 6, 10).find(h => h.kind === 'corner')!);
  assert.deepEqual([even.cols, even.rows], [[.35, .35, .3], [.5, .5]], 'a junction evens everything touching it');
  for (const layout of NEW_LAYOUTS) assert.ok(minimumSize(layout, 6, 320).height <= 658, `${layout} fits a 1080p window`);
  assert.deepEqual([minimumSize('four-rows', 6, 320).height, minimumSize('three-rows', 6, 320).height, minimumSize('rows', 6, 320).height], [658, 492, 486], 'tall stacks have a lower floor per pane; two rows are as before');
});

test('new layouts: split.layout, split.arrange and a save and reload keep every layout and its sizes; the boundary knows all of them', () => {
  const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs');
  let s = createInitialState(); const ids = [s.activeTabId];
  for (let i = 0; i < 3; i++) { s = reduceBrowser(s, { type: 'tab.new' }); ids.push(s.activeTabId); }
  s = reduceBrowser(s, { type: 'tab.select', id: ids[0] });
  for (const count of [3, 4]) {
    s = reduceBrowser(s, { type: 'split.open', tabIds: ids.slice(0, count) });
    for (const layout of layoutsFor(count)) {
      s = reduceBrowser(s, { type: 'split.layout', layout }); const spec = SPLIT_LAYOUTS[layout];
      assert.equal(s.windowUi.split?.layout, layout); assert.deepEqual([s.windowUi.split?.cols.length, s.windowUi.split?.rows.length], [spec.cols, spec.rows], `${layout} starts with its own even sizes`);
      assert.equal(s.windowUi.splitGroups![0].layout, layout, 'the saved split follows');
      assert.doesNotThrow(() => validateAction({ type: 'split.layout', layout }, s), layout); assert.doesNotThrow(() => validateAction({ type: 'split.open', tabIds: ids.slice(0, count), layout }, s));
      assert.doesNotThrow(() => validateAction({ type: 'split.arrange', layout, order: ids.slice(0, count).reverse() }, s));
      assert.equal(reduceBrowser(s, { type: 'split.layout', layout: count === 3 ? 'grid' : 'three-rows' }), s, 'a layout for another pane count is refused');
    }
    s = reduceBrowser(s, { type: 'split.close' });
  }
  assert.throws(() => validateAction({ type: 'split.layout', layout: 'five-columns' }, s));
  s = reduceBrowser(s, { type: 'split.open', tabIds: ids, layout: 'left-three-right-one' }); const group = s.windowUi.splitGroups![0].id;
  s = reduceBrowser(s, { type: 'split.resize', cols: [.4, .6], rows: [.2, .3, .5] }); assert.deepEqual(s.windowUi.split?.rows, [.2, .3, .5]);
  s = reduceBrowser(s, { type: 'split.arrange', layout: 'left-three-right-one', order: [ids[3], ids[0], ids[1], ids[2]] }); assert.deepEqual([s.windowUi.split?.tabIds[0], s.windowUi.split?.rows], [ids[3], [.2, .3, .5]], 'a new order keeps the sizes of the same layout');
  s = reduceBrowser(s, { type: 'split.close' }); s = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s)))); s = reduceBrowser(s, { type: 'split.group.select', id: group });
  assert.deepEqual([s.windowUi.split?.layout, s.windowUi.split?.cols, s.windowUi.split?.rows], ['left-three-right-one', [.4, .6], [.2, .3, .5]], 'saved and reloaded');
  // Every place that lists the layouts names the same ones.
  const require = createRequire(import.meta.url), ids14 = Object.keys(SPLIT_LAYOUTS);
  assert.deepEqual(Object.keys(require('../desktop/rewind/split-commands.cjs').LAYOUT_PANES), ids14, 'the shortcut model');
  assert.deepEqual(require('../desktop/rewind/checkpoint-model.cjs').LAYOUTS, ids14, 'the rewind checkpoints');
  assert.deepEqual(Object.entries(require('../desktop/rewind/split-commands.cjs').LAYOUT_PANES).map(([id, panes]) => [id, panes]), Object.entries(SPLIT_LAYOUTS).map(([id, spec]) => [id, spec.panes]));
});
