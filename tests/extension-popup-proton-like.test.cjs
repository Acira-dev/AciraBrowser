'use strict';
// 13.8 item 9, third hand test (a screenshot of build dfce1f41, Proton Pass signed in: "Your vault is empty", the list scroller cutting "Create a folder", and a blank band
// under it that does not go away). The screenshot measures 886 x 805 px for the popup and 636 px for the page's content: 805 / 636 = 1.266 and 545 / 430 = 1.267, 886 px for 600 DIPs
// = 1.477 px per DIP: a window of 600 x 545 around a page 430 tall, the very 545 of the trace. dfce1f41 is the first follow-up (7fa85cce); it still holds the older sizing measure that added
// the height of the page's own scrollers (115 + 430 = 545) and, after the window had grown back three times, the follower gave up for good: the band stayed.
// This file pins the "viewport-tied family" with a Proton-like page, at the two levels:
//  1. the probe (the real one, in a vm, on small fake pages with laid-out numbers by hand): a root fixed by a variable (Proton: html, body { height: var(--popup-height) }), a root that
//     follows the window (height: 100%) with an inner scroller, signed out and signed in, a root pinned bigger than the window, content that overflows a pinned root;
//  2. the popup (real ExtensionPopup, real sizing measure, real follower, fake engine): Proton's page model (root pinned to --popup-height, its script copying the window's size into
//     the variables 50 ms after the width changes by more than a pixel, Blink reporting the pair (width, document scroll height) as the window changes) and a follow-the-window page with a
//     scroller, through opening, the four sizing timers, a window that is made too tall by something else, sign-in and sign-out, a scroll, later reports: the window ends at the page and
//     is never taller than it at any moment, and nothing is switched off for good.
// No Electron; the popup tests stop setTimeout and Date (node's mock timers) so nothing depends on a timer's luck.
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {mock} = test;
const {ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
const {fitExtensionAction} = require('../desktop/browser-services/extension-action-sizing.cjs');
const follow = require('../desktop/browser-services/extension-popup-follow.cjs');
const {METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');
const {followScript, isFollowScript, isWatchScript, FOLLOW} = follow;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };

// ---- 1. the probe on Proton-shaped pages --------------------------------------------------------------------------------------------------------------------------------

const style = (o = {}) => ({display: 'block', position: 'static', overflowY: 'visible', height: 'auto', minHeight: '0px', marginBottom: '0px', paddingBottom: '0px', borderBottomWidth: '0px', ...o});
function el(name, {spec = {}, st = {}, bottom = 0, children = []} = {}) {
  const node = {nodeType: 1, name, childNodes: children, shadowRoot: null, st: style(st), spec: {height: 'auto', 'min-height': 'auto', ...spec}, bottom};
  node.getBoundingClientRect = () => ({top: 0, bottom: node.bottom, height: node.bottom});
  node.computedStyleMap = () => ({get: prop => node.spec[prop]});
  return node;
}
const text = bottom => ({nodeType: 3, nodeValue: 'text', bottom});

/**
 * Proton-shaped DOM as the engine would lay it out in a window of `h` tall: html and body either fixed by the page's variable (`pinned`: an explicit px height) or following the window
 * (`'100%'`); the app root fills them; a header 76 tall and a list scroller (overflow: auto) below it that ends at `content` (what is shown) holding `rows` px of rows.
 */
function protonDom({h, mode, vars = 430, content = 430, rows = 700, overflowBottom = 0}) {
  const header = el('header', {bottom: 76, children: [text(50)]});
  const rowsBox = el('rows', {bottom: content - 76 + rows - 354 + 76, children: [text(content + 200)]});    // lives inside the scroller; not part of the page's height
  const scroller = el('scroller', {st: {overflowY: 'auto'}, bottom: content, children: [rowsBox]});
  const children = [header, scroller];
  if (overflowBottom) children.push(el('overflow', {bottom: overflowBottom, children: [text(overflowBottom)]}));
  const app = el('app', {spec: {height: '100%'}, st: {height: (mode === 'pinned' ? vars : h) + 'px'}, bottom: mode === 'pinned' ? vars : h, children});
  const pin = mode === 'pinned' ? vars + 'px' : '100%';
  const rootBox = mode === 'pinned' ? vars : h;
  const body = el('body', {spec: {height: pin}, st: {height: rootBox + 'px'}, bottom: rootBox, children: [app]});
  const root = el('html', {spec: {height: pin}, st: {height: rootBox + 'px'}, bottom: rootBox, children: [body]});
  root.scrollHeight = Math.max(h, rootBox, overflowBottom); root.clientHeight = h;
  return {
    root, body, app, scroller,
    sandbox: {
      document: {documentElement: root, body, styleSheets: [], adoptedStyleSheets: [], querySelectorAll: () => [], getAnimations: () => [], createRange: () => { let node; return {selectNodeContents: n => { node = n; }, getBoundingClientRect: () => ({height: 20, bottom: node.bottom})}; }},
      innerHeight: h, innerWidth: 600, getComputedStyle: node => node.st,
    },
  };
}
const probe = dom => vm.runInNewContext(followScript(null), vm.createContext({...dom.sandbox}));

test('Proton\'s root is fixed by a variable (430 px) and the window is 545 (the screenshot): the page is 430 tall, the list scroller\'s 700 px of rows are its own', () => {
  const read = probe(protonDom({h: 545, mode: 'pinned', vars: 430, content: 430}));
  assert.equal(read.eh, 430, 'the page, not the window');
  assert.equal(read.ch, 545);
  assert.deepEqual(follow.followStep(read, {width: 600, height: 545}), {height: 430}, 'the window comes down to it');
});

test('a root that follows the window (height: 100%) with a list scroller under a header: the content\'s bottom, signed out and signed in, at any window height', () => {
  for (const h of [600, 545, 430, 300]) {
    assert.equal(probe(protonDom({h, mode: '100%', content: 300})).eh, 300, `signed out in a window of ${h}`);
    assert.equal(probe(protonDom({h, mode: '100%', content: 430})).eh, 430, `signed in in a window of ${h}`);
  }
});

test('a window that is already the page\'s size reads as the page\'s size (nothing to follow), pinned or not', () => {
  assert.deepEqual(follow.followStep(probe(protonDom({h: 430, mode: 'pinned', vars: 430})), {width: 600, height: 430}), null);
  assert.deepEqual(follow.followStep(probe(protonDom({h: 430, mode: '100%', content: 430})), {width: 600, height: 430}), null);
});

test('content that runs past a root fixed at 430 is the page\'s size (the document scrolls), and a root fixed bigger than the window is the page\'s own height as in Chromium', () => {
  assert.equal(probe(protonDom({h: 430, mode: 'pinned', vars: 430, content: 430, overflowBottom: 545})).eh, 545);
  assert.equal(probe(protonDom({h: 545, mode: 'pinned', vars: 545, content: 430})).eh, 545, 'explicit 545: the page says so (the window keeps it)');
});

// ---- 2. the popup ---------------------------------------------------------------------------------------------------------------------------------------------------------

class FakeContents extends EventEmitter {
  constructor() { super(); this.closed = false; this.executed = {fit: 0, follow: 0, watch: 0, sizing: 0}; }
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
 * A popup on a Proton-shaped page.
 *  mode 'pinned': html and body are `vars.h` tall and `vars.w` wide (an explicit px size) in any window; with `script`, the variables are copied from the window's size 50 ms after its
 *    width changes by more than a pixel (Proton's script: Math.abs(clientWidth - var(--popup-width)) > 1).
 *  mode '100%': html and body follow the window; the page's height is `content`.
 * The page's height is also the document's scroll height; Blink reports (width, document scroll height) when that pair changes (the page echoes its window).
 */
function protonPopup({mode = 'pinned', content = 430, rows = 700, vars = {w: 600, h: 430}, script = false} = {}) {
  const parent = new FakeWindow({});
  parent.content = parent.bounds = {x: 260, y: 69, width: 1088, height: 700};
  const ui = new FakeView(); ui.webContents.getURL = () => 'acira-browser-ui://ui/index.html'; parent.contentView.addChildView(ui);
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 29, width: 1352, height: 795}})}};
  const p = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'win32', diagnostics: () => {}});
  const pg = {mode, content, rows, vars: {...vars}, width: 600, watchers: [], lastPair: null};
  p.pg = pg;
  const rootBox = h => (pg.mode === 'pinned' ? pg.vars.h : h);
  const docScroll = h => Math.max(h, rootBox(h), pg.content);
  const pageWidth = () => (pg.mode === 'pinned' ? pg.vars.w : pg.width);
  const pair = () => [pageWidth(), docScroll(p.size.height)];
  const dom = () => protonDom({h: p.size.height, mode: pg.mode === 'pinned' ? 'pinned' : '100%', vars: pg.vars.h, content: Math.min(pg.content, pg.mode === 'pinned' ? pg.vars.h : pg.content), rows: pg.rows, overflowBottom: pg.mode === 'pinned' && pg.content > pg.vars.h ? pg.content : 0});
  const sizingDom = () => {
    const h = p.size.height, w = p.size.width, rows = pg.rows;
    const body = {scrollHeight: rootBox(h), scrollWidth: w, computedStyleMap: () => ({get: () => '100%'})};
    const rootEl = {scrollHeight: docScroll(h), scrollWidth: Math.max(w, pageWidth())};
    const list = {scrollHeight: rows, clientHeight: 354, getBoundingClientRect: () => ({top: 76, width: w, height: 354})};
    const bodyStyle = {minWidth: '0px', width: w + 'px', minHeight: '0px'};
    return {document: {body, documentElement: rootEl, createTreeWalker: () => { let done = false; return {nextNode: () => (done ? null : (done = true, list))}; }}, NodeFilter: {SHOW_ELEMENT: 1}, innerWidth: w, innerHeight: h, getComputedStyle: node => (node === body ? bodyStyle : {overflowY: 'auto'})};
  };
  p.webContents.executeJavaScript = async code => {
    const w = p.size.width, h = p.size.height;
    if (code === METRICS_SCRIPT) { p.webContents.executed.fit++; return {iw: w, ih: h, cw: w, ch: h, sw: Math.max(w, pageWidth()), sh: docScroll(h), fh: h}; }
    if (isWatchScript(code)) {
      p.webContents.executed.watch++;
      if (/, null, \{"minGapMs"/.test(code)) return {...probe(dom()), why: ['start']};
      return new Promise(resolve => pg.watchers.push(resolve));
    }
    if (isFollowScript(code)) { p.webContents.executed.follow++; return probe(dom()); }
    if (code.includes('explicitWidth')) { p.webContents.executed.sizing++; return vm.runInNewContext(code, vm.createContext(sizingDom())); }
    throw new Error('unexpected script');
  };
  /** The page's layout changed (a screen came or went): Blink reports the pair if it changed, and the page's watch says so. */
  p.relayout = (why = ['mutation']) => {
    const now = pair().join('x');
    if (pg.lastPair !== now) { pg.lastPair = now; p.webContents.emit('preferred-size-changed', {}, {width: pair()[0], height: pair()[1]}); }
    for (const resolve of pg.watchers.splice(0)) resolve({...probe(dom()), why});
  };
  p.window.onBounds = () => {
    setImmediate(() => { if (!p.destroyed) p.relayout(['resize']); });
    if (script) {
      clearTimeout(pg.scriptTimer);
      pg.scriptTimer = setTimeout(() => {                  // Proton's debounced resize handler (50 ms)
        if (p.destroyed) return;
        const cw = p.size.width, ch = p.size.height;
        if (Math.abs(cw - pg.vars.w) > 1) { pg.vars = {w: cw, h: ch}; p.relayout(['mutation']); }
      }, 50);
    }
  };
  fitExtensionAction(p);
  return p;
}
const size = p => { const {width, height} = p.window.getBounds(); return [width, height]; };
const tallest = (p, from = 0) => Math.max(...p.window.history.slice(from).map(([, h]) => h));
const report = (p, width, height) => p.webContents.emit('preferred-size-changed', {}, {width, height});
async function run(ms) { for (let t = 0; t < ms; t += 20) { mock.timers.tick(20); await flush(3); } }
/** Opened the way the engine does it: the page loads, asks its size, and the popup is shown once that size has been laid out. */
async function open(p) {
  await p.whenReady();
  p.relayout(['start']);                                   // the first pair: (width, scroll height) in the 25 x 25 window of the reset, then in the window the report gave
  report(p, p.pg.mode === 'pinned' ? p.pg.vars.w : 600, p.pg.mode === 'pinned' ? p.pg.vars.h : p.pg.content);
  p.pg.lastPair = null;
  await run(200);
}
const withMockTimers = fn => async () => {
  mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1.7e12});
  try { await fn(); } finally { mock.timers.reset(); }
};

