'use strict';
// 13.8, GitHub #4 follow-up (reported on a Mac: "for Tabrr it's really glitchy: when I press it, it opens a new tab, but I can't access the Seamless bar").
// What a page says about the pointer (a control under it, a cursor that is not the arrow) was kept by main as ONE window-wide answer, the last report of whichever
// page spoke last. The toolbar's button that opens a new tab leaves the pointer in the interface; the page the pointer left and the new page that arrives say nothing
// more (Chromium sends no cursor change for a view that starts on the default cursor), so the last report stayed in force: every rest at the window's edge counted
// as "over a control" and waited 650 ms (edge-reveal.cjs ENGAGED_DWELL) instead of 90, and Seamless's bar seemed not to come. Since 13.8 an extension's New Tab page is an
// ordinary page whose cursor and control reports feed this (13.7 drew it in a view with no such reports). No Electron starts here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pointOnAny} = require('../desktop/edge-intent-scope.cjs');
const {createEdgeController, DWELL, ENGAGED_DWELL} = require('../desktop/edge-reveal.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.cjs'), 'utf8');

test('pointOnAny: inside a box counts (left and top edges in, right and bottom edges out); outside every box, or no box at all, does not; an unknown pointer keeps what was reported', () => {
  const page = {x: 6, y: 6, width: 1076, height: 688};
  assert.equal(pointOnAny({x: 6, y: 6}, [page]), true);
  assert.equal(pointOnAny({x: 1081, y: 693}, [page]), true);
  assert.equal(pointOnAny({x: 1082, y: 300}, [page]), false, 'the right edge is outside');
  assert.equal(pointOnAny({x: 300, y: 694}, [page]), false, 'the bottom edge is outside');
  assert.equal(pointOnAny({x: 300, y: 2}, [page]), false, 'the strip above a Seamless page');
  assert.equal(pointOnAny({x: 300, y: 300}, []), false, 'an Acira page: no page on screen');
  assert.equal(pointOnAny({x: 300, y: 300}, [{x: 0, y: 0, width: 100, height: 100}, page]), true, 'any box');
  assert.equal(pointOnAny(null, [page]), true);
  assert.equal(pointOnAny({x: NaN, y: 1}, [page]), true);
  assert.equal(pointOnAny({x: 300, y: 300}, [null, {x: 0, y: 0}, page]), true, 'a bad box is skipped');
});

