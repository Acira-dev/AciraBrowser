/** Which tab Ctrl+Tab goes to. Pure, and shared by the interface (the Recent tabs list, the tab viewer) and by main, which does the switch itself (desktop/tab-cycle.cjs): a
 *  Ctrl+Tab must never wait for the interface to draw, so main needs the same order the interface walks (Beta 14, A11). Only random tab ids and times are kept here, never URLs or titles. */
import { groupFolded, groupForTab, groupPinned } from './tabGroups';
import type { BrowserSnapshot, TabGroup, TabSession } from './types';

type CycleTab = Pick<TabSession, 'id' | 'pinned' | 'group' | 'browserProfileId'> & Partial<Pick<TabSession, 'blank'>>;
/** The tabs Ctrl+Tab walks, in the order they are shown. Top tabs: the strip's order (pinned first, then the model
 * order; tabStripEntries). Sidebar tabs: this profile's pinned tabs, then everything else in tab order with each group
 * at its first tab (AciraSidebar's zones). Tabs in a collapsed group are skipped, like Chrome, unless one is the
 * current tab (which the sidebar keeps visible under the group's header). Pure. */
export function tabCycleOrder(tabs: readonly CycleTab[], groups: readonly TabGroup[], activeId: string, sidebar: boolean): string[] {
  const groupOf = (tab: CycleTab) => groupForTab({ tabGroups: groups as TabGroup[] }, tab);
  // a tab is hidden when its group, or any group around it, is folded (Beta 14: groups inside groups)
  const shown = (tab: CycleTab) => tab.id === activeId || !groupFolded({ tabGroups: groups as TabGroup[] }, groupOf(tab));
  if (!sidebar) return [...tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).filter(tab => tab.pinned || shown(tab)).map(tab => tab.id);
  const profileId = tabs.find(tab => tab.id === activeId)?.browserProfileId;
  const own = profileId === undefined ? [...tabs] : tabs.filter(tab => tab.browserProfileId === profileId);
  // The sidebar's order: the pinned area first (loose pinned tabs and the tabs of pinned folders, as they stand), then everything else in tab order, each folder at its first tab.
  const front = (tab: CycleTab) => { const group = groupOf(tab); return group ? groupPinned({ tabGroups: groups as TabGroup[] }, group) : !!tab.pinned; };
  const rest: CycleTab[] = [], seen = new Set<string>();
  for (const part of [own.filter(front), own.filter(tab => !front(tab))]) for (const tab of part) {
    const group = groupOf(tab);
    if (!group) { rest.push(tab); continue; }
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    rest.push(...part.filter(item => !item.pinned && groupOf(item)?.id === group.id && shown(item)));
  }
  return rest.map(tab => tab.id);
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
export const STAMP_LIMIT = 400;
/** Records an activation; returns the new map (pure core, used by the storage wrapper and tests). */
export function stampActivation(stamps: Readonly<Record<string, number>>, id: string, now: number, keep?: ReadonlySet<string>): Record<string, number> {
  const next: Record<string, number> = { ...stamps, [id]: now };
  const entries = Object.entries(next).filter(([key]) => !keep || keep.has(key)).sort((a, b) => b[1] - a[1]).slice(0, STAMP_LIMIT);
  return Object.fromEntries(entries);
}
/** Index after `steps` presses of Tab (+1) or Shift+Tab (-1) from the start position, wrapping. */
export function switcherIndex(length: number, start: number, steps: number): number {
  if (length < 1) return 0;
  return ((start + steps) % length + length) % length;
}

/** Ctrl+Tab's "Next tab" (the default): the tab one step on in the order the list on screen shows, as the interface has always walked it. `state` is the open workspace's view
 *  (scopeToWorkspace). The sidebar walks this profile's tabs that its list shows (`unlisted`: the ids of tabs that live only in their Favorites tile); the top strip walks them all. */
export function nextTabTarget(state: Pick<BrowserSnapshot, 'tabs' | 'tabGroups' | 'activeTabId' | 'settings'>, unlisted: ReadonlySet<string>, direction: number): string | undefined {
  if (state.tabs.length < 2) return undefined;
  const target = nextInCycle(cycleOrder(state, unlisted), state.activeTabId, direction > 0 ? 1 : -1);
  return target && target !== state.activeTabId ? target : undefined;
}
/** The tab ids Ctrl+Tab's Next tab walks, in order: what the viewer shows as its row in that order. In the sidebar layout the rows of the list come first, then the tabs that live
 *  only in their Favorites tile (`unlisted`, in tab order): a Favorite's tab is a tab for the keys, as it is for Ctrl+PageDown and Ctrl+1…9 (favoriteTabs.ts listedTabs), so the
 *  walk reaches it and goes on from it. */
export function cycleOrder(state: Pick<BrowserSnapshot, 'tabs' | 'tabGroups' | 'activeTabId' | 'settings'>, unlisted: ReadonlySet<string>): string[] {
  const sidebar = !!state.settings.verticalTabs, profile = state.tabs.find(tab => tab.id === state.activeTabId)?.browserProfileId;
  // 14.1: the empty page (runtime/emptyPage.ts) is no stop of the walk; from it, Next tab goes to the first tab of the list.
  if (state.tabs.some(tab => tab.blank === true)) state = { ...state, tabs: state.tabs.filter(tab => tab.blank !== true) };
  const own = sidebar ? state.tabs.filter(tab => tab.browserProfileId === profile) : state.tabs;
  const order = tabCycleOrder(sidebar ? own.filter(tab => !unlisted.has(tab.id)) : own, state.tabGroups, state.activeTabId, sidebar);
  return sidebar ? [...order, ...own.filter(tab => unlisted.has(tab.id)).map(tab => tab.id)] : order;
}
/** The tab ids "Recently used" walks: the current tab first, then by most recent use. */
export const recentOrder = (state: Pick<BrowserSnapshot, 'tabs' | 'activeTabId'>, stamps: Readonly<Record<string, number>>): string[] => mruOrder(state.tabs.map(tab => tab.id), state.activeTabId, stamps);
/** "Recently used" with a quick tap (Ctrl let go before the list shows): the tab `steps` places down the most recently used list, never the current one. */
export function recentTabTarget(state: Pick<BrowserSnapshot, 'tabs' | 'activeTabId'>, stamps: Readonly<Record<string, number>>, steps: number): string | undefined {
  if (state.tabs.length < 2) return undefined;
  const order = mruOrder(state.tabs.map(tab => tab.id), state.activeTabId, stamps), target = order[switcherIndex(order.length, 0, steps)];
  return target && target !== state.activeTabId ? target : undefined;
}
