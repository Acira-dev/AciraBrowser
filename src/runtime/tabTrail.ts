import { tabIsPinned } from './pinnedFolders';
import type { BrowserAction, BrowserSnapshot, TabSession } from './types';
import { workspaceIdOf } from './workspaces';

/**
 * Which tab shows when the tab on screen closes (13.10), and where "Unload tab" sends the person when it is the tab on screen.
 *
 * Each window keeps a trail: the tabs it showed before the one on screen, most recent first (`windowUi.tabTrail`; this session only, a
 * restarted window starts with none, so nothing it restored counts as visited). Closing the tab on screen goes to
 *   1. the other pane of its split (splitLayout.ts paneAfterLeaving: decided by the caller),
 *   2. its opener, while no other tab was picked since it opened (`openerId`),
 *   3. the first tab of the trail still open in the SAME workspace and profile (never another workspace's or profile's),
 *   4. else the nearest neighbour, below first, then above: an awake tab before a sleeping one, and a sleeping ordinary tab before a
 *      pinned or Favorite one. A tab that was never loaded this session (not in the trail, asleep) is only ever picked when no awake
 *      tab is left.
 * `soon` names the tabs closing in the same batch (a group, Close others, a split group): none of them is ever picked.
 */
export const TRAIL_LIMIT = 32;

/** A tab that has no page now: it was put to sleep (by the Memory Saver or the person) or restored and never opened. */
const asleep = (tab: TabSession): boolean => tab.sleeping === true;
const resting = (state: Pick<BrowserSnapshot, 'tabGroups'>, tab: TabSession): boolean => tabIsPinned(state, tab) || !!tab.favoriteId;

/** The trail after `previous` became `next`: the tab that was on screen goes to its front, the tab now on screen and every closed tab leave it. */
export function trailAfter(previous: BrowserSnapshot, next: BrowserSnapshot, forget: readonly string[] = []): string[] {
  const open = new Set(next.tabs.map(tab => tab.id)), gone = new Set(forget);
  const was = previous.windowUi.tabTrail ?? [];
  // A tab that went to sleep in this very step was left on purpose: it is not "the tab before".
  const left = next.tabs.find(tab => tab.id === previous.activeTabId), slept = !!left?.sleeping && !previous.tabs.find(tab => tab.id === left.id)?.sleeping;
  const list = previous.activeTabId !== next.activeTabId && !slept ? [previous.activeTabId, ...was] : was;
  const seen = new Set<string>(), kept: string[] = [];
  for (const id of list) {
    if (seen.has(id) || id === next.activeTabId || gone.has(id) || !open.has(id)) continue;
    seen.add(id);
    kept.push(id);
    if (kept.length >= TRAIL_LIMIT) break;
  }
  return kept;
}

/** `next` with its trail brought up to date from `previous` (the same object when nothing changed). */
export function withTrail(previous: BrowserSnapshot, next: BrowserSnapshot, action: BrowserAction): BrowserSnapshot {
  if (next === previous) return next;
  // a tab the person unloaded, or a tab a close left open, is not "the tab before"
  const trail = trailAfter(previous, next, action.type === 'tab.unloaded' ? action.ids : action.type === 'tab.close' ? [action.id] : []);
  const have = next.windowUi.tabTrail ?? [];
  if (trail.length === have.length && trail.every((id, at) => id === have[at])) return next;
  const { tabTrail: _old, ...rest } = next.windowUi;
  return { ...next, windowUi: trail.length ? { ...rest, tabTrail: trail } : rest };
}

/** The tabs a landing may pick for `closed`: its own workspace and profile, none of the batch. */
function neighbours(state: BrowserSnapshot, closed: TabSession, home: string, exclude: ReadonlySet<string>): TabSession[] {
  return state.tabs.filter(tab => !exclude.has(tab.id) && tab.browserProfileId === closed.browserProfileId && workspaceIdOf(state, tab) === home);
}

/** The nearest tab of `mine` to `closed` in the strip order of `order`: below first, then above. */
function nearest(order: readonly string[], closed: string, mine: readonly TabSession[], keep: (tab: TabSession) => boolean): TabSession | undefined {
  const at = order.indexOf(closed);
  const sequence = at < 0 ? order : [...order.slice(at + 1), ...order.slice(0, at).reverse()];
  for (const id of sequence) {
    const tab = mine.find(item => item.id === id);
    if (tab && keep(tab)) return tab;
  }
  return undefined;
}

/**
 * The tab to show after `closed` (the tab that was on screen) is gone. `previous` is the state before the close (its strip order and
 * trail), `next` the state without the tab. Undefined when its workspace has no other tab: the caller makes a new one there.
 */
export function closeLanding(previous: BrowserSnapshot, next: BrowserSnapshot, closed: TabSession, soon: ReadonlySet<string> = new Set()): TabSession | undefined {
  const exclude = new Set([closed.id, ...soon]);
  const mine = neighbours(next, closed, workspaceIdOf(previous, closed), exclude);
  if (!mine.length) return undefined;
  const opener = closed.openerId ? mine.find(tab => tab.id === closed.openerId) : undefined;
  if (opener) return opener;
  for (const id of previous.windowUi.tabTrail ?? []) {
    const tab = mine.find(item => item.id === id);
    if (tab) return tab;
  }
  const order = previous.tabs.map(tab => tab.id);
  return nearest(order, closed.id, mine, tab => !asleep(tab)) ?? nearest(order, closed.id, mine, tab => !resting(previous, tab)) ?? nearest(order, closed.id, mine, () => true);
}

/** Where "Unload tab" on the tab on screen goes first: an AWAKE tab of its workspace (the trail, then the nearest), never one that must load. Undefined: nothing awake to go to. */
export function unloadLanding(state: BrowserSnapshot, tab: TabSession): TabSession | undefined {
  const mine = neighbours(state, tab, workspaceIdOf(state, tab), new Set([tab.id])).filter(item => !asleep(item));
  if (!mine.length) return undefined;
  for (const id of state.windowUi.tabTrail ?? []) {
    const found = mine.find(item => item.id === id);
    if (found) return found;
  }
  return nearest(state.tabs.map(item => item.id), tab.id, mine, () => true);
}
