/** The arithmetic of a pinch over one of Acira's own pages (ui/pageMagnify.ts draws it): no DOM, so it is tested on its own. */
/** Chromium's visual-viewport limits for a website (setVisualZoomLevelLimits(1,5) in main.cjs). */
export const MAGNIFY_MAX = 5;
export interface Magnify { scale: number; x: number; y: number }
export interface Box { width: number; height: number }
export const NO_MAGNIFY: Magnify = { scale: 1, x: 0, y: 0 };

/** The scaled page is `scale` times the box; its offset keeps the box inside it. */
const clampOffset = (offset: number, size: number, scale: number) => Math.min(0, Math.max(size * (1 - scale), offset));

/** A pinch's wheel delta is 100 x ln(scale) (as for Acira's page zoom): the point under `focus` (in the box) stays under the fingers. */
export function magnifyBy(current: Magnify, deltaY: number, focus: { x: number; y: number }, box: Box): Magnify {
  const scale = Math.max(1, Math.min(MAGNIFY_MAX, current.scale * Math.exp(-deltaY / 100)));
  if (scale < 1.001) return NO_MAGNIFY;
  const px = (focus.x - current.x) / current.scale, py = (focus.y - current.y) / current.scale;
  return { scale, x: clampOffset(focus.x - px * scale, box.width, scale), y: clampOffset(focus.y - py * scale, box.height, scale) };
}

/** Two-finger scroll over a magnified page pans the magnified view first; what it cannot move (the view is at the page's edge) is returned, to scroll the page. */
export function panMagnify(current: Magnify, dx: number, dy: number, box: Box): { magnify: Magnify; restX: number; restY: number } {
  const x = clampOffset(current.x - dx, box.width, current.scale), y = clampOffset(current.y - dy, box.height, current.scale);
  return { magnify: { scale: current.scale, x, y }, restX: dx - (current.x - x), restY: dy - (current.y - y) };
}
