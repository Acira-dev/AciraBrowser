// A screen taller than its window (the expanded checklist, the preview with its safety lines) scrolls inside the popup. Its button row stays at the bottom of
// the visible sheet (transfer.css: `.tx-foot` is sticky); while the content still runs on beneath it, the row gets the sheet's glass behind it. This only sets
// `data-floating` on the sheet root: true while there is more to scroll below. (Design question 7 of the design notes.)
import { useEffect, type RefObject } from 'react';

export function usePinnedFoot(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = root.current;
    const scroller = node?.closest<HTMLElement>('.popup-scroll');
    if (!node || !scroller) return undefined;
    const update = () => { node.toggleAttribute('data-floating', scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 2); };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    sizes?.observe(scroller); sizes?.observe(node);
    const changes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    changes?.observe(node, { childList: true, subtree: true });
    return () => { scroller.removeEventListener('scroll', update); sizes?.disconnect(); changes?.disconnect(); node.removeAttribute('data-floating'); };
  }, [root]);
}
