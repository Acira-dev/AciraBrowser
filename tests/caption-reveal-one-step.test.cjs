'use strict';
// Windows caption notch: it must come and go as ONE piece. Founder's phone recording of beta.13 (8 Nov 2026, 25 fps crops): every reveal was a narrow dark box
// with maximise and close, five frames (200 ms) later the box widened and minimise appeared. Cause: the overlay's colours went on at once, but minimise and
// maximise (switched off while the caption is hidden, so a click on a transparent button does nothing) were switched back on by a 200 ms timer, and a window
// that cannot be minimised has no minimise button, so the box Windows draws is two buttons wide. Hiding was clean: buttons off and colours transparent in one tick.
//
// What is pinned here, with a fake window that records every call (a real one needs Windows):
//   - the ORDER: showing = buttons on, then colours; hiding = colours transparent, then buttons off (platform.cjs updateCaption is the real one);
//   - the INVARIANT, checked after EVERY call, not just after a tick (Chromium may put two calls in two frames): a visible overlay always has all three buttons
//     (minimise and maximise on), so no frame can show a box that is about to change width;
//   - nothing waits on a timer: after the colours are on, the overlay and the buttons are not touched again until the next hide;
//   - the same through the real poller (watchChromeEdges + caption-notch.cjs) at its 16 ms cadence, and beta.13's order as a negative control that the checks catch.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createCaptionGuard } = require('../desktop/caption-guard.cjs');
const { updateCaption } = require('../desktop/platform.cjs');
const { watchChromeEdges } = require('../desktop/edge-reveal.cjs');
const { realMainCaption, seen, alpha } = require('./caption-main-vm.cjs');

const NOTCH_HEIGHT = 34;
const SHOWN = { color: 'rgba(238,240,242,1)', symbolColor: '#26282b', height: NOTCH_HEIGHT, background: '#eef0f2' };
const HIDDEN = { color: '#00000000', symbolColor: '#00000000', height: NOTCH_HEIGHT, background: '#eef0f2' };

/** A BrowserWindow that remembers every call that matters to the caption, in order, and the state each call left behind. */
function fakeWindow({ minimizable = true, maximizable = true, maximized = false } = {}) {
  const state = { minimizable, maximizable, maximized, overlay: { ...HIDDEN }, overlays: [], calls: [], states: [] };
  const note = call => { state.calls.push(call); state.states.push({ call, minimizable: state.minimizable, maximizable: state.maximizable, overlay: { ...state.overlay } }); };
  const window = {
    isDestroyed: () => false,
    isMinimizable: () => state.minimizable, isMaximizable: () => state.maximizable, isMaximized: () => state.maximized,
    setMinimizable(on) { state.minimizable = on; note('setMinimizable(' + on + ')'); },
    setMaximizable(on) { state.maximizable = on; note('setMaximizable(' + on + ')'); },
    setTitleBarOverlay(overlay) { state.overlay = { ...overlay }; state.overlays.push({ ...overlay }); note(overlay.symbolColor === HIDDEN.symbolColor ? 'overlay(transparent)' : 'overlay(visible)'); },
    setBackgroundColor(color) { note('background(' + color + ')'); },
  };
  return { window, state };
}

const nothingOrFullBox = (states, label) => states.forEach(s => { const box = seen(s); assert.ok(box === null || box.buttons === 3, `${label}: after ${s.call} a visible overlay had ${box && box.buttons} buttons (minimise ${s.minimizable}, maximise ${s.maximizable})`); });

/** main.cjs setCaption's last step, as written there: the caption state flips, the guard orders the overlay and the buttons. */
function caption(window, { platform = 'win32' } = {}) {
  const guard = createCaptionGuard({ platform, window: () => window });
  return {
    guard,
    set(hidden) { guard.apply({ hidden, paint: () => updateCaption(window, { ...(hidden ? HIDDEN : SHOWN), hidden: false }, platform) }); },
  };
}

/** beta.13's guardCaption and setCaption order, kept here as the negative control: the overlay first, the buttons 200 ms later on a timer. */
function legacyCaption(window, timers) {
  let guard = null, timer = null, hiddenNow = false;
  const release = () => { if (!guard) return; window.setMinimizable(guard.min); if (guard.max !== null) window.setMaximizable(guard.max); guard = null; };
  const guardCaption = hidden => {
    if (timer) { timers.cancel(timer); timer = null; }
    if (hidden) { if (guard) return; guard = { min: window.isMinimizable(), max: window.isMaximized() ? null : window.isMaximizable() }; window.setMinimizable(false); if (guard.max !== null) window.setMaximizable(false); }
    else if (guard) timer = timers.add(release, 200);
  };
  return { set(hidden) { if (hiddenNow !== hidden) guardCaption(hidden); hiddenNow = hidden; updateCaption(window, { ...(hidden ? HIDDEN : SHOWN), hidden: false }, 'win32'); } };
}

