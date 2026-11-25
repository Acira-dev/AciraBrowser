/** Recently-used tab order for the Ctrl+Tab switcher. Activation times live in localStorage so the chrome view (which
 * records them) and the popup overlay view (which shows the switcher) share them; only random tab ids and times are
 * kept, never URLs or titles, and closed tabs are pruned. */
/** What Ctrl+Tab does (reported 24 Oct): the next tab in order like Chrome (default), the recently used tab with a
 * switcher while Ctrl is held, or the tab viewer. */
export type CtrlTabMode = 'next' | 'recent' | 'viewer';
const STAMPS = 'acira-tab-mru', MODE = 'acira-ctrl-tab-mode', SHOW = 'acira-ctrl-tab-show', LEGACY_ORDER = 'acira-tab-switcher-order', OPEN = 'acira-tab-switcher-open', RELEASED = 'acira-tab-switcher-released';

/** A stored choice, or the default. The old 'Ctrl+Tab order' key ('recent' unless set) is never read, so every
 * existing profile moves to the new default. Pure. */
export const ctrlTabModeFrom = (stored: unknown): CtrlTabMode => stored === 'recent' || stored === 'viewer' ? stored : 'next';

/** What shows while Ctrl is held after a Ctrl+Tab (Beta 14, the team 13 Nov: on by default, "nobody would find it behind a setting"): the viewer with page pictures, the plain list of
 *  names, or nothing at all (Ctrl+Tab just switches). A quick tap shows nothing in any case. The default is this one constant; nobody had a choice before, so every profile gets it. */
export type CtrlTabShow = 'pictures' | 'names' | 'nothing';
export const CTRL_TAB_SHOW_DEFAULT: CtrlTabShow = 'pictures';
export const ctrlTabShowFrom = (stored: unknown): CtrlTabShow => stored === 'pictures' || stored === 'names' || stored === 'nothing' ? stored : CTRL_TAB_SHOW_DEFAULT;

export { mruOrder, nextInCycle, stampActivation, switcherIndex, tabCycleOrder } from '../runtime/tabCycle';
import { STAMP_LIMIT, stampActivation } from '../runtime/tabCycle';

const read = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: order falls back to the strip */ } };
export const readStamps = () => read<Record<string, number>>(STAMPS, {});
export function recordActivation(id: string, openIds?: readonly string[]) { write(STAMPS, stampActivation(readStamps(), id, Date.now(), openIds ? new Set(openIds) : undefined)); }
/** Main keeps the order Ctrl+Tab goes by (desktop/tab-cycle.cjs) and hands its newest times over when it asks for the list, so the list and the step main counted agree even when this
 *  view had not drawn the last switches yet. Only newer times are taken, nothing is ever made older. */
/** The newest activation times, for main (desktop/tab-cycle.cjs keeps the order itself once it has them). */
export const newestStamps = (limit = 120): Record<string, number> => Object.fromEntries(Object.entries(readStamps()).sort((a, b) => b[1] - a[1]).slice(0, limit));
export function adoptStamps(stamps: unknown) {
  if (!stamps || typeof stamps !== 'object') return;
  const next: Record<string, number> = { ...readStamps() };
  for (const [id, at] of Object.entries(stamps as Record<string, unknown>)) if (typeof at === 'number' && Number.isFinite(at) && (next[id] ?? -1) < at) next[id] = at;
  write(STAMPS, Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, STAMP_LIMIT)));
}
export function readCtrlTabMode(): CtrlTabMode {
  try { localStorage.removeItem(LEGACY_ORDER); } catch { /* nothing to clean up */ }
  return ctrlTabModeFrom(read<unknown>(MODE, null));
}
export const setCtrlTabMode = (mode: CtrlTabMode) => { write(MODE, mode); window.dispatchEvent(new Event(MODE)); };
export const readCtrlTabShow = (): CtrlTabShow => ctrlTabShowFrom(read<unknown>(SHOW, null));
export const setCtrlTabShow = (show: CtrlTabShow) => { write(SHOW, show); window.dispatchEvent(new Event(SHOW)); };
/** Either of the two Ctrl+Tab choices changed (here, or in another window through storage). */
export function subscribeCtrlTabMode(listener: () => void) { for (const name of [MODE, SHOW, 'storage']) window.addEventListener(name, listener); return () => { for (const name of [MODE, SHOW, 'storage']) window.removeEventListener(name, listener); }; }
/** Handed from the chrome view to the overlay: where the selection starts when the switcher appears and, when main sends it, the order it walks (main decides the order, so the list and
 *  main's steps are the same tabs whatever this view had drawn). */
export const writeSwitcherStart = (start: number, order?: readonly string[]) => write(OPEN, { start, at: Date.now(), ...(order ? { order: order.slice(0, 400) } : {}) });
export const readSwitcherOrder = (): string[] | null => { const value = read<{ order?: unknown; at?: number }>(OPEN, {}); return Date.now() - (value.at ?? 0) < 5000 && Array.isArray(value.order) ? value.order.filter((id): id is string => typeof id === 'string') : null; };
/** When the chrome view last asked for the switcher, and when Control was let go while it was (being) open. The overlay needs a moment to appear; a
 *  release inside that moment is sent before the overlay can hear it, so the chrome view leaves a mark the overlay reads as it mounts (a tap held
 *  about as long as the 120ms before the switcher shows used to leave it open with nothing to wait for). */
export const readSwitcherOpenedAt = () => read<{ at?: number }>(OPEN, {}).at ?? 0;
export const markSwitcherReleased = (now = Date.now()) => write(RELEASED, now);
export const switcherReleasedSince = (openedAt: number, now = Date.now()) => { const at = read<number>(RELEASED, 0); return openedAt > 0 && at >= openedAt && now - at < 5000; };
export const readSwitcherStart = () => { const value = read<{ start?: number; at?: number }>(OPEN, {}); return Date.now() - (value.at ?? 0) < 5000 && Number.isInteger(value.start) ? value.start! : 1; };
