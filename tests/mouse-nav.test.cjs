'use strict';
// The mouse's back and forward buttons (13.9, a user: "a bit buggy"). Chromium's rule, read from its source: on the RELEASE, when the renderer
// did not consume it, the outermost web contents under the pointer steps (content/browser/renderer_host/render_widget_host_impl.cc OnMouseEventAck ->
// content/browser/web_contents/web_contents_impl.cc HandleMouseEvent). Electron is content, so pages already do this. 13.8 measured in a hidden app:
// over Acira's interface nothing happened; a tab's first site never went back to its New Tab; Electron's Linux 'app-command' (sent on the PRESS,
// shell/browser/native_window_views.cc OnMouseEvent) stepped too, so Linux went back twice, and a driver sending WM_APPCOMMAND besides the button killed
// main (5 of 5). Here: desktop/mouse-nav.cjs, desktop/page-input-preload.cjs (the page's answer), main.cjs wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'desktop', 'mouse-nav.cjs');
const load = () => { assert.ok(fs.existsSync(modulePath), 'desktop/mouse-nav.cjs exists'); return require(modulePath); };

function world({canBack = true, canForward = true, tabCan = true} = {}) {
  let t = 1000; const queue = [];
  const timers = {setTimeout: (fn, ms) => { const item = {at: t + ms, fn, live: true}; queue.push(item); return item; }, clearTimeout: item => { if (item) item.live = false; }};
  const advance = ms => { t += ms; for (const item of [...queue].sort((a, b) => a.at - b.at)) if (item.live && item.at <= t) { item.live = false; item.fn(); } };
  const steps = [];
  const nav = load().createMouseNav({now: () => t, timers, active: d => steps.push(['active', d]), tabStep: (id, d) => steps.push(['tab', id, d]), tabCanStep: () => tabCan});
  const page = {navigationHistory: {canGoBack: () => canBack, canGoForward: () => canForward}};
  const event = () => { const e = {prevented: false, preventDefault() { this.prevented = true; }}; return e; };
  return {nav, page, steps, advance, event};
}
const down = button => ({type: 'mouseDown', button}), up = button => ({type: 'mouseUp', button});
// The interface's release acts after the interface says what is under the pointer (a promise): let it settle.
const settle = () => new Promise(resolve => setImmediate(resolve));

test('over Acira\'s interface: the button never reaches the interface page; the active tab steps once, on the RELEASE', async () => {
  const w = world();
  const e1 = w.event(); assert.equal(w.nav.ui('interface', down('back'), e1), true);
  assert.equal(e1.prevented, true, 'kept from the interface page (its own history never moves)');
  assert.deepEqual(w.steps, [], 'nothing on the press');
  const e2 = w.event(); w.nav.ui('interface', up('back'), e2); await settle();
  assert.equal(e2.prevented, true);
  assert.deepEqual(w.steps, [['active', -1]], 'the active tab goes back on the release');
  w.nav.ui('interface', down('forward'), w.event()); w.nav.ui('interface', up('forward'), w.event()); await settle();
  assert.deepEqual(w.steps, [['active', -1], ['active', 1]]);
});

test('over an open menu or panel (the popup layer): kept from it, nothing steps; other buttons pass through untouched', () => {
  const w = world();
  const e = w.event(); w.nav.ui('popup', down('back'), e); w.nav.ui('popup', up('back'), w.event());
  assert.equal(e.prevented, true);
  assert.deepEqual(w.steps, []);
  const left = w.event(); assert.equal(w.nav.ui('interface', up('left'), left), false);
  assert.equal(left.prevented, false, 'a left click is the interface\'s own');
  assert.equal(w.nav.ui('interface', {type: 'mouseMove', button: 'back'}, w.event()), false);
});

test('over a page that could step by itself: Chromium steps it (nothing more from Acira), whatever the page answers', () => {
  const w = world({canBack: true});
  w.nav.page('tab-1', w.page, down('back')); w.nav.page('tab-1', w.page, up('back'));
  assert.equal(w.nav.report(w.page, {button: 'back', prevented: false}), 'chromium-stepped');
  assert.deepEqual(w.steps, []);
});