/** main.cjs's own pointerOnShownPage and the engaged it feeds, run against stand-ins for the window, the screen and the pages. */
function mainGate({pages = [], visible = [], point = {x: 400, y: 300}, events = null, throws = false} = {}) {
  const start = main.indexOf('const pointerOnShownPage=()=>');
  const end = main.indexOf('\n', start);
  assert.ok(start > 0 && end > start, 'pointerOnShownPage is where this test expects it');
  const lineTwo = main.indexOf('edgeItem.engaged=', end);
  assert.ok(lineTwo === end + 1, 'edgeItem.engaged follows it');
  const second = main.slice(lineTwo, main.indexOf('\n', lineTwo));
  const intent = {cursor: 'default', hover: false, get engaged() { return this.hover || !['pointer', 'default', 'null', ''].includes(this.cursor); }};
  const edgeItem = {engaged: () => intent.engaged};
  const content = {x: 100, y: 50, width: 1200, height: 800};
  const sandbox = {
    edgeItem, edgeIntent: intent, pages: new Map(pages.map(([id, box]) => [id, {targetBounds: box, view: {webContents: {isDestroyed: () => false}, getBounds: () => box}}])),
    pageVisible: id => visible.includes(id), pointerSource: {eventsMode: () => !!events, point: () => events},
    mainWindow: {getContentBounds: () => content}, screen: {getCursorScreenPoint: () => { if (throws) throw new Error('no pointer'); return {x: content.x + point.x, y: content.y + point.y}; }},
    require: name => require(path.join(root, 'desktop', name.replace(/^\.\//, '')))
  };
  vm.createContext(sandbox);
  vm.runInContext(main.slice(start, end) + '\n' + second, sandbox);
  return {intent, engaged: () => edgeItem.engaged()};
}

const PAGE = {x: 6, y: 6, width: 1076, height: 688};

test('main: a hand cursor the page left behind does not count while the pointer is in the interface (the toolbar), above the page', () => {
  const gate = mainGate({pages: [['a', PAGE]], visible: ['a'], point: {x: 500, y: 2}});
  gate.intent.cursor = 'hand';
  assert.equal(gate.intent.engaged, true, 'the page last said a control (what 13.7 and every build before used)');
  assert.equal(gate.engaged(), false, 'the pointer is not over the page: nothing of the page is under it');
});

test('main: over the page the report still counts: a control, a hand, a text cursor', () => {
  const over = mainGate({pages: [['a', PAGE]], visible: ['a'], point: {x: 500, y: 300}});
  over.intent.cursor = 'hand';
  assert.equal(over.engaged(), true);
  over.intent.cursor = 'default'; over.intent.hover = true;
  assert.equal(over.engaged(), true, 'a control under the pointer at the page\'s own top band');
  over.intent.hover = false;
  assert.equal(over.engaged(), false, 'the arrow over empty page');
});

test('main: only pages on screen count; an Acira page (no page view) or a page that is not shown never makes the edge wait', () => {
  const hidden = mainGate({pages: [['a', PAGE]], visible: [], point: {x: 500, y: 300}});
  hidden.intent.cursor = 'hand';
  assert.equal(hidden.engaged(), false, 'the page is not the one in view');
  const acira = mainGate({pages: [], visible: [], point: {x: 500, y: 300}});
  acira.intent.hover = true;
  assert.equal(acira.engaged(), false, 'Acira\'s own page: no page view');
  const split = mainGate({pages: [['a', {x: 6, y: 6, width: 500, height: 688}], ['b', {x: 512, y: 6, width: 570, height: 688}]], visible: ['a', 'b'], point: {x: 700, y: 300}});
  split.intent.hover = true;
  assert.equal(split.engaged(), true, 'the pane under the pointer');
});

test('main: a window that cannot say where the pointer is (Wayland gives it by events, a failing screen read) keeps what the page said', () => {
  const wayland = mainGate({pages: [['a', PAGE]], visible: ['a'], events: {x: 500, y: 2}});
  wayland.intent.cursor = 'hand';
  assert.equal(wayland.engaged(), false, 'the events say it is above the page (content coordinates, no offset)');
  const over = mainGate({pages: [['a', PAGE]], visible: ['a'], events: {x: 500, y: 300}});
  over.intent.cursor = 'hand';
  assert.equal(over.engaged(), true);
  const broken = mainGate({pages: [['a', PAGE]], visible: ['a'], throws: true});
  broken.intent.cursor = 'hand';
  assert.equal(broken.engaged(), true, 'as before when the pointer cannot be read');
});

test('the Seamless top edge with the reported sequence: the pointer comes to the strip above the page, the stale report says "a control" (13.7 / f457529: the bar waits 650 ms; now 90)', () => {
  const win = {x: 100, y: 50, width: 1200, height: 800};
  const base = {focused: true, suspended: false, view: 'seamless', vertical: false, docked: false, edges: {top: true, side: true}, holds: {top: false, side: false}, size: {topHeight: 72, sideWidth: 0}, bounds: win};
  const at = (x, y) => ({x: win.x + x, y: win.y + y});
  const reveal = engaged => {
    const clock = {t: 10_000}, controller = createEdgeController({now: () => clock.t});
    for (let elapsed = 0; elapsed <= 900; elapsed += 16) {
      const result = controller.sample({...base, point: at(500, 3), engaged});
      if (result.top) return elapsed;
      clock.t += 16;
    }
    return null;
  };
  const stale = true;
  assert.ok(reveal(stale) >= ENGAGED_DWELL.top - 40, 'with the stale report in force the bar waits for a control that is not there');
  const gate = mainGate({pages: [['a', PAGE]], visible: ['a'], point: {x: 500, y: 3}});
  gate.intent.cursor = 'hand';
  const now = reveal(gate.engaged());
  assert.ok(now !== null && now <= DWELL.top + 40, `the bar comes at the normal rest, got ${now} ms`);
});

test('main: a page that is not on screen cannot speak for the pointer, and a new tab in view starts with nothing said', () => {
  assert.match(main, /pageBridge\.on\('acira:edge-intent',\(event,payload\)=>\{if\(windowClosing\|\|event\.senderFrame!==event\.sender\.mainFrame\)return;const owner=pageOwner\(pages,event\.sender\);if\(!owner\|\|!pageVisible\(owner\)\)return;edgeIntent\.report\(payload\);\}\);/);
  assert.match(main, /wc\.on\('cursor-changed',\(_e,type\)=>\{if\(pageVisible\(tab\.id\)\)edgeIntent\.noteCursor\(type\);\}\);/);
  assert.match(main, /const normalizedNewTabs=value=>\{noteIntentTab\(value\?\.activeTabId\);return newTabKit\.normalizeTabs\(/, 'every state change (an action, a page event) notes the tab in view');
  const noting = main.indexOf('let intentTab=null;function noteIntentTab(id)');
  assert.ok(noting > 0);
  const ran = [];
  const note = new Function('resetEdgeIntent', main.slice(noting, main.indexOf('\n', noting)) + '\nreturn noteIntentTab;')(() => ran.push('reset'));
  note('a'); note('a'); note('b'); note('b'); note(undefined);
  assert.deepEqual(ran, ['reset', 'reset', 'reset'], 'reset once per change of the tab in view, not on every state change');
  const start = main.indexOf('function resetEdgeIntent()');
  assert.ok(start > 0);
  const intent = {cursor: 'hand', hover: true, drag: true, lock: true};
  const run = new Function('edgeIntent', main.slice(start, main.indexOf('\n', start)) + '\nresetEdgeIntent();');
  run(intent);
  assert.deepEqual(intent, {cursor: 'default', hover: false, drag: false, lock: false});
  assert.doesNotThrow(() => new Function(main.slice(start, main.indexOf('\n', start)) + '\nresetEdgeIntent();')(), 'before the window has its edge intent (a ReferenceError) nothing is thrown');
});