test('Proton Pass signed in (root fixed at 430 by its variable, a list scroller holding 700 px of rows): opened, the four sizing timers, a scroll and later reports: 600 x 430, never taller at any moment', withMockTimers(async () => {
  const p = protonPopup({mode: 'pinned', content: 430, rows: 700, script: true});
  try {
    await open(p);
    await run(1700);                                       // all four sizing measures have run
    assert.deepEqual(size(p), [600, 430]);
    assert.ok(p.webContents.executed.sizing >= 3, `${p.webContents.executed.sizing} sizing measures ran`);
    assert.ok(tallest(p) <= 430, `the window was ${tallest(p)} tall at some moment: ${JSON.stringify(p.window.history)}`);
    const mark = p.window.history.length;
    p.webContents.emit('input-event', {}, {type: 'mouseWheel'}); p.relayout(['event']); p.webContents.emit('did-navigate-in-page');
    await run(300); report(p, 600, 430); p.relayout(['mutation']); await run(2000);
    assert.deepEqual(size(p), [600, 430]);
    assert.ok(tallest(p, mark) <= 430, `after the scroll: ${JSON.stringify(p.window.history.slice(mark))}`);
    assert.equal(p.follower.disabled, false);
  } finally { p.destroy(); }
}));

test('something else makes the window taller than the page (545 around 430): the follower brings it down, once, and it stays through sizing measures, reports, and Proton\'s script copying the window\'s size', withMockTimers(async () => {
  const p = protonPopup({mode: 'pinned', content: 430, rows: 700, script: true});
  try {
    await open(p);
    await run(1700);
    p.setSize({width: 600, height: 545});                  // an overshoot from some other source
    await run(400);
    assert.deepEqual(size(p), [600, 430], 'back at the page');
    const mark = p.window.history.length;
    p.extra = {width: 15, height: 0}; p.resize();          // a scrollbar's room on the width: the page\'s script copies the window (615 x 430) into its variables
    await run(300);
    p.relayout(['mutation']); report(p, 615, 430); await run(2000);
    assert.equal(size(p)[1], 430, 'the height did not move');
    assert.ok(tallest(p, mark) <= 430, `never taller again: ${JSON.stringify(p.window.history.slice(mark))}`);
    assert.equal(p.follower.disabled, false);
  } finally { p.destroy(); }
}));

