'use strict';
// 13.8, the Windows laptop at a display scale of 150 %: Proton Pass's popup, signed out, came up as a 56 x 56 square in 1 of 11 openings (the other ten, and 100 % and 125 %, were within a pixel of
// the page's 600 x 430). It is the 13.7 sliver again (a 56 x 311 strip at every opening on 13.6), in an order of events the 13.7 guard did not cover.
// What the page does, step by step: it loads in the 800 x 600 window and asks 600 x 430; the end of the load takes the window to the minimum, 25 x 25 (a 25 DIP window is 31.25 pixels at 125 %
// and 37.5 at 150 %); the page's script copies the size of the window it is in into its own root, so in that window it lays out narrower than its words and says so: 25 x 25, then 25 x 56,
// then 56 x 311 (at 150 % the numbers carry a pixel more: 26 x 26, 26 x 56). The 13.7 guard (isMinimumEcho) held a report that has a side within 2 DIPs of the minimum and put the window
// back to the 600 x 430 the page had asked for. It left every other way a size can get from that narrow layout into the window open:
//  - the later reports of the narrow layout (56 x 311, a 56 x 56 in between) that are not at the minimum, and arrive after the window was given its size back;
//  - the sizing measure (extension-action-sizing.cjs) and fit() (extension-popup-window.cjs), which read the page in whatever window it has: in the 25 x 25 window the page overflows by what its
//    narrow layout needs, and 25 + 31 = 56 on each side is the square;
//  - the follower (extension-popup-follow.cjs), which reads the root of the page at that moment as the page's size (26 px tall) and brings the window down to it, and lowers the "asked" size
//    the guard compares against.
// Which of them wins depends on the milliseconds (how long the window takes to reach the page, the page's own 50 ms debounce, how long a report takes), and the display scale only changes the
// pixels the numbers are rounded to. So these tests model the order of events, with latencies, at the scales, against the real popup, sizing measure, fit and follower (no Electron), and pin:
//  1. the six orders found that collapse the release code (each fails on it: the window is shown or left at 56 x 56, 56 x 311, 600 x 26...);
//  2. a few hundred more drawn at random (the same seeds every time) across scales 1, 1.25, 1.5, 2: none applies a side of 64 or less after the page has asked for a real size;
//  3. the rule itself (refusesMinimum), at each scale's rounding of the minimum, for the sizing measure, fit() and the follower one by one;
//  4. what must not change: a real shrink right after the load, small sizes after the first second, and a page that really wants a small size.
// The popup tests stop setTimeout and Date (node's mock timers): nothing depends on a timer's luck.
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {mock} = test;
const {ExtensionPopup, BOUNDS} = require('../desktop/browser-services/extension-popup-window.cjs');
const {fitExtensionAction} = require('../desktop/browser-services/extension-action-sizing.cjs');
const {METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');
const {followScript, isFollowScript, isWatchScript} = require('../desktop/browser-services/extension-popup-follow.cjs');
const extTrace = require('../desktop/browser-services/ext-trace.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const flush = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
const NEAR = 64;   // ECHO_NEAR in extension-popup-window.cjs

// ---- the fake engine -----------------------------------------------------------------------------------------------------------------------------------------------------

const style = (o = {}) => ({display: 'block', position: 'static', overflowY: 'visible', height: 'auto', minHeight: '0px', marginBottom: '0px', paddingBottom: '0px', borderBottomWidth: '0px', ...o});
function el(name, {spec = {}, st = {}, bottom = 0, children = []} = {}) {
  const node = {nodeType: 1, name, childNodes: children, shadowRoot: null, st: style(st), spec: {height: 'auto', 'min-height': 'auto', ...spec}, bottom};
  node.getBoundingClientRect = () => ({top: 0, bottom: node.bottom, height: node.bottom});
  node.computedStyleMap = () => ({get: prop => node.spec[prop]});
  return node;
}
const text = bottom => ({nodeType: 3, nodeValue: 'text', bottom});
/** What the follower's probe reads in a page whose root is fixed to an explicit px height (Proton's variable), with content that may run past it. */
function pinnedDom({ih, iw, rootH, contentH}) {
  const overflow = contentH > rootH ? contentH : 0;
  const children = [el('content', {bottom: Math.min(contentH, rootH) || 10, children: [text(Math.min(contentH, rootH) || 10)]})];
  if (overflow) children.push(el('overflow', {bottom: overflow, children: [text(overflow)]}));
  const app = el('app', {spec: {height: '100%'}, st: {height: rootH + 'px'}, bottom: rootH, children});
  const body = el('body', {spec: {height: rootH + 'px'}, st: {height: rootH + 'px'}, bottom: rootH, children: [app]});
  const root = el('html', {spec: {height: rootH + 'px'}, st: {height: rootH + 'px'}, bottom: rootH, children: [body]});
  root.scrollHeight = Math.max(ih, rootH, overflow); root.clientHeight = ih;
  return {document: {documentElement: root, body, styleSheets: [], adoptedStyleSheets: [], querySelectorAll: () => [], getAnimations: () => [], createRange: () => { let node; return {selectNodeContents: n => { node = n; }, getBoundingClientRect: () => ({height: 20, bottom: node.bottom})}; }}, innerHeight: ih, innerWidth: iw, getComputedStyle: node => node.st};
}

class FakeContents extends EventEmitter {
  constructor(loadMs = 0) { super(); this.closed = false; this.loadMs = loadMs; }
  loadURL() { return new Promise(resolve => setTimeout(() => { this.emit('did-finish-load'); resolve(); }, this.loadMs)); }
  isDestroyed() { return this.closed; }
  isDevToolsOpened() { return false; }
  close() { this.closed = true; }
  getURL() { return 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html'; }
  getZoomFactor() { return 1; }
  isLoading() { return false; }
  setWindowOpenHandler() {}
  focus() {}
}
class FakeView { constructor(loadMs) { this.webContents = new FakeContents(loadMs); } setBackgroundColor() {} setBorderRadius() {} setBounds(bounds) { this.bounds = bounds; } }
class FakeWindow extends EventEmitter {
  constructor(options = {}) { super(); this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false; this.history = []; this.shows = []; this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)}; }
  getBounds() { return {...this.bounds}; }
  setBounds(bounds) {
    const changed = bounds.width !== this.bounds.width || bounds.height !== this.bounds.height;
    this.bounds = {...bounds};
    if (changed) { this.history.push({t: Date.now() - this.t0, w: bounds.width, h: bounds.height, by: callerOf()}); if (this.onBounds) this.onBounds(this.bounds); }
  }
  setMinimumSize(width, height) { this.minimum = [width, height]; }
  getContentBounds() { return this.content || this.getBounds(); }
  show() { this.visible = true; this.shows.push({t: Date.now() - this.t0, w: this.bounds.width, h: this.bounds.height}); }
  isFocused() { return false; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; }
}
/** Which part of the popup set the window's size (read from the call stack: the tests say who did it). */
function callerOf() {
  const names = String(new Error().stack).split('\n').slice(2, 16).map(line => (line.match(/at (?:async )?([\w.<>]+)/) || [])[1]).filter(Boolean);
  for (const name of names) for (const known of ['fit', 'followTo', 'measure', 'applyReport', 'holdEcho', 'checkEcho', 'showAnyway', 'load']) if (name === known || name.endsWith('.' + known)) return known;
  return names.slice(0, 3).join('<');
}

/**
 * One opening of a Proton-shaped popup, in milliseconds of a clock the test drives.
 *  The page: its root is fixed to the size its script last copied from the window (the first time 600 x 430, the CSS defaults); the script copies the window's size `debounce` ms after the page's
 *  width changes by more than a pixel; laid out in a root narrower than 300 the content overflows it (56 wide), first with nothing, then a 56 px header (`headerMs` later), then the
 *  settled 56 x 311 (`settleMs` after that). Blink reports (width, document height) when that pair changes, `dReport` ms after, in the order the layouts happened.
 *  The display: a window of `d` DIPs is ceil / round / floor(d x scale) pixels, and the page's viewport is that many pixels in CSS px (so 25 DIPs is 25.6 CSS px at 125 %, 25.33 at 150 %).
 *  The engine: a size set on the window reaches the page `dResize` ms later; a script run in the page runs `dIn` ms after it was sent and its answer arrives `dOut` ms after that.
 *  The opening: the page's first report (600 x 430, from the 800 x 600 window) comes `firstAt` ms after the end of the load (negative: before it).
 */
async function simulate(config, horizon = 2500) {
  const c = {scale: 1.5, round: 'ceil', dResize: 8, dReport: 4, dIn: 2, dOut: 2, debounce: 50, headerMs: 12, settleMs: 30, loadMs: 120, firstAt: -5, ...config};
  mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1.7e12});
  const t0 = Date.now();
  let p;
  try {
    const parent = new FakeWindow({}); parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
    const ui = new FakeView(0); ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; parent.contentView.addChildView(ui);
    const electron = {BaseWindow: class extends FakeWindow { constructor(o) { super(o); this.t0 = t0; } }, WebContentsView: class extends FakeView { constructor() { super(c.loadMs); } }, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
    p = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
    const pixels = dip => (c.round === 'ceil' ? Math.ceil(dip * c.scale) : c.round === 'floor' ? Math.floor(dip * c.scale) : Math.round(dip * c.scale));
    const cssOf = dip => pixels(dip) / c.scale;
    const pg = {vp: {w: 800, h: 600}, vars: {w: 600, h: 430}, stage: 'settled', lastPair: '600x430', watchers: [], scriptTimer: null, lastDelivery: 0};
    p.pg = pg;
    const narrow = () => pg.vars.w < 300;
    const contentH = () => (!narrow() ? 0 : pg.stage === 'empty' ? 0 : pg.stage === 'header' ? 56 : 311);
    const contentW = () => (narrow() ? 56 : 0);
    const pair = () => [Math.ceil(Math.max(pg.vars.w, narrow() && pg.stage === 'settled' ? 56 : 0) - 1e-9), Math.ceil(Math.max(pg.vars.h, contentH()) - 1e-9)];
    const scroll = () => [Math.max(pg.vp.w, pg.vars.w, contentW()), Math.max(pg.vp.h, pg.vars.h, contentH())];
    const iw = () => Math.round(pg.vp.w), ih = () => Math.round(pg.vp.h);
    const readFollow = () => ({...vm.runInNewContext(followScript(null), vm.createContext(pinnedDom({ih: ih(), iw: iw(), rootH: pg.vars.h, contentH: contentH()}))), why: ['x']});
    const sizing = () => {
      const [sw, sh] = scroll();
      const body = {scrollHeight: Math.ceil(pg.vars.h), scrollWidth: Math.ceil(pg.vars.w), computedStyleMap: () => ({get: () => Math.round(pg.vars.w) + 'px'})};
      return {document: {body, documentElement: {scrollHeight: Math.ceil(sh), scrollWidth: Math.ceil(sw)}}, NodeFilter: {SHOW_ELEMENT: 1}, innerWidth: iw(), innerHeight: ih(), getComputedStyle: () => ({minWidth: '0px', width: Math.round(pg.vars.w) + 'px', minHeight: '0px'})};
    };
    const afterLayout = () => {
      const now = pair().join('x');
      if (pg.lastPair !== now) {
        pg.lastPair = now;
        const v = pair(), at = Math.max(Date.now() + c.dReport, pg.lastDelivery + 1);   // reports reach the browser in the order the layouts happened
        pg.lastDelivery = at;
        setTimeout(() => { if (!p.destroyed) p.webContents.emit('preferred-size-changed', {}, {width: v[0], height: v[1]}); }, at - Date.now());
      }
      for (const watcher of pg.watchers.splice(0)) { const r = readFollow(); if (Number.isFinite(r.eh) && r.eh < r.ih - 2) setTimeout(() => watcher(r), c.dOut); else pg.watchers.push(watcher); }
    };
    p.window.onBounds = () => {
      setTimeout(() => {
        if (p.destroyed) return;
        const w = cssOf(p.size.width), h = cssOf(p.size.height);   // the window the page gets when this message is read
        if (w === pg.vp.w && h === pg.vp.h) return;
        pg.vp = {w, h};
        clearTimeout(pg.scriptTimer);
        pg.scriptTimer = setTimeout(() => {   // the page's debounced resize handler
          if (p.destroyed || Math.abs(pg.vp.w - pg.vars.w) <= 1) return;
          pg.vars = {w: Math.round(pg.vp.w), h: Math.round(pg.vp.h)};
          pg.stage = 'empty'; afterLayout();
          if (narrow()) setTimeout(() => { pg.stage = 'header'; afterLayout(); setTimeout(() => { pg.stage = 'settled'; afterLayout(); }, c.settleMs); }, c.headerMs); else pg.stage = 'settled';
        }, c.debounce);
        afterLayout();
      }, c.dResize);
    };
    p.webContents.executeJavaScript = code => new Promise(resolve => {
      setTimeout(() => {
        if (code === METRICS_SCRIPT) { const [sw, sh] = scroll(); const r = {iw: iw(), ih: ih(), cw: iw(), ch: ih(), sw: Math.ceil(sw), sh: Math.ceil(sh), fh: ih()}; setTimeout(() => resolve(r), c.dOut); return; }
        if (isWatchScript(code)) {
          if (/, null, \{"minGapMs"/.test(code)) { const r = {...readFollow(), why: ['start']}; setTimeout(() => resolve(r), c.dOut); return; }
          pg.watchers.push(r => resolve(r)); return;
        }
        if (isFollowScript(code)) { const r = readFollow(); setTimeout(() => resolve(r), c.dOut); return; }
        if (code.includes('explicitWidth')) { const r = vm.runInNewContext(code, vm.createContext(sizing())); setTimeout(() => resolve(r), c.dOut); return; }
        resolve(null);
      }, c.dIn);
    });
    fitExtensionAction(p);
    pg.lastDelivery = t0 + Math.max(0, c.loadMs + c.firstAt);
    setTimeout(() => { if (!p.destroyed) p.webContents.emit('preferred-size-changed', {}, {width: 600, height: 430}); }, Math.max(0, c.loadMs + c.firstAt));
    for (let t = 0; t < horizon; t++) { mock.timers.tick(1); await flush(2); }
    const end = p.window.getBounds();
    return {end: [end.width, end.height], shows: p.window.shows, history: p.window.history, popup: p};
  } finally {
    try { if (p) p.destroy(); } catch { /* closed */ }
    mock.timers.reset();
  }
}

/** The sizes the window was given after the page had asked for its real size, except the load's own reset to the minimum. */
const afterAsk = history => { const first = history.findIndex(h => h.by === 'applyReport'); return history.slice(first < 0 ? history.length : first + 1).filter(h => h.by !== 'load'); };
/** The collapse: the window shown, or left, at a size the page's narrow layout gave it. */
function assertNoCollapse(result, label) {
  const small = afterAsk(result.history).filter(h => h.w <= NEAR || h.h <= NEAR);
  assert.deepEqual(small, [], `${label}: the window took a size with a side of ${NEAR} or less after the page had asked for a real one: ${JSON.stringify(result.history)}`);
  assert.deepEqual(result.shows.filter(s => s.w < 560 || s.h < 400), [], `${label}: the popup was shown collapsed: ${JSON.stringify(result.shows)}`);
  assert.ok(result.end[0] >= 560 && result.end[1] >= 400 && result.end[0] <= 604 && result.end[1] <= 436, `${label}: ended at ${result.end.join(' x ')} (history ${JSON.stringify(result.history)})`);
}

// ---- 1. the orders that collapse the release code ---------------------------------------------------------------------------------------------------------------------------

const ORDERS = [
  ['at 125 %, the first report lands after the end of the load and the follower reads the narrow root (26 px) as the page: 600 x 26, the guard lowered, the sliver for good', {scale: 1.25, round: 'ceil', dResize: 24, dReport: 33, dIn: 9, dOut: 8, debounce: 31, headerMs: 38, settleMs: 15, loadMs: 128, firstAt: 39}],
  ['at 150 %, the narrow layout\'s 56 x 311 arrives after the window was given its size back: not a minimum, so it was taken, and the popup shown as a sliver', {scale: 1.5, round: 'ceil', dResize: 35, dReport: 7, dIn: 1, dOut: 12, debounce: 51, headerMs: 44, settleMs: 8, loadMs: 249, firstAt: -38}],
  ['at 150 %, the follower brings the window down to the 25 px root of the narrow layout (600 x 25), and the reports that follow are taken', {scale: 1.5, round: 'ceil', dResize: 9, dReport: 26, dIn: 5, dOut: 12, debounce: 49, headerMs: 42, settleMs: 83, loadMs: 166, firstAt: 49}],
  ['at 150 %, the sizing measure reads the narrow layout in the 25 x 25 window (56 x 26) and sets it, and the sliver that follows is shown', {scale: 1.5, round: 'round', dResize: 20, dReport: 29, dIn: 10, dOut: 3, debounce: 33, headerMs: 24, settleMs: 30, loadMs: 84, firstAt: -32}],
  ['at 150 %, fit() grows the 25 x 25 window to the page\'s overflow (56 x 26), and a 56 x 56 is shown (the laptop\'s square)', {scale: 1.5, round: 'ceil', dResize: 14, dReport: 62, dIn: 1, dOut: 5, debounce: 21, headerMs: 53, settleMs: 156, loadMs: 275, firstAt: -144}],
  ['at 150 %, fit() grows the window to 56 x 25 in the reset window, the narrow report is shown, and the popup ends 80 x 335', {scale: 1.5, round: 'floor', dResize: 43, dReport: 58, dIn: 32, dOut: 7, debounce: 23, headerMs: 71, settleMs: 1, loadMs: 51, firstAt: -81}],
];
for (const [name, config] of ORDERS) {
  test(`order that collapses the release code: ${name}`, async () => {
    assertNoCollapse(await simulate(config), name);
  });
}

test('the ordinary opening at each scale ends at the page\'s own 600 x 430, shown once, at that size', async () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    const result = await simulate({scale});
    assertNoCollapse(result, `scale ${scale}`);
    assert.equal(result.shows.length, 1, `scale ${scale}: shown once`);
    const {w, h} = result.shows[0];   // (a pixel or two of room for the rounding of a fractional scale is what fit() has always added)
    assert.ok(w >= 599 && w <= 604 && h >= 429 && h <= 436, `scale ${scale}: shown at ${w} x ${h}`);
  }
});

