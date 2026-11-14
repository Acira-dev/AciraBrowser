'use strict';
// 13.8 laptop check 14 (Windows 11): with another app in front, 30 s of Acira chaos (reload, location.replace and assign, a 302, a meta
// refresh, a blocked window.open, 3-4 new tabs, a page calling window.focus() every second); then Acira brought back with SetForegroundWindow
// (what Alt+Tab does): 0 of 3 keys reached the page, 3 of 3 runs. 13.7 fails the same way: the platform restores, on activation, the view that
// held the keyboard when the window was left (FocusManager::RestoreFocusedView), and a view that is no longer drawn cannot take it. The focus
// gate (13.8) gave a stored request only if it could still take the keyboard, and nothing else gave it: the keyboard stayed nowhere.
// Chromium falls back to the contents' own initial focus (BrowserView::RestoreFocus -> WebContents::RestoreFocus / SetInitialFocus).
// Here: desktop/page-focus.cjs activationTarget, given by the gate's activated(fallback) inside the window's 'focus' event.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pageFocusModule = require('../desktop/page-focus.cjs');
const {createFocusGate, createPageFocus} = pageFocusModule;

const contents = name => ({name, gone: false, isDestroyed() { return this.gone; }});
const target = env => {
  assert.equal(typeof pageFocusModule.activationTarget, 'function', 'page-focus.cjs exports activationTarget');
  return pageFocusModule.activationTarget(env);
};

test('nothing holds the keyboard after the platform\'s restore: the page on screen takes it', () => {
  const ui = contents('ui'), page = contents('page');
  assert.equal(target({focused: null, ui, page, held: null}), page);
  const hidden = contents('hidden page');   // restored to the page of a tab that is no longer on screen
  assert.equal(target({focused: hidden, usable: c => c !== hidden, ui, page, held: hidden}), page);
  const closed = contents('closed'); closed.gone = true;
  assert.equal(target({focused: closed, ui, page}), page, 'a restored view whose contents are gone holds nothing');
});

test('the platform\'s restore landed somewhere live and on screen: it stays (no second move)', () => {
  const ui = contents('ui'), page = contents('page');
  assert.equal(target({focused: ui, usable: () => true, ui, page}), null, 'the interface (the person left from the address field)');
  assert.equal(target({focused: page, usable: () => true, ui, page}), null);
});

test('who else takes it first: an open Link preview, an open menu, the interface the person left from (typing wins), else the page, else the interface', () => {
  const ui = contents('ui'), page = contents('page'), preview = contents('preview'), popup = contents('popup');
  assert.equal(target({ui, page, preview, popup, held: ui}), preview);
  assert.equal(target({ui, page, popup, held: ui}), popup);
  assert.equal(target({ui, page, held: ui}), ui, 'left while typing in the address field: the field keeps its text, caret and the keyboard');
  assert.equal(target({ui, page, held: page}), page);
  assert.equal(target({ui, page: null, held: null}), ui, 'no web page on screen (an Acira page, a locked workspace): the interface');
  const gone = contents('page'); gone.gone = true;
  assert.equal(target({ui, page: gone}), ui);
  assert.equal(target({}), null, 'nothing at all: nothing to give');
});

test('the gate on activation: a stored request that can no longer take the keyboard hands over to the fallback', () => {
  const given = [];
  let active = false;
  const page = contents('page'), newTab = contents('new tab ui');
  const gate = createFocusGate({active: () => active, give: c => given.push(c.name), usable: c => c !== newTab});
  gate.request(newTab);                    // the latest request while away went to a place that is not on screen any more
  active = true;
  const asked = [];
  const got = gate.activated(() => { asked.push('fallback'); return page; });
  assert.equal(got, page);
  assert.deepEqual(given, ['page'], 'the keyboard is never left nowhere');
  assert.deepEqual(asked, ['fallback']);
  // a usable stored request is given as before, and the fallback is not even asked
  const g2 = [], gate2 = createFocusGate({active: () => active, give: c => g2.push(c.name)});
  active = false; gate2.request(page); active = true;
  assert.equal(gate2.activated(() => { throw new Error('not asked'); }), page);
  assert.deepEqual(g2, ['page']);
  // nothing stored: the fallback decides; a fallback with nothing to give gives nothing
  const g3 = [], gate3 = createFocusGate({active: () => true, give: c => g3.push(c.name)});
  assert.equal(gate3.activated(() => page), page);
  assert.equal(gate3.activated(() => null), null);
  assert.deepEqual(g3, ['page']);
  assert.equal(gate3.activated(), null, 'no fallback: as before');
});

