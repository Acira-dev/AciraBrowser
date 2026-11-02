'use strict';
// Where a popup sits once its page has measured its content (desktop/main.cjs, acira:set-layout from the overlay view).
// Pure, in DIPs. The margins and gaps are CSS pixels of the interface (src/ui/popup.ts popupGeometry uses 8 / 2 / 12 / 20 / 24 / 60 / 100 / 120 / 280),
// so they scale with the interface: at 150% the gap under a trigger is 12 DIP, not 8. Using bare DIP constants here put a measured popup 4 DIP away from
// where the renderer had placed it, so the first measure (or a child flyout opening) made the panel jump at every fractional interface scale.
// At scale 1 every result equals the old inline formulas (tests/popup-measure.test.cjs pins that).

/** `current` is the popup's layout in DIPs, `height` its measured content height in DIPs, `lockedTop` the tab viewer's remembered top. */
function measuredPlacement({current, height, windowHeight, scale = 1, lockedTop}) {
  const px = value => value * scale;
  const anchor = current.anchor || current.bounds;
  const below = windowHeight - anchor.y - anchor.height - px(20), above = anchor.y - px(20);
  // A point anchor (a right-click, a new group's editor beside its sidebar header) is 2 CSS px: 3 DIP at 150%.
  const point = anchor.width <= px(2) + .01 && anchor.height <= px(2) + .01, gap = px(point ? 2 : 8);
  const up = below < (point ? height : Math.min(height, px(280))) && above > below;
  const centered = current.origin?.x === .5 && current.origin?.y === .5, keepTop = current.kind === 'palette';
  const h = Math.min(height, centered || keepTop ? windowHeight - px(120) : Math.max(px(100), up ? above : below), windowHeight - px(24));
  const y = keepTop
    ? Math.max(px(12), Math.min(windowHeight - h - px(12), current.bounds.y))
    : centered
      ? Math.max(px(60), Math.min(windowHeight - h - px(12), lockedTop !== undefined ? lockedTop : (windowHeight - h) / 2))
      : Math.max(px(12), Math.min(up ? anchor.y - h - gap : anchor.y + anchor.height + gap, windowHeight - h - px(12)));
  // Same measured height as the layout already carries (a child flyout opening or closing only changes the input area): nothing to place again.
  const unchanged = !centered && !keepTop && Math.abs((current.contentHeight || 0) - height) < .5;
  return {y, h, up, centered, keepTop, unchanged};
}

/** The popup's host bounds on whole device pixels: x, y, width and height rounded once, where the renderer's CSS pixels become DIPs. */
function snapBounds(bounds) {
  if (!bounds) return bounds;
  return {...bounds, ...Object.fromEntries(['x', 'y', 'width', 'height'].filter(key => typeof bounds[key] === 'number').map(key => [key, Math.round(bounds[key])]))};
}
function snapOverlay(layout) {
  if (!layout?.overlay) return layout;
  const overlay = {...layout.overlay, bounds: snapBounds(layout.overlay.bounds)};
  if (layout.overlay.auxiliaryBounds) overlay.auxiliaryBounds = snapBounds(layout.overlay.auxiliaryBounds);
  return {...layout, overlay};
}

/** Windows keeps its caption above child views. A tall sheet must fit below
 * the browser header instead of moving its first fields underneath that frame.
 * Called only on Windows, after CSS coordinates have been scaled to DIPs. */
function fitWindowsOverlay(layout, [windowWidth, windowHeight], scale = 1) {
  if (!layout?.overlay) return layout;
  const margin = Math.round(12 * scale);
  const header = Math.max(layout.captionHeight || 0, layout.pageBounds?.y || 0);
  const top = Math.min(windowHeight - margin - 1, Math.max(margin, Math.ceil(header + 8 * scale)));
  const fit = box => {
    const width = Math.max(1, Math.min(Math.round(box.width), windowWidth - 2 * margin));
    const height = Math.max(1, Math.min(Math.round(box.height), windowHeight - top - margin));
    return {...box, width, height,
      x: Math.max(margin, Math.min(Math.round(box.x), windowWidth - width - margin)),
      y: Math.max(top, Math.min(Math.round(box.y), windowHeight - height - margin))};
  };
  const bounds = fit(layout.overlay.bounds);
  const auxiliaryBounds = layout.overlay.auxiliaryBounds && fit(layout.overlay.auxiliaryBounds);
  if (JSON.stringify(bounds) === JSON.stringify(layout.overlay.bounds) && JSON.stringify(auxiliaryBounds) === JSON.stringify(layout.overlay.auxiliaryBounds)) return layout;
  return {...layout, overlay: {...layout.overlay, bounds, ...(auxiliaryBounds ? {auxiliaryBounds} : {})}};
}

module.exports = {measuredPlacement, snapBounds, snapOverlay, fitWindowsOverlay};
