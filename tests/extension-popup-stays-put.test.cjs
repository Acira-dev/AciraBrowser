'use strict';
// 13.8 item 9, second hand test: once a popup has come down to its page it must STAY there (Proton Pass: "the first time I scroll, it adapts and fixes it, but then sometimes it
// glitches and makes it large again"; the picture flashed while it resized). One source of truth, as in Chromium's auto-size: the page's current size, applied on the next layout,
// never reverted to an older, larger one.
// What the reported trace showed (profile logs/extension-windows.log): "placed asked 430 got 545" 150-200 ms after every opening, "follows its page down 545 -> 430", and "the
// window grew back by 115" at 1.50 s after the opening, to the millisecond the older sizing measure's last timer (extension-action-sizing.cjs: 0, 150, 500, 1500 ms). That measure
// took the scroll height of the page's OWN scrollers into the popup's height: a list 115 px down holding 430 px of rows is 545, under a page whose root is fixed at 430. Chromium's auto-size
// reads the document element's scroll height only. Every path that could make the window taller than the page after it had come down is pinned here:
//  - the sizing measure (the inner-scroller height, and a body's min-height as the window's minimum height: both gone);
//  - a report that echoes the old window's height right after a follow step (checked against the page before it grows the window);
//  - the room fit() once learned for a size (capped to a scrollbar's worth, and forgotten when the follower comes down from it);
//  - a held minimum-size report that puts back "what the page asked" (the follower's height is what the page asks now);
//  - and the opening: a popup is shown after its page has loaded and sized itself, not at the early report that the load's reset to 25 x 25 then squashed in plain view.
// No Electron: the sizing script runs in a vm on a small fake page; the popup tests stop setTimeout (node's mock timers) so nothing depends on a timer's luck.
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {mock} = test;
const {ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
const {fitExtensionAction} = require('../desktop/browser-services/extension-action-sizing.cjs');
const follow = require('../desktop/browser-services/extension-popup-follow.cjs');
const {isFollowScript} = follow;
const isWatchScript = follow.isWatchScript || (() => false);
const {METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };

// ---- the sizing script, in a vm, on a page shaped like Proton Pass's popup --------------------------------------------------------------------------------------------------

/** What the sizing measure sees in a window of w x h: a root fixed at `content` tall, a list scroller 115 px down whose rows are `content` tall, a body that fills the window. */
function sizingPage({w, h, content = 430, scroller = {top: 115, clientHeight: 315, scrollHeight: 430}, bodyMinHeight = '0px'}) {
  const body = {scrollHeight: content, scrollWidth: w, computedStyleMap: () => ({get: () => '100%'})};
  const root = {scrollHeight: Math.max(h, content), scrollWidth: w};
  const list = {scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, getBoundingClientRect: () => ({top: scroller.top, width: w, height: scroller.clientHeight})};
  const bodyStyle = {minWidth: '0px', width: w + 'px', minHeight: bodyMinHeight};
  return {
    document: {body, documentElement: root, createTreeWalker: () => { let done = false; return {nextNode: () => (done ? null : (done = true, list))}; }},
    NodeFilter: {SHOW_ELEMENT: 1}, innerWidth: w, innerHeight: h,
    getComputedStyle: node => (node === body ? bodyStyle : {overflowY: 'auto'}),
  };
}
/** The text fitExtensionAction sends to the page, read off a stand-in popup. */
async function sizingScript() {
  const seen = [];
  const wc = Object.assign(new EventEmitter(), {isDestroyed: () => false, getURL: () => 'chrome-extension://abc/popup.html', executeJavaScript: async code => { seen.push(code); return null; }});
  const window = Object.assign(new EventEmitter(), {webContents: wc, isDestroyed: () => false, setMinimumSize() {}});
  const dispose = fitExtensionAction({extensionId: 'abc', browserWindow: window, webContents: wc, whenReady: async () => {}, setSize() {}, size: {width: 1, height: 1}});
  wc.emit('did-finish-load'); await wait(120); dispose();
  assert.ok(seen.length, 'the measure asked the page');
  return seen[0];
}
const runSizing = (script, page) => vm.runInNewContext(script, vm.createContext({...page}));

test('the sizing measure reads the document\'s height, not the height of the page\'s own scrollers (a list 115 px down with 430 px of rows is not a 545 px page)', async () => {
  const script = await sizingScript();
  for (const h of [430, 545, 600]) {
    const read = runSizing(script, sizingPage({w: 600, h}));
    assert.equal(read.height, Math.max(h, 430), `window ${h}: the document's scroll height, never the 545 the scroller would add`);
    assert.equal(read.width, 600);
  }
});

test('the sizing measure gives no minimum HEIGHT (a body that is min-height: 100vh is as tall as the window it was read in, and was the window\'s floor for good); the width keeps its explicit minimum', async () => {
  const script = await sizingScript();
  const read = runSizing(script, sizingPage({w: 480, h: 545, bodyMinHeight: '545px'}));
  assert.equal('minHeight' in read, false, 'not asked of the page');
  assert.ok(!/minHeight/.test(script) || !/setMinimumSize\(minWidth,minHeight\)/.test(script));
});

// ---- the popup ------------------------------------------------------------------------------------------------------------------------------------------------------------

let loadNever = false;   // the next popup's page never finishes loading
class FakeContents extends EventEmitter {
  constructor() { super(); this.closed = false; this.executed = {fit: 0, follow: 0, watch: 0, sizing: 0}; this.never = loadNever; }
  loadURL() { return this.never ? new Promise(() => {}) : Promise.resolve(); }
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
  constructor(options = {}) { super(); this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false; this.history = []; this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)}; }
  getBounds() { return {...this.bounds}; }
  setBounds(bounds) { this.bounds = {...bounds}; this.history.push([bounds.width, bounds.height]); if (this.onBounds) this.onBounds(this.bounds); }
  setMinimumSize(width, height) { this.minimum = [width, height]; }
  getContentBounds() { return this.content || this.getBounds(); }
  show() { this.visible = true; }
  isFocused() { return false; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; }
}

