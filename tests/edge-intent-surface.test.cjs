'use strict';
// Edge reveal and a page whose player fills the window (YouTube Inline Fullscreen is CSS only: a class on <html> makes #movie_player the whole page; theater mode and
// full-window canvases are the same). The page preload reports "the pointer is over something to use" near the left and top edge (R8), and the edge controller then waits
// 650 ms (400 in Fast; 260 / 180 pressed against the edge) instead of 90 / 40: right for a seek bar or a link at the edge. A video or player that IS the page covered the
// whole band, so every rest at the edge was "over a control", and YouTube's hidden cursor ('none') counted as a control too: the bars seemed not to come.
// Chromium's own rule for browser UI: only a window in browser fullscreen hides it; a page that fills its tab does not. No Electron starts here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'desktop', 'page-input-preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.cjs'), 'utf8');

/** The R8 block of the page preload, run against a small fake page. Returns {move(options), reports}. */
function edgePage({width = 1280, height = 720} = {}) {
  const start = preload.indexOf('if(process.isMainFrame){\n const BAND=24');
  const end = preload.indexOf('// A plain click on a link that replaces this page', start);
  assert.ok(start > 0 && end > start, 'the R8 edge intent block is where this test expects it');
  const handlers = new Map(), reports = [];
  class FakeElement {
    constructor(selector, rect) { this.selector = selector; this.rect = rect; }
    matches(selectors) { return selectors.split(',').map(part => part.trim()).includes(this.selector); }
    getBoundingClientRect() { return {x: this.rect[0], y: this.rect[1], left: this.rect[0], top: this.rect[1], width: this.rect[2], height: this.rect[3], right: this.rect[0] + this.rect[2], bottom: this.rect[1] + this.rect[3]}; }
  }
  class Frame extends FakeElement {}
  const sandbox = {
    process: {isMainFrame: true}, ipcRenderer: {send: (channel, patch) => reports.push([channel, {...patch}])},
    Element: FakeElement, HTMLIFrameElement: Frame, HTMLEmbedElement: class {}, HTMLObjectElement: class {},
    document: {querySelectorAll: () => [], addEventListener() {}, documentElement: {clientWidth: width, clientHeight: height}, pointerLockElement: null},
    window: {innerWidth: width, innerHeight: height, addEventListener: (name, fn) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }},
    Date
  };
  vm.createContext(sandbox);
  vm.runInContext(preload.slice(start, end), sandbox);
  const move = (x, y, ...path) => { for (const fn of handlers.get('pointermove') || []) fn({isTrusted: true, clientX: x, clientY: y, composedPath: () => path}); };
  const hover = () => { const sent = reports.filter(([, patch]) => 'hover' in patch); return sent.length ? sent.at(-1)[1].hover : false; };
  return {move, reports, hover, FakeElement};
}

test('a video that is the whole page is not a control at the edge (13.7: every edge point counted as one)', () => {
  const page = edgePage();
  const video = new page.FakeElement('video', [0, 0, 1280, 720]);
  page.move(3, 300, video);
  assert.equal(page.hover(), false, 'the left edge over a full-window video');
  page.move(400, 3, video);
  assert.equal(page.hover(), false, 'the top edge over a full-window video');
});

test('the player that fills the window (a focusable wrapper, a full-window canvas) is the surface, not a control', () => {
  const page = edgePage();
  const wrapper = new page.FakeElement('[tabindex]:not([tabindex^="-"])', [0, 0, 1280, 720]);
  const canvas = new page.FakeElement('canvas', [0, 0, 1280, 700]);
  page.move(3, 300, wrapper);
  assert.equal(page.hover(), false, 'a wrapper as big as the window');
  page.move(3, 300, canvas, wrapper);
  assert.equal(page.hover(), false, 'a canvas as big as the window inside it');
});

test('real controls at the edge still count: a button, a link, a seek bar thin along the whole width, a small video', () => {
  const page = edgePage();
  const video = new page.FakeElement('video', [0, 0, 1280, 720]);
  const button = new page.FakeElement('button', [0, 0, 40, 40]);
  page.move(5, 5, button, video);
  assert.equal(page.hover(), true, 'a button over the full-window video wins: it is something to use');
  page.move(3, 300, video);
  assert.equal(page.hover(), false);
  const seek = new page.FakeElement('[role=slider]', [0, 690, 1280, 6]);
  page.move(3, 5, seek);
  assert.equal(page.hover(), true, 'a seek bar spans the whole width but is thin');
  page.move(3, 300, new page.FakeElement('a[href]', [0, 280, 220, 40]));
  assert.equal(page.hover(), true, 'a link at the side');
  page.move(3, 300, new page.FakeElement('video', [0, 200, 400, 300]));
  assert.equal(page.hover(), true, 'a small video on the page is still something the pointer may be about to use');
});

test('away from the edge nothing is reported as a control', () => {
  const page = edgePage();
  page.move(600, 360, new page.FakeElement('button', [580, 340, 40, 40]));
  assert.equal(page.hover(), false);
});

test('main: a hidden cursor is no control; a hand, a text cursor, a crosshair or a resize still are', () => {
  const start = main.indexOf('const edgeIntent={');
  const end = main.indexOf('\n', start);
  assert.ok(start > 0 && end > start, 'edgeIntent is where this test expects it');
  const sandbox = {nativeModal: {isOpen: () => false}, Date};
  vm.createContext(sandbox);
  const intent = vm.runInContext(main.slice(start, end) + ';edgeIntent', sandbox);
  const engagedWith = cursor => { intent.hover = false; intent.noteCursor(cursor); return intent.engaged; };
  assert.equal(engagedWith('none'), false, 'YouTube hides the cursor over a playing video');
  for (const plain of ['pointer', 'default', '', 'null']) assert.equal(engagedWith(plain), false, plain);
  for (const control of ['hand', 'text', 'crosshair', 'grab', 'e-resize']) assert.equal(engagedWith(control), true, control);
  intent.hover = true; intent.noteCursor('none');
  assert.equal(intent.engaged, true, 'the page saying a control is under the pointer still counts');
});
