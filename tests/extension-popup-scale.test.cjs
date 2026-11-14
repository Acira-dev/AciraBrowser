'use strict';
// 13.7: Bitwarden's toolbar popup on Windows showed its page cut off on the left with a black area on the right (a user's screenshot).
// Measured on the Windows laptop (a real-app rig, real Bitwarden 2026.10.2, logged out): the page asks for 480 x 600, and in 2 of 8
// openings at 100 % the window ended 800 x 600. The window had been given the 480 x 600 the page asked for, but the page had not laid out in it
// yet: fit() read the 25 x 25 viewport the page still had from the load (innerWidth 25, scrollWidth 480), took the 455 px as overflow, and grew
// the window by the 320 px left to Chrome's 800 px limit; the sizing measure then read 800 in the 800 px window, and nothing ever shrank it.
// Bitwarden's body stays 480 px wide (its own style) with overflow hidden, so its 800 px wide layout was clipped at 480, the autofocused email
// field scrolled the body 79 px sideways (the cut-off left edge), and the 320 px beyond the body showed the page's dark canvas (the black area).
// The same rule, a page measured in a viewport that is not its window's, is now checked by the sizing helper too.
// Checking the other popups found a second disagreement at 125 % and 150 %: uBlock Origin Lite's page is 273 px wide and 374.6 px tall. Chromium reports
// the size it asks for without the fraction (272 x 374 at 125 %), a window that size is a pixel too small, a scrollbar comes and the page asks 15 px more
// (288 x 374); in that window there is no scrollbar and it asks 272 x 374 again. The popup changed width every few milliseconds for as long as it was open
// (456 to 1103 changes in 10 s on the laptop), because each new ask took the room the window had been given for the fraction away.
//
// The fakes below behave like the pages measured there: a page that lays out in the viewport it has (which follows the view's bounds only when
// its renderer catches up), and a page whose preferred size follows its scrollbars.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {laidOutIn, fitStep, METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');
const {ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
const {fitExtensionAction} = require('../desktop/browser-services/extension-action-sizing.cjs');
const {isFollowScript} = require('../desktop/browser-services/extension-popup-follow.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ID = 'nngceckbapebfimnlniiiahkandclblb';

// ---- fakes: just what the popup touches
class FakeWindow extends EventEmitter {
  constructor(options = {}) { super(); this.options = options; this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)}; this.destroyed = false; this.visible = false; this.minimum = null; }
  getBounds() { return {...this.bounds}; } setBounds(bounds) { this.bounds = {...bounds}; } getContentBounds() { return this.content || this.getBounds(); }
  show() { this.visible = true; } isVisible() { return this.visible; } isFocused() { return false; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  setMinimumSize(width, height) { this.minimum = [width, height]; }
}
/**
 * The page's renderer: it lays the page out in `viewport`, which becomes the view's bounds only when it catches up (lag: ms after each resize,
 * or never until catchUp() when lag is null). layout(viewport) says what the page is in a viewport; preferred(viewport) what it then asks for.
 */
class FakePage extends EventEmitter {
  constructor({layout, preferred, zoom = 1}) { super(); Object.assign(this, {layout, preferred, zoom}); this.viewport = {width: 800, height: 600}; this.urls = []; this.closed = false; this.measures = []; this.asked = null; }
  loadURL(url) { this.urls.push(url); return Promise.resolve(); }
  getURL() { return this.urls[this.urls.length - 1] || ''; }
  isDestroyed() { return this.closed; } isDevToolsOpened() { return false; } close() { this.closed = true; } focus() {} setWindowOpenHandler() {}
  getZoomFactor() { return this.zoom; }
  resized(bounds) { this.pending = {width: bounds.width, height: bounds.height}; }
  /** The renderer takes the view's latest size and lays the page out in it. */
  layOut() { if (!this.closed && this.pending) { this.viewport = this.pending; this.pending = null; } }
  /** Then it tells the page's preferred size, when that changed (as Chromium does). Returns whether it told one. */
  report() {
    if (this.closed || !this.preferred) return false;
    const asked = this.preferred(this.viewport);
    if (this.asked && asked.width === this.asked.width && asked.height === this.asked.height) return false;
    this.asked = asked;
    this.emit('preferred-size-changed', {}, {...asked});
    return true;
  }
  catchUp() { this.layOut(); this.report(); }
  // What a script in the page reads: the page in the viewport it has now (whatever the view's bounds are).
  async executeJavaScript(code) {
    if (isFollowScript(code)) return null;   // the follower's own look at the page (extension-popup-follow.cjs): it reads nothing these tests measure
    const m = this.layout(this.viewport);
    if (this.whileMeasuring) this.whileMeasuring();   // what happens in the window while the script runs (the page's ask arriving)
    this.measures.push({viewport: {...this.viewport}, code: code === METRICS_SCRIPT ? 'fit' : 'other'});
    if (code === METRICS_SCRIPT) return {iw: m.iw, ih: m.ih, cw: m.cw, ch: m.ch, sw: m.sw, sh: m.sh, fh: m.fh};
    return {iw: m.iw, ih: m.ih, width: m.sw, height: m.sh, minWidth: m.minWidth || 0, minHeight: m.minHeight || 0};
  }
}
function popupFor(page) {
  const parent = new FakeWindow({}); parent.content = {x: 40, y: 30, width: 1000, height: 660}; parent.bounds = {...parent.content};
  const ui = {webContents: {isDestroyed: () => false, getURL: () => 'acira-browser-ui://ui/index.html', getZoomFactor: () => 1}, getBounds: () => ({x: 0, y: 0, width: 1000, height: 660})};
  parent.contentView.addChildView(ui);
  const View = class { constructor() { this.webContents = page; } setBackgroundColor() {} setBorderRadius() {} setBounds(bounds) { this.bounds = {...bounds}; page.resized(bounds); } };
  const electron = {BaseWindow: FakeWindow, WebContentsView: View, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 0, width: 1280, height: 680}})}};
  return new ExtensionPopup({extensionId: ID, session: {}, parent, url: `chrome-extension://${ID}/popup/index.html`, anchorRect: {x: 760, y: 9, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
}
const sizeOf = popup => [popup.window.bounds.width, popup.window.bounds.height];

// Bitwarden 2026.10.2's popup: <body style="width: 480px"> with overflow hidden in an html that is at least 600 tall; its layout is as wide
// as the viewport (so scrollWidth is the viewport's width once that is wider than 480). No scrollbars ever.
const bitwarden = viewport => ({iw: viewport.width, ih: viewport.height, cw: viewport.width, ch: viewport.height, sw: Math.max(480, viewport.width), sh: Math.max(600, viewport.height), minWidth: 480, minHeight: 600});

test('Bitwarden: a page still laid out in the load\'s 25 x 25 viewport when the window already has its 480 x 600 is not measured; the popup stays 480 x 600 (13.6 grew it to 800 x 600)', async () => {
  const page = new FakePage({layout: bitwarden});
  const popup = popupFor(page);
  await popup.whenReady();
  assert.deepEqual(sizeOf(popup), [25, 25], 'after the load the window is the smallest, as before');
  page.catchUp();                                                   // the page lays out at 25 x 25
  popup.updatePreferredSize({}, {width: 480, height: 600});          // it asks for its size; the window takes it at once
  assert.deepEqual(sizeOf(popup), [480, 600]);
  await poll(() => page.measures.some(m => m.code === 'fit'), 'fit measured the page');
  assert.deepEqual(page.measures.find(m => m.code === 'fit').viewport, {width: 25, height: 25}, 'the page was measured before it had the window\'s size');
  page.catchUp();                                                   // the page now has the window's 480 x 600
  await sleep(450);
  assert.deepEqual(sizeOf(popup), [480, 600], 'the window is the size the page asked for, not 800 x 600');
  assert.deepEqual(popup.extra, {width: 0, height: 0});
  assert.ok(page.measures.some(m => m.code === 'fit' && m.viewport.width === 480), 'and the page is measured again once it is laid out in the window');
  popup.destroy();
});

test('Bitwarden, the sizing helper: a measure of the page in the viewport of a window it has left (the load\'s 800 x 600) is not used; the next one is', async () => {
  const page = new FakePage({layout: bitwarden});
  const window = new FakeWindow({}), calls = [];
  const popup = {extensionId: ID, browserWindow: window, webContents: page, size: {width: 25, height: 25}, whenReady: async () => {}, setSize: size => { calls.push(size); popup.size = {width: size.width, height: size.height}; }};
  page.urls.push(`chrome-extension://${ID}/popup/index.html`);
  const dispose = fitExtensionAction(popup);
  await poll(() => page.measures.length > 0, 'the helper measured the page');
  assert.deepEqual(page.measures[0].viewport, {width: 800, height: 600}, 'the first measure ran while the page still had the load\'s viewport');
  await sleep(20);
  assert.equal(calls.length, 0, `nothing is sized from that measure (13.6 asked for ${JSON.stringify(calls[0])})`);
  page.pending = {width: 25, height: 25}; page.catchUp();          // the page now lays out in the 25 x 25 window
  await poll(() => calls.length > 0, 'the helper sized the popup');
  assert.deepEqual(calls[0], {width: 480, height: 600});
  assert.ok(calls.every(size => size.width === 480 && size.height === 600), JSON.stringify(calls));
  dispose();
});

// uBlock Origin Lite 2026.1110: a page 273 px wide (its minimum) and 374.6 px tall, with Windows' 15 px scrollbars that take room. At a display scale
// Chromium snaps the viewport down to whole device pixels (a window 273 DIPs wide is 341 px: a viewport of 272.8 px at 125 %) and reports the size the
// page asks for rounded the same way (273 px is 341.25 px: 272 DIPs, a pixel short; 288 px with the room for a scrollbar). These are the sizes the laptop logged.
const UBOL = {width: 273, height: 374.6, bar: 15};
function ubolAt(scale) {
  const snap = dips => Math.floor(dips * scale) / scale;            // the viewport, in CSS px, of a window this many DIPs long
  const ask = css => Math.floor(Math.round(css * scale) / scale);   // what the page reports it wants, in DIPs
  const layout = viewport => {
    const vw = snap(viewport.width), vh = snap(viewport.height);
    let barY = UBOL.height > vh, barX = UBOL.width > vw - (barY ? UBOL.bar : 0);
    if (barX && !barY) barY = UBOL.height > vh - UBOL.bar;
    const iw = Math.floor(vw), ih = Math.floor(vh), cw = iw - (barY ? UBOL.bar : 0), ch = ih - (barX ? UBOL.bar : 0);
    return {iw, ih, cw, ch, sw: Math.max(cw, UBOL.width), sh: Math.max(ch, Math.floor(UBOL.height)), fh: UBOL.height, barX, barY};
  };
  const preferred = viewport => ({width: ask(UBOL.width + (layout(viewport).barY ? UBOL.bar : 0)), height: ask(UBOL.height)});
  return {layout, preferred};
}
const showsScrollbar = m => m.barX || m.barY;

/**
 * The renderer and the host, step by step: the page lays out in the window it has; the popup's measure (its timer, which no step waits for) looks at it
 * every third step, while the page is laid out in the window; then the page's message with the size it asks for arrives and the window takes it.
 * Returns the size of the window after each step.
 */
async function settle(page, popup, steps = 90) {
  const sizes = [], quiet = () => { clearTimeout(popup.fitTimer); popup.fitAt = undefined; };
  for (let i = 0; i < steps; i++) {
    page.layOut();
    if (i % 3 === 0) { await popup.fit(6); quiet(); }
    page.report(); quiet();
    sizes.push(sizeOf(popup).join('x'));
  }
  return sizes;
}

for (const scale of [1.25, 1.5]) test(`uBlock Origin Lite at ${scale * 100} %: the popup settles with no scrollbar and stops changing size (13.6 kept changing width every few milliseconds)`, async () => {
  const page = new FakePage({...ubolAt(scale)});
  const popup = popupFor(page);
  await popup.whenReady();
  const sizes = await settle(page, popup);
  const runs = sizes.filter((size, i) => size !== sizes[i - 1]);
  assert.equal(new Set(sizes.slice(-12)).size, 1, `the window kept changing: ${runs.slice(-10).join(', ')} (${runs.length} changes in ${sizes.length} steps, learned ${JSON.stringify([...(popup.learned || [])])})`);
  page.layOut();
  assert.equal(showsScrollbar(ubolAt(scale).layout(page.viewport)), false, `the page shows a scrollbar in ${sizeOf(popup).join('x')}`);
  assert.ok(sizeOf(popup)[0] <= 273 + 3 && sizeOf(popup)[1] <= 375 + 3, `the window is no more than a few pixels larger than the page: ${sizeOf(popup).join('x')}`);
  popup.destroy();
});

test('fitStep: a vertical scrollbar over a page a fraction of a pixel taller than the window gets its pixel with the width, a scrollbar that is only the horizontal one cascading does not', () => {
  const metrics = (iw, ih, cw, ch, sw, sh, fh) => ({iw, ih, cw, ch, sw, sh, fh});
  assert.deepEqual(fitStep(metrics(272, 374, 257, 359, 273, 374, 374.6), {width: 272, height: 374}), {width: 1, height: 1}, 'uBlock Origin Lite at 125 %');
  assert.deepEqual(fitStep(metrics(272, 374, 257, 359, 273, 374), {width: 272, height: 374}), {width: 1, height: 0}, 'metrics without the fraction: as before');
  assert.deepEqual(fitStep(metrics(272, 375, 257, 360, 273, 374, 374.6), {width: 272, height: 375}), {width: 1, height: 0}, 'the window is tall enough: the vertical scrollbar is the horizontal one cascading');
  assert.deepEqual(fitStep(metrics(273, 374, 273, 374, 273, 374, 374.6), {width: 273, height: 374}), {width: 0, height: 0}, 'no scrollbar, nothing to add');
  assert.match(METRICS_SCRIPT, /getBoundingClientRect\(\)\.height/);
});

test('a page that asks for a new size every few milliseconds is still measured within the fit delay (13.6 put the measure off at every ask)', async () => {
  const page = new FakePage({...ubolAt(1.25)});
  const popup = popupFor(page);
  await popup.whenReady();
  page.layOut();
  const started = Date.now();
  while (Date.now() - started < 300 && !page.measures.length) { popup.setSize({width: 288, height: 374}); popup.setSize({width: 273, height: 374}); page.layOut(); await sleep(4); }
  assert.ok(page.measures.some(m => m.code === 'fit'), 'the page was measured while it kept asking');
  assert.ok(Date.now() - started < 200, 'within the fit delay of the first ask, not after the asking stopped');
  popup.destroy();
});

test('laidOutIn: the page measured in the window it has (a pixel of rounding either way, its zoom); not in the one before', () => {
  assert.equal(laidOutIn({iw: 480, ih: 600}, {width: 480, height: 600}), true);
  assert.equal(laidOutIn({iw: 26, ih: 26}, {width: 25, height: 25}), true, '25 DIPs are 31.25 px at 125 %: the page reads 26');
  assert.equal(laidOutIn({iw: 273, ih: 374}, {width: 273, height: 375}), true);
  assert.equal(laidOutIn({iw: 384, ih: 480}, {width: 480, height: 600}, 1.25), true, 'a page zoomed to 125 % reads its window in CSS px');
  assert.equal(laidOutIn({iw: 25, ih: 25}, {width: 480, height: 600}), false, 'the load\'s viewport in the window the page asked for');
  assert.equal(laidOutIn({iw: 800, ih: 600}, {width: 25, height: 25}), false);
  assert.equal(laidOutIn({iw: 480, ih: 598}, {width: 480, height: 600}), false);
  assert.equal(laidOutIn({}, {width: 480, height: 600}), false, 'no numbers, no measure');
  assert.equal(laidOutIn(undefined, {width: 480, height: 600}), false);
});

test('the extra room a size of page needed comes back when the page asks for that size again; a size it has not asked for starts with none', async () => {
  const page = new FakePage({...ubolAt(1.25)});
  const popup = popupFor(page);
  await popup.whenReady();
  popup.setSize({width: 272, height: 374}); page.layOut();
  await popup.fit(6); clearTimeout(popup.fitTimer);
  assert.deepEqual(popup.extra, {width: 1, height: 1}, 'measured in 272 x 374 the page needs a pixel more on each side');
  assert.deepEqual(sizeOf(popup), [273, 375]);
  popup.setSize({width: 288, height: 374});
  assert.deepEqual(popup.extra, {width: 0, height: 0}, 'a size not asked for before: measured again');
  assert.deepEqual(sizeOf(popup), [288, 374]);
  popup.setSize({width: 272, height: 374});
  assert.deepEqual(popup.extra, {width: 1, height: 1}, 'the size that was fitted comes back fitted');
  assert.deepEqual(sizeOf(popup), [273, 375]);
  clearTimeout(popup.fitTimer); popup.destroy();
});

test('a measure of a page laid out in the window it was taken in is kept for that size even when the window changed while it ran', async () => {
  const page = new FakePage({...ubolAt(1.25)});
  const popup = popupFor(page);
  await popup.whenReady();
  popup.setSize({width: 272, height: 374}); page.layOut();           // the window is 272 x 374 and the page is laid out in it
  clearTimeout(popup.fitTimer); popup.fitAt = undefined;
  page.whileMeasuring = () => popup.setSize({width: 288, height: 374});   // the page's ask for another size arrives while the script runs
  await popup.fit(6); clearTimeout(popup.fitTimer); popup.fitAt = undefined;
  assert.deepEqual(sizeOf(popup), [288, 374], 'the window is the one the page asked for last');
  assert.deepEqual(popup.learned.get('272x374'), {width: 1, height: 1}, '13.6 threw the numbers away: 272 x 374 needs a pixel more each way (a page 273 x 374.6)');
  page.whileMeasuring = null;
  popup.setSize({width: 272, height: 374});
  assert.deepEqual(sizeOf(popup), [273, 375], 'and it comes back fitted');
  popup.destroy();
});

async function poll(read, what, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (read()) return; await sleep(5); }
  throw new Error(`${what}: not within ${ms} ms`);
}
