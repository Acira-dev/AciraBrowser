'use strict';
/* The pop-up layer follows the window's display (Beta 14, A12).
 *
 * The layer that draws every pop-up is a view that is hidden most of the time. When the window was moved to a monitor with another display scale, the views on screen took the new
 * scale and this one did not: its page stayed laid out at the old pixel count (1931 x 1236 CSS px in a 1280 x 820 window, found while sampling the Ctrl+Tab viewer), so centred
 * pop-ups drew off-centre and clipped at the bottom right until the next start. A hidden view takes its screen information again only when its size changes, so the layer is told to
 * lay out again whenever the display or the scale under the window changes: `resync` nudges its size by a pixel and puts it back, applies its zoom again and tells its stage the
 * viewport again (main.cjs resyncPopupLayer).
 *
 * `moved()` is called as the window moves (cheap: only a change of display or of scale counts); `metrics()` when the system reports a display's metrics changed, added or removed (always).
 * The resync runs at once and once more `again` ms later: Windows hands the new scale to the views a moment after the move. Pure: the display, the timers and the resync are given in. */
function createDisplayFollow({ current, resync, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), again = 250 } = {}) {
  const keyOf = display => display ? display.id + '@' + display.scale : null;
  let seen = keyOf(current()), timer = null, runs = 0;
  const run = () => {
    runs++;
    resync();
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; resync(); }, again);
  };
  return {
    /** The window moved: true when it is on another display or scale than before (and the layer was told). */
    moved() { const key = keyOf(current()); if (key === null || key === seen) return false; seen = key; run(); return true; },
    /** A display's metrics changed, a display came or went: the layer is told. */
    metrics() { const key = keyOf(current()); if (key !== null) seen = key; run(); return true; },
    dispose() { if (timer !== null) { clearTimer(timer); timer = null; } },
    get runs() { return runs; },
    get seen() { return seen; },
  };
}
module.exports = { createDisplayFollow };