// ---- 2. a few hundred more, drawn at random ---------------------------------------------------------------------------------------------------------------------------------

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

test('random orders of reports, measures and follower looks (latencies of the window, the page, its reports and the engine\'s answers) at 100 %, 125 %, 150 % and 200 %: no collapse', async () => {
  const bad = [];
  let runs = 0;
  for (let seed = 1; seed <= 28; seed++) for (const scale of [1, 1.25, 1.5, 2]) {
    const r = rng(seed * 7 + scale * 1000);
    const config = {scale, round: ['ceil', 'round', 'floor'][between(r, 0, 2)], dResize: between(r, 0, 90), dReport: between(r, 0, 90), dIn: between(r, 0, 40), dOut: between(r, 0, 40), debounce: between(r, 16, 140), headerMs: between(r, 0, 200), settleMs: between(r, 0, 300), loadMs: between(r, 20, 500), firstAt: between(r, -150, 150)};
    const result = await simulate(config, 1800);
    runs++;
    try { assertNoCollapse(result, JSON.stringify(config)); } catch (error) { bad.push(String(error.message).slice(0, 400)); }
  }
  assert.equal(bad.length, 0, `${bad.length} of ${runs} openings collapsed:\n${bad.slice(0, 3).join('\n')}`);
});

// ---- 3. the rule, and each of its places ---------------------------------------------------------------------------------------------------------------------------------

