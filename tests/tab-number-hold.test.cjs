'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createTabNumberHold, HOLD_MS, LINGER_MS, CHORD_MS } = require('../desktop/tab-numbers.cjs');

// When the tab numbers show and hide (desktop/tab-numbers.cjs). A fake clock stands in for setTimeout.
function rig(platform) {
  let now = 0, next = 1;
  const timers = new Map(), log = [];
  const hold = createTabNumberHold({
    platform,
    isNumberKey: input => /^[1-9]$/.test(input.key) && !input.shift && !input.alt,
    onChange: shown => log.push(`${shown ? 'show' : 'hide'}@${now}`),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: id => { timers.delete(id); },
  });
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  };
  const mod = platform === 'darwin' ? 'Meta' : 'Control';
  const modFlags = platform === 'darwin' ? { meta: true } : { control: true };
  const key = (type, key, extra = {}) => hold.note({ type, key, shift: false, alt: false, control: false, meta: false, isAutoRepeat: false, ...extra });
  return {
    hold, log, advance, timers,
    down: () => key('keyDown', mod, modFlags),
    up: () => key('keyUp', mod),
    press: (k, extra = {}) => key('keyDown', k, { ...modFlags, ...extra }),
    release: k => key('keyUp', k, modFlags),
    now: () => now,
  };
}

