'use strict';
// Surfshark's toolbar popup was cut off on a Windows laptop (tester, Nov 2026). Chrome sizes a popup to its page, up to 800 x 600; Acira's window was
// exactly the size the page asked for, so anything that takes room from the page cut it off: a scrollbar (15 px on Windows, an overlay that takes
// none on a Mac) once the page is taller than 600 or wider than 800, and the whole-pixel rounding at 125 % and 150 % display scale. The window
// now measures the page after each resize (extension-popup-fit.cjs) and grows by what is missing. These tests pin the rule, the fixture the
// reproduction uses and the window's use of the rule against a fake page that behaves like Windows.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events'), fs = require('node:fs'), path = require('node:path');
const {fitStep, METRICS_SCRIPT, LIMITS} = require('../desktop/browser-services/extension-popup-fit.cjs');
const {ExtensionPopup, BOUNDS} = require('../desktop/browser-services/extension-popup-window.cjs');

const metrics = (iw, ih, cw, ch, sw, sh) => ({iw, ih, cw, ch, sw, sh});
const size = (width, height) => ({width, height});

test('the limits are Chrome\'s popup limits and the window class\'s', () => {
  assert.deepEqual({...LIMITS}, {maxWidth: 800, maxHeight: 600});
  assert.equal(BOUNDS.maxWidth, LIMITS.maxWidth);
  assert.equal(BOUNDS.maxHeight, LIMITS.maxHeight);
  assert.match(METRICS_SCRIPT, /innerWidth/);
});

test('a page that fits, with or without overlay scrollbars, needs nothing', () => {
  assert.deepEqual(fitStep(metrics(360, 558, 360, 558, 360, 558), size(360, 558)), {width: 0, height: 0});
  assert.deepEqual(fitStep(metrics(360, 600, 360, 600, 360, 962), size(360, 600)), {width: 0, height: 0}, 'a Mac scrolls it with an overlay bar that takes no room');
  assert.deepEqual(fitStep(undefined, size(360, 558)), {width: 0, height: 0});
});

test('taller than 600 on Windows: the vertical scrollbar takes 15 px of a fixed-width page, so the window gets them (Chrome\'s popup is that much wider)', () => {
  // 360 x 600 window, 360 wide page, 962 tall: client area 345 x 585 because of two scrollbars
  assert.deepEqual(fitStep(metrics(360, 600, 345, 585, 360, 962), size(360, 600)), {width: 15, height: 0});
  // 375 x 600 now: one vertical scrollbar, the page is 360 wide: done
  assert.deepEqual(fitStep(metrics(375, 600, 360, 600, 360, 962), size(375, 600)), {width: 0, height: 0});
});

test('wider than 800: the horizontal scrollbar takes 15 px of the height, so the window gets them', () => {
  assert.deepEqual(fitStep(metrics(800, 288, 785, 273, 900, 288), size(800, 288)), {width: 0, height: 15});
  assert.deepEqual(fitStep(metrics(800, 303, 800, 288, 900, 288), size(800, 303)), {width: 0, height: 0});
});

test('the scrollbar room never takes the window past 800 x 600', () => {
  assert.deepEqual(fitStep(metrics(795, 600, 780, 585, 795, 962), size(795, 600)), {width: 5, height: 0});
  assert.deepEqual(fitStep(metrics(800, 600, 785, 585, 800, 962), size(800, 600)), {width: 0, height: 0}, 'both at the limit: scroll');
  assert.deepEqual(fitStep(metrics(800, 600, 785, 585, 900, 962), size(800, 600)), {width: 0, height: 0});
});

test('a page a pixel bigger than its window (whole-pixel rounding at 125 % and 150 %) grows the window by that pixel, not by a scrollbar\'s 15', () => {
  // 360 x 554 window, 555 tall page: the viewport is a fraction short, so a scrollbar appears and with it a horizontal one
  assert.deepEqual(fitStep(metrics(360, 554, 345, 539, 360, 555), size(360, 554)), {width: 0, height: 1});
  assert.deepEqual(fitStep(metrics(360, 555, 360, 555, 360, 555), size(360, 555)), {width: 0, height: 0});
  // wider by a pixel
  assert.deepEqual(fitStep(metrics(359, 556, 359, 556, 360, 556), size(359, 556)), {width: 1, height: 0});
});

test('scrollbars with nothing to scroll (the page is not bigger than its window) get one more DIP at a time, height first', () => {
  assert.deepEqual(fitStep(metrics(360, 555, 345, 540, 360, 555), size(360, 555)), {width: 0, height: 1});
  assert.deepEqual(fitStep(metrics(360, 555, 360, 540, 360, 555), size(360, 555)), {width: 1, height: 0}, 'only a horizontal one');
  assert.deepEqual(fitStep(metrics(360, 600, 345, 585, 360, 600), size(360, 600)), {width: 0, height: 0}, 'at the limit nothing is added');
});

