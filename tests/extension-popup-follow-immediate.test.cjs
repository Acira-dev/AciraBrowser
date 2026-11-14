'use strict';
// 13.8 item 9, after the first hand test: the popup must follow its page on the NEXT LAYOUT, not at the next tick of a timer.
// A signed-in Proton Pass popup stayed a screen too tall (a white band of ~170 px) for about a second after its page changed: its root follows the window, so the page
// sends no size report when it gets shorter, and the follower only found out at its next timed look (every 250 ms, every 1000 ms when quiet) plus the 80 ms wait after a
// nudge and a 60 ms settle. Chromium resizes inside the page's own layout pass, so nobody sees the old size (ResizeDueToAutoResize, extension_popup.cc).
// What these tests pin, against stand-ins that start no Electron:
//  - followWatch, the page's own eyes (run here in a vm with a small fake DOM and a virtual clock): answers at once with a first reading; stays quiet while nothing changes;
//    measures on the next animation frame after a change; speaks only when the page became shorter than its window; follows a short animation frame by frame; rate-limits
//    itself on a page that changes without its height changing; ends itself after its heartbeat; and removes every observer and listener when it settles;
//  - the popup: a watch answer is applied in the same turn (no timer: setTimeout is stopped in these tests); a size report is followed at once (no 80 ms nudge); a held
//    minimum-size echo still holds, and nothing else does; once the hold ends the follower looks at once; the window gets exactly the height asked for even when room had
//    been learned for that size; a window that grows back holds the follower off and then follows again; a watch is installed once the page has loaded, one at a time, and is
//    dropped with the popup.
// (The tests that need the shipped timers use real time and short intervals; the "no timer" ones use node's mock timers for setTimeout only.)
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {mock} = test;
const {ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
const follow = require('../desktop/browser-services/extension-popup-follow.cjs');
const {followWatch, followScript, watchScript, isFollowScript, FOLLOW, WATCH} = follow;
const isWatchScript = follow.isWatchScript || (() => false);   // (282660788 has no watch: the popup tests below then fail on what the window does, not on a missing function)
const {METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };

// ---- Part 1: followWatch in a vm: a virtual clock, observers that can be fired, a fake page ---------------------------------------------------------------------------------

/** What a page offers followWatch, with a virtual clock. `dom` (optional) is the fake document and window size the real probe reads. */
function pageHarness(dom) {
  let now = 0, seq = 0;
  const timers = new Map(), frames = new Map(), listeners = [], observers = {mutation: [], box: []};
  class Observer { constructor(callback, kind) { this.callback = callback; this.alive = false; observers[kind].push(this); } observe() { this.alive = true; } disconnect() { this.alive = false; } }
  const sandbox = {
    performance: {now: () => now},
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, {at: now + (ms || 0), fn}); return id; },
    clearTimeout: id => { timers.delete(id); },
    requestAnimationFrame: fn => { const id = ++seq; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => { frames.delete(id); },
    window: {
      addEventListener: (type, fn, options) => { listeners.push({target: 'window', type, fn, capture: Boolean(options && options.capture)}); },
      removeEventListener: (type, fn, capture) => { const i = listeners.findIndex(x => x.target === 'window' && x.type === type && x.fn === fn && x.capture === Boolean(capture)); if (i >= 0) listeners.splice(i, 1); },
    },
    document: {documentElement: {}, body: {}, fonts: {addEventListener: (type, fn) => listeners.push({target: 'fonts', type, fn, capture: false}), removeEventListener: (type, fn) => { const i = listeners.findIndex(x => x.target === 'fonts' && x.type === type && x.fn === fn); if (i >= 0) listeners.splice(i, 1); }}, ...(dom && dom.document)},
    MutationObserver: class extends Observer { constructor(cb) { super(cb, 'mutation'); } },
    ResizeObserver: class extends Observer { constructor(cb) { super(cb, 'box'); } },
    ...(dom && dom.globals),
  };
  vm.createContext(sandbox);
  const h = {
    sandbox, observers, listeners,
    run: source => vm.runInContext(source, sandbox),
    /** The clock runs `ms` more; due timers fire in order; then the frame that was asked for (if any) is drawn. */
    step(ms = 16) {
      const until = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next.t.at)) next = {id, t};
        if (!next) break;
        now = Math.max(now, next.t.at); timers.delete(next.id); next.t.fn();
      }
      now = until;
      const due = [...frames]; frames.clear();
      for (const [, fn] of due) fn(now);
    },
    mutate() { for (const o of observers.mutation) if (o.alive) o.callback([]); },
    box() { for (const o of observers.box) if (o.alive) o.callback([]); },
    fire(type) { for (const l of [...listeners]) if (l.type === type) l.fn({type}); },
    get now() { return now; },
    get timers() { return timers.size; },
  };
  return h;
}

