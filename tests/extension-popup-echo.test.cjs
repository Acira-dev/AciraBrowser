'use strict';
// 13.7, Proton Pass: its toolbar popup came up as a 56 x 311 sliver (12 of 12 openings on 13.6 and on the 13.7 candidate, at the laptop's own scale).
// What happens, step by step in the real app: the page loads in the 800 x 600 window and asks 600 x 430 (its own CSS size). Its script then sets its size from
// the window it is in (--popup-width = the document's clientWidth, again on every resize), and the window's own end-of-load step (extension-popup-window.cjs
// load()) takes the window to the minimum, 25 x 25. The page, laid out in that 25 px viewport, reports 25 x 25 and then 25 x 56; the window took them, the
// script locked the page at 25 px, and it rested at the narrowest its words fit, 56 x 310. A report with a side at the minimum, right after the load and
// after the page had asked for a real size, is that echo of the window's own size: the window goes back to the size the page asked for and the report is held.
// The page, laid out in that window again, reports its own size (which releases the held one); a page that has laid out in its window and says nothing
// else really wants the minimum, and the window takes it as it always did. Everything else (the first report, every later real size, any report after the first
// second) is as it was.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ExtensionPopup, BOUNDS} = require('../desktop/browser-services/extension-popup-window.cjs');

class FakeContents extends EventEmitter {
  constructor(options) { super(); this.options = options; this.closed = false; }
  loadURL() { return Promise.resolve(); }
  isDestroyed() { return this.closed; }
  isDevToolsOpened() { return false; }
  close() { this.closed = true; }
  getURL() { return 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html'; }
  setWindowOpenHandler() {}
  focus() {}
}
class FakeView { constructor(options) { this.webContents = new FakeContents(options); } setBackgroundColor() {} setBorderRadius() {} setBounds(bounds) { this.bounds = bounds; } }
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

/** The popup, created but not yet loaded (the page's first report can come before the end of the load, or after it). */
function create() {
  const parent = new FakeWindow({});
  parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView({});
  ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; ui.webContents.getZoomFactor = () => 1;
  parent.contentView.addChildView(ui);
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const popup = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
  popup.echoRecheckMs = 4;   // the held report is looked at every 4 ms here, not every 250
  // The page: laid out in the window it has (`page.stale` = still in the window it had before: its viewport is that of the 25 px window).
  const page = {stale: false, viewport: {width: 25, height: 25}};
  popup.webContents.executeJavaScript = async () => {
    const v = page.stale ? page.viewport : {width: popup.size.width, height: popup.size.height};
    return {iw: v.width, ih: v.height, cw: v.width, ch: v.height, sw: v.width, sh: v.height, fh: v.height};
  };
  popup.page = page;
  return popup;
}
async function open() { const popup = create(); await popup.whenReady(); return popup; }
const report = (popup, width, height) => popup.webContents.emit('preferred-size-changed', {}, {width, height});
const size = popup => { const {width, height} = popup.window.getBounds(); return [width, height]; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the real sequence at the first opening: the end of the load takes the window to 25 x 25, then 600 x 430 is asked and shown, then 25 x 25 and 25 x 56 echo: the window keeps 600 x 430', async () => {
  const popup = await open();
  assert.deepEqual(size(popup), [BOUNDS.minWidth, BOUNDS.minHeight], 'after the load the window is at the minimum, hidden');
  report(popup, 600, 430);
  assert.deepEqual(size(popup), [600, 430]);
  assert.equal(popup.window.visible, true, 'the first report shows it');
  report(popup, 25, 25);
  assert.deepEqual(size(popup), [600, 430], 'the window\'s own minimum echoed back is not the page\'s size');
  report(popup, 25, 56);
  assert.deepEqual(size(popup), [600, 430], 'nor is the narrow layout the page lays out in it');
  report(popup, 600, 430);   // the page, laid out in its window again, says what it is
  await wait(60);
  assert.deepEqual(size(popup), [600, 430], 'and the held reports are let go');
  popup.destroy();
});

