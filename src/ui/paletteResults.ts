import { fuzzyMatch } from './fuzzy';
import { windowViewDetail } from './windowViewText';

import { t } from '../i18n';
/** Command bar contents (bible §5.4, F39). Pure: the component supplies the registry, tabs in recently-used order,
 * history, Acira pages and the recent command ids. */
export interface PaletteCommand { id: string; label: string; category: string; shortcut?: string; /** A workspace row: the workspace's own name, so a query equal to it ranks the row first (13.5, hunt-e 11). */ name?: string }
export interface PaletteTab { id: string; title: string; url: string; favicon?: string }
export interface PaletteLink { url: string; title: string }
interface Base { key: string; title: string; indices: number[]; meta: string; score: number; /** 13.5 (hunt-e 11): a command that closes or ends things without a question, and the query does not clearly name it. It is listed after the rest and Enter never runs it by default. */ guard?: true; /** R3-65: one plain sentence under a command that is easy to confuse with another (Focus mode vs Compact toolbar). */ hint?: string }
export type PaletteItem =
  | Base & { kind: 'command'; command: PaletteCommand }
  | Base & { kind: 'tab'; tab: PaletteTab }
  | Base & { kind: 'history' | 'page'; url: string; favicon?: string }
  | Base & { kind: 'web'; query: string };
export interface PaletteSection { key: string; label: string; items: PaletteItem[] }
/** The tabs of one other workspace, searched with the query (R4-48 P1-2): they show as a section named for the workspace, below this workspace's own tabs. */
export interface PaletteWorkspaceTabs { id: string; name: string; tabs: PaletteTab[] }
export interface PaletteInput { query: string; commands: PaletteCommand[]; tabs: PaletteTab[]; activeTabId: string; history: PaletteLink[]; pages: PaletteLink[]; recent: string[]; otherTabs?: PaletteWorkspaceTabs[] }

export const commandPrefix = '>';
export const hostOf = (url: string) => { try { const parsed = new URL(url); return parsed.protocol === 'acira:' ? '' : parsed.host.replace(/^www\./, ''); } catch { return ''; } };
const looksLikeAddress = (query: string) => !/\s/.test(query) && (/^[a-z][a-z0-9+.-]*:/i.test(query) || /^[^.]+\.[a-z]{2,}(\/|:|$)/i.test(query) || /^localhost(:\d+)?/i.test(query));

