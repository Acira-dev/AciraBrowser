'use strict';
// Windows: the minimise, maximise and close buttons must never be gone for good while the layout wants them (founder, 8 Nov 2026: "they sometimes glitch", seen on 13.1).
// Every test runs the REAL caption code cut out of main.cjs (tests/caption-main-vm.cjs) against a fake window, a fake screen and a fake clock, and most also run beta.13.1's
// code (tests/fixtures/caption-13-1.txt, verbatim) as the negative control: what fails there passes on the fix. The holes this closes (13.1 and the first 13.2 build had all):
//   - the overlay main last sent is never sent again (captionKey), so what Windows loses (a restore from minimised, a maximise, a display, scale or theme change, a lock or
//     sleep) stayed lost: now the overlay is re-sent on those events, once the burst is over (no timer sends anything, nothing on focus unless the state changed);
//   - a hidden caption came back only through the edge poller and, for Seamless and Hide the toolbar, a round trip through the interface: now the pointer STAYING in the
//     top-right corner for 1.2 s shows it anyway (at once while the interface is stopped or reloading), never ahead of the ordinary reveal, logged to main.log by kind;
//   - minimise and maximise could stay off under a visible overlay (an edge-triggered guard, a missed flip): now every caption change makes the flags match what is wanted.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { realMainCaption, fakeWindow, seen, NOTCH_HEIGHT } = require('./caption-main-vm.cjs');
const { createCaptionWatch, CORNER, DWELL_MS, HOLD_MS, SETTLE_MS } = require('../desktop/caption-watch.cjs');
const { createCaptionGuard } = require('../desktop/caption-guard.cjs');

const LEGACY = path.join(__dirname, 'fixtures', 'caption-13-1.txt');
const last = state => seen(state.states.at(-1));
const nothingOrFullBox = (states, label) => states.forEach(s => { const box = seen(s); assert.ok(box === null || box.buttons === 3, `${label}: after ${s.call} a visible overlay had ${box && box.buttons} buttons`); });
/** The pointer in the top-right corner of the fake window (bounds 100,50 1200x800): 20 px in from the right, 10 down; or far from it. */
const corner = ctx => { ctx.screen.point = { x: ctx.state.bounds.x + ctx.state.bounds.width - 20, y: ctx.state.bounds.y + 10 }; };
const awayFrom = ctx => { ctx.screen.point = { x: ctx.state.bounds.x + 500, y: ctx.state.bounds.y + 400 }; };
const plain = { captionNotch: false, captionHeight: 40 };
const notch = { captionNotch: true, captionHeight: NOTCH_HEIGHT };
const hiddenSeamless = { captionNotch: false, captionFloat: true, captionHidden: true, captionHeight: 40 };
const onScreen = ctx => ctx.state.drawn && seen({ overlay: ctx.state.drawn, minimizable: ctx.state.minimizable, maximizable: ctx.state.maximizable });

