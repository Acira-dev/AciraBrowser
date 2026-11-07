import { useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Moon, Palette, PenLine, Plus, SlidersHorizontal, Trash2, Users } from '../../components/AppIcons';
import { securedRequest } from './securedClient';
import { WorkspacePlaybackGlyph } from '../../components/WorkspacePlaybackGlyph';
import { workspacePlaying } from '../../ui/workspaceAudio';
import { MAX_WORKSPACES, activeWorkspaceOf, cycledWorkspace, profilesAsSpaces, windowWorkspaces, workspaceCounts } from '../../runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { openSettings } from '../../ui/settingsView';
import { runtime } from '../../runtime/client';
import { sleepAction, workspaceSleepTabs } from '../../runtime/tabSleepMenu';
import { openWorkspacePopupFromPopup, takeWorkspaceTarget } from '../../ui/workspaceTarget';
import { CYCLE_COMMANDS, SpaceIdentity, cycleKey, nameIn, shownColor, shownName, workspaceKey } from './WorkspaceSwitcher';
import { commandLabel } from '../../ui/shortcutKeys';
import '../../styles/workspaces.css';
import { t } from '../../i18n';

/**
 * The workspace menus (R3-57, R4-48), on the shared panel rows. `list` is the switcher popover (the title line, the strip
 * chip; wireframe 3): a scope line (which profile, shared sign-ins), every workspace with its tab count (or "empty", a sound
 * mark, "window 2" when another window shows it), its key and a check on the open one; New workspace…; the open
 * workspace's own actions; and the way to Profiles for separate sign-ins. `context` is the right-click menu of one
 * workspace: Rename…, Icon and color…, Delete workspace. Delete asks once, in place, when the workspace has pages open
 * (P0-8), and always leaves an Undo.
 */