class FakeBare extends FakeContents { constructor() { super(0); } }
/** A popup that has finished loading (the end of the load put the window at 25 x 25), driven by mock timers. */
async function opened({asked = {width: 600, height: 430}} = {}) {
  mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1.7e12});
  const parent = new FakeWindow({}); parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView(0); ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; parent.contentView.addChildView(ui);
  const electron = {BaseWindow: class extends FakeWindow { constructor(o) { super(o); this.t0 = Date.now(); } }, WebContentsView: class extends FakeView { constructor() { super(0); this.webContents = new FakeBare(); } }, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const p = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
  p.webContents.executeJavaScript = async () => null;
  mock.timers.tick(1); await flush(3);
  await p.whenReady();
  if (asked) p.webContents.emit('preferred-size-changed', {}, asked);
  return p;
}
const done = p => { try { p.destroy(); } catch { /* closed */ } mock.timers.reset(); };
const sizeOf = p => { const {width, height} = p.window.getBounds(); return [width, height]; };

test('refusesMinimum: a side of 64 or less in the first second, after the page asked for a real size (both sides above 64), at every scale\'s rounding of the 25 DIP window', async () => {
  const p = await opened();
  try {
    // what the page reads in a 25 DIP window at each scale: ceil(ceil(25 x s) / s), the same plus one pixel of overflow, and the narrow layout's numbers
    const reads = new Set([25, 26, 27, 28, 49, 50, 56, 64]);
    for (const scale of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) { const read = Math.ceil(Math.ceil(25 * scale) / scale - 1e-9); reads.add(read); reads.add(read + 1); }
    for (const side of reads) {
      assert.equal(p.refusesMinimum({width: side, height: 430}), true, `a width of ${side} with the asked height`);
      assert.equal(p.refusesMinimum({width: 600, height: side}), true, `a height of ${side} with the asked width`);
      assert.equal(p.refusesMinimum({width: side, height: side}), true, `${side} x ${side}`);
    }
    assert.equal(p.refusesMinimum({width: 56, height: 311}), true, 'the narrow layout\'s resting size');
    for (const [w, h] of [[65, 65], [66, 70], [300, 120], [360, 340], [600, 430], [800, 600]]) assert.equal(p.refusesMinimum({width: w, height: h}), false, `${w} x ${h} is a size`);
  } finally { done(p); }
});

