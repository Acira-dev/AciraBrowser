import { useSyncExternalStore } from 'react';
import type { BrowserAction } from '../runtime/types';
import { arrangeOrder, fittingLayouts, type SplitLayoutId } from '../runtime/splitLayout';
import { onPickerCard, pickerGeometry, pickerZoneAt, type SplitPickerState, type SplitZone } from './splitDrop';
import { PANE_HYSTERESIS, arrangedRects, paneBandDepth, paneHitKey, paneMoveHit, paneZoneAction, paneZoneKey, type PaneHit, type PaneZone } from './paneDropZones';

/** Rearranging a split by its pane ribbons (R3-60). Press a pane's title ribbon and drag: every pane becomes a glass drop
 *  zone, the zone under the pointer lights, and releasing on it swaps the two panes (the split's layout and sizes stay; the
 *  tabs trade cells). Releasing anywhere else changes nothing. R4-29: the Snap picker comes up with the drag too, listing every
 *  layout the split can take; a release on one of its cells rearranges the split (new layout, the pane in that slot), a release
 *  anywhere else is the swap above. Pure geometry and one small store; the DOM sits in
 *  SplitRibbon (the pointer) and SplitPaneDragLayer (the zones). Coordinates are relative to the page area.
 *  Follow-up: a pane dragged over another uses the same in-place zones a dragged tab does (ui/paneDropZones.ts): the middle swaps the two panes, an edge moves the
 *  dragged pane beside that one in the layout with that shape (split.arrange). Esc calls the whole drag off.
 *  R5 (founder 27 Oct, "show how they'd align"): the zones are no longer lit boxes with a label. While the pointer is on a zone every pane's frame glides to
 *  the box the release would give it (`panePreviewRects`, the same geometry the page lays out afterwards), the dragged pane's frame landing where it will sit;
 *  off every zone the frames glide back; the release commits exactly what is shown. */
export interface PaneRect { tabId: string; x: number; y: number; width: number; height: number }
export interface PaneDragState {
  tabId: string; /** The pane a release would swap places with (the middle of a pane). */ over: string | null; rects: PaneRect[]; point: { x: number; y: number };
  /** The split being rearranged (its layout and pane order), for the edge zones; without it only the swap exists. */ split: { layout: SplitLayoutId; tabIds: string[] } | null;
  /** The edge zone under the pointer: the dragged pane would move beside that pane in this layout (a release arranges the split). */ move: Extract<PaneZone, { kind: 'move' }> | null;
  /** 'drop': released on a zone; the frames hold the result while the pages are laid out under them. 'back': called off (Esc) with the frames
   *  out of place; they glide back before the pages return. */ phase: 'drag' | 'drop' | 'back';
  /** The page area's size, and the layouts this many panes can take (none without the size: no picker). */ page: { width: number; height: number } | null; layouts: SplitLayoutId[];
  /** The picker cell under the pointer: the layout and the slot the dragged pane would take. */ zone: SplitZone | null;
  /** The pointer is on the picker card, cell or not: no pane is a swap target there. */ onCard: boolean;
  /** How far the card sits off the middle of the page: a pane drag docks it at the top of the page (PANE_CARD_LIFT). */ lift: number;
  /** The pane and part under the pointer (held with hysteresis, ui/paneDropZones.paneRegionAt). */ hit?: PaneHit | null;
  /** The layout card is out: brought down by dragging up into the band at the top of the page (or past it), put away by moving back down onto the panes.
   *  While it is away the panes are drop zones edge to edge and nothing covers them. */ card?: boolean;
  /** The pointer has been below the summon band since the drag began (a drag that starts on a top-row ribbon starts inside the band and must not summon the card at once). */ armed?: boolean;
}

