import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BrowserSnapshot } from '../src/runtime/types';
import { MAX_PANES, SPLIT_LAYOUTS, allLayoutsFor, layoutsFor, paneEdges, resolveLinear, type DropEdge, type SplitLayoutId, type SplitState } from '../src/runtime/splitLayout';
import { paneBandDepth, paneMoveZoneFor, type PaneRegion } from '../src/ui/paneDropZones';
import { PANE_CARD_LIFT, PANE_DROP_HOLD, PANE_PILL, PANE_SUMMON_FLOOR, PANE_SUMMON_KEEP, cancelPaneDrag, currentPaneDrag, endPaneDrag, movePaneDrag, paneCardOut, paneDragPicker, paneDropAction, panePreviewKey, panePreviewRects, paneSummonBand, pillReach, startPaneDrag, type PaneDragState, type PaneRect } from '../src/ui/paneDrag';
import { pickerGeometry } from '../src/ui/splitDrop';

/** R5 live layout preview (founder 27 Oct): while a pane is dragged over a zone every pane's frame sits at the box the release gives it. These tests hold the
 *  preview to the page's own geometry: for every zone of every 2-, 3- and 4-pane layout (5 has none in the catalog: MAX_PANES), the boxes the frames show
 *  equal the boxes the page lays the panes out in after the reducer ran the drop (paneEdges, the CSS the page uses), to the pixel. */
const PAGE = { width: 1480, height: 830 };
const REGIONS: readonly PaneRegion[] = ['centre', 'left', 'right', 'top', 'bottom'];
/** Uneven sizes, so a layout that keeps its sizes is told apart from one laid out evenly. */
const uneven = (n: number) => n === 1 ? [1] : n === 2 ? [.58, .42] : n === 3 ? [.4, .35, .25] : [.31, .24, .25, .2];
function splitWith(n: number, layout: SplitLayoutId): BrowserSnapshot {
  let s = createInitialState(); const ids = [s.activeTabId];
  for (let i = 1; i < n; i++) { s = reduceBrowser(s, { type: 'tab.new', url: `https://p${i}.test/` }); ids.push(s.activeTabId); }
  s = reduceBrowser(s, { type: 'split.open', tabIds: ids, layout });
  const spec = SPLIT_LAYOUTS[layout];
  s = reduceBrowser(s, { type: 'split.resize', cols: uneven(spec.cols), rows: uneven(spec.rows) } as never);
  return s;
}
/** Where the page puts each pane (page-area coordinates), by tab id: the same calc() the pane sections get (features/split/SplitView paneArea). */
function laidOut(split: SplitState): PaneRect[] {
  return paneEdges(split, 6).map((edge, index) => ({ tabId: split.tabIds[index], x: resolveLinear(edge.left, PAGE.width), y: resolveLinear(edge.top, PAGE.height), width: resolveLinear(edge.width, PAGE.width), height: resolveLinear(edge.height, PAGE.height) }));
}
const worst = (a: readonly PaneRect[], b: readonly PaneRect[]) => Math.max(0, ...a.map(rect => { const other = b.find(item => item.tabId === rect.tabId); return other ? Math.max(Math.abs(rect.x - other.x), Math.abs(rect.y - other.y), Math.abs(rect.width - other.width), Math.abs(rect.height - other.height)) : Infinity; }));
const dragOf = (split: SplitState, rects: PaneRect[], tabId: string, extra: Partial<PaneDragState>): PaneDragState => ({ tabId, over: null, rects, point: { x: 0, y: 0 }, split: { layout: split.layout, tabIds: [...split.tabIds] }, move: null, phase: 'drag', page: PAGE, layouts: [], zone: null, onCard: false, lift: PANE_CARD_LIFT, ...extra });

