import { useSyncExternalStore } from 'react';
import type { BrowserAction } from '../runtime/types';
import { mruOrder, readStamps } from './tabMru';
import { markSplitDrop } from './splitDropTarget';
import { MAX_PANES, SPLIT_LAYOUTS, evenSizes, fittingLayouts, paneRects, type SplitLayoutId } from '../runtime/splitLayout';
import { onSplitDropCancelKey } from './splitDropKeys';
import { paneZoneAction, paneZoneAt, paneZoneKey, paneZoneRect, type PaneBox, type PaneZone } from './paneDropZones';

type SplitLayout = SplitLayoutId;
/** The tab order a picker choice produces: the dragged tab takes pane `zone`, the others keep their order around it.
 * A tab already in the split moves; a fifth tab replaces the pane it is dropped on. */
export function splitTabsFor(current: readonly string[], dragged: string, zone: number) {
  const rest = current.filter(id => id !== dragged), next = [...rest];
  if (rest.length >= MAX_PANES) { next[Math.max(0, Math.min(zone, next.length - 1))] = dragged; return next; }
  next.splice(Math.max(0, Math.min(zone, next.length)), 0, dragged); return next;
}
/** How many panes the split will have once `dragged` lands (it moves within a split it is already in). */
export const pickerPaneCount = (current: readonly string[], dragged: string) => Math.min(MAX_PANES, current.filter(id => id !== dragged).length + 1);

/** Tab drag → split view, Windows Snap Layouts style (founder, Round 2). A tab dragged from the strip or the sidebar
 * onto the page arms the picker: a glass card offers layouts while the page stays sharp (two panes:
 * side by side or stacked; three: two on top and one below, one left and two right, three columns; four: two by two).
 * Each layout's cells are drop zones; hovering one previews the result, releasing on it opens that split with the tab
 * in that zone, releasing anywhere else changes nothing. */
export const splitDwellMs = 90;
type Rect = { left: number; top: number; right: number; bottom: number };
export interface SplitZone { layout: SplitLayout; index: number }
/** `lift` moves the card down (or up) from the middle of the page so it is not under the pointer when it appears (R4-41); `pane` is the in-place zone the
 *  pointer is on (R4-40): what a release would do, and the box the dropped page would fill. */
export interface SplitPickerState { tabId: string; zone: SplitZone | null; layouts: SplitLayout[]; current: string[]; width: number; height: number; lift?: number; pane?: { zone: PaneZone; rect: { x: number; y: number; width: number; height: number } } | null; /** False while a pane drag's card is put away (ui/paneDrag.paneCardOut); absent: shown. */ card?: boolean;
  /** A pane drag: how near the pointer is to the "Drag up here for layouts" pill, 0 (180px or more away) to 1 (on it); the pill lights by it. */ reach?: number;
  /** False when another layer draws the result (a pane drag's live frames): the picker shows no preview of its own. */ preview?: boolean }
interface DropContext { visible: readonly string[]; activeId: string; tabIds: readonly string[]; /** The open split's layout (for the in-place pane zones). */ layout?: SplitLayout; onEnterPage?: (visible: readonly string[]) => void }

let context: DropContext = { visible: [], activeId: '', tabIds: [] };
let drag: { tabId: string; armed: boolean; zone: SplitZone | null; lift: number; panes: PaneBox[]; paneZone: PaneZone | null } | null = null, page: DOMRect | null = null, timer: ReturnType<typeof setTimeout> | undefined;
let picker: SplitPickerState | null = null, choice: { tabIds: string[]; layout: SplitLayout } | { action: BrowserAction } | null = null, started = '';
/** Where the dragged tab was last seen, and where it was released on a zone (the morph flies the tab in from there, R3-26). */
let lastPoint: { x: number; y: number } | null = null, dropped: { point: { x: number; y: number }; at: number } | null = null;
/** The release point of the split drop that just happened (viewport coordinates), once; null when there was none lately. */
export function takeDropPoint(now = Date.now()) { const found = dropped && now - dropped.at < 4000 ? dropped.point : null; dropped = null; return found; }
const listeners = new Set<() => void>();
const publish = () => { picker = drag?.armed && page ? { tabId: drag.tabId, zone: drag.zone, layouts: fittingLayouts(pickerPaneCount(currentPanes(drag.tabId), drag.tabId), page), current: currentPanes(drag.tabId), width: page.width, height: page.height, lift: drag.lift, pane: drag.paneZone ? paneBoxFor(drag.paneZone, drag.tabId, drag.panes, page) : null } : null; listeners.forEach(listener => listener()); };
const paneBoxFor = (zone: PaneZone, dragged: string, panes: PaneBox[], area: { width: number; height: number }) => { const rect = paneZoneRect(zone, panes, dragged, area); return rect ? { zone, rect } : null; };

