'use strict';
// Windows: the rounded box behind the window's own caption buttons (13.7).
//
// The buttons (minimise, maximise, close) are Windows' own, drawn by the caption overlay, with their own icons, square hover, red Close and Snap Layouts. The overlay can only
// paint a rectangle behind them, so the box that sits behind them over the page (Seamless, Hide the toolbar, the Sidebar + address notch) is drawn here instead: one plain
// view in the window, flat, see-through, hugging the window's top-right corner (square against the top and right edges, rounded on its inside bottom-left corner only),
// a few px bigger than the buttons so a square hover never pokes past the rounded edge. The overlay's own colour is left clear while it shows.
//
// It has no handler of its own and the native caption buttons sit above it, so the buttons work as they always did. But a plain View still swallows a real click in its
// extra MARGIN px strips (to the left of and below the buttons) while it shows: measured on the real window, 11 Nov 2026,
// that click reaches neither the buttons nor the page, while a click farther away reaches the page. MARGIN = 0 swallows nothing, at the cost of a square hover poking about
// 3 px past the rounded edge. We accepted this (11 Nov 2026, option A): MARGIN stays 6, and a click in that thin strip does nothing while the box is up. It is shown, moved and hidden only by `apply`, which main calls in the same tick as the overlay's own change (setCaption's paint), so it
// appears and goes in the same frame as the buttons.
//
// The shape: a View has one corner radius for all four corners, so it is made larger than the box. It reaches RADIUS px above and RADIUS px past the right edge of the
// window, where the window itself clips it: only the bottom-left corner is left on screen.

/** Three 46 px buttons (caption-notch.cjs NOTCH.width). */
const BUTTONS_WIDTH = 138;
/** The box is this much wider than the buttons (to their left) and taller than the caption's height (below them). */
const MARGIN = 6;
/** The rounded inside corner. */
const RADIUS = 12;
/** How long the box stays once the interface's own toolbar has the caption (main.cjs passes it as `linger`): the toolbar is painted about 80 to 100 ms after its layout, and while it fades in the box, nearly its tone, hides nothing. */
const HANDOVER_MS = 320;
/** The tone's opacity: the caption box 13.6 drew (reported 11 Nov 2026: the same look in Seamless, Hide the toolbar and the Sidebar + address notch). */
const OPACITY = 0.88;

/** '#rgb' / '#rrggbb' + alpha 0..1 -> '#aarrggbb' (Electron's View reads a hex colour with alpha as ARGB); null for anything else. */
function withAlpha(hex, alpha) {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return '#' + Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0') + h.toLowerCase();
}

/** Where the view goes, in window (content) DIPs: the box's own rectangle (right edge to right edge, top to top) grown by RADIUS up and to the right. */
function backingBounds(width, captionHeight) {
  const w = BUTTONS_WIDTH + MARGIN, h = Math.max(1, Math.round(captionHeight || 0)) + MARGIN;
  return { x: Math.round(width) - w, y: -RADIUS, width: w + RADIUS, height: h + RADIUS };
}

/** One per window. `create()` makes the view (a plain View); `window()` is the main window. */
function createCaptionBacking({ create, window, schedule = setTimeout, cancel = clearTimeout }) {
  let view = null, shown = null, size = null, listening = null, lingering = null;
  const stopLingering = () => { if (lingering) { cancel(lingering); lingering = null; } };
  const live = () => { const w = window(); return w && !w.isDestroyed() ? w : null; };
  const measure = w => { const s = w.getContentSize(); return Math.round(s[0]); };

  function ensure(w) {
    if (view) return view;
    view = create();
    // A plain View paints into the window's own layer, UNDER the page's native view (measured 11 Nov 2026: an opaque red box did not show over the page at all). A blur request makes
    // it a layer of its own, above the pages; the blur is then put back to none (the tone is flat), and only then the radius: a blur of none after the radius drops the rounding.
    view.setBackgroundBlur(1);
    view.setBackgroundBlur(0);
    view.setBorderRadius(RADIUS);
    view.setVisible(false);
    // The window's width changes with a resize, a maximise, a restore: the box follows in the same event, not at the interface's next layout.
    if (w.on && listening !== w) { listening = w; for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) w.on(event, () => place()); }
    return view;
  }

  /** Above the pages and the interface, below the popup layer (`above`) when there is one, otherwise on top. Already there: nothing moves. */
  function raise(w, v, above) {
    const parent = w.contentView;
    let kids = parent.children || [];
    const up = above && kids.includes(above) ? above : null, at = kids.indexOf(v);
    if (at >= 0 && at === (up ? kids.indexOf(up) - 1 : kids.length - 1)) return;
    if (at >= 0) { parent.removeChildView(v); kids = parent.children || []; }
    parent.addChildView(v, up ? kids.indexOf(up) : kids.length);
  }

  function place() {
    const w = live();
    if (!w || !view || !shown) return;
    let away = false;
    try { away = w.isFullScreen() || w.isMinimized(); } catch { /* gone */ }
    if (away) { view.setVisible(false); return; }
    const bounds = backingBounds(measure(w), shown.height);
    if (!size || size.x !== bounds.x || size.y !== bounds.y || size.width !== bounds.width || size.height !== bounds.height) { view.setBounds(bounds); size = bounds; }
    if (!view.getVisible()) view.setVisible(true);
  }

  return {
    /** The one place the box changes. `backing`: { tone, height, above } (the box behind the buttons) or null (none). Called with the overlay's own change, in one tick. */
    apply(backing, { above = null, linger = 0 } = {}) {
      const w = live();
      if (!w) return;
      if (!backing) {
        // `linger` (ms): the buttons stay (the interface's own toolbar took the caption over) but that toolbar is not painted for a few frames after its layout says so: the box, which is
        // nearly the toolbar's own tone, stays until it is, so the buttons are never on the bare page in between (measured: 3 to 9 frames without them). A new box or a hide cancels it.
        if (linger > 0 && view && view.getVisible() && shown) {
          if (!lingering) lingering = schedule(() => { lingering = null; shown = null; if (view && view.getVisible()) view.setVisible(false); }, linger);
          lingering?.unref?.();
          return;
        }
        stopLingering();
        shown = null;
        if (view && view.getVisible()) view.setVisible(false);
        return;
      }
      stopLingering();
      const color = withAlpha(backing.tone, backing.opacity ?? OPACITY);
      if (!color) { shown = null; if (view && view.getVisible()) view.setVisible(false); return; }
      const v = ensure(w);
      if (!shown || shown.color !== color) v.setBackgroundColor(color);
      shown = { color, height: backing.height };
      raise(w, v, above);
      place();
    },
    place,
    /** For tests and the rig. */
    state: () => view ? { visible: view.getVisible(), bounds: size, color: shown && shown.color } : null,
    view: () => view,
    dispose() { stopLingering(); const w = live(); if (view && w) { try { w.contentView.removeChildView(view); } catch { /* gone */ } } view = null; shown = null; size = null; },
  };
}

module.exports = { createCaptionBacking, backingBounds, withAlpha, BUTTONS_WIDTH, MARGIN, RADIUS, OPACITY, HANDOVER_MS };
