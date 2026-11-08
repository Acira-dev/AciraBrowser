'use strict';
// Windows: the caption overlay's buttons (minimise, maximise, close) while they are transparent. A transparent button is still a native hit region, so while
// the caption is hidden (Seamless's hidden caption, Hide the toolbar, the Sidebar-mode notch between reveals) minimise and maximise are switched off and a click on
// them does nothing; close is refused in main's 'close' handler. This module owns ONLY the order of those calls against the overlay's colours, and keeps them true.
//
// One step (13.2): Windows draws the caption buttons itself, and a window that cannot be minimised has no minimise button, so the box they sit on is two buttons
// wide. beta.13.1 put the colours on at once and switched minimise and maximise back on 200 ms later from a timer: every reveal was a narrow box, then a wider one.
// The rule now, both ways: the buttons are only switched on or off while the overlay is transparent, and all of it happens in one tick.
//   showing: minimise and maximise come back first (nothing is visible yet), then the colours go on, so the first visible frame is the full box;
//   hiding:  the colours go transparent first, then the buttons are switched off, then the same transparent colours once more (so the overlay is
//            re-applied after the buttons' own re-layout), so no frame ever shows a box that changed width.
//
// Level, not edge (13.2, "the buttons vanished"): `apply` is called with the state that is WANTED and makes the window match it, whatever happened before. It no longer
// trusts a `flipped` flag: a missed flip, a window that was not there at the time, or flags that something else reset would leave the buttons off under a visible
// overlay for ever. Visible: both flags are on (read back, and set if they are not). Hidden: both are off and what to give back is remembered once.

function createCaptionGuard({ platform = process.platform, window }) {
  let held = null;
  const live = () => { const w = window(); return w && !w.isDestroyed() ? w : null; };

  /** Hidden: minimise and maximise off, remembering what to give back the first time. A maximised window keeps its maximise flag (the restore button needs it). Already
   * held: only what has come back on since (nothing, normally) is switched off again. Returns whether it changed a flag. */
  function hold(w) {
    let changed = false;
    if (!held) held = { min: w.isMinimizable(), max: w.isMaximized() ? null : w.isMaximizable() };
    if (w.isMinimizable()) { w.setMinimizable(false); changed = true; }
    if (held.max !== null && w.isMaximizable()) { w.setMaximizable(false); changed = true; }
    return changed;
  }

  /** Visible: both on, now. Whatever was remembered is given back, and anything still off is switched on (the main window is never created without them). Returns whether
   * it changed a flag. */
  function release(w) {
    let changed = false;
    held = null;
    if (!w.isMinimizable()) { w.setMinimizable(true); changed = true; }
    if (!w.isMaximizable()) { w.setMaximizable(true); changed = true; }
    return changed;
  }

  return {
    /** The one place the caption changes. `hidden`: what is wanted. `paint()`: puts the overlay's colours on (or takes them off) for this state; called exactly once
     * per call (twice when hiding and a button had to change: the second call, `paint(true)`, re-applies the overlay after the buttons' own re-layout, bypassing main's
     * "already applied" check), the buttons are changed on the transparent side of it. */
    apply({ hidden, paint }) {
      const w = platform === 'win32' ? live() : null;
      if (!w) { paint(false); return; }
      // A fullscreen or minimised window has no caption on screen and Windows rewrites its style bits around it: the buttons are put right when it is back (main re-sends on 'restore'
      // and 'leave-full-screen'), not while it is away.
      let away = false;
      try { away = w.isFullScreen() || w.isMinimized(); } catch {}
      if (away) { paint(false); return; }
      if (hidden) { paint(false); if (hold(w)) paint(true); }
      else paint(release(w));
    },
    /** Are minimise and maximise switched off at the moment (tests, diagnostics, the guard rig). */
    held: () => held !== null,
  };
}

module.exports = { createCaptionGuard };