/** How far the pointer must travel from the press before a click on a ribbon becomes a drag. */
export const PANE_DRAG_THRESHOLD = 5;
/** Whether a pointer that moved by (dx, dy) since the press has turned the press into a drag. */
export const pastDragThreshold = (dx: number, dy: number, threshold = PANE_DRAG_THRESHOLD) => Math.hypot(dx, dy) >= threshold;
/** The layouts a split of `count` panes can take in a page area this size: every layout for that count whose smallest size fits (all of them when none would). */
export const arrangeLayouts = (count: number, width: number, height?: number): SplitLayoutId[] => fittingLayouts(count, { width, height });
/** The gap between panes (features/split SPLIT_GAP). */
export const PANE_GAP = 6;
/** The picker's view of a pane drag (null when it has none), for the SplitPicker component. The card itself shows only while it is out (`card`); the
 *  result of a cell is drawn by the pane frames (SplitPaneDragLayer), so the picker shows no preview of its own. */
export function paneDragPicker(drag: PaneDragState | null): SplitPickerState | null {
  return drag && drag.phase === 'drag' && drag.page && drag.layouts.length ? { tabId: drag.tabId, zone: drag.zone, layouts: drag.layouts, current: drag.rects.map(rect => rect.tabId), width: drag.page.width, height: drag.page.height, lift: drag.lift, pane: null, card: drag.card !== false, reach: drag.armed ? pillReach(drag.point, drag.page) : 0, preview: false } : null;
}
/** A pane drag docks the layout card at the top of the page (pickerGeometry clamps it 12px below the top edge). */
export const PANE_CARD_LIFT = -1e5;
/** How far below the docked card the pointer goes before the card is put away again. */
export const PANE_CARD_MARGIN = 24;
/** The summon band (founder 27 Oct: "the person shouldn't have to touch the toolbar"): a strip at the top of the page area, 8% of its height kept between
 *  64 and 96 px, that brings the layout card down when a drag rises into it. Precedence, top to bottom:
 *  - above the page (the toolbar): the card, as before;
 *  - inside the strip, once the drag has been below it (`armed`): the card's strip — no pane zone lights there. Round the pill (PANE_PILL.pocket either side
 *    of the middle) the card waits until the carried chip reaches the pill (the liquid joins them first), elsewhere in the strip it comes at once;
 *  - below the strip: the pane zones, unchanged. The strip never takes a top-row pane's whole top band: it stops at least PANE_SUMMON_KEEP px above the
 *    band's lower edge (never shallower than PANE_SUMMON_FLOOR), so moving a pane onto the top edge of a top-row pane still works just below the strip. */
export const PANE_SUMMON_SHARE = .08, PANE_SUMMON_MIN = 64, PANE_SUMMON_MAX = 96, PANE_SUMMON_FLOOR = 40, PANE_SUMMON_KEEP = 24;
/** The "Drag up here for layouts" pill (split-picker.css .split-picker-dock-hint): centred, `top` px below the page's top, `height` tall, about `half` px
 *  either side of the middle. It lights as the pointer comes within `reach` px; the card waits for the chip within `pocket` px of the middle. */
export const PANE_PILL = { top: 10, height: 26, half: 90, pocket: 140, reach: 180 };
/** How deep the summon band is for this page and these panes (page-area coordinates). */
export function paneSummonBand(page: { width: number; height: number } | null, rects: readonly PaneRect[]): number {
  if (!page) return 0;
  let band = Math.max(PANE_SUMMON_MIN, Math.min(PANE_SUMMON_MAX, Math.round(page.height * PANE_SUMMON_SHARE)));
  const top = rects.length ? Math.min(...rects.map(rect => rect.y)) : 0;
  for (const rect of rects) if (rect.y - top <= 2) band = Math.min(band, Math.floor(rect.y + paneBandDepth(rect.height) - PANE_SUMMON_KEEP));
  return Math.max(PANE_SUMMON_FLOOR, band);
}
/** How lit the pill is for a pointer at `point`: 0 from PANE_PILL.reach px away, rising smoothly (smoothstep) to 1 on the pill. */
export function pillReach(point: { x: number; y: number }, page: { width: number; height: number } | null): number {
  if (!page) return 0;
  const dx = Math.max(0, Math.abs(point.x - page.width / 2) - PANE_PILL.half), dy = Math.max(0, point.y - (PANE_PILL.top + PANE_PILL.height)), t = Math.max(0, Math.min(1, 1 - Math.hypot(dx, dy) / PANE_PILL.reach));
  return t * t * (3 - 2 * t);
}
/** Whether the layout card is out after a move to `point` (page-area coordinates). Past the top of the page always brings it down; an armed drag in the
 *  summon band (`band`, paneSummonBand) brings it down too, round the pill only once the pointer reaches the pill. It stays while the pointer is above its
 *  bottom edge (plus a margin, and never less than the band plus the hysteresis, so it can't flicker); moving further down puts it away. */
