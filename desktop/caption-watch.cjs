'use strict';
// Windows caption safety nets (13.2, the founder's "the minimise, maximise and close buttons sometimes vanish"). Two small jobs, both outside the places that can miss, and
// neither of them touches the ordinary reveal or anything else that runs while it works:
//
//   1. A fallback for the corner. While the caption is hidden (the Sidebar-mode notch between reveals, Seamless's or Hide the toolbar's hidden caption), the normal reveal is
//      the edge poller (edge-reveal.cjs: the pointer rests at the top, ~90 ms to ~650 ms by what is under it, the corner at once) and, for Seamless and Hide the toolbar, the
//      interface answering. If the pointer has STAYED in the top-right corner for 1.2 s and the caption is still hidden, the normal path missed (the window had no keyboard,
//      a button was held, a page was fullscreen, the pointer maths was off at a display scale) and the buttons are shown anyway; if the interface is stopped or reloading
//      they are shown at once, because nothing else can. It never fires ahead of the normal reveal (1.2 s is longer than the slowest one measured, 1.04 s), so the caption box
//      never comes before the toolbar. Each firing is written to main.log, by kind only, so a report says the normal path missed.
//      It is driven by the edge poller's own tick (`tick()`, whatever the window's focus): no timer of its own.
//   2. A re-send. Windows (or Electron) can lose what the caption overlay drew: after a restore from minimised, a maximise or un-maximise, a display or scale change, a
//      theme change, a lock or sleep. main.cjs remembers the overlay it last sent and does not send the same one twice (captionKey), so a lost overlay would stay lost. Each
//      such event asks main, once its burst is over, to send the current overlay again (same colours, same height). Events only: no timer sends anything.
//
// All time and the screen are injected, so tests run it on a fake clock.

/** The corner that shows a hidden caption (caption-notch.cjs CORNER: a little wider and taller than the three 46 px buttons) and how far past it the pointer still counts. */
const CORNER = { width: 144, height: 36 };
const LEEWAY = 12;
/** The pointer must have stayed in the corner this long, with the caption still hidden, before the fallback shows it; the buttons then stay this long after it leaves. */
const DWELL_MS = 1200, HOLD_MS = 500;
/** A burst of window events (a maximise sends several) is one re-send this long after the last. */
const SETTLE_MS = 80;

function createCaptionWatch({ platform = process.platform, window, cursor, hidden, interfaceDown = () => false, height, setForced, refresh, log = () => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let settleTimer = null, forced = false, since = 0, lastIn = 0, stopped = false;
  const live = () => { const w = window(); return w && !w.isDestroyed() ? w : null; };
  const shown = w => { try { return w.isVisible() && !w.isMinimized() && !w.isFullScreen(); } catch { return false; } };

  /** Is the pointer over the caption box (the corner, with leeway)? */
  function inCorner(w) {
    let p, b;
    try { p = cursor(); b = w.getContentBounds(); } catch { return false; }
    if (!p || !b) return false;
    const h = Math.max(CORNER.height, Math.round(height?.() || 0));
    return p.x >= b.x + b.width - CORNER.width - LEEWAY && p.x <= b.x + b.width + LEEWAY && p.y >= b.y - LEEWAY && p.y < b.y + h + LEEWAY;
  }

  return {
    /** One look, from the edge poller's tick (every 16 ms while an edge is active, every 250 ms otherwise): cheap, and nothing happens unless the caption is hidden. */
    tick() {
      if (platform !== 'win32' || stopped) return;
      const w = live();
      if (!w || (!forced && !hidden())) { since = 0; return; }
      const t = now(), here = shown(w) && inCorner(w);
      if (here) {
        lastIn = t;
        if (!since) since = t;
        if (!forced) {
          const down = interfaceDown();
          if (down || t - since >= DWELL_MS) {
            forced = true;
            try { log(down ? 'interface-down' : 'dwell'); } catch {}
            setForced(true);
          }
        }
      } else {
        since = 0;
        if (forced && t - lastIn >= HOLD_MS) { forced = false; setForced(false); }
      }
    },
    /** A window or system event that can cost the overlay what it drew: send it again once the burst is over. */
    event() {
      if (platform !== 'win32' || stopped) return;
      if (settleTimer) cancel(settleTimer);
      settleTimer = schedule(() => { settleTimer = null; const w = live(); if (w && !stopped) { try { refresh(); } catch {} } }, SETTLE_MS);
      settleTimer?.unref?.();
    },
    /** Is the caption being held open by the fallback right now. */
    forced: () => forced,
    dispose() { stopped = true; if (settleTimer) cancel(settleTimer); settleTimer = null; },
  };
}

module.exports = { createCaptionWatch, CORNER, LEEWAY, DWELL_MS, HOLD_MS, SETTLE_MS };
