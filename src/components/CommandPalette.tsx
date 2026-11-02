import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useListMotion } from '../ui/sharedMotion';
import { ArrowRight, Bookmark, FileText, Globe2, History, Home, Layers3, Monitor, Search, Settings2, Workflow, type LucideIcon } from './AppIcons';
import { SiteIdentityIcon } from './SiteIdentityIcon';
import { runtime } from '../runtime/client';
import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { flatItems, paletteSections, type PaletteCommand, type PaletteItem, type PaletteLink, type PaletteWorkspaceTabs } from '../ui/paletteResults';
import { mruOrder, readStamps } from '../ui/tabMru';
import { historyVisibleFrom, tabVisibleFrom } from '../ui/suggestionPrivacy';
import { shownTab } from '../runtime/tabTitle';
import { formatShortcut } from '../ui/platform';
import { commandLabel } from '../ui/shortcutKeys';
import { MAX_WORKSPACES, windowWorkspaces, workspaceIdOf } from '../runtime/workspaces';
import { shownName, workspaceKey } from '../features/workspaces/WorkspaceSwitcher';
import { openWorkspacePopupFromPopup } from '../ui/workspaceTarget';
import { noteUse } from '../features/metrics/noteUse';

import { t } from '../i18n';
/** F39 command bar (bible §5.4): every registry command with its shortcut, open tabs in recently-used order, history
 * and Acira pages, one fuzzy query; `>` narrows to commands. No animation: it is a keyboard surface. */
const RECENT = 'acira-palette-recent';
const readRecent = (): string[] => { try { const value = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 8) : []; } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...readRecent().filter(other => other !== id)].slice(0, 8))); } catch { /* recents are a convenience */ } };
// Keyboard-only (hold-to-cycle) and positional commands make no sense from a list.
const listed = (id: string) => !/^(tab-switcher|select-tab-|select-last-tab|next-tab|prev-tab|switch-workspace-|new-workspace)/.test(id);
let registry: PaletteCommand[] = [];
// Shortcuts read the same everywhere ("Ctrl+Shift+T"), whatever the registry's spelling.
const chord = (display?: string) => display ? formatShortcut(display) : undefined;

const categoryIcon: Record<string, LucideIcon> = { Tabs: Layers3, Windows: Monitor, Navigation: ArrowRight, Page: FileText, Library: Bookmark, Browser: Settings2, Routines: Workflow, 'Tab sets': Workflow, Workspaces: Layers3 };
const pageIcon = (url: string) => url.includes('settings') ? Settings2 : url.includes('history') ? History : Home;

function Title({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <span className="palette-title">{text}</span>;
  const hits = new Set(indices), parts: ReactNode[] = [];
  for (let i = 0; i < text.length;) { const hit = hits.has(i); let j = i; while (j < text.length && hits.has(j) === hit) j++; parts.push(hit ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j)); i = j; }
  return <span className="palette-title">{parts}</span>;
}