export function paneCardOut(wasOut: boolean, point: { x: number; y: number }, page: { width: number; height: number } | null, layouts: readonly SplitLayoutId[], armed = false, band = 0): boolean {
  if (!page || !layouts.length) return false;
  if (point.y < 0) return true;
  if (!wasOut) return armed && point.y < band && (Math.abs(point.x - page.width / 2) > PANE_PILL.pocket || point.y <= PANE_PILL.top + PANE_PILL.height + 6);
  const { card } = pickerGeometry(page.width, page.height, layouts, PANE_CARD_LIFT);
  return point.y <= Math.max(card.y + card.height + PANE_CARD_MARGIN, band + PANE_HYSTERESIS);
}
/** How long the frames take to settle into their new boxes (at Fast; the ribbon scales it by the speed setting). */
export const PANE_DROP_MS = 300;
/** How long a release holds the frames once they have settled, while the pages are laid out under them. */
export const PANE_DROP_HOLD = 90;

/** The pane under a point, or null over a gap or outside every pane. */
export function paneAt(rects: readonly PaneRect[], point: { x: number; y: number }): string | null {
  return rects.find(rect => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height)?.tabId ?? null;
}
/** Where each pane sits once `a` and `b` trade cells: each tab takes the other's rectangle. */
export function swappedRects(rects: readonly PaneRect[], a: string, b: string): PaneRect[] {
  const ra = rects.find(rect => rect.tabId === a), rb = rects.find(rect => rect.tabId === b);
  if (!ra || !rb) return [...rects];
  return rects.map(rect => rect.tabId === a ? { ...rb, tabId: a } : rect.tabId === b ? { ...ra, tabId: b } : rect);
}
/** The reducer action a release produces: on a picker cell, arrange the split (that layout, the dragged pane in that slot); on another pane, swap the two. */
export function paneDropAction(drag: Pick<PaneDragState, 'tabId' | 'over'> & Partial<Pick<PaneDragState, 'zone' | 'rects' | 'move'>>): BrowserAction | null {
  if (drag.zone && drag.rects) { const order = arrangeOrder(drag.rects.map(rect => rect.tabId), drag.tabId, drag.zone.index); return order ? { type: 'split.arrange', layout: drag.zone.layout, order } : null; }
  if (drag.move) return paneZoneAction(drag.move, drag.tabId);
  return drag.over && drag.over !== drag.tabId ? { type: 'split.swap', a: drag.tabId, b: drag.over } : null;
}
/** The split a release would leave (its layout and pane order), or null when a release changes nothing: a picker cell, an edge move or a swap. */
export function paneDropArrangement(drag: Pick<PaneDragState, 'tabId' | 'over' | 'rects' | 'split' | 'zone' | 'move'>): { layout: SplitLayoutId; tabIds: string[] } | null {
  if (drag.zone) { const order = arrangeOrder(drag.rects.map(rect => rect.tabId), drag.tabId, drag.zone.index); return order ? { layout: drag.zone.layout, tabIds: order } : null; }
  if (drag.move) return { layout: drag.move.layout, tabIds: [...drag.move.order] };
  if (!drag.over || drag.over === drag.tabId || !drag.split) return null;
  const tabIds = [...drag.split.tabIds], a = tabIds.indexOf(drag.tabId), b = tabIds.indexOf(drag.over);
  if (a < 0 || b < 0) return null;
  [tabIds[a], tabIds[b]] = [tabIds[b], tabIds[a]];
  return { layout: drag.split.layout, tabIds };
}
/** The live preview: where every pane's frame sits right now — the boxes the release would give (the page's own geometry, ui/paneDropZones.arrangedRects),
 *  or each pane's own box when the pointer is on no zone or the drag was called off. */
