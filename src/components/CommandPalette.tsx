import { handoverEnter } from '../ui/addressHandover';
import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { Download as TransferDownload, Send as TransferSend } from 'lucide-react';
import { sidePanelRequest,sitesOf as sidePanelSitesOf,useSidePanelState } from '../ui/sidePanelSites';
import { useListMotion } from '../ui/sharedMotion';
import { ArrowRight, Bookmark, FileText, Globe2, History, Home, Layers3, Monitor, Search, Settings2, Workflow, type LucideIcon } from './AppIcons';
import { SiteIdentityIcon } from './SiteIdentityIcon';
import { runtime } from '../runtime/client';
import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { flatItems, paletteSections, type PaletteCommand, type PaletteItem, type PaletteLink, type PaletteWorkspaceTabs } from '../ui/paletteResults';
import { mruOrder, readStamps } from '../ui/tabMru';
import { historyVisibleFrom, tabVisibleFrom } from '../ui/suggestionPrivacy';
import { bookmarkMatches } from '../ui/addressSuggestions';
import { shownTab } from '../runtime/tabTitle';
import { formatShortcut } from '../ui/platform';
import { commandLabel } from '../ui/shortcutKeys';
import { MAX_WORKSPACES, profilesAsSpaces, windowWorkspaces, workspaceIdOf } from '../runtime/workspaces';
import { nameIn, shownName, workspaceKey } from '../features/workspaces/WorkspaceSwitcher';
import { openWorkspacePopupFromPopup } from '../ui/workspaceTarget';
import { commandsOffered } from '../ui/layoutMode';
import { paletteOpen } from '../ui/paletteTarget';
import { openSettings } from '../ui/settingsView';
import type { PaletteSetting } from '../ui/paletteResults';
import { noteUse } from '../features/metrics/noteUse';
import { openTransferSheet } from '../features/transfer/client';
import { transferBlocked } from '../features/transfer/entryPoints';
import type { TransferIntent } from '../features/transfer/types';

import { t } from '../i18n';
/** F39 command bar (bible §5.4): every registry command with its shortcut, open tabs in recently-used order, history
 * and Acira pages, one fuzzy query; `>` narrows to commands. No animation: it is a keyboard surface. */
const RECENT = 'acira-palette-recent';
const readRecent = (): string[] => { try { const value = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 8) : []; } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...readRecent().filter(other => other !== id)].slice(0, 8))); } catch { /* recents are a convenience */ } };
// Keyboard-only (hold-to-cycle) and positional commands make no sense from a list.
const listed = (id: string) => !/^(tab-switcher|select-tab-|select-last-tab|next-tab|prev-tab|switch-workspace-|new-workspace|side-panel-\d)/.test(id);
let registry: PaletteCommand[] = [];
// Shortcuts read the same everywhere ("Ctrl+Shift+T"), whatever the registry's spelling.
const chord = (display?: string) => display ? formatShortcut(display) : undefined;

const categoryIcon: Record<string, LucideIcon> = { Tabs: Layers3, Windows: Monitor, Navigation: ArrowRight, Page: FileText, Library: Bookmark, Browser: Settings2, Routines: Workflow, 'Tab sets': Workflow, Workspaces: Layers3 };
const pageIcon = (url: string) => url.includes('settings') ? Settings2 : url.includes('history') ? History : Home;

/** beta.14 (spec 4.1): two commands that open the transfer sheet on its side. Not in the shortcut registry (they have no key), so the palette adds them itself, like the workspace commands.
 * Glyphs are the design pictures' lucide Send and Download at the 1.5 stroke; the words "move" and "transfer" find them too. */
export const TRANSFER_COMMANDS: readonly { id: string; intent: TransferIntent; label: () => string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'transfer:send', intent: 'send', label: () => t('transfer.palette.send'), Icon: ({ size = 16 }) => <TransferSend size={size} strokeWidth={1.5} aria-hidden="true"/> },
  { id: 'transfer:receive', intent: 'receive', label: () => t('transfer.palette.receive'), Icon: ({ size = 16 }) => <TransferDownload size={size} strokeWidth={1.5} aria-hidden="true"/> },
];
const TRANSFER_KEYWORDS = ['move', 'transfer', 'move to another computer', 'another computer', 'new computer'] as const;
/** The commands for a window: none in a private or Tor window (main refuses the requests there). */
export const transferPaletteCommands = (state: Parameters<typeof transferBlocked>[0]): PaletteCommand[] => transferBlocked(state) ? [] : TRANSFER_COMMANDS.map(entry => ({ id: entry.id, label: entry.label(), category: 'Browser', keywords: TRANSFER_KEYWORDS }));
const transferIcon = (id: string) => TRANSFER_COMMANDS.find(entry => entry.id === id)?.Icon;
/** Runs one of the two commands once the palette has gone (it opens another surface): false when `id` is not one of them. `failed` runs when main refuses (a private or Tor window). */
export function runTransferCommand(id: string, failed: () => void): boolean {
  const side = TRANSFER_COMMANDS.find(entry => entry.id === id);
  if (!side) return false;
  setTimeout(() => { void openTransferSheet(side.intent).catch(failed); }, 0);
  return true;
}

