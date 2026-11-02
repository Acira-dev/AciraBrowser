import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { DROP_EDGES, SPLIT_LAYOUTS, allLayoutsFor, cutGrid, evenSizes, layoutsFor, moveBeside, paneRects, sameArrangement, type DropEdge, type SplitLayoutId } from '../src/runtime/splitLayout';
import { PANE_EDGE, PANE_HYSTERESIS, distanceToPolygon, paneMoveHit, paneMoveZoneFor, paneRegionAt, paneZoneAction, paneZoneRect, regionOf, regionPolygon, type PaneBox, type PaneHit, type PaneRegion } from '../src/ui/paneDropZones';
import { cancelPaneDrag, currentPaneDrag, endPaneDrag, movePaneDrag, paneCardOut, startPaneDrag } from '../src/ui/paneDrag';

const require = createRequire(import.meta.url);
const PAGE = { width: 1480, height: 830 };
const ids = ['a', 'b', 'c', 'd'];
const boxesOf = (layout: SplitLayoutId, list = ids.slice(0, SPLIT_LAYOUTS[layout].panes)): PaneBox[] => paneRects({ layout, cols: evenSizes(SPLIT_LAYOUTS[layout].cols), rows: evenSizes(SPLIT_LAYOUTS[layout].rows) }, { x: 0, y: 0, ...PAGE }, 6).map((r, i) => ({ tabId: list[i], ...r }));
const REGIONS: PaneRegion[] = ['centre', 'left', 'right', 'top', 'bottom'];

test('zones: the middle is a clear rectangle; each edge is a band a quarter of the pane deep that never overlaps the middle; together they tile the pane', () => {
  for (const box of [{ tabId: 'p', x: 0, y: 0, width: 490, height: 830 }, { tabId: 'p', x: 100, y: 50, width: 1480, height: 205 }, { tabId: 'p', x: 0, y: 0, width: 737, height: 412 }]) {
    const centre = regionPolygon(box, 'centre');
    assert.ok(Math.abs(centre[0].x - box.x - box.width * PANE_EDGE) < 1e-6 || centre[0].x - box.x >= 48 - 1e-6, 'side bands are a quarter of the width (48px at least)');
    assert.ok(centre[0].y - box.y >= box.height * PANE_EDGE - 1e-6, 'top band a quarter of the height');
    assert.ok(centre[2].x > centre[0].x && centre[2].y > centre[0].y, 'a real middle remains');
    let counted = 0;
    for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
      const point = { x: box.x + box.width * (i + .37) / 40.7, y: box.y + box.height * (j + .53) / 40.9 };
      const inside = REGIONS.filter(region => distanceToPolygon(point, regionPolygon(box, region)) === 0);
      assert.equal(inside.length, 1, `exactly one zone at ${JSON.stringify(point)}: ${inside.join(',')}`);
      assert.equal(regionOf(box, point), inside[0]); counted++;
    }
    assert.equal(counted, 39 * 39);
  }
});

test('zones: a side needs the pointer near the side (outer quarter), not near the middle; corners go to the nearer edge', () => {
  const box = { tabId: 'p', x: 0, y: 0, width: 490, height: 830 };
  assert.equal(regionOf(box, { x: 490 * .3, y: 415 }), 'centre', '30% in from the left is the middle');
  assert.equal(regionOf(box, { x: 490 * .2, y: 415 }), 'left');
  assert.equal(regionOf(box, { x: 490 * .8, y: 415 }), 'right');
  assert.equal(regionOf(box, { x: 245, y: 830 * .2 }), 'top');
  assert.equal(regionOf(box, { x: 245, y: 830 * .85 }), 'bottom');
  // The top-left corner square: in proportion to the bands, the nearer one wins.
  assert.equal(regionOf(box, { x: 10, y: 150 }), 'left', '2% of the band from the left, 72% of it from the top');
  assert.equal(regionOf(box, { x: 100, y: 12 }), 'top');
});