// The registry names the pages it opens with bare nouns (Settings › Shortcuts lists them so); a command bar row reads as
// what it does (UI QA C23). Acira pages take the same verb, and drop out where a command already opens them.
const VERBS: Record<string, () => string> = { history: () => t('paletteresults.openHistory'), rewind: () => t('paletteresults.openRewind'), routines: () => t('paletteresults.openTabSets'), 'bookmarks-manager': () => t('paletteresults.openBookmarks'), downloads: () => t('paletteresults.openDownloads'), settings: () => t('paletteresults.openSettings') };
const PAGE_COMMAND: Record<string, string> = { 'acira://history': 'history', 'acira://rewind': 'rewind', 'acira://routines': 'routines', 'acira://bookmarks': 'bookmarks-manager', 'acira://downloads': 'downloads', 'acira://settings': 'settings' };
const labelOf = (entry: PaletteCommand) => VERBS[entry.id]?.() || entry.label;
// 13.5 (hunt-e 11): typing a workspace's name and pressing Enter ran "Close other tabs" (both are whole-word matches). These close or end things
// without asking, so they are never first unless the query names them: the start of the label that reaches into its second word ("close other",
// "clear b"), or the whole label when it is one word, and no other command starts that way.
export const DESTRUCTIVE_COMMANDS = new Set(['close-other-tabs', 'close-tabs-right', 'close-window', 'quit', 'clear-data']);
const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
const WORKSPACE_NAMED = 100;
const clearlyNames = (query: string, entry: PaletteCommand, all: PaletteCommand[]) => { const q = norm(query); return (q.includes(' ') || q === norm(labelOf(entry))) && norm(labelOf(entry)).startsWith(q) && all.every(other => other.id === entry.id || !norm(labelOf(other)).startsWith(q)); };
// R3-65 / R3-68: the four views, each said in the one sentence Settings uses.
const HINTS: Record<string, () => string> = { 'view-full': () => windowViewDetail('full'), 'compact-toolbar': () => windowViewDetail('compact'), 'focus-mode': () => windowViewDetail('focus'), 'seamless-mode': () => windowViewDetail('seamless') };
const command = (entry: PaletteCommand, query: string, all: PaletteCommand[] = []): PaletteItem | null => {
  const label = labelOf(entry), match = fuzzyMatch(query, label) || (query ? (() => { const byCategory = fuzzyMatch(query, `${entry.category} ${label}`); return byCategory && { score: byCategory.score - 20, indices: [] }; })() : null);
  const named = !!query && entry.name !== undefined && norm(entry.name) === norm(query), held = DESTRUCTIVE_COMMANDS.has(entry.id) && !clearlyNames(query, entry, all);
  return match && { kind: 'command', key: `command:${entry.id}`, title: label, indices: match.indices, meta: entry.shortcut || '', score: match.score + (named ? WORKSPACE_NAMED : 0), command: entry, ...(held ? { guard: true as const } : {}), ...(HINTS[entry.id] ? { hint: HINTS[entry.id]!() } : {}) };
};
const tabItem = (tab: PaletteTab, query: string): PaletteItem | null => {
  const title = tab.title || hostOf(tab.url) || tab.url, byTitle = fuzzyMatch(query, title), byHost = query ? fuzzyMatch(query, hostOf(tab.url)) : null;
  const match = byTitle && (!byHost || byTitle.score >= byHost.score - 5) ? byTitle : byHost && { score: byHost.score - 5, indices: [] };
  return match && { kind: 'tab', key: `tab:${tab.id}`, title, indices: match.indices, meta: hostOf(tab.url), score: match.score, tab };
};
const link = (kind: 'history' | 'page', entry: PaletteLink, query: string): PaletteItem | null => {
  const title = entry.title || hostOf(entry.url) || entry.url, byTitle = fuzzyMatch(query, title), byUrl = query ? fuzzyMatch(query, entry.url.replace(/^https?:\/\/(www\.)?/, '')) : null;
  const match = byTitle && (!byUrl || byTitle.score >= byUrl.score - 5) ? byTitle : byUrl && { score: byUrl.score - 5, indices: [] };
  return match && { kind, key: `${kind}:${entry.url}`, title, indices: match.indices, meta: hostOf(entry.url), score: match.score, url: entry.url };
};
// A held-back row (see `guard`) comes after every other row of its list, whatever it scores.
const ranked = (items: (PaletteItem | null)[], limit: number) => (items.filter(Boolean) as PaletteItem[]).sort((a, b) => +!!a.guard - +!!b.guard || b.score - a.score).slice(0, limit);
const calm = (items: PaletteItem[]) => [...items.filter(item => !item.guard), ...items.filter(item => item.guard)];

