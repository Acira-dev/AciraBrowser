'use strict';
// One window's debounced save of its record (tabs, settings, history…).
//
// A change waits DEBOUNCE_MS for the next one before it is written, and is never put off past CEILING_MS from the first
// change: a page that keeps changing its title must not let a crash take the whole session with it (62ca1ef49).
//
// When the window goes away, a save that is still waiting is WRITTEN, not dropped. It used to be dropped: the window's
// 'closed' handler cancelled the timer, so tabs closed in the last 400 ms before the window closed (the last window on
// Windows and Linux, or a Mac's red button) were still in the record and came back at the next start. `flush()` is that
// write; `cancel()` is for the one case that must NOT write: a record that is about to be deleted (a window whose tabs
// went to another window, main's closeEmpty).
const DEBOUNCE_MS = 400;
const CEILING_MS = 2500;

function createSaveQueue({ write, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let due = 0;
  let timer = null;
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  /** Writes the record now. A timer that was waiting is dropped with it: this write covers what it would have written. */
  function save() {
    due = 0;
    stop();
    write();
  }
  /** A change was made: write it after DEBOUNCE_MS of quiet, but no later than CEILING_MS after the first unsaved change. */
  function queue() {
    const at = now();
    if (!due) due = at + CEILING_MS;
    stop();
    timer = setTimer(() => { timer = null; save(); }, Math.max(0, Math.min(DEBOUNCE_MS, due - at)));
  }
  /** True while a change is waiting to be written. */
  const pending = () => due !== 0;
  /** The window is going: writes a save that is still waiting. Nothing waiting, nothing written. Returns whether it wrote. */
  function flush() {
    if (!pending()) { stop(); return false; }
    save();
    return true;
  }
  /** Drops a waiting save without writing it (the record is being deleted). */
  function cancel() {
    due = 0;
    stop();
  }
  return { queue, save, flush, cancel, pending };
}

module.exports = { createSaveQueue, DEBOUNCE_MS, CEILING_MS };
