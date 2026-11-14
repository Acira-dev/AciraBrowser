'use strict';
// 13.8, item 10 (Tabrr as the New Tab page: an old page, then white, then a fade, and the floating sidebar gone).
// 13.7 drew the extension's page in a WebContentsView of its own, raised above every other view (above the floating sidebar), reused for the next New Tab
// (the old page showed first) and white until the page painted. Chromium loads the page in the tab's OWN web contents (extension_url_overrides.cc), so
// the tab is an ordinary page: it stacks, parks under a floating sidebar and paints like any page. These tests pin that model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const kit = require('../desktop/browser-services/extension-new-tab.cjs');
const {createInitialState, reduceBrowser} = require('../desktop/runtime.cjs');

const ID = 'a'.repeat(32);
const choice = {extensionId: ID, url: `chrome-extension://${ID}/newtab.html`};
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
const ctxOf = (state, extra = {}) => ({choiceFor: () => choice, privateMode: false, torMode: false, baseline: new Set(state.tabs.map(tab => tab.id)), failed: new Set(), ...extra});
const active = state => state.tabs.find(tab => tab.id === state.activeTabId);

test('there is no separate view any more: the module builds none and main.cjs never wires one', () => {
  assert.equal(kit.createNewTabOverride, undefined, 'the 13.7 view factory is gone');
  assert.equal(kit.overrideBounds, undefined, 'and its bounds helper: a page view is placed by the ordinary page code');
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'browser-services', 'extension-new-tab.cjs'), 'utf8');
  assert.doesNotMatch(source, /new WebContentsView|addChildView|setBounds/);
  assert.doesNotMatch(main, /createNewTabOverride|extensionNewTab\b/);
});

test('a new tab with the override chosen is a page tab on the New Tab address; the window\'s first tab and every other kind keep Acira\'s page', () => {
  const s0 = createInitialState(), ctx = ctxOf(s0);
  const s1 = kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctx);
  const tab = active(s1);
  assert.equal(tab.url, 'acira://new', 'the address the person sees is the New Tab\'s (Chromium\'s virtual address)');
  assert.equal(tab.contentKind, 'web', 'a page view exists for it: it stacks, parks, sleeps and restores like any page');
  assert.equal(kit.isOverridePage(tab), true);
  assert.equal(s1.tabs.filter(item => item.id !== tab.id).every(item => item.contentKind === 'internal'), true, 'tabs of the baseline are untouched');
  // a private tab, a split pane, a private or Tor window and a tab whose page failed all keep Acira's page
  const privateTab = kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new', privacy: 'private'}), ctx);
  assert.equal(active(privateTab).contentKind, 'internal', 'a private tab');
  assert.equal(active(kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctxOf(s0, {privateMode: true}))).contentKind, 'internal', 'a private window (Chrome: never overridden in incognito)');
  assert.equal(active(kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctxOf(s0, {torMode: true}))).contentKind, 'internal', 'a Tor window');
  assert.equal(active(kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctxOf(s0, {choiceFor: () => null}))).contentKind, 'internal', 'no extension chosen');
  const failed = new Set([tab.id]);
  assert.equal(active(kit.normalizeTabs(s1, ctxOf(s0, {failed}))).contentKind, 'internal', 'the page failed to load: Acira\'s own New Tab (Chrome\'s OpenLocalNewTabPage)');
  assert.equal(kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), {...ctx, baseline: null}).tabs.every(item => item.contentKind === 'internal'), true, 'before the window has its baseline nothing is flipped');
});

