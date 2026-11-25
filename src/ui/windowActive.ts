import { useSyncExternalStore } from 'react';

/** Whether the window is the active (key) one, for the replica window buttons (components/sidebar/WindowLightsReplica.tsx): grey when it is not, coloured when it is, like the native buttons.
 * Main says it (`window-active`) when the window gains or loses focus and when the interface loads; the root carries `data-window-active="true"` while it is and `"false"` while it is not (one meaning, the one desktop/composition.cjs markWindowActivation writes too: nothing tests for the attribute's presence; before the first event it is absent and every reader takes that as active). Pure for the test: `root` is anything with a dataset. */
export function applyWindowActive(root: { dataset: DOMStringMap }, event: { type: string; active?: boolean; minimizable?: boolean }): void {
  if (event.type !== 'window-active') return;
  if (event.minimizable === false) root.dataset.windowNomin = ''; else delete root.dataset.windowNomin;
  root.dataset.windowActive = event.active ? 'true' : 'false';
  const next = Boolean(event.active);
  if (next === active && told) return;
  active = next; told = true;
  listeners.forEach(listener => listener());
}
let active = false;
/** 14.5 (battery): whether main has said anything yet; until it has, nothing treats the window as inactive (a window that has not reported is in use, as in edgeBreath.ts). */
let told = false;
const listeners = new Set<() => void>();
export const subscribeWindowActive = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isWindowActive = (): boolean => active;
export const useWindowActive = (): boolean => useSyncExternalStore(subscribeWindowActive, isWindowActive, () => false);
/** Main has said this window is NOT the active one (focus lost, covered by another app's window in front): what keeps drawing for nobody drops to a still frame (the Now Playing
 * card's glow and dots, the New Tab tip's glow, the video glow's polling). False until main has spoken. */
export const isWindowInactive = (): boolean => told && !active;
export const useWindowInactive = (): boolean => useSyncExternalStore(subscribeWindowActive, isWindowInactive, () => false);
/** Listens from the first script on, like windowFullscreen.ts. */
export function installWindowActive(): () => void {
  return window.acira?.subscribeBrowser?.(raw => applyWindowActive(document.documentElement, raw as unknown as { type: string; active?: boolean; minimizable?: boolean })) ?? (() => {});
}