/**
 * A popup on a page like Proton Pass's: the root is fixed at `fixed` tall (430), so the page is `fixed` tall in any window of at least that; Blink reports (width, max(window, fixed)) when
 * that pair changes (the page echoes its window); the follower's probe reads `fixed`; the sizing measure runs the real script on a fake page that depends on the window.
 */
function popup({fixed = 430, width = 600, content, sizing = false} = {}) {
  const parent = new FakeWindow({});
  parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView(); ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; parent.contentView.addChildView(ui);
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const p = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
  const page = {fixed, width, content: content === undefined ? fixed : content, watchers: [], lastPair: null};
  p.page = page; p.scripts = {};
  const pair = () => [page.width, Math.max(p.size.height, page.content, page.fixed)];
  const metrics = () => ({iw: p.size.width, ih: p.size.height, ch: p.size.height, eh: Math.max(page.content, page.fixed), pins: 2, anim: 0});
  p.webContents.executeJavaScript = async script => {
    const w = p.size.width, h = p.size.height;
    if (script === METRICS_SCRIPT) { p.webContents.executed.fit++; return {iw: w, ih: h, cw: w, ch: h, sw: w, sh: Math.max(h, page.content, page.fixed), fh: h}; }
    if (isWatchScript(script)) {
      p.webContents.executed.watch++;
      if (/, null, \{"minGapMs"/.test(script)) return {...metrics(), why: ['start']};
      return new Promise(resolve => page.watchers.push(resolve));
    }
    if (isFollowScript(script)) { p.webContents.executed.follow++; return metrics(); }
    if (script.includes('explicitWidth')) {                       // the sizing measure: the real script, on this window's page
      p.webContents.executed.sizing++;
      const out = runSizing(script, sizingPage({w, h, bodyMinHeight: page.bodyMinHeight || '0px', content: Math.max(page.content, page.fixed), scroller: {top: 115, clientHeight: 315, scrollHeight: page.scrollerRows === undefined ? 430 : page.scrollerRows}}));
      return out;
    }
    throw new Error('unexpected script');
  };
  p.layout = (why = ['mutation']) => { const waiting = page.watchers.splice(0); for (const resolve of waiting) resolve({...metrics(), why}); return waiting.length; };
  // Blink: the pair is reported when it changes, after the window changes (the page echoes the window it has)
  p.window.onBounds = () => setImmediate(() => { if (p.destroyed || page.silent) return; const now = pair().join('x'); if (page.lastPair !== now && page.lastPair !== null) { page.lastPair = now; p.webContents.emit('preferred-size-changed', {}, {width: pair()[0], height: pair()[1]}); } else page.lastPair = now; });
  if (sizing) fitExtensionAction(p);
  return p;
}
const report = (p, width, height) => p.webContents.emit('preferred-size-changed', {}, {width, height});
const size = p => { const {width, height} = p.window.getBounds(); return [width, height]; };
const tallest = p => Math.max(...p.window.history.map(([, h]) => h));
/** Opened and shown at the size its page asked, with the follower's watch waiting (real timers; a test that stops setTimeout does so after this). */
async function opened({fixed = 0, content = 340, width = 360} = {}) {
  const p = popup({fixed, width, content});
  await p.whenReady();
  report(p, width, Math.max(fixed, content));
  await wait(70);
  assert.equal(p.window.visible, true);
  assert.equal(p.page.watchers.length, 1, 'the watch is waiting for the page');
  return p;
}

test('Proton Pass, in the order the reported trace shows: opened, then the sizing measure at 0, 150, 500 and 1500 ms, the follower, a scroll and a later report: the window is never taller than the page', async () => {
  mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1.7e12});
  const p = popup({fixed: 430, sizing: true});
  try {
    await p.whenReady();
    report(p, 600, 430);                                  // the page asks its size (600 x 430)
    p.page.lastPair = '600x430';
    const run = async ms => { for (let t = 0; t < ms; t += 20) { mock.timers.tick(20); await flush(3); } };
    await run(1700);                                      // all four sizing measures have run, and the follower
    assert.deepEqual(size(p), [600, 430]);
    assert.ok(p.webContents.executed.sizing >= 3, `${p.webContents.executed.sizing} sizing measures`);
    assert.ok(tallest(p) <= 430, `the window was ${tallest(p)} tall at some moment: ${JSON.stringify(p.window.history)}`);
    // the person scrolls (the page's DOM and layout signals), the page lays out again, a report comes
    p.webContents.emit('input-event', {}, {type: 'mouseWheel'});
    p.layout(['mutation', 'event']); p.webContents.emit('did-navigate-in-page');
    report(p, 600, 430);
    await run(400);
    p.layout(['box']); report(p, 600, 430); report(p, 600, 430);
    await run(2000);
    assert.deepEqual(size(p), [600, 430], 'still the page\'s size');
    assert.ok(tallest(p) <= 430, `never taller than the page: ${JSON.stringify(p.window.history)}`);
  } finally { p.destroy(); mock.timers.reset(); }
});