test('the model follows a New Tab page like Chromium\'s virtual address: the extension page never becomes the address, a website the page goes to does, Back returns to the extension page', () => {
  const s0 = createInitialState(), ctx = ctxOf(s0);
  let state = kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctx);
  const id = state.activeTabId, event = event => { state = kit.normalizeTabs(reduceBrowser(state, {type: 'browser.event', event: {type: 'state', tabId: id, ...event}}), ctx); return active(state); };
  assert.equal(event({url: choice.url, title: 'Tabrr', loading: false}).url, 'acira://new', 'the extension page address is not shown (HandleChromeURLOverrideReverse)');
  assert.equal(active(state).contentKind, 'web');
  assert.equal(event({url: choice.url + '#today'}).url, 'acira://new', 'a fragment of it is still the New Tab');
  const site = event({url: 'https://example.com/', title: 'Example', loading: false});
  assert.equal(site.url, 'https://example.com/', 'a website the page goes to becomes the tab\'s address');
  assert.deepEqual(site.history.slice(-2), ['acira://new', 'https://example.com/']);
  state = kit.normalizeTabs(reduceBrowser(state, {type: 'tab.history', direction: -1}), ctx);
  assert.equal(active(state).url, 'acira://new');
  assert.equal(active(state).contentKind, 'web', 'Back to the New Tab entry is the extension\'s page again, not Acira\'s');
  assert.equal(kit.pageUrlOf(active(state), choice), choice.url, 'and that is the page main loads');
  // Forward from the New Tab entry to the website the tab came from is the tab's own step (the page has nothing ahead of it); on a website, Forward is the page's
  state = kit.normalizeTabs(reduceBrowser(state, {type: 'tab.history', direction: 1}), ctx);
  assert.equal(active(state).url, 'https://example.com/', 'Forward went to the website (13.8: it was refused with "Use Back and Forward on the page itself")');
  assert.equal(state.toast?.text === 'Use Back and Forward on the page itself.', false);
});

test('the choice going away (extension turned off, removed, or the choice cleared) puts Acira\'s own New Tab back in the tabs that showed the page; nothing else changes', () => {
  const s0 = createInitialState();
  let state = kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctxOf(s0));
  const id = state.activeTabId, other = state.tabs.find(tab => tab.id !== id);
  const withPage = state.tabs.find(tab => tab.id === id);
  assert.equal(withPage.contentKind, 'web');
  const gone = kit.normalizeTabs(state, ctxOf(s0, {choiceFor: () => null}));
  const back = gone.tabs.find(tab => tab.id === id);
  assert.equal(back.contentKind, 'internal');
  assert.equal(back.url, 'acira://new');
  assert.equal(back.loading, false);
  assert.equal(back.error, null);
  assert.equal(gone.tabs.find(tab => tab.id === other.id), other, 'another tab is the same object');
  assert.equal(kit.normalizeTabs(gone, ctxOf(s0, {choiceFor: () => null})), gone, 'nothing to do: the very same state comes back');
  assert.equal(kit.normalizeTabs(state, ctxOf(s0)), state, 'the page is already there: the very same state comes back');
});

test('a tab in a split keeps Acira\'s own page (a split pane is Acira\'s page, as in 13.7)', () => {
  const s0 = createInitialState();
  let state = kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctxOf(s0));
  const id = state.activeTabId, other = s0.tabs[0].id;
  state = {...state, windowUi: {...state.windowUi, split: {tabIds: [other, id]}}};
  assert.equal(kit.normalizeTabs(state, ctxOf(s0)).tabs.find(tab => tab.id === id).contentKind, 'internal');
});

test('overrideFor keeps the 13.7 rules and takes only an extension page', () => {
  const tab = {id: 't', url: 'acira://new', contentKind: 'internal', browserProfileId: 'p'};
  assert.deepEqual(kit.overrideFor({tab, choice}), {tabId: 't', profileId: 'p', extensionId: ID, url: choice.url});
  for (const blocked of [{privateMode: true}, {torMode: true}, {split: true}, {setup: true}, {choice: null}, {baseline: new Set(['t'])}]) assert.equal(kit.overrideFor({tab, choice, ...blocked}), null, JSON.stringify([...Object.keys(blocked)]));
  assert.equal(kit.overrideFor({tab: {...tab, url: 'acira://settings'}, choice}), null);
  assert.equal(kit.overrideFor({tab: {...tab, url: 'https://a.test/'}, choice}), null);
  assert.equal(kit.overrideFor({tab: {...tab, privacy: 'private'}, choice}), null);
  assert.equal(kit.overrideFor({tab, choice: {extensionId: ID, url: 'https://evil.test/'}}), null, 'only an extension page');
});

