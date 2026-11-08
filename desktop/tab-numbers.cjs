'use strict';
/** Tab numbers while Ctrl (Windows, Linux) or Cmd (macOS) is held, and the two-digit tab numbers typed under them.
 *
 *  Main hears every key of every page and of the interface (`before-input-event`), so this works whichever one has focus and
 *  never touches focus. The modifier has to be held alone for HOLD_MS before the numbers show: Ctrl+C, Cmd+T and the other quick
 *  chords never flash them. Once shown they stay while only number keys are pressed (Ctrl+3 goes to tab 3 as it always did, and
 *  a second digit may follow) and go at once on release, on any other key (Cmd+C, Shift, Alt, Tab…), on a wheel turn over the page
 *  (Ctrl+wheel zooms on Windows and Linux) and when the window loses focus. A modifier that was pressed with another key already
 *  down, or that stopped counting, does not start them again until it is let go and pressed again.
 *
 *  HOLD_MS is 140 (beta.14; it was 250 until beta.13, and a tester found the numbers slow to come). A quick chord (Cmd+C, Cmd+T…) lands well
 *  inside it, and so does a click made while the modifier is down (a Ctrl/Cmd+click opens a link in a new tab): a mouse press before the numbers
 *  show spends the hold too, see `abandon`. Measured in the dev build, key down in main to the figure: first drawn 150–155 ms, half ink about
 *  180 ms, full ink about 225 ms (was 262, 288, 330), the same with a website or the interface holding focus, right after a tab switch and
 *  on a tab that was never loaded. The pipeline after the timer (IPC, React, paint) is 10–15 ms, so the wait is nearly all of it. A chord
 *  whose second key comes up to about 155 ms after the modifier never draws any ink; the fade (100 ms, ease-out) is the signature one and is
 *  unchanged. The timers are injected so a test drives the clock.
 *
 *  Two digits (beta.12): with the modifier down, 1 then 5 within CHORD_MS goes to tab 15. A first digit WAITS for a second only when
 *  a tab with that tens digit exists (10 × digit ≤ the number of tabs: with 12 tabs only 1 can be followed by anything, with 9 or
 *  fewer no digit waits and every key acts at once, as it always did). The waiting digit acts on its own tab (9 = the last tab) the
 *  moment the modifier is let go, at once on any other key or a wheel turn, and when CHORD_MS runs out; a window blur,
 *  a mouse press and Escape drop it.
 *  A second digit is 0–9 (Ctrl+0 is the zoom reset otherwise); if no such tab exists nothing happens. `note` tells main what to do with
 *  the key: 'wait' (a first digit now waiting: do not run Go to tab), 'taken' (a second digit, already acted on: run nothing) or
 *  'flushed' (a waiting digit acted just before this key). `typed` is the waiting digit, for the numbers on screen. */
const HOLD_MS = 140;
/** After a number key the numbers stay at most this long unless the modifier's release is heard. Main handles Ctrl/Cmd+digit and stops the
 *  key (the page never sees it), and Chromium then drops every key-up until the next key-down on that page: when the tab does not change
 *  (it is already the current one, or there is none with that number) the focus stays on the same page and the release never arrives. */
const LINGER_MS = 500;
/** How long a first digit waits for its second. */
const CHORD_MS = 1500;