export function panePreviewRects(drag: Pick<PaneDragState, 'tabId' | 'over' | 'rects' | 'split' | 'zone' | 'move' | 'phase'>): PaneRect[] {
  if (drag.phase === 'back') return drag.rects.map(rect => ({ ...rect }));
  const next = paneDropArrangement(drag);
  if (!next) return !drag.split && !drag.zone && drag.over && drag.over !== drag.tabId ? swappedRects(drag.rects, drag.tabId, drag.over) : drag.rects.map(rect => ({ ...rect }));
  return arrangedRects(drag.rects, drag.split ?? { layout: '' as SplitLayoutId, tabIds: drag.rects.map(rect => rect.tabId) }, next, PANE_GAP);
}
/** A stable identity of the arrangement the frames show ('' for none: every pane in its own box). */
export function panePreviewKey(drag: Pick<PaneDragState, 'tabId' | 'over' | 'rects' | 'split' | 'zone' | 'move' | 'phase'> | null): string {
  if (!drag || drag.phase === 'back') return '';
  const next = paneDropArrangement(drag);
  return next ? `${next.layout}:${next.tabIds.join(',')}` : !drag.split && drag.over && drag.over !== drag.tabId ? `swap:${drag.over}` : '';
}

let state: PaneDragState | null = null, timer: ReturnType<typeof setTimeout> | undefined, flowKey = '', flowAt = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const listeners = new Set<() => void>();
/** QA: when the page holds an array at `__aciraPaneDragProbe`, every decision is logged into it (the point, the part under it, what a release would do). */
const probe = (next: PaneDragState | null) => {
  const sink = (globalThis as { __aciraPaneDragProbe?: unknown }).__aciraPaneDragProbe;
  if (!Array.isArray(sink) || sink.length > 4000) return;
  sink.push(next ? { x: Math.round(next.point.x), y: Math.round(next.point.y), hit: paneHitKey(next.hit ?? null), key: next.zone ? `card:${next.zone.layout}:${next.zone.index}` : next.move ? paneZoneKey(next.move) : next.over ? `r:${next.over}` : '', layout: next.move?.layout ?? null, order: next.move?.order ?? null, over: next.over, card: next.card === true, armed: next.armed === true, preview: panePreviewKey(next), phase: next.phase, t: Math.round(now()) } : { end: true, t: Math.round(now()) });
};
const publish = (next: PaneDragState | null) => {
  const key = panePreviewKey(next); if (key !== flowKey) { flowKey = key; flowAt = now(); }
  state = next; probe(next); listeners.forEach(listener => listener());
};

/** What the pointer is on: a picker cell (the slot it would take) or the card while the card is out, else a pane (its middle swaps, an edge moves the dragged
 *  pane beside it; the part under the pointer is held with hysteresis). The card, while out, covers only itself and the toolbar above the page; the summon
 *  strip at the top of the page (paneSummonBand) is the card's once the drag is armed, so no pane zone lights there (see the precedence above). */
