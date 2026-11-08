import { useSyncExternalStore } from 'react';

/**
 * The Link preview marker (item 17). While a Link preview (Peek) is open from a tab or a favorite tile, a small page card with the
 * preview site's icon slides out beside that source's icon in the sidebar; when the preview closes the card slides back. This file
 * holds what the sidebar needs to draw it: which tab the open preview came from, the page's icon, whether it is still loading, and
 * the preview that just closed (kept a moment so the card has something to slide back with).
 *
 * Main sends `peek-state` on every change (desktop/rewind/peek.cjs, `publish`): `peek` is null while none is open. A preview closes
 * as soon as its tab stops being the active one, so the marker only ever shows on the current tile or row.
 */
export interface PeekMarker { sourceTabId: string; url: string; favicon: string; loading: boolean }
export interface PeekMarkerState { open: PeekMarker | null; leaving: PeekMarker | null }

/** How long a closed preview's card stays mounted: a little over its slide back (172 ms base, 220 ms in Premium). */
export const PEEK_MARKER_LEAVE_MS = 320;
const MAX_ICON = 65536;

/** What a `peek-state` event says: undefined when `raw` is not one, null for "no preview open", else the preview. Pure. */
export function peekMarkerFromEvent(raw: unknown): PeekMarker | null | undefined {
  if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'peek-state') return undefined;
  return peekMarkerFromState((raw as { peek?: unknown }).peek);
}
/** The same for the `{ peek }` main answers a `peek.state` request with. Pure. */
export function peekMarkerFromState(peek: unknown): PeekMarker | null {
  if (!peek || typeof peek !== 'object') return null;
  const p = peek as { sourceTabId?: unknown; url?: unknown; favicon?: unknown; loading?: unknown };
  if (typeof p.sourceTabId !== 'string' || !p.sourceTabId || p.sourceTabId.length > 200) return null;
  const url = typeof p.url === 'string' && p.url.length <= 4096 ? p.url : '';
  const favicon = typeof p.favicon === 'string' && p.favicon.length <= MAX_ICON && /^(https?:|data:image\/)/i.test(p.favicon) ? p.favicon : '';
  return { sourceTabId: p.sourceTabId, url, favicon, loading: p.loading === true };
}

/** The state after a preview opens, changes or closes (`next` null). Pure: the clock that ends `leaving` is the store's. */
export function peekMarkerReduce(state: PeekMarkerState, next: PeekMarker | null): PeekMarkerState {
  if (!next) return state.open ? { open: null, leaving: state.open } : state;
  const replaced = state.open && state.open.sourceTabId !== next.sourceTabId ? state.open : null;
  const leaving = replaced ?? (state.leaving?.sourceTabId === next.sourceTabId ? null : state.leaving);
  const same = state.open && state.open.sourceTabId === next.sourceTabId && state.open.url === next.url && state.open.favicon === next.favicon && state.open.loading === next.loading;
  return same && leaving === state.leaving ? state : { open: next, leaving };
}

/** What a tab's row or a favorite's tile draws: the card, open (sliding out) or leaving (sliding back), or nothing. Pure. */
export function peekMarkerFor(state: PeekMarkerState, tabId: string | undefined): { open: boolean; marker: PeekMarker } | null {
  if (!tabId) return null;
  if (state.open?.sourceTabId === tabId) return { open: true, marker: state.open };
  if (state.leaving?.sourceTabId === tabId) return { open: false, marker: state.leaving };
  return null;
}

let state: PeekMarkerState = { open: null, leaving: null };
const listeners = new Set<() => void>();
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
let stop: (() => void) | undefined;
const emit = () => { for (const listener of [...listeners]) listener(); };

/** Apply one preview change (null: closed) and, when a card is left sliding back, end it after PEEK_MARKER_LEAVE_MS. */
export function notePeekMarker(next: PeekMarker | null): void {
  const after = peekMarkerReduce(state, next);
  if (after === state) return;
  const leavingChanged = after.leaving !== state.leaving;
  state = after;
  if (leavingChanged) {
    clearTimeout(leaveTimer);
    if (state.leaving) { const gone = state.leaving; leaveTimer = setTimeout(() => { if (state.leaving === gone) { state = { ...state, leaving: null }; emit(); } }, PEEK_MARKER_LEAVE_MS); }
  }
  emit();
}
/** Test hook: back to nothing open. */
export function resetPeekMarker(): void { clearTimeout(leaveTimer); state = { open: null, leaving: null }; emit(); }
export const peekMarkerSnapshot = (): PeekMarkerState => state;

type Bridge = { subscribeBrowser?: (listener: (event: unknown) => void) => () => void; peek?: (request: { type: 'peek.state' }) => Promise<{ peek?: unknown } | undefined> };
/** Listen to main while anything draws a marker; ask once for a preview that is already open (a window that reloaded its interface). */
function start(): void {
  if (stop || typeof window === 'undefined') return;
  const bridge = (window as unknown as { acira?: Bridge }).acira;
  if (!bridge?.subscribeBrowser) return;
  const off = bridge.subscribeBrowser(event => { const next = peekMarkerFromEvent(event); if (next !== undefined) notePeekMarker(next); });
  let alive = true;
  void bridge.peek?.({ type: 'peek.state' }).then(answer => { if (alive && answer && !state.open) { const open = peekMarkerFromState(answer.peek); if (open) notePeekMarker(open); } }).catch(() => {});
  stop = () => { alive = false; off(); stop = undefined; };
}
export function subscribePeekMarker(listener: () => void): () => void {
  listeners.add(listener); start();
  return () => { listeners.delete(listener); if (!listeners.size) stop?.(); };
}
/** The open and the leaving preview, as the sidebar's tiles and rows read them. */
export function usePeekMarkerState(): PeekMarkerState { return useSyncExternalStore(subscribePeekMarker, peekMarkerSnapshot, peekMarkerSnapshot); }