export function WorkspaceMenu({ state, dispatch, close, mode }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; close: () => void; mode: 'list' | 'context' }) {
  const [target] = useState(() => mode === 'context' ? takeWorkspaceTarget() : null), [confirming, setConfirming] = useState(false);
  // With profiles as spaces this lists the profiles (the space switcher), with no workspace to make, rename or delete.
  const spaces = profilesAsSpaces(state), list = windowWorkspaces(state), counts = state.workspaceTabCounts ?? workspaceCounts(state);
  // The sidebar's own menu (right-click on its empty space or on the workspace row): New workspace… (Add profile… with profiles as spaces) and Customize sidebar….
  const sidebar = mode === 'context' && target?.mode === 'sidebar', canNew = spaces || list.length > 0 && list.length < MAX_WORKSPACES;
  const makeOne = () => spaces ? (close(), openSettings(state, dispatch, { section: 'Profiles', intent: 'add-profile' })) : next(() => openWorkspacePopupFromPopup(state, 'workspace-edit', { mode: 'new' }));
  const subject = mode === 'context' ? list.find(item => target && 'workspaceId' in target && item.id === target.workspaceId) : activeWorkspaceOf(state);
  const profile = state.browserProfiles.find(item => item.id === state.activeBrowserProfileId);
  // Another popup opens from this one on the next turn, once this one has gone.
  const next = (run: () => void) => { close(); setTimeout(run, 0); };
  const edit = (focus: 'name' | 'icon') => subject && next(() => openWorkspacePopupFromPopup(state, 'workspace-edit', { mode: 'edit', workspaceId: subject.id, focus }));
  const pages = subject ? counts[subject.id]?.pages ?? 0 : 0;
  // R3-38: a locked workspace offers one thing, Unlock: renaming, recolouring and deleting it need it open (a passer-by can't change it), and the
  // switcher stays short enough for a short window at 150% (the Unlock row replaces three).
  const locked = !!subject?.secured && !subject.unlocked;
  // Put to sleep (beta.12): the workspace's tabs in this window that the Memory Saver may sleep (the tab on screen, pinned and private tabs and tabs already asleep are left out; main skips any that is playing or holds typed input).
  const sleepers = subject && !spaces && !locked ? workspaceSleepTabs(state, subject.id) : [];
  const remove = () => {
    if (!subject || list.length < 2) return;
    // A workspace with pages open asks once, in place; one holding only new tabs goes at once. Either way the toast keeps Undo.
    if (pages > 0 && !confirming) { setConfirming(true); return; }
    dispatch({ type: 'workspace.delete', id: subject.id }); close();
  };
  const sub = (id: string) => {
    const count = counts[id]?.tabs ?? 0, elsewhere = state.workspaceWindows?.[id], sound = workspacePlaying(state, id);
    const own = list.find(item => item.id === id);
    // A locked workspace says only that: its tabs are sealed away, so there is no count to give.
    if (own?.secured && !own.unlocked) return t('workspaces.lockedShort');
    const parts = [elsewhere ? t('workspaces.otherWindow', { n: elsewhere }) : count ? t('workspaces.tabCount', { count }) : t('workspaces.emptyShort')];
    if (sound) parts.push(t('tabsound.playing'));
    return parts.join(' · ');
  };
  if (sidebar) return <div className="ws-menu" role="menu" aria-label={t('workspaces.panel')}>
    {canNew && <><button type="button" role="menuitem" className="acira-menu-row" data-workspace-new onClick={makeOne}><Plus className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t(spaces ? 'profiles.add' : 'workspaces.new')}</span><span /></button><hr className="acira-menu-sep" /></>}
    <button type="button" role="menuitem" className="acira-menu-row" onClick={() => { close(); void runtime.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'customize-sidebar' }); }}><SlidersHorizontal className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('sidebarcustomize.customizeSidebar')}</span><span /></button>
  </div>;
  return <div className="ws-menu" role="menu" aria-label={t('workspaces.panel')}>
    {mode === 'context' && canNew && !spaces && <><button type="button" role="menuitem" className="acira-menu-row" data-workspace-new onClick={makeOne}><Plus className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.new')}</span><span /></button><hr className="acira-menu-sep" /></>}
    {mode === 'list' && <>
      <div className="ws-menu-head" role="presentation">
        <span className="ws-menu-head-title">{spaces ? t('profiles.panel') : t('workspaces.panel')}</span>
        {!spaces && <span className="acira-menu-sub">{t('workspaces.panelScope', { profile: profile?.name ?? '' })}</span>}
      </div>
      {list.map((workspace, index) => {
        const open = workspace.id === state.activeWorkspaceId, key = workspaceKey(index), color = shownColor(state, workspace);
        return <button key={workspace.id} type="button" role="menuitemradio" aria-checked={open} className="acira-menu-row acira-menu-row-identity" onClick={() => { if (!open) dispatch({ type: 'workspace.select', id: workspace.id }); close(); }}>
          <span className="acira-menu-icon ws-menu-glyph" data-colored={color ? '' : undefined} style={color ? { '--ws-color': color } as CSSProperties : undefined}>{spaces && !workspacePlaying(state, workspace.id) ? <SpaceIdentity state={state} workspace={workspace} /> : <WorkspacePlaybackGlyph workspace={workspace} playing={workspacePlaying(state, workspace.id)} reducedMotion={state.settings.reducedMotion} />}{color && <i className="sb-ws-rail" aria-hidden="true" />}{workspace.secured && <i className="ws-lock-badge" aria-hidden="true"><LockKeyhole size={9} /></i>}</span>
          <span className="acira-menu-title">{nameIn(state, workspace)}<span className="acira-menu-sub">{sub(workspace.id)}</span></span>
          <span className="ws-menu-trail">{key && <span className="acira-menu-meta">{key}</span>}<span className="ws-menu-mark">{open && <Check className="acira-menu-check" size={16} />}</span></span>
        </button>;
      })}
      {(list.length > 1 || list.length < MAX_WORKSPACES) && <hr className="acira-menu-sep" />}
      {/* Next / previous workspace, wrapping round like Ctrl+Alt+PageDown / PageUp, with the live keys (a cleared key leaves the row keyless). */}
      {list.length > 1 && CYCLE_COMMANDS.map(([id, direction, english, written]) => {
        // Keys sit at the row's end like every menu key (no check column here): longer names keep their room and ellipsize, the tooltip says it all.
        const Icon = direction > 0 ? ArrowRight : ArrowLeft, key = cycleKey(id, written), label = commandLabel(id, english, spaces);
        return <button key={id} type="button" role="menuitem" className="acira-menu-row ws-menu-cycle" data-workspace-cycle={id} title={key ? `${label} · ${key}` : label} onClick={() => { const target = cycledWorkspace(state, direction); if (target) dispatch({ type: 'workspace.select', id: target.id }); close(); }}>
          <Icon className="acira-menu-icon" size={16} /><span className="acira-menu-title">{label}</span>{key ? <span className="acira-menu-meta">{key}</span> : <span />}
        </button>;
      })}
      {spaces && <button type="button" role="menuitem" className="acira-menu-row" onClick={() => { openSettings(state, dispatch, { section: 'Profiles', intent: 'add-profile' }); close(); }}><Plus className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('profiles.add')}</span><span /></button>}
      {!spaces && list.length < MAX_WORKSPACES && <button type="button" role="menuitem" className="acira-menu-row" onClick={() => next(() => openWorkspacePopupFromPopup(state, 'workspace-edit', { mode: 'new' }))}><Plus className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.new')}</span><span /></button>}
      <hr className="acira-menu-sep" />
    </>}
    {!spaces && !locked && <>
      <button type="button" role="menuitem" className="acira-menu-row" disabled={!subject} onClick={() => edit('name')}><PenLine className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.rename')}</span><span /></button>
      <button type="button" role="menuitem" className="acira-menu-row" disabled={!subject} onClick={() => edit('icon')}><Palette className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.iconColor')}</span><span /></button>
      {sleepers.length > 0 && <button type="button" role="menuitem" className="acira-menu-row" data-workspace-sleep onClick={() => { const sleep = sleepAction(sleepers); if (sleep) dispatch(sleep); close(); }}><Moon className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('tabsleep.menuWorkspace')}</span><span /></button>}
    </>}
    {!spaces && subject && list[0]?.id !== subject.id && <>
      {!locked && <hr className="acira-menu-sep" />}
      {!subject.secured
        ? <button type="button" role="menuitem" className="acira-menu-row acira-menu-row-identity" onClick={() => { close(); void securedRequest({ type: 'enable', id: subject.id }); }}><LockKeyhole className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.lockThis')}<span className="acira-menu-sub">{t('workspaces.lockThisSub')}</span></span><span className="ws-beta">{t('workspaces.beta')}</span></button>
        : subject.unlocked
          ? <>
            <button type="button" role="menuitem" className="acira-menu-row" onClick={() => { close(); dispatch({ type: 'workspace.lock', id: subject.id }); }}><LockKeyhole className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.lockNow')}</span><span /></button>
            <button type="button" role="menuitem" className="acira-menu-row" onClick={() => { close(); void securedRequest({ type: 'disable', id: subject.id }); }}><LockKeyhole className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.stopLocking')}</span><span /></button>
          </>
          : <button type="button" role="menuitem" className="acira-menu-row" onClick={() => { close(); void securedRequest({ type: 'unlock', id: subject.id }); }}><LockKeyhole className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.unlockHello')}</span><span /></button>}
    </>}
    {!spaces && !locked && <hr className="acira-menu-sep" />}
    {spaces || locked ? null : confirming && subject
      ? <div className="ws-menu-confirm" role="group" aria-label={t('workspaces.deleteConfirm', { count: pages, name: shownName(subject) })}>
        <p>{t('workspaces.deleteConfirm', { count: pages, name: shownName(subject) })}</p>
        <div><button type="button" className="acira-button" onClick={() => setConfirming(false)}>{t('dialog.cancel')}</button><button type="button" className="acira-button acira-button-danger" data-autofocus autoFocus onClick={remove}>{t('workspaces.deleteShort')}</button></div>
      </div>
      : <button type="button" role="menuitem" className="acira-menu-row acira-menu-row-danger" disabled={!subject || list.length < 2} onClick={remove}><Trash2 className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.delete')}</span><span /></button>}
    {mode === 'list' && !spaces && <>
      <hr className="acira-menu-sep" />
      <button type="button" role="menuitem" className="acira-menu-row acira-menu-row-identity" onClick={() => { openSettings(state, dispatch, { section: 'Profiles' }); close(); }}>
        <Users className="acira-menu-icon" size={16} /><span className="acira-menu-title">{t('workspaces.needSeparate')}<span className="acira-menu-sub">{t('workspaces.useProfile')}</span></span><span />
      </button>
    </>}
  </div>;
}
