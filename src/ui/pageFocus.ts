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
    // E7 (17 Nov): main asks (window.__aciraPointerHeld, desktop/page-focus.cjs) whether a primary button is down before it hands the keyboard to a page that a press chose:
    // given the keyboard then, the interface window blurred under the drag that press was starting. The window's own blur clears it too (element blurs do not bubble: only the window's reaches here).
    const flag = window as unknown as { __aciraPointerHeld?: boolean };
    const down = (event: PointerEvent) => { if (event.button === 0) flag.__aciraPointerHeld = true; };
    const up = () => { flag.__aciraPointerHeld = false; };
    window.addEventListener('pointerdown', down, true);
    for (const type of ['pointerup', 'pointercancel', 'dragend'] as const) window.addEventListener(type, up, true);
    window.addEventListener('blur', up);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('pointerdown', down, true);
      for (const type of ['pointerup', 'pointercancel', 'dragend'] as const) window.removeEventListener(type, up, true);
      window.removeEventListener('blur', up);
      flag.__aciraPointerHeld = false;
    };
  }, []);
}