test('the first site of a tab opened from a New Tab: the page cannot step, did not cancel: the tab goes back to its New Tab (as Chrome does)', () => {
  const w = world({canBack: false, tabCan: true});
  w.nav.page('tab-n', w.page, down('back')); w.nav.page('tab-n', w.page, up('back'));
  assert.equal(w.nav.report(w.page, {button: 'back', prevented: false}), 'tab-stepped');
  assert.deepEqual(w.steps, [['tab', 'tab-n', -1]], 'that tab, the one under the pointer');
});

test('a web app that cancels the button keeps it: nothing steps', () => {
  const w = world({canBack: false, tabCan: true});
  w.nav.page('tab-c', w.page, down('back')); w.nav.page('tab-c', w.page, up('back'));
  assert.equal(w.nav.report(w.page, {button: 'back', prevented: true}), 'page-kept-it');
  assert.deepEqual(w.steps, []);
});

test('no answer from the page (a hung page, a frame without the preload) or a stale one: nothing steps', () => {
  const w = world({canBack: false, tabCan: true});
  w.nav.page('tab-1', w.page, up('back'));
  w.advance(600);
  assert.equal(w.nav.report(w.page, {button: 'back', prevented: false}), 'none', 'too late');
  w.nav.page('tab-1', w.page, up('back'));
  assert.equal(w.nav.report(w.page, {button: 'forward', prevented: false}), 'none', 'another button');
  assert.equal(w.nav.report(w.page, 'junk'), 'none');
  assert.equal(w.nav.report({}, {button: 'back', prevented: false}), 'none', 'another page');
  assert.deepEqual(w.steps, []);
  const nothing = world({canBack: false, tabCan: false});
  nothing.nav.page('tab-1', nothing.page, up('back'));
  assert.equal(nothing.nav.report(nothing.page, {button: 'back', prevented: false}), 'nothing-to-step');
});

test('one step per click: Linux sends an app-command on the PRESS, Chromium steps on the release: the app-command is dropped', async () => {
  const w = world({canBack: true});
  assert.equal(w.nav.appCommand('browser-backward'), true, 'handled here');
  w.advance(20); w.nav.page('tab-1', w.page, down('back'));
  w.advance(200); w.nav.page('tab-1', w.page, up('back')); w.nav.report(w.page, {button: 'back', prevented: false});
  w.advance(1000);
  assert.deepEqual(w.steps, [], 'only Chromium\'s step on the release');
  // the same over the interface: the release steps the active tab once
  const u = world();
  u.nav.appCommand('browser-backward'); u.advance(20); u.nav.ui('interface', down('back'), u.event()); u.advance(200); u.nav.ui('interface', up('back'), u.event()); await settle(); u.advance(1000);
  assert.deepEqual(u.steps, [['active', -1]]);
});

test('one step per click: a Windows driver that sends WM_APPCOMMAND besides the button (after the release): dropped', () => {
  const w = world({canBack: true});
  w.nav.page('tab-1', w.page, down('back')); w.advance(150); w.nav.page('tab-1', w.page, up('back'));
  w.advance(5); assert.equal(w.nav.appCommand('browser-backward'), true);
  w.advance(1000);
  assert.deepEqual(w.steps, []);
});

test('an app-command alone (a keyboard\'s Browser Back key, a driver that sends only the command) steps the active tab once', () => {
  const w = world();
  w.nav.appCommand('browser-backward'); w.advance(50);
  assert.deepEqual(w.steps, [], 'waits a moment for a click it may belong to');
  w.advance(200);
  assert.deepEqual(w.steps, [['active', -1]]);
  w.advance(1000); w.nav.appCommand('browser-forward'); w.advance(500);
  assert.deepEqual(w.steps, [['active', -1], ['active', 1]]);
  assert.equal(w.nav.appCommand('browser-refresh'), false, 'other app commands are main\'s own');
});

// ---- the page's answer (desktop/page-input-preload.cjs), run against a stand-in page

