import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronDown, LockKeyhole, MoreHorizontal, Plus } from '../../components/AppIcons';
import { WorkspacePlaybackGlyph } from '../../components/WorkspacePlaybackGlyph';
import { workspacePlaying } from '../../ui/workspaceAudio';
import { useWorkspaceDropHover, type WorkspaceDropNote } from '../../ui/workspaceDrop';
import { WorkspaceGlyph, workspaceIcon } from '../../components/WorkspaceGlyph';
import { TabSoundMeter } from '../../components/TabSound';
import { MAX_WORKSPACES, WORKSPACE_KEYS, profilesAsSpaces, windowWorkspaces, workspaceColorOf, workspaceName } from '../../runtime/workspaces';
import { ProfileAvatar } from '../accounts/profileModel';
import { openSettings } from '../../ui/settingsView';
import type { BrowserAction, BrowserSnapshot, Workspace } from '../../runtime/types';
import { isMac } from '../../ui/platform';
import { animateSpring, motionSpeed, springTo } from '../../ui/sharedMotion';
import { commandLabel, shortcutFor, useShortcutKeys } from '../../ui/shortcutKeys';
import { useWorkspaceSlide } from '../../ui/workspaceMotion';
import { openWorkspacePopup } from '../../ui/workspaceTarget';
import '../../styles/workspaces.css';
import { t } from '../../i18n';

type Dispatch = (action: BrowserAction) => void;
/** Alt+N on Windows and Linux, Ctrl+N on a Mac (the registry's live key when it has answered). */
export const workspaceKey = (index: number): string | undefined => index < WORKSPACE_KEYS ? shortcutFor(`switch-workspace-${index + 1}`, isMac() ? `⌃${index + 1}` : `Alt ${index + 1}`) : undefined;
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

/** While a tab, a split or a group is carried over a workspace icon: the sentence above the row says where it would go ("Move to Work"), or why it cannot (muted, with a lock).
 * The same white pill the sidebar shows over Favorites ("Drop to add to Favorites"); it keeps its last words while it fades. */
function DropNote() {
  const hover = useWorkspaceDropHover(), last = useRef<WorkspaceDropNote | null>(null);
  if (hover) last.current = hover.note;
  const note = hover?.note ?? last.current;
  return <div className="sb-ws-drop-anchor" aria-hidden="true"><span className="sb-ws-drop-note" data-shown={hover ? '' : undefined} data-refused={note?.refused || undefined}>{note?.refused && <LockKeyhole size={14} />}<span>{note?.text}</span></span></div>;
}

/** 14.5 (the team's pick, a member's report: with more than 7 workspaces the row could not reach the last ones): every workspace is always on screen. The cells wrap onto as many 28 px lines as
 * the column needs (the + is the last cell), so nothing scrolls, fades or hides. This is the row's size for a count and a sidebar width (pure, so it is tested for 8, 10, 14 and 16 at 168, 240 and 312):
 * the host is 6 px of padding over the cell lines. `width` is the sidebar's width (the row has 8 px of padding on each side). */
export const WS_CELL = 28, WS_ROW_PAD = 6, WS_SIDE_PAD = 8;
export const workspaceRowLayout = (count: number, width: number) => {
  const perLine = Math.max(1, Math.floor((width - 2 * WS_SIDE_PAD) / WS_CELL)), cells = count + 1, lines = Math.max(1, Math.ceil(cells / perLine));
  return { perLine, lines, height: 2 * WS_ROW_PAD + lines * WS_CELL };
};

/** The switcher in the sidebar (R3-57, R4-23, R4-48). Shown only once there is a second workspace (D1): one workspace has
 * nothing to switch to, so Workspaces is found from the profile panel, the command bar, the tab menu and Settings instead.
 * With several it is one icon per workspace in a row above the profile footer: one click opens a workspace; the open one is
 * a raised pill (with its name while there are four or fewer) that moves to the next one in the frame it is chosen; a colour shows as a 2px
 * rail under the icon. A playing workspace uses the audio matrix in the icon slot; hover or keyboard focus reveals its chosen icon. Right-click: Rename, Icon and color, Delete. Alt+1–8 jump (the first eight). */