/** A probe stand-in: what the page measures is `state`; every call is counted and timed. */
function stubProbe(h, state) {
  const calls = [];
  const probe = () => { calls.push(h.now); const out = typeof state === 'function' ? state(calls.length) : state; return out && {...out}; };
  probe.calls = calls;
  return probe;
}
const watchOf = h => h.run('(' + followWatch.toString() + ')');
const reading = (eh, extra = {}) => ({iw: 360, ih: 362, ch: 362, eh, pins: 2, anim: 0, ...extra});
async function settled(promise) { let out = {done: false}; Promise.resolve(promise).then(value => { out = {done: true, value}; }); await flush(3); return out; }
const SINCE = {eh: 340, ch: 362, ih: 362};

test('followWatch: without an earlier reading it answers at once, and leaves nothing behind in the page', async () => {
  const h = pageHarness();
  const probe = stubProbe(h, reading(340));
  const answer = await watchOf(h)(probe, null, null, WATCH);
  assert.equal(answer.eh, 340);
  assert.deepEqual([...answer.why], ['start']);
  assert.equal(h.observers.mutation.length + h.observers.box.length, 0, 'no observer');
  assert.equal(h.listeners.length, 0, 'no listener');
  assert.equal(h.timers, 0, 'no timer');
  assert.equal(probe.calls.length, 1);
});

test('followWatch: quiet while nothing changes; after a change it measures on the NEXT FRAME and speaks if the page became shorter than its window', async () => {
  const h = pageHarness();
  const state = reading(340);
  const probe = stubProbe(h, () => state);
  const pending = watchOf(h)(probe, null, SINCE, WATCH);
  h.step(16);
  assert.equal(probe.calls.length, 1, 'one look at once (what changed between two watches)');
  assert.equal((await settled(pending)).done, false, 'it is the reading the host has already: silent');
  state.eh = 120;                       // the page got shorter (nothing said so: no size report)
  h.mutate();                           // a DOM change
  assert.equal(probe.calls.length, 1, 'nothing is measured before the frame (the layout the person is about to see is the one measured)');
  h.step(40);
  const result = await settled(pending);
  assert.equal(result.done, true, 'it spoke on that frame');
  assert.equal(result.value.eh, 120);
  assert.ok(result.value.why.includes('mutation'));
  assert.equal(probe.calls.length, 2);
});

test('followWatch: a change that does not make the page shorter than its window is not reported; neither is a reading it has already given', async () => {
  const h = pageHarness();
  const state = reading(362);           // the page fills its window
  const probe = stubProbe(h, () => state);
  const pending = watchOf(h)(probe, null, {eh: 362, ch: 362, ih: 362}, WATCH);
  h.step(16);
  state.eh = 361; h.mutate(); h.step(40);
  assert.equal((await settled(pending)).done, false, 'a page 1 px short is not a band');
  state.eh = 200; h.mutate(); h.step(80);       // shorter by 162: it speaks
  assert.equal((await settled(pending)).done, true);
});

test('followWatch: ResizeObserver, load, font and key events are changes too; a hover rule that grows the body is seen by its box', async () => {
  for (const trigger of [h => h.box(), h => h.fire('load'), h => h.fire('transitionend'), h => h.fire('animationend'), h => h.fire('click'), h => h.fire('loadingdone'), h => h.fire('resize')]) {
    const h = pageHarness();
    const state = reading(340);
    const probe = stubProbe(h, () => state);
    const pending = watchOf(h)(probe, null, SINCE, WATCH);
    h.step(16);
    state.eh = 100; trigger(h); h.step(40);
    assert.equal((await settled(pending)).done, true, String(trigger));
  }
});

