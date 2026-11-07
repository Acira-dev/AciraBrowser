import { useEffect, useRef } from 'react';
import { runtime } from '../runtime/client';
import { choosesPage } from './pagePick';

/** Installed once by the app: after a press that chose a page, main puts the keyboard on the tab on screen. */
export function usePageFocusOnPick(activeTabId: string): void {
  const latest = useRef(activeTabId);
  latest.current = activeTabId;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!latest.current || !choosesPage(event)) return;
      try { void runtime.browserCommand({ type: 'focus-page', tabId: latest.current }).catch(() => {}); } catch { /* not in a window that can say */ }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