test('refusesMinimum: nothing is refused after the first second, before the page has asked, when the page asked for something small, or for a size that is not a number', async () => {
  const p = await opened();
  try {
    p.echoUntil = Date.now() - 1;
    assert.equal(p.refusesMinimum({width: 56, height: 56}), false, 'after the first second');
    p.echoUntil = Date.now() + 1000;
    assert.equal(p.refusesMinimum({width: 56, height: 56}), true);
    p.echoPending = {width: 25, height: 25}; p.echoUntil = Date.now() - 1;
    assert.equal(p.refusesMinimum({width: 56, height: 56}), true, 'a held report keeps the guard up past the first second');
    p.echoPending = undefined;
    assert.equal(p.refusesMinimum(null), false); assert.equal(p.refusesMinimum(undefined), false);
    p.reported = {width: 60, height: 40}; p.echoUntil = Date.now() + 1000;
    assert.equal(p.refusesMinimum({width: 25, height: 25}), false, 'the page asked for a size at or under the limit itself: nothing to compare with (isMinimumEcho\'s own rule applies)');
    p.reported = undefined;
    assert.equal(p.refusesMinimum({width: 25, height: 25}), false, 'before the page has asked');
  } finally { done(p); }
});

test('every report of the narrow layout in the first second is held, wherever it sits: 26 x 26, 26 x 56, 49 x 49, 56 x 56, 56 x 311 (not only the minimum), and the window keeps the size the page asked for', async () => {
  const p = await opened();
  try {
    p.webContents.emit('input-event', {}, {type: 'mouseMove'});
    assert.deepEqual(sizeOf(p), [600, 430]);
    for (const [w, h] of [[26, 26], [26, 56], [49, 49], [56, 56], [56, 311], [600, 26]]) {
      p.webContents.emit('preferred-size-changed', {}, {width: w, height: h});
      assert.deepEqual(sizeOf(p), [600, 430], `a report of ${w} x ${h}`);
    }
    assert.deepEqual(p.window.history.filter(h => h.by !== 'load' && (h.w <= NEAR || h.h <= NEAR)), [], JSON.stringify(p.window.history));   // (the end of the load's own reset to 25 x 25 is the first entry)
  } finally { done(p); }
});