test('R5 live preview: for every zone of every 2-, 3- and 4-pane layout the frames show exactly the boxes the drop lays out (±1 px)', t => {
  let zones = 0, moves = 0, swaps = 0, cells = 0, max = 0;
  assert.equal(MAX_PANES, 4, 'the catalog stops at four panes; a fifth would add its layouts here unchanged');
  for (let n = 2; n <= 5; n++) for (const layout of allLayoutsFor(n)) {
    const state = splitWith(n, layout), split = state.windowUi.split!; assert.equal(split.layout, layout);
    const rects = laidOut(split);
    for (const dragged of split.tabIds) {
      for (const pane of split.tabIds) for (const region of REGIONS) {
        const zone = paneMoveZoneFor(split, dragged, pane === dragged ? null : { pane, region }, PAGE);
        if (!zone) continue;
        const drag = dragOf(split, rects, dragged, zone.kind === 'replace' ? { over: zone.pane } : { move: zone as Extract<typeof zone, { kind: 'move' }> });
        const action = paneDropAction(drag)!, after = reduceBrowser(state, action).windowUi.split!, shown = panePreviewRects(drag), result = laidOut(after);
        const off = worst(shown, result); max = Math.max(max, off); zones++; if (zone.kind === 'replace') swaps++; else moves++;
        assert.ok(off <= 1, `${layout} ${dragged}→${pane}.${region}: preview off by ${off.toFixed(2)} px`);
        assert.notEqual(panePreviewKey(drag), '', 'a zone always shows an arrangement');
      }
      // The layout card's cells: the same frames show the cell's result.
      for (const target of layoutsFor(n)) for (let index = 0; index < n; index++) {
        const drag = dragOf(split, rects, dragged, { zone: { layout: target, index } }), action = paneDropAction(drag);
        if (!action) continue;
        const after = reduceBrowser(state, action).windowUi.split!, off = worst(panePreviewRects(drag), laidOut(after)); max = Math.max(max, off); cells++;
        assert.ok(off <= 1, `card ${target} slot ${index} (${dragged}): preview off by ${off.toFixed(2)} px`);
      }
    }
  }
  t.diagnostic(`zones ${zones} (moves ${moves}, swaps ${swaps}), card cells ${cells}, worst difference ${max.toFixed(4)} px`);
  assert.ok(moves > 200 && swaps > 50 && cells > 100, `every layout was covered (${moves} moves, ${swaps} swaps, ${cells} cells)`);
});

test('R5 live preview: off every zone the frames sit in their own boxes; Esc glides them back before the drag clears; a release holds what was shown', async () => {
  const state = splitWith(3, 'three-columns'), split = state.windowUi.split!, rects = laidOut(split), [a, b, c] = split.tabIds;
  startPaneDrag(c, rects, { x: rects[2].x + 60, y: rects[2].y + 13 }, PAGE, split);
  movePaneDrag({ x: rects[2].x + rects[2].width / 2, y: 500 });
  assert.deepEqual(panePreviewRects(currentPaneDrag()!), rects, 'on its own pane: nothing moves');
  assert.equal(panePreviewKey(currentPaneDrag()!), '');
  // Onto the left edge of A: C's frame lands in the left column, the others move over.
  movePaneDrag({ x: rects[0].x + 30, y: 500 });
  const shown = panePreviewRects(currentPaneDrag()!);
  assert.equal(currentPaneDrag()!.move?.edge, 'left');
  assert.ok(shown.find(r => r.tabId === c)!.x < 1, 'the dragged pane lands at the left');
  // Esc: the frames glide back (phase back), then the drag clears.
  cancelPaneDrag(120);
  assert.equal(currentPaneDrag()?.phase, 'back'); assert.deepEqual(panePreviewRects(currentPaneDrag()!), rects);
  await new Promise(resolve => setTimeout(resolve, 160)); assert.equal(currentPaneDrag(), null);
  // A release on a zone keeps the frames where they are (phase drop, same boxes) while the pages are laid out, then clears.
  startPaneDrag(c, rects, { x: rects[2].x + 60, y: rects[2].y + 13 }, PAGE, split);
  movePaneDrag({ x: rects[0].x + 30, y: 500 });
  const before = panePreviewRects(currentPaneDrag()!), action = endPaneDrag(200);
  assert.equal(action?.type, 'split.arrange'); assert.equal(currentPaneDrag()?.phase, 'drop');
  assert.deepEqual(panePreviewRects(currentPaneDrag()!), before, 'the drop shows what the drag showed');
  await new Promise(resolve => setTimeout(resolve, 240)); assert.equal(currentPaneDrag(), null);
  assert.ok(PANE_DROP_HOLD >= 60 && PANE_DROP_HOLD <= 120, 'a settled release holds only briefly');
  void a; void b;
});

