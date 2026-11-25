'use strict';
// Where a popup sits once its page has measured its content (desktop/main.cjs, acira:set-layout from the overlay view).
// Pure, in DIPs. The margins and gaps are CSS pixels of the interface (src/ui/popup.ts popupGeometry uses 8 / 2 / 12 / 20 / 24 / 60 / 100 / 120 / 280),
// so they scale with the interface: at 150% the gap under a trigger is 12 DIP, not 8. Using bare DIP constants here put a measured popup 4 DIP away from
// where the renderer had placed it, so the first measure (or a child flyout opening) made the panel jump at every fractional interface scale.
// At scale 1 every result equals the old inline formulas (tests/popup-measure.test.cjs pins that).

/** `current` is the popup's layout in DIPs, `height` its measured content height in DIPs, `lockedTop` the tab viewer's remembered top. */
function measuredPlacement({current, height, windowHeight, scale = 1, lockedTop, page = null}) {
  const px = value => value * scale;
  const anchor = current.anchor || current.bounds;
  const below = windowHeight - anchor.y - anchor.height - px(20), above = anchor.y - px(20);
  // A point anchor (a right-click, a new group's editor beside its sidebar header) is 2 CSS px: 3 DIP at 150%.
  const point = anchor.width <= px(2) + .01 && anchor.height <= px(2) + .01, gap = px(point ? 2 : 8);
  // Easy Files flips on its whole height (src/ui/popup.ts popupGeometry has the same rule): the two can never place it differently.
  const up = below < (point || current.kind === 'easy-files' ? height : Math.min(height, px(280))) && above > below;
  const centered = current.origin?.x === .5 && current.origin?.y === .5, keepTop = current.kind === 'palette';
  const h = Math.min(height, centered || keepTop ? windowHeight - px(120) : Math.max(px(100), up ? above : below), windowHeight - px(24));
  const y = keepTop
    ? Math.max(px(12), Math.min(windowHeight - h - px(12), current.bounds.y))
    : centered
      ? Math.max(px(current.kind === 'dialog' ? 12 : 60), Math.min(windowHeight - h - px(12), lockedTop !== undefined ? lockedTop : current.kind === 'dialog' && page ? (current.context?.dialog?.top ? page.y + px(16) : page.y + (page.height - h) * .44) : (windowHeight - h) / 2))   // Beta 14: a dialog sits 44 % of the free height down the page area (src/ui/popup.ts popupGeometry has the same rule)
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

/** The part of the window's content that is on a screen, sideways, in content coordinates: the content rectangle cut by the work area it overlaps most, along a left or right
 * edge that hangs more than `tolerance` px past that work area (a window dragged past a screen's side; the 8 px a maximised Windows window overhangs is no such window).
 * Only the sides: a popup is already kept inside the window's height, and a window resting over the Dock keeps its popups where they are. Null when no side hangs (nothing
 * to fit), or when so little of the window is on any screen (a hidden test window parked off-screen, a minimised one) that fitting to it would only squeeze the popup. */
function visibleContent(content, workAreas, {minWidth = 400, tolerance = 24} = {}) {
  let best = null, bestArea = 0;
  for (const area of workAreas || []) {
    const width = Math.min(content.x + content.width, area.x + area.width) - Math.max(content.x, area.x), height = Math.min(content.y + content.height, area.y + area.height) - Math.max(content.y, area.y);
    if (width > 0 && height > 0 && width * height > bestArea) { bestArea = width * height; best = area; }
  }
  if (!best) return null;
  const left = content.x < best.x - tolerance ? best.x - content.x : 0;
  const right = content.x + content.width > best.x + best.width + tolerance ? best.x + best.width - content.x : content.width;
  if (!left && right === content.width) return null;
  return right - left >= minWidth ? {x: left, y: 0, width: right - left, height: content.height} : null;
}

/** Shifts a popup (and its child flyout) left, right, up or down until it sits inside `visible` with the interface's 12 px margin, so no row of it is ever on the
 * far side of a screen edge. A popup larger than the visible part is left where it is (it cannot fit; the window must be moved). Pure, in DIPs. A hung-from-anchor
 * popup keeps its anchor and gets the grow-from point recomputed, so the open animation still starts from the control. */
function fitOverlayToVisible(layout, visible, scale = 1) {
  const overlay = layout?.overlay;
  if (!overlay || !visible || !overlay.bounds) return layout;
  const margin = Math.round(12 * scale), boxes = [overlay.bounds, overlay.auxiliaryBounds].filter(Boolean);
  const left = Math.min(...boxes.map(box => box.x)), right = Math.max(...boxes.map(box => box.x + box.width));
  const top = Math.min(...boxes.map(box => box.y)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  const shift = (low, high, from, to) => {
    if (to - from > high - low - 2 * margin) return 0;
    if (from < low + margin) return low + margin - from;
    if (to > high - margin) return high - margin - to;
    return 0;
  };
  const dx = shift(visible.x, visible.x + visible.width, left, right), dy = shift(visible.y, visible.y + visible.height, top, bottom);
  if (!dx && !dy) return layout;
  const move = box => box && {...box, x: box.x + dx, y: box.y + dy};
  const centered = overlay.origin?.x === .5 && overlay.origin?.y === .5, anchor = overlay.anchor;
  const origin = !centered && dx && overlay.origin && anchor && overlay.bounds.width > 0
    ? {...overlay.origin, x: Math.max(0, Math.min(1, (anchor.x + anchor.width / 2 - (overlay.bounds.x + dx)) / overlay.bounds.width))}
    : overlay.origin;
  return {...layout, overlay: {...overlay, bounds: move(overlay.bounds), ...(overlay.auxiliaryBounds ? {auxiliaryBounds: move(overlay.auxiliaryBounds)} : {}), ...(origin ? {origin} : {})}};
}

module.exports = {measuredPlacement, snapBounds, snapOverlay, fitWindowsOverlay, visibleContent, fitOverlayToVisible};