function target(drag: Pick<PaneDragState, 'tabId' | 'rects' | 'page' | 'layouts' | 'lift' | 'split' | 'hit' | 'card' | 'armed'>, point: { x: number; y: number }) {
  const band = paneSummonBand(drag.page, drag.rects), armed = drag.armed === true || point.y > band + PANE_HYSTERESIS;
  const card = paneCardOut(drag.card === true, point, drag.page, drag.layouts, armed, band);
  const zone = card && drag.page ? pickerZoneAt(point.x, point.y, drag.page.width, drag.page.height, drag.layouts, drag.lift) : null;
  const onCard = card && (Boolean(zone) || point.y < 0 || Boolean(drag.page && onPickerCard(point.x, point.y, drag.page.width, drag.page.height, drag.layouts, drag.lift)));
  const strip = armed && Boolean(drag.page?.height && drag.layouts.length) && point.y >= 0 && point.y < band;
  // Without the split (older callers) a pane is simply a swap target.
  if (!drag.split) return { zone, onCard, card, armed, hit: null, over: onCard || strip ? null : paneAt(drag.rects, point), move: null };
  if (onCard || strip) return { zone, onCard, card, armed, hit: null, over: null, move: null };
  const { hit, zone: pane } = paneMoveHit(drag.rects, drag.split, drag.tabId, point, drag.page ?? undefined, drag.hit ?? null);
  return { zone, onCard, card, armed, hit, over: pane?.kind === 'replace' ? pane.pane : null, move: pane?.kind === 'move' ? pane : null };
}

/** Starts a pane drag. With the page area's size the layout card can be brought down (drag up into the top of the page) for the layouts this many panes can take. */
export function startPaneDrag(tabId: string, rects: PaneRect[], point: { x: number; y: number }, page: { width: number; height: number } | null = null, split: { layout: SplitLayoutId; tabIds: readonly string[] } | null = null) {
  clearTimeout(timer);
  const layouts = page && rects.length >= 2 ? arrangeLayouts(rects.length, page.width, page.height) : [], base = { tabId, rects, page, layouts, lift: PANE_CARD_LIFT, split: split ? { layout: split.layout, tabIds: [...split.tabIds] } : null, hit: null, card: false, armed: false };
  publish({ point, phase: 'drag', ...base, ...target(base, point) });
}
export function movePaneDrag(point: { x: number; y: number }) {
  if (state?.phase !== 'drag') return;
  publish({ ...state, point, ...target(state, point) });
}
/** Ends the drag. Returns the rearrangement or swap to dispatch, or null when it landed nowhere. With `settleMs` the frames hold what they show (phase
 *  'drop') while the pages are laid out under them: until the last glide has had `settleMs` to land, and PANE_DROP_HOLD at least; then the drag clears. */
export function endPaneDrag(settleMs = PANE_DROP_MS): BrowserAction | null {
  if (state?.phase !== 'drag') return null;
  const action = paneDropAction(state);
  if (!action) { cancelPaneDrag(settleMs); return null; }
  if (settleMs <= 0) { publish(null); return action; }
  publish({ ...state, phase: 'drop' }); clearTimeout(timer); timer = setTimeout(() => publish(null), Math.max(PANE_DROP_HOLD, settleMs - (now() - flowAt)));
  return action;
}
/** Calls the drag off (Esc). With `settleMs`, frames that are out of place (or still gliding) glide back first (phase 'back'), then the drag clears. */
export function cancelPaneDrag(settleMs = 0) {
  clearTimeout(timer);
  if (!state) return;
  if (settleMs > 0 && state.phase === 'drag' && (panePreviewKey(state) !== '' || now() - flowAt < settleMs)) {
    publish({ ...state, phase: 'back' }); timer = setTimeout(() => publish(null), Math.max(PANE_DROP_HOLD, settleMs)); return;
  }
  publish(null);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** The pane drag right now, or null (outside React). */
export const currentPaneDrag = () => state;
/** The pane drag on screen, or null. */
export const usePaneDrag = () => useSyncExternalStore(subscribe, () => state);
