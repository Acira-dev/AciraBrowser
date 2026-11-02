import type { Rectangle } from '../runtime/types';

/** A form is adjacent only when it fits at its useful width. Narrow windows keep
 * a complete form over the parent panel, never a clipped sliver beside it. */
export function menuFormGeometry(parent: Rectangle, trigger: Rectangle, viewport: { width: number; height: number }, naturalHeight: number, rtl = false, limits: {top?:number;bottom?:number} = {}) {
  const edge = 12, gap = 8, width = Math.min(320, viewport.width - edge * 2);
  const top = Math.max(edge, limits.top ?? edge), bottom = Math.min(viewport.height - edge, limits.bottom ?? viewport.height - edge);
  const height = Math.min(naturalHeight, Math.max(1, bottom - top));
  const right = parent.x + parent.width + gap, left = parent.x - gap - width;
  const fitsRight = right + width <= viewport.width - edge, fitsLeft = left >= edge;
  const side = rtl ? fitsLeft ? 'left' : fitsRight ? 'right' : 'replace' : fitsRight ? 'right' : fitsLeft ? 'left' : 'replace';
  const x = side === 'left' ? left : side === 'right' ? right : Math.max(edge, Math.min(parent.x, viewport.width - width - edge));
  const y = Math.max(top, Math.min(side === 'replace' ? parent.y : trigger.y, bottom - height));
  return { side, bounds: { x, y, width, height }, maxHeight: bottom - top } as const;
}
