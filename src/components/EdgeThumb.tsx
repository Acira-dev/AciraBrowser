import { useEffect, useRef, type RefObject } from 'react';
import '../styles/scroll-region.css';

/**
 * Rule 12 (Beta 14, the team's, universal): a scrollbar stays hidden until the pointer is near the edge it sits on, or while the
 * list scrolls, then fades in and out. One thin overlay thumb for every scroller that has one: the pop-ups' ScrollRegion, the sidebar's
 * list, the Now Playing list, the cover grids. The Favorites panel's rule: it shows while the list scrolls (and 0.9 s after) and while the
 * pointer is within 22px of the scroller's right edge, never for a pointer elsewhere over the list; leaving the list fades it.
 *
 * Put it right after the scroller, inside a `position: relative` parent (it is absolutely placed there and takes no room). `inset` is the
 * clear space kept at both ends of the track. The geometry is worked out when the thumb is about to show, so a list that grows and
 * shrinks costs nothing while the thumb is away.
 */
export const EDGE_ZONE = 22;
export const FLASH_MS = 900;

export const EDGE_BEYOND = 12;

/** `region`: a selector for an ancestor whose pointer events count (the sidebar's resize strip lies over its list's right edge and takes the pointer there, so the sidebar as a whole listens). */
export function EdgeThumb({ scroller, inset = 6, region }: { scroller: RefObject<HTMLElement | null>; inset?: number; region?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scroller.current, thumb = bar.current;
    if (!node || !thumb) return;
    const listener = (region ? node.closest<HTMLElement>(region) : null) ?? node;
    let timer = 0, near = false;
    const show = (on: boolean) => thumb.toggleAttribute('data-show', on);
    /** Size and place the thumb for the list as it is now; false when nothing scrolls. */
    const place = () => {
      const max = node.scrollHeight - node.clientHeight;
      if (max <= 1) { thumb.style.display = 'none'; return false; }
      const track = Math.max(0, node.clientHeight - inset * 2), size = Math.min(track, Math.max(24, track * node.clientHeight / node.scrollHeight));
      thumb.style.display = '';
      thumb.style.top = node.offsetTop + inset + 'px';
      thumb.style.height = size + 'px';
      thumb.style.transform = `translateY(${(track - size) * Math.min(1, Math.max(0, node.scrollTop / max))}px)`;
      return true;
    };
    const flash = () => {
      if (!place()) { show(false); return; }
      show(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => { if (!near) show(false); }, FLASH_MS);
    };
    const move = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      const close = event.clientX > box.right - EDGE_ZONE && event.clientX < box.right + EDGE_BEYOND && event.clientY >= box.top && event.clientY <= box.bottom;
      if (close === near) return;
      near = close;
      clearTimeout(timer);
      if (close) { if (place()) show(true); } else timer = window.setTimeout(() => show(false), 250);
    };
    const leave = () => { near = false; clearTimeout(timer); timer = window.setTimeout(() => show(false), 120); };
    node.addEventListener('scroll', flash, { passive: true });
    listener.addEventListener('pointermove', move, { passive: true });
    listener.addEventListener('pointerleave', leave);
    return () => {
      clearTimeout(timer);
      node.removeEventListener('scroll', flash);
      listener.removeEventListener('pointermove', move);
      listener.removeEventListener('pointerleave', leave);
    };
  }, [scroller, inset, region]);
  return <div ref={bar} className="edge-thumb" aria-hidden="true" style={{ display: 'none' }} />;
}
