import type { BrowserAction } from '../runtime/types';
import { MAX_PANES, SPLIT_LAYOUTS, evenSizes, insertBeside, minimumSize, moveBeside, paneEdges, paneRects, resolveLinear, sameArrangement, type DropEdge, type SplitLayoutId } from '../runtime/splitLayout';

/** Dropping a tab straight onto a pane of an open split (R4-40), as in VS Code and Windows Snap: the middle of a pane replaces it, an edge opens the tab
 *  beside it (when the split has room and a layout has that shape). Pure geometry over the panes' boxes (coordinates relative to the page area); the store
 *  that feeds it is ui/splitDrop.ts and the highlight is components/SplitPaneZone.tsx. */
export interface PaneBox { tabId: string; x: number; y: number; width: number; height: number }
export type PaneZone =
  | { kind: 'replace'; pane: string }
  | { kind: 'insert'; pane: string; edge: DropEdge; layout: SplitLayoutId; order: string[] }
  /** A pane of the split dragged by its ribbon onto the edge of another one: it moves beside it in the layout that has that shape (the same drop zones as a tab, ui/paneDrag.ts). */
  | { kind: 'move'; pane: string; edge: DropEdge; layout: SplitLayoutId; order: string[] };
/** The edge bands: each side of a pane is a band a quarter of the pane deep (of its width for the side bands, of its height for the top and bottom), never
 *  less than 48px where the pane can spare it; the rest, the middle, swaps. Kept apart from PANE_CENTRE's old meaning: the band depth is the share of the pane. */
export const PANE_EDGE = .25, PANE_EDGE_MIN = 48;
/** @deprecated The band depth (PANE_EDGE); kept for older callers. */
export const PANE_CENTRE = PANE_EDGE;
/** How far (px) the pointer must go into another zone before it takes over from the one that is lit, so a zone never flickers on a boundary, a gap or a corner's diagonal. */
export const PANE_HYSTERESIS = 12;
export type PaneRegion = 'centre' | DropEdge;
/** A pane and the part of it under the pointer. */
export interface PaneHit { pane: string; region: PaneRegion }
type Point = { x: number; y: number };

const depthOf = (length: number) => Math.min(length / 2, Math.max(PANE_EDGE * length, Math.min(PANE_EDGE_MIN, .4 * length)));
/** How deep an edge band of a pane this long is (px). */
export const paneBandDepth = depthOf;
/** The part of a pane as a convex polygon: the middle is a rectangle inset by the band depths, each edge the trapezoid between the pane's side and the middle's
 *  (the corners are cut on the diagonal from the pane's corner to the middle's, so a corner belongs to the nearer edge in proportion to the bands). */
export function regionPolygon(box: PaneBox, region: PaneRegion): Point[] {
  const dx = depthOf(box.width), dy = depthOf(box.height), x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  const a = { x: x0 + dx, y: y0 + dy }, b = { x: x1 - dx, y: y0 + dy }, c = { x: x1 - dx, y: y1 - dy }, d = { x: x0 + dx, y: y1 - dy };
  return region === 'centre' ? [a, b, c, d] : region === 'left' ? [{ x: x0, y: y0 }, a, d, { x: x0, y: y1 }] : region === 'right' ? [{ x: x1, y: y0 }, { x: x1, y: y1 }, c, b]
    : region === 'top' ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, b, a] : [{ x: x0, y: y1 }, d, c, { x: x1, y: y1 }];
}
/** How far a point is from a convex polygon (0 inside or on it). */
export function distanceToPolygon(point: Point, polygon: readonly Point[]): number {
  let inside = true, best = Infinity, sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], ex = q.x - p.x, ey = q.y - p.y, cross = ex * (point.y - p.y) - ey * (point.x - p.x);
    if (Math.abs(cross) > 1e-9) { const s = Math.sign(cross); if (sign === 0) sign = s; else if (s !== sign) inside = false; }
    const len = ex * ex + ey * ey, t = len ? Math.max(0, Math.min(1, ((point.x - p.x) * ex + (point.y - p.y) * ey) / len)) : 0;
    best = Math.min(best, Math.hypot(point.x - (p.x + t * ex), point.y - (p.y + t * ey)));
  }
  return inside ? 0 : best;
}
const REGIONS: readonly PaneRegion[] = ['centre', 'left', 'right', 'top', 'bottom'];
/** The pane's middle, or the edge band the point is in. */
export function regionOf(box: PaneBox, point: Point): PaneRegion {
  for (const region of REGIONS) if (distanceToPolygon(point, regionPolygon(box, region)) === 0) return region;
  // On a shared boundary to the last bit: the nearest edge by the bands' depth.
  const u = (point.x - box.x) / depthOf(box.width), v = (point.y - box.y) / depthOf(box.height), w = (box.x + box.width - point.x) / depthOf(box.width), h = (box.y + box.height - point.y) / depthOf(box.height);
  return ([['left', u], ['right', w], ['top', v], ['bottom', h]] as [DropEdge, number][]).sort((p, q) => p[1] - q[1])[0][0];
}
const inBox = (box: PaneBox, point: Point) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
/** The pane and part under the pointer, with hysteresis: the part that is lit (`previous`) stays until the pointer is more than `hysteresis` px outside it, so
 *  crossing a boundary, the gap between two panes or a corner's diagonal never makes the zone flick back and forth. Null off every pane. */