export function paletteSections({ query: raw, commands, tabs, activeTabId, history, pages, recent, otherTabs = [] }: PaletteInput): PaletteSection[] {
  const commandsOnly = raw.trimStart().startsWith(commandPrefix), query = (commandsOnly ? raw.trimStart().slice(1) : raw).trim();
  const byId = new Map(commands.map(entry => [entry.id, entry]));
  const recentCommands = recent.map(id => byId.get(id)).filter(Boolean) as PaletteCommand[];
  if (commandsOnly) {
    if (!query) return [
      { key: 'recent', label: t("paletteresults.recent"), items: calm(recentCommands.slice(0, 5).map(entry => command(entry, '', commands)!)) },
      { key: 'commands', label: t("paletteresults.commands"), items: commands.filter(entry => !recent.includes(entry.id)).map(entry => command(entry, '', commands)!) },
    ].filter(section => section.items.length);
    // Recently used commands rank a little higher for the same text.
    const items = ranked(commands.map(entry => { const item = command(entry, query, commands); return item && { ...item, score: item.score + (recent.includes(entry.id) ? 12 - recent.indexOf(entry.id) : 0) }; }), 50);
    return items.length ? [{ key: 'commands', label: t("paletteresults.commands"), items }] : [];
  }
  const others = tabs.filter(tab => tab.id !== activeTabId);
  if (!query) {
    const start = [
      { key: 'tabs', label: t("paletteresults.openTabsCount", { count: Math.min(others.length, 8) }), items: others.slice(0, 8).map(tab => tabItem(tab, '')!) },
      { key: 'recent', label: t("paletteresults.commands"), items: calm(recentCommands.slice(0, 4).map(entry => command(entry, '', commands)!)) },
    ].filter(section => section.items.length);
    // A single tab and no history of commands yet: show what the bar can do.
    return start.length ? start : paletteSections({ query: commandPrefix, commands, tabs, activeTabId, history, pages, recent });
  }
  const openUrls = new Set([...tabs, ...otherTabs.flatMap(space => space.tabs)].map(tab => tab.url)), seen = new Set<string>(), tabRows = ranked(others.map(tab => tabItem(tab, query)), 6);
  // R4-48 P1-2: the other workspaces' tabs, a section each, a little below this workspace's own matches; choosing one switches there.
  const otherRows: PaletteSection[] = otherTabs.map(space => ({ key: `workspace:${space.id}`, label: t('workspaces.foundIn', { name: space.name }), items: ranked(space.tabs.map(tab => { const item = tabItem(tab, query); return item && { ...item, key: `tab:${tab.id}`, score: item.score - 12 }; }), 4) })).filter(section => section.items.length);
  const commandIds = new Set(commands.map(entry => entry.id)), pageRows = pages.filter(entry => !commandIds.has(PAGE_COMMAND[entry.url])).map(entry => ({ ...entry, title: t('paletteresults.openPage', { page: entry.title }) }));
  const sections: PaletteSection[] = [
    { key: 'tabs', label: t("paletteresults.openTabsCount", { count: tabRows.length }), items: tabRows },
    ...otherRows,
    { key: 'commands', label: t("paletteresults.commands"), items: ranked(commands.map(entry => { const item = command(entry, query, commands); return item && { ...item, score: item.score + (recent.includes(entry.id) ? 8 : 0) }; }), 6) },
    { key: 'pages', label: t("browsersettings.acira"), items: ranked(pageRows.map(entry => link('page', entry, query)), 3) },
    { key: 'history', label: t("browsermenu.history"), items: ranked(history.filter(entry => !openUrls.has(entry.url) && !seen.has(entry.url) && seen.add(entry.url)).map(entry => link('history', entry, query)), 5) },
  ].filter(section => section.items.length);
  // A section sorts by its best row that Enter may run; one with only held-back rows goes after the web row, so Enter never closes tabs by accident.
  const live = sections.filter(section => section.items.some(item => !item.guard)).sort((a, b) => b.items.find(item => !item.guard)!.score - a.items.find(item => !item.guard)!.score), held = sections.filter(section => !live.includes(section));
  const web: PaletteSection = { key: 'web', label: 'Web', items: [{ kind: 'web', key: 'web', title: looksLikeAddress(query) ? `Open ${query}` : `Search for “${query}”`, indices: [], meta: '', score: 0, query }] };
  return looksLikeAddress(query) || !live.length ? [web, ...live, ...held] : [...live, web, ...held];
}

export const flatItems = (sections: PaletteSection[]) => sections.flatMap(section => section.items);