test('the sizing measure does not set what the page lays out in the 25 x 25 window (56 x 56) while the page has asked for 600 x 430, and measures again; after the first second it is as before', async () => {
  mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1.7e12});
  const sets = [];
  const reading = {iw: 25, ih: 25, width: 56, height: 56, minWidth: 25};
  let refuse = true;
  const popup = {
    extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', size: {width: 25, height: 25},
    browserWindow: {isDestroyed: () => false, setMinimumSize: () => sets.push('minimum'), once: () => {}},
    webContents: {getURL: () => 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', isDestroyed: () => false, getZoomFactor: () => 1, executeJavaScript: async () => reading, on() {}, removeListener() {}},
    whenReady: () => Promise.resolve(), refusesMinimum: size => refuse && size.width <= NEAR, setSize: size => sets.push(size),
  };
  try {
    const dispose = fitExtensionAction(popup);
    await flush(3); mock.timers.tick(10); await flush(3); mock.timers.tick(200); await flush(3);
    assert.deepEqual(sets, [], 'nothing was set while the popup refuses it');
    refuse = false;
    mock.timers.tick(200); await flush(3);
    assert.ok(sets.some(set => set.width === 56 && set.height === 56), `once it does not, the measure is applied as before: ${JSON.stringify(sets)}`);
    dispose();
  } finally { mock.timers.reset(); }
});