test('a body\'s min-height does not make the window\'s minimum height: the window may always come down to its page', async () => {
  const p = popup({fixed: 300, content: 300, sizing: true});
  p.page.bodyMinHeight = '300px';                          // body { min-height: 100vh } in a 300 px window
  try {
    await p.whenReady();
    report(p, 600, 300);
    await wait(1700);
    assert.ok(!p.window.minimum || p.window.minimum[1] <= 25, `minimum size ${p.window.minimum}`);
  } finally { p.destroy(); }
});

test('a report that echoes the window the follower has just come down from does not grow it back; one the page really needs does (checked against the page, in the turn the answer comes)', async () => {
  const p = await opened({content: 340});
  mock.timers.enable({apis: ['setTimeout']});
  try {
    p.page.content = 120;                                  // shorter: the follower brings the window down
    p.layout(); await flush();
    assert.deepEqual(size(p), [360, 120]);
    const mark = p.window.history.length;
    report(p, 360, 340);                                   // the page echoing the 340 px window it had, in flight while the window came down
    await flush();
    assert.deepEqual(size(p), [360, 120], 'dropped: the page does not need 340');
    assert.ok(p.window.history.slice(mark).every(([, h]) => h <= 120), `the window never went back up, not even for a moment: ${JSON.stringify(p.window.history.slice(mark))}`);
    p.page.content = 340;                                  // now it really does (a taller screen), and asks for exactly the height the window left
    report(p, 360, 340); await flush();
    assert.deepEqual(size(p), [360, 340], 'taken: the page needs it');
  } finally { p.destroy(); mock.timers.reset(); }
});

test('a newer report beats a report that is still being checked against the page', async () => {
  const p = await opened({content: 340});
  mock.timers.enable({apis: ['setTimeout']});
  try {
    p.page.content = 120; p.layout(); await flush();
    assert.deepEqual(size(p), [360, 120]);
    const mark = p.window.history.length;
    p.page.content = 340;
    report(p, 360, 340);                                   // checked (async)...
    p.page.content = 200;
    report(p, 360, 200);                                   // ...and a newer one arrives first
    await flush();
    assert.deepEqual(size(p), [360, 200], 'the newer report is the page\'s size; the older answer was dropped');
    assert.ok(p.window.history.slice(mark).every(([, h]) => h <= 200), `never through 340: ${JSON.stringify(p.window.history.slice(mark))}`);
  } finally { p.destroy(); mock.timers.reset(); }
});