test('a page larger than a window that may still grow gets the window grown to it, to the limits', () => {
  assert.deepEqual(fitStep(metrics(360, 288, 360, 288, 360, 558), size(360, 288)), {width: 0, height: 270});
  assert.deepEqual(fitStep(metrics(360, 288, 360, 288, 900, 288), size(360, 288)), {width: 440, height: 0});
  assert.deepEqual(fitStep(metrics(360, 288, 360, 288, 360, 2000), size(360, 288)), {width: 0, height: 312});
});

test('the fixture the reproduction uses: an MV3 extension whose popup is 360 wide, 300 tall, then 580 tall 300 ms later', () => {
  const folder = path.join(__dirname, 'fixtures/ext-popup-size');
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'popup.html');
  const html = fs.readFileSync(path.join(folder, 'popup.html'), 'utf8'), js = fs.readFileSync(path.join(folder, 'popup.js'), 'utf8');
  assert.match(html, /width: 360px/);
  assert.match(js, /setTimeout\(\(\) => addRows\(rowsFor\(total\)\), 300\)/);
  assert.match(js, /grow: 580/);
  assert.match(js, /::-webkit-scrollbar/, 'a classic-scrollbar flag, because a Mac\'s overlay scrollbars hide the fault');
});

// ---- the window against a page that behaves like Windows: 15 px scrollbars that take room, a viewport a pixel short at fractional scale

class FakeContents extends EventEmitter {
  constructor(page) { super(); this.page = page; this.closed = false; this.executed = 0; this.urls = []; }
  loadURL(url) { this.urls.push(url); return Promise.resolve(); }
  isDestroyed() { return this.closed; }
  isDevToolsOpened() { return false; }
  close() { this.closed = true; }
  getURL() { return this.urls[this.urls.length - 1] || ''; }
  getZoomFactor() { return 1; }
  // metrics of the page in the window it is in right now
  async executeJavaScript(code) { this.executed++; assert.equal(code, METRICS_SCRIPT); return this.page(this.window.getBounds()); }
}
class FakeView {
  constructor(options) { this.options = options; this.webContents = new FakeContents(options.page || (() => ({}))); }
  setBackgroundColor() {} setBorderRadius() {} setBounds(bounds) { this.bounds = bounds; }
}
class FakeWindow extends EventEmitter {
  constructor(options = {}) { super(); this.options = options; this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.parentWindow = options.parent || null; this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)}; this.destroyed = false; this.visible = false; }
  getBounds() { return {...this.bounds}; } setBounds(bounds) { this.bounds = {...bounds}; } getContentBounds() { return this.content || this.getBounds(); }
  getParentWindow() { return this.parentWindow; } show() { this.visible = true; } isFocused() { return false; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
}
/** A page of `content` (width x height) in a window of w x h with scrollbars of `bar` px that take room (0 = overlay): what executeJavaScript would measure. */
function windowsPage(content, {bar = 15, shortBy = 0} = {}) {
  return win => {
    const iw = win.width, ih = win.height, vw = iw, vh = ih - shortBy;   // shortBy: the viewport is that much short of the window (rounding)
    let barY = content.height > vh ? bar : 0, barX = content.width > vw - barY ? bar : 0;
    if (barX && !barY) barY = content.height > vh - barX ? bar : 0;
    return metrics(iw, ih, iw - barY, ih - barX, Math.max(iw - barY, content.width), Math.max(ih - barX, content.height));
  };
}
function popupWith(page) {
  const parent = new FakeWindow({}); parent.content = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView({}); ui.webContents.urls.push('acira-browser-ui://ui/index.html'); parent.contentView.addChildView(ui);
  const electron = {BaseWindow: FakeWindow, WebContentsView: class extends FakeView { constructor(options) { super({...options, page}); } }, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const popup = new ExtensionPopup({extensionId: 'a'.repeat(32), session: {}, parent, url: 'chrome-extension://aaaa/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32'});
  popup.webContents.window = popup.window;
  return popup;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 400));

test('window: a 360 x 962 page on Windows (15 px scrollbars): the popup is 375 x 600, the vertical scrollbar beside the whole page, no horizontal one', async () => {
  const popup = popupWith(windowsPage({width: 360, height: 962}));
  await popup.whenReady();
  popup.updatePreferredSize({}, {width: 360, height: 962});
  await settle();
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [375, 600]);
  assert.deepEqual(popup.base, {width: 360, height: 600});
  const m = windowsPage({width: 360, height: 962})(popup.window.getBounds());
  assert.ok(m.cw >= m.sw, 'no horizontal overflow');
  popup.destroy();
});

