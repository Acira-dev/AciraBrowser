import { useLayoutEffect, useRef, type RefObject } from 'react';
import { edgeLightY } from '../../ui/edgeLight';
import { placeEdgeLight } from '../../ui/siteGlowEngine';

/**
 * The edge light follows the selected tab (Beta 14, F5; styles/site-glow.css). Every render of the sidebar it finds the selected row (else the selected Favorites tile) and writes its centre
 * as `--ab-edge-y` on the sidebar's light layers. A change of SELECTION glides there on the same spring and time as the raised card that glides to the row (`ms`, `easing`: the caller's
 * own), so the light and the card arrive together; a scroll or a resize moves it at once (it never lags a drag). The row's own flip transform is taken out: the light goes to where the row
 * will rest, not to where it is passing. Reduced motion: no glide.
 */
export function useEdgeLight(scroller: RefObject<HTMLElement | null>, ms: () => number, easing: string): void {
  const last = useRef<{ el: Element | null; y: number }>({ el: null, y: NaN });
  const measure = (selectionMayHaveChanged: boolean) => {
    const side = scroller.current?.closest<HTMLElement>('.acira-sidebar');
    if (!side) return;
    const row = side.querySelector<HTMLElement>('.sb-tab[aria-current=true]:not([data-hidden])') ?? side.querySelector<HTMLElement>('.sb-app[aria-current=page]');
    const s = side.getBoundingClientRect();
    let y = edgeLightY(null, { top: s.top, height: s.height });
    if (row) {
      const r = row.getBoundingClientRect(), t = getComputedStyle(row).transform, lift = t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
      y = edgeLightY({ top: r.top - lift, height: r.height }, { top: s.top, height: s.height });
    }
    const before = last.current;
    if (Math.abs(y - before.y) < .5 && row === before.el) return;
    const glide = selectionMayHaveChanged && Number.isFinite(before.y) && row !== before.el && ms() > 0;
    last.current = { el: row, y };
    placeEdgeLight(y, glide ? { ms: ms(), easing } : undefined);
  };
  useLayoutEffect(() => { measure(true); });
  useLayoutEffect(() => {
    const box = scroller.current, side = box?.closest<HTMLElement>('.acira-sidebar');
    if (!box || !side) return undefined;
    const onScroll = () => measure(false);
    box.addEventListener('scroll', onScroll, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure(false)) : null;
    resize?.observe(side);
    return () => { box.removeEventListener('scroll', onScroll); resize?.disconnect(); };
  }, [scroller.current]);
}
