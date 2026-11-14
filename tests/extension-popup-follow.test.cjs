'use strict';
// 13.8 item 9: an extension popup follows a size change of its page after it has opened.
// Chromium's popup is sized by Blink's auto-size loop (FrameViewAutoSizeInfo, after every layout: reset to the minimum, measure, set) and resized to it each time
// (ExtensionPopup::OnExtensionSizeChanged); Electron has no auto-resize for a view, only preferred-size-changed, which does not change when a page whose root follows
// the window (html, body { height: 100% }, a 100vh block) gets shorter content: the window kept the old size, a white band under the new view. Chromium reads such a height
// against the 25 px minimum viewport, so the page is as tall as its content (frame_view_auto_size_info.cc); extension-popup-follow.cjs reads the page without touching it and
// brings the window to the page's height.
// These tests pin the decision (followStep), the follower's rules (after the load, never twice in a row without the page saying something, an estimate that was
// short learned or given up, nothing after the popup is gone) and the popup's use of it, against a fake page that follows the window like those pages do.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
const {followStep, FOLLOW, FOLLOW_SCRIPT, followProbe, isFollowScript, isWatchScript} = require('../desktop/browser-services/extension-popup-follow.cjs');
const {METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('followStep: a window taller than its page by more than the rounding slack goes down to the page, once; nothing else moves', () => {
  const size = {width: 360, height: 362};
  assert.deepEqual(followStep({iw: 360, ih: 362, ch: 362, eh: 141.4}, size), {height: 142}, 'the page is 141.4 px tall: the window takes it whole');
  assert.equal(followStep({iw: 360, ih: 362, ch: 362, eh: 361.5}, size), null, 'the page fills the window');
  assert.equal(followStep({iw: 360, ih: 362, ch: 362, eh: 360}, size), null, 'two pixels of slack are rounding, not a band');
  assert.equal(followStep({iw: 360, ih: 362, ch: 362, eh: null}, size), null, 'a page that could not be read is left alone');
  assert.equal(followStep({iw: 360, ih: 362, ch: 362, eh: 500}, size), null, 'a page taller than the window is the business of the size reports and fit()');
  assert.equal(followStep(null, size), null);
  assert.equal(followStep({iw: 360, ih: 362, ch: 362, eh: 141}, null), null);
});

test('followStep: Blink\'s bounds (at least 25, at most the limit), a scrollbar\'s room, the learned shortfall and the zoom', () => {
  const size = {width: 360, height: 362};
  assert.deepEqual(followStep({iw: 360, ih: 362, ch: 362, eh: 3}, size), {height: 25}, 'never below the minimum popup size');
  assert.deepEqual(followStep({iw: 360, ih: 362, ch: 347, eh: 100}, size), {height: 115}, 'a horizontal scrollbar of 15 keeps its room under the page');
  assert.equal(followStep({iw: 360, ih: 362, ch: 362, eh: 141}, size, 1, undefined, 220), null, 'a page seen to need 220 more than it was read as is not shrunk to the read');
  assert.deepEqual(followStep({iw: 288, ih: 290, ch: 290, eh: 112.5}, {width: 360, height: 362}, 1.25), {height: 141}, 'at 125 % the page is 112.5 CSS px = 140.6 DIPs');
  assert.deepEqual(followStep({iw: 360, ih: 700, ch: 700, eh: 650}, {width: 360, height: 700}, 1, {minHeight: 25, maxHeight: 600}), {height: 600}, 'bounded by the limit like any popup size');
});

test('the probe is one expression, replaces its node limit, and touches nothing: it reads, it does not write (no style, attribute, listener or global)', () => {
  assert.match(FOLLOW_SCRIPT, /^\/\*acira:popup-follow\*\/\(function followProbe\(known\)/);
  assert.ok(!FOLLOW_SCRIPT.includes('__NODES__'), 'the limit is filled in');
  assert.ok(FOLLOW_SCRIPT.includes(String(FOLLOW.NODES)));
  const text = followProbe.toString();
  for (const write of [/\.style\s*[.\[]\s*\w+\s*=/, /setAttribute|removeAttribute|classList|appendChild|insertBefore|addEventListener|innerHTML|textContent\s*=|window\.\w+\s*=|globalThis\./]) assert.ok(!write.test(text), 'writes ' + write);
  assert.ok(typeof new Function('return ' + FOLLOW_SCRIPT) === 'function', 'valid JavaScript');
});

let loadDelay = 0;   // how long the next popup's page takes to load
class FakeContents extends EventEmitter {
  constructor() { super(); this.closed = false; this.executed = {fit: 0, follow: 0}; this.delay = loadDelay; }
  loadURL() { return this.delay ? new Promise(resolve => setTimeout(resolve, this.delay)) : Promise.resolve(); }
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
  constructor(options = {}) {
    super();
    this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false;
    this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)};
  }
  getBounds() { return {...this.bounds}; }
  setBounds(bounds) { this.bounds = {...bounds}; }
  getContentBounds() { return this.content || this.getBounds(); }
  show() { this.visible = true; }
  isFocused() { return false; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; }
}

/**
 * A popup whose page follows its window (html { height: 100% }): `page.content` is the height its content needs (CSS px); the page is as tall as the larger of that and
 * the window (overflow shows as a scrollbar's scroll height, which fit() grows the window to); `page.read` is what the probe reports (the estimate): by default the truth.
 */
function popup(content = 340, {read} = {}) {
  const parent = new FakeWindow({});
  parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView(); ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; parent.contentView.addChildView(ui);
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const p = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
  const page = {content, width: 360, read};
  p.page = page;
  p.webContents.executeJavaScript = async script => {
    const w = p.size.width, h = p.size.height;
    if (script === METRICS_SCRIPT) { p.webContents.executed.fit++; return {iw: w, ih: h, cw: w, ch: h, sw: w, sh: Math.max(h, page.content), fh: h}; }
    if (isWatchScript(script)) { p.webContents.executed.follow++; return new Promise(() => {}); }   // an idle page: the watch has nothing to say (these tests are about the timed look; follow-immediate has the watch)
    if (isFollowScript(script)) { p.webContents.executed.follow++; return {iw: w, ih: h, ch: h, eh: page.read === undefined ? page.content : typeof page.read === 'function' ? page.read(page) : page.read, pins: 4}; }
    throw new Error('unexpected script');
  };
  // a quick follower: the real intervals are 250 ms and more
  if (p.follower) Object.assign(p.follower, {pollMs: 6, quietPollMs: 6, nudgeMs: 3, retryMs: 3});   // (13.7 has no follower: the tests then fail on what the window does)
  return p;
}
const report = (p, width, height) => p.webContents.emit('preferred-size-changed', {}, {width, height});
const size = p => { const {width, height} = p.window.getBounds(); return [width, height]; };
async function opened(content, options) {
  const p = popup(content, options);
  await p.whenReady();
  report(p, 360, content);   // the page asks its size (the window takes it and the popup shows)
  await wait(40);
  return p;
}

test('the real 13.7 failure: a page that follows its window gets shorter content, nothing is reported, and the window comes down to the page (13.7 kept 362 forever)', async () => {
  const p = await opened(340);
  assert.deepEqual(size(p), [360, 340]);
  assert.equal(p.window.visible, true);
  p.page.content = 120;   // the signed-in view is shorter; the page is as tall as the window, so Blink reports the same size again: no report at all
  await wait(150);
  assert.deepEqual(size(p), [360, 120], 'the window follows the page down');
  p.destroy();
});

test('growing again afterwards: the page asks for more (a report), the window grows, and shrinking again follows once more', async () => {
  const p = await opened(340);
  p.page.content = 120; await wait(100);
  assert.deepEqual(size(p), [360, 120]);
  p.page.content = 300; report(p, 360, 300);
  await wait(100);
  assert.deepEqual(size(p), [360, 300], 'the report is taken as always');
  p.page.content = 90; await wait(120);
  assert.deepEqual(size(p), [360, 90]);
  p.destroy();
});

test('a click or a key in the popup brings the follower in at once, not at the next quiet tick', async () => {
  const p = await opened(340);
  Object.assign(p.follower, {pollMs: 5000, quietPollMs: 5000});   // only a nudge can wake it in this test
  await wait(20);
  p.page.content = 150;
  p.webContents.emit('input-event', {}, {type: 'mouseDown'});
  await wait(80);
  assert.deepEqual(size(p), [360, 150]);
  p.page.content = 90;
  p.webContents.emit('input-event', {}, {type: 'mouseMove'});    // a move is not activity
  await wait(80);
  assert.deepEqual(size(p), [360, 150], 'a mouse move does not make the follower look');
  p.webContents.emit('input-event', {}, {type: 'rawKeyDown'});   // what the engine calls a key press
  await wait(80);
  assert.deepEqual(size(p), [360, 90]);
  p.destroy();
});

test('Blink lets a size shrink only after the load: nothing is followed before the page has loaded, and not while a held minimum-size report is pending', async () => {
  loadDelay = 80;
  const p = popup(340);
  loadDelay = 0;
  p.showFallbackMs = 30;                     // (the size it asked first is shown this long after the load if the page says nothing more)
  report(p, 360, 340);                       // asked before the load has ended: not shown yet (Chromium keeps a popup hidden until its page has loaded and sized itself)
  p.page.content = 100;
  await wait(50);
  assert.equal(p.window.visible, false);
  assert.equal(p.webContents.executed.follow, 0, 'not looked at before the load finished');
  await p.whenReady(); await wait(120);
  assert.equal(p.window.visible, true, 'shown once loaded');
  assert.ok(p.webContents.executed.follow > 0, 'looked at once it has loaded');
  p.destroy();
});

test('an estimate that fell a few pixels short is learned: the window grows back by what the page needs and is not shrunk again (no flapping)', async () => {
  const p = await opened(340, {read: page => page.content - 5});
  p.page.content = 120; await wait(250);
  assert.deepEqual(size(p), [360, 120], 'followed down to 115, grown back 5 by fit() to the page\'s 120');
  assert.ok(p.follower.bias >= 5, 'the shortfall is remembered');
  assert.equal(p.follower.disabled, false);
  const steps = p.follower.steps;
  await wait(120);
  assert.equal(p.follower.steps, steps, 'and it stays there');
  p.destroy();
});

test('an estimate that was far too small (the page needs 200 more than it was read as): the window grows back to the whole page, the follower holds off, and the popup never ends smaller than its page', async () => {
  const p = await opened(340, {read: page => page.content - 200});
  p.follower.holdMs = 30;
  p.page.content = 300; await wait(60);
  assert.ok(p.window.getBounds().height >= 300, 'the page is whole: ' + size(p));
  assert.ok(p.follower.regrows >= 1, 'the window grew back past what an estimate can be out by: it is counted');
  assert.equal(p.follower.disabled, false, 'once is a hold, not the end');
  await wait(400);
  assert.ok(p.window.getBounds().height >= 300, 'still whole: ' + size(p));
  assert.ok(p.follower.steps <= FOLLOW.MAX_PASSES, `no chase: ${p.follower.steps} steps`);
  p.destroy();
});

test('a window that grows back after a follow step is a hold, twice as long each time up to a ceiling, and never for good (a popup that stopped following left a band for the session)', async () => {
  const p = await opened(340);
  const grewBack = () => { p.follower.followed = {from: 340, to: 100, at: Date.now()}; const before = Date.now(); p.follower.observeResize({width: 360, height: 300}); return p.follower.holdUntil - before; };
  const first = grewBack();
  assert.ok(first >= p.follower.holdMs - 5 && first <= p.follower.holdMs + 50, 'first hold: HOLD_MS');
  const second = grewBack();
  assert.ok(second >= 2 * p.follower.holdMs - 5, 'the second is twice as long');
  for (let i = 0; i < 12; i++) grewBack();
  assert.equal(p.follower.disabled, false, 'never for good');
  assert.ok(grewBack() <= FOLLOW.HOLD_MAX_MS + 50, 'and never longer than the ceiling');
  p.destroy();
});

test('at most two follow steps in a row (Blink: do the resizing twice) until the page says something or the person does something', async () => {
  const p = await opened(340);
  // a page that keeps reading shorter than the window it is in (an animation, say) is not chased down for ever
  p.page.content = 30; p.page.read = () => Math.max(30, p.size.height - 40);
  await wait(300);
  assert.ok(p.follower.steps <= 2, `${p.follower.steps} steps`);
  report(p, 360, p.window.getBounds().height);        // the page speaks: the count starts again
  await wait(100);
  assert.ok(p.follower.steps >= 3 && p.follower.steps <= 4, `${p.follower.steps} steps after the page spoke`);
  p.destroy();
});

test('a page whose size is explicit (the probe reads what the window is: Proton Pass\'s 430 px) is never touched', async () => {
  const p = await opened(430, {read: () => 430});
  p.page.content = 261;
  await wait(200);
  assert.deepEqual(size(p), [360, 430]);
  assert.equal(p.follower.steps, 0);
  p.destroy();
});

test('a page that has not caught up with its window is not read, and numbers of a window that has changed meanwhile are dropped', async () => {
  const p = await opened(340);
  p.page.content = 100;
  const real = p.webContents.executeJavaScript;
  p.webContents.executeJavaScript = async script => { const r = await real(script); if (isFollowScript(script)) return {...r, ih: r.ih - 9}; return r; };   // the page still has its old viewport
  await wait(120);
  assert.deepEqual(size(p), [360, 340], 'laidOutIn says no: no step');
  p.webContents.executeJavaScript = async script => { if (isFollowScript(script)) { const r = await real(script); report(p, 360, 200); return r; } return real(script); };   // a size arrives while it looks
  await wait(120);
  assert.deepEqual(size(p), [360, 200], 'the report won; the old reading did not move the window');
  p.destroy();
});

test('a popup that closes leaves the follower quiet: no look at a page that is gone, no timer left', async () => {
  const p = await opened(340);
  p.destroy();
  const looked = p.webContents.executed.follow;
  await wait(60);
  assert.equal(p.webContents.executed.follow, looked);
  assert.equal(p.follower.running, false);
  assert.equal(p.follower.timer, undefined);
});

test('a popup that is still hidden is not looked at (nothing to follow: the first size has not been shown yet)', async () => {
  const p = popup(340);
  await p.whenReady();
  await wait(40);
  assert.equal(p.window.visible, false);
  assert.equal(p.webContents.executed.follow, 0);
  p.destroy();
});
