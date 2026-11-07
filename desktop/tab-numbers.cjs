'use strict';
/** Tab numbers while Ctrl (Windows, Linux) or Cmd (macOS) is held.
 *
 *  Main hears every key of every page and of the interface (`before-input-event`), so this works whichever one has focus and
 *  never touches focus. The modifier has to be held alone for HOLD_MS before the numbers show: Ctrl+C, Cmd+T and the other quick
 *  chords never flash them. Once shown they stay while only number keys are pressed (Ctrl+3 goes to tab 3 as it always did, and
 *  a second digit may follow) and go at once on release, on any other key (Cmd+C, Shift, Alt, Tab…), on a wheel turn over the page
 *  (Ctrl+wheel zooms on Windows and Linux) and when the window loses focus. A modifier that was pressed with another key already
 *  down, or that stopped counting, does not start them again until it is let go and pressed again.
 *
 *  HOLD_MS is 250 (the idea sheet's figure): a quick chord lands well inside it, and a deliberate hold shows them after a quarter of a
 *  second (measured in the dev build: key down in main to the figure painted, 257–266 ms). The timers are injected so a test drives the clock. */
const HOLD_MS = 250;
/** After a number key the numbers stay at most this long unless the modifier's release is heard. Main handles Ctrl/Cmd+digit and stops the
 *  key (the page never sees it), and Chromium then drops every key-up until the next key-down on that page: when the tab does not change
 *  (it is already the current one, or there is none with that number) the focus stays on the same page and the release never arrives. */
const LINGER_MS = 500;

function createTabNumberHold({ platform = process.platform, delay = HOLD_MS, linger = LINGER_MS, setTimer = setTimeout, clearTimer = clearTimeout, isNumberKey, onChange } = {}) {
  const mac = platform === 'darwin', modifier = mac ? 'Meta' : 'Control';
  // idle: the modifier is up (or lost); waiting: down alone, timer running; shown: numbers on screen; spent: down, but another key came first.
  let phase = 'idle', timer = null, lingerTimer = null;
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } if (lingerTimer !== null) { clearTimer(lingerTimer); lingerTimer = null; } };
  const settle = next => {
    const was = phase === 'shown';
    stopTimer();
    phase = next;
    if (was && next !== 'shown') onChange(false);
  };
  const alone = input => !input.shift && !input.alt && !(mac ? input.control : input.meta);
  return {
    /** One key event from `before-input-event` (type 'keyDown' or 'keyUp'). */
    note(input) {
      if (!input) return;
      if (input.type !== 'keyUp' && input.type !== 'keyDown') return;
      // Chromium drops the first key-up after a key-down that main handled (Ctrl+3 is one: the page never sees it), so a modifier
      // released first can go unheard. Every key event says whether the modifier is still down: when it says not, the hold is over.
      if (input.key !== modifier && phase !== 'idle' && (mac ? input.meta : input.control) === false) { settle('idle'); return; }
      if (input.type === 'keyUp') { if (input.key === modifier) settle('idle'); return; }
      if (input.key === modifier) {
        if (input.isAutoRepeat) return; // Windows and Linux repeat a held Ctrl
        settle('idle');
        if (!alone(input)) { phase = 'spent'; return; }
        phase = 'waiting';
        timer = setTimer(() => { timer = null; if (phase === 'waiting') { phase = 'shown'; onChange(true); } }, delay);
        return;
      }
      if (phase === 'idle') return;
      // A number key while shown keeps them; before they show it is an ordinary shortcut, so they never will for this hold.
      if (phase === 'shown' && isNumberKey?.(input)) {
        if (lingerTimer !== null) clearTimer(lingerTimer);
        lingerTimer = setTimer(() => { lingerTimer = null; if (phase === 'shown') settle('spent'); }, linger);
        return;
      }
      settle('spent');
    },
    /** A wheel turn or a click that is not a key: Ctrl+wheel zooms the page, so the numbers go. */
    interrupt() { if (phase !== 'idle') settle('spent'); },
    /** Window blur, hide, close: the key-up goes to whatever has focus now. */
    cancel() { settle('idle'); },
    get shown() { return phase === 'shown'; },
    get phase() { return phase; },
    delay,
  };
}

module.exports = { createTabNumberHold, HOLD_MS, LINGER_MS };
