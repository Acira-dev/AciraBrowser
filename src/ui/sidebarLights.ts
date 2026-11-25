import { useEffect, useState } from 'react';
import type { SidebarModeHeader } from './addressInSidebar';

/** Beta 14.0 re-release (reported 18 Nov): Sidebar + address on the Mac. The window's three buttons (the "traffic lights") are native and sit at the top left of the sidebar. With the sidebar away
 * (the 'bare' header: nothing over the page but its 6 px margin) the page would cover them, or leave one of them half under it, so they travel with the sidebar: hidden while it is away, back
 * when it is on screen. They cannot ride a slide (native buttons), so they wait for the sidebar to land, as Seamless's top bar does (chromeEdge.ts topLanding); a hide takes them away at its first frame.
 * A sidebar on the right does not carry them (they stay at the window's left, over the page column's top left, where the docked layout keeps a strip clear for them): with it floating in from the right
 * edge over a page they stay away, with it docked they show. Pure; Linux and Windows have their own caption (a system title bar, the caption notch), so only the Mac answers true. */
export function addressLightsAway(input: { platform: string; header: SidebarModeHeader | undefined; docked: boolean; side: 'left' | 'right'; landing: boolean; fullscreen: boolean; leaving?: boolean }): boolean {
  if (input.platform !== 'darwin' || input.fullscreen || input.header === undefined) return false;
  // A close: the native buttons stay until the slide has started to play (`leaving`), so the replicas in the sidebar's picture are on screen before the native ones go.
  if (input.header === 'bare') return !input.leaving;
  if (input.landing) return true;
  return !input.docked && input.side === 'right';
}

/** How long the replica buttons stay drawn after the native ones come back (ms): the swap is one frame in the same place, the extra moment covers the native buttons' own show. */
export const LIGHTS_SWAP_MS = 120;
/** After the slide has landed, how long the buttons still wait (ms). */
export const LIGHTS_SETTLE_MS = 300;
export interface LightsHold { header: SidebarModeHeader | undefined; landing: boolean }
/** The landing state after the header changed: it starts only when the sidebar comes in ('bare' to 'block') (`switchPlaying` is no longer read: with or without a transition the buttons wait for the landing and the settle moment, the replicas stand in), and ends with any other header. Pure. */
export const landingAfter = (held: LightsHold, header: SidebarModeHeader | undefined, switchPlaying: boolean): LightsHold =>
  held.header === header ? held : { header, landing: header === 'block' && held.header === 'bare' };

/** True from the moment the sidebar header goes from 'bare' to 'block' under a view transition (the sidebar sliding in: docked by a key or the button, or floated in from the edge) until that
 * transition has finished, so the lights come with the landed sidebar. Nothing waits when no transition plays (Reduce motion): the lights come in the same commit. */
export function useSidebarLanding(header: SidebarModeHeader | undefined): boolean {
  const [held, setHeld] = useState<LightsHold>({ header, landing: false });
  const playing = typeof document !== 'undefined' && document.documentElement.dataset.modeSwitch !== undefined;
  // Derived while rendering, so the commit that brings the sidebar in already keeps the lights away (an effect would send one layout with them on first).
  const now = landingAfter(held, header, playing);
  if (now !== held) setHeld(now);
  useEffect(() => {
    if (!held.landing) return;
    const root = document.documentElement;
    let guard = 0, settle = 0;
    const done = () => setHeld(current => (current.landing ? { ...current, landing: false } : current));
    // The slide has landed: the buttons wait a moment more (LIGHTS_SETTLE_MS, 300 ms: a switch queued behind this one starts about 140 ms after it lands), so a sidebar that is closed again right behind it (rapid toggles: the second switch is queued behind the first) never shows them for a frame.
    const end = () => { observer.disconnect(); window.clearTimeout(guard); settle = window.setTimeout(done, LIGHTS_SETTLE_MS); };
    const observer = new MutationObserver(() => { if (root.dataset.modeSwitch === undefined) end(); });
    observer.observe(root, { attributes: true, attributeFilter: ['data-mode-switch'] });
    if (root.dataset.modeSwitch === undefined) end();   // no transition (Reduce motion, or a switch that was folded into the one before): the same wait, the replicas stand in meanwhile
    guard = window.setTimeout(end, 1800);   // a transition that never finishes does not keep the lights away
    return () => { observer.disconnect(); window.clearTimeout(guard); window.clearTimeout(settle); };
  }, [held.landing]);
  return now.landing;
}

/** The close's side of the swap. From the moment the sidebar header goes from 'block' to 'bare' under a view transition until that transition's animations are running (the first frame of the slide is on its way to the
 * screen), the native buttons stay: they go in the same frame the replicas start moving with the panel. Without it the native buttons were hidden by main about a frame after the press while the picture of the panel
 * (with the replicas) was still being prepared, and nothing stood where they were for 100-200 ms on a busy page. Nothing waits when no transition plays (Reduce motion). */
export const leavingAfter = (held: LightsHold, header: SidebarModeHeader | undefined, switchPlaying: boolean): LightsHold =>
  held.header === header ? held : { header, landing: header === 'bare' && held.header === 'block' && switchPlaying };
const slideRunning = (): boolean => typeof document !== 'undefined' && document.getAnimations().some(animation => /^::view-transition/.test((animation.effect as KeyframeEffect | null)?.pseudoElement || ''));
export function useSidebarLeaving(header: SidebarModeHeader | undefined): boolean {
  const [held, setHeld] = useState<LightsHold>({ header, landing: false });
  const playing = typeof document !== 'undefined' && document.documentElement.dataset.modeSwitch !== undefined;
  const now = leavingAfter(held, header, playing);
  if (now !== held) setHeld(now);
  useEffect(() => {
    if (!held.landing) return;
    let frame = 0, guard = 0;
    const done = () => { cancelAnimationFrame(frame); window.clearTimeout(guard); setHeld(current => (current.landing ? { ...current, landing: false } : current)); };
    const look = () => { if (slideRunning()) { frame = requestAnimationFrame(done); return; } frame = requestAnimationFrame(look); };
    look();
    guard = window.setTimeout(done, 700);   // a transition that never starts does not keep the native buttons over the page
    return () => { cancelAnimationFrame(frame); window.clearTimeout(guard); };
  }, [held.landing]);
  return now.landing;
}
