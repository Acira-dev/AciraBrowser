'use strict';
// Where an extension's toolbar popup opens.
//
// electron-chrome-extensions 4.9.0 puts the popup's window at `window.x + anchor.x` (alignment "right": its left edge on the icon's left edge,
// the popup runs to the right) or at the icon's right edge minus the popup's width, and never looks at the window or the screen. The anchor
// is also what the interface page measured: CSS pixels of a page that Acira zooms with its Interface size (80-150 %), not the DIPs of the
// window, and the window origin it adds is `getBounds()` plus a guessed title bar. On Windows the toolbar sits at the right end of the window,
// so Bitwarden's 480 px popup started at the icon and ended far past the window and the screen (Discord, 6 Nov 2026, 0.1.0-beta.10).
//
// placePopup() is the pure placement (DIPs on the screen); extension-popup-window.cjs calls it on every size change, because
// extension-action-sizing.cjs resizes the popup after it has loaded.
// Chrome's rule: the popup hangs under the icon with its right edge on the icon's right edge when the icon is in the right half of the window
// (the toolbar's end), on its left edge when it is in the left half; whichever side has no room, it flips, and it slides in before it leaves.
// The gap under the icon and the margin to the window's edges are Acira's own menus' (src/ui/popup.ts popupGeometry: 8 px under the trigger, 12 px
// from the edges), in CSS pixels of the interface, so they grow with Interface size like the menus do.
const GAP = 8;      // CSS px between the icon and the popup, as the menus
const MARGIN = 12;  // CSS px the popup keeps from the window's edges and the screen's bottom, as the menus
const whole = value => Math.round(value);

/** The nearest start in [min, max - length]; a span that does not fit begins at min. */
function fitSpan(start, length, min, max) {
  if (length >= max - min) return min;
  return Math.min(Math.max(start, min), max - length);
}

/**
 * anchor, window, area: {x, y, width, height} in screen DIPs (the icon, the browser window's content, the display's work area).
 * size: {width, height} of the popup. scale: Acira's Interface size as a factor (1 = 100 %).
 * Returns {x, y, side: 'below' | 'above' | 'shifted', direction: 'right' | 'left', clamped: boolean}: 'left' = the popup runs left from the icon (its
 * right edge on the icon's right edge), 'right' = it runs right from the icon's left edge.
 */
function placePopup({anchor, size, window, area, scale = 1}) {
  const {width, height} = size, gap = GAP * scale, margin = MARGIN * scale;
  // Sideways the popup stays inside the browser window (the toolbar spans it) and inside the screen; a window narrower than the popup is
  // limited by the screen alone.
  let low = Math.max(window.x, area.x) + margin, high = Math.min(window.x + window.width, area.x + area.width) - margin;
  if (high - low < width) { low = area.x; high = area.x + area.width; }
  const starts = {right: anchor.x, left: anchor.x + anchor.width - width};
  const inRightHalf = anchor.x + anchor.width / 2 > window.x + window.width / 2;
  const order = inRightHalf ? ['left', 'right'] : ['right', 'left'];
  let direction = order[0], x = fitSpan(starts[direction], width, low, high), shift = Math.abs(x - starts[direction]);
  if (shift > 0) {  // not where the icon wants it: the other side when that fits better (flip), else the least shifted
    const other = order[1], otherX = fitSpan(starts[other], width, low, high), otherShift = Math.abs(otherX - starts[other]);
    if (otherShift < shift) { direction = other; x = otherX; shift = otherShift; }
  }
  // Downwards the popup stays on the screen (a popup may hang below a short window, as Chrome's do).
  const top = area.y, bottom = area.y + area.height - margin;
  const below = anchor.y + anchor.height + gap, above = anchor.y - gap - height;
  let y = below, side = 'below';
  if (below + height > bottom) {
    // A toolbar on the lower half of the screen opens upwards when it fits; one on top keeps the popup under the icon and slides it up.
    if (above >= top && anchor.y + anchor.height / 2 > top + (area.height) / 2) { y = above; side = 'above'; }
    else { y = fitSpan(below, height, top, bottom); side = 'shifted'; }
  }
  return {x: whole(x), y: whole(y), side, direction, clamped: shift > 0};
}

const INTERFACE = /^acira-browser-ui:\/\/ui\/index\.html(?!\?view=overlay)/;
/** The interface page's zoom factor = Acira's Interface size (main.cjs sets it on the views of the window): CSS pixels of that page to DIPs. */
function interfaceScale(window) {
  const seen = [];
  const walk = (view, depth) => {
    if (!view || depth > 4) return;
    seen.push(view);
    for (const child of view.children || []) walk(child, depth + 1);
  };
  try { walk(window?.contentView, 0); } catch { return 1; }
  for (const view of seen) {
    try {
      const contents = view.webContents;
      if (contents && !contents.isDestroyed() && INTERFACE.test(contents.getURL())) {
        const factor = contents.getZoomFactor();
        if (Number.isFinite(factor) && factor > 0) return factor;
      }
    } catch { /* a view that is going away */ }
  }
  return 1;
}

/** The icon's rectangle on the screen, in DIPs: the page's CSS pixels x the interface scale, from the window's own content origin. */
function anchorOnScreen(rectangle, window, scale) {
  const origin = window.getContentBounds();
  return {x: origin.x + rectangle.x * scale, y: origin.y + rectangle.y * scale, width: rectangle.width * scale, height: rectangle.height * scale};
}

module.exports = {placePopup, interfaceScale, anchorOnScreen, fitSpan, GAP, MARGIN};