test('hysteresis: the lit zone holds until the pointer is clearly in another (12px), across a boundary, a gap between panes and a corner diagonal', () => {
  const boxes = boxesOf('three-columns'), a = boxes[0], b = boxes[1];
  const edge = a.x + a.width * PANE_EDGE; // the boundary between A's left band and its middle
  let hit: PaneHit | null = paneRegionAt(boxes, { x: edge - 20, y: 400 });
  assert.deepEqual(hit, { pane: 'a', region: 'left' });
  hit = paneRegionAt(boxes, { x: edge + PANE_HYSTERESIS - 2, y: 400 }, hit); assert.equal(hit?.region, 'left', 'just past the boundary: still left');
  hit = paneRegionAt(boxes, { x: edge + PANE_HYSTERESIS + 2, y: 400 }, hit); assert.equal(hit?.region, 'centre', 'clearly inside the middle');
  // Across the gap between A and B: A's right band holds until 12px into B.
  hit = paneRegionAt(boxes, { x: a.x + a.width - 5, y: 400 }); assert.deepEqual(hit, { pane: 'a', region: 'right' });
  hit = paneRegionAt(boxes, { x: a.x + a.width + 3, y: 400 }, hit); assert.deepEqual(hit, { pane: 'a', region: 'right' }, 'in the gap');
  hit = paneRegionAt(boxes, { x: b.x + 4, y: 400 }, hit); assert.deepEqual(hit, { pane: 'a', region: 'right' }, '4px into B');
  hit = paneRegionAt(boxes, { x: b.x + 14, y: 400 }, hit); assert.deepEqual(hit, { pane: 'b', region: 'left' });
  // The corner diagonal: wobbling ±5px across it never flips the zone once chosen.
  const box = boxes[2], d = { x: box.x + box.width * PANE_EDGE * .5, y: box.y + box.height * PANE_EDGE * .5 };
  hit = paneRegionAt(boxes, d); const first = hit?.region;
  for (let i = 0; i < 40; i++) { hit = paneRegionAt(boxes, { x: d.x + (i % 2 ? 5 : -5), y: d.y + (i % 2 ? -5 : 5) }, hit); assert.equal(hit?.region, first, `wobble ${i}`); }
  assert.equal(paneRegionAt(boxes, { x: -40, y: 400 }, null), null, 'off every pane');
});

test('no flicker: straight drags between any two panes of every 3- and 4-pane layout never bring a zone back after leaving it', () => {
  for (const layout of [...allLayoutsFor(3), ...allLayoutsFor(4)]) {
    const boxes = boxesOf(layout), split = { layout, tabIds: boxes.map(b => b.tabId) };
    for (const from of boxes) for (const to of boxes) if (from !== to) for (const where of ['centre', ...DROP_EDGES] as const) {
      const start = { x: from.x + 70, y: from.y + 13 }, end = where === 'centre' ? { x: to.x + to.width / 2, y: to.y + to.height / 2 } : where === 'left' ? { x: to.x + to.width * .08, y: to.y + to.height * .5 } : where === 'right' ? { x: to.x + to.width * .92, y: to.y + to.height * .5 } : where === 'top' ? { x: to.x + to.width * .5, y: to.y + to.height * .08 } : { x: to.x + to.width * .5, y: to.y + to.height * .92 };
      let hit: PaneHit | null = null; const seen: string[] = [];
      for (let i = 0; i <= 120; i++) {
        const point = { x: start.x + (end.x - start.x) * i / 120 + (i % 2 ? 2 : -2), y: start.y + (end.y - start.y) * i / 120 + (i % 3 ? 1.5 : -1.5) };
        hit = paneMoveHit(boxes, split, from.tabId, point, PAGE, hit).hit;
        const key = hit ? `${hit.pane}:${hit.region}` : '-';
        if (seen.at(-1) !== key) { assert.ok(!seen.includes(key) || key === '-', `${layout} ${from.tabId}→${to.tabId}.${where}: ${[...seen, key].join(' > ')}`); seen.push(key); }
      }
      assert.equal(seen.at(-1), `${to.tabId}:${where}`, `${layout} ${from.tabId}→${to.tabId}.${where} ends on the aimed zone`);
    }
  }
});