test('showing: minimise and maximise come back first, then the colours; nothing is left for later', () => {
  const { window, state } = fakeWindow();
  const c = caption(window);
  c.set(true);
  state.calls.length = 0; state.states.length = 0;
  assert.equal(c.guard.held(), true, 'hidden: minimise and maximise are off');
  assert.equal(state.minimizable, false);
  assert.equal(state.maximizable, false);
  c.set(false);
  assert.deepEqual(state.calls, ['setMinimizable(true)', 'setMaximizable(true)', 'overlay(visible)', 'background(#eef0f2)'], 'the buttons come back while the overlay is still transparent, then the box shows');
  assert.equal(c.guard.held(), false);
  nothingOrFullBox(state.states, 'reveal');
});

test('hiding: the colours go transparent first, then minimise and maximise go off, then the overlay is re-applied', () => {
  const { window, state } = fakeWindow();
  const c = caption(window);
  c.set(true); c.set(false);
  state.calls.length = 0; state.states.length = 0;
  c.set(true);
  assert.deepEqual(state.calls, ['overlay(transparent)', 'background(#eef0f2)', 'setMinimizable(false)', 'setMaximizable(false)', 'overlay(transparent)', 'background(#eef0f2)'], 'transparent first, then the buttons, then the (still transparent) overlay again after their re-layout');
  nothingOrFullBox(state.states, 'hide');
  assert.equal(c.guard.held(), true);
});

test('no timer: the buttons are never switched on or off after the colours', () => {
  const real = { setTimeout: global.setTimeout, setImmediate: global.setImmediate }, started = [];
  global.setTimeout = (...args) => { started.push('setTimeout'); return real.setTimeout(...args); };
  global.setImmediate = (...args) => { started.push('setImmediate'); return real.setImmediate(...args); };
  try {
    const { window, state } = fakeWindow();
    const c = caption(window);
    for (let i = 0; i < 20; i++) c.set(i % 2 === 0);
    c.set(true);
    assert.deepEqual(started, [], 'the guard starts no timer');
    state.calls.length = 0;
    c.set(false);
    return new Promise(resolve => real.setTimeout(resolve, 260)).then(() => assert.deepEqual(state.calls, ['setMinimizable(true)', 'setMaximizable(true)', 'overlay(visible)', 'background(#eef0f2)'], 'a quarter of a second after the reveal nothing else was called'));
  } finally { global.setTimeout = real.setTimeout; global.setImmediate = real.setImmediate; }
});

test('a visible overlay always has all three buttons, after every single call, through any run of shows and hides', () => {
  for (const start of [{}, { maximized: true }, { minimizable: false }, { maximizable: false }]) {
    const { window, state } = fakeWindow(start);
    const c = caption(window);
    const was = { min: true, max: true };
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    c.set(true);
    for (let i = 0; i < 300; i++) c.set(next() < 0.5);
    c.set(false);
    assert.deepEqual({ min: state.minimizable, max: state.maximizable }, was, 'the main window is never created without them: visible means on, whatever they were ' + JSON.stringify(start));
    nothingOrFullBox(state.states, 'random run ' + JSON.stringify(start)); // even from a window whose flags were off: they are on before the first visible overlay
  }
});

test('a maximised window keeps its maximise flag (the restore button needs it); minimise still goes off and comes back', () => {
  const { window, state } = fakeWindow({ maximized: true });
  const c = caption(window);
  c.set(true);
  assert.deepEqual(state.calls.filter(call => /setM/.test(call)), ['setMinimizable(false)']);
  c.set(false);
  assert.deepEqual(state.calls.filter(call => /setM/.test(call)), ['setMinimizable(false)', 'setMinimizable(true)']);
  assert.equal(state.maximizable, true);
});

test('hiding twice, or showing twice, changes nothing more; the first hide\'s saved flags are what come back', () => {
  const { window, state } = fakeWindow({ minimizable: true, maximizable: true });
  const c = caption(window);
  c.set(true);
  const first = state.calls.length;
  c.set(true);
  assert.equal(state.calls.filter(call => /setM/.test(call)).length, 2, 'no second pair of switches');
  c.set(false);
  c.set(false);
  assert.deepEqual(state.calls.filter(call => /setM/.test(call)), ['setMinimizable(false)', 'setMaximizable(false)', 'setMinimizable(true)', 'setMaximizable(true)']);
  assert.ok(first > 0);
});

