import type { BrowserSnapshot, TabSession, TaskManagerReading, Workspace } from '../../runtime/types';
import { tabDisplayTitle } from '../../runtime/tabTitle';
import { windowWorkspaces, workspaceIdOf } from '../../runtime/workspaces';
import { sleepableTabs } from '../../runtime/tabSleepMenu';
import { tabIsPinned } from '../../runtime/pinnedFolders';

/** The Task manager's view (desktop/task-manager.cjs reads the processes; this decides what the pop-up shows). Pure.
 *  Sections: the window's tabs by workspace (one "Tabs" section when it has no workspaces to tell apart), the extensions, Acira itself.
 *  Honest figures: tabs that share one process show its figure ONCE, on the first of them; the others say they are counted with it.
 *  A sleeping tab, a tab not loaded yet and a page of Acira's own have no figure. */
export type OwnId = TaskManagerReading['own'][number]['id'];
/** What a tab's second line says, in the order they win. */
export type TabState = 'screen' | 'problem' | 'sleeping' | 'playing' | 'pinned' | 'background' | 'acira';
export interface TabRow { key: string; kind: 'tab'; id: string; tab: TabSession; state: TabState; /** how long since it was the front tab, when known */ idleMs: number | null; /** null: no figure of its own */ memoryKB: number | null; cpu: number | null; /** the tab whose row carries this one's figure (they share it) */ sharedWith: TabSession | null; /** this row's figure also covers this many other tabs */ sharing: number }
export interface ExtensionRow { key: string; kind: 'extension'; id: string; name: string; memoryKB: number; cpu: number | null }
export type TaskRow = TabRow | ExtensionRow;
export interface TaskSection { key: string; kind: 'workspace' | 'tabs' | 'extensions'; workspace?: Workspace; memoryKB: number; rows: TaskRow[] }
export interface TaskView {
  sections: TaskSection[];
  /** Acira itself: one row, its parts only when asked. */
  own: { memoryKB: number; cpu: number | null; parts: { id: OwnId; memoryKB: number; cpu: number | null }[] };
  totals: { all: number; tabs: number; extensions: number; own: number };
  /** The heaviest row's figure: the meters are drawn against it. */
  peakKB: number;
  /** The one action at the foot: the background tabs that can be unloaded now, and what that frees (a shared figure counts only when every tab that shares it goes). */
  sweep: { tabIds: string[]; memoryKB: number };
}
export type TaskState = Pick<BrowserSnapshot, 'tabs' | 'workspaces' | 'activeWorkspaceId' | 'activeBrowserProfileId' | 'activeTabId' | 'windowUi' | 'browserProfiles'> & Partial<Pick<BrowserSnapshot, 'otherWorkspaceTabs' | 'settings' | 'tabGroups'>>;
/** Pinned as every pinned rule asks it: the tab's own flag, or a tab standing in a pinned folder. */
export const pinnedTab = (state: TaskState, tab: TabSession): boolean => { try { return tabIsPinned(state as never, tab); } catch { return !!tab.pinned; } };

/** Every tab of this profile in the window: the open workspace's and the other workspaces' (the interface's state is scoped to the open one). */
export const windowTabs = (state: Pick<BrowserSnapshot, 'tabs'> & Partial<Pick<BrowserSnapshot, 'otherWorkspaceTabs'>>): TabSession[] => {
  const seen = new Set<string>(), list: TabSession[] = [];
  for (const tab of [...state.tabs, ...(state.otherWorkspaceTabs ?? [])]) if (!seen.has(tab.id)) { seen.add(tab.id); list.push(tab); }
  return list;
};
const isWeb = (tab: TabSession) => tab.contentKind === 'web' && tab.url !== 'acira://new';
function stateOf(tab: TabSession, onScreen: boolean, awake: boolean, pinned: boolean): TabState {
  if (!isWeb(tab)) return onScreen ? 'screen' : 'acira';
  if (onScreen) return 'screen';
  if (tab.error) return 'problem';
  if (tab.sleeping || !awake) return 'sleeping';
  if (tab.media === 'playing' || (tab.audible && !tab.muted)) return 'playing';
  if (pinned) return 'pinned';
  return 'background';
}
const byWeight = (a: { memoryKB: number | null; order: number }, b: { memoryKB: number | null; order: number }) => (b.memoryKB ?? -1) - (a.memoryKB ?? -1) || a.order - b.order;