test('fit() does not grow the 25 x 25 window to the narrow layout\'s overflow (56 x 56) while the page has asked for 600 x 430; after the first second it grows as it always did', async () => {
  const p = await opened();
  try {
    p.webContents.executeJavaScript = async () => ({iw: 25, ih: 25, cw: 25, ch: 25, sw: 56, sh: 56, fh: 25});
    p.setSize({width: BOUNDS.minWidth, height: BOUNDS.minHeight});   // the end of the load
    mock.timers.tick(200); await flush(4);
    assert.deepEqual(sizeOf(p), [25, 25], 'not grown to the square');
    assert.equal(p.window.history.some(h => h.w === 56), false);
    p.echoUntil = Date.now() - 1;
    p.setSize({width: BOUNDS.minWidth, height: BOUNDS.minHeight}); p.fitAt = undefined;
    mock.timers.tick(300); await flush(4);
    assert.deepEqual(sizeOf(p), [56, 56], 'after the first second a page that overflows its window is given room, as before');
  } finally { done(p); }
});

test('the follower does not bring the window down to a page that reads 26 px tall in the first second after the page asked for 600 x 430 (the narrow layout\'s root); after the first second it does', async () => {
  const p = await opened();
  try {
    p.webContents.emit('preferred-size-changed', {}, {width: 600, height: 430});
    const read = {iw: 600, ih: 430, ch: 430, eh: 26, pins: 0, anim: 0};
    assert.equal(p.follower.decide(read, p.size, 'watch'), false);
    assert.deepEqual(sizeOf(p), [600, 430], 'the window stays');
    assert.equal(p.follower.steps, 0, 'no follow step was counted');
    assert.deepEqual(p.reported, {width: 600, height: 430}, 'and the size the guard compares with is not lowered');
    p.echoUntil = Date.now() - 1;
    p.follower.decide(read, p.size, 'watch');
    assert.deepEqual(sizeOf(p), [600, 26], 'after the first second a page that is that short is followed, as before');
  } finally { done(p); }
});

