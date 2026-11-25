import { useMemo, useSyncExternalStore } from 'react';
import type { BrowserSnapshot, SidePanelStateEvent, TabSession } from '../runtime/types';
import { SIDE_PANEL_MAX_SITES, normalizeSiteUrl, type SidePanelSite } from '../runtime/sidePanelSites';
import { makeTab } from '../runtime/core';

/**
 * Side panel sites in the interface (Beta 14, brief section AF). The pinned list is the profile's (runtime/sidePanelSites.ts) and arrives with the state; what main adds
 * is which site is open in this window and, per live site, whether it plays sound and shows an unread dot (desktop/side-panel-sites.cjs sends `side-panel-state`).
 * Nothing is drawn until a site is pinned: no icon, no rail, no button.
 */
export interface SiteMark { live: boolean; audible: boolean; unread: number; dot: boolean; /** The now-playing card's row for the site (Beta 14): what its page plays, when the sound began (main's stamp, the card's "main" is the latest), and whether it is muted. */ media?: 'playing' | 'paused' | null; mediaAt?: number; muted?: boolean }
/** `sites` is sent only to a private window, whose command bar opens the profile's sites by name (it shows no icons). */
export interface SidePanelState { open: string | null; docked: boolean; marks: Record<string, SiteMark>; sites?: { id: string; title: string }[] }
export const EMPTY_SIDE_PANEL: SidePanelState = { open: null, docked: false, marks: {} };

/** What a `side-panel-state` event says, or undefined when `raw` is not one. Pure. */
export function sidePanelFromEvent(raw: unknown): SidePanelState | undefined {
  if (!raw || typeof raw !== 'object' || (raw as { type?: unknown }).type !== 'side-panel-state') return undefined;
  const event = raw as Partial<SidePanelStateEvent>;
  const marks: Record<string, SiteMark> = {};
  if (event.marks && typeof event.marks === 'object') for (const [id, mark] of Object.entries(event.marks).slice(0, SIDE_PANEL_MAX_SITES * 2)) {
    if (!mark || typeof mark !== 'object' || id.length > 80) continue;
    marks[id] = {
      live: mark.live === true, audible: mark.audible === true, unread: Number.isFinite(mark.unread) ? Math.max(0, Math.min(99999, mark.unread)) : 0, dot: mark.dot === true,
      media: mark.media === 'playing' || mark.media === 'paused' ? mark.media : null, mediaAt: typeof mark.mediaAt === 'number' && Number.isFinite(mark.mediaAt) ? Math.max(0, mark.mediaAt) : 0, muted: mark.muted === true,
    };
  }
  const sites = Array.isArray((event as { sites?: unknown }).sites) ? ((event as { sites: unknown[] }).sites).flatMap(row => row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string' && typeof (row as { title?: unknown }).title === 'string' ? [{ id: (row as { id: string }).id.slice(0, 80), title: (row as { title: string }).title.slice(0, 120) }] : []).slice(0, SIDE_PANEL_MAX_SITES) : undefined;
  return { open: typeof event.open === 'string' && event.open.length <= 80 ? event.open : null, docked: event.docked === true, marks, ...(sites ? { sites } : {}) };
}

/** The pinned sites of the profile on screen (none for a private or Tor profile). */
export function sitesOf(state: Pick<BrowserSnapshot, 'browserProfiles' | 'activeBrowserProfileId'>): SidePanelSite[] {
  const profile = state.browserProfiles.find(item => item.id === state.activeBrowserProfileId);
  return profile && !profile.private && !profile.tor ? profile.sidePanelSites ?? [] : [];
}
/** Whether "Add to side panel" is offered for this tab: a web page of an ordinary profile, not a private or Tor tab, with room left. */
export function canPin(state: Pick<BrowserSnapshot, 'browserProfiles' | 'activeBrowserProfileId'>, tab: Pick<TabSession, 'url' | 'contentKind' | 'privacy'> | undefined): boolean {
  if (!tab || tab.privacy || tab.contentKind !== 'web' || !normalizeSiteUrl(tab.url)) return false;
  const profile = state.browserProfiles.find(item => item.id === state.activeBrowserProfileId);
  return !!profile && !profile.private && !profile.tor;
}
/** The action that pins a tab's page (its name and icon as the sidebar shows them). */
export const pinAction = (tab: Pick<TabSession, 'url' | 'title' | 'favicon'> & { customTitle?: string }) => ({ type: 'sidepanel.pin' as const, url: tab.url, title: tab.customTitle?.trim() || tab.title, icon: typeof tab.favicon === 'string' && tab.favicon.startsWith('data:image/') ? tab.favicon : undefined });

type Bridge = {
  subscribeBrowser?: (listener: (event: unknown) => void) => () => void;
  sidePanel?: (request: { type: string; id?: string; muted?: boolean }) => Promise<unknown>;
};
const bridge = (): Bridge | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { acira?: Bridge }).acira);
/** Ask main (a click on an icon, the palette, a shortcut). Resolves with main's answer, or undefined where there is no desktop app. */
export function sidePanelRequest(request: { type: 'sidepanel.toggle' | 'sidepanel.open' | 'sidepanel.close' | 'sidepanel.dismiss' | 'sidepanel.state' | 'sidepanel.warm'; id?: string } | { type: 'sidepanel.mute'; id: string; muted: boolean }): Promise<unknown> {
  try { return bridge()?.sidePanel?.(request) ?? Promise.resolve(undefined); } catch { return Promise.resolve(undefined); }
}

