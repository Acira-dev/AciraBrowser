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

// ---- Beta 14: the window's own views beside the interface, the pages and the DevTools dock (side panel sites, an extension's side panel, a
// site's question, the password prompt, the screenshot area picker, the zap picker). 13.9's port judged "live and on screen" with visibleContents,
// which knew only the interface, the overlay, the pages and (Beta 14) the DevTools dock: a keyboard in a side panel was moved to the page when the
// person came back. main's shownInWindow counts the contents of any shown view of the window; activationTarget gives a holder that is still on
// screen its keyboard back when the platform's restore found nothing.

test('Beta 14: a side panel that held the keyboard keeps it on return (the platform restored it, or found nothing)', () => {
  const ui = contents('ui'), page = contents('page'), panel = contents('side panel site'), frame = contents('side panel card');
  const onScreen = new Set([ui, page, panel, frame]), usable = c => onScreen.has(c);
  assert.equal(target({focused: panel, usable, ui, page, held: panel}), null, 'restored to the side panel: it stays there');
  assert.equal(target({focused: frame, usable, ui, page, held: page}), null, 'restored to the card\'s header: it stays there');
  assert.equal(target({focused: null, usable, ui, page, held: panel}), panel, 'the restore found nothing: back to the side panel, not the page');
  onScreen.delete(panel);
  assert.equal(target({focused: null, usable, ui, page, held: panel}), page, 'the panel closed while away: the page on screen');
  const devtools = contents('devtools'); onScreen.add(devtools);
  assert.equal(target({focused: null, usable, ui, page, held: devtools}), devtools, 'the DevTools dock the same way');
  const preview = contents('preview');
  assert.equal(target({focused: null, usable, ui, page, preview, held: devtools}), preview, 'an open Link preview still comes first');
  assert.equal(target({focused: null, usable, ui, page, held: ui}), ui, 'the interface as before (typing wins)');
});

// main's own functions, rebuilt from its source with stand-ins for the window (the shape tests/check-active-page-dead-view.test.cjs uses)
const oneLine = name => { const at = main.indexOf(`function ${name}(`); assert.ok(at >= 0, `${name} is in main.cjs`); return main.slice(at, main.indexOf('\n', at)); };
function stage({overlayOpen = false} = {}) {
  const wc = (name, url = '') => ({name, gone: false, isDestroyed() { return this.gone; }, getURL: () => url});
  const view = (contents, {visible = true, box = {x: 0, y: 0, width: 400, height: 600}} = {}) => ({webContents: contents, visible, box, getVisible() { return this.visible; }, getBounds() { return this.box; }});
  const ui = wc('ui'), overlay = wc('overlay'), page = wc('page'), hiddenPage = wc('hidden page');
  const panelPage = wc('side panel site'), panelFrame = wc('side panel card', 'file:///x/side-panel-sites-frame.html');
  const extPage = wc('extension side panel', 'chrome-extension://abc/panel.html'), extFrame = wc('extension card', 'file:///x/side-panel-frame.html');
  const prompt = wc('site question'), devtools = wc('devtools'), stray = wc('not in this window');
  const views = {ui: view(ui), overlay: view(overlay, {box: {x: 0, y: 0, width: 0, height: 0}}), page: view(page), hiddenPage: view(hiddenPage, {visible: false}),
    panelPage: view(panelPage), panelFrame: view(panelFrame), extPage: view(extPage), extFrame: view(extFrame), prompt: view(prompt), devtools: view(devtools)};
  const entries = new Map([['a', {view: views.page}], ['b', {view: views.hiddenPage}]]);
  let focusedNow = null;
  const env = {
    chromeView: {webContents: ui}, overlayView: {webContents: overlay}, layout: {overlay: overlayOpen ? {kind: 'menu'} : null}, materialHosts: new Map(),
    pages: entries, state: {activeTabId: 'a'}, peek: {focusTarget: () => null}, focusGate: {holder: () => env.heldNow},
    devtoolsDock: {visibleContents: c => c === devtools && views.devtools.visible, ownerOf: c => (c === devtools ? 'a' : undefined)},
    mainWindow: {isDestroyed: () => false, contentView: {children: Object.values(views)}},
    webContents: {getFocusedWebContents: () => focusedNow}, require: id => (id === './page-focus.cjs' ? pageFocusModule : require(id)),
    focusedContents: null, heldNow: null,
  };
  const names = ['visibleContents', 'shownInWindow', 'activationFallback'];
  const source = names.map(oneLine).join('\n');
  const keys = Object.keys(env).filter(k => k !== 'heldNow' && k !== 'focusedContents');
  const make = new Function('env', ...keys, `let focusedContents=null;${source}\nreturn {visibleContents, shownInWindow, activationFallback, focused: () => focusedContents};`);
  const fns = make(env, ...keys.map(k => env[k]));
  return {...fns, env, views, wcs: {ui, overlay, page, hiddenPage, panelPage, panelFrame, extPage, extFrame, prompt, devtools, stray}, focus: c => { focusedNow = c; }, hold: c => { env.heldNow = c; }};
}

