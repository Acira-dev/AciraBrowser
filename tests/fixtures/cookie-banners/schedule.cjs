'use strict';
// When the cookie banner runner (run.cjs) runs each step of a case: at its planned time, and never sooner than `reaction` ms after the last click LANDED.
// A click first waits for two frames of a hidden window (about a second, more when frames come late), so a step planned 1500 ms after a click began is only about
// 500 ms after it landed, and none at all when the click took 1500 ms. The frame script needs its time after the click, to look again (120 ms after a change) and act.

/** Milliseconds to wait before a step. `at`: the planned time (ms after the page loaded); `startedAt` / `now`: Date.now() values; `landedAt`: when the last click landed (0: none yet). */
function stepWait({at, startedAt, now, landedAt = 0, reaction = 1500}) {
  return Math.max(0, at - (now - startedAt), landedAt + reaction - now);
}

module.exports = {stepWait};
