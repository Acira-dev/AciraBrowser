'use strict';
// 13.8: a background Acira came to the front and took the keyboard from the app the person was using (a full test pass: a hidden test Acira was the
// front app for 68 s on a 13.8 candidate). When the tab on screen is shown again (it navigated by itself: a JS redirect, an auto-refresh, an OAuth
// return; an extension opened or chose a tab), main gave it the keyboard with webContents.focus(), and Electron's WebContents::Focus() first
// calls owner_window()->Focus(true) on macOS and Linux (activateIgnoringOtherApps + makeKeyAndOrderFront / widget()->Activate()); on Windows a
// focus request in an inactive widget activates it (FocusManager -> HWNDMessageHandler::Activate -> SetForegroundWindow: a flashing taskbar
// button or a stolen foreground). Chromium never moves the keyboard into a window that is not the active one: it stores the target and
// restores it on activation (BrowserView::OnActiveTabChanged restore_focus_on_activation_, FocusManager::StoreFocusedView/RestoreFocusedView).
// Here: desktop/page-focus.cjs createFocusGate, used by every focusContents() in main.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createFocusGate, createPageFocus} = require('../desktop/page-focus.cjs');

const contents = name => ({name, gone: false, isDestroyed() { return this.gone; }});
function gateWorld({active = false, usable = () => true} = {}) {
  const given = [], env = {active};
  const gate = createFocusGate({active: () => env.active, give: c => given.push(c.name), usable});
  return {gate, given, env};
}

test('while the window is the active one, focus is given at once', () => {
  const w = gateWorld({active: true}), page = contents('page');
  assert.equal(w.gate.request(page), 'now');
  assert.deepEqual(w.given, ['page']);
  assert.equal(w.gate.stored(), null);
});

test('while the window is not the active one, nothing is focused: the target is stored and given on activation, once', () => {
  const w = gateWorld({active: false}), page = contents('page');
  assert.equal(w.gate.request(page), 'stored');
  assert.deepEqual(w.given, [], 'no webContents.focus() while the person is in another app (it would bring Acira to the front)');
  assert.equal(w.gate.stored(), page);
  w.env.active = true;
  assert.equal(w.gate.activated(), page);
  assert.deepEqual(w.given, ['page'], 'the window\'s focus event gives it the keyboard');
  assert.equal(w.gate.activated(), null, 'only once');
  assert.deepEqual(w.given, ['page']);
});

test('the latest request while away wins (Chromium SetStoredFocusView), and a request once active drops the stored one', () => {
  const w = gateWorld({active: false}), page = contents('page'), ui = contents('ui');
  w.gate.request(page);
  w.gate.request(ui);           // the page was hidden while away: the keyboard goes to the interface (main.cjs applyLayout)
  w.env.active = true;
  w.gate.activated();
  assert.deepEqual(w.given, ['ui']);
  const v = gateWorld({active: false});
  v.gate.request(page);
  v.env.active = true;
  v.gate.request(ui);           // the person pressed a shortcut first
  assert.equal(v.gate.activated(), null, 'nothing stored is left to undo it');
  assert.deepEqual(v.given, ['ui']);
});

test('a stored target that went away or is no longer on screen is not given the keyboard on activation', () => {
  const closed = gateWorld({active: false}), page = contents('page');
  closed.gate.request(page);
  page.gone = true;
  closed.env.active = true;
  assert.equal(closed.gate.activated(), null);
  assert.deepEqual(closed.given, []);
  const hidden = gateWorld({active: false, usable: () => false}), card = contents('card');
  hidden.gate.request(card);
  hidden.env.active = true;
  assert.equal(hidden.gate.activated(), null);
  assert.deepEqual(hidden.given, []);
  const dead = gateWorld({active: true}), gone = contents('gone');
  gone.gone = true;
  assert.equal(dead.gate.request(gone), 'gone');
  assert.deepEqual(dead.given, []);
});

test('holder: the stored target, else whoever had the keyboard when the window was left', () => {
  const w = gateWorld({active: true}), page = contents('page'), ui = contents('ui');
  w.gate.focused(ui);                    // the person clicked the address field
  w.env.active = false;                  // and went to another app
  w.gate.focused(page);                  // a focus event while away does not count (only the active window's keyboard moves)
  assert.equal(w.gate.holder(), ui);
  w.gate.request(page);
  assert.equal(w.gate.holder(), page);
  w.env.active = true;
  w.gate.activated();
  assert.equal(w.gate.holder(), page);
});

// ---- presented() while the window is not the active one: the typing-wins rule still holds