test('catalog: every way 3 and 4 panes can tile the page has a layout, the extra 4-pane shapes stay out of the picker and menus, and main knows every id', () => {
  const key = (grid: number[][]) => { const m = new Map<number, number>(); return grid.map(row => row.map(p => { if (!m.has(p)) m.set(p, m.size); return m.get(p); }).join('')).join('/'); };
  const tilings = new Set<string>();
  for (const id of allLayoutsFor(3)) for (let t = 0; t < 3; t++) for (const edge of DROP_EDGES) { const grid = cutGrid(SPLIT_LAYOUTS[id].areas, t, edge, 3); if (grid) tilings.add(key(grid)); }
  const catalog = new Set(allLayoutsFor(4).map(id => key(SPLIT_LAYOUTS[id].areas)));
  for (const tiling of tilings) assert.ok(catalog.has(tiling), `the four-pane tiling ${tiling} has a layout`);
  assert.equal(catalog.size, allLayoutsFor(4).length, 'one layout per tiling');
  assert.equal(allLayoutsFor(3).length, 6); assert.equal(layoutsFor(4).length, 6, 'the picker still offers six'); assert.equal(allLayoutsFor(4).length, 21);
  const { validateAction } = require('../desktop/validation.cjs') as { validateAction: (action: unknown) => unknown };
  const { LAYOUTS } = require('../desktop/rewind/checkpoint-model.cjs') as { LAYOUTS: string[] };
  const { LAYOUT_PANES } = require('../desktop/rewind/split-commands.cjs') as { LAYOUT_PANES: Record<string, number> };
  for (const id of Object.keys(SPLIT_LAYOUTS) as SplitLayoutId[]) {
    assert.doesNotThrow(() => validateAction({ type: 'split.layout', layout: id }), `validation knows ${id}`);
    assert.ok(LAYOUTS.includes(id), `rewind checkpoints keep ${id}`);
    assert.equal(LAYOUT_PANES[id], SPLIT_LAYOUTS[id].panes, `split commands know ${id}`);
  }
});

test('coverage: every pane onto every edge of every other pane, in every layout, has a real result (or is already there); moving up in three columns stacks', () => {
  let moves = 0, already = 0;
  for (const count of [2, 3, 4]) for (const layout of allLayoutsFor(count)) {
    const list = ids.slice(0, count);
    for (const from of list) for (const to of list) if (from !== to) for (const edge of DROP_EDGES) {
      const result = moveBeside({ layout, tabIds: list }, from, to, edge);
      assert.ok(result, `${layout} ${from}→${to}.${edge} has a result`);
      assert.deepEqual([...result.tabIds].sort(), [...list].sort());
      if (sameArrangement({ layout, tabIds: list }, result)) already++; else moves++;
    }
  }
  assert.ok(moves > 1000 && already < 100, `${moves} moves, ${already} already in place`);
  for (const from of ['a', 'b', 'c']) for (const to of ['a', 'b', 'c']) if (from !== to) for (const edge of ['top', 'bottom'] as DropEdge[]) {
    const result = moveBeside({ layout: 'three-columns', tabIds: ['a', 'b', 'c'] }, from, to, edge)!;
    assert.ok(SPLIT_LAYOUTS[result.layout].rows > 1, `${from} onto the ${edge} of ${to} stacks them (${result.layout})`);
    const cells = paneRects({ layout: result.layout, cols: evenSizes(SPLIT_LAYOUTS[result.layout].cols), rows: evenSizes(SPLIT_LAYOUTS[result.layout].rows) }, { x: 0, y: 0, ...PAGE }, 6);
    const moved = cells[result.tabIds.indexOf(from)], target = cells[result.tabIds.indexOf(to)];
    assert.ok(edge === 'top' ? moved.y < target.y : moved.y > target.y, `${from} ends up on the ${edge} side of ${to}`);
  }
});