test('followWatch: a page that changes without its height changing (a virtual list that scrolls) is measured less and less often, never more than every minGapMs', async () => {
  const h = pageHarness();
  const probe = stubProbe(h, () => reading(340));
  const pending = watchOf(h)(probe, null, SINCE, WATCH);
  for (let t = 0; t < 4000; t += 8) { h.mutate(); h.step(8); }
  assert.equal((await settled(pending)).done, false);
  const calls = probe.calls;
  assert.ok(calls.length < 20, `${calls.length} measures for 500 changes`);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i] - calls[i - 1] >= WATCH.minGapMs - 1, `gap ${calls[i] - calls[i - 1]}`);
  assert.ok(calls[calls.length - 1] - calls[calls.length - 2] >= WATCH.maxGapMs * 0.6, 'the gap grew to its ceiling');
});

test('followWatch: a short animation is followed frame by frame with no event at all (a height transition has none until its end)', async () => {
  const h = pageHarness();
  const probe = stubProbe(h, n => reading(Math.max(100, 340 - 40 * n), {anim: 1}));    // 340, 300, 260 ...
  const pending = watchOf(h)(probe, null, SINCE, WATCH);
  let spoke = null; pending.then(v => { spoke = v; });
  for (let i = 0; i < 6 && !spoke; i++) { h.step(16); await flush(2); }
  assert.ok(spoke, 'the page was followed while it animated, with no DOM change and no event');
  assert.ok(spoke.eh < 340 && spoke.why.includes('anim'));
  assert.ok(probe.calls.length <= 4, 'about every other frame, not every timer tick');
});

test('followWatch: an animation that never ends (a spinner) is not followed for ever, and one that is long is left alone', async () => {
  const h = pageHarness();
  const probe = stubProbe(h, () => reading(340, {anim: 1}));
  const pending = watchOf(h)(probe, null, SINCE, WATCH);
  for (let t = 0; t < WATCH.animMaxMs + 3000; t += 16) h.step(16);
  assert.equal((await settled(pending)).done, false);
  const late = probe.calls.filter(t => t > WATCH.animMaxMs + 100);
  assert.ok(late.length <= 6, `${late.length} measures after the animation allowance`);
});

test('followWatch: a frame that never comes (a window that is not drawing) is replaced by a timer', async () => {
  const h = pageHarness();
  const probe = stubProbe(h, () => reading(340));
  watchOf(h)(probe, null, SINCE, WATCH);
  h.sandbox.requestAnimationFrame = () => 0;     // frames are not delivered: step() cannot draw one
  h.step(WATCH.fallbackMs + 1);
  assert.equal(probe.calls.length, 1, 'measured by the timer');
});

test('followWatch: the heartbeat ends the watch; every observer and listener is gone afterwards and the page is not measured again', async () => {
  const h = pageHarness();
  const probe = stubProbe(h, () => reading(340));
  const pending = watchOf(h)(probe, null, SINCE, WATCH);
  h.step(16);
  assert.ok(h.listeners.length > 5 && h.observers.mutation[0].alive && h.observers.box[0].alive, 'installed');
  h.step(WATCH.heartbeatMs);
  const result = await settled(pending);
  assert.equal(result.done, true);
  assert.equal(result.value.heartbeat, true);
  assert.equal(h.listeners.length, 0, 'every listener removed');
  assert.ok(h.observers.mutation.every(o => !o.alive) && h.observers.box.every(o => !o.alive), 'every observer disconnected');
  const calls = probe.calls.length;
  h.mutate(); h.fire('click'); h.step(200);
  assert.equal(probe.calls.length, calls, 'nothing measures after it ended');
  assert.equal(h.timers, 0, 'no timer left');
});

test('followWatch: a probe that fails ends the watch with nothing (the host starts again); an answer is only ever given once', async () => {
  const h = pageHarness();
  const pending = watchOf(h)(() => { throw new Error('a page this cannot read'); }, null, SINCE, WATCH);
  h.step(16);
  assert.equal((await settled(pending)).value, null);
});

test('followWatch hands the host the engine\'s own promise even when the page replaced Promise with a polyfill (zone.js): the host waits for a promise it recognises', async () => {
  class Thenable {   // a page-made promise: not the engine's
    constructor(executor) { this.callbacks = []; this.settled = false; executor(value => { this.settled = true; this.value = value; for (const cb of this.callbacks) cb(value); }); }
    then(done) { if (this.settled) done(this.value); else this.callbacks.push(done); return this; }
  }
  const h = pageHarness({globals: {Promise: Thenable}});
  const native = h.run('(async () => {})().constructor');
  const result = h.run('(' + followWatch.toString() + ')')(() => reading(340), null, null, WATCH);
  assert.ok(result instanceof native, 'a promise of the engine, not the page\'s');
  assert.equal(Object.prototype.toString.call(result), '[object Promise]');
  assert.equal((await result).eh, 340);
});