export function WorkspaceRow({ state, dispatch, moveFocus }: { state: BrowserSnapshot; dispatch: Dispatch; moveFocus: (event: KeyboardEvent<HTMLElement>, from?: HTMLElement) => boolean }) {
  useShortcutKeys();
  // With profiles as spaces the row lists the profiles, MAX_WORKSPACES at most; the profile panel lists them all.
  const spaces = profilesAsSpaces(state), list = spaces ? windowWorkspaces(state).slice(0, MAX_WORKSPACES) : windowWorkspaces(state), host = useRef<HTMLDivElement>(null), pill = useRef<HTMLSpanElement>(null), placed = useRef(false), lefts = useRef(new Map<string, { x: number; y: number }>()), shownHeight = useRef(0), shownCount = useRef(list.length), shownActive = useRef(state.activeWorkspaceId);
  const active = state.activeWorkspaceId, several = list.length > 1, named = list.length <= NAMED_PILL_MAX;
  // The open cell is as wide as its name: a rename (or another icon) changes the cell without changing the row, which the observer below watches, so it has to restart the placement.
  const names = list.map(item => `${item.id}:${nameIn(state, item)}:${workspaceIcon(item)}`).join('|');
  useWorkspaceSlide('.acira-sidebar .sb-scroll', active, list.map(item => item.id));
  // (Beta 14.0: the workspace's own title line above the list changes with it and comes in with it, not a crossfade ahead of it.)
  useWorkspaceSlide('.acira-sidebar .sb-sections-wrap > .sb-ws-title', active, list.map(item => item.id));
  // The pill sits on the open workspace's cell (the first placement and a resize are instant). When a cell grows or shrinks (a rename,
  // a workspace added) the other icons move aside on the S spring (FLIP, transform only), in both directions now that the cells wrap. A switch lands at once, pill and icons:
  // the new open cell shows its name at its new place in the same frame, and gliding the icons there drew them over that name while
  // the pill sat at the old cell with the new width (founder, 3 Nov: "how it expands and glitches, then gets good").
  // 14.5: when adding or deleting a workspace changes the number of lines, the row's height moves from the old one to the new one on the same spring (the tab list above gives or takes it),
  // so the sidebar does not jump; a width change (the sidebar's edge dragged) follows at once.
  useLayoutEffect(() => {
    const row = host.current, el = pill.current, switched = shownActive.current !== active, countChanged = shownCount.current !== list.length;
    shownActive.current = active; shownCount.current = list.length;
    if (!row || !el) { placed.current = false; lefts.current.clear(); shownHeight.current = 0; return; }
    const place = (glide: boolean) => {
      const cells = [...row.querySelectorAll<HTMLElement>('[data-ws],[data-workspace-new]')];
      // 14.3 (Move left / right): when the open workspace itself changes place, the neighbour it swaps with crosses the pill; the dark pill is see-through, so that neighbour's
      // icon fades out while it passes under the pill and back once past (the light pill already covers it).
      const openCell = row.querySelector<HTMLElement>('[data-ws][aria-checked=true]'), openBefore = openCell ? lefts.current.get(openCell.dataset.ws ?? '') : undefined;
      const swapping = glide && placed.current && !!openCell && openBefore !== undefined && (openBefore.x !== openCell.offsetLeft || openBefore.y !== openCell.offsetTop);
      for (const cell of cells) {
        const id = cell.dataset.ws ?? '+', now = { x: cell.offsetLeft, y: cell.offsetTop }, before = lefts.current.get(id);
        if (glide && placed.current && before !== undefined && (before.x !== now.x || before.y !== now.y)) {
          void springTo(cell, { x: 0, y: 0 }, 'workspace.pill', { from: { x: before.x - now.x, y: before.y - now.y } });
          if (swapping && cell !== openCell && cell.dataset.ws && motionSpeed() !== 'off') cell.animate([{ opacity: 1 }, { opacity: 0, offset: .2 }, { opacity: 0, offset: .7 }, { opacity: 1 }], { duration: motionSpeed() === 'fast' ? 200 : 360, easing: 'linear' });
        }
        lefts.current.set(id, now);
      }
      const cell = row.querySelector<HTMLElement>('[data-ws][aria-checked=true]');
      if (!cell) { el.style.opacity = '0'; return; }
      el.style.opacity = '1'; el.style.width = `${cell.offsetWidth}px`; el.style.height = `${cell.offsetHeight}px`;
      void springTo(el, { x: cell.offsetLeft, y: cell.offsetTop }, 'workspace.pill', glide && placed.current ? {} : { from: { x: cell.offsetLeft, y: cell.offsetTop } });
      placed.current = true;
    };
    const first = !placed.current;
    place(!switched);
    // The number of lines changed because a workspace came or went: the host (the tab list above it) glides from its old height to the new one.
    const now = row.offsetHeight, was = shownHeight.current;
    if (!first && countChanged && was && now !== was) { const move = animateSpring(row, [{ height: `${was}px` }, { height: `${now}px` }], 'workspace.pill'); if (move) { move.onfinish = () => move.cancel(); } }
    shownHeight.current = now;
    // A ResizeObserver reports once as soon as it observes. After a glide has just started (a workspace moved, renamed or added: the row's size is the same) that first report must not
    // place everything again without the glide: it put the pill on its new cell at once while the icons were still travelling, so the pill sat over the wrong icon for a few frames (14.3, Move left / right).
    let report = first || switched ? 1 : 0;
    const observer = new ResizeObserver(() => { if (!report++) return; place(false); shownHeight.current = row.offsetHeight; });
    observer.observe(row);
    return () => observer.disconnect();
  }, [active, list.length, several, names]);
  // Keyboard focus moving along the row follows the cells' lines (ArrowLeft / ArrowRight in the cell order; nothing scrolls any more).
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
  return <><DropNote /><div ref={host} className="sb-workspaces" role="radiogroup" aria-label={t('workspaces.switcher')} data-workspace-switcher data-named={named ? '' : undefined} data-count={named ? list.length : undefined} style={{ '--ws-n': list.length } as CSSProperties}
    onContextMenu={event => { if ((event.target as HTMLElement).closest('.sb-ws:not(.sb-ws-add)')) return; event.preventDefault(); openWorkspacePopup(state, 'workspace-context', event, { mode: 'sidebar' }); }}>
    <div className="sb-ws-strip" data-workspace-strip>
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
      // At the limit the + stays (a row that loses its end button says nothing) and a press says why, with the limit toast the reducer would show.
      : list.length < MAX_WORKSPACES
        ? <button type="button" className="sb-ws sb-ws-add" data-workspace-new data-sb-focus data-popup-trigger aria-haspopup="dialog" aria-label={t('workspaces.newTitle')} title={t('workspaces.newTitle')}
          onKeyDown={keys} onClick={event => openWorkspacePopup(state, 'workspace-edit', event.currentTarget, { mode: 'new' })}><Plus size={16} /></button>
        : <button type="button" className="sb-ws sb-ws-add" data-workspace-new data-workspace-limit data-sb-focus aria-disabled="true" aria-label={t('runtime.workspaceLimit', { count: MAX_WORKSPACES })} title={t('runtime.workspaceLimit', { count: MAX_WORKSPACES })}
          onKeyDown={keys} onClick={() => dispatch({ type: 'toast', text: t('runtime.workspaceLimit', { count: MAX_WORKSPACES }), tone: 'info' })}><Plus size={16} /></button>}
    </div>
  </div></>;
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
