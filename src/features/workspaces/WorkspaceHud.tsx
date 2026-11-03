import { useEffect, useRef, useState } from 'react';
import { profilesAsSpaces, switchSpoken, windowWorkspaces, type WindowPlace } from '../../runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { nameIn } from './WorkspaceSwitcher';
import { t } from '../../i18n';

/** The controls that already say which workspace is open: the sidebar row, its title line, the strip chip. */
const SWITCHERS = '[data-workspace-switcher],[data-workspace-title],[data-workspace-chip]';
/** True when one of them is really on screen: laid out, inside the window, not hidden by Seamless, Focus or a closed sidebar. */
export function switcherOnScreen(root: ParentNode = document): boolean {
  if (typeof window === 'undefined') return false;
  return [...root.querySelectorAll<HTMLElement>(SWITCHERS)].some(el => {
    if (el.closest('[inert],[aria-hidden="true"]')) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight;
  });
}
/** What a switch says: "Work workspace, 12 tabs"; with profiles as spaces "Client, 12 tabs". */
export const hudText = (state: BrowserSnapshot): string | undefined => {
  const open = windowWorkspaces(state).find(item => item.id === state.activeWorkspaceId);
  return open ? t(profilesAsSpaces(state) ? 'workspaces.spaceHud' : 'workspaces.hud', { name: nameIn(state, open), count: state.tabs.length }) : undefined;
};
/** Toasts that already say where things went (create, delete, its Undo): the HUD stays quiet for them. */
const SPOKEN = new Set(['workspaces.created', 'workspaces.createdAll', 'runtime.workspaceDeleted']);

/**
 * R4-48 P0-7: every workspace switch is announced (a polite live region, "Work workspace, 12 tabs"), and when nothing on
 * screen names the open workspace (Seamless, Focus, the sidebar closed, the strip hidden) the switch also shows the glass
 * status pill, A's transient primitive, so Alt+N never swaps every tab without a visible cue. The pill keeps its own motion
 * and speed rules (it rises on the input frame; with reduced motion it only fades). Mounted once per window (App).
 */
export function WorkspaceSwitchFeedback({ state, dispatch }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void }) {
  const last = useRef<WindowPlace | null>(null), [said, setSaid] = useState('');
  useEffect(() => {
    const before = last.current, now = { id: state.activeWorkspaceId, profile: state.activeBrowserProfileId };
    last.current = now;
    if (!switchSpoken(state, before, now)) return;
    const text = hudText(state);
    if (!text) return;
    const toast = state.toast, fresh = toast && Date.now() - (toast.at ?? toast.id) < 1500 && toast.i18n && SPOKEN.has(toast.i18n.id);
    if (fresh) return;
    // Wait one frame so the row, title line and chip have their new layout (a switch can also reveal the sidebar).
    const frame = requestAnimationFrame(() => {
      if (switcherOnScreen()) { setSaid(''); requestAnimationFrame(() => setSaid(text)); return; }
      // The pill announces itself through the window's one live region (App), so this one stays empty.
      dispatch({ type: 'toast', text, tone: 'status', icon: 'workspace' });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.activeWorkspaceId, state.activeBrowserProfileId]);// eslint-disable-line react-hooks/exhaustive-deps
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-workspace-announcer>{said}</div>;
}