test('followWatch writes nothing to the page: observers and listeners that stop nothing are all it adds', () => {
  const text = followWatch.toString();
  for (const write of [/\.style\b/, /setAttribute|removeAttribute|classList|appendChild|insertBefore|innerHTML|textContent\s*=|globalThis\.|window\.\w+\s*=/, /stopPropagation|stopImmediatePropagation|preventDefault|dispatchEvent/]) assert.ok(!write.test(text), 'touches the page: ' + write);
  assert.ok(/capture:\s*true,\s*passive:\s*true/.test(text), 'listeners are passive');
});

test('the scripts sent to the page are valid, carry the marker, and tell a watch from a plain look', () => {
  const script = watchScript({key: '1:2', hs: ['.a'], ms: []}, {eh: 1, ch: 2, ih: 2});
  assert.ok(isFollowScript(script) && isWatchScript(script));
  assert.ok(isFollowScript(followScript(null)) && !isWatchScript(followScript(null)));
  assert.ok(typeof new Function('return ' + script) === 'function', 'valid JavaScript');
  assert.ok(!script.includes('__NODES__'));
});

// The real probe, inside the real watch, against a small fake page (what the shipped script does in the popup's page, minus the engine's layout).
function fakeDom({content = 141, height = 362} = {}) {
  const style = (o = {}) => ({display: 'block', position: 'static', overflowY: 'visible', height: 'auto', minHeight: '0px', marginBottom: '0px', paddingBottom: '0px', borderBottomWidth: '0px', ...o});
  const el = (children, st, spec, bottom) => {
    const node = {nodeType: 1, childNodes: children, shadowRoot: null, st, spec, bottom};
    node.getBoundingClientRect = () => ({top: 0, bottom: node.bottom, height: node.bottom});
    node.computedStyleMap = () => ({get: name => node.spec[name]});
    return node;
  };
  const text = {nodeType: 3, nodeValue: 'hello'};
  const block = el([text], style(), {height: 'auto', 'min-height': 'auto'}, content);
  const body = el([block], style({height: height + 'px'}), {height: '100%', 'min-height': 'auto'}, height);
  const root = el([body], style({height: height + 'px'}), {height: '100%', 'min-height': 'auto'}, height);
  root.scrollHeight = height; root.clientHeight = height;
  const dom = {
    block, body, root,
    document: {
      documentElement: root, body, styleSheets: [], adoptedStyleSheets: [], fonts: {addEventListener() {}, removeEventListener() {}},
      querySelectorAll: () => [], createRange: () => ({selectNodeContents() {}, getBoundingClientRect: () => ({height: 20, bottom: block.bottom})}),
      getAnimations: () => [],
    },
    globals: {innerHeight: height, innerWidth: 360, getComputedStyle: node => node.st},
  };
  return dom;
}

test('the real probe and the real watch against a fake page: a first reading, then silence, then the page gets shorter and the watch says how tall it is now', async () => {
  const dom = fakeDom({content: 141, height: 362});
  const h = pageHarness(dom);
  const first = await h.run(watchScript(null, null));
  assert.equal(first.eh, 141, 'the content, not the 362 px window the root follows');
  assert.equal(first.ch, 362);
  assert.equal(first.anim, 0);
  assert.ok(first.rules && first.rules.key, 'the style rules are sent back the first time');
  const pending = h.run(watchScript(first.rules, {eh: first.eh, ch: first.ch, ih: first.ih}));
  h.step(16);
  assert.equal((await settled(pending)).done, false, 'the page is as it was');
  dom.block.bottom = 60; h.mutate(); h.step(40);
  const result = await settled(pending);
  assert.equal(result.done, true);
  assert.equal(result.value.eh, 60);
  assert.equal(result.value.rules, undefined, 'the rules it was given are not sent back');
});

// ---- Part 2: the popup and its follower, with a page that answers when the test says its layout changed --------------------------------------------------------------------