function pageWorld({typing, uiFocused = false, holder = 'ui'}) {
  const given = [], probes = [];
  const ui = {name: 'ui', isDestroyed: () => false, isFocused: () => uiFocused,
    async executeJavaScript(source) { probes.push(source); return typing; }};
  const page = {name: 'page', isDestroyed: () => false};
  const gate = createFocusGate({active: () => false, give: c => given.push(c.name)});
  const focus = createPageFocus({window: () => ({isDestroyed: () => false, isFocused: () => false}), chrome: () => ui,
    page: () => ({id: 'tab-2', contents: page, visible: true}), focus: c => gate.request(c),
    windowActive: () => false, holder: () => holder === 'ui' ? ui : holder === 'page' ? page : null});
  return {given, probes, ui, page, gate, focus};
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('away, the person had typed in the address field for this tab: the page shown again does not even store the keyboard', async () => {
  // Windows clears focus on deactivation, so the interface reports no focus while away; it still takes the keyboard back on return.
  const w = pageWorld({typing: true, uiFocused: false, holder: 'ui'});
  w.focus.presented(w.page, 'tab-2');
  await settle();
  assert.equal(w.probes.length, 1, 'asked whether the person is typing for that tab');
  assert.equal(w.gate.stored(), null, 'the address field keeps the keyboard when the person comes back');
  assert.deepEqual(w.given, []);
});

test('away, nothing typed: the page shown again is stored for the return, never focused while away', async () => {
  const idle = pageWorld({typing: false, holder: 'ui'});
  idle.focus.presented(idle.page, 'tab-2');
  await settle();
  assert.equal(idle.gate.stored(), idle.page);
  assert.deepEqual(idle.given, []);
  const pageHeld = pageWorld({typing: true, holder: 'page'});
  pageHeld.focus.presented(pageHeld.page, 'tab-2');
  assert.equal(pageHeld.probes.length, 0, 'the page had the keyboard: nothing to ask');
  assert.equal(pageHeld.gate.stored(), pageHeld.page);
  assert.deepEqual(pageHeld.given, []);
});

// ---- wiring in main

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('main: every focusContents() goes through the gate, which focuses only while this window is the active one', () => {
  const at = main.indexOf('function focusContents(contents){');
  assert.ok(at > 0);
  const body = main.slice(at, main.indexOf('}}', at) + 2);
  assert.equal(body, 'function focusContents(contents){if(contents&&!contents.isDestroyed()){focusedContents=contents;focusGate.request(contents);}}');
  assert.ok(!body.includes('.focus('), 'no direct webContents.focus() left');
  assert.ok(main.includes("const focusGate=require('./page-focus.cjs').createFocusGate({active:()=>Boolean(mainWindow&&!mainWindow.isDestroyed()&&mainWindow.isFocused()),give:contents=>contents.focus(),usable:contents=>visibleContents(contents)||contents===peek.focusTarget()});"));
});

test('main: the window\'s focus event gives the stored target the keyboard first, then the existing activation rules run', () => {
  const handler = main.indexOf("mainWindow.on('focus',()=>{if(!privateMode)nativeThemeOwner=windowId;");
  assert.ok(handler > 0);
  const body = main.slice(handler, main.indexOf('pageFocus.activated();});', handler));
  const auth = body.indexOf('if(authActive){focusContents(chromeView?.webContents);return;}');
  const gate = body.indexOf('focusGate.activated();');
  assert.ok(auth > 0 && gate > auth, 'after the sign-in card\'s own rule');
  assert.ok(gate < body.indexOf('const contents=webContents.getFocusedWebContents?.()||focusedContents;'), 'before the overlay and page-focus checks');
});

test('main: focus events feed the gate, and page focus knows when the window is away and who takes the keyboard back', () => {
  assert.ok(main.includes("function trackFocus(contents){contents.on('focus',()=>{focusGate.focused(contents);"));
  assert.ok(main.includes('focus:focusContents,windowActive:()=>Boolean(mainWindow&&!mainWindow.isDestroyed()&&mainWindow.isFocused()),holder:()=>focusGate.holder()});'));
});

// Found by the real-app check: every tab change brought the window forward. syncPages tells the extension API which tab is current, and
// electron-chrome-extensions answers every change with the host's selectTab callback (ExtensionStore.setActiveTab -> impl.selectTab), the one
// an extension's tabs.update uses: extensionSelect -> showMain -> mainWindow.focus(). Acira's own report is already done, so its answer is
// ignored, as attachExtensionTab already did for pages made off screen. An extension's own tabs.update / tabs.create is not changed here.
test('main: Acira\'s own report of the current tab to the extension API never comes back as a window focus', () => {
  assert.ok(main.includes('selectTab(wc){if(extensionSelectQuiet)return;'), 'the host callback ignores answers while quiet');
  assert.match(main, /active!==lastExtensionTab\)\{lastExtensionTab=active;(?:\/\*[^*]*\*\/)?extensionSelectQuiet=true;try\{extensionManager\?\.selectTab\(active\);\}finally\{extensionSelectQuiet=false;\}\}/, 'syncPages');
  assert.match(main, /if\(pageVisible\(id\)&&id===state\.activeTabId\)\{(?:\/\*[^*]*\*\/)?extensionSelectQuiet=true;try\{extensionManager\.attachTab\(wc,mainWindow\);\}finally\{extensionSelectQuiet=false;\}return;\}/, 'the shown tab\'s attach');
  assert.ok(!/[^?]extensionManager\??\.selectTab\(active\);\}else/.test(main), 'no unguarded report left');
});

test('the test is registered with npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.testSuites.node.includes('tests/no-focus-steal.test.cjs'));
});