test('a refused size is written to the local trace once for each way it came and each size (the laptop\'s log says which path it was)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-collapse-150-')), file = path.join(dir, 'extension-windows.log');
  extTrace.setFile(file);
  const p = await opened();
  try {
    for (let i = 0; i < 3; i++) {
      p.webContents.emit('preferred-size-changed', {}, {width: 26, height: 56});   // a report of the narrow layout
      p.noteRefused({width: 56, height: 56}, 'fit'); p.noteRefused({width: 56, height: 56}, 'measure');
      p.follower.decide({iw: 600, ih: 430, ch: 430, eh: 26, pins: 0, anim: 0}, p.size, 'watch');
    }
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(line => line.includes('refuses a size from its own minimum window'));
    const sources = lines.map(line => JSON.parse(line.slice(line.indexOf('{'))).source).sort();
    assert.deepEqual(sources, ['fit', 'follow', 'measure', 'report'], lines.join('\n'));
    assert.match(lines.find(line => line.includes('"report"')), /"width":26,"height":56,"asked":\{"width":600,"height":430\}/);
  } finally { done(p); extTrace.setFile(null); fs.rmSync(dir, {recursive: true, force: true}); }
});

// ---- 4. what must not change --------------------------------------------------------------------------------------------------------------------------------------------