class FakeContents extends EventEmitter {
  constructor() { super(); this.closed = false; this.executed = {fit: 0, follow: 0, watch: 0}; }
  loadURL() { return Promise.resolve(); }
  isDestroyed() { return this.closed; }
  isDevToolsOpened() { return false; }
  close() { this.closed = true; }
  getURL() { return 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html'; }
  getZoomFactor() { return 1; }
  setWindowOpenHandler() {}
  focus() {}
}
class FakeView { constructor() { this.webContents = new FakeContents(); } setBackgroundColor() {} setBorderRadius() {} setBounds(bounds) { this.bounds = bounds; } }
class FakeWindow extends EventEmitter {
  constructor(options = {}) { super(); this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false; this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)}; }
  getBounds() { return {...this.bounds}; }
  setBounds(bounds) { this.bounds = {...bounds}; }
  getContentBounds() { return this.content || this.getBounds(); }
  show() { this.visible = true; }
  isFocused() { return false; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; }
}

/**
 * A popup whose page follows its window. page.content: the height its content needs; the probe reads that (the estimate is exact). p.watchers: the watches that are
 * waiting for the page to say something; p.layout(why) is "the page's layout changed": every waiting watch answers with the numbers of that moment.
 */
function popup({content = 340} = {}) {
  const parent = new FakeWindow({});
  parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView(); ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; parent.contentView.addChildView(ui);
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const p = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
  const page = {content};
  p.page = page; p.watchers = []; p.scripts = [];
  const metrics = () => ({iw: p.size.width, ih: p.size.height, ch: p.size.height, eh: typeof page.read === 'function' ? page.read(page) : page.content, pins: 3, anim: 0});
  p.webContents.executeJavaScript = async script => {
    const w = p.size.width, h = p.size.height;
    if (script === METRICS_SCRIPT) { p.webContents.executed.fit++; return {iw: w, ih: h, cw: w, ch: h, sw: w, sh: Math.max(h, page.content), fh: h}; }
    if (isWatchScript(script)) {
      p.webContents.executed.watch++; p.scripts.push(script);
      if (page.watchFails) throw new Error('a page this cannot be watched');
      const since = /, (null|\{[^{}]*\}), \{"minGapMs"/.exec(script)[1];
      if (since === 'null') return {...metrics(), why: ['start']};                    // the first reading: at once
      return new Promise(resolve => p.watchers.push(resolve));                       // then: when the page has something to say
    }
    if (isFollowScript(script)) { p.webContents.executed.follow++; return metrics(); }
    throw new Error('unexpected script');
  };
  p.layout = (why = ['mutation'], extra = {}) => { const waiting = p.watchers.splice(0); for (const resolve of waiting) resolve({...metrics(), why, ...extra}); return waiting.length; };
  return p;
}
const report = (p, width, height) => p.webContents.emit('preferred-size-changed', {}, {width, height});
const size = p => { const {width, height} = p.window.getBounds(); return [width, height]; };
/** Opened and shown, with its first watch waiting for the page (real timers). */
async function opened(content) {
  const p = popup({content});
  await p.whenReady();
  report(p, 360, content);
  await wait(70);
  assert.equal(p.watchers.length, 1, 'the watch is waiting for the page');
  return p;
}
const noTimers = fn => async () => { mock.timers.enable({apis: ['setTimeout']}); try { await fn(); } finally { mock.timers.reset(); } };

test('the page says it got shorter: the window follows in that very turn, with no timer (setTimeout is stopped)', async () => {
  const p = await opened(340);
  try {
    await noTimers(async () => {
      p.page.content = 120;
      assert.equal(p.layout(), 1);
      await flush();
      assert.deepEqual(size(p), [360, 120], 'the answer was applied in the turn it came');
      assert.equal(p.follower.steps, 1);
    })();
  } finally { p.destroy(); }
});

test('the next watch is already waiting after an answer, and the one after that follows too (a page that changes again and again)', async () => {
  const p = await opened(340);
  try {
    p.page.content = 200; p.layout(); await flush(); await wait(30);
    assert.deepEqual(size(p), [360, 200]);
    assert.equal(p.watchers.length, 1, 'one watch at a time, waiting');
    p.page.content = 90; p.layout(); await flush();
    assert.deepEqual(size(p), [360, 90]);
  } finally { p.destroy(); }
});

test('a size report on a page that follows its window is followed at once: no 80 ms nudge, no wait for the next tick', async () => {
  const p = await opened(340);
  try {
    await noTimers(async () => {
      p.page.content = 120;
      report(p, 300, 340);          // the width changed (a report); the height did not: the page is as tall as the window it has
      await flush();
      assert.deepEqual(size(p), [300, 120]);
    })();
  } finally { p.destroy(); }
});

test('a page that grows is taken in the same turn too (the report), and the follower does not pull it back', async () => {
  const p = await opened(200);
  try {
    await noTimers(async () => {
      p.page.content = 500; report(p, 360, 500);
      assert.deepEqual(size(p), [360, 500], 'applied in the report\'s own turn');
      p.layout(); await flush();
      assert.deepEqual(size(p), [360, 500]);
      assert.equal(p.follower.steps, 0);
    })();
  } finally { p.destroy(); }
});

test('only the 25 x 25 echo right after the load is held: any other report, small or not, is applied at once, inside the first second too', async () => {
  const p = popup({content: 340});
  try {
    await p.whenReady();
    report(p, 360, 340);
    await noTimers(async () => {
      report(p, 25, 25);                                  // the echo of the 25 x 25 window the load left behind
      assert.deepEqual(size(p), [360, 340], 'held: the window did not go to 25 x 25');
      assert.ok(p.echoPending);
      report(p, 100, 80);                                 // a real small size (both sides over the minimum): the page's own
      assert.deepEqual(size(p), [100, 80]);
      assert.equal(p.echoPending, undefined);
    })();
  } finally { p.destroy(); }
});

test('while a minimum-size report is held the follower stays out, and the moment the page ends the hold with its own report the window follows (no timer)', async () => {
  const p = await opened(340);
  try {
    await noTimers(async () => {
      report(p, 25, 25);                                  // held
      assert.ok(p.echoPending);
      p.page.content = 100;
      p.layout(); await flush();
      assert.deepEqual(size(p), [360, 340], 'no step while the hold lasts');
      report(p, 360, 340);                                // the page's own report: the hold is over
      await flush();
      assert.deepEqual(size(p), [360, 100], 'the follower looked at once');
    })();
  } finally { p.destroy(); }
});

test('a hold that is taken (the page really wants the minimum) lets the follower look at once too', async () => {
  const p = await opened(340);
  try {
    p.echoRecheckMs = 5;
    Object.assign(p.follower, {pollMs: 5000, quietPollMs: 5000});        // only look() can wake the follower in this test
    p.page.content = 25;
    const looked = p.webContents.executed.follow;
    report(p, 25, 25);
    for (const start = Date.now(); p.echoPending && Date.now() - start < 600;) await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.echoPending, undefined, 'taken');
    await flush(3);                                       // (the 80 ms nudge of the old follower is still far off)
    assert.deepEqual(size(p), [25, 25]);
    assert.ok(p.webContents.executed.follow > looked, 'and looked at straight away');
  } finally { p.destroy(); }
});

