import { useSyncExternalStore } from 'react';

/** Beta 14, section AE (flaw 1 of the sample): a carried group's chip follows the pointer anywhere in the window, over the page too. The page is a native view above the interface, so while the pointer is
 *  over it the page yields the way it does for the split picker (App: the native views are taken out and stills of them stand in; the chip, drawn in the interface, is then the topmost thing). The sidebar
 *  says so with this flag; App reads it. */
let over = false;
const listeners = new Set<() => void>();
export function setGroupCarryOverPage(next: boolean) { if (over === next) return; over = next; listeners.forEach(listener => listener()); }
export const useGroupCarryOverPage = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => over);