function Title({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <span className="palette-title">{text}</span>;
  const hits = new Set(indices), parts: ReactNode[] = [];
  for (let i = 0; i < text.length;) { const hit = hits.has(i); let j = i; while (j < text.length && hits.has(j) === hit) j++; parts.push(hit ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j)); i = j; }
  return <span className="palette-title">{parts}</span>;
}

export function CommandPalette({ state, dispatch, close, onNavigate, onOpenNewTab, pages, findSettings, address, onAddress }: { /** D179: opened for the address (ui/addressHandover.ts): it starts with this text, selected, and an Enter that has not moved onto a row goes to what is typed. */ address?: string; onAddress?: (text: string, newTab: boolean) => void; state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; close: () => void; onNavigate: (url: string) => void; /** Opens the address in a new tab and closes the palette. */ onOpenNewTab: (url: string) => void; pages: PaletteLink[]; /** Beta 14.4: settings for the query (ui/settingsFinder.ts), given by the window. */ findSettings?: (query: string) => PaletteSetting[] }) {
  const [query, setQuery] = useState(address ?? ''), [active, setActive] = useState(0), [commands, setCommands] = useState(registry), list = useRef<HTMLDivElement>(null);
  const recent = useMemo(readRecent, []), field = useRef<HTMLInputElement>(null), selected = useRef(false);
  // D179: opened for the address, the whole address is selected, so typing or pasting replaces it (as a click in the field does).
  useEffect(() => { const input = field.current; if (address && input && !selected.current && document.activeElement === input) { selected.current = true; input.select(); } }, []);
  useEffect(() => noteUse('commandBar'), []); // R4-60: one use per opening, counted only while usage sharing is on
  // The registry (with customised shortcuts and dynamic "Open tab set" commands) reloads whenever it changes.
  useEffect(() => {
    const load = () => void runtime.native?.({ type: 'shortcuts.list' }).then(result => { registry = (result.shortcuts?.commands || []).filter(entry => listed(entry.id)).map(entry => ({ id: entry.id, label: commandLabel(entry.id, entry.label, profilesAsSpaces(state)), category: entry.category, shortcut: chord(entry.display?.[0]) })); setCommands(registry); }, () => {});
    load(); return runtime.subscribeBrowser(event => { if (event.type === 'shortcuts-changed') load(); });
  }, []);
  // Privacy line (founder P0): from an ordinary tab the search never finds a private, Tor or secured tab; from a Tor tab it finds nothing ordinary.
  const viewer = state.tabs.find(tab => tab.id === state.activeTabId);
  const tabs = useMemo(() => { const byId = new Map(state.tabs.map(tab => [tab.id, tab])); return mruOrder(state.tabs.map(tab => tab.id), state.activeTabId, readStamps()).map(id => byId.get(id)!).filter(tab => tab && tab.blank !== true && (tab.id === state.activeTabId || tabVisibleFrom(state, viewer, tab))).map(tab => shownTab(tab)); }, [state.tabs, state.activeTabId, state.browserProfiles, viewer]);
  // With no tab open, the history is still the window's own profile's, never every profile's.
  const history = useMemo(() => historyVisibleFrom(state, viewer ?? { browserProfileId: state.activeBrowserProfileId }, state.browsingHistory).slice(0, 400).map(visit => ({ url: visit.url, title: visit.title })), [state.browsingHistory, state.browserProfiles, state.activeBrowserProfileId, viewer]);
  // Workspaces (R3-57): switch to another one by name, or start a new one. They belong to this window, so they are not registry commands.
  const spaces = useMemo<PaletteCommand[]>(() => { const own = windowWorkspaces(state); return [...own.flatMap((workspace, index) => workspace.id === state.activeWorkspaceId ? [] : [{ id: `workspace:${workspace.id}`, label: t('workspaces.paletteSwitch', { name: nameIn(state, workspace) }), category: 'Workspaces', shortcut: workspaceKey(index), name: nameIn(state, workspace) }]), ...(own.length && own.length < MAX_WORKSPACES && !profilesAsSpaces(state) ? [{ id: 'workspace:new', label: t('workspaces.new'), category: 'Workspaces' }] : [])]; }, [state.workspaces, state.activeWorkspaceId, state.activeBrowserProfileId, state.settings.spaces, state.browserProfiles]);// eslint-disable-line react-hooks/exhaustive-deps
  // R4-48 P1-2: with several workspaces, a search also finds the other workspaces' tabs (a section each, named for the workspace); choosing one switches there.
  const otherTabs = useMemo<PaletteWorkspaceTabs[]>(() => { const elsewhere = state.otherWorkspaceTabs ?? []; if (!elsewhere.length) return []; return windowWorkspaces(state).flatMap(workspace => { const found = elsewhere.filter(tab => workspaceIdOf(state, tab) === workspace.id && tabVisibleFrom(state, viewer, tab)).map(tab => shownTab(tab)); return found.length ? [{ id: workspace.id, name: shownName(workspace), tabs: found }] : []; }); }, [state.otherWorkspaceTabs, state.workspaces, state.activeBrowserProfileId, viewer]);// eslint-disable-line react-hooks/exhaustive-deps
  // 13.5: where the sidebar is held open (Sidebar + address in Full) "Toggle sidebar" is not offered.
  const offered = useMemo(() => commandsOffered(state, commands), [state.settings, state.windowUi.view, commands]);
  const transfer = useMemo(() => transferPaletteCommands(state), [state.browserProfiles, state.activeBrowserProfileId, state.tabs, state.activeTabId]);
  // Beta 14 (AF): each pinned side panel site opens by its own name ("Open WhatsApp in the side panel"); nothing is offered until a site is pinned.
  const privateSites = useSidePanelState().sites;
  const sitePanels = useMemo<PaletteCommand[]>(() => (sidePanelSitesOf(state).length ? sidePanelSitesOf(state) : privateSites ?? []).map(site => ({ id: `side-panel:${site.id}`, label: t('sidepanel.paletteOpen', { name: site.title }), category: 'Browser', name: site.title })), [state.browserProfiles, state.activeBrowserProfileId, privateSites]);
  // Beta 14.4: settings found by the settings search itself (its synonyms, its languages), two at most, with where they live. The window passes the finder
  // (ui/settingsFinder.ts): the registry is built by the interface's bundler, so this component does not load it.
  const settingRows = useMemo(() => {
    const typed = query.trim();
    if (!findSettings || typed.length < 3 || typed.startsWith('>')) return [];
    return findSettings(typed);
  }, [query, findSettings]);
  // 14.5: bookmarks, found and named as the address field does (this profile's ordinary bookmarks; none from a Tor tab of an ordinary window). Not in the `>` command list.
  const bookmarkRows = useMemo(() => query.trim().startsWith('>') ? [] : bookmarkMatches(query, state).map(entry => ({ url: entry.url, title: entry.title, score: entry.score })), [query, state.bookmarks, state.bookmarkNodes, state.browsingHistory, state.browserProfiles, state.activeBrowserProfileId, state.tabs, state.activeTabId]);
  const sections = useMemo(() => paletteSections({ query, commands: [...offered, ...spaces, ...sitePanels, ...transfer], tabs, activeTabId: state.activeTabId, history, pages, recent, otherTabs, settings: settingRows, bookmarks: bookmarkRows }), [settingRows, query, offered, spaces, sitePanels, transfer, tabs, state.activeTabId, history, pages, recent, otherTabs, bookmarkRows]);
  const items = flatItems(sections), current = Math.min(active, Math.max(0, items.length - 1));
  // Typing filters the results on the shared list motion (A, round 2): sections that stay glide, new ones settle in.
  useListMotion(list, query, { frequent: true });
  // 13.5 (hunt-e 11): Enter never runs a held-back row (close other tabs, quit...: item.guard) that the person has not moved onto with a key or the pointer.
  const moved = useRef(false);
  useEffect(() => { setActive(0); moved.current = false; }, [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [current, items.length]);
  // Settings › Tabs: plain Enter opens a page, history item or search in a new tab; Alt+Enter then opens it in this one (and the other way round when it is off).
  const newTabByDefault = state.settings.commandSearchNewTab === true;
  const run = (item: PaletteItem | undefined, modifier = false) => {
    if (!item) return;
    const open = paletteOpen(item.kind, newTabByDefault, modifier), address = item.kind === 'web' ? item.query : item.kind === 'history' || item.kind === 'page' || item.kind === 'bookmark' ? item.url : '';
    if (open === 'switch' && item.kind === 'tab') { dispatch({ type: 'tab.select', id: item.tab.id }); close(); return; }
    if (open === 'new') { onOpenNewTab(address); return; }
    if (open === 'here') { onNavigate(address); return; }
    // Beta 14.4: a setting opens Settings on its row (the same jump as Settings' own search), whatever the new-tab choice says.
    if (item.kind === 'setting') { close(); openSettings(state, dispatch, { setting: item.setting }); return; }
    if (item.kind !== 'command') return;
    remember(item.command.id); close();
    if (runTransferCommand(item.command.id, () => dispatch({ type: 'toast', text: `${item.command.label} isn’t available here`, tone: 'error' }))) return;
    if (item.command.id.startsWith('side-panel:')) { const id = item.command.id.slice('side-panel:'.length); setTimeout(() => { void sidePanelRequest({ type: 'sidepanel.toggle', id }); }, 0); return; }
    if (item.command.id.startsWith('workspace:')) { const id = item.command.id.slice('workspace:'.length); setTimeout(() => { if (id === 'new') openWorkspacePopupFromPopup(state, 'workspace-edit', { mode: 'new' }); else dispatch({ type: 'workspace.select', id }); }, 0); return; }
    // The command may open another surface, so it runs once this one has gone.
    setTimeout(() => { const failed = (message?: string) => dispatch({ type: 'toast', text: message || `${item.command.label} isn’t available here`, tone: 'error' });
      void runtime.native?.({ type: 'shortcuts.run', id: item.command.id }).then(result => { if (result.shortcuts && !result.shortcuts.ok) failed(result.shortcuts.message); }, () => failed()); }, 0);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const step = event.key === 'ArrowDown' || event.key === 'Tab' && !event.shiftKey ? 1 : event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey ? -1 : 0;
    if (step && items.length) { event.preventDefault(); event.stopPropagation(); moved.current = true; setActive((current + step + items.length) % items.length); return; }
    if (event.key === 'Enter' && address !== undefined && onAddress) { const how = handoverEnter({ moved: moved.current, alt: event.altKey, query }); if (how !== 'row') { event.preventDefault(); event.stopPropagation(); onAddress(query, how === 'new-tab'); return; } }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const item = items[current]; if (item?.guard && !moved.current) return; run(item, event.altKey); }
  };
  let index = -1;
  return <>
    <label className="popup-search"><Search size={17}/><input autoFocus ref={field} onFocus={event => { if (address && !selected.current) { selected.current = true; event.currentTarget.select(); } }} aria-label={t("commandpalette.searchTabsHistoryAndCommands2")} aria-controls="palette-results" aria-activedescendant={items[current] ? `palette-${items[current].key}` : undefined} value={query} placeholder={t("commandpalette.searchTabsHistoryAndCommands")} onChange={event => setQuery(event.target.value)} onKeyDown={keys}/></label>
    <div className="palette-results" id="palette-results" role="listbox" ref={list}>
      {sections.map(section => <div key={section.key} role="group" aria-label={section.label}><div className="palette-section" aria-hidden="true">{section.label}</div>
        {section.items.map(item => { const at = ++index, Icon = item.kind === 'command' ? transferIcon(item.command.id) || categoryIcon[item.command.category] || Settings2 : item.kind === 'setting' ? Settings2 : item.kind === 'page' ? pageIcon(item.url) : item.kind === 'web' ? Globe2 : null;
          return <button type="button" key={item.key} id={`palette-${item.key}`} role="option" aria-selected={at === current} data-active={at === current} tabIndex={-1} className="palette-row" onPointerMove={() => { if (at !== current) { moved.current = true; setActive(at); } }} onClick={event => run(item, event.altKey || event.ctrlKey || event.metaKey)}>
            {Icon ? <Icon size={16}/> : <SiteIdentityIcon url={item.kind === 'tab' ? item.tab.url : item.kind === 'history' || item.kind === 'bookmark' ? item.url : ''} favicon={item.kind === 'tab' ? item.tab.favicon : undefined}/>}
            <Title text={item.title} indices={item.indices}/>{item.hint && <span className="palette-hint" title={item.hint}>{item.hint}</span>}{item.meta && <span className="palette-meta">{item.meta}</span>}
          </button>; })}
      </div>)}
      {!items.length && <p className="palette-empty">{t("commandpalette.noMatches")}</p>}
    </div>
  </>;
}