test('the window gets exactly the height the follower asks for, even when room was learned on top of that size (13.8: 430 asked, 545 given, "followed" back to 545)', async () => {
  const p = await opened(340);
  try {
    p.extra = {width: 0, height: 115}; p.learned.set('360x340', {width: 0, height: 115}); p.resize();
    assert.deepEqual(size(p), [360, 455]);
    p.followTo({height: 340});
    assert.deepEqual(size(p), [360, 340], 'the learned room is not added again');
    p.extra = {width: 0, height: 115}; p.resize();
    p.page.content = 340; p.layout(); await flush();
    assert.deepEqual(size(p), [360, 340], 'and the watch gets it there');
  } finally { p.destroy(); }
});

test('a window that is grown back after a follow step holds the follower off, then it follows again once the page has settled (not for good)', async () => {
  const p = await opened(340);
  try {
    p.follower.holdMs = 25;
    p.page.content = 120; p.layout(); await flush();
    assert.deepEqual(size(p), [360, 120]);
    p.page.content = 340;                                  // the page was mid-animation: it needs the whole window again (fit() grows it back)
    await wait(150);
    assert.deepEqual(size(p), [360, 340]);
    assert.ok(p.follower.regrows >= 1 && p.follower.disabled === false);
    p.page.content = 120; p.layout(['mutation']);           // settled for real
    await wait(120);
    assert.deepEqual(size(p), [360, 120], 'followed again after the hold');
    assert.equal(p.follower.disabled, false);
  } finally { p.destroy(); }
});

test('an answer of a page that has not caught up with its window is not used at once; it is looked at again within a frame or two and followed when the page has caught up', async () => {
  const p = await opened(340);
  try {
    p.page.content = 100; p.layout(['mutation'], {ih: 331}); await flush();       // the page still has the old viewport
    assert.deepEqual(size(p), [360, 340], 'laidOutIn says no: no step on those numbers');
    await wait(80);
    assert.deepEqual(size(p), [360, 100], 'looked at again: the page has the window\'s size now');
  } finally { p.destroy(); }
});

