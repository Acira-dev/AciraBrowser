import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { BrowserSnapshot } from '../runtime/types';
import { animateSpring, reducedMotion } from './sharedMotion';

/**
 * Switching workspaces (R3-57, R3-26): the colour and the tab list change as one move. The frame crossfades as one layer
 * (a view transition, so the compositor does it and it can't stall mid-switch), while the list the new workspace brings
 * slides in 16px from the side it sits on and fades in on springs (`workspace.slide`, `workspace.fade`). Native page views
 * cannot animate, so the page swaps at once under the crossfade. Both read the animation-speed setting; Off is instant.
 */
type Switching = Pick<BrowserSnapshot, 'activeWorkspaceId' | 'activeBrowserProfileId'>;
/** True when a new snapshot is the same window showing another workspace: the interface crossfades into it. */
export const workspaceSwitched = (previous: Switching | null | undefined, next: Switching | null | undefined): boolean =>
  !!previous && !!next && !!previous.activeWorkspaceId && !!next.activeWorkspaceId && previous.activeBrowserProfileId === next.activeBrowserProfileId && previous.activeWorkspaceId !== next.activeWorkspaceId;

type ViewTransitionStart = (update: () => void) => { ready?:Promise<void>; finished: Promise<void> };
/** A workspace switch's crossfade: one frame crossfade (`data-mode-switch='workspace'`, workspaces.css gives its length). `update` must apply the change synchronously (flushSync). */
export function startWorkspaceTransition(update: () => void): void {
  const start = (document as Document & { startViewTransition?: ViewTransitionStart }).startViewTransition, root = document.documentElement;
  if (!start || reducedMotion() || document.visibilityState !== 'visible' || root.hasAttribute('data-fr-switch') || root.hasAttribute('data-mode-switch')) { update(); return; }
  root.dataset.modeSwitch = 'workspace';
  // The colours land in the same commit as the new list, under the crossfade, so no colour transition has to be found and finished.
  const transition=start.call(document, () => { root.dataset.themeSettle = ''; update(); });
  void transition.ready?.catch(() => {});
  transition.finished.finally(() => { if (root.dataset.modeSwitch === 'workspace') delete root.dataset.modeSwitch; delete root.dataset.themeSettle; });
}

/** Slides a surface (the sidebar's tab list, the strip's tabs; a ref or a selector) in when `workspace` changes: from the right when the new one sits after the old one in `order`, from the left when before. */
export function useWorkspaceSlide(surface: RefObject<HTMLElement | null> | string, workspace: string, order: readonly string[]): void {
  const last = useRef<{ id: string; at: number } | null>(null);
  useLayoutEffect(() => {
    const at = order.indexOf(workspace), was = last.current;
    last.current = { id: workspace, at };
    const el = typeof surface === 'string' ? document.querySelector<HTMLElement>(surface) : surface.current;
    if (!was || was.id === workspace || !el) return;
    const side = at === was.at ? 1 : Math.sign(at - was.at);
    // Transform on the S spring and opacity on the E spring; fill 'backwards' leaves nothing behind when they end.
    animateSpring(el, [{ transform: `translateX(${side * 16}px)` }, { transform: 'translateX(0)' }], 'workspace.slide', { fill: 'backwards' });
    animateSpring(el, [{ opacity: 0 }, { opacity: 1 }], 'workspace.fade', { fill: 'backwards' });
  }, [workspace]);// eslint-disable-line react-hooks/exhaustive-deps
}