test('preview = result: the landing box of every move zone is exactly where split.arrange puts the pane, even sizes or kept ones', () => {
  let s = createInitialState(); const tabs = [s.activeTabId];
  for (const n of [2, 3, 4]) { s = reduceBrowser(s, { type: 'tab.new', url: `https://p${n}.test/` }); tabs.push(s.activeTabId); }
  let checked = 0;
  for (const layout of ['three-columns', 'left-one-right-two', 'top-two-bottom-one', 'grid', 'four-rows', 'three-columns-split-middle'] as SplitLayoutId[]) {
    const list = tabs.slice(0, SPLIT_LAYOUTS[layout].panes);
    for (const from of list) for (const to of list) if (from !== to) for (const edge of DROP_EDGES) {
      let base = reduceBrowser(s, { type: 'tab.select', id: list[0] }); base = reduceBrowser(base, { type: 'split.open', tabIds: list, layout });
      const split = base.windowUi.split!, rect = { x: 0, y: 0, ...PAGE };
      const boxes = paneRects(split, rect, 6).map((r, i) => ({ tabId: split.tabIds[i], ...r }));
      const zone = paneMoveZoneFor(split, from, { pane: to, region: edge }, PAGE);
      if (!zone) continue;
      const preview = paneZoneRect(zone, boxes, from, PAGE, split)!, next = reduceBrowser(base, paneZoneAction(zone, from)).windowUi.split!;
      const landed = paneRects(next, rect, 6)[next.tabIds.indexOf(from)];
      assert.deepEqual(preview, landed, `${layout} ${from}→${to}.${edge}`); checked++;
    }
  }
  assert.ok(checked > 150, `${checked} drops checked`);
});

test('the drag store: a drop outside every zone, on the pane\'s own box or on an edge it already sits beside does nothing; the card comes and goes past the top', () => {
  const boxes = boxesOf('three-columns'), split = { layout: 'three-columns' as const, tabIds: ['a', 'b', 'c'] };
  startPaneDrag('c', boxes, { x: 1300, y: 10 }, PAGE, split);
  movePaneDrag({ x: boxes[1].x + boxes[1].width - 10, y: 400 }); assert.equal(currentPaneDrag()!.move, null, 'right of B: where C already is'); assert.equal(currentPaneDrag()!.over, null);
  movePaneDrag({ x: 1300, y: 400 }); assert.equal(currentPaneDrag()!.move, null, 'its own box');
  movePaneDrag({ x: 1300, y: PAGE.height + 60 }); assert.equal(endPaneDrag(0), null, 'outside every pane');
  startPaneDrag('c', boxes, { x: 1300, y: 10 }, PAGE, split);
  movePaneDrag({ x: boxes[0].x + 20, y: 400 }); const lit = currentPaneDrag()!.move;
  assert.equal(lit?.edge, 'left');
  movePaneDrag({ x: boxes[0].x + boxes[0].width * PANE_EDGE + 8, y: 400 }); assert.deepEqual(currentPaneDrag()!.move, lit, 'just past the band: the same zone (hysteresis)');
  cancelPaneDrag(); assert.equal(endPaneDrag(0), null, 'Esc');
  assert.equal(paneCardOut(false, { x: 600, y: 300 }, PAGE, ['three-columns']), false);
  assert.equal(paneCardOut(false, { x: 600, y: -2 }, PAGE, ['three-columns']), true, 'past the top');
  assert.equal(paneCardOut(true, { x: 600, y: 60 }, PAGE, ['three-columns']), true, 'stays while the pointer is by the card');
  assert.equal(paneCardOut(true, { x: 600, y: 400 }, PAGE, ['three-columns']), false, 'back down on the panes: away');
});