export function paneRegionAt(panes: readonly PaneBox[], point: Point, previous: PaneHit | null = null, hysteresis = PANE_HYSTERESIS): PaneHit | null {
  const held = previous ? panes.find(item => item.tabId === previous.pane) : undefined;
  if (held && previous && distanceToPolygon(point, regionPolygon(held, previous.region)) <= hysteresis) return previous;
  const box = panes.find(item => inBox(item, point));
  return box ? { pane: box.tabId, region: regionOf(box, point) } : null;
}
const sameHit = (a: PaneHit | null, b: PaneHit | null) => a?.pane === b?.pane && a?.region === b?.region;
export const paneHitKey = (hit: PaneHit | null) => hit ? `${hit.pane}:${hit.region}` : '';
const fitsPage = (layout: SplitLayoutId, page?: { width: number; height: number }) => { if (!page) return true; const need = minimumSize(layout, 6, 320); return need.width <= page.width && need.height <= page.height; };

/** What a tab dropped at `point` would do to the split: null off every pane (or for a tab already in the split). An edge the split cannot take (full, no
 *  layout with that shape, or a result too big for the page) is the pane's middle: replace. With four panes only replace is offered. */
export function paneZoneAt(panes: readonly PaneBox[], split: { layout: SplitLayoutId; tabIds: readonly string[] }, dragged: string, point: { x: number; y: number }, page?: { width: number; height: number }): PaneZone | null {
  if (split.tabIds.includes(dragged)) return null;
  const box = panes.find(item => point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height);
  const index = box ? split.tabIds.indexOf(box.tabId) : -1;
  if (!box || index < 0) return null;
  const region = regionOf(box, point);
  if (region !== 'centre' && split.tabIds.length < MAX_PANES) {
    const result = insertBeside({ layout: split.layout, tabIds: [...split.tabIds] }, index, region, dragged);
    if (result && (!page || (minimumSize(result.layout, 6, 320).width <= page.width && minimumSize(result.layout, 6, 320).height <= page.height))) return { kind: 'insert', pane: box.tabId, edge: region, layout: result.layout, order: result.tabIds };
  }
  return { kind: 'replace', pane: box.tabId };
}

/** What a pane dragged by its ribbon would do on one part of another pane: the middle swaps the two (`replace`), an edge moves it beside that pane (`move`, the
 *  result of `moveBeside`). Null — nothing lights, a release changes nothing — for the pane's own box, an edge that would leave the split exactly as it is, or
 *  a result too big for the page. An edge never stands in for the middle. */
export function paneMoveZoneFor(split: { layout: SplitLayoutId; tabIds: readonly string[] }, dragged: string, hit: PaneHit | null, page?: { width: number; height: number }): PaneZone | null {
  if (!hit || !split.tabIds.includes(dragged) || hit.pane === dragged || !split.tabIds.includes(hit.pane)) return null;
  if (hit.region === 'centre') return { kind: 'replace', pane: hit.pane };
  const result = moveBeside({ layout: split.layout, tabIds: [...split.tabIds] }, dragged, hit.pane, hit.region);
  if (!result || sameArrangement({ layout: split.layout, tabIds: split.tabIds }, result) || !fitsPage(result.layout, page)) return null;
  return { kind: 'move', pane: hit.pane, edge: hit.region, layout: result.layout, order: result.tabIds };
}
/** Dragging a pane of the open split by its ribbon (R3-60, R4-29): the pane and part under the pointer (with hysteresis against `previous`) and what a
 *  release there does. Coordinates are relative to the page area, as in `paneZoneAt`. */
