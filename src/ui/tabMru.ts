/** Recently-used tab order for the Ctrl+Tab switcher. Activation times live in localStorage so the chrome view (which
 * records them) and the popup overlay view (which shows the switcher) share them; only random tab ids and times are
 * kept, never URLs or titles, and closed tabs are pruned. */
import { groupForTab } from '../runtime/tabGroups';
import type { TabGroup, TabSession } from '../runtime/types';

/** What Ctrl+Tab does (founder, 24 Oct): the next tab in order like Chrome (default), the recently used tab with a
 * switcher while Ctrl is held, or the tab viewer. */
export type CtrlTabMode = 'next' | 'recent' | 'viewer';
const STAMPS = 'acira-tab-mru', MODE = 'acira-ctrl-tab-mode', LEGACY_ORDER = 'acira-tab-switcher-order', OPEN = 'acira-tab-switcher-open', RELEASED = 'acira-tab-switcher-released', LIMIT = 400;

/** A stored choice, or the default. The old 'Ctrl+Tab order' key ('recent' unless set) is never read, so every
 * existing profile moves to the new default. Pure. */
export const ctrlTabModeFrom = (stored: unknown): CtrlTabMode => stored === 'recent' || stored === 'viewer' ? stored : 'next';

type CycleTab = Pick<TabSession, 'id' | 'pinned' | 'group' | 'browserProfileId'>;
/** The tabs Ctrl+Tab walks, in the order they are shown. Top tabs: the strip's order (pinned first, then the model
 * order; tabStripEntries). Sidebar tabs: this profile's pinned tabs, then everything else in tab order with each group
 * at its first tab (AciraSidebar's zones). Tabs in a collapsed group are skipped, like Chrome, unless one is the
 * current tab (which the sidebar keeps visible under the group's header). Pure. */
export function tabCycleOrder(tabs: readonly CycleTab[], groups: readonly TabGroup[], activeId: string, sidebar: boolean): string[] {
  const groupOf = (tab: CycleTab) => groupForTab({ tabGroups: groups as TabGroup[] }, tab);
  const shown = (tab: CycleTab) => tab.id === activeId || !groupOf(tab)?.collapsed;
  if (!sidebar) return [...tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).filter(tab => tab.pinned || shown(tab)).map(tab => tab.id);
  const profileId = tabs.find(tab => tab.id === activeId)?.browserProfileId;
  const own = profileId === undefined ? [...tabs] : tabs.filter(tab => tab.browserProfileId === profileId);
  const pinned = (tab: CycleTab) => !!tab.pinned && !groupOf(tab), rest: CycleTab[] = [], seen = new Set<string>();
  for (const tab of own) {
    if (pinned(tab)) continue;
    const group = groupOf(tab);
    if (!group) { rest.push(tab); continue; }
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    rest.push(...own.filter(item => !pinned(item) && groupOf(item)?.id === group.id && shown(item)));
  }
  return [...own.filter(pinned), ...rest].map(tab => tab.id);
}
/** The tab `direction` steps from the current one in `order`, wrapping; from outside the order, the first or last. */
export function nextInCycle(order: readonly string[], activeId: string, direction: 1 | -1): string | undefined {
  if (!order.length) return undefined;
  const at = order.indexOf(activeId);
  return at < 0 ? order[direction > 0 ? 0 : order.length - 1] : order[(at + direction + order.length) % order.length];
}

/** Current tab first, then by most recent activation, then tabs never activated in strip order. Pure. */
export function mruOrder(tabIds: readonly string[], activeId: string, stamps: Readonly<Record<string, number>>): string[] {
  const position = new Map(tabIds.map((id, index) => [id, index]));
  const rest = tabIds.filter(id => id !== activeId).sort((a, b) => {
    const at = stamps[a] ?? -1, bt = stamps[b] ?? -1;
    return at !== bt ? bt - at : position.get(a)! - position.get(b)!;
  });
  return position.has(activeId) ? [activeId, ...rest] : rest;
}
/** Records an activation; returns the new map (pure core, used by the storage wrapper and tests). */
export function stampActivation(stamps: Readonly<Record<string, number>>, id: string, now: number, keep?: ReadonlySet<string>): Record<string, number> {
  const next: Record<string, number> = { ...stamps, [id]: now };
  const entries = Object.entries(next).filter(([key]) => !keep || keep.has(key)).sort((a, b) => b[1] - a[1]).slice(0, LIMIT);
  return Object.fromEntries(entries);
}
/** Index after `steps` presses of Tab (+1) or Shift+Tab (-1) from the start position, wrapping. */
export function switcherIndex(length: number, start: number, steps: number): number {
  if (length < 1) return 0;
  return ((start + steps) % length + length) % length;
}

const read = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: order falls back to the strip */ } };
export const readStamps = () => read<Record<string, number>>(STAMPS, {});
export function recordActivation(id: string, openIds?: readonly string[]) { write(STAMPS, stampActivation(readStamps(), id, Date.now(), openIds ? new Set(openIds) : undefined)); }
export function readCtrlTabMode(): CtrlTabMode {
  try { localStorage.removeItem(LEGACY_ORDER); } catch { /* nothing to clean up */ }
  return ctrlTabModeFrom(read<unknown>(MODE, null));
}
export const setCtrlTabMode = (mode: CtrlTabMode) => { write(MODE, mode); window.dispatchEvent(new Event(MODE)); };
export function subscribeCtrlTabMode(listener: () => void) { window.addEventListener(MODE, listener); window.addEventListener('storage', listener); return () => { window.removeEventListener(MODE, listener); window.removeEventListener('storage', listener); }; }
/** Handed from the chrome view to the overlay: where the selection starts when the switcher appears. */
export const writeSwitcherStart = (start: number) => write(OPEN, { start, at: Date.now() });
/** When the chrome view last asked for the switcher, and when Control was let go while it was (being) open. The overlay needs a moment to appear; a
 *  release inside that moment is sent before the overlay can hear it, so the chrome view leaves a mark the overlay reads as it mounts (a tap held
 *  about as long as the 120ms before the switcher shows used to leave it open with nothing to wait for). */
export const readSwitcherOpenedAt = () => read<{ at?: number }>(OPEN, {}).at ?? 0;
export const markSwitcherReleased = (now = Date.now()) => write(RELEASED, now);
export const switcherReleasedSince = (openedAt: number, now = Date.now()) => { const at = read<number>(RELEASED, 0); return openedAt > 0 && at >= openedAt && now - at < 5000; };
export const readSwitcherStart = () => { const value = read<{ start?: number; at?: number }>(OPEN, {}); return Date.now() - (value.at ?? 0) < 5000 && Number.isInteger(value.start) ? value.start! : 1; };