export function CommandPalette({ state, dispatch, close, onNavigate, pages }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; close: () => void; onNavigate: (url: string) => void; pages: PaletteLink[] }) {
  const [query, setQuery] = useState(''), [active, setActive] = useState(0), [commands, setCommands] = useState(registry), list = useRef<HTMLDivElement>(null);
  const recent = useMemo(readRecent, []);
  useEffect(() => noteUse('commandBar'), []); // R4-60: one use per opening, counted only while usage sharing is on
  // The registry (with customised shortcuts and dynamic "Open tab set" commands) reloads whenever it changes.
  useEffect(() => {
    const load = () => void runtime.native?.({ type: 'shortcuts.list' }).then(result => { registry = (result.shortcuts?.commands || []).filter(entry => listed(entry.id)).map(entry => ({ id: entry.id, label: commandLabel(entry.id, entry.label), category: entry.category, shortcut: chord(entry.display?.[0]) })); setCommands(registry); }, () => {});
    load(); return runtime.subscribeBrowser(event => { if (event.type === 'shortcuts-changed') load(); });
  }, []);
  // Privacy line (founder P0): from an ordinary tab the search never finds a private, Tor or secured tab; from a Tor tab it finds nothing ordinary.
  const viewer = state.tabs.find(tab => tab.id === state.activeTabId);
  const tabs = useMemo(() => { const byId = new Map(state.tabs.map(tab => [tab.id, tab])); return mruOrder(state.tabs.map(tab => tab.id), state.activeTabId, readStamps()).map(id => byId.get(id)!).filter(tab => tab && (tab.id === state.activeTabId || tabVisibleFrom(state, viewer, tab))).map(tab => shownTab(tab)); }, [state.tabs, state.activeTabId, state.browserProfiles, viewer]);
  const history = useMemo(() => historyVisibleFrom(state, viewer, state.browsingHistory).slice(0, 400).map(visit => ({ url: visit.url, title: visit.title })), [state.browsingHistory, state.browserProfiles, viewer]);
  // Workspaces (R3-57): switch to another one by name, or start a new one. They belong to this window, so they are not registry commands.
  const spaces = useMemo<PaletteCommand[]>(() => { const own = windowWorkspaces(state); return [...own.flatMap((workspace, index) => workspace.id === state.activeWorkspaceId ? [] : [{ id: `workspace:${workspace.id}`, label: t('workspaces.paletteSwitch', { name: shownName(workspace) }), category: 'Workspaces', shortcut: workspaceKey(index) }]), ...(own.length && own.length < MAX_WORKSPACES ? [{ id: 'workspace:new', label: t('workspaces.new'), category: 'Workspaces' }] : [])]; }, [state.workspaces, state.activeWorkspaceId, state.activeBrowserProfileId]);
  // R4-48 P1-2: with several workspaces, a search also finds the other workspaces' tabs (a section each, named for the workspace); choosing one switches there.
  const otherTabs = useMemo<PaletteWorkspaceTabs[]>(() => { const elsewhere = state.otherWorkspaceTabs ?? []; if (!elsewhere.length) return []; return windowWorkspaces(state).flatMap(workspace => { const found = elsewhere.filter(tab => workspaceIdOf(state, tab) === workspace.id && tabVisibleFrom(state, viewer, tab)).map(tab => shownTab(tab)); return found.length ? [{ id: workspace.id, name: shownName(workspace), tabs: found }] : []; }); }, [state.otherWorkspaceTabs, state.workspaces, state.activeBrowserProfileId, viewer]);// eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => paletteSections({ query, commands: [...commands, ...spaces], tabs, activeTabId: state.activeTabId, history, pages, recent, otherTabs }), [query, commands, spaces, tabs, state.activeTabId, history, pages, recent, otherTabs]);
  const items = flatItems(sections), current = Math.min(active, Math.max(0, items.length - 1));
  // Typing filters the results on the shared list motion (A, round 2): sections that stay glide, new ones settle in.
  useListMotion(list, query, { frequent: true });
  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [current, items.length]);
  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.kind === 'tab') { dispatch({ type: 'tab.select', id: item.tab.id }); close(); return; }
    if (item.kind === 'web') { onNavigate(item.query); return; }
    if (item.kind !== 'command') { onNavigate(item.url); return; }
    remember(item.command.id); close();
    if (item.command.id.startsWith('workspace:')) { const id = item.command.id.slice('workspace:'.length); setTimeout(() => { if (id === 'new') openWorkspacePopupFromPopup(state, 'workspace-edit', { mode: 'new' }); else dispatch({ type: 'workspace.select', id }); }, 0); return; }
    // The command may open another surface, so it runs once this one has gone.
    setTimeout(() => { const failed = (message?: string) => dispatch({ type: 'toast', text: message || `${item.command.label} isn’t available here`, tone: 'error' });
      void runtime.native?.({ type: 'shortcuts.run', id: item.command.id }).then(result => { if (result.shortcuts && !result.shortcuts.ok) failed(result.shortcuts.message); }, () => failed()); }, 0);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const step = event.key === 'ArrowDown' || event.key === 'Tab' && !event.shiftKey ? 1 : event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey ? -1 : 0;
    if (step && items.length) { event.preventDefault(); event.stopPropagation(); setActive((current + step + items.length) % items.length); return; }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); run(items[current]); }
  };
  let index = -1;
  return <>
    <label className="popup-search"><Search size={17}/><input autoFocus aria-label={t("commandpalette.searchTabsHistoryAndCommands2")} aria-controls="palette-results" aria-activedescendant={items[current] ? `palette-${items[current].key}` : undefined} value={query} placeholder={t("commandpalette.searchTabsHistoryAndCommands")} onChange={event => setQuery(event.target.value)} onKeyDown={keys}/></label>
    <div className="palette-results" id="palette-results" role="listbox" ref={list}>
      {sections.map(section => <div key={section.key} role="group" aria-label={section.label}><div className="palette-section" aria-hidden="true">{section.label}</div>
        {section.items.map(item => { const at = ++index, Icon = item.kind === 'command' ? categoryIcon[item.command.category] || Settings2 : item.kind === 'page' ? pageIcon(item.url) : item.kind === 'web' ? Globe2 : null;
          return <button type="button" key={item.key} id={`palette-${item.key}`} role="option" aria-selected={at === current} data-active={at === current} tabIndex={-1} className="palette-row" onPointerMove={() => at !== current && setActive(at)} onClick={() => run(item)}>
            {Icon ? <Icon size={16}/> : <SiteIdentityIcon url={item.kind === 'tab' ? item.tab.url : item.kind === 'history' ? item.url : ''} favicon={item.kind === 'tab' ? item.tab.favicon : undefined}/>}
            <Title text={item.title} indices={item.indices}/>{item.hint && <span className="palette-hint" title={item.hint}>{item.hint}</span>}{item.meta && <span className="palette-meta">{item.meta}</span>}
          </button>; })}
      </div>)}
      {!items.length && <p className="palette-empty">{t("commandpalette.noMatches")}</p>}
    </div>
  </>;
}
