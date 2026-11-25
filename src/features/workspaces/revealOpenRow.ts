import { useLayoutEffect, type RefObject } from 'react';

/**
 * A workspace list can be longer than its pop-up (16 workspaces are 44 px each, the pop-up never taller than the window), so the pop-up scrolls.
 * On opening, the open workspace's row is scrolled to the middle of the visible part when it would otherwise start below the fold,
 * so the check mark is the first thing seen. Nothing moves when the row is already in view.
 */
export function useRevealOpenRow(root: RefObject<HTMLElement | null>, selector: string): void {
  useLayoutEffect(() => {
    const node = root.current, scroller = node?.closest<HTMLElement>('.popup-scroll');
    if (!node || !scroller) return undefined;
    const reveal = () => {
      const row = node.querySelector<HTMLElement>(selector);
      if (!row || scroller.scrollHeight <= scroller.clientHeight + 1) return;
      const view = scroller.getBoundingClientRect(), box = row.getBoundingClientRect(), margin = 24;
      if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;
      scroller.scrollTop += (box.top + box.height / 2) - (view.top + view.height / 2);
    };
    // The pop-up is sized by main a frame after it mounts: reveal again once it has its height.
    reveal();
    const frame = requestAnimationFrame(() => { reveal(); });
    const later = window.setTimeout(reveal, 120);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(later); };
  }, [root, selector]);
}