test('off Windows the guard only paints (the Mac has real AppKit buttons)', () => {
  const calls = [];
  const guard = createCaptionGuard({ platform: 'darwin', window: () => ({ isDestroyed: () => false, setMinimizable: () => calls.push('min'), setMaximizable: () => calls.push('max'), isMinimizable: () => true, isMaximizable: () => true, isMaximized: () => false }) });
  guard.apply({ hidden: true, paint: () => calls.push('paint') });
  guard.apply({ hidden: false, paint: () => calls.push('paint') });
  assert.deepEqual(calls, ['paint', 'paint']);
  const gone = createCaptionGuard({ platform: 'win32', window: () => null });
  gone.apply({ hidden: false, paint: () => calls.push('painted without a window') });
  assert.equal(calls.at(-1), 'painted without a window', 'no window: the paint step still runs, nothing else');
});

test('negative control: beta.13\'s order (colours now, buttons 200 ms later) shows a two-button box, and the check catches it', () => {
  const queue = [], timers = { add: (fn, ms) => { const entry = { fn, ms }; queue.push(entry); return entry; }, cancel: entry => { const at = queue.indexOf(entry); if (at >= 0) queue.splice(at, 1); } };
  const { window, state } = fakeWindow();
  const c = legacyCaption(window, timers);
  c.set(true);
  state.calls.length = 0; state.states.length = 0;
  c.set(false);
  const boxNow = seen(state.states.at(-1));
  assert.deepEqual(boxNow, { buttons: 1 }, 'beta.13: the box is on screen with the buttons off (what the phone recording shows as a narrow box)');
  assert.equal(queue[0].ms, 200);
  queue.shift().fn();
  assert.deepEqual(seen(state.states.at(-1)), { buttons: 3 }, '200 ms later the box widens');
  assert.throws(() => nothingOrFullBox(state.states, 'legacy'), /visible overlay had/);
});

test('main.cjs\'s real setCaption: the notch layout starts hidden, a reveal is the four calls in one tick, a hide is the four back, and a repeat is silent', () => {
  const { api, state } = realMainCaption();
  api.setCaption();
  assert.deepEqual(state.calls, ['overlay(transparent)', 'background(#00000000)', 'setMinimizable(false)', 'setMaximizable(false)', 'overlay(transparent)', 'background(#00000000)'], 'the layout asks for the notch: hidden at once (colours first, then the buttons off, then the transparent overlay again)');
  state.calls.length = 0;
  api.setCaption();
  assert.deepEqual(state.calls, [], 'a layout republish that changes nothing calls nothing');
  api.notchShown(true);
  assert.deepEqual(state.calls, ['setMinimizable(true)', 'setMaximizable(true)', 'overlay(visible)', 'background(#00000000)'], 'the pointer rests at the top: the buttons come back, then the box shows');
  assert.equal(api.hiddenNow(), false);
  assert.ok(api.shownAt() > 0, 'close keeps its 200 ms rule from the moment the box shows');
  state.calls.length = 0;
  api.notchShown(true); api.setCaption();
  assert.deepEqual(state.calls, [], 'nothing 200 ms later, or ever, until the pointer leaves');
  api.notchShown(false);
  assert.deepEqual(state.calls, ['overlay(transparent)', 'background(#00000000)', 'setMinimizable(false)', 'setMaximizable(false)', 'overlay(transparent)', 'background(#00000000)']);
  nothingOrFullBox(state.states, 'real setCaption');
  // The backdrop and the bounds: one overlay per change; the box is the same height (the notch's 34) whether shown or hidden, so only its colours change, in one call;
  // the shown backdrop is opaque (the frame colour at alpha 1) with the symbol colour on, the hidden one is transparent on both.
  assert.equal(state.overlays.length, 5, 'hidden at the start (twice: after the buttons changed), shown, hidden (twice): no more');
  assert.deepEqual(state.overlays.map(o => o.height), Array(5).fill(NOTCH_HEIGHT), 'the height never changes between states');
  assert.deepEqual(state.overlays.map(o => [alpha(o.color), alpha(o.symbolColor)]), [[0, 0], [0, 0], [1, 1], [0, 0], [0, 0]], 'backdrop and glyphs go on together and off together, in the one call');
  assert.deepEqual(Object.keys(state.overlays[1]).sort(), ['color', 'height', 'symbolColor'], 'the overlay carries colours and height only (Windows owns the buttons\' width)');
});