test('a real shrink right after the load (a page tied to its window: 360 x 600 asked, 360 x 340 after the reset) is taken at once: both sides are above 64', async () => {
  const p = await opened({asked: {width: 360, height: 600}});
  try {
    p.webContents.emit('preferred-size-changed', {}, {width: 360, height: 340});
    assert.deepEqual(sizeOf(p), [360, 340]);
  } finally { done(p); }
});

test('a size with a side of 64 or less after the first second is a size (a page that really shrinks later)', async () => {
  const p = await opened();
  try {
    p.echoUntil = Date.now() - 1;
    p.webContents.emit('preferred-size-changed', {}, {width: 56, height: 56});
    assert.deepEqual(sizeOf(p), [56, 56]);
  } finally { done(p); }
});

test('a page that really wants a small size in the first second (28 x 30 after 273 x 375) keeps the window at its asked size until the page is seen laid out in it twice, then takes it', async () => {
  const p = await opened({asked: {width: 273, height: 375}});
  try {
    p.echoRecheckMs = 15;
    p.webContents.executeJavaScript = async () => ({iw: p.size.width, ih: p.size.height, cw: p.size.width, ch: p.size.height, sw: p.size.width, sh: p.size.height, fh: p.size.height});
    p.webContents.emit('preferred-size-changed', {}, {width: 28, height: 30});
    assert.deepEqual(sizeOf(p), [273, 375], 'held at first');
    for (let i = 0; i < 6; i++) { mock.timers.tick(15); await flush(4); }
    assert.deepEqual(sizeOf(p), [28, 30], 'then what the page wants');
  } finally { done(p); }
});