for (const platform of ['darwin', 'win32', 'linux']) {
  const label = platform === 'darwin' ? 'Cmd on macOS' : `Ctrl on ${platform}`;

  test(`${label}: held alone, the numbers show after the delay and not before`, () => {
    const r = rig(platform);
    r.down();
    r.advance(HOLD_MS - 1);
    assert.deepEqual(r.log, [], 'not yet');
    assert.equal(r.hold.shown, false);
    r.advance(1);
    assert.deepEqual(r.log, [`show@${HOLD_MS}`]);
    assert.equal(r.hold.shown, true);
    r.advance(5000);
    assert.deepEqual(r.log, [`show@${HOLD_MS}`], 'once, however long it is held');
  });

  test(`${label}: releasing hides them at once, and a quick tap never shows anything`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS + 40); r.up();
    assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS + 40}`]);
    assert.equal(r.timers.size, 0);
    const tap = rig(platform);
    tap.down(); tap.advance(HOLD_MS - 20); tap.up(); tap.advance(1000);
    assert.deepEqual(tap.log, []);
  });

  test(`${label}: ordinary shortcuts never flash them (Cmd+C, Cmd+T, Cmd+W, a Shift or Alt chord, a function key)`, () => {
    for (const [name, extra] of [['c', {}], ['t', {}], ['w', {}], ['T', { shift: true }], ['Shift', { shift: true }], ['Alt', { alt: true }], ['F5', {}], ['Tab', {}], ['Escape', {}], ['ArrowLeft', {}], ['Enter', {}]]) {
      const r = rig(platform);
      r.down(); r.advance(60); r.press(name, extra); r.release(name); r.advance(2000); r.up();
      assert.deepEqual(r.log, [], `${name} must not show them`);
      assert.equal(r.timers.size, 0, 'the timer is gone');
    }
  });

  test(`${label}: a quick chord never draws anything, whatever its second key, up to the delay (beta.14: 140 ms)`, () => {
    // The figure is drawn 10-15 ms after the timer fires, so a chord whose second key lands inside HOLD_MS never reaches the screen.
    for (const gap of [0, 30, 60, 90, 120, HOLD_MS - 20, HOLD_MS - 1]) {
      for (const [name, extra] of [['c', {}], ['t', {}], ['v', {}], ['Shift', { shift: true }], ['Tab', {}], ['F5', {}]]) {
        const r = rig(platform);
        r.down(); r.advance(gap); r.press(name, extra); r.release(name); r.advance(1000); r.up();
        assert.deepEqual(r.log, [], `${name} after ${gap} ms must not show them`);
      }
    }
    assert.ok(HOLD_MS >= 100 && HOLD_MS <= 160, 'short enough to feel at once, long enough for the slowest everyday chord');
  });

  test(`${label}: a click made while the modifier is down is not a look at the numbers: they do not show for that hold (Ctrl/Cmd+click)`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS - 30); r.hold.abandon(); r.advance(2000);
    assert.deepEqual(r.log, [], 'a press before they show spends the hold');
    assert.equal(r.hold.phase, 'spent');
    assert.equal(r.timers.size, 0);
    r.up(); r.down(); r.advance(HOLD_MS);
    assert.equal(r.log.length, 1, 'the next, separate hold starts afresh');
    assert.match(r.log[0], /^show@/);
    // Once they are on screen a press does not take them away: the person chose to hold the key.
    const shown = rig(platform);
    shown.down(); shown.advance(HOLD_MS); shown.hold.abandon(); shown.advance(100);
    assert.deepEqual(shown.log, [`show@${HOLD_MS}`]);
    assert.equal(shown.hold.shown, true);
    // A press with nothing held changes nothing.
    const idle = rig(platform);
    idle.hold.abandon(); idle.advance(1000);
    assert.deepEqual(idle.log, []);
    assert.equal(idle.hold.phase, 'idle');
  });

  test(`${label}: a number pressed before they show is the shortcut being used: they do not appear for that hold`, () => {
    const r = rig(platform);
    r.down(); r.advance(80); r.press('3'); r.release('3'); r.advance(2000);
    assert.deepEqual(r.log, []);
    r.up();
    // The next hold starts fresh.
    r.down(); r.advance(HOLD_MS);
    assert.deepEqual(r.log, [`show@${2080 + HOLD_MS}`]);
  });

  test(`${label}: once shown, number keys keep them (Ctrl/Cmd+3, then +5), any other key hides them at once for the rest of the hold`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS);
    r.press('3'); r.release('3'); r.press('5'); r.release('5');
    assert.equal(r.hold.shown, true, 'digits never hide them');
    r.advance(100); r.press('c');
    assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS + 100}`]);
    r.release('c'); r.advance(3000);
    assert.equal(r.hold.shown, false, 'they do not come back while the key is still down');
    assert.equal(r.log.length, 2);
    r.up(); r.down(); r.advance(HOLD_MS);
    assert.equal(r.hold.shown, true, 'after a release and a new press they do');
  });

  test(`${label}: a digit with Shift or Alt is not a number key (Cmd+Shift+3, the split layouts)`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS);
    r.press('3', { shift: true });
    assert.equal(r.hold.shown, false);
    const a = rig(platform);
    a.down(); a.advance(HOLD_MS); a.press('2', { alt: true });
    assert.equal(a.hold.shown, false);
  });

  test(`${label}: the window losing focus hides them, and the key-up that goes elsewhere changes nothing`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS + 10);
    r.hold.cancel();
    assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS + 10}`]);
    r.up(); r.advance(2000);
    assert.equal(r.log.length, 2);
    // Blur before they show cancels the pending timer.
    const early = rig(platform);
    early.down(); early.advance(50); early.hold.cancel(); early.advance(2000);
    assert.deepEqual(early.log, []);
    assert.equal(early.timers.size, 0);
  });

  test(`${label}: a wheel turn (Ctrl+wheel zooms the page) hides them and keeps them away until the key is pressed again`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS + 10); r.hold.interrupt(); r.advance(3000);
    assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS + 10}`]);
    const early = rig(platform);
    early.down(); early.advance(100); early.hold.interrupt(); early.advance(3000);
    assert.deepEqual(early.log, []);
    r.hold.interrupt(); // nothing happens when nothing is on
    assert.equal(r.log.length, 2);
  });

  test(`${label}: a lost key-up cannot leave them stuck: the next press starts over`, () => {
    const r = rig(platform);
    r.down(); r.advance(HOLD_MS);
    r.down(); // a new, non-repeat press with no release in between
    assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS}`]);
    r.advance(HOLD_MS);
    assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS}`, `show@${HOLD_MS * 2}`]);
  });
}