test('R5 summon band: a strip at the top of the page (8% of its height, 64–96 px) that never takes a top-row pane\'s whole top band', () => {
  const rows = (layout: SplitLayoutId, page = PAGE) => { const state = splitWith(SPLIT_LAYOUTS[layout].panes, layout); return paneEdges({ ...state.windowUi.split!, cols: [...Array(SPLIT_LAYOUTS[layout].cols)].map(() => 1 / SPLIT_LAYOUTS[layout].cols), rows: [...Array(SPLIT_LAYOUTS[layout].rows)].map(() => 1 / SPLIT_LAYOUTS[layout].rows), colRows: undefined }, 6).map((edge, index) => ({ tabId: String(index), x: resolveLinear(edge.left, page.width), y: resolveLinear(edge.top, page.height), width: resolveLinear(edge.width, page.width), height: resolveLinear(edge.height, page.height) })); };
  assert.equal(paneSummonBand(PAGE, rows('three-columns')), 66, '8% of 830');
  assert.equal(paneSummonBand({ width: 1480, height: 1400 }, rows('three-columns', { width: 1480, height: 1400 })), 96, 'at most 96');
  assert.equal(paneSummonBand({ width: 1000, height: 520 }, rows('columns', { width: 1000, height: 520 })), 64, 'at least 64');
  for (let n = 2; n <= 4; n++) for (const layout of allLayoutsFor(n)) {
    const boxes = rows(layout), band = paneSummonBand(PAGE, boxes);
    assert.ok(band >= PANE_SUMMON_FLOOR && band <= 96, `${layout}: band ${band}`);
    for (const box of boxes.filter(item => item.y < 1)) { const bottom = box.y + paneBandDepth(box.height); assert.ok(band === PANE_SUMMON_FLOOR || bottom - band >= PANE_SUMMON_KEEP - 1, `${layout}: ${Math.round(bottom - band)} px of the top band stay below the strip`); }
  }
});

