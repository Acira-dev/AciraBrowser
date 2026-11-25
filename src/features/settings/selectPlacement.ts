// D195 (Beta 14.5): where a Settings dropdown's list sits. The trigger and the Settings host are measured with getBoundingClientRect (what is on screen) and the list is positioned inside the host with
// left/top/bottom (the host's own CSS pixels). An internal page can carry CSS `zoom` (.page-zoom-content takes the tab's zoom, a Chromium profile imported with a page zoom brings one): the two are then different
// units, every offset came out `zoom` times too large, and the list landed far to the bottom right of its trigger (further from the host's corner, the further off), or outside the host's overflow so that it did not
// show at all (the Layout page). `scale` is the host's on-screen size over its own layout size; every length that goes into the style is divided by it.
export interface Box { left: number; top: number; right: number; bottom: number; width: number }
export const LIST_GAP = 6, LIST_EDGE = 8;

/** The host's zoom: its drawn width over its layout width (1 when it cannot be read or is not scaled). */
export function hostScale(drawnWidth: number, layoutWidth: number): number {
  const scale = layoutWidth > 0 ? drawnWidth / layoutWidth : 1;
  return Number.isFinite(scale) && scale > 0.05 && Math.abs(scale - 1) > 0.002 ? scale : 1;
}

export function selectListBox({ rect, host, window: view, height, listWidth = 0, scale = 1 }: { rect: Box & { height?: number }; host: Box | null; window: { width: number; height: number }; height: number; listWidth?: number; scale?: number }) {
  const left = host?.left ?? 0, top = host?.top ?? 0;
  const right = Math.min(view.width, host?.right ?? view.width), bottom = Math.min(view.height, host?.bottom ?? view.height);
  const below = bottom - rect.bottom - LIST_EDGE, above = rect.top - Math.max(0, top) - LIST_EDGE;
  const visibleHeight = height * scale;
  const up = below < visibleHeight && above > below;
  const room = Math.max(0, Math.min(visibleHeight, up ? above : below));
  const width = Math.max(rect.width, listWidth);
  const x = Math.max(LIST_EDGE, Math.min(rect.left - left, right - left - width - LIST_EDGE));
  return { left: x / scale, minWidth: rect.width / scale, maxHeight: room / scale, up, ...(up ? { bottom: ((host?.bottom ?? view.height) - rect.top + LIST_GAP) / scale } : { top: (rect.bottom - top + LIST_GAP) / scale }) };
}
