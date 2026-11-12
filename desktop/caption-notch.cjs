'use strict';
// Windows, Sidebar mode: the page goes to the top of the window and the three caption buttons (minimise, maximise, close) sit in a small notch at its top-right
// corner. The notch is the window's own caption overlay (platform.cjs titleBarOverlay: native buttons, so dragging, double-click to maximise and Windows' snap
// layouts on the maximise button keep working), drawn in the frame's colour over the page. It shows ONLY while the pointer is along the top of the window and is
// transparent the rest of the time (reported 7 Nov 2026).
//
// The page is a native view stacked above the interface, so the interface never sees the pointer at the window's top edge: main watches the cursor, as it does for
// Seamless's edges. The rules are Seamless's top edge, unchanged (edge-reveal.cjs: rest in the top 8 px for 90 ms, a fast arrival or a push against the edge for 40 ms, a
// pass along the edge is not a rest, a grace before it goes, a lock-out against flicker, nothing while a button is held, the corner where the buttons are shows at once
// so they are back under the pointer before a click can land where they were). Only what they act on differs: here the controller's "top" is the caption overlay, not a
// toolbar, and nothing in the interface changes, so there is no layout move, view transition or repaint to get wrong.
//
// A hidden notch is a dead corner (the overlay is native and takes the pointer), which is why the corner itself shows it: a page's own top-right control can never be
// clicked "through" an invisible button. While it is hidden, minimise and maximise are switched off and close is refused (caption-guard.cjs, main.cjs's 'close'
// handler). The buttons are switched on or off only while the overlay is transparent and in the same tick as its colours, so the notch appears and goes as ONE
// piece (a 200 ms delayed switch-on made every reveal a narrow box with two buttons, then a wider one with three: founder's recording of beta.13).

const { createEdgeController } = require('./edge-reveal.cjs');

/** The notch: three 46 px buttons wide, 34 px tall. The interface's NOTCH_HEIGHT (src/ui/addressInSidebar.ts) is the same number: it is the caption overlay's height. */
const NOTCH = { width: 138, height: 34 };
/** The corner that shows a hidden notch at once (a little wider and taller than the buttons: the pointer is never over an invisible button). */
const CORNER = { width: 144, height: 36 };

/** One per window. `sample()` is called every poll with what main can see and returns whether the notch shows.
 * Input: point (global cursor, DIPs, or null), bounds (the window's content bounds), focused, suspended (minimised, fullscreen, an HTML-fullscreen page), active (this
 * window is in Sidebar mode on Windows), hidden (the notch is hidden now: the corner shows it), speed ('premium' | 'fast' | 'off'), pressed (a button is held). */
function createCaptionNotch({ now = Date.now } = {}) {
  const edge = createEdgeController({ now });
  return {
    sample({ point, bounds, focused, suspended, active, hidden, speed, pressed }) {
      return edge.sample({
        point, bounds, band: 0, focused, speed, pressed: !!pressed,
        suspended: !active || !!suspended,
        // The controller's Seamless top edge with the side edge off: the notch is the only thing it reveals.
        view: 'seamless', vertical: true, docked: true, edges: { top: true, side: false }, peek: {},
        keys: { top: false, side: false }, holds: { top: false, side: false }, engaged: false,
        // Keeping it open: the pointer anywhere in the band the notch hangs in (plus the controller's own leeway), so the buttons can be reached.
        size: { topHeight: NOTCH.height, sideWidth: 0 },
        caption: hidden ? { ...CORNER } : null,
      }).top;
    },
    /** Hide now (Esc is not needed: the pointer leaving does it); it stays hidden until the pointer has left the zone. */
    dismiss() { edge.dismiss('top'); },
    /** Is the notch showing or about to (the poller keeps its fast cadence while so). */
    active: () => edge.active(),
  };
}

/** 13.7, the corner watch: every caption hidden over the page (Seamless and Hide the toolbar, whose hidden caption only the interface's toolbar brought back, and this
 * notch) shows its buttons the moment the pointer is in their corner, in that same poller tick, whether or not the window has the keyboard. A hidden caption's buttons are still
 * Windows' hit regions: under the pointer they were drawn as a hover colour with no glyph (an empty grey square, a red close) until the toolbar's round trip through the
 * interface brought them back (94 to 176 ms measured) or, in a window that is not in front (the edge rules ignore its pointer), the 1.2 s corner fallback did (caption-watch.cjs),
 * in its box. Windows' own buttons answer in a window that is not in front, so this one does too. The rules are the edge controller's top in `cornerOnly`: only the corner shows
 * it, it stays while the pointer is along the caption band, then the grace, nothing while a button is held. Main ORs it with the notch above, or with the interface's layout.
 * Input: point, bounds, suspended (minimised, full screen, an HTML-fullscreen page), active (the caption is over the page on Windows), hidden (it is hidden now: the corner
 * shows it), height (the caption overlay's height), speed, pressed. Returns whether the buttons show. */
function createCaptionCorner({ now = Date.now } = {}) {
  const edge = createEdgeController({ now });
  return {
    sample({ point, bounds, suspended, active, hidden, height, speed, pressed }) {
      const band = Math.max(NOTCH.height, Math.round(height || 0));
      return edge.sample({
        point, bounds, band: 0, focused: true, speed, pressed: !!pressed, cornerOnly: true,
        suspended: !active || !!suspended,
        view: 'seamless', vertical: true, docked: true, edges: { top: true, side: false }, peek: {},
        keys: { top: false, side: false }, holds: { top: false, side: false }, engaged: false,
        size: { topHeight: band, sideWidth: 0 },
        caption: hidden ? { width: CORNER.width, height: Math.max(CORNER.height, band) } : null,
      }).top;
    },
    /** Is it showing or about to (the poller keeps its fast cadence while so). */
    active: () => edge.active(),
  };
}

/** How far the pointer is from a hidden caption's corner, in DIPs (0 inside): the poller looks more often the closer it is (edge-reveal.cjs). */
function cornerDistance(point, bounds, height) {
  if (!point || !bounds) return Infinity;
  const h = Math.max(CORNER.height, Math.round(height || 0)), x0 = bounds.x + bounds.width - CORNER.width, x1 = bounds.x + bounds.width, y0 = bounds.y, y1 = bounds.y + h;
  return Math.hypot(Math.max(x0 - point.x, 0, point.x - x1), Math.max(y0 - point.y, 0, point.y - y1));
}

module.exports = { createCaptionNotch, createCaptionCorner, cornerDistance, NOTCH, CORNER };