test('window: a page that is 900 wide: 800 x 303 (the horizontal scrollbar under the whole page)', async () => {
  const popup = popupWith(windowsPage({width: 900, height: 288}));
  await popup.whenReady();
  popup.updatePreferredSize({}, {width: 900, height: 288});
  await settle();
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [800, 303]);
  popup.destroy();
});

test('window: a page a pixel taller than its viewport (fractional display scale) gets that pixel, then stays', async () => {
  const popup = popupWith(windowsPage({width: 360, height: 555}, {shortBy: 1}));
  await popup.whenReady();
  popup.updatePreferredSize({}, {width: 360, height: 555});
  await settle();
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [360, 556]);
  const executed = popup.webContents.executed;
  await settle();
  assert.equal(popup.webContents.executed, executed, 'a page that fits is not measured again');
  popup.destroy();
});

test('window: the same size asked again (the sizing code does that several times) keeps what the window was given; another size measures the page again', async () => {
  const popup = popupWith(windowsPage({width: 360, height: 962}));
  await popup.whenReady();
  popup.updatePreferredSize({}, {width: 360, height: 962});
  await settle();
  popup.setSize({width: 360, height: 962});
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [375, 600], 'no step back to 360 and forward again');
  popup.setSize({width: 360, height: 300});
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [360, 300], 'a short page has no scrollbar and no extra room');
  popup.destroy();
});

test('window: a Mac (overlay scrollbars) and a page that fits are left exactly as the page asked, and a destroyed popup measures nothing', async () => {
  const popup = popupWith(windowsPage({width: 360, height: 962}, {bar: 0}));
  await popup.whenReady();
  popup.updatePreferredSize({}, {width: 360, height: 962});
  await settle();
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [360, 600]);
  const executed = popup.webContents.executed;
  popup.setSize({width: 360, height: 700});
  popup.destroy();
  await settle();
  assert.equal(popup.webContents.executed, executed, 'destroyed: no measuring');
});

// ---- Surfshark: the page sizes its body from window.innerWidth / innerHeight when its script runs

test('the page loads in a window and a view as large as a popup may be, not 25 x 25: a script that reads innerWidth / innerHeight (Surfshark\'s sets body = calc(innerWidth - scrollbar)) sees Chrome\'s 800 x 600, not a 25 px column', async () => {
  const popup = popupWith(() => ({}));
  assert.deepEqual([popup.window.options.width, popup.window.options.height], [BOUNDS.maxWidth, BOUNDS.maxHeight]);
  assert.deepEqual(popup.view.bounds, {x: 0, y: 0, width: BOUNDS.maxWidth, height: BOUNDS.maxHeight});
  assert.equal(popup.window.options.show, false, 'hidden until the page has said how big it is');
  assert.equal(popup.window.visible, false);
  await popup.whenReady();
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [BOUNDS.minWidth, BOUNDS.minHeight], 'after the load the page is measured from the smallest window, as before');
  assert.equal(popup.window.visible, false);
  popup.destroy();
});

test('window: a measurement taken in a window the page has since left is not used, or the popup stays larger than its page (Dark Reader, uBlock Origin Lite)', async () => {
  // The page lays out wide in the tiny 25 x 25 window it starts in (527 x 600 of overflow), then asks for its real size, 276 x 580. The measurement of
  // the tiny window arrives after that: growing the window by it left the popup 527 x 600 (or 778 x 600) around a 276 x 580 page, for good.
  const content = {width: 276, height: 580};
  const page = win => (win.width <= 25 ? metrics(25, 25, 25, 25, 527, 600) : windowsPage(content, {bar: 0})(win));
  const popup = popupWith(page);
  await popup.whenReady();
  const asked = popup.webContents.executeJavaScript;
  const arrived = [];
  popup.webContents.executeJavaScript = () => new Promise(resolve => { const seen = page(popup.window.getBounds()); arrived.push(() => resolve(seen)); });
  clearTimeout(popup.fitTimer);
  const fitting = popup.fit(6);
  popup.updatePreferredSize({}, {width: 276, height: 580});
  clearTimeout(popup.fitTimer);
  popup.webContents.executeJavaScript = asked;
  arrived.shift()();
  await fitting;
  await settle();
  assert.deepEqual(popup.extra, {width: 0, height: 0}, 'nothing was added for overflow of a window that is gone');
  assert.deepEqual([popup.window.bounds.width, popup.window.bounds.height], [276, 580]);
  popup.destroy();
});