test('chaos while away, then Alt+Tab back: the page on screen gets the keyboard (laptop check 14, modelled)', async () => {
  // The interface, tab A's page (the chaos page), New Tabs that came and went; Acira is in the background throughout.
  const ui = contents('ui'), pageA = contents('page A');
  let active = true, shown = {id: 'a', contents: pageA, visible: true};
  const onScreen = new Set([ui, pageA]);
  const given = [];
  const gate = createFocusGate({active: () => active, give: c => given.push(c.name), usable: c => onScreen.has(c)});
  const focus = createPageFocus({window: () => ({isDestroyed: () => false, isFocused: () => active}), chrome: () => ({...ui, isFocused: () => false, async executeJavaScript() { return false; }}),
    page: () => shown, focus: c => gate.request(c), windowActive: () => active, holder: () => gate.holder()});
  gate.request(pageA);                                   // the person was on the page
  gate.focused(pageA);
  active = false;                                        // another app in front
  given.length = 0;
  // 3 new tabs: each shows a New Tab (the interface's address field asks for the keyboard), each then closed by the page or a script
  for (let i = 0; i < 3; i++) {
    const tab = contents('new tab ' + i); onScreen.add(tab); shown = {id: 'n' + i, contents: tab, visible: true};
    focus.presented(tab, 'n' + i); gate.request(ui);
    await new Promise(r => setImmediate(r));
    onScreen.delete(tab); tab.gone = true;               // closed while away
  }
  // reloads, redirects and a meta refresh keep page A's contents; it is shown again, and the last stored request is a tab that closed
  shown = {id: 'a', contents: pageA, visible: true};
  const stale = contents('closed tab'); gate.request(stale); stale.gone = true;
  assert.deepEqual(given, [], 'nothing moved the keyboard while away (no focus steal)');
  active = true;                                         // SetForegroundWindow
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.ok(main.includes('focusGate.activated(activationFallback);'), 'main hands the fallback to the gate');
  gate.activated(() => target({focused: null, usable: c => onScreen.has(c), ui, page: pageA, held: gate.holder()}));
  assert.deepEqual(given, ['page A'], 'the page on screen has the keyboard: the three keys reach it');
});

test('typing wins on return: left while typing in the address field, the interface takes the keyboard back, not the page', () => {
  const ui = contents('ui'), page = contents('page'), given = [];
  let active = true;
  const gate = createFocusGate({active: () => active, give: c => given.push(c.name), usable: () => true});
  gate.focused(ui);                                      // typing in the address field
  active = false;                                        // another app in front; nothing asked while away
  active = true;
  gate.activated(() => target({focused: null, ui, page, held: gate.holder()}));
  assert.deepEqual(given, ['ui']);
});

// ---- wiring in main

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('main: the window\'s focus event gives the fallback inside the same step, after the sign-in card\'s rule and before the existing checks', () => {
  const at = main.indexOf("mainWindow.on('focus',()=>{if(!privateMode)nativeThemeOwner=windowId;");
  assert.ok(at > 0);
  const body = main.slice(at, main.indexOf('pageFocus.activated();});', at));
  const auth = body.indexOf('if(authActive){focusContents(chromeView?.webContents);return;}'), gate = body.indexOf('focusGate.activated(activationFallback);');
  assert.ok(auth > 0 && gate > auth, 'the sign-in card keeps its own rule');
  assert.ok(gate < body.indexOf('const contents=webContents.getFocusedWebContents?.()||focusedContents;'));
  assert.ok(!/setTimeout|setImmediate|queueMicrotask|then\(/.test(body.slice(gate, gate + 60)), 'synchronous: a click that came with the activation lands after it and wins');
});

test('main: once more when the activation has settled, only if nothing live and on screen holds the keyboard (never a clicked field)', () => {
  const at = main.indexOf('pageFocus.activated();/* and once more when the activation has settled');
  assert.ok(at > 0, 'a settled re-check follows the activation rules');
  const body = main.slice(at, main.indexOf('},0);});', at) + 8);
  assert.ok(body.includes('if(!mainWindow||mainWindow.isDestroyed()||!mainWindow.isFocused()||authActive)return;const target=activationFallback();if(target)focusGate.request(target);'));
  // activationFallback returns null whenever a live, on-screen contents holds the keyboard (a field clicked with the activation does)
  const ui = contents('ui'), page = contents('page');
  assert.equal(target({focused: ui, usable: () => true, ui, page, held: page}), null);
});

test('main: the fallback reads what holds the keyboard now and offers the preview, an open menu, the interface the person left from, the page on screen', () => {
  const at = main.indexOf('function activationFallback(){');
  assert.ok(at > 0, 'activationFallback exists');
  const body = main.slice(at, main.indexOf('return target;}', at) + 15);
  for (const part of ['focused:webContents.getFocusedWebContents?.()||null', 'usable:contents=>visibleContents(contents)||contents===peek.focusTarget()', 'preview:peek.focusTarget()||null', 'held:focusGate.holder()', 'ui:chromeView?.webContents||null', 'entry.view.getVisible()', '!entry.securedLocked', "!['toast','zoom','group-preview'].includes(layout.overlay.kind)", 'if(target)focusedContents=target;'])
    assert.ok(body.includes(part), part);
});

test('the test is registered with npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.testSuites.node.includes('tests/focus-return.test.cjs'));
});