test('R5 summon band: precedence — armed strip summons (round the pill only on reaching it), nothing lights in the strip, top-band zones work below it', () => {
  const layouts = layoutsFor(3), band = 66, mid = PAGE.width / 2, pillBottom = PANE_PILL.top + PANE_PILL.height;
  assert.equal(paneCardOut(false, { x: 200, y: 40 }, PAGE, layouts, false, band), false, 'not armed: a drag that starts on a top ribbon does not summon');
  assert.equal(paneCardOut(false, { x: 200, y: 60 }, PAGE, layouts, true, band), true, 'armed, in the strip away from the pill: summoned');
  assert.equal(paneCardOut(false, { x: 200, y: 70 }, PAGE, layouts, true, band), false, 'below the strip: not');
  assert.equal(paneCardOut(false, { x: mid, y: 60 }, PAGE, layouts, true, band), false, 'round the pill the card waits for the chip to reach it');
  assert.equal(paneCardOut(false, { x: mid, y: pillBottom + 4 }, PAGE, layouts, true, band), true, 'on the pill: summoned');
  assert.equal(paneCardOut(false, { x: 200, y: -3 }, PAGE, layouts, false, band), true, 'past the top: always');
  const { card } = pickerGeometry(PAGE.width, PAGE.height, layouts, PANE_CARD_LIFT);
  assert.equal(paneCardOut(true, { x: 200, y: card.y + card.height + 20 }, PAGE, layouts, true, band), true, 'stays by the card');
  assert.equal(paneCardOut(true, { x: 200, y: card.y + card.height + 40 }, PAGE, layouts, true, band), false, 'away below it');
  // Through the store: three columns, C dragged from its ribbon (inside the strip).
  const state = splitWith(3, 'three-columns'), split = state.windowUi.split!, rects = laidOut(split), [a, , c] = split.tabIds;
  startPaneDrag(c, rects, { x: rects[2].x + 60, y: 13 }, PAGE, split);
  movePaneDrag({ x: rects[2].x + 60, y: 30 }); assert.equal(currentPaneDrag()!.card, false); assert.equal(currentPaneDrag()!.armed, false);
  // Onto A's top edge inside the strip before arming: the pane zone (nothing is the card's yet).
  movePaneDrag({ x: rects[0].x + rects[0].width / 2, y: 50 }); assert.equal(currentPaneDrag()!.move?.edge, 'top', 'unarmed: the top band lights');
  movePaneDrag({ x: rects[0].x + rects[0].width / 2, y: 300 }); assert.equal(currentPaneDrag()!.armed, true, 'armed once below the strip');
  // Below the strip, in A's top band: the top zone.
  movePaneDrag({ x: rects[0].x + rects[0].width / 2, y: 100 }); assert.equal(currentPaneDrag()!.move?.edge, 'top', 'A\'s top band below the strip'); assert.equal(currentPaneDrag()!.card, false);
  // Up into the strip away from the pill: the card, no pane zone.
  movePaneDrag({ x: rects[0].x + rects[0].width / 2, y: 50 }); assert.equal(currentPaneDrag()!.card, true); assert.equal(currentPaneDrag()!.move, null); assert.equal(currentPaneDrag()!.over, null);
  cancelPaneDrag();
  // Round the pill: the strip lights nothing and the pill glows; the card comes when the pointer reaches the pill.
  startPaneDrag(c, rects, { x: rects[2].x + 60, y: 13 }, PAGE, split); movePaneDrag({ x: mid, y: 400 });
  const far = paneDragPicker(currentPaneDrag())!.reach!;
  movePaneDrag({ x: mid, y: 58 }); const near = paneDragPicker(currentPaneDrag())!;
  assert.equal(near.card, false); assert.equal(currentPaneDrag()!.move, null); assert.equal(currentPaneDrag()!.over, null, 'the strip is the card\'s: no pane zone');
  assert.ok(near.reach! > .8 && far === 0, `the pill lights as the pointer nears it (${far} → ${near.reach})`);
  movePaneDrag({ x: mid, y: pillBottom + 2 }); assert.equal(currentPaneDrag()!.card, true, 'on the pill: the card');
  cancelPaneDrag(); void a;
});

test('R5 pill reach: 0 from 180 px, rising smoothly to 1 on the pill', () => {
  const mid = PAGE.width / 2, bottom = PANE_PILL.top + PANE_PILL.height;
  assert.equal(pillReach({ x: mid, y: bottom + 180 }, PAGE), 0); assert.equal(pillReach({ x: mid, y: bottom + 400 }, PAGE), 0);
  assert.equal(pillReach({ x: mid, y: bottom }, PAGE), 1); assert.equal(pillReach({ x: mid + PANE_PILL.half, y: 20 }, PAGE), 1);
  let last = 0; for (let d = 180; d >= 0; d -= 10) { const r = pillReach({ x: mid, y: bottom + d }, PAGE); assert.ok(r >= last, 'rises as it nears'); last = r; }
  assert.ok(pillReach({ x: mid, y: bottom + 170 }, PAGE) < .02 && pillReach({ x: mid, y: bottom + 10 }, PAGE) > .98, 'eased at both ends');
  assert.equal(pillReach({ x: mid, y: 100 }, null), 0);
});

const _edges: DropEdge[] = ['left']; void _edges;
