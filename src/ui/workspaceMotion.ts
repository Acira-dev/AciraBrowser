import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { BrowserSnapshot } from '../runtime/types';
import { profilesAsSpaces } from '../runtime/workspaces';
import { animateSpring, reducedMotion } from './sharedMotion';

/**
 * Switching workspaces (R3-57, R3-26): the colour and the tab list change as one move. The frame crossfades as one layer
 * (a view transition, so the compositor does it and it can't stall mid-switch), while the list the new workspace brings
 * slides in 16px from the side it sits on and fades in on springs (`workspace.slide`, `workspace.fade`). Native page views
 * cannot animate, so the page swaps at once under the crossfade. Both read the animation-speed setting; Off is instant.
 */
type Switching = Pick<BrowserSnapshot, 'activeWorkspaceId' | 'activeBrowserProfileId'> & { settings?: Pick<BrowserSnapshot['settings'], 'spaces'> };
/** True when a new snapshot is the same window showing another workspace: the interface crossfades into it. With profiles as
 * spaces a space is another profile's first workspace, so a change of profile is that switch too (it had no crossfade, and the
 * founder saw every in-between frame of the sidebar); with workspaces a change of profile is not a workspace switch. */
export const workspaceSwitched = (previous: Switching | null | undefined, next: Switching | null | undefined): boolean =>
  !!previous && !!next && !!previous.activeWorkspaceId && !!next.activeWorkspaceId && previous.activeWorkspaceId !== next.activeWorkspaceId
  && (previous.activeBrowserProfileId === next.activeBrowserProfileId || profilesAsSpaces(previous) && profilesAsSpaces(next));

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

/** True from the render where a tab strip's list was replaced (another space came on screen: tabStripEntries.stripChange) until two
 * frames after it: the new chips take their places without motion while the strip reads its room. Only that long: held until the
 * list next changed, the strip stayed in reduced motion after every switch (no hover or close fades, a frozen sound meter, a dropped
 * tab snapping back) for as long as nobody opened or closed a tab. */
export function useArrivalStill(replaced: boolean): boolean {
  const [still, setStill] = useState(false), frames = useRef<number[]>([]);
  useLayoutEffect(() => {
    if (!replaced) return;
    frames.current.forEach(cancelAnimationFrame);
    setStill(true);
    frames.current = [requestAnimationFrame(() => { frames.current = [requestAnimationFrame(() => { frames.current = []; setStill(false); })]; })];
  });
  useEffect(() => () => frames.current.forEach(cancelAnimationFrame), []);
  return replaced || still;
}
