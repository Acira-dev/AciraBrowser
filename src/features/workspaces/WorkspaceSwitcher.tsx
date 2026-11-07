import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronDown, MoreHorizontal, Plus } from '../../components/AppIcons';
import { WorkspacePlaybackGlyph } from '../../components/WorkspacePlaybackGlyph';
import { workspacePlaying } from '../../ui/workspaceAudio';
import { WorkspaceGlyph, workspaceIcon } from '../../components/WorkspaceGlyph';
import { TabSoundMeter } from '../../components/TabSound';
import { MAX_WORKSPACES, profilesAsSpaces, windowWorkspaces, workspaceColorOf, workspaceName } from '../../runtime/workspaces';
import { ProfileAvatar } from '../accounts/profileModel';
import { openSettings } from '../../ui/settingsView';
import type { BrowserAction, BrowserSnapshot, Workspace } from '../../runtime/types';
import { isMac } from '../../ui/platform';
import { springTo } from '../../ui/sharedMotion';
import { commandLabel, shortcutFor, useShortcutKeys } from '../../ui/shortcutKeys';
import { useWorkspaceSlide } from '../../ui/workspaceMotion';
import { openWorkspacePopup } from '../../ui/workspaceTarget';
import '../../styles/workspaces.css';
import { t } from '../../i18n';

type Dispatch = (action: BrowserAction) => void;
/** Alt+N on Windows and Linux, Ctrl+N on a Mac (the registry's live key when it has answered). */
export const workspaceKey = (index: number): string | undefined => index < 8 ? shortcutFor(`switch-workspace-${index + 1}`, isMac() ? `⌃${index + 1}` : `Alt ${index + 1}`) : undefined;
/** Next / previous workspace: registry id, direction, English name, and the key written for before the registry answers. */
export const CYCLE_COMMANDS = [['next-workspace', 1, 'Next workspace', 'Ctrl + Alt + PgDn'], ['prev-workspace', -1, 'Previous workspace', 'Ctrl + Alt + PgUp']] as const;
/** The live key of a cycle command (Settings › Shortcuts), or undefined once the person cleared it. */
export const cycleKey = (id: typeof CYCLE_COMMANDS[number][0], written: string): string | undefined => shortcutFor(id, isMac() ? undefined : written);
/** The next / previous workspace lines of a tooltip, with the live keys (Settings › Shortcuts); a key the person cleared leaves its line out (R4-48 P1-5). */
export const cycleHint = (spaces = false): string => CYCLE_COMMANDS
  .flatMap(([id, , english, written]) => { const key = cycleKey(id, written); return key ? [`${commandLabel(id, english, spaces)} · ${key}`] : []; }).join('\n');
const withCycle = (text: string, spaces = false): string => { const hint = cycleHint(spaces); return hint ? `${text}\n${hint}` : text; };
/** The name a workspace is shown by: its own, or "Main" for the first one nobody renamed. */
export const shownName = (workspace: Pick<Workspace, 'name'>): string => workspaceName(workspace, t('workspaces.main'));
/** Profiles as spaces (runtime/profileSpaces.ts): the profile a space is; none with workspaces. */
const spaceProfile = (state: BrowserSnapshot, workspace: Workspace) => profilesAsSpaces(state) ? state.browserProfiles.find(profile => profile.id === workspace.browserProfileId) : undefined;
/** The name a workspace goes by in this window: with profiles as spaces, its profile's. */
export const nameIn = (state: BrowserSnapshot, workspace: Workspace): string => spaceProfile(state, workspace)?.name ?? shownName(workspace);
/** A workspace's icon; with profiles as spaces, its profile's avatar (photo, initial or emoji) on the profile's colour. */
export function SpaceIdentity({ state, workspace }: { state: BrowserSnapshot; workspace: Workspace }) {
  const profile = spaceProfile(state, workspace);
  return profile ? <ProfileAvatar name={profile.name} color={profile.color} avatar={profile.avatar} picture={profile.picture} size={16} /> : <WorkspaceGlyph icon={workspaceIcon(workspace)} />;
}
/** "Main workspace · Alt+1": what a workspace's control says on hover (the key becomes a key cap in the tooltip); a space says its profile's name. */
const label = (state: BrowserSnapshot, workspace: Workspace, index: number) => { const key = workspaceKey(index), name = profilesAsSpaces(state) ? nameIn(state, workspace) : t('workspaces.tip', { name: shownName(workspace) }); return key ? `${name} · ${key}` : name; };
/** The colour a workspace shows (its rail, the preview): its own; Main wears the profile's (R4-48 P0-6). */
export const shownColor = (state: BrowserSnapshot, workspace: Workspace): string | undefined => workspaceColorOf(state, workspace);
const colorStyle = (color: string | undefined) => color ? { '--ws-color': color } as CSSProperties : undefined;
/** The open workspace's pill carries its name while the row has room (four or fewer); from five it is icon-only and the title line keeps the name. */
const NAMED_PILL_MAX = 4;