test('a held minimum-size report restores what the page asks NOW, not the taller size it asked before it was followed down (13.7 put the old one back)', async () => {
  const p = await opened({content: 340});
  p.page.silent = true;                                    // the page's pair did not change, so it reports nothing after the follower's step
  try {
    p.page.content = 120; p.layout(); await flush();
    assert.deepEqual(size(p), [360, 120]);
    report(p, 25, 25);                                     // an echo of the minimum, inside the first second after the load: held
    assert.ok(p.echoPending, 'held');
    assert.deepEqual(size(p), [360, 120], 'the window goes back to the followed size, not to 360 x 340');
  } finally { p.destroy(); }
});

test('the room fit() once learned for a size is a scrollbar\'s worth at most, and is forgotten when the page has come down to that size: a later report for it is that size', async () => {
  const p = popup({fixed: 430, content: 430});
  try {
    await p.whenReady();
    report(p, 600, 430); await wait(70);
    p.learned.set('600x430', {width: 0, height: 115});     // what an overflow of the first moments left behind
    p.learned.set('600x500', {width: 15, height: 15});     // a real scrollbar's room
    p.page.fixed = 500; p.page.content = 500;
    report(p, 600, 500);
    assert.deepEqual(size(p), [615, 515], 'a scrollbar\'s room is still given back');
    p.page.fixed = 430; p.page.content = 430;
    report(p, 600, 429);
    assert.ok(size(p)[1] <= 429 + 24, `a stale 115 is not given back in full: ${size(p)}`);
    p.learned.set('600x430', {width: 0, height: 115});
    report(p, 600, 545);                                   // the window grows (the page echoes it) ...
    await wait(80);                                        // ... and the follower brings it down to the page: 430
    assert.deepEqual(size(p), [600, 430]);
    assert.equal(p.learned.has('600x430'), false, 'the room learned for the size it came down to is gone');
    report(p, 600, 429); report(p, 600, 430);
    assert.deepEqual(size(p), [600, 430], 'a report for that size is that size');
  } finally { p.destroy(); }
});

test('the popup is shown once its page has loaded and said its size after the reset to 25 x 25, not at an early report that the reset then squashes in plain view', async () => {
  const p = popup({fixed: 0, content: 340});
  try {
    report(p, 600, 430);                                   // before the load has ended
    assert.equal(p.window.visible, false, 'hidden: the load has not ended');
    await p.whenReady();
    assert.equal(p.window.visible, false, 'hidden: the page has not said its size after the reset');
    assert.deepEqual(size(p), [25, 25]);
    report(p, 25, 32);                                     // the page laid out at 25 px: the echo, held, the window goes back to the size it asked
    assert.equal(p.window.visible, false);
    assert.deepEqual(size(p), [600, 430]);
    report(p, 600, 430);                                   // its own size at last
    assert.equal(p.window.visible, true, 'shown now, at its size, laid out');
    assert.deepEqual(size(p), [600, 430]);
  } finally { p.destroy(); }
});

test('a page that says nothing after the reset (its size did not change) is shown anyway with the size it asked first, and so is one whose load never ends', async () => {
  const p = popup({fixed: 0, content: 430});
  p.page.silent = true;                                    // no report after the reset
  try {
    p.showFallbackMs = 30;
    report(p, 600, 430);
    await p.whenReady();
    assert.equal(p.window.visible, false);
    await wait(120);
    assert.equal(p.window.visible, true, 'shown after the fallback');
    assert.deepEqual(size(p), [600, 430], 'at the size it asked');
  } finally { p.destroy(); }
  loadNever = true;
  const q = popup({fixed: 0, content: 200});
  loadNever = false; q.page.silent = true;
  try {
    report(q, 300, 200);
    assert.equal(q.window.visible, false);
    q.armShow(40);                                         // (the shipped wait is 3 s from the start)
    await wait(120);
    assert.equal(q.window.visible, true);
    assert.deepEqual(size(q), [300, 200]);
  } finally { q.destroy(); }
});

test('a popup that is destroyed while hidden never shows later', async () => {
  const p = popup({fixed: 0, content: 340});
  p.showFallbackMs = 20; p.page.silent = true;
  const window = p.window;
  report(p, 600, 430);
  await p.whenReady();
  p.destroy();
  await wait(80);
  assert.equal(window.visible, false);
});