test('pageUrlOf: the extension page for the New Tab page tab, the tab\'s own address for everything else', () => {
  assert.equal(kit.pageUrlOf({contentKind: 'web', url: 'acira://new'}, choice), choice.url);
  assert.equal(kit.pageUrlOf({contentKind: 'web', url: 'https://example.com/'}, choice), 'https://example.com/');
  assert.equal(kit.pageUrlOf({contentKind: 'internal', url: 'acira://new'}, choice), 'acira://new');
  assert.equal(kit.pageUrlOf({contentKind: 'web', url: 'acira://new'}, null), 'acira://new');
});

test('pageTitle: the page\'s own title; a page with no <title> (Chromium gives it its address) leaves the tab\'s title alone', () => {
  assert.equal(kit.pageTitle('Tabrr', choice.url), 'Tabrr');
  assert.equal(kit.pageTitle('', choice.url), '');
  assert.equal(kit.pageTitle(choice.url, choice.url), '');
  assert.equal(kit.pageTitle(`${ID}/newtab.html`, choice.url), '');
  assert.equal(kit.pageTitle('chrome-extension://' + ID + '/other.html', choice.url), '');
});

test('main.cjs: the page address, the load, the sync and the focus all go through the page tab', () => {
  // every reduction runs the rewrite (Chromium does it per navigation, in BrowserURLHandler)
  assert.match(main, /state=reduceBrowser\(state,action\);if\(state!==previous\)state=normalizedNewTabs\(state\)/);
  assert.match(main, /let next=reduceBrowser\(state,\{type:'browser\.event',event\}\);if\(next===state\)return;next=normalizedNewTabs\(next\)/);
  // the page loads the extension's page, and a tab already showing it is not reloaded in a loop
  assert.match(main, /targetURL=pageUrlFor\(tab\)/);
  assert.match(main, /if\(pageNeedsLoad\(tab,entry\)\)void loadPage\(tab,entry\)/);
  assert.match(main, /needsLoad:!!tab&&!!entry&&pageNeedsLoad\(tab,entry\)/);
  assert.match(main, /state\.tabs\.find\(item=>item\.id===tab\.id\)\?\.url!==modelURL\)return;/, 'the check that the tab still wants this load compares the tab\'s own address');
  // the keyboard stays in the address field, as on every New Tab
  // (13.8: the hand-over goes through page-focus, which also leaves the keyboard to a field typed in for that tab: tests/address-typing-wins.test.cjs)
  assert.match(main, /if\(!isNewTabOverride\(id\)\)pageFocus\.presented\(entry\.view\.webContents,id,/);
  assert.match(main, /contentKind!=='web'\|\|isNewTabOverride\(state\.activeTabId\)\)\)focusContents\(chromeView\?\.webContents\)/);
  // the baseline (the window's own first tabs) is taken once pages are allowed; the choice changing re-runs the rewrite in every window
  assert.match(main, /newTabBaseline=new Set\(state\.tabs\.map\(t=>t\.id\)\);.*state=normalizedNewTabs\(state\);pagesAllowed=true/);
  assert.match(main, /c\.renormalizeNewTabs\?\.\(\)/);
  // a hidden New Tab page can be put to sleep like any page (the memory saver called every non-http page "internal" and kept it awake)
  assert.match(main, /if\(!\/\^https\?:\/i\.test\(wc\.getURL\(\)\)&&!isNewTabOverride\(tab\.id\)\)return 'internal'/);
  // an extension's page as a tab: the listener limit is raised before the extensions system attaches (it printed MaxListenersExceededWarning for the New Tab's page)
  assert.match(main, /wc\.setMaxListeners\(32\);[^\n]{0,160}if\(tab\.privacy!=='secured'\)attachExtensionTab\(tab\.id,wc\)/);
  // a page that fails to load falls back to Acira's own New Tab
  assert.match(main, /newTabFailed\.add\(tab\.id\);setImmediate\(renormalizeNewTabs\)/);
});