test('main.cjs\'s real setCaption: leaving Sidebar mode while the notch shows, and Seamless\'s own hidden caption, use the same one-step order', () => {
  const left = realMainCaption();
  left.api.setCaption(); left.api.notchShown(true);
  left.state.calls.length = 0;
  left.layout.captionNotch = false; left.layout.captionHeight = 40;
  left.api.setCaption();
  assert.deepEqual(left.state.calls, ['overlay(visible)', 'background(#00000000)'], 'the shown notch becomes the ordinary caption: already on, so only the colours change');
  const seamless = realMainCaption({ layout: { captionNotch: false, captionFloat: true, captionHidden: true, captionHeight: 40 } });
  seamless.api.setCaption();
  assert.deepEqual(seamless.state.calls, ['overlay(transparent)', 'background(#00000000)', 'setMinimizable(false)', 'setMaximizable(false)', 'overlay(transparent)', 'background(#00000000)'], 'Seamless, toolbar hidden');
  seamless.state.calls.length = 0;
  seamless.layout.captionHidden = false;
  seamless.api.setCaption();
  assert.deepEqual(seamless.state.calls, ['setMinimizable(true)', 'setMaximizable(true)', 'overlay(visible)', 'background(#00000000)'], 'Seamless, toolbar back: the same four calls');
  nothingOrFullBox(seamless.state.states, 'seamless');
});

test('through the real poller at 16 ms and main.cjs\'s real handler: the pointer rests at the top, the notch shows as one box; it leaves, it goes as one', () => {
  const clock = { t: 5000 };
  const { api, state } = realMainCaption();
  let timeout = null;
  const bounds = { x: 0, y: 0, width: 1200, height: 800 };
  const screen = { point: { x: 600, y: 400 }, getCursorScreenPoint() { return this.point; } };
  const w = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => bounds, on() {} };
  const item = { window: w, state: { settings: { verticalTabs: true } }, emit() {}, size: () => ({ topHeight: 6, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: false, side: true }), docked: () => true, suspended: () => false,
    notch: () => ({ active: true, hidden: api.hiddenNow() }), notchShown: api.notchShown };
  api.setCaption();
  watchChromeEdges({ app: { whenReady: () => Promise.resolve(), on() {} }, windows: () => [item], screen, view: () => 'full', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
  const frames = [];
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); frames.push(state.calls.length); } };
  return Promise.resolve().then(() => {
    timeout();
    state.calls.length = 0; state.states.length = 0;
    run(160);
    assert.deepEqual(state.calls, [], 'pointer in the page: nothing is called');
    screen.point = { x: 400, y: 2 };
    run(320);
    assert.deepEqual(state.calls, ['setMinimizable(true)', 'setMaximizable(true)', 'overlay(visible)', 'background(#00000000)'], 'the reveal is the four calls, once, in this order, and nothing 200 ms later');
    assert.deepEqual(frames.slice(-8).filter((n, at, all) => at && n !== all[at - 1]), [], 'the last 8 polls (128 ms) after the reveal call nothing');
    screen.point = { x: 600, y: 400 };
    run(1400);
    assert.deepEqual(state.calls.slice(4), ['overlay(transparent)', 'background(#00000000)', 'setMinimizable(false)', 'setMaximizable(false)', 'overlay(transparent)', 'background(#00000000)'], 'the hide is these calls, once, in this order');
    nothingOrFullBox(state.states, 'poller run');
  });
});

test('main.cjs wires it: the guard module, one apply per setCaption with the paint inside, no timer left, the close rule unchanged', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /const captionGuard=require\('\.\/caption-guard\.cjs'\)\.createCaptionGuard\(\{platform:process\.platform,window:\(\)=>mainWindow\}\);/);
  assert.match(main, /if\(captionHiddenNow&&!hidden\)captionShownAt=Date\.now\(\);\n captionHiddenNow=hidden;/, 'the flag is set before anything is painted, as the close handler reads it');
  assert.match(main, /captionGuard\.apply\(\{hidden,paint:again=>\{if\(again\|\|options\.force===true\|\|key!==captionKey\)\{updateCaption\(mainWindow,\{\.\.\.caption,hidden:layout\.captionHidden===true\}\);captionKey=key;\}\}\}\);\n\}/);
  assert.doesNotMatch(main, /guardCaption|captionGuardTimer|setTimeout\(release/, 'the 200 ms switch-on timer is gone');
  assert.match(main, /\(captionHiddenNow\|\|Date\.now\(\)-captionShownAt<200\)/, 'close keeps its own 200 ms rule: it changes nothing about how the box looks');
  assert.match(main, /if\(captionHiddenNow&&!hidden\)captionShownAt=Date\.now\(\);/);
  const guard = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'caption-guard.cjs'), 'utf8');
  assert.doesNotMatch(guard.replace(/\/\/.*$/gm, ''), /setTimeout|setInterval|setImmediate|requestAnimationFrame/, 'no timer in the guard');
});
