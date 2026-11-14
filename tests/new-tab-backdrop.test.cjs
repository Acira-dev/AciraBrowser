'use strict';
// 13.8, the Windows laptop's hand check on a packaged 13.8 candidate (Windows 11, dark): Tabrr as the New Tab page showed a WHITE frame at 9 of 9 new tabs, from 141-203 ms after the press for 229-445 ms.
// Chromium paints the theme's New Tab colour into the view until the page's first frame, and paints it AGAIN for every new render view (ContentsWebView::RenderViewReady -> UpdateBackgroundColor,
// chrome/browser/ui/views/frame/contents_web_view.cc), because that colour belongs to the view the page is painted into. In Acira the extension's page is its own site: loading it swaps the tab's
// frame for a new one, with a new view whose background is Electron's default white until a frame arrives (shell/browser/api/electron_api_web_contents.cc: HandleNewRenderFrame applies the colour to
// the PRIMARY frame's view when a frame is created, and a speculative one is created before it is primary; WebContentsView::SetBackgroundColor keeps the colour in the web preferences). The colour set
// when the tab was made went to the old view. Now it is set again when the page's own frame commits (did-navigate: the new frame is the primary one, nothing has been drawn), and a theme change sets it on
// every open New Tab page. No Electron starts here: main.cjs's own functions run on stand-ins.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const kit = require('../desktop/browser-services/extension-new-tab.cjs');

const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const ID = 'a'.repeat(32), PAGE = `chrome-extension://${ID}/newtab.html`;

