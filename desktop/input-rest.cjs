'use strict';
// Beta 14.1 (battery): "the person has not touched the browser for a while", for the sidebar's edge light (src/ui/edgeBreath.ts), which
// RESTS (pauses where it is) after REST_AFTER_MS without input and wakes on the next input from the same place. Every input event that
// reaches any of the app's web contents (keys, clicks, the wheel, the pointer moving over the window, touch) and the window gaining focus
// count as input (desktop/main.cjs). Main says it to the interface as `{type:'input-idle', idle}` only when it changes.
// No polling: one timer, armed for the rest of the quiet time and re-armed when it fires early (input came meanwhile), so a person typing
// or moving the pointer costs a timestamp per event and at most one timer callback per REST_AFTER_MS; once idle there is no timer at all.
// Keep this file ASCII only (main's script text stays one byte per character).

/** The ONE place the quiet time lives (the team's call, 21 Nov: 10 s; 30 or 60 are the alternatives that were measured). */
const REST_AFTER_MS = 10 * 1000;

function createInputRest({ emit, afterMs = REST_AFTER_MS, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (timer) => clearTimeout(timer) }) {
  let last = now(), idle = false, timer = null;
  const arm = (ms) => {
    if (timer) return;
    timer = setTimer(() => { timer = null; check(); }, Math.max(0, ms));
    if (timer && typeof timer.unref === 'function') timer.unref();
  };
  function check() {
    const quiet = now() - last;
    if (quiet >= afterMs) { if (!idle) { idle = true; try { emit(true); } catch {} } }
    else arm(afterMs - quiet);
  }
  function note() {
    last = now();
    if (idle) { idle = false; try { emit(false); } catch {} }
    arm(afterMs);
  }
  arm(afterMs);
  return {
    note,
    /** Whether the quiet time has passed (for an interface that loads or reloads: it is told the current state). */
    idle: () => idle,
    /** How long it has been quiet (ms): the whole-window snow keeps its own, longer rest (desktop/season-overlay.cjs). */
    quietMs: () => now() - last,
    stop() { if (timer) clearTimer(timer); timer = null; },
  };
}

module.exports = { REST_AFTER_MS, createInputRest };