function createTabNumberHold({ platform = process.platform, delay = HOLD_MS, linger = LINGER_MS, chord = CHORD_MS, setTimer = setTimeout, clearTimer = clearTimeout, isNumberKey, digitOf, naturalDigit, tabCount, select, onChange, onTyped } = {}) {
  const mac = platform === 'darwin', modifier = mac ? 'Meta' : 'Control';
  // idle: the modifier is up (or lost); waiting: down alone, timer running; shown: numbers on screen; spent: down, but another key came first.
  let phase = 'idle', timer = null, lingerTimer = null, chordTimer = null, typed = null, acted = false;
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } if (lingerTimer !== null) { clearTimer(lingerTimer); lingerTimer = null; } };
  /** The waiting first digit is over: gone from the screen, and (when `act`) carried out as a tab of its own. */
  const finishChord = act => {
    if (typed === null) return;
    const digit = typed;
    typed = null;
    if (chordTimer !== null) { clearTimer(chordTimer); chordTimer = null; }
    onTyped?.(null);
    if (act) { acted = true; select?.(digit === 9 ? -1 : digit); }
  };
  const settle = (next, act = true) => {
    const was = phase === 'shown';
    stopTimer();
    phase = next;
    finishChord(act);
    if (was && next !== 'shown') onChange(false);
  };
  const keepShown = () => {
    if (lingerTimer !== null) clearTimer(lingerTimer);
    lingerTimer = setTimer(() => { lingerTimer = null; if (phase === 'shown') settle('spent'); }, linger);
  };
  const alone = input => !input.shift && !input.alt && !(mac ? input.control : input.meta);
  const digit = input => { const found = digitOf ? digitOf(input) : -1; return Number.isInteger(found) && found >= 0 && found <= 9 ? found : -1; };
  const count = () => { const found = tabCount ? tabCount() : 0; return Number.isInteger(found) ? found : 0; };

  function handle(input) {
    if (!input) return undefined;
    if (input.type !== 'keyUp' && input.type !== 'keyDown') return undefined;
    // Chromium drops the first key-up after a key-down that main handled (Ctrl+3 is one: the page never sees it), so a modifier
    // released first can go unheard. Every key event says whether the modifier is still down: when it says not, the hold is over.
    if (input.key !== modifier && phase !== 'idle' && (mac ? input.meta : input.control) === false) { settle('idle'); return undefined; }
    if (input.type === 'keyUp') { if (input.key === modifier) settle('idle'); return undefined; }
    if (input.key === modifier) {
      if (input.isAutoRepeat) return undefined; // Windows and Linux repeat a held Ctrl (main also sends one itself, to get the release heard)
      settle('idle');
      if (!alone(input)) { phase = 'spent'; return undefined; }
      phase = 'waiting';
      timer = setTimer(() => { timer = null; if (phase === 'waiting') { phase = 'shown'; onChange(true); } }, delay);
      return undefined;
    }
    if (phase === 'idle') return undefined;
    const typedDigit = digit(input);
    if (typed !== null) {
      // A first digit is waiting: another digit finishes the number, any other key sends the waiting digit to its own tab first.
      if (typedDigit >= 0 && alone(input)) {
        if (input.isAutoRepeat) return 'taken'; // a held key is not a second press
        const first = typed, number = first * 10 + typedDigit;
        finishChord(false);
        if (number <= count()) select?.(number);
        if (phase === 'shown') keepShown(); else if (phase === 'waiting') settle('spent');
        return 'taken';
      }
      finishChord(input.key !== 'Escape'); // Escape drops a waiting digit (the person changed their mind); anything else sends it first
      if (phase === 'shown') keepShown();
    } else if (typedDigit >= 1 && !input.isAutoRepeat && alone(input) && naturalDigit?.(input) === typedDigit && typedDigit * 10 <= count()) {
      // A first digit that could be followed by a second: wait for it (the numbers show it as typed).
      typed = typedDigit;
      if (lingerTimer !== null) { clearTimer(lingerTimer); lingerTimer = null; }
      chordTimer = setTimer(() => { chordTimer = null; finishChord(true); if (phase === 'shown') keepShown(); else if (phase === 'waiting') settle('spent'); }, chord);
      onTyped?.(typedDigit);
      return 'wait';
    }
    // A number key while shown keeps them; before they show it is an ordinary shortcut, so they never will for this hold.
    if (phase === 'shown' && isNumberKey?.(input)) { keepShown(); return undefined; }
    settle('spent');
    return undefined;
  }

  return {
    /** One key event from `before-input-event` (type 'keyDown' or 'keyUp'). Returns 'wait', 'taken', 'flushed' or undefined (see above). */
    note(input) {
      acted = false;
      const verdict = handle(input);
      return verdict || (acted ? 'flushed' : undefined);
    },
    /** A wheel turn or a click that is not a key: Ctrl+wheel zooms the page, so the numbers go (a waiting digit acts first). */
    interrupt() { if (phase !== 'idle') settle('spent'); },
    /** A mouse press (a click on a tab or a page): the person is choosing with the pointer now, so a waiting digit is dropped, not acted on. Numbers
     *  already on screen stay as they were; before they show, the modifier is being used with the mouse (Ctrl/Cmd+click), not held to look, so
     *  they will not show for this hold. */
    abandon() {
      if (phase === 'waiting') settle('spent');
      if (typed === null) return;
      finishChord(false);
      if (phase === 'shown') keepShown();
    },
    /** Window blur, hide, close: the key-up goes to whatever has focus now. A waiting digit is dropped, not acted on. */
    cancel() { settle('idle', false); },
    get shown() { return phase === 'shown'; },
    get phase() { return phase; },
    /** The first digit that is waiting for a second (1…9), or null. */
    get typed() { return typed; },
    delay,
  };
}

module.exports = { createTabNumberHold, HOLD_MS, LINGER_MS, CHORD_MS };
