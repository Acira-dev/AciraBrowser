'use strict';
// 13.8, a hand test: "sometimes when Electron is not in focus, Tabrr glitches when hovering on the sidebar" (Mac, a 13.8 test build). CODE ONLY, not reproduced.
// Nothing in main reacts to a hover on the sidebar by touching a page (the poller does not look at an unfocused window; the hover card and the sidebar rows are the
// interface's own). What 13.8 did change is that the New Tab's extension page became an ordinary page of the tab, and two things written for websites started to act on it:
//  - the SITE COLOUR: every few seconds after a load and on every in-page navigation it captured the page's top 24 px (capturePage) and read its theme-color and icon, and
//    published a colour that tints the sidebar and the row. An animated dashboard (Tabrr) gave it a colour to follow, a capture of an unfocused, partly covered window can come
//    back empty (the colour then goes away and comes back): the sidebar's tint and the page's own pixels were being touched. Acira's own New Tab never has a colour, and an
//    extension filling the New Tab is a start page, not a website.
//  - the TAB MODEL: the page's title, loading and progress events, and the address it reports (never shown), each became a state change that re-renders the whole interface
//    (the sidebar under a resting pointer, the extension buttons, which clear their target when loading flips). Acira's own New Tab never produced any.
// No Electron starts here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const kit = require('../desktop/browser-services/extension-new-tab.cjs');
const {createInitialState, reduceBrowser} = require('../desktop/runtime.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'desktop', 'main.cjs'), 'utf8');
const ID = 'a'.repeat(32), choice = {extensionId: ID, url: `chrome-extension://${ID}/newtab.html`};

function newTabState() {
  const s0 = createInitialState();
  const ctx = {choiceFor: () => choice, privateMode: false, torMode: false, baseline: new Set(s0.tabs.map(tab => tab.id)), failed: new Set()};
  const state = kit.normalizeTabs(reduceBrowser(s0, {type: 'tab.new'}), ctx);
  return {state, ctx, tab: state.tabs.find(tab => tab.id === state.activeTabId)};
}

test('quietPatch: the pageState of a New Tab page that loads says nothing new (title, loading, progress, its own address, the restore flag)', () => {
  const {tab} = newTabState();
  assert.equal(kit.isOverridePage(tab), true);
  const loading = {url: choice.url, title: 'Tabrr Dashboard', loading: true, canGoBack: false, canGoForward: false, zoom: tab.zoom, restored: true, error: null};
  assert.equal(kit.quietPatch(tab, {...loading, error: tab.error}), null, 'everything of it is either not shown or what the tab already says');
  assert.equal(kit.quietPatch(tab, {title: 'Tabrr', loading: false}), null);
  assert.equal(kit.quietPatch(tab, {progress: 0.4, loading: true}), null);
  assert.equal(kit.quietPatch(tab, {favicon: 'data:image/png;base64,AAAA'}), null, 'the row keeps Acira\'s New Tab logo');
});

test('quietPatch: what the tab really shows still passes', () => {
  const {tab} = newTabState();
  assert.deepEqual(kit.quietPatch(tab, {title: 'x', loading: true, canGoBack: true}), {canGoBack: true}, 'the page\'s own Back');
  assert.deepEqual(kit.quietPatch(tab, {zoom: 125, url: choice.url}), {zoom: 125});
  assert.deepEqual(kit.quietPatch(tab, {audible: true}), {audible: true});
  assert.deepEqual(kit.quietPatch(tab, {error: 'The page stopped responding: crashed', loading: false}), {error: 'The page stopped responding: crashed'});
  assert.deepEqual(kit.quietPatch(tab, {capturing: ['camera']}), {capturing: ['camera']});
});

test('quietPatch: the page going to a website passes whole (the tab is no longer the New Tab); another kind of tab is untouched', () => {
  const {tab} = newTabState();
  const toSite = {url: 'https://example.com/', title: 'Example', loading: true};
  assert.equal(kit.quietPatch(tab, toSite), toSite, 'the same object back');
  const website = {...tab, url: 'https://example.com/', contentKind: 'web'}, same = {title: 'Example', loading: true};
  assert.equal(kit.quietPatch(website, same), same, 'a website tab: nothing is filtered');
  const internal = {...tab, contentKind: 'internal'};
  assert.equal(kit.quietPatch(internal, same), same);
  assert.equal(kit.quietPatch(undefined, same), same, 'a tab that is gone');
});

test('quietPatch: a colour is never taken; one the tab still carries goes away', () => {
  const {tab} = newTabState();
  assert.equal(kit.quietPatch(tab, {siteColor: '#3366ff'}), null);
  assert.equal(kit.quietPatch(tab, {siteColor: null}), null, 'nothing to take away');
  assert.deepEqual(kit.quietPatch({...tab, siteColor: '#3366ff'}, {siteColor: null}), {siteColor: null});
});

test('the model stays the very same state through a New Tab page\'s whole load and its later title changes (13.8 before: a new state, a render of the interface, for each)', () => {
  const {state, ctx, tab} = newTabState();
  const stream = [
    {url: choice.url, title: 'chrome-extension', loading: true, canGoBack: false, canGoForward: false, zoom: tab.zoom, error: null},
    {loading: true, progress: 0.35}, {loading: true, progress: 0.7}, {url: choice.url, title: 'Tabrr Dashboard', loading: true},
    {url: choice.url, title: 'Tabrr Dashboard', loading: false, canGoBack: false, canGoForward: false, zoom: tab.zoom},
    {title: 'Tabrr Dashboard (3)'}, {title: 'Tabrr Dashboard'}
  ];
  const apply = (from, quiet) => stream.reduce((current, patch) => {
    const say = quiet ? kit.quietPatch(current.tabs.find(item => item.id === tab.id), patch) : patch;
    return say ? kit.normalizeTabs(reduceBrowser(current, {type: 'browser.event', event: {type: 'state', tabId: tab.id, ...say}}), ctx) : current;
  }, from);
  const before = JSON.stringify(apply(state, false).tabs.find(item => item.id === tab.id));
  assert.notEqual(before, JSON.stringify(tab), 'unfiltered, the stream rewrites the tab (title, loading)');
  const after = apply(state, true);
  assert.equal(after, state, 'filtered: the state object is the same, so nothing is re-rendered, saved or broadcast');
});

test('main: the model hears the page through quietPatch only, and no colour is read from the New Tab page', () => {
  assert.match(main, /function browserEvent\(id,patch\)\{[^}]*newTabKit\.quietPatch\(state\.tabs\.find\(tab=>tab\.id===id\),patch\);if\(!say\)return;record\(\{type:'state',tabId:id,\.\.\.say\}\);\}/);
  const start = main.indexOf('blocked:id=>{const tab=state.tabs.find(item=>item.id===id);');
  assert.ok(start > 0, 'the site colour\'s blocked rule is where this test expects it');
  const end = main.indexOf('visible:id=>pageVisible(id)', start);
  const body = main.slice(start, end).replace(/,\s*$/, '').replace(/^blocked:/, '');
  const run = (state, flags = {}) => new vm.Script('(' + body + ')').runInNewContext({state, privateMode: flags.privateMode || false, torMode: false, newTabKit: kit});
  const ordinary = {tabs: [{id: 'w', url: 'https://example.com/', contentKind: 'web', browserProfileId: 'p'}, {id: 'n', url: 'acira://new', contentKind: 'web', browserProfileId: 'p'}, {id: 'i', url: 'acira://new', contentKind: 'internal', browserProfileId: 'p'}], browserProfiles: [{id: 'p'}]};
  assert.equal(run(ordinary)('w'), false, 'a website keeps its colour');
  assert.equal(run(ordinary)('n'), true, 'the New Tab\'s extension page: none');
  assert.equal(run(ordinary)('gone'), true, 'a tab that is gone');
  assert.equal(run({...ordinary, tabs: [{...ordinary.tabs[0], privacy: 'private'}]})('w'), true, 'private stays blocked');
});