/** The switcher in the sidebar (R3-57, R4-23, R4-48). Shown only once there is a second workspace (D1): one workspace has
 * nothing to switch to, so Workspaces is found from the profile panel, the command bar, the tab menu and Settings instead.
 * With several it is one icon per workspace in a row above the profile footer: one click opens a workspace; the open one is
 * a raised pill (with its name while there are four or fewer) that moves to the next one in the frame it is chosen; a colour shows as a 2px
 * rail under the icon. A playing workspace uses the audio matrix in the icon slot; hover or keyboard focus reveals its chosen icon. Right-click: Rename, Icon and color, Delete. Alt+1–8 jump. */
export function WorkspaceRow({ state, dispatch, moveFocus }: { state: BrowserSnapshot; dispatch: Dispatch; moveFocus: (event: KeyboardEvent<HTMLElement>, from?: HTMLElement) => boolean }) {
  useShortcutKeys();
  // With profiles as spaces the row lists the profiles, eight at most (the keys); the profile panel lists them all.
  const spaces = profilesAsSpaces(state), list = spaces ? windowWorkspaces(state).slice(0, MAX_WORKSPACES) : windowWorkspaces(state), host = useRef<HTMLDivElement>(null), pill = useRef<HTMLSpanElement>(null), placed = useRef(false), lefts = useRef(new Map<string, number>()), shownActive = useRef(state.activeWorkspaceId);
  const active = state.activeWorkspaceId, several = list.length > 1, named = list.length <= NAMED_PILL_MAX;
  // The open cell is as wide as its name: a rename (or another icon) changes the cell without changing the row, which the observer below watches, so it has to restart the placement.
  const names = list.map(item => `${item.id}:${nameIn(state, item)}:${workspaceIcon(item)}`).join('|');
  useWorkspaceSlide('.acira-sidebar .sb-scroll', active, list.map(item => item.id));
  // The pill sits on the open workspace's cell (the first placement and a resize are instant). When a cell grows or shrinks (a rename,
  // a workspace added) the other icons move aside on the S spring (FLIP, transform only). A switch lands at once, pill and icons:
  // the new open cell shows its name at its new place in the same frame, and gliding the icons there drew them over that name while
  // the pill sat at the old cell with the new width (founder, 3 Nov: "how it expands and glitches, then gets good").
  useLayoutEffect(() => {
    const row = host.current, el = pill.current, switched = shownActive.current !== active;
    shownActive.current = active;
    if (!row || !el) { placed.current = false; lefts.current.clear(); return; }
    const place = (glide: boolean) => {
      const cells = [...row.querySelectorAll<HTMLElement>('[data-ws],[data-workspace-new]')];
      for (const cell of cells) {
        const id = cell.dataset.ws ?? '+', now = cell.offsetLeft, before = lefts.current.get(id);
        if (glide && placed.current && before !== undefined && before !== now) void springTo(cell, { x: 0 }, 'workspace.pill', { from: { x: before - now } });
        lefts.current.set(id, now);
      }
      const cell = row.querySelector<HTMLElement>('[data-ws][aria-checked=true]');
      if (!cell) { el.style.opacity = '0'; return; }
      el.style.opacity = '1'; el.style.width = `${cell.offsetWidth}px`; el.style.height = `${cell.offsetHeight}px`;
      void springTo(el, { x: cell.offsetLeft }, 'workspace.pill', glide && placed.current ? {} : { from: { x: cell.offsetLeft } });
      placed.current = true;
    };
    place(!switched);
    const observer = new ResizeObserver(() => place(false));
    observer.observe(row);
    return () => observer.disconnect();
  }, [active, list.length, several, names]);
  if (!several) return null;
  const choose = (workspace: Workspace) => { if (workspace.id !== active) dispatch({ type: 'workspace.select', id: workspace.id }); };
  const keys = (event: KeyboardEvent<HTMLElement>, workspace?: Workspace) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const cells = [...(host.current?.querySelectorAll<HTMLElement>('[data-sb-focus]') ?? [])], at = cells.indexOf(event.currentTarget);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const next = cells[at + (event.key === 'ArrowRight' ? 1 : -1)]; if (next) { event.preventDefault(); next.focus(); } return; }
    // A space is a profile: it has no workspace menu or rename (its profile is edited in Settings › Profiles).
    if (workspace && !spaces && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) { event.preventDefault(); openWorkspacePopup(state, 'workspace-context', event.currentTarget, { mode: 'context', workspaceId: workspace.id }); return; }
    if (workspace && !spaces && event.key === 'F2') { event.preventDefault(); openWorkspacePopup(state, 'workspace-edit', event.currentTarget, { mode: 'edit', workspaceId: workspace.id, focus: 'name' }); return; }
    moveFocus(event);
  };
  return <div ref={host} className="sb-workspaces" role="radiogroup" aria-label={t('workspaces.switcher')} data-workspace-switcher data-named={named ? '' : undefined}
    onContextMenu={event => { if ((event.target as HTMLElement).closest('.sb-ws:not(.sb-ws-add)')) return; event.preventDefault(); openWorkspacePopup(state, 'workspace-context', event, { mode: 'sidebar' }); }}>
    <span ref={pill} className="sb-ws-pill" aria-hidden="true" />
    {list.map((workspace, index) => {
      const open = workspace.id === active, name = nameIn(state, workspace), key = workspaceKey(index), color = shownColor(state, workspace), playing = workspacePlaying(state, workspace.id);
      return <button key={workspace.id} type="button" role="radio" aria-checked={open} className="sb-ws" data-ws={workspace.id} data-playing={playing || undefined} data-sb-focus data-colored={color ? '' : undefined}
        style={colorStyle(color)} title={label(state, workspace, index) + (playing ? `\n${t('tabsound.playing')}` : '')} aria-label={playing ? `${name} · ${t('tabsound.playing')}` : name} aria-keyshortcuts={key?.replace(/\s/g, '')}
        onPointerDown={event => { if (event.button === 0 && event.pointerType !== 'touch') choose(workspace); }}
        onClick={() => choose(workspace)} onKeyDown={event => keys(event, workspace)}
        onContextMenu={event => { event.preventDefault(); if (!spaces) openWorkspacePopup(state, 'workspace-context', event, { mode: 'context', workspaceId: workspace.id }); }}>
        <span className="sb-ws-icon"><span className="sb-ws-identity"><SpaceIdentity state={state} workspace={workspace} /></span>{playing && <TabSoundMeter reducedMotion={state.settings.reducedMotion} />}{color && <i className="sb-ws-rail" aria-hidden="true" />}</span>
        {open && named && <span className="sb-ws-name">{name}</span>}
      </button>;
    })}
    {spaces
      // A new space is a new profile: the add form in Settings › Profiles, as the profile panel's Add profile… opens it.
      ? <button type="button" className="sb-ws sb-ws-add" data-workspace-new data-sb-focus aria-label={t('profiles.add')} title={t('profiles.add')}
        onKeyDown={keys} onClick={() => openSettings(state, dispatch, { section: 'Profiles', intent: 'add-profile' })}><Plus size={16} /></button>
      : list.length < MAX_WORKSPACES && <button type="button" className="sb-ws sb-ws-add" data-workspace-new data-sb-focus data-popup-trigger aria-haspopup="dialog" aria-label={t('workspaces.newTitle')} title={t('workspaces.newTitle')}
      onKeyDown={keys} onClick={event => openWorkspacePopup(state, 'workspace-edit', event.currentTarget, { mode: 'new' })}><Plus size={16} /></button>}
  </div>;
}