for (const platform of ['darwin', 'win32']) test(`${platform === 'darwin' ? 'Cmd' : 'Ctrl'}: a release Chromium swallowed (the first key-up after a handled Ctrl/Cmd+digit) cannot leave them stuck: the next key event that says the key is up ends it`, () => {
  const r = rig(platform);
  r.down(); r.advance(HOLD_MS);
  r.press('3');            // goes to tab 3 and is handled, so Chromium drops the next key-up it would have passed on
  assert.equal(r.hold.shown, true);
  // the modifier is let go first: its key-up never reaches main; the digit's key-up arrives with the modifier flag already off
  r.hold.note({ type: 'keyUp', key: '3', shift: false, alt: false, control: false, meta: false, isAutoRepeat: false });
  assert.equal(r.hold.shown, false);
  assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS}`]);
  // before they show, the same applies to a quick tap whose key-up was lost
  const early = rig(platform);
  early.down(); early.advance(40);
  early.hold.note({ type: 'keyDown', key: 'a', shift: false, alt: false, control: false, meta: false, isAutoRepeat: false });
  early.advance(1000);
  assert.deepEqual(early.log, []);
  assert.equal(early.hold.phase, 'idle');
  // a key event with no modifier information does not end anything
  const unknown = rig(platform);
  unknown.down(); unknown.advance(HOLD_MS);
  unknown.hold.note({ type: 'keyUp', key: '3' });
  assert.equal(unknown.hold.shown, true);
});

for (const platform of ['darwin', 'win32']) test(`${platform === 'darwin' ? 'Cmd' : 'Ctrl'}: after a number key the numbers wait for the release but never longer than ${LINGER_MS} ms (Chromium drops the key-ups after a handled Ctrl/Cmd+digit)`, () => {
  const r = rig(platform);
  r.down(); r.advance(HOLD_MS);
  r.press('3');
  r.advance(LINGER_MS - 1);
  assert.equal(r.hold.shown, true);
  r.advance(1);
  assert.deepEqual(r.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS + LINGER_MS}`]);
  r.advance(5000); r.up();
  assert.equal(r.log.length, 2, 'once, and they do not come back');
  // a second number key starts the wait again
  const two = rig(platform);
  two.down(); two.advance(HOLD_MS); two.press('3'); two.advance(300); two.press('5'); two.advance(LINGER_MS - 1);
  assert.equal(two.hold.shown, true);
  two.advance(1);
  assert.equal(two.hold.shown, false);
  // the release, when it is heard, ends it at once and leaves no timer behind
  const heard = rig(platform);
  heard.down(); heard.advance(HOLD_MS); heard.press('3'); heard.advance(80); heard.up();
  assert.deepEqual(heard.log, [`show@${HOLD_MS}`, `hide@${HOLD_MS + 80}`]);
  assert.equal(heard.timers.size, 0);
  heard.advance(5000);
  assert.equal(heard.log.length, 2);
  // a number key before they show starts no wait of its own
  const early = rig(platform);
  early.down(); early.advance(80); early.press('2'); early.advance(5000);
  assert.deepEqual(early.log, []);
  assert.equal(early.timers.size, 0);
});

test('Windows and Linux repeat a held Ctrl: the repeats do not restart the delay', () => {
  const r = rig('win32');
  r.down();
  for (let i = 0; i < 4; i++) { r.advance(30); r.hold.note({ type: 'keyDown', key: 'Control', control: true, isAutoRepeat: true }); }
  assert.deepEqual(r.log, [], 'four repeats in, 120 ms');
  r.advance(HOLD_MS - 120);
  assert.deepEqual(r.log, [`show@${HOLD_MS}`], 'a repeat that restarted the timer would push this out');
});

test('only the platform\'s own key counts: Ctrl does nothing on a Mac (it is the workspace and Ctrl+Tab key there), the Windows key does nothing elsewhere', () => {
  const mac = rig('darwin');
  mac.hold.note({ type: 'keyDown', key: 'Control', control: true, shift: false, alt: false, meta: false, isAutoRepeat: false });
  mac.advance(1000);
  assert.deepEqual(mac.log, []);
  const win = rig('win32');
  win.hold.note({ type: 'keyDown', key: 'Meta', meta: true, shift: false, alt: false, control: false, isAutoRepeat: false });
  win.advance(1000);
  assert.deepEqual(win.log, []);
});

test('a modifier pressed while Shift or Alt is already down does not start them (AltGr is Ctrl+Alt on Windows)', () => {
  const win = rig('win32');
  win.hold.note({ type: 'keyDown', key: 'Control', control: true, alt: true, shift: false, meta: false, isAutoRepeat: false });
  win.advance(1000);
  assert.deepEqual(win.log, []);
  win.up();
  win.hold.note({ type: 'keyDown', key: 'Control', control: true, shift: true, alt: false, meta: false, isAutoRepeat: false });
  win.advance(1000);
  assert.deepEqual(win.log, []);
  const mac = rig('darwin');
  mac.hold.note({ type: 'keyDown', key: 'Meta', meta: true, shift: true, alt: false, control: false, isAutoRepeat: false });
  mac.advance(1000);
  assert.deepEqual(mac.log, []);
});