test('the sequence at the later openings (the page asks before the load ends): the end of the load takes the shown window to 25 x 25, and the echo takes it back to 600 x 430', async () => {
  const popup = create();
  report(popup, 600, 430);
  assert.deepEqual(size(popup), [600, 430]);
  await popup.whenReady();
  assert.deepEqual(size(popup), [BOUNDS.minWidth, BOUNDS.minHeight], 'the end of the load');
  report(popup, 25, 25);
  assert.deepEqual(size(popup), [600, 430], 'back to the size the page asked for');
  report(popup, 25, 56);
  assert.deepEqual(size(popup), [600, 430]);
  report(popup, 600, 430);
  await wait(60);
  assert.deepEqual(size(popup), [600, 430]);
  popup.destroy();
});

test('a page that has not caught up with its window (it is still laid out in the old 25 px window) does not get its echo taken, however long it takes; once it has caught up and says nothing else, the minimum is taken', async () => {
  const popup = await open();
  // The held report is looked at ECHO_CHECKS (8) times at most: at 4 ms a look, a Mac (whose timers keep 4 ms) had used them all inside the 80 ms the page
  // stays behind, and the minimum was never taken (Windows' 15.6 ms timer ticks hid it). 15 ms a look keeps looks in hand on both.
  popup.echoRecheckMs = 15;
  report(popup, 600, 430);
  popup.page.stale = true;
  report(popup, 25, 25);
  await wait(80);
  assert.deepEqual(size(popup), [600, 430], 'a size of a window that is gone does not count');
  popup.page.stale = false;   // the page has laid out in the 600 x 430 window and has nothing else to say
  await wait(80);
  assert.deepEqual(size(popup), [25, 25], 'laid out in its window twice in a row and silent: the minimum is what it wants');
  popup.destroy();
});

test('a page that really asks for 25 x 25 after a larger size and lays out at that size in its window still ends at 25 x 25 (measured, not assumed)', async () => {
  const popup = await open();
  report(popup, 600, 430);
  report(popup, 25, 25);
  await wait(80);
  assert.deepEqual(size(popup), [25, 25], 'the same end as before the guard: only the moment it takes differs');
  popup.destroy();
});

test('a page that first reports the minimum (nothing to show yet) is as before: the window takes it and shows', async () => {
  const popup = await open();
  report(popup, 25, 25);
  assert.deepEqual(size(popup), [25, 25]);
  assert.equal(popup.window.visible, true);
  popup.destroy();
});

test('every real size is taken as before, also after an echo (the sizes other extensions ask: both sides above 64)', async () => {
  const popup = await open();
  report(popup, 600, 430); report(popup, 25, 25);
  report(popup, 276, 580); assert.deepEqual(size(popup), [276, 580]);
  report(popup, 480, 600); assert.deepEqual(size(popup), [480, 600]);
  report(popup, 273, 375); assert.deepEqual(size(popup), [273, 375]);
  report(popup, 66, 70); assert.deepEqual(size(popup), [66, 70], 'a size with both sides above ECHO_NEAR (64) is a size');
  await wait(40);
  assert.deepEqual(size(popup), [66, 70], 'and the real size released the held report: it is not taken afterwards');
  popup.destroy();
});

test('at 125 % the window of 25 DIPs is 31.25 pixels and its page reads 26: the echo is 26 x 26 and 26 x 56 there, and is held the same', async () => {
  const popup = await open();
  report(popup, 600, 430);
  report(popup, 26, 26); assert.deepEqual(size(popup), [600, 430]);
  report(popup, 26, 56); assert.deepEqual(size(popup), [600, 430]);
  report(popup, 27, 27); assert.deepEqual(size(popup), [600, 430]);
  report(popup, 600, 430);
  await wait(40);
  assert.deepEqual(size(popup), [600, 430]);
  popup.destroy();
});

test('after the first second a report at the minimum is a size again (a page that really shrinks later is as it always was)', async () => {
  const popup = await open();
  report(popup, 600, 430);
  popup.echoUntil = Date.now() - 1;   // the first second is over
  report(popup, 25, 25);
  assert.deepEqual(size(popup), [25, 25]);
  popup.destroy();
});

test('a popup that closes while a report is held leaves nothing behind', async () => {
  const popup = await open();
  report(popup, 600, 430); report(popup, 25, 25);
  popup.destroy();
  await wait(30);
  assert.equal(popup.destroyed, true, 'closed, and the held report\'s look-again did nothing (no throw, no window to size)');
});