test('the fixture is beta.13.1\'s own code: guardCaption with its 200 ms timer, no re-send, no corner fallback', () => {
  const text = fs.readFileSync(LEGACY, 'utf8');
  assert.match(text, /function guardCaption\(hidden\)\{/);
  assert.match(text, /captionGuardTimer=setTimeout\(release,200\)/);
  assert.doesNotMatch(text, /captionWatch|force/);
});

test('an overlay that Windows lost is drawn again after a restore, a maximise, a display or theme change (events); 13.1 never drew it again', () => {
  for (const [name, legacy] of [['13.1', true], ['fix', false]]) {
    const ctx = realMainCaption({ source: legacy ? LEGACY : undefined, legacy, layout: plain });
    ctx.api.setCaption();
    assert.deepEqual(onScreen(ctx), { buttons: 3 }, name + ': the plain layout shows the full box');
    ctx.state.dropOverlay();
    assert.equal(onScreen(ctx), null, name + ': the buttons are gone from the screen (Windows dropped them) and main does not know');
    ctx.api.setCaption(); // the interface republishes the same layout: nothing differs, captionKey says "already sent"
    assert.equal(ctx.state.drawn, null, name + ': a repeat of the same overlay is skipped, so it stays gone');
    if (legacy) { ctx.advance(60_000); assert.equal(ctx.state.drawn, null, '13.1: nothing ever sends it again'); continue; }
    ctx.api.watch.event(); // 'restore', 'maximize', 'unmaximize', 'show', 'enter-full-screen', 'leave-full-screen', 'display-metrics-changed', 'updated', 'resume', 'unlock-screen', interface loaded
    ctx.advance(SETTLE_MS + 5);
    assert.deepEqual(onScreen(ctx), { buttons: 3 }, 'fix: sent again after the event, with all three buttons');
  }
});

test('nothing sends the overlay on a timer: a minute of quiet is no call at all (no flicker, no lost hover on real Windows)', () => {
  const ctx = realMainCaption({ layout: plain });
  ctx.api.setCaption();
  ctx.state.calls.length = 0;
  ctx.poll(60_000, 250);
  assert.deepEqual(ctx.state.calls, [], 'sixty seconds, no overlay call');
  const hidden = realMainCaption({ layout: notch });
  hidden.api.setCaption();
  hidden.state.calls.length = 0;
  hidden.poll(60_000, 250);
  assert.deepEqual(hidden.state.calls, [], 'and none while hidden with the pointer away');
});

test('the re-send is the same overlay (same colours, same height, one overlay call and the background); a burst of events is one re-send; focus sends nothing unless the state changed', () => {
  const ctx = realMainCaption({ layout: plain });
  ctx.api.setCaption();
  const before = ctx.state.overlays.at(-1);
  ctx.state.calls.length = 0;
  for (let i = 0; i < 60; i++) { ctx.api.watch.event(); ctx.advance(5); }
  ctx.advance(SETTLE_MS + 5);
  assert.deepEqual(ctx.state.calls, ['overlay(visible)', 'background(#00000000)'], 'sixty events, one overlay call');
  assert.deepEqual(ctx.state.overlays.at(-1), before);
  ctx.state.calls.length = 0;
  ctx.api.setCaption(); // main's focus handler is exactly this: setCaption(), not forced
  assert.deepEqual(ctx.state.calls, [], 'focus with nothing changed: nothing is sent');
  ctx.layout.captionForeground = '#112233'; // the state changed while the window was not focused
  ctx.api.setCaption();
  assert.deepEqual(ctx.state.calls, ['overlay(visible)', 'background(#00000000)'], 'and one overlay when it did');
  nothingOrFullBox(ctx.state.states, 're-send');
});

test('the corner fallback: the pointer STAYS in the corner for 1.2 s with the caption still hidden (the poller missed), then the buttons show; 13.1 never showed them', () => {
  for (const [name, legacy] of [['13.1', true], ['fix', false]]) {
    const ctx = realMainCaption({ source: legacy ? LEGACY : undefined, legacy, layout: notch });
    ctx.api.setCaption();
    assert.equal(last(ctx.state), null, name + ': hidden while the pointer is away');
    corner(ctx);
    ctx.poll(DWELL_MS - 100);
    assert.equal(last(ctx.state), null, name + ': before 1.2 s nothing (the ordinary reveal has this time to itself)');
    ctx.poll(300);
    if (legacy) { ctx.poll(60_000, 250); assert.equal(last(ctx.state), null, '13.1: the buttons stay gone however long the pointer sits on them'); continue; }
    assert.deepEqual(last(ctx.state), { buttons: 3 }, 'fix: after 1.2 s the box and all three buttons are there');
    assert.equal(ctx.api.hiddenNow(), false);
    assert.deepEqual(ctx.logged, ['Caption corner fallback: dwell'], 'logged to main.log, by kind only');
    nothingOrFullBox(ctx.state.states, 'corner reveal');
    awayFrom(ctx);
    ctx.poll(HOLD_MS - 100);
    assert.deepEqual(last(ctx.state), { buttons: 3 }, 'still there 400 ms after the pointer left (to come back and click)');
    ctx.poll(250);
    assert.equal(last(ctx.state), null, 'gone after the hold');
    assert.equal(ctx.api.forcedNow(), false);
    nothingOrFullBox(ctx.state.states, 'corner hide');
  }
});

test('it never beats the ordinary reveal: when the poller shows the caption first, the fallback does nothing and logs nothing', () => {
  for (const layout of [notch, hiddenSeamless]) {
    const ctx = realMainCaption({ layout });
    ctx.api.setCaption();
    corner(ctx);
    ctx.poll(300);
    assert.equal(last(ctx.state), null, 'at 300 ms the fallback has not fired');
    // the ordinary path: the poller's reveal (notch) or the interface answering with the toolbar shown (Seamless / Hide the toolbar)
    if (layout.captionNotch) ctx.api.notchShown(true); else { ctx.layout.captionHidden = false; ctx.layout.captionFloat = false; ctx.api.setCaption(); }
    const calls = ctx.state.calls.length;
    ctx.poll(DWELL_MS * 3);
    assert.equal(ctx.api.forcedNow(), false, 'never forced');
    assert.deepEqual(ctx.logged, [], 'nothing logged: the normal path did its job');
    assert.equal(ctx.state.calls.length, calls, 'and not a single extra call');
    nothingOrFullBox(ctx.state.states, 'ordinary reveal');
  }
});

test('the fallback also moves aside when the pointer only passes through the corner, and while the pointer is anywhere else', () => {
  const ctx = realMainCaption({ layout: notch });
  ctx.api.setCaption();
  for (let i = 0; i < 10; i++) { corner(ctx); ctx.poll(500); awayFrom(ctx); ctx.poll(100); }
  assert.equal(last(ctx.state), null, 'in and out every 600 ms: it never stayed 1.2 s');
  assert.deepEqual(ctx.logged, []);
  awayFrom(ctx);
  ctx.poll(10_000);
  assert.deepEqual(ctx.logged, []);
});

test('Seamless and Hide the toolbar: a caption stuck hidden (the interface answered nothing) comes back after the stay; the layout still hidden hides it again; a late answer wins', () => {
  const ctx = realMainCaption({ layout: hiddenSeamless });
  ctx.api.setCaption();
  assert.equal(last(ctx.state), null);
  assert.equal(ctx.api.guard.held(), true, 'hidden: minimise and maximise off');
  corner(ctx);
  ctx.poll(DWELL_MS + 100);
  assert.deepEqual(last(ctx.state), { buttons: 3 });
  assert.equal(ctx.api.guard.held(), false, 'visible: they are back on, before the overlay was');
  awayFrom(ctx);
  ctx.poll(HOLD_MS + 200);
  assert.equal(last(ctx.state), null, 'the layout (never republished) still says hidden: hidden again');
  assert.equal(ctx.api.guard.held(), true);
  ctx.layout.captionHidden = false; ctx.layout.captionFloat = false; // the interface answers late, toolbar shown
  ctx.api.setCaption();
  assert.deepEqual(last(ctx.state), { buttons: 3 });
  assert.equal(ctx.api.guard.held(), false);
  nothingOrFullBox(ctx.state.states, 'seamless');
});

test('a stopped or reloading interface: the buttons show at once at the corner (nothing else can show them), and the ordinary path is not waited for', () => {
  const ctx = realMainCaption({ layout: hiddenSeamless });
  ctx.api.setCaption();
  ctx.api.setInterfaceDown(true); // render-process-gone, did-start-loading
  corner(ctx);
  ctx.poll(100);
  assert.deepEqual(last(ctx.state), { buttons: 3 });
  assert.deepEqual(ctx.logged, ['Caption corner fallback: interface-down']);
  awayFrom(ctx);
  ctx.poll(HOLD_MS + 200);
  assert.equal(last(ctx.state), null);
  ctx.api.setInterfaceDown(false); // did-finish-load
  corner(ctx);
  ctx.poll(500);
  assert.equal(last(ctx.state), null, 'an interface that is up is waited for again');
});

test('the fallback looks only while the caption is hidden, and only at a window that is shown: not minimised, not fullscreen, not hidden', () => {
  const visible = realMainCaption({ layout: plain });
  visible.api.setCaption(); corner(visible);
  visible.poll(5000);
  assert.deepEqual(visible.logged, [], 'a caption that is visible on its own is left alone');
  const hid = realMainCaption({ layout: notch });
  hid.api.setCaption(); corner(hid);
  for (const gone of ['minimized', 'fullscreen']) { hid.state[gone] = true; hid.poll(DWELL_MS * 2); assert.equal(last(hid.state), null, gone + ': a corner you cannot see shows nothing'); hid.state[gone] = false; }
  hid.state.visible = false; hid.poll(DWELL_MS * 2);
  assert.equal(last(hid.state), null, 'a hidden window shows nothing');
  hid.state.visible = true; hid.poll(DWELL_MS + 100);
  assert.deepEqual(last(hid.state), { buttons: 3 }, 'shown again, with the pointer in the corner: after the stay');
});

test('the poller and the fallback agree: the poller\'s own reveal outlives the fallback; a hide from the poller does not take the buttons from under a pointer in the corner', () => {
  const a = realMainCaption({ layout: notch });
  a.api.setCaption(); corner(a); a.poll(DWELL_MS + 100);
  a.api.notchShown(true);
  awayFrom(a); a.poll(HOLD_MS + 300);
  assert.deepEqual(last(a.state), { buttons: 3 }, 'the poller\'s reveal outlives the fallback');
  a.api.notchShown(false);
  assert.equal(last(a.state), null, 'and its own hide hides');
  const b = realMainCaption({ layout: notch });
  b.api.setCaption(); corner(b); b.poll(DWELL_MS + 100);
  b.api.notchShown(true); b.api.notchShown(false);
  assert.deepEqual(last(b.state), { buttons: 3 }, 'the pointer is still in the corner');
  awayFrom(b); b.poll(HOLD_MS + 300);
  assert.equal(last(b.state), null);
  nothingOrFullBox(a.state.states, 'a'); nothingOrFullBox(b.state.states, 'b');
});

test('every caption change makes minimise and maximise match what is wanted, whatever happened to them: visible means on (13.1 left them off), hidden means off', () => {
  for (const [name, legacy] of [['13.1', true], ['fix', false]]) {
    const ctx = realMainCaption({ source: legacy ? LEGACY : undefined, legacy, layout: plain });
    ctx.api.setCaption();
    ctx.state.minimizable = false; ctx.state.maximizable = false; // Electron or Windows reset them: the box is one button wide
    ctx.layout.captionHeight = 41; // any republish that changes the caption
    ctx.api.setCaption();
    if (legacy) { assert.equal(ctx.state.minimizable, false, '13.1: they stay off under a visible overlay'); continue; }
    assert.equal(ctx.state.minimizable && ctx.state.maximizable, true, 'fix: back on');
    const order = ctx.state.calls.slice(ctx.state.calls.lastIndexOf('setMinimizable(true)'));
    assert.deepEqual(order.slice(0, 3), ['setMinimizable(true)', 'setMaximizable(true)', 'overlay(visible)'], 'before the overlay is painted');
    ctx.state.minimizable = false; // and when the layout republishes the very same caption (the overlay is "already sent"), the flags are still put right, and the overlay re-sent after them
    ctx.state.calls.length = 0;
    ctx.api.setCaption();
    assert.deepEqual(ctx.state.calls, ['setMinimizable(true)', 'overlay(visible)', 'background(#00000000)'], 'a flag that had to change is followed by the overlay again');
    ctx.layout.captionNotch = true; ctx.layout.captionHeight = NOTCH_HEIGHT;
    ctx.api.setCaption();
    assert.equal(ctx.state.minimizable || ctx.state.maximizable, false, 'hidden: off again');
    ctx.state.minimizable = true; // something switched minimise back on under the hidden notch: a click on the invisible button would minimise
    ctx.layout.captionHeight = 35;
    ctx.api.setCaption();
    assert.equal(ctx.state.minimizable, false, 'fix: the hidden corner is dead again');
  }
});

test('a guard that could not reach the window is not held for ever: the next change, whatever it is, puts the flags right (no "flip" is waited for)', () => {
  const { window, state } = fakeWindow();
  let reach = window;
  const guard = createCaptionGuard({ platform: 'win32', window: () => reach });
  guard.apply({ hidden: true, paint: () => {} });
  assert.equal(guard.held(), true);
  reach = null; // the window is not there for one call
  guard.apply({ hidden: false, paint: () => {} });
  reach = window;
  guard.apply({ hidden: false, paint: () => {} });
  assert.equal(guard.held(), false);
  assert.equal(state.minimizable && state.maximizable, true);
});

test('every transition that can happen to the window ends with the right caption: a matrix of layouts x window events, with the flags and the held state read at the end', () => {
  const layouts = { plain, notch, 'seamless hidden': hiddenSeamless, 'seamless shown': { captionNotch: false, captionFloat: true, captionHeight: 40 } };
  const events = {
    'maximise': ctx => { ctx.state.maximized = true; ctx.api.watch.event(); },
    'unmaximise': ctx => { ctx.state.maximized = false; ctx.api.watch.event(); },
    'enter full screen': ctx => { ctx.state.fullscreen = true; ctx.api.watch.event(); },
    'leave full screen': ctx => { ctx.state.fullscreen = false; ctx.api.watch.event(); },
    'minimise': ctx => { ctx.state.minimized = true; },
    'restore': ctx => { ctx.state.minimized = false; ctx.state.dropOverlay(); ctx.api.watch.event(); },
    'appearance switch': ctx => { ctx.layout.appearance = ctx.layout.appearance === 'dark' ? 'light' : 'dark'; ctx.api.setCaption(); },
    'interface reload': ctx => { ctx.api.setInterfaceDown(true); ctx.api.setInterfaceDown(false); ctx.api.watch.event(); },
    'display change': ctx => { ctx.state.dropOverlay(); ctx.api.watch.event(); },
    'lock and unlock': ctx => { ctx.state.dropOverlay(); ctx.api.watch.event(); },
    'focus': ctx => ctx.api.setCaption(),
  };
  for (const [layoutName, layoutInit] of Object.entries(layouts)) for (const [eventName, run] of Object.entries(events)) {
    const ctx = realMainCaption({ layout: layoutInit });
    ctx.api.setCaption();
    run(ctx); ctx.advance(SETTLE_MS + 5); ctx.poll(300);
    const wantHidden = (layoutInit.captionNotch || layoutInit.captionHidden) === true;
    const label = layoutName + ' / ' + eventName;
    if (wantHidden) {
      assert.equal(ctx.api.hiddenNow(), true, label + ': still hidden');
      assert.equal(ctx.api.guard.held(), true, label + ': held');
      assert.equal(ctx.state.minimizable || ctx.state.maximizable, false, label + ': a click on the invisible buttons does nothing');
    } else {
      assert.equal(ctx.api.hiddenNow(), false, label + ': visible');
      assert.equal(ctx.api.guard.held(), false, label + ': not held');
      assert.equal(ctx.state.minimizable && ctx.state.maximizable, true, label + ': flags on');
      assert.deepEqual(onScreen(ctx), { buttons: 3 }, label + ': the full box is on the screen');
    }
    nothingOrFullBox(ctx.state.states, label);
  }
});

test('a fullscreen or minimised window\'s buttons are not touched while it is away (Windows rewrites its style bits around it), and are put right when it is back', () => {
  for (const away of ['fullscreen', 'minimized']) {
    const ctx = realMainCaption({ layout: plain });
    ctx.api.setCaption();
    ctx.state[away] = true;
    ctx.state.minimizable = false; ctx.state.maximizable = false; // what Windows leaves behind in that state
    ctx.state.calls.length = 0;
    ctx.layout.captionHeight = 41; ctx.api.setCaption();
    assert.equal(ctx.state.calls.filter(call => /^setM/.test(call)).length, 0, away + ': no flag call while it is away');
    ctx.state[away] = false;
    ctx.api.watch.event(); ctx.advance(SETTLE_MS + 5); // 'leave-full-screen' / 'restore'
    assert.equal(ctx.state.minimizable && ctx.state.maximizable, true, away + ': on again, before the overlay');
    assert.deepEqual(onScreen(ctx), { buttons: 3 });
  }
});

test('the watcher on its own: a fake clock, a pointer, no main', () => {
  const clock = { t: 0, timers: [] }, calls = [];
  const win = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) };
  let point = { x: 500, y: 300 }, hidden = true;
  const watch = createCaptionWatch({ platform: 'win32', window: () => win, cursor: () => point, hidden: () => hidden, height: () => 34,
    setForced: on => { calls.push(on); hidden = !on; }, refresh: () => calls.push('refresh'), log: kind => calls.push('log ' + kind), now: () => clock.t,
    schedule: (fn, ms) => { const t = { fn, at: clock.t + ms, unref() {} }; clock.timers.push(t); return t; }, cancel: t => { clock.timers = clock.timers.filter(x => x !== t); } });
  const advance = ms => { const end = clock.t + ms; for (;;) { clock.timers.sort((a, b) => a.at - b.at); const n = clock.timers[0]; if (!n || n.at > end) break; clock.t = n.at; clock.timers.shift(); n.fn(); } clock.t = end; };
  const poll = (ms, step = 50) => { for (let left = ms; left > 0; left -= step) { advance(step); watch.tick(); } };
  poll(2000);
  assert.deepEqual(calls, [], 'pointer away: nothing');
  assert.equal(clock.timers.length, 0, 'and no timer of its own is running');
  point = { x: 1000 - 5, y: 5 }; poll(DWELL_MS - 100);
  assert.deepEqual(calls, []);
  poll(200);
  assert.deepEqual(calls, ['log dwell', true]);
  assert.equal(watch.forced(), true);
  point = { x: 1000 - CORNER.width - 3, y: 5 }; poll(600);
  assert.deepEqual(calls, ['log dwell', true], 'the leeway keeps it while the pointer is just outside the box');
  point = { x: 100, y: 400 }; poll(HOLD_MS + 100);
  assert.deepEqual(calls, ['log dwell', true, false]);
  watch.event(); watch.event(); advance(SETTLE_MS + 1);
  assert.deepEqual(calls.slice(3), ['refresh'], 'events: one re-send');
  watch.dispose();
  point = { x: 995, y: 5 }; poll(5000);
  watch.event(); advance(1000);
  assert.equal(calls.filter(call => call === true).length, 1, 'disposed: nothing runs');
  const mac = createCaptionWatch({ platform: 'darwin', window: () => win, cursor: () => point, hidden: () => true, height: () => 34, setForced: () => calls.push('mac'), refresh: () => calls.push('mac refresh'), now: () => clock.t, schedule: () => { throw new Error('no timer on the Mac'); }, cancel() {} });
  mac.tick(); mac.event();
  assert.ok(!calls.includes('mac') && !calls.includes('mac refresh'));
});