test('the delay is 140 ms (beta.14, was 250), and events that are not key presses are ignored', () => {
  assert.equal(HOLD_MS, 140);
  const r = rig('darwin');
  r.hold.note(null); r.hold.note({}); r.hold.note({ type: 'mouseDown' }); r.hold.note({ type: 'keyUp', key: 'a' });
  r.advance(1000);
  assert.deepEqual(r.log, []);
  assert.equal(r.hold.phase, 'idle');
});

// ---- Two-digit tab numbers (beta.12): with the modifier down, 1 then 5 within CHORD_MS is tab 15. -------------------------------

// The hold as main wires it: a digit is a number key; a first digit waits only when a tab with that tens digit exists; `select`
// takes a place (1-based, -1 the last tab) and is logged with the clock. `verdicts` are what `note` told main about each key.
function chordRig(platform, tabs) {
  let count = tabs;
  const base = rig(platform), typedLog = [], picks = [];
  const mac = platform === 'darwin', mod = mac ? 'Meta' : 'Control', flags = mac ? { meta: true } : { control: true };
  const shownLog = base.log;
  let now = 0, next = 1;
  const timers = new Map();
  const hold = createTabNumberHold({
    platform,
    isNumberKey: input => /^[1-9]$/.test(input.key) && !input.shift && !input.alt,
    digitOf: input => /^[0-9]$/.test(input.key) ? Number(input.key) : -1,
    naturalDigit: input => /^[1-9]$/.test(input.key) ? Number(input.key) : -1,
    tabCount: () => count,
    select: position => picks.push(`${position}@${now}`),
    onChange: shown => shownLog.push(`${shown ? 'show' : 'hide'}@${now}${hold.typed !== null ? ':typed' + hold.typed : ''}`),
    onTyped: digit => typedLog.push(digit === null ? 'clear' : 'typed' + digit),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: id => { timers.delete(id); },
  });
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  };
  const key = (type, k, extra = {}) => hold.note({ type, key: k, shift: false, alt: false, control: false, meta: false, isAutoRepeat: false, ...extra });
  return {
    hold, advance, timers, picks, typedLog, shown: shownLog, setCount: n => { count = n; },
    down: () => key('keyDown', mod, flags),
    up: () => key('keyUp', mod),
    press: (k, extra = {}) => key('keyDown', k, { ...flags, ...extra }),
    release: k => key('keyUp', k, flags),
    now: () => now,
  };
}