export function taskView(state: TaskState, reading: TaskManagerReading | null, now: number = Date.now()): TaskView {
  const tabs = windowTabs(state), index = new Map(tabs.map((tab, at) => [tab.id, at]));
  const visible = new Set<string>([state.activeTabId, ...(state.windowUi?.split?.tabIds ?? [])]);
  // Which process figure each tab belongs to, and the first tab of each (it carries the figure).
  const figure = new Map<string, { memoryKB: number; cpu: number | null; first: string; ids: string[] }>();
  let unlisted = 0;
  for (const item of reading?.tabs ?? []) {
    const ids = item.tabIds.filter(id => index.has(id)).sort((a, b) => index.get(a)! - index.get(b)!);
    // A process none of whose tabs this window's profile lists (another profile's space, a tab closed a moment ago): counted under Acira's other pages.
    if (!ids.length) { unlisted += item.memoryKB; continue; }
    const shared = { memoryKB: item.memoryKB, cpu: item.cpu, first: ids[0], ids };
    ids.forEach(id => figure.set(id, shared));
  }
  const rowOf = (tab: TabSession): TabRow => {
    // A tab that has just been unloaded is asleep at once: the reading (up to 2 s old) may still list its page, but the row no longer shows that figure.
    const own = tab.sleeping ? undefined : figure.get(tab.id), leads = !!own && own.first === tab.id;
    return { key: `tab:${tab.id}`, kind: 'tab', id: tab.id, tab, state: stateOf(tab, visible.has(tab.id), !!own || !reading, pinnedTab(state, tab)), idleMs: typeof tab.usedAt === 'number' && tab.usedAt > 0 && now >= tab.usedAt ? now - tab.usedAt : null, memoryKB: own && leads && own.memoryKB > 0 ? own.memoryKB : null, cpu: own && leads ? own.cpu : null, sharedWith: own && !leads ? tabs[index.get(own.first)!] : null, sharing: own && leads ? own.ids.length - 1 : 0 };
  };
  // Order inside a section: by memory, heaviest first; a tab counted with another sits right under it; then the tabs with no figure, awake ones before sleeping ones, each in the window's own order.
  const arrange = (list: TabSession[]): TabRow[] => {
    const rows = list.map(rowOf), here = new Set(list.map(tab => tab.id));
    const followers = new Map<string, TabRow[]>(), heads: (TabRow & { order: number })[] = [];
    for (const row of rows) {
      const lead = row.sharedWith?.id;
      if (lead && here.has(lead)) followers.set(lead, [...(followers.get(lead) ?? []), row]);
      else heads.push({ ...row, order: (row.memoryKB === null ? (row.state === 'sleeping' ? 2e6 : 1e6) : 0) + index.get(row.id)! });
    }
    return heads.sort(byWeight).flatMap(({ order: _order, ...row }) => [row as TabRow, ...(followers.get(row.id) ?? [])]);
  };
  const weigh = (rows: TaskRow[]) => rows.reduce((total, row) => total + (row.memoryKB ?? 0), 0);
  const spaces = windowWorkspaces(state), sections: TaskSection[] = [];
  const spaceOf = (tab: TabSession) => workspaceIdOf(state, tab);
  if (spaces.length >= 2 && tabs.every(tab => spaces.some(space => space.id === spaceOf(tab)))) {
    for (const workspace of spaces) {
      const rows = arrange(tabs.filter(tab => spaceOf(tab) === workspace.id));
      if (rows.length) sections.push({ key: `ws:${workspace.id}`, kind: 'workspace', workspace, memoryKB: weigh(rows), rows });
    }
  } else if (tabs.length) { const rows = arrange(tabs); sections.push({ key: 'tabs', kind: 'tabs', memoryKB: weigh(rows), rows }); }
  const tabsKB = sections.reduce((total, section) => total + section.memoryKB, 0);
  const extensions: ExtensionRow[] = (reading?.extensions ?? []).map((item, order) => ({ key: `ext:${item.id}`, kind: 'extension' as const, id: item.id, name: item.name, memoryKB: item.memoryKB, cpu: item.cpu, order })).sort(byWeight).map(({ order: _order, ...row }) => row);
  const extensionsKB = weigh(extensions);
  if (extensions.length) sections.push({ key: 'extensions', kind: 'extensions', memoryKB: extensionsKB, rows: extensions });
  // Acira itself: everything that is not a listed tab or an extension, so the three always add up to the total.
  const parts = (reading?.own ?? []).map(item => ({ ...item }));
  if (unlisted > 0) { const other = parts.find(part => part.id === 'otherPages'); if (other) other.memoryKB += unlisted; else parts.push({ id: 'otherPages', memoryKB: unlisted, cpu: null }); }
  const all = reading?.total.memoryKB ?? 0, ownKB = Math.max(0, reading ? all - tabsKB - extensionsKB : 0);
  const ownCpu = parts.some(part => part.cpu !== null) ? Math.round(parts.reduce((total, part) => total + (part.cpu ?? 0), 0) * 10) / 10 : null;
  const peakKB = Math.max(0, ...sections.flatMap(section => section.rows.map(row => row.memoryKB ?? 0)));
  // The foot's action: background tabs the tab menu's own rule lets a bulk row unload (not the one on screen, not pinned, not private, not Acira's pages), awake and not playing.
  const sweepable = new Set(sleepableTabs(state, tabs).filter(tab => figure.has(tab.id) && tab.media !== 'playing' && !(tab.audible && !tab.muted) && !tab.capturing?.length).map(tab => tab.id));
  let freed = 0; const counted = new Set<object>();
  for (const id of sweepable) { const shared = figure.get(id)!; if (!counted.has(shared) && shared.ids.every(other => sweepable.has(other))) { counted.add(shared); freed += Math.max(0, shared.memoryKB - STAYS_PER_PAGE_KB); } }
  return { sections, own: { memoryKB: ownKB, cpu: ownCpu, parts: parts.filter(part => part.memoryKB > 0).sort((a, b) => b.memoryKB - a.memoryKB) }, totals: { all, tabs: tabsKB, extensions: extensionsKB, own: ownKB }, peakKB, sweep: { tabIds: tabs.filter(tab => sweepable.has(tab.id)).map(tab => tab.id), memoryKB: freed } };
}