test('main: a shown view of the window counts as live and on screen (side panel sites, an extension\'s side panel, both cards, a site\'s question)', () => {
  const s = stage();
  for (const name of ['panelPage', 'panelFrame', 'extPage', 'extFrame', 'prompt']) assert.equal(s.visibleContents(s.wcs[name]), true, name);
  assert.equal(s.visibleContents(s.wcs.ui), true, 'the interface as before');
  assert.equal(s.visibleContents(s.wcs.page), true, 'the page on screen as before');
  assert.equal(s.visibleContents(s.wcs.hiddenPage), false, 'a page no longer on screen as before');
  assert.equal(s.visibleContents(s.wcs.stray), false, 'a web contents with no view in this window');
  s.views.panelPage.visible = false; assert.equal(s.visibleContents(s.wcs.panelPage), false, 'a side panel that closed (its view hidden)');
  s.views.extFrame.box = {x: 0, y: 0, width: 0, height: 0}; assert.equal(s.visibleContents(s.wcs.extFrame), false, 'an empty view is not on screen');
  s.wcs.prompt.gone = true; assert.equal(s.visibleContents(s.wcs.prompt), false, 'destroyed contents');
});

test('main: the overlay and the DevTools dock keep their own rules (no popup open = not on screen, whatever its view says)', () => {
  const s = stage();
  s.views.overlay.box = {x: 0, y: 0, width: 800, height: 600};
  assert.equal(s.visibleContents(s.wcs.overlay), false, 'the overlay with no popup open');
  const open = stage({overlayOpen: true});
  assert.equal(open.visibleContents(open.wcs.overlay), true, 'an open popup');
  s.views.devtools.visible = true; s.env.devtoolsDock.visibleContents = () => false;
  assert.equal(s.shownInWindow(s.wcs.devtools), false, 'the dock decides for its own contents');
});

test('main: coming back with the keyboard in a side panel leaves it there; with the restore finding nothing it goes back to the panel', () => {
  for (const name of ['panelPage', 'panelFrame', 'extPage', 'extFrame', 'prompt']) {
    const s = stage(); s.focus(s.wcs[name]); s.hold(s.wcs.page);
    assert.equal(s.activationFallback(), null, `${name}: restored there by the platform, nothing moves`);
  }
  const s = stage(); s.focus(null); s.hold(s.wcs.panelPage);
  assert.equal(s.activationFallback(), s.wcs.panelPage, 'the restore found nothing: the side panel site that held it');
  assert.equal(s.focused(), s.wcs.panelPage);
  s.views.panelPage.visible = false;
  assert.equal(s.activationFallback(), s.wcs.page, 'the panel closed while away: the page on screen');
  const t = stage(); t.focus(t.wcs.hiddenPage); t.hold(t.wcs.hiddenPage);
  assert.equal(t.activationFallback(), t.wcs.page, '13.9\'s case unchanged: a page no longer on screen gives way to the one on screen');
  const u = stage(); u.focus(null); u.hold(null);
  assert.equal(u.activationFallback(), u.wcs.page, 'nothing held it: the page on screen');
});

test('main: a page entry whose view has no contents left is no page for the fallback (no TypeError inside the focus event)', () => {
  const s = stage(); s.env.pages.get('a').view = {webContents: undefined, getVisible: () => true, getBounds: () => ({width: 10, height: 10})};
  s.env.mainWindow.contentView.children.push(s.env.pages.get('a').view);
  s.focus(null); s.hold(null);
  assert.doesNotThrow(() => s.activationFallback());
  assert.equal(s.activationFallback(), s.wcs.ui, 'no page on screen: the interface');
});

test('Beta 14: restoreVisibleFocus and page focus\'s page() treat a page whose view has no contents left as no page (no TypeError on the focus path)', () => {
  // the shape 29d27bbed fixed in checkActivePage: a view whose contents are gone has no webContents at all
  const ui = contents('ui'), page = contents('page');
  const run = view => {
    const given = [];
    const env = {peek: {focusTarget: () => null}, pages: new Map([['a', {view}]]), state: {activeTabId: 'a'}, focusContents: c => given.push(c), chromeView: {webContents: ui}};
    const fn = new Function(...Object.keys(env), `${oneLine('restoreVisibleFocus')}\nreturn restoreVisibleFocus;`)(...Object.values(env));
    fn();
    return given;
  };
  assert.deepEqual(run({webContents: undefined, getVisible: () => true}), [ui], 'no contents: the interface takes the keyboard, nothing throws');
  assert.deepEqual(run({webContents: page, getVisible: () => true}), [page], 'a live page on screen: the page, as before');
  assert.deepEqual(run({webContents: page, getVisible: () => false}), [ui], 'a page not on screen: the interface, as before');
  const at = main.indexOf('page:()=>{const entry=pages.get(state.activeTabId);'), close = 'visible:entry.view.getVisible()};}';
  assert.ok(at > 0, 'page focus\'s page() is in main.cjs');
  const pageOf = view => new Function('pages', 'state', `return ${main.slice(at + 'page:'.length, main.indexOf(close, at) + close.length)};`)(new Map([['a', {view}]]), {activeTabId: 'a'})();
  assert.equal(pageOf({webContents: undefined, getVisible: () => true}), null, 'no contents: no page (page-focus.cjs leaves the keyboard alone)');
  assert.deepEqual(pageOf({webContents: page, getVisible: () => true}), {id: 'a', contents: page, visible: true}, 'a live page as before');
});

test('the test is registered with npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.testSuites.node.includes('tests/focus-return.test.cjs'));
});
