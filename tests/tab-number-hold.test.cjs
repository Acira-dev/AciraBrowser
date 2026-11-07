'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createTabNumberHold, HOLD_MS, LINGER_MS } = require('../desktop/tab-numbers.cjs');

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
  for (let i = 0; i < 4; i++) { r.advance(60); r.hold.note({ type: 'keyDown', key: 'Control', control: true, isAutoRepeat: true }); }
  assert.deepEqual(r.log, [], 'four repeats in, 240 ms');
  r.advance(10);
  assert.deepEqual(r.log, [`show@${HOLD_MS}`]);
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

test('the delay is 250 ms, and events that are not key presses are ignored', () => {
  assert.equal(HOLD_MS, 250);
  const r = rig('darwin');
  r.hold.note(null); r.hold.note({}); r.hold.note({ type: 'mouseDown' }); r.hold.note({ type: 'keyUp', key: 'a' });
  r.advance(1000);
  assert.deepEqual(r.log, []);
  assert.equal(r.hold.phase, 'idle');
});
