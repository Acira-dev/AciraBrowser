/* Beta 14: gives the toast host's cards their frosted glass (see toastFrost.ts). Used by the pop-up surface of kind `toast`, which already holds the snapshot's frozen frames.
 * It writes only custom properties and one attribute on the surface (`data-frost`: pending, glass or solid); the cards' look is transient.css. Nothing runs at rest. */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { buildFrost, createFollower, frostAlpha, frostIsSolid, type Frost } from './toastFrost';
import type { BackdropVideo } from './usePopupBackdrop';

export function useToastFrost({ root, enabled, videos, status, dark, glass }: { root: RefObject<HTMLElement | null>; enabled: boolean; videos: BackdropVideo[]; status: 'pending' | 'live' | 'native'; dark: boolean; glass: number }) {
  const frost = useRef<Frost | null>(null), follower = useRef<ReturnType<typeof createFollower> | null>(null);
  // the picture: built once per snapshot (and per theme), never per frame
  useLayoutEffect(() => {
    const node = root.current; if (!node || !enabled) return;
    const solid = frostIsSolid(glass);
    const frames = videos.map(item => ({ canvas: item.frame as CanvasImageSource | undefined, bounds: item.source.bounds }));
    const ready = status === 'live' && !solid && frames.length > 0 && frames.every(frame => frame.canvas);
    const old = frost.current; frost.current = null;
    if (ready) {
      // the window: the biggest view the frames were cut from (the interface's)
      const views = videos.map(item => item.source.sourceBounds).filter((box): box is NonNullable<typeof box> => !!box), win = views.length ? views.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)) : null;
      const made = buildFrost(frames as { canvas: CanvasImageSource; bounds: typeof frames[number]['bounds'] }[], dark, win);
      if (made) {
        frost.current = made;
        node.style.setProperty('--tf-img', `url(${made.url})`); node.style.setProperty('--tf-w', made.width + 'px'); node.style.setProperty('--tf-h', made.height + 'px');
        node.dataset.frost = 'glass'; follower.current?.kick();
        old?.release(); return;
      }
    }
    node.style.removeProperty('--tf-img'); node.style.removeProperty('--tf-w'); node.style.removeProperty('--tf-h');
    // not yet decoded: pending (the card is the solid until the glass lands); no snapshot, or the slider at an end, or reduced transparency: the solid for good, never see-through
    node.dataset.frost = !solid && status === 'pending' ? 'pending' : 'solid';
    old?.release();
  }, [root, enabled, videos, status, dark, glass]);
  useLayoutEffect(() => { const node = root.current; if (node && enabled) node.style.setProperty('--tf-a', frostAlpha(dark, glass).toFixed(3)); }, [root, enabled, dark, glass]);
  // the cards' offsets: written while a card moves, then left alone
  useLayoutEffect(() => {
    const node = root.current; if (!node || !enabled) return;
    const run = createFollower(() => {
      const made = frost.current; if (!made) return null;
      const box = node.getBoundingClientRect(), x = parseFloat(node.style.getPropertyValue('--popup-x')), y = parseFloat(node.style.getPropertyValue('--popup-y'));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { cards: Array.from(node.querySelectorAll<HTMLElement>('.t-toast')), surface: { x: box.x, y: box.y }, popup: { x, y }, frost: { x: made.x, y: made.y } };
    });
    follower.current = run;
    // the cards move by style (the spring) and by a CSS transition on a custom property (the stack shifting): any change under the surface starts the follower, which then ends itself
    const watch = new MutationObserver(records => { if (records.some(record => !(record.target instanceof HTMLElement && record.target.classList.contains('t-toast')))) run.kick(); });
    watch.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'data-expanded'] });
    run.kick();
    return () => { watch.disconnect(); run.stop(); follower.current = null; };
  }, [root, enabled]);
  useLayoutEffect(() => () => { frost.current?.release(); frost.current = null; }, []);
}
