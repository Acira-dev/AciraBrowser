import { useSyncExternalStore } from 'react';

/** True while a toast is on screen. Toasts rise from the bottom of the page area, so a list page (History, Bookmarks, Downloads) adds bottom
 *  padding while one shows: scrolled to the end, the last row still sits clear of it instead of underneath. App publishes it. */
let active = false;
const listeners = new Set<() => void>();
export function setToastActive(next: boolean): void {
  if (active === next) return;
  active = next;
  listeners.forEach(listener => listener());
}
export const useToastActive = (): boolean => useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => active, () => false);