test('signed out to signed in on a page whose root is fixed (Proton\'s login and vault are both 600 x 430): the window does not move at all', withMockTimers(async () => {
  const p = protonPopup({mode: 'pinned', content: 300, rows: 0, script: true});    // the login screen is shorter than the root
  try {
    await open(p);
    await run(1700);
    assert.deepEqual(size(p), [600, 430]);
    const mark = p.window.history.length;
    p.pg.content = 430; p.pg.rows = 700; p.relayout(['mutation']); await run(1500);   // signed in: the list
    assert.deepEqual(size(p), [600, 430]);
    p.pg.content = 300; p.pg.rows = 0; p.relayout(['mutation']); await run(1500);     // signed out again
    assert.deepEqual(size(p), [600, 430]);
    assert.equal(p.window.history.length, mark, 'no resize at all: no flash');
  } finally { p.destroy(); }
}));

test('a root that follows the window with a list scroller: signed out 300, signed in 430 and back, the window follows the content both ways and is never taller than it (the scroller\'s 700 px of rows are not the page)', withMockTimers(async () => {
  const p = protonPopup({mode: '100%', content: 300, rows: 700});
  try {
    await open(p);
    await run(1700);
    assert.deepEqual(size(p), [600, 300]);
    const mark = p.window.history.length;
    p.pg.content = 430; p.relayout(['mutation']); await run(1700);                    // signed in: the page grew (a report) and the sizing measures run again
    assert.deepEqual(size(p), [600, 430]);
    p.pg.content = 300; p.relayout(['mutation']); await run(1700);                    // signed out: no report (the page follows its window): the follower
    assert.deepEqual(size(p), [600, 300]);
    p.pg.content = 430; p.relayout(['mutation']); await run(300);
    p.pg.content = 300; p.relayout(['mutation']); await run(1700);                    // quickly there and back
    assert.deepEqual(size(p), [600, 300]);
    assert.ok(tallest(p, mark) <= 430, `never taller than the signed-in page: ${JSON.stringify(p.window.history.slice(mark))}`);
    assert.equal(p.follower.disabled, false);
  } finally { p.destroy(); }
}));

test('the window that the old sizing measure left 115 taller than the page (the screenshot: 545 around 430) comes down and stays, and the follower is not switched off by what grew it', withMockTimers(async () => {
  const p = protonPopup({mode: 'pinned', content: 430, rows: 700, script: false});
  try {
    await open(p);
    // the older measure's clause (the scroller's top + its scroll height = 545) is what grew it, three times; whatever grows it, the follower holds off and comes back
    for (let i = 0; i < 4; i++) { p.setSize({width: 600, height: 545}); await run(150); }
    await run(40000);
    assert.deepEqual(size(p), [600, 430], 'the band is gone');
    assert.equal(p.follower.disabled, false, 'never for good');
    assert.ok(p.follower.regrows >= 1);
  } finally { p.destroy(); }
}));