/** What App knows about the window each render: the panes on screen, the current tab and the tab order. */
export function setSplitDropContext(next: DropContext) { context = next; }
/** The open split's layout and pane order as App last reported them (for the pane-ribbon drag's edge zones); null without a split on screen. */
export const splitDropLayout = (): { layout: SplitLayout; tabIds: readonly string[] } | null => context.layout && context.visible.length > 1 ? { layout: context.layout, tabIds: context.visible } : null;
/** Asks the page to take stills of these panes and step the native views aside (the picker and the pane-ribbon drag both need the website sharp while the UI draws above it). */
export function requestSplitStills(ids: readonly string[]) { context.onEnterPage?.(ids); }

/** The panes the dragged tab joins: the split on screen, or the current tab (the last one used when the current tab is
 * the one being dragged). */
function currentPanes(dragged: string, stamps = readStamps()) {
  if (context.visible.length > 1) return [...context.visible];
  const base = context.activeId !== dragged ? context.activeId : mruOrder(context.tabIds, context.activeId, stamps).find(id => id !== dragged);
  return base ? [base] : [];
}

/** Below the strip, anywhere on the page: the picker is for the whole page, not one edge of it. */
export const inSplitZone = (point: { x: number; y: number }, area: Rect) =>
  point.y > area.top + 24 && point.y < area.bottom && point.x >= area.left && point.x <= area.right;

/** The picker card, centred over the page area (R4-41: the pages' bounds, horizontally and vertically; `lift` moves it off the pointer), with one thumbnail per
 * layout and each layout's cells as zones (coordinates relative to the page area). The overlay draws from this, and hit-testing reads it. */
export function pickerGeometry(width: number, height: number, layouts: readonly SplitLayout[], lift = 0) {
  const gap = 12, pad = 14, header = 30, inner = 4;
  // Six layouts make a wide card: on a page too narrow for it the thumbnails shrink to fit (never below 64px).
  const thumbW = Math.max(64, Math.min(layouts.length > 2 ? 108 : 124, Math.floor((width - 32 - pad * 2 - gap * Math.max(0, layouts.length - 1)) / Math.max(1, layouts.length)))), thumbH = Math.round(thumbW * .64);
  const cardW = pad * 2 + layouts.length * thumbW + Math.max(0, layouts.length - 1) * gap, cardH = header + thumbH + pad;
  const card = { x: Math.round((width - cardW) / 2), y: Math.round(Math.max(12, Math.min(height - cardH - 12, (height - cardH) / 2 + lift))), width: cardW, height: cardH };
  const thumbs = layouts.map((layout, i) => {
    const spec = SPLIT_LAYOUTS[layout], x = card.x + pad + i * (thumbW + gap), y = card.y + header;
    const cells = paneRects({ layout, cols: evenSizes(spec.cols), rows: evenSizes(spec.rows) }, { x: x + inner, y: y + inner, width: thumbW - inner * 2, height: thumbH - inner * 2 }, inner).map((rect, index) => ({ index, ...rect }));
    return { layout, x, y, width: thumbW, height: thumbH, cells };
  });
  return { card, thumbs };
}