const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'page-input-preload.cjs'), 'utf8');
function pageWorld() {
  const at = preload.indexOf("// The mouse's back and forward buttons (3 and 4 here).");
  assert.ok(at >= 0, 'the preload says whether the page cancelled the button');
  const start = preload.indexOf('{', preload.indexOf('\n{', at)), end = preload.indexOf("\n}\n", start) + 2;
  const listeners = [], sent = [], timers = [];
  const window = {addEventListener: (type, fn, options) => listeners.push({type, fn, options})};
  new Function('window', 'ipcRenderer', 'setTimeout', preload.slice(start, end))(window, {send: (channel, data) => sent.push([channel, data])}, fn => timers.push(fn));
  const fire = (type, button, prevented, trusted = true) => { for (const l of listeners) if (l.type === type) l.fn({type, button, isTrusted: trusted, defaultPrevented: prevented}); };
  return {listeners, sent, fire, flush: () => { while (timers.length) timers.shift()(); }};
}

test('the page says, once per release, whether it cancelled the mouseup OR the auxclick; only trusted events of buttons 3/4', () => {
  const p = pageWorld();
  assert.ok(p.listeners.every(l => l.options.capture === true && l.options.passive === true), 'capture and passive: never in the way');
  p.fire('mouseup', 3, false); p.fire('auxclick', 3, false); p.flush();
  assert.deepEqual(p.sent, [['acira:mouse-nav', {button: 'back', prevented: false}]]);
  p.fire('mouseup', 4, false); p.fire('auxclick', 4, true); p.flush();
  assert.deepEqual(p.sent.at(-1), ['acira:mouse-nav', {button: 'forward', prevented: true}], 'a cancelled auxclick keeps the button (Blink merges the two)');
  p.fire('mouseup', 3, true); p.flush();
  assert.deepEqual(p.sent.at(-1), ['acira:mouse-nav', {button: 'back', prevented: true}]);
  const count = p.sent.length;
  p.fire('mouseup', 0, false); p.fire('mouseup', 3, false, false); p.flush();
  assert.equal(p.sent.length, count, 'a left click and a script\'s own event say nothing');
});

// ---- wiring in main

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('main: one set of rules per window, before anything can use it, stepping through the toolbar\'s own Back', () => {
  const made = main.indexOf("const mouseNav=require('./mouse-nav.cjs').createMouseNav({");
  assert.ok(made > 0 && made < main.indexOf('const pageBridge=createBridge('), 'made before the page bridge');
  const body = main.slice(made, main.indexOf('\n', made));
  for (const part of ["shortcut(chromeView.webContents,{preventDefault(){}},{},{action:direction<0?'back':'forward'},'menu')", "browserCommand({type:direction<0?'back':'forward',tabId})", 'tab.history[tab.historyIndex+direction]'])
    assert.ok(body.includes(part), part);
});

test('main: pages, the interface, the popup layer, the page\'s answer and the app-command all go through it', () => {
  assert.ok(main.includes("wc.on('before-mouse-event',(_event,input)=>{if(entry.securedLocked){_event.preventDefault();return;}mouseNav.page(tab.id,wc,input);"), 'pages');
  assert.ok(main.includes("chromeView.webContents.on('before-mouse-event',(_e,mouse)=>{if(mouseNav.ui('interface',mouse,_e))return;"), 'the interface');
  assert.ok(main.includes("overlayView=createUI(kind);overlayView.webContents.on('before-mouse-event',(event,mouse)=>{mouseNav.ui('popup',mouse,event);});"), 'the popup layer');
  assert.ok(main.includes("pageBridge.on('acira:mouse-nav',(event,answer)=>{if(!windowClosing)mouseNav.report(event.sender,answer);});"), 'the page\'s answer, from this window\'s pages only');
  assert.ok(main.includes("function appCommand(_event,command){/* back/forward: one step per click (mouse-nav.cjs) */if(mouseNav.appCommand(command))return;const action={'browser-refresh':'reload','browser-home':'home'}[command];"), 'the app-command');
});

test('the test is registered with npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.testSuites.node.includes('tests/mouse-nav.test.cjs'));
});