/** The "you are here" line at the top of the sidebar's tab section (R4-48 P0-3, wireframe 2), only with two or more
 * workspaces: the open workspace's icon, name and tab count. Click opens the switcher popover, double-click renames, ⋯
 * opens the workspace's own menu. */
/** `count`: the tabs the sidebar lists (a favorite's own tab is in its tile, not the list); every tab of the workspace when absent. */
export function WorkspaceTitle({ state, count: listed }: { state: BrowserSnapshot; count?: number }) {
  useShortcutKeys();
  const list = windowWorkspaces(state), open = list.find(item => item.id === state.activeWorkspaceId);
  // With profiles as spaces the footer right under the row names the profile on screen, so the title line isn't shown.
  if (list.length < 2 || !open || profilesAsSpaces(state)) return null;
  const name = shownName(open), count = listed ?? state.tabs.length, color = shownColor(state, open), tabs = t('workspaces.tabCount', { count });
  return <div className="sb-ws-title" data-workspace-title>
    <button type="button" className="sb-ws-title-main" data-popup-trigger aria-haspopup="dialog" aria-label={t('workspaces.titleLabel', { name, tabs })} title={withCycle(t('workspaces.titleTip'))}
      onClick={event => openWorkspacePopup(state, 'workspace-menu', event.currentTarget)}
      onDoubleClick={event => openWorkspacePopup(state, 'workspace-edit', event.currentTarget, { mode: 'edit', workspaceId: open.id, focus: 'name' })}
      onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); openWorkspacePopup(state, 'workspace-edit', event.currentTarget, { mode: 'edit', workspaceId: open.id, focus: 'name' }); } }}
      onContextMenu={event => { event.preventDefault(); openWorkspacePopup(state, 'workspace-context', event, { mode: 'context', workspaceId: open.id }); }}>
      <span className="ws-chip-glyph" data-colored={color ? '' : undefined} style={colorStyle(color)}><WorkspacePlaybackGlyph workspace={open} playing={workspacePlaying(state, open.id)} reducedMotion={state.settings.reducedMotion} />{color && <i className="sb-ws-rail" aria-hidden="true" />}</span>
      <span className="sb-ws-title-name">{name}</span>
      <span className="sb-ws-title-count">{tabs}</span>
    </button>
    <button type="button" className="sb-ws-title-more" data-popup-trigger aria-haspopup="dialog" aria-label={t('workspaces.menuFor', { name })} title={t('workspaces.menuFor', { name })}
      onClick={event => openWorkspacePopup(state, 'workspace-context', event.currentTarget, { mode: 'context', workspaceId: open.id })}><MoreHorizontal size={16} /></button>
  </div>;
}