/** The picker cell under a point (page-area coordinates), as a layout and the pane slot it stands for, or null. A pane drag inside a split (R4-29) hit-tests with this too. */
export function pickerZoneAt(x: number, y: number, width: number, height: number, layouts: readonly SplitLayout[], lift = 0): SplitZone | null {
  for (const thumb of pickerGeometry(width, height, layouts, lift).thumbs) for (const cell of thumb.cells) if (x >= cell.x - 2 && x <= cell.x + cell.width + 2 && y >= cell.y - 2 && y <= cell.y + cell.height + 2) return { layout: thumb.layout, index: cell.index };
  return null;
}
/** Whether a point (page-area coordinates) is anywhere on the picker card: its cells, the gaps between them and its margins. */
export function onPickerCard(x: number, y: number, width: number, height: number, layouts: readonly SplitLayout[], lift = 0): boolean {
  if (!layouts.length) return false;
  const { card } = pickerGeometry(width, height, layouts, lift);
  return x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height;
}
/** How far the card moves from the middle of the page so it is not in the pointer's immediate path when it appears (R4-41): when the pointer is on the card
 *  or within `margin` of it, the card goes to the larger free side of the pointer (above or below it); otherwise it stays centred (0). Page-area coordinates. */
export function cardLift(point: { x: number; y: number } | null, width: number, height: number, layouts: readonly SplitLayout[], margin = 40): number {
  if (!point || !layouts.length) return 0;
  const { card } = pickerGeometry(width, height, layouts);
  if (point.x < card.x - margin || point.x > card.x + card.width + margin || point.y < card.y - margin || point.y > card.y + card.height + margin) return 0;
  const below = point.y + margin, above = point.y - margin - card.height, roomBelow = height - below, roomAbove = point.y - margin;
  const top = Math.max(12, Math.min(height - card.height - 12, roomBelow >= roomAbove ? below : above));
  return top - card.y;
}
/** The boxes of the panes on screen, relative to the page area (for the in-place drop zones). */
function measurePanes(area: DOMRect): PaneBox[] {
  return [...document.querySelectorAll<HTMLElement>('.page-area .split-pages [data-pane]')].map(node => { const r = node.getBoundingClientRect(); return { tabId: node.dataset.pane!, x: r.left - area.left, y: r.top - area.top, width: r.width, height: r.height }; });
}
function offered(tabId: string) { return page ? fittingLayouts(pickerPaneCount(currentPanes(tabId), tabId), page) : []; }
/** What the pointer is on: a picker cell, or (off the card) a pane's in-place zone. */
function hover(point: { x: number; y: number }, tabId: string, lift: number, panes: PaneBox[]) {
  if (!page) return { zone: null as SplitZone | null, paneZone: null as PaneZone | null };
  const x = point.x - page.left, y = point.y - page.top, layouts = offered(tabId), zone = pickerZoneAt(x, y, page.width, page.height, layouts, lift);
  const onCard = Boolean(zone) || onPickerCard(x, y, page.width, page.height, layouts, lift);
  const paneZone = onCard || context.visible.length < 2 || !context.layout ? null : paneZoneAt(panes, { layout: context.layout, tabIds: context.visible }, tabId, { x, y }, { width: page.width, height: page.height });
  return { zone, paneZone };
}

// R3-79: the whole split container (chip, members, the gaps between them) lights up, with a bar where the tab would land.
function markSplitGroups(point:{x:number;y:number}|null,tabId='') { markSplitDrop(document,point,tabId); }

/** The cancel key during a tab drag calls off the split drop (R4-40: the zones, the island and what a release would do) until the drag ends; the tab is still carried. */
let halted = false;
function callOff() { if (drag) { halted = true; clearTimeout(timer); const armed = drag.armed; drag = null; if (armed) publish(); } }

