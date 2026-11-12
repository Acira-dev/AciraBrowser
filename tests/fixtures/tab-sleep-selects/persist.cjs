'use strict';
// A person's keyboard input into a control, sent through the DevTools protocol (run.cjs). A click into a cross-site iframe puts the keyboard in that frame's process
// through the browser, a moment after the click; keys and text sent before it arrives go nowhere, and the control still shows nothing of them (seen on a loaded laptop:
// "number/cross: the person's input did land in the control (\"\")"). The fixture used to wait a fixed 80 ms after the click and hoped. The input is now sent again,
// from the same starting state, for as long as the control shows nothing of it (up to `tries` times, `wait` ms apart): a control that took the first attempt is not touched again.

/**
 * Sends the input (`step`) and looks at the control (`landed`); repeats while it still shows what it showed `before`. Returns the attempt that landed, 0 when none did.
 * `sleep(ms)` is the caller's own wait.
 */
async function landOnce({step, landed, before, sleep, tries = 8, wait = 300}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    await step();
    if ((await landed()) !== before) return attempt;
    if (attempt < tries) await sleep(wait);
  }
  return 0;
}

module.exports = {landOnce};
