import { useSyncExternalStore } from 'react';

/** macOS hides a window's traffic lights in fullscreen, so the corner the Mac layouts keep for them (86px at the left of the toolbar or
 * tab row, platform.css) is blank there. Main says when the window enters or leaves fullscreen (`window-state`, sent again whenever the
 * interface loads in a fullscreen window) and the root carries `data-window-fullscreen` while it is; platform.css stops reserving the
 * corner then, and the row starts at its own gutter as it does on Windows. Pure, for the test: `root` is anything with a dataset. */
export function applyWindowState(root: { dataset: DOMStringMap }, event: { type: string; fullscreen?: boolean }): void {
  if (event.type !== 'window-state') return;
  if (event.fullscreen) root.dataset.windowFullscreen = '';
  else delete root.dataset.windowFullscreen;
  const next = Boolean(event.fullscreen);
  if (next === fullscreen) return;
  fullscreen = next;
  listeners.forEach(listener => listener());
}

/** The same fact for code that is not CSS (the native page card's radius): a store, so a layout that depends on it runs again when it flips. */
let fullscreen = false;
const listeners = new Set<() => void>();
export const subscribeWindowFullscreen = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isWindowFullscreen = (): boolean => fullscreen;
export const useWindowFullscreen = (): boolean => useSyncExternalStore(subscribeWindowFullscreen, isWindowFullscreen, () => false);

/** Listens from the first script on: main's event at the interface's dom-ready must find the listener in place. */
export function installWindowFullscreen(): () => void {
  // Main's own message, like chrome-edge's (ui/chromeEdge.ts), not part of the browser event union that the reducer narrows.
  return window.acira?.subscribeBrowser?.(raw => applyWindowState(document.documentElement, raw as unknown as { type: string; fullscreen?: boolean })) ?? (() => {});
}