/** The switcher in the tab strip's layout (two or more workspaces only, D1): a chip at the left end of the strip, icon, name
 * and chevron, opening the switcher popover. Right-click: the same menu as an icon in the sidebar. */
export function WorkspaceChip({ state }: { state: BrowserSnapshot }) {
  useShortcutKeys();
  const list = windowWorkspaces(state), index = list.findIndex(item => item.id === state.activeWorkspaceId), open = list[index];
  useWorkspaceSlide('.acira-tab-row .tab-strip-container', state.activeWorkspaceId, list.map(item => item.id));
  if (!open || list.length < 2) return null;
  const name = nameIn(state, open), color = shownColor(state, open), spaces = profilesAsSpaces(state), playing = workspacePlaying(state, open.id);
  return <button type="button" className="ws-chip" data-workspace-chip data-popup-trigger aria-haspopup="dialog" aria-label={t(spaces ? 'workspaces.spaceChip' : 'workspaces.chip', { name })} title={withCycle(t(spaces ? 'workspaces.spaceChipTip' : 'workspaces.chipTip', { name }), spaces)} data-colored={color ? '' : undefined}
    style={colorStyle(color)}
    onClick={event => openWorkspacePopup(state, 'workspace-menu', event.currentTarget)}
    onContextMenu={event => { event.preventDefault(); if (!spaces) openWorkspacePopup(state, 'workspace-context', event, { mode: 'context', workspaceId: open.id }); }}>
    <span className="ws-chip-glyph">{spaces && !playing ? <SpaceIdentity state={state} workspace={open} /> : <WorkspacePlaybackGlyph workspace={open} playing={playing} reducedMotion={state.settings.reducedMotion} />}{color && <i className="sb-ws-rail" aria-hidden="true" />}</span>
    <span className="ws-chip-name">{name}</span>
    {state.audibleWorkspaces?.length && !workspacePlaying(state, open.id) ? <span className="ws-chip-sound" title={t('tabsound.playing')} aria-label={t('tabsound.playing')}><TabSoundMeter reducedMotion={state.settings.reducedMotion} /></span> : null}
    <ChevronDown size={12} />
  </button>;
}