test('a runaway that answers each step with another (only its own resize, never a change of the page) is capped at two steps; a change of the page itself is followed again', async () => {
  const p = await opened(340);
  try {
    p.page.content = 30; p.page.read = () => Math.max(30, p.size.height - 40);     // every window it is given is 40 too tall for it
    for (let i = 0; i < 6; i++) { p.layout(['resize']); await flush(); await wait(24); }
    assert.equal(p.follower.steps, FOLLOW.MAX_PASSES, `${p.follower.steps} steps`);
    p.layout(['mutation']); await flush(); await wait(24);
    assert.equal(p.follower.steps, FOLLOW.MAX_PASSES + 1, 'a change of the page itself is followed again');
  } finally { p.destroy(); }
});

test('while the follower is busy (a minimum-size hold) the watch is not asked for the same reading in a loop, and the page is looked at again when the hold ends', async () => {
  const p = await opened(340);
  try {
    report(p, 25, 25);                                    // held
    assert.ok(p.echoPending);
    const before = p.webContents.executed.watch;
    p.page.content = 100; p.layout(); await wait(200);
    assert.ok(p.webContents.executed.watch - before <= 2, `${p.webContents.executed.watch - before} watches in 200 ms of a hold`);
    assert.deepEqual(size(p), [360, 340], 'no step during the hold');
    report(p, 360, 340);                                  // the page ends the hold
    await flush();
    assert.deepEqual(size(p), [360, 100], 'followed as the hold ended');
  } finally { p.destroy(); }
});

test('a heartbeat is not a reading: nothing is decided, and the next watch is started', async () => {
  const p = await opened(340);
  try {
    p.page.content = 100;
    p.layout(['heartbeat'], {heartbeat: true}); await flush();
    assert.deepEqual(size(p), [360, 340], 'a page that is shorter but did not say so (heartbeat) is left to the next look');
    await wait(40);
    assert.equal(p.watchers.length, 1);
    assert.equal(p.webContents.executed.watch, 3);
  } finally { p.destroy(); }
});

test('the watch starts only after the page has loaded and the popup is on screen, one at a time, and is dropped with the popup (a late answer does nothing)', async () => {
  const p = popup({content: 340});
  try {
    assert.equal(p.webContents.executed.watch, 0, 'not before the load');
    await p.whenReady(); await wait(30);
    assert.equal(p.webContents.executed.watch, 0, 'not while the popup is hidden');
    report(p, 360, 340);
    await wait(70);
    assert.equal(p.webContents.executed.watch, 2, 'the first reading, then the waiting watch');
    p.destroy();
    const before = p.webContents.executed.watch;
    p.page.content = 100; p.layout(); await flush(); await wait(40);
    assert.equal(p.webContents.executed.watch, before, 'no new watch for a popup that is gone');
    assert.equal(p.follower.timer, undefined);
  } finally { p.destroy(); }
});

test('a page that cannot be watched is tried a few times, then left to the timed look, which still follows it', async () => {
  const p = popup({content: 340});
  try {
    p.page.watchFails = true;
    Object.assign(p.follower, {restartMs: 4, pollMs: 6, quietPollMs: 6, retryMs: 3});
    await p.whenReady();
    report(p, 360, 340);
    await wait(250);
    assert.equal(p.follower.watchFailed, true);
    assert.equal(p.webContents.executed.watch, FOLLOW.RETRIES + 1, 'tried, and given up');
    p.page.content = 120;
    await wait(150);
    assert.deepEqual(size(p), [360, 120], 'the timed look is the net under it');
  } finally { p.destroy(); }
});

test('a page that loads again inside the popup gets a new watch, and the old document\'s answer, if it ever comes, is not used', async () => {
  const p = await opened(340);
  try {
    const before = p.webContents.executed.watch;
    p.webContents.emit('did-finish-load');
    await wait(60);
    assert.equal(p.webContents.executed.watch, before + 2, 'a first reading of the new document, then its waiting watch');
    p.page.content = 100;
    assert.equal(p.layout(), 2, 'the old document\'s watch and the new one both answer');
    await flush();
    assert.deepEqual(size(p), [360, 100]);
    assert.equal(p.follower.steps, 1, 'once: the old one was not used');
  } finally { p.destroy(); }
});
