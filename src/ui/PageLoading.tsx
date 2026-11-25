import { useEffect, useState } from 'react';
import { DotMatrix } from '../components/DotMatrix';
import { usePageBlank } from './chromeEdge';

/** How long a page may stay blank before the loader shows: a page that draws within this never shows it (at 150 ms every ordinary load blinked one). */
export const PAGE_WAIT_MS = 400;

/**
 * D151 (reported 23 Nov: "if it's gonna take time because I haven't loaded it for a long time, at least put maybe just like a loading
 * [state]"): while the page on show has nothing to show yet (a tab restored or woken that loads on a slow line; main's `page-blank`,
 * desktop/page-blank.cjs), the page area is its own one surface, and once it has been blank for PAGE_WAIT_MS the tab row's own loader
 * stands at its centre: the same 5 x 5 DotMatrix loader in the same colour and motion, at twice its size (28 px for the row's 14). It fades in
 * over 150 ms (page-loading.css) and goes with the page's first content, in the same switch as the cover. Under a floating sidebar the surface
 * covers the page hole (sidebar-overlay.css); docked, it shows through the page view that has not drawn. Nothing runs before it shows (the
 * matrix is not mounted during the wait) or while the window is hidden (the DotMatrix loop stops). Reduce Motion: the loader's still frame.
 */
export function PageLoading({ tabId, reduced }: { tabId: string; reduced: boolean }) {
  const blank = usePageBlank(tabId), [late, setLate] = useState(false);
  useEffect(() => {
    if (!blank) { setLate(false); return; }
    const timer = window.setTimeout(() => setLate(true), PAGE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [blank]);
  if (!blank || !late || (globalThis as unknown as { __pageWaitOff?: boolean }).__pageWaitOff === true /* rig only: the blank page without the loader, for the CPU comparison */) return null;
  return <span className="page-wait" aria-hidden="true"><DotMatrix preset="loader" size={28} rows={5} cols={5} reducedMotion={reduced} /></span>;
}
