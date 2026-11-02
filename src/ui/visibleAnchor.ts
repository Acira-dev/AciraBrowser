import type { Rectangle } from '../runtime/types';

type Box = { x: number; y: number; width: number; height: number };
type Edges = { left: number; top: number; right: number; bottom: number };
/** The parts of an element clipOf reads (an HTMLElement has them; tests pass plain objects). */
export type ClipNode = { parentElement: ClipNode | null; getBoundingClientRect(): Box };
export type Overflow = (node: ClipNode) => { overflowX: string; overflowY: string };

/** Less than this much of a strip item in view (CSS px) and a popup no longer hangs from it: a sliver is nothing to point at. */
export const MIN_VISIBLE = 12;

/** Where anything inside `node` can be seen: the window cut by every ancestor that clips its overflow on an axis (a tab
 * strip's scrolling viewport, the compact row's, the sidebar's list). */
export function clipOf(node: ClipNode, viewport: { width: number; height: number }, overflow: Overflow): Edges {
  const clip = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  for (let el = node.parentElement; el; el = el.parentElement) {
    const style = overflow(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const b = el.getBoundingClientRect();
    if (style.overflowX !== 'visible') { clip.left = Math.max(clip.left, b.x); clip.right = Math.min(clip.right, b.x + b.width); }
    if (style.overflowY !== 'visible') { clip.top = Math.max(clip.top, b.y); clip.bottom = Math.min(clip.bottom, b.y + b.height); }
  }
  return clip;
}

export type VisibleAnchor = { rect: Rectangle; via: 'item' | 'part' | 'control' | 'edge' };
/** R7 (compact strip, narrow window, 150%): a group's editor opened under the part of its chip the strip had scrolled out of
 * view. What a popup anchored on a strip item hangs from instead, given the item's box (where it settles: settledBox) and
 * the clip it is seen through:
 * - the whole item when it is all in view;
 * - the part in view when at least MIN_VISIBLE px of it shows (the editor's edge meets what the person can see and click);
 * - else the strip's overflow control on the side the item went (‹ before it, › after it) when that control is shown;
 * - else the clip's own edge on that side, never the hidden item. */
export function visibleAnchor(box: Box, clip: Edges, controls: { before?: Box | null; after?: Box | null } = {}): VisibleAnchor {
  const left = Math.max(box.x, clip.left), right = Math.min(box.x + box.width, clip.right), top = Math.max(box.y, clip.top), bottom = Math.min(box.y + box.height, clip.bottom);
  const wide = right - left, tall = bottom - top;
  if (wide >= box.width - .5 && tall >= box.height - .5) return { rect: box, via: 'item' };
  const enoughWide = wide >= Math.min(MIN_VISIBLE, box.width), enoughTall = tall >= Math.min(MIN_VISIBLE, box.height);
  if (enoughWide && enoughTall) return { rect: { x: left, y: top, width: wide, height: tall }, via: 'part' };
  // Out of view: along the axis that hid it (a horizontal strip, or a vertical list), before or after what shows.
  const horizontal = !enoughWide;
  const before = horizontal ? box.x + box.width / 2 < (clip.left + clip.right) / 2 : box.y + box.height / 2 < (clip.top + clip.bottom) / 2;
  const control = before ? controls.before : controls.after;
  if (control && control.width >= MIN_VISIBLE && control.height >= MIN_VISIBLE / 2) return { rect: { x: control.x, y: control.y, width: control.width, height: control.height }, via: 'control' };
  const span = (lo: number, hi: number, at: number, size: number) => { const length = Math.max(0, Math.min(size, hi - lo)); return { at: Math.min(Math.max(at, lo), Math.max(lo, hi - length)), length }; };
  if (horizontal) {
    const y = span(clip.top, clip.bottom, box.y, box.height), width = Math.max(0, Math.min(MIN_VISIBLE, clip.right - clip.left));
    return { rect: { x: before ? clip.left : clip.right - width, y: y.at, width, height: y.length }, via: 'edge' };
  }
  const x = span(clip.left, clip.right, box.x, box.width), height = Math.max(0, Math.min(MIN_VISIBLE, clip.bottom - clip.top));
  return { rect: { x: x.at, y: before ? clip.top : clip.bottom - height, width: x.length, height }, via: 'edge' };
}