test('a notch is not left hidden under a pointer resting at the top when main reset its own state between two looks (a layout that left the mode for a moment); comparing with the poller\'s memory left it so', async () => {
  const { watchChromeEdges } = require('../desktop/edge-reveal.cjs');
  for (const [name, withIs] of [['the poller\'s memory (13.1)', false], ['main\'s real state (fix)', true]]) {
    const ctx = realMainCaption({ layout: notch });
    ctx.api.setCaption();
    let timeout = null;
    const item = { window: ctx.window, state: { settings: { verticalTabs: true } }, emit() {}, size: () => ({ topHeight: 6, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: false, side: true }), docked: () => true, suspended: () => false,
      notch: () => ({ active: ctx.layout.captionNotch === true, hidden: ctx.api.hiddenNow() }), notchShown: ctx.api.notchShown, ...(withIs ? { notchIsShown: ctx.api.notchIsShown } : {}) };
    watchChromeEdges({ app: { whenReady: () => Promise.resolve(), on() {} }, windows: () => [item], screen: ctx.screen, view: () => 'full', now: () => ctx.clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
    await Promise.resolve();
    const run = ms => { for (let i = 0; i < ms / 16; i++) { ctx.advance(16); const fn = timeout; timeout = null; fn(); } };
    ctx.screen.point = { x: ctx.state.bounds.x + 400, y: ctx.state.bounds.y + 2 };
    timeout(); run(400);
    assert.equal(ctx.api.hiddenNow(), false, name + ': the pointer rests at the top, the notch shows');
    // the layout leaves the mode and comes back between two looks (a docked right sidebar, a view switch): main resets its own state
    ctx.layout.captionNotch = false; ctx.api.setCaption();
    ctx.layout.captionNotch = true; ctx.api.setCaption();
    assert.equal(ctx.api.hiddenNow(), true, name + ': hidden by the reset');
    run(400);
    assert.equal(ctx.api.hiddenNow(), !withIs, name + (withIs ? ': shown again at the next look, the pointer never moved' : ': still hidden, the poller believes it is shown and never says so again'));
  }
});

test('an overlay that could not be set is not "already sent" and does not take the layout with it: it is tried again after the next event, three times at most', () => {
  const ctx = realMainCaption({ layout: plain });
  ctx.state.failOverlay = 1;
  assert.doesNotThrow(() => ctx.api.setCaption(), 'the layout call survives');
  assert.equal(ctx.state.drawn, null, 'nothing was drawn');
  assert.match(ctx.logged[0], /^Caption overlay: Error: the overlay could not be set/, 'written down');
  ctx.advance(SETTLE_MS + 5);
  assert.deepEqual(onScreen(ctx), { buttons: 3 }, 'sent again by the retry');
  const stuck = realMainCaption({ layout: plain });
  stuck.state.failOverlay = 99;
  stuck.api.setCaption(); stuck.advance(10 * (SETTLE_MS + 5));
  assert.equal(99 - stuck.state.failOverlay, 4, 'one try and three retries, then it stops (the next layout change tries again)');
});

test('the edge poller keeps looking when one window\'s getter throws (it used to stop for every window, and with it every reveal and the corner fallback)', () => {
  const { watchChromeEdges } = require('../desktop/edge-reveal.cjs');
  const clock = { t: 5000 }, ticks = [];
  let timeout = null, boom = true;
  const w = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, isFullScreen: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }), on() {} };
  const item = { window: w, state: { settings: {} }, emit() {}, size: () => ({ topHeight: 0, sideWidth: 0 }), holds: () => ({ top: false, side: false }), edges: () => { if (boom) { boom = false; throw new Error('a getter threw'); } return { top: false, side: false }; }, docked: () => true, suspended: () => false,
    captionTick: () => { ticks.push(clock.t); } };
  const warned = [], warn = console.warn; console.warn = (...args) => warned.push(args.join(' '));
  try {
    watchChromeEdges({ app: { whenReady: () => Promise.resolve(), on() {} }, windows: () => [item], screen: { getCursorScreenPoint: () => ({ x: 500, y: 400 }) }, view: () => 'full', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
    return Promise.resolve().then(() => {
      for (let i = 0; i < 6; i++) { clock.t += 250; const fn = timeout; timeout = null; assert.ok(fn, 'a next look was scheduled (look ' + i + ')'); fn(); }
      assert.equal(ticks.length, 6, 'six looks, the first one threw halfway');
      assert.equal(warned.length, 1, 'and the trouble was written down once');
    }).finally(() => { console.warn = warn; });
  } catch (error) { console.warn = warn; throw error; }
});

test('main.cjs wires it: the poller tick, the events, the cleanup, the interface state, the log, and no timer sending the overlay', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8'), poller = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'edge-reveal.cjs'), 'utf8');
  assert.match(main, /const captionWatch=require\('\.\/caption-watch\.cjs'\)\.createCaptionWatch\(\{platform:process\.platform,window:\(\)=>mainWindow,cursor:\(\)=>screen\.getCursorScreenPoint\(\),hidden:\(\)=>captionHiddenNow,interfaceDown:\(\)=>interfaceDown,height:\(\)=>layout\.captionHeight,log:kind=>processErrors\.record\('Caption corner fallback',kind\),setForced:on=>\{if\(captionForced===on\)return;captionForced=on;setCaption\(\);\},refresh:\(\)=>\{if\(layout\.viewport\)setCaption\(\{force:true\}\);\}\}\);/);
  assert.match(main, /captionTick:\(\)=>captionWatch\.tick\(\)/);
  assert.match(poller, /try \{ item\.captionTick\?\.\(\); \} catch \{\}/, 'the poller calls it, whoever holds the keyboard, and can never be broken by it');
  assert.match(main, /for\(const event of \['maximize','unmaximize','restore','show','enter-full-screen','leave-full-screen'\]\)mainWindow\.on\(event,again\);mainWindow\.on\('focus',\(\)=>\{if\(layout\.viewport\)setCaption\(\);\}\);/, 'focus re-checks, it does not re-send; resize and move do nothing');
  assert.match(main, /\[screen,\['display-metrics-changed','display-added','display-removed'\]\],\[powerMonitor,\['resume','unlock-screen'\]\],\[nativeTheme,\['updated'\]\]/);
  assert.match(main, /captionWatch\.dispose\(\);captionEvents\?\.\(\);/, 'every listener comes off when the window closes');
  assert.match(main, /if\(kind==='browser'\)\{interfaceDown=false;markWindowMaterial\(\);captionWatch\.event\(\);\}/, 'an interface that loaded again sends it again');
  assert.match(main, /if\(kind==='browser'\)interfaceDown=true;/, 'it is down from the crash');
  assert.match(main, /contents\.on\('did-start-loading',\(\)=>\{if\(kind==='browser'\)interfaceDown=true;\}\);/, 'and while it reloads');
  assert.match(main, /&&!captionForced;\n if\(captionHiddenNow&&!hidden\)captionShownAt=Date\.now\(\);/, 'a forced reveal also starts the close guard\'s 200 ms');
  const watch = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'caption-watch.cjs'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(watch, /setInterval|REFRESH_MS|refreshTimer|lookTimer/, 'no timer of its own but the one-shot settle after an event');
});