for (const platform of ['darwin', 'win32', 'linux']) {
  const label = platform === 'darwin' ? 'Cmd on macOS' : `Ctrl on ${platform}`;

  test(`${label}: 1 then 5 within the time is tab 15, and the first digit does nothing on its own while it waits`, () => {
    const r = chordRig(platform, 20);
    r.down(); r.advance(300);
    assert.equal(r.hold.shown, true);
    assert.equal(r.press('1'), 'wait', 'main must not run Go to tab 1');
    assert.equal(r.hold.typed, 1);
    r.release('1'); r.advance(400);
    assert.deepEqual(r.picks, [], 'nothing yet');
    assert.equal(r.press('5'), 'taken', 'main runs nothing else with the second digit');
    assert.deepEqual(r.picks, ['15@700']);
    assert.equal(r.hold.typed, null);
    assert.equal(r.hold.shown, true, 'the numbers stay while digits are pressed');
    r.release('5'); r.advance(CHORD_MS * 3);
    assert.deepEqual(r.picks, ['15@700'], 'and nothing more happens when the time would have run out');
    r.up();
    assert.deepEqual(r.picks, ['15@700']);
  });

  test(`${label}: with 9 tabs or fewer no digit waits (a single digit acts at once, as always), and with 12 only 1 waits`, () => {
    const nine = chordRig(platform, 9);
    nine.down(); nine.advance(300);
    for (const k of ['1', '5', '9']) assert.equal(nine.press(k), undefined, `${k} is an ordinary shortcut with 9 tabs`);
    assert.equal(nine.hold.typed, null);
    assert.deepEqual(nine.picks, []);
    const twelve = chordRig(platform, 12);
    twelve.down(); twelve.advance(300);
    assert.equal(twelve.press('2'), undefined, '20 does not exist: 2 acts at once');
    assert.equal(twelve.press('9'), undefined, '90 does not exist: Ctrl+9 is the last tab at once');
    assert.equal(twelve.press('1'), 'wait', '10, 11 and 12 do');
    assert.equal(twelve.hold.typed, 1);
    const ten = chordRig(platform, 10);
    ten.down(); ten.advance(300);
    assert.equal(ten.press('1'), 'wait', 'ten tabs is where it starts');
  });

  test(`${label}: letting go after one digit sends it to that tab at once; 9 alone is the last tab`, () => {
    const r = chordRig(platform, 14);
    r.down(); r.advance(60);
    assert.equal(r.press('1'), 'wait');
    r.release('1'); r.advance(120);
    assert.deepEqual(r.picks, []);
    r.up();
    assert.deepEqual(r.picks, ['1@180'], 'at the moment of the release, not after the time');
    assert.equal(r.timers.size, 0, 'no timer is left');
    assert.equal(r.hold.typed, null);
    const nine = chordRig(platform, 120);
    nine.down(); nine.advance(500);
    assert.equal(nine.press('9'), 'wait', 'with 90 or more tabs 9 can be followed by a digit');
    nine.up();
    assert.deepEqual(nine.picks, ['-1@500'], 'alone it is still the last tab');
    const ninety = chordRig(platform, 120);
    ninety.down(); ninety.advance(500); ninety.press('9'); ninety.press('5');
    assert.deepEqual(ninety.picks, ['95@500'], 'with a second digit the two-digit number wins');
  });

  test(`${label}: a digit nobody follows goes to its tab when the time runs out, and the numbers then go as after any digit`, () => {
    const r = chordRig(platform, 14);
    r.down(); r.advance(300);
    assert.equal(r.press('1'), 'wait'); r.release('1');
    r.advance(CHORD_MS - 1);
    assert.deepEqual(r.picks, []);
    assert.equal(r.hold.shown, true, 'the linger does not take them away while a digit waits');
    r.advance(1);
    assert.deepEqual(r.picks, [`1@${300 + CHORD_MS}`]);
    assert.equal(r.hold.typed, null);
    assert.equal(r.hold.shown, true);
    r.advance(LINGER_MS);
    assert.equal(r.hold.shown, false, 'a release nobody heard still ends them');
  });

  test(`${label}: the second digit may be 0 (1 then 0 is tab 10), and a tab that does not exist does nothing`, () => {
    const r = chordRig(platform, 12);
    r.down(); r.advance(300);
    r.press('1');
    assert.equal(r.press('0'), 'taken', 'Ctrl+0 is the zoom reset; here it is the second digit');
    assert.deepEqual(r.picks, ['10@300']);
    r.press('1'); assert.equal(r.press('5'), 'taken');
    assert.deepEqual(r.picks, ['10@300'], 'there is no tab 15 of 12: nothing');
    assert.equal(r.hold.typed, null);
    assert.equal(r.hold.shown, true);
    r.press('1'); r.press('2');
    assert.deepEqual(r.picks, ['10@300', '12@300']);
  });

  test(`${label}: any other key sends the waiting digit to its tab first (and tells main so), then does what it does`, () => {
    for (const [name, extra] of [['c', {}], ['Shift', { shift: true }], ['Tab', {}], ['5', { shift: true }], ['3', { alt: true }]]) {
      const r = chordRig(platform, 14);
      r.down(); r.advance(300);
      assert.equal(r.press('1'), 'wait');
      r.advance(200);
      assert.equal(r.press(name, extra), 'flushed', `${name} follows the digit`);
      assert.deepEqual(r.picks, ['1@500'], name);
      assert.equal(r.hold.shown, false, `${name} hides the numbers as it always did`);
      assert.equal(r.hold.typed, null);
    }
  });

  test(`${label}: a wheel turn sends it, a window blur drops it, a new press of the modifier sends it`, () => {
    const wheel = chordRig(platform, 14);
    wheel.down(); wheel.advance(300); wheel.press('1'); wheel.hold.interrupt();
    assert.deepEqual(wheel.picks, ['1@300']);
    const blur = chordRig(platform, 14);
    blur.down(); blur.advance(300); blur.press('1'); blur.hold.cancel(); blur.advance(CHORD_MS * 2);
    assert.deepEqual(blur.picks, [], 'the person went elsewhere: no surprise tab change');
    assert.equal(blur.hold.typed, null);
    assert.equal(blur.timers.size, 0);
    const again = chordRig(platform, 14);
    again.down(); again.advance(300); again.press('1'); again.down();
    assert.deepEqual(again.picks, ['1@300'], 'a lost key-up cannot strand a digit');
  });

  test(`${label}: a release Chromium swallowed (the next key says the modifier is up) sends the waiting digit`, () => {
    const r = chordRig(platform, 14);
    r.down(); r.advance(300); r.press('1');
    r.hold.note({ type: 'keyUp', key: '1', shift: false, alt: false, control: false, meta: false, isAutoRepeat: false });
    assert.deepEqual(r.picks, ['1@300']);
    assert.equal(r.hold.shown, false);
  });

  test(`${label}: a held first digit (auto-repeat) is not a second press, and the modifier's own repeat changes nothing`, () => {
    const r = chordRig(platform, 14);
    r.down(); r.advance(300);
    assert.equal(r.press('1'), 'wait');
    assert.equal(r.press('1', { isAutoRepeat: true }), 'taken');
    assert.equal(r.hold.typed, 1);
    r.hold.note({ type: 'keyDown', key: platform === 'darwin' ? 'Meta' : 'Control', shift: false, alt: false, control: platform !== 'darwin', meta: platform === 'darwin', isAutoRepeat: true });
    assert.equal(r.hold.typed, 1, 'main sends this repeat itself to get the release heard');
    assert.equal(r.hold.shown, true);
    assert.deepEqual(r.picks, []);
    r.up();
    assert.deepEqual(r.picks, ['1@300']);
  });

  test(`${label}: a digit pressed before the numbers show still waits, and they show with it typed when the delay is over`, () => {
    const r = chordRig(platform, 14);
    r.down(); r.advance(80);
    assert.equal(r.press('1'), 'wait');
    assert.equal(r.hold.shown, false);
    r.advance(HOLD_MS);
    assert.deepEqual(r.shown, [`show@${HOLD_MS}:typed1`], 'the figures arrive on time (a quarter second after the modifier) with the 1 already typed');
    assert.equal(r.press('3'), 'taken');
    assert.deepEqual(r.picks, ['13@' + (80 + HOLD_MS)]);
    // and if the number is finished before they ever show, they never do for this hold
    const quick = chordRig(platform, 14);
    quick.down(); quick.advance(30); quick.press('1'); quick.press('4'); quick.advance(2000);
    assert.deepEqual(quick.shown, []);
    assert.deepEqual(quick.picks, ['14@30']);
    // a quick Cmd+1 and release flashes nothing
    const tap = chordRig(platform, 14);
    tap.down(); tap.advance(40); tap.press('1'); tap.release('1'); tap.up(); tap.advance(2000);
    assert.deepEqual(tap.shown, []);
    assert.deepEqual(tap.picks, ['1@40']);
  });

  test(`${label}: the typed digit is reported while it waits and cleared when it is done, however it ends`, () => {
    const r = chordRig(platform, 30);
    r.down(); r.advance(300);
    r.press('2'); r.press('7');
    r.press('1'); r.up();
    assert.deepEqual(r.typedLog, ['typed2', 'clear', 'typed1', 'clear']);
    assert.deepEqual(r.picks, ['27@300', '1@300']);
  });

  test(`${label}: the tab count is read when the digit is pressed and again for the second (tabs may close in between)`, () => {
    const r = chordRig(platform, 14);
    r.down(); r.advance(300);
    r.press('1');
    r.setCount(12);
    assert.equal(r.press('4'), 'taken');
    assert.deepEqual(r.picks, [], 'tab 14 went away: nothing');
    r.setCount(5);
    assert.equal(r.press('1'), undefined, 'with 5 tabs no digit waits any more');
  });

  test(`${label}: Escape and a mouse press drop a waiting digit (nothing is acted on); the numbers go with Escape and stay with the press`, () => {
    const esc = chordRig(platform, 14);
    esc.down(); esc.advance(300); esc.press('1');
    assert.equal(esc.press('Escape'), undefined, 'Escape is not "flushed": the digit was dropped');
    assert.deepEqual(esc.picks, []);
    assert.equal(esc.hold.typed, null);
    assert.equal(esc.hold.shown, false);
    esc.advance(CHORD_MS * 2);
    assert.deepEqual(esc.picks, [], 'and it does not come back when the time would have run out');
    const click = chordRig(platform, 14);
    click.down(); click.advance(300); click.press('1');
    click.hold.abandon();
    assert.deepEqual(click.picks, []);
    assert.equal(click.hold.typed, null);
    assert.equal(click.hold.shown, true);
    click.advance(CHORD_MS * 2);
    assert.deepEqual(click.picks, [], 'a click on another tab is not followed by a jump to tab 1');
    click.hold.abandon(); // nothing waiting: nothing happens
    assert.equal(click.hold.shown, false, 'the numbers still end by the linger, as after any digit');
  });
}