/** main.cjs's own backdrop functions, run against stand-ins for the tabs, the theme and the pages. */
function rig({surface = '#1e1f22', tone = 'dark', systemDark = true} = {}) {
  const start = main.indexOf('function newTabBackdrop(');
  assert.ok(start > 0, 'newTabBackdrop is where this test expects it');
  const end = main.indexOf('\nconst openedViews=', start);
  assert.ok(end > start, 'and the code after it is where this test expects it');
  const world = {
    tokens: {'--surface': surface, '--surface-tone': tone},
    state: {tabs: [{id: 't1', url: 'acira://new', contentKind: 'web'}, {id: 'site', url: 'https://example.com/', contentKind: 'web'}, {id: 'own', url: 'acira://new', contentKind: 'internal'}]},
    pages: new Map(), systemDark,
  };
  const sandbox = {
    nativeTokens: () => world.tokens,
    nativeTheme: {get shouldUseDarkColors() { return world.systemDark; }},
    get pages() { return world.pages; },
    get state() { return world.state; },
    newTabKit: kit,
    pageUrlFor: tab => kit.pageUrlOf(tab, kit.isOverridePage(tab) ? {extensionId: ID, url: PAGE} : null),
    isNewTabOverride: id => kit.isOverridePage(world.state.tabs.find(tab => tab.id === id)),
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(main.slice(start, end) + '\nthis.api = {newTabBackdrop, newTabColour, newTabBackdropAt, refreshNewTabBackdrops};', sandbox);
  const view = id => { const calls = [], entry = {view: {setBackgroundColor: colour => calls.push(colour)}}; world.pages.set(id, entry); return {entry, calls}; };
  return {api: sandbox.api, world, view};
}

test('newTabColour: the theme\'s page colour when it is an opaque hex; a translucent or unparseable token never reaches the view (a view takes no half colour), the dark or light default does', () => {
  assert.equal(rig({surface: '#1e1f22'}).api.newTabColour(), '#1e1f22');
  assert.equal(rig({surface: '#FFFFFF', tone: 'light', systemDark: false}).api.newTabColour(), '#FFFFFF');
  assert.equal(rig({surface: 'rgba(30, 31, 34, 0.7)', tone: 'dark'}).api.newTabColour(), '#1e1f22', 'translucent: dark default');
  assert.equal(rig({surface: 'color-mix(in srgb, red, blue)', tone: 'light', systemDark: false}).api.newTabColour(), '#ffffff', 'a token Electron cannot parse: light default');
  assert.equal(rig({surface: undefined, tone: undefined, systemDark: true}).api.newTabColour(), '#1e1f22', 'no token at all: the system theme decides');
  assert.equal(rig({surface: '#fff'}).api.newTabColour(), '#1e1f22', 'a three-digit hex is not taken (only the six-digit form is known to be opaque and parsed)');
});

test('newTabBackdrop: set once for a colour, set AGAIN when asked (the view is a new one), taken away only when it was set', () => {
  const r = rig(), a = r.view('t1');
  r.api.newTabBackdrop(a.entry, true);
  r.api.newTabBackdrop(a.entry, true);
  assert.deepEqual(a.calls, ['#1e1f22'], 'the same colour is not sent twice');
  r.api.newTabBackdrop(a.entry, true, true);
  assert.deepEqual(a.calls, ['#1e1f22', '#1e1f22'], 'again: the new view of a committed page gets it');
  r.api.newTabBackdrop(a.entry, false);
  assert.deepEqual(a.calls, ['#1e1f22', '#1e1f22', '#ffffff'], 'a view that left the New Tab gets the plain default back');
  r.api.newTabBackdrop(a.entry, false);
  assert.equal(a.calls.length, 3, 'and only once');
  const plain = r.view('site');
  r.api.newTabBackdrop(plain.entry, false);
  assert.deepEqual(plain.calls, [], 'a website view that never had the colour is left alone');
});

test('the page commits (13.8 before: the colour set at the tab\'s making had gone to the old view, so the new one drew Electron\'s white): did-navigate on the extension\'s page sets it again, before any frame', () => {
  const r = rig(), v = r.view('t1');
  const wc = new EventEmitter();
  // ensurePage's own wiring, as main.cjs writes it, on a stand-in web contents
  const wiring = main.slice(main.indexOf("wc.on('did-start-navigation',details=>{if(details.isMainFrame&&!details.isSameDocument)newTabBackdropAt("), main.indexOf("wc.on('dom-ready',()=>newTabBackdropAt(entry,tab.id,wc.getURL()));") + "wc.on('dom-ready',()=>newTabBackdropAt(entry,tab.id,wc.getURL()));".length);
  assert.ok(wiring.includes("did-navigate") && wiring.includes("dom-ready"), 'the handlers are where this test expects them');
  const sandbox = {wc, entry: v.entry, tab: {id: 't1'}, newTabBackdropAt: (...args) => r.api.newTabBackdropAt(...args)};
  wc.getURL = () => PAGE;
  vm.createContext(sandbox);
  vm.runInContext(wiring, sandbox);
  // loadPage: the colour goes to the view the tab was made with
  r.api.newTabBackdrop(v.entry, true);
  assert.equal(v.calls.length, 1);
  // the page's navigation starts (the new frame is only speculative), commits (it is the primary one now), and its DOM is ready
  wc.emit('did-start-navigation', {isMainFrame: true, isSameDocument: false, url: PAGE});
  assert.equal(v.calls.length, 2, 'at the start: again');
  wc.emit('did-navigate', {}, PAGE);
  assert.equal(v.calls.length, 3, 'at the commit: again, on the view the page is drawn into');
  wc.emit('dom-ready');
  assert.equal(v.calls.length, 4, 'and once the document is ready (a net for a view that was made late)');
  assert.deepEqual([...new Set(v.calls)], ['#1e1f22']);
  wc.emit('did-start-navigation', {isMainFrame: false, isSameDocument: false, url: PAGE});
  wc.emit('did-start-navigation', {isMainFrame: true, isSameDocument: true, url: PAGE + '#x'});
  assert.equal(v.calls.length, 4, 'a frame of the page, or a move inside the document, is not a new view');
});

test('a link the page followed to a website takes the colour off (it must not tint a site that has no background of its own); another extension\'s page or an address that does not parse is not the page', () => {
  const r = rig(), v = r.view('t1');
  r.api.newTabBackdrop(v.entry, true);
  r.api.newTabBackdropAt(v.entry, 't1', 'https://example.com/');
  assert.equal(v.calls.at(-1), '#ffffff', 'a website: the default back');
  r.api.newTabBackdrop(v.entry, true);
  r.api.newTabBackdropAt(v.entry, 't1', `chrome-extension://${'b'.repeat(32)}/other.html`);
  assert.equal(v.calls.at(-1), '#ffffff', 'another extension');
  r.api.newTabBackdrop(v.entry, true);
  r.api.newTabBackdropAt(v.entry, 't1', 'not a url');
  assert.equal(v.calls.at(-1), '#ffffff');
  r.api.newTabBackdrop(v.entry, true);
  r.api.newTabBackdropAt(v.entry, 't1', `${PAGE}#/tab/2`);
  assert.equal(v.calls.at(-1), '#1e1f22', 'a fragment or another page of the same extension is still the New Tab page');
});

test('a tab that is not a New Tab page (the model already says website, a tab that is gone, Acira\'s own page) never gets the colour', () => {
  const r = rig(), site = r.view('site'), gone = r.view('gone');
  r.api.newTabBackdropAt(site.entry, 'site', PAGE);
  r.api.newTabBackdropAt(gone.entry, 'gone', PAGE);
  assert.deepEqual([site.calls, gone.calls], [[], []]);
  site.entry.backdrop = '#1e1f22';
  r.api.newTabBackdropAt(site.entry, 'site', PAGE);
  assert.deepEqual(site.calls, ['#ffffff'], 'one that still carried it is cleaned');
});

test('theme change (Chromium: ContentsWebView::OnThemeChanged): every open New Tab page takes the new colour, other pages are left alone, an unchanged colour sends nothing', () => {
  const r = rig(), a = r.view('t1'), b = r.view('site');
  r.api.newTabBackdrop(a.entry, true);
  r.api.refreshNewTabBackdrops();
  assert.deepEqual(a.calls, ['#1e1f22'], 'unchanged: nothing more');
  r.world.tokens = {'--surface': '#ffffff', '--surface-tone': 'light'};
  r.api.refreshNewTabBackdrops();
  assert.deepEqual(a.calls, ['#1e1f22', '#ffffff']);
  assert.deepEqual(b.calls, [], 'a website page is not touched');
});

test('main.cjs: the handlers are on every page view (they only act on a New Tab page), the theme update refreshes the open ones, and the load still sets it first', () => {
  assert.match(main, /wc\.setMaxListeners\(32\);\/\* 13\.8: the New Tab page's colour again on the new view its commit makes \(newTabBackdropAt\) \*\/wc\.on\('did-start-navigation',details=>\{if\(details\.isMainFrame&&!details\.isSameDocument\)newTabBackdropAt\(entry,tab\.id,details\.url\);\}\);wc\.on\('did-navigate',\(_event,url\)=>newTabBackdropAt\(entry,tab\.id,url\)\);/);
  assert.match(main, /markWindowMaterial\(\);\n  refreshNewTabBackdrops\(\);[^\n]*\n  recordPreviewBuild\('native-material'/);
  assert.match(main, /entry\.loadedURL=targetURL;newTabBackdrop\(entry,targetURL!==modelURL\);/);
});