// The pre-paint colour (Chromium's ContentsWebView::UpdateBackgroundColor): the page's view carries the theme's page colour until the page paints.
test('newTabBackdrop: the view of a New Tab page gets the theme\'s page colour (never white), and a view that leaves it gets the default back', () => {
  const start = main.indexOf('function newTabBackdrop(entry,on,again)');
  assert.ok(start > 0, 'main.cjs has newTabBackdrop');
  const end = main.indexOf('\n', start);
  const body = main.slice(start, end);
  let tokens = {'--surface': '#232427'};
  const newTabBackdrop = new Function('nativeTokens', 'nativeTheme', body + '\nreturn newTabBackdrop;')(() => tokens, {shouldUseDarkColors: true});
  const colours = [], entry = {view: {setBackgroundColor: colour => colours.push(colour)}};
  newTabBackdrop(entry, true);
  newTabBackdrop(entry, true);
  assert.deepEqual(colours, ['#232427'], 'the dark theme\'s page colour, set once');
  tokens = {'--surface': '#ffffff'};
  newTabBackdrop(entry, true);
  assert.deepEqual(colours, ['#232427', '#ffffff'], 'a theme change is followed');
  newTabBackdrop(entry, false);
  assert.deepEqual(colours, ['#232427', '#ffffff', '#ffffff']);
  newTabBackdrop(entry, false);
  assert.equal(colours.length, 3, 'a view that never had it is left alone');
  assert.doesNotThrow(() => newTabBackdrop({view: {setBackgroundColor() { throw new Error('closed'); }}}, true), 'a view that is going away is no error');
});

// A page of the extension that moved inside itself (a fragment, a query, another page of it) is still the New Tab page: the sync, which runs on every
// state change, must not load the extension's page again over it (that would reset a page that routes with its address).
test('pageNeedsLoad: the New Tab page is not loaded again over its own fragment or another page of the same extension; a website or another extension is', () => {
  const start = main.indexOf('function pageNeedsLoad(tab,entry)');
  assert.ok(start > 0);
  const body = main.slice(start, main.indexOf('\n', start));
  const other = 'b'.repeat(32);
  const make = chosen => new Function('pageUrlFor', 'require', body + '\nreturn pageNeedsLoad;')(tab => (tab.contentKind === 'web' && tab.url === 'acira://new' ? chosen : tab.url), () => ({withoutCredentials: url => url}));
  const needs = make(choice.url), page = {contentKind: 'web', url: 'acira://new'};
  assert.equal(needs(page, {loadedURL: choice.url}), false, 'loaded');
  assert.equal(needs(page, {loadedURL: choice.url + '#/today'}), false, 'its own fragment');
  assert.equal(needs(page, {loadedURL: choice.url + '?tab=1'}), false, 'its own query');
  assert.equal(needs(page, {loadedURL: `chrome-extension://${ID}/options.html`}), false, 'another page of the extension');
  assert.equal(needs(page, {loadedURL: null}), true, 'nothing loaded yet');
  assert.equal(needs(page, {loadedURL: 'https://example.com/'}), true, 'Back from a website to the New Tab');
  assert.equal(needs(page, {loadedURL: `chrome-extension://${other}/newtab.html`}), true, 'the choice moved to another extension');
  const site = {contentKind: 'web', url: 'https://example.com/'};
  assert.equal(needs(site, {loadedURL: 'https://example.com/'}), false);
  assert.equal(needs(site, {loadedURL: choice.url}), true, 'a website the tab went to while the page of the extension is still loaded');
});