export function paneMoveHit(panes: readonly PaneBox[], split: { layout: SplitLayoutId; tabIds: readonly string[] }, dragged: string, point: Point, page?: { width: number; height: number }, previous: PaneHit | null = null): { hit: PaneHit | null; zone: PaneZone | null } {
  const hit = paneRegionAt(panes, point, previous);
  return { hit: sameHit(hit, previous) ? previous : hit, zone: paneMoveZoneFor(split, dragged, hit, page) };
}
/** The zone at a point, without hysteresis (see paneMoveHit). */
export const paneMoveZoneAt = (panes: readonly PaneBox[], split: { layout: SplitLayoutId; tabIds: readonly string[] }, dragged: string, point: Point, page?: { width: number; height: number }): PaneZone | null => paneMoveHit(panes, split, dragged, point, page).zone;

/** The reducer action a release on a zone produces. A pane moved beside another arranges the split (`split.arrange`: the layout and the order of the same panes). */
export const paneZoneAction = (zone: PaneZone, dragged: string): BrowserAction =>
  zone.kind === 'replace' ? { type: 'split.replace', paneId: zone.pane, tabId: dragged } : zone.kind === 'move' ? { type: 'split.arrange', layout: zone.layout, order: zone.order } : { type: 'split.insert', tabId: dragged, beside: zone.pane, edge: zone.edge };

/** Where the dropped tab's page would sit: the pane itself for a replace, the new pane's cell in the layout the edge gives (even sizes, as the reducer
 *  lays it out) for an insert or a move. A move that keeps the split's layout keeps its sizes too (split.arrange), so the pane lands in the cell of the pane
 *  that holds that slot now (`current`: the split's layout and order). */
export function paneZoneRect(zone: PaneZone, panes: readonly PaneBox[], dragged: string, page: { width: number; height: number }, current?: { layout: SplitLayoutId; tabIds: readonly string[] } | null): { x: number; y: number; width: number; height: number } | null {
  const cell = (id: string | undefined) => { const box = panes.find(item => item.tabId === id); return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null; };
  if (zone.kind === 'replace') return cell(zone.pane);
  if (zone.kind === 'move' && current && current.layout === zone.layout) return cell(current.tabIds[zone.order.indexOf(dragged)]);
  const spec = SPLIT_LAYOUTS[zone.layout], rects = paneRects({ layout: zone.layout, cols: evenSizes(spec.cols), rows: evenSizes(spec.rows) }, { x: 0, y: 0, width: page.width, height: page.height }, 6);
  return rects[zone.order.indexOf(dragged)] ?? null;
}
/** Where every pane of the split sits once it takes `next` (the layout and pane order a release gives: a swap, a move beside a pane, a layout card cell),
 *  exactly as the page lays it out afterwards: the same layout keeps its sizes, so each pane takes the cell of the pane that holds its slot now (`rects`, by
 *  tab id, as measured); a new layout starts with even sizes and is resolved the way the page's CSS places panes (paneEdges, unrounded) inside the area the
 *  panes tile now. The live preview of a pane drag draws its frames at these boxes, so the drop lands on what was shown. Unchanged when it can't stand. */
export function arrangedRects(rects: readonly PaneBox[], current: { layout: SplitLayoutId; tabIds: readonly string[] }, next: { layout: SplitLayoutId; tabIds: readonly string[] }, gap = 6): PaneBox[] {
  const box = (id: string) => rects.find(item => item.tabId === id);
  if (next.tabIds.length !== current.tabIds.length || !current.tabIds.every(id => box(id)) || !next.tabIds.every(id => current.tabIds.includes(id))) return rects.map(item => ({ ...item }));
  if (next.layout === current.layout) return next.tabIds.map((id, index) => ({ ...box(current.tabIds[index])!, tabId: id }));
  const spec = SPLIT_LAYOUTS[next.layout];
  if (!spec || spec.panes !== next.tabIds.length) return rects.map(item => ({ ...item }));
  const x0 = Math.min(...rects.map(item => item.x)), y0 = Math.min(...rects.map(item => item.y)), width = Math.max(...rects.map(item => item.x + item.width)) - x0, height = Math.max(...rects.map(item => item.y + item.height)) - y0;
  const edges = paneEdges({ layout: next.layout, cols: evenSizes(spec.cols), rows: evenSizes(spec.rows) }, gap);
  return next.tabIds.map((id, index) => ({ tabId: id, x: x0 + resolveLinear(edges[index].left, width), y: y0 + resolveLinear(edges[index].top, height), width: resolveLinear(edges[index].width, width), height: resolveLinear(edges[index].height, height) }));
}
/** A stable identity of a zone, to tell when the pointer has moved into another. */
export const paneZoneKey = (zone: PaneZone | null) => zone ? (zone.kind === 'replace' ? `r:${zone.pane}` : `${zone.kind === 'move' ? 'm' : 'i'}:${zone.pane}:${zone.edge}`) : '';