export function moveSplitDrag(tabId: string, point: { x: number; y: number }, enabled = true) {
  if (!enabled) { cancelSplitDrag(); markSplitGroups(point, tabId); return; }
  onSplitDropCancelKey(callOff);
  markSplitGroups(point, tabId); lastPoint = point;
  if (halted) return;
  // The page area can change under a drag (a peeking sidebar hides, a docked one closes): it is measured on every move, not once, or the
  // picker's cells are hit-tested against where the page used to be and a drop on one lands on nothing.
  const area = document.querySelector('.page-area')?.getBoundingClientRect() ?? null;
  const moved = Boolean(page && area && (area.left !== page.left || area.top !== page.top || area.width !== page.width || area.height !== page.height));
  page = area ?? page;
  if (!page || !inSplitZone(point, page)) { if (drag) { const armed = drag.armed; clearTimeout(timer); drag = null; if (armed) publish(); } return; }
  if (drag?.tabId === tabId) {
    if (!drag.armed) return;
    if (moved) { drag = { ...drag, lift: cardLift({ x: point.x - page.left, y: point.y - page.top }, page.width, page.height, offered(tabId)), panes: measurePanes(page) }; publish(); }
    const { zone, paneZone } = hover(point, tabId, drag.lift, drag.panes);
    if (zone?.layout !== drag.zone?.layout || zone?.index !== drag.zone?.index || paneZoneKey(paneZone) !== paneZoneKey(drag.paneZone)) { drag = { ...drag, zone, paneZone }; publish(); }
    return;
  }
  // First time over the page in this drag: App takes sharp stills while native views step aside for pointer capture.
  if (started !== tabId) { started = tabId; context.onEnterPage?.(context.visible.length ? context.visible : [context.activeId]); }
  clearTimeout(timer); drag = { tabId, armed: false, zone: null, lift: 0, panes: [], paneZone: null };
  timer = setTimeout(() => {
    if (drag?.tabId !== tabId || !page) return;
    // The card goes where the pointer is (now) not (R4-41), and the panes are measured once for the in-place zones (R4-40).
    const here = lastPoint ?? point, lift = cardLift({ x: here.x - page.left, y: here.y - page.top }, page.width, page.height, offered(tabId)), panes = measurePanes(page);
    const { zone, paneZone } = hover(here, tabId, lift, panes);
    drag = { tabId, armed: true, zone, lift, panes, paneZone }; publish();
  }, splitDwellMs);
}

/** Ends the drag; truthy when it was released on one of the picker's zones or on a pane's in-place zone (splitDropAction then returns that action). */
export function endSplitDrag(tabId: string) {
  const armed = drag?.tabId === tabId && drag.armed ? drag : null, zone = armed ? armed.zone : null;
  choice = armed?.paneZone ? { action: paneZoneAction(armed.paneZone, tabId) } : zone && pickerPaneCount(currentPanes(tabId), tabId) >= 2 ? { tabIds: splitTabsFor(currentPanes(tabId), tabId, zone.index), layout: zone.layout } : null;
  dropped = choice && lastPoint ? { point: lastPoint, at: Date.now() } : null;
  cancelSplitDrag();
  return choice !== null;
}
export function cancelSplitDrag() { clearTimeout(timer); timer = undefined; page = null; started = ''; halted = false; const armed = drag?.armed; drag = null; markSplitGroups(null); if (armed) publish(); }

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** The tab id whose picker is showing, or null. */
export const useSplitDrop = () => useSyncExternalStore(subscribe, () => picker?.tabId ?? null);
/** The picker on screen: its layouts, the hovered zone and the panes the tab would join. */
export const useSplitPicker = () => useSyncExternalStore(subscribe, () => picker);

/** The split a release opens: the picker's choice when there was one; otherwise (keyboard and older callers) the
 * dragged tab on the right of the current one, or of the last one used when the current tab is the one dragged. */
export function splitDropAction(draggedId: string, activeId: string, tabIds: readonly string[], stamps = readStamps()): BrowserAction | null {
  const picked = choice; choice = null;
  if (picked && 'action' in picked) return picked.action;
  if (picked && picked.tabIds.includes(draggedId) && picked.tabIds.every(id => tabIds.includes(id))) return { type: 'split.open', tabIds: picked.tabIds, layout: picked.layout };
  const left = draggedId !== activeId ? activeId : mruOrder(tabIds, activeId, stamps).find(id => id !== draggedId);
  return left && tabIds.includes(draggedId) ? { type: 'split.open', tabIds: [left, draggedId] } : null;
}