let current: SidePanelState = EMPTY_SIDE_PANEL;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
const emit = () => { for (const listener of [...listeners]) listener(); };
const same = (a: SidePanelState, b: SidePanelState) => JSON.stringify(a) === JSON.stringify(b);
/** Apply one state from main. */
export function noteSidePanel(next: SidePanelState): void { if (same(current, next)) return; current = next; emit(); }
export const resetSidePanel = (): void => { current = EMPTY_SIDE_PANEL; emit(); };
export const sidePanelSnapshot = (): SidePanelState => current;

function start(): void {
  if (stop || !bridge()?.subscribeBrowser) return;
  const off = bridge()!.subscribeBrowser!(event => { const next = sidePanelFromEvent(event); if (next) noteSidePanel(next); });
  let alive = true;
  void sidePanelRequest({ type: 'sidepanel.state' }).then(answer => { if (alive && answer && typeof answer === 'object') { const next = sidePanelFromEvent({ type: 'side-panel-state', ...(answer as object) }); if (next) noteSidePanel(next); } }).catch(() => {});
  stop = () => { alive = false; off(); stop = undefined; };
}
export function subscribeSidePanel(listener: () => void): () => void {
  listeners.add(listener); start();
  return () => { listeners.delete(listener); if (!listeners.size) stop?.(); };
}
/** Which site is open here, and what each icon shows. */
export const useSidePanelState = (): SidePanelState => useSyncExternalStore(subscribeSidePanel, sidePanelSnapshot, sidePanelSnapshot);

let warmedAt = 0;
/** The pointer or the keyboard is on a pinned icon: main makes the panel's card ahead of the click (at most every 20 seconds). */
export function warmSidePanel(): void { const now = Date.now(); if (now - warmedAt < 20000) return; warmedAt = now; void sidePanelRequest({ type: 'sidepanel.warm' }); }

/**
 * Beta 14: the now-playing card lists a side panel site's sound like a tab's. The card takes tabs, so a site with something playing or paused is given to it as a tab-shaped row: the site's id, its name, address and icon,
 * and what main says about its sound (`media`, `mediaAt`, `muted`). The row is never in the window's tab list, so every tab action on it is answered here instead (`isSiteRow`, `siteRowDispatch`): "Go to tab" opens the panel,
 * the volume slider's mute mutes the page.
 */
export interface SiteRow extends TabSession { sideSite: true }
export function siteMediaRows(state: Pick<BrowserSnapshot, 'browserProfiles' | 'activeBrowserProfileId'>, panel: Pick<SidePanelState, 'marks'>, make: (site: SidePanelSite) => TabSession): SiteRow[] {
  return sitesOf(state).flatMap(site => {
    const mark = panel.marks[site.id];
    if (!mark?.live || (mark.media !== 'playing' && mark.media !== 'paused')) return [];
    return [{ ...make(site), media: mark.media, mediaAt: mark.mediaAt ?? 0, muted: !!mark.muted, sideSite: true as const }];
  });
}
export const isSiteRow = (tab: unknown): tab is SiteRow => !!tab && typeof tab === 'object' && (tab as { sideSite?: unknown }).sideSite === true;
/** The card's dispatch for a row of a site: the volume slider's mute reaches the page, nothing else is a tab action. */
export function siteRowDispatch<A extends { type: string }>(dispatch: (action: A) => void): (action: A) => void {
  return action => {
    const mute = action as unknown as { type: string; id?: string; muted?: boolean };
    if (mute.type === 'tab.mute' && typeof mute.id === 'string' && mute.id.startsWith('site-') && typeof mute.muted === 'boolean') { void sidePanelRequest({ type: 'sidepanel.mute', id: mute.id, muted: mute.muted }); return; }
    dispatch(action);
  };
}

/** The site rows for the now-playing card on screen: a site whose page plays or has paused a sound, as a tab-shaped row (see `siteMediaRows`). */
export function useSiteMediaRows(state: Pick<BrowserSnapshot, 'browserProfiles' | 'activeBrowserProfileId'>): SiteRow[] {
  const panel = useSidePanelState();
  return useMemo(() => siteMediaRows(state, panel, site => ({ ...makeTab(site.id, site.title, site.url, state.activeBrowserProfileId), ...(site.icon ? { favicon: site.icon } : {}) })), [state.browserProfiles, state.activeBrowserProfileId, panel.marks]);
}
