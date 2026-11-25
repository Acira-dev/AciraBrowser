import { useSyncExternalStore } from 'react';

/** Whether the window is the active (key) one, for the replica window buttons (components/sidebar/WindowLightsReplica.tsx): grey when it is not, coloured when it is, like the native buttons.
 * Main says it (`window-active`) when the window gains or loses focus and when the interface loads; the root carries `data-window-active="true"` while it is and `"false"` while it is not (one meaning, the one desktop/composition.cjs markWindowActivation writes too: nothing tests for the attribute's presence; before the first event it is absent and every reader takes that as active). Pure for the test: `root` is anything with a dataset. */
export function applyWindowActive(root: { dataset: DOMStringMap }, event: { type: string; active?: boolean; minimizable?: boolean }): void {
  if (event.type !== 'window-active') return;
  if (event.minimizable === false) root.dataset.windowNomin = ''; else delete root.dataset.windowNomin;
  root.dataset.windowActive = event.active ? 'true' : 'false';
  const next = Boolean(event.active);
  if (next === active) return;
  active = next;
  listeners.forEach(listener => listener());
}
let active = false;
const listeners = new Set<() => void>();
export const subscribeWindowActive = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isWindowActive = (): boolean => active;
export const useWindowActive = (): boolean => useSyncExternalStore(subscribeWindowActive, isWindowActive, () => false);
/** Listens from the first script on, like windowFullscreen.ts. */
export function installWindowActive(): () => void {
  return window.acira?.subscribeBrowser?.(raw => applyWindowActive(document.documentElement, raw as unknown as { type: string; active?: boolean; minimizable?: boolean })) ?? (() => {});
}