/** Keeps every row where it is while the pointer or the keyboard is on the list: in each section the rows already shown keep their order, new ones join its end. Figures still update. */
export function holdOrder(view: TaskView, previous: ReadonlyMap<string, readonly string[]>): TaskView {
  return { ...view, sections: view.sections.map(section => {
    const before = previous.get(section.key);
    if (!before?.length) return section;
    const rank = new Map(before.map((key, at) => [key, at]));
    const known = section.rows.filter(row => rank.has(row.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
    return { ...section, rows: [...known, ...section.rows.filter(row => !rank.has(row.key))] };
  }) };
}
/** What a page's figure holds that does not come back when the page is unloaded: the part of Acira's own code that every page maps and the
 *  system counts in each of them. Measured in the app (19 Nov, qa/task-manager/foot-proof.mjs, two runs with the same ten pages of 173 MB
 *  each: 1509 and 1531 MB freed), so about 22 MB of each figure stays. The foot's "frees about" leaves it out: the promise is what is freed,
 *  not the sum of the rows. */
export const STAYS_PER_PAGE_KB = 22 * 1024;
/** How much heavier a row must be than the row above it before the two change places: 8 MB, or 6 % of the upper one. Tabs of nearly the same
 *  weight would otherwise swap at every reading, for a megabyte. */
export const SWAP_MARGIN_KB = 8 * 1024, SWAP_MARGIN_SHARE = 0.06;
/** A steady order: rows keep the order they had and one moves above another only when it has become clearly heavier (the margin above). Rows
 *  that are new take their place by weight; a tab counted with another stays right under it; rows with no figure keep their fresh order, last. */
export function steadyOrder(view: TaskView, previous: ReadonlyMap<string, readonly string[]>): TaskView {
  return { ...view, sections: view.sections.map(section => {
    const before = previous.get(section.key);
    if (!before?.length) return section;
    const blocks: TaskRow[][] = [];
    for (const row of section.rows) {
      const lead = blocks.at(-1)?.[0];
      if (row.kind === 'tab' && row.sharedWith && lead?.kind === 'tab' && lead.id === row.sharedWith.id) blocks.at(-1)!.push(row); else blocks.push([row]);
    }
    const weighs = (block: TaskRow[]) => (block[0].memoryKB ?? 0) > 0, rank = new Map(before.map((key, at) => [key, at]));
    const list = [...blocks.filter(block => weighs(block) && rank.has(block[0].key)).sort((a, b) => rank.get(a[0].key)! - rank.get(b[0].key)!), ...blocks.filter(block => weighs(block) && !rank.has(block[0].key))];
    for (let i = 1; i < list.length; i++) for (let j = i; j > 0; j--) {
      const lower = list[j][0].memoryKB!, upper = list[j - 1][0].memoryKB!;
      if (lower - upper > Math.max(SWAP_MARGIN_KB, upper * SWAP_MARGIN_SHARE)) [list[j - 1], list[j]] = [list[j], list[j - 1]]; else break;
    }
    return { ...section, rows: [...list, ...blocks.filter(block => !weighs(block))].flat() };
  }) };
}
export const orderOf = (view: TaskView): Map<string, string[]> => new Map(view.sections.map(section => [section.key, section.rows.map(row => row.key)]));

const number = (value: number, digits: number, locale?: string) => { try { return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value); } catch { return value.toFixed(digits); } };
/** 412 MB, 1.2 GB (from 1000 MB up, so a figure never needs a fourth digit and the column keeps its width). KB in, as the process list reports it. */
export function formatMemory(kb: number, locale?: string): string {
  const mb = Math.max(1, Math.round(kb / 1024));
  return mb >= 1000 ? `${number(Math.max(1, mb / 1024), 1, locale)} GB` : `${number(mb, 0, locale)} MB`;
}
/** "about 640 MB": rounded to what a person would say (10 MB steps, a tenth of a GB). */
export function formatAbout(kb: number, locale?: string): string {
  const mb = kb / 1024;
  return mb >= 995 ? `${number(mb / 1024, 1, locale)} GB` : `${number(Math.max(10, Math.round(mb / 10) * 10), 0, locale)} MB`;
}
/** The processor figure is shown only when it says something: above 1 % of one core. 3 %, 12 %, 140 %. */
export const cpuShown = (cpu: number | null | undefined): cpu is number => typeof cpu === 'number' && cpu > 1;
export function formatCpu(cpu: number, locale?: string): string {
  try { return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.round(cpu) / 100); } catch { return `${Math.round(cpu)}%`; }
}
/** "25 min", "2 hr", "3 days" in the interface's language; '' under a minute (the line then says only where the tab is). */
export function formatIdle(ms: number | null, locale?: string): string {
  if (ms === null || ms < 60_000) return '';
  const minutes = Math.floor(ms / 60_000), [value, unit] = minutes < 60 ? [minutes, 'minute'] : minutes < 48 * 60 ? [Math.floor(minutes / 60), 'hour'] : [Math.floor(minutes / 1440), 'day'];
  try { return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: unit === 'day' ? 'long' : 'short' }).format(value); } catch { return `${value} ${unit === 'minute' ? 'min' : unit === 'hour' ? 'h' : 'd'}`; }
}
export const tabTitleOf = (tab: TabSession) => tabDisplayTitle(tab) || tab.url;
/** A row's meter: its share of the heaviest row, never so short that it reads as a dot. */
export const shareOf = (memoryKB: number | null, peakKB: number): number => memoryKB && peakKB > 0 ? Math.max(0.06, Math.min(1, memoryKB / peakKB)) : 0;
