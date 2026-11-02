'use strict';
// P5 chrome.webNavigation: events from a tab's Electron events with Chrome's details (frame ids, documentId, transitionType/qualifiers,
// onErrorOccurred, fragment vs history-state), getFrame / getAllFrames with Chromium's argument rules, and URL filters in the renderer.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const path = require('node:path');

// web-navigation.cjs asks electron.webFrameMain.fromId(processId, routingId); the test gives it the fake frames.
const frames = new Map();
require.cache[require.resolve('electron')] = {id: 'electron', filename: 'electron', loaded: true, exports: {webFrameMain: {fromId: (pid, rid) => frames.get(`${pid}:${rid}`) || null}}};
const webNavigation = require('../desktop/browser-services/ext-api/web-navigation.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');
void path;

function frame(id, parent, url, rid) {
  const f = Object.assign(new EventEmitter(), {frameTreeNodeId: id, parent, url, processId: 4, routingId: rid, isDestroyed: () => false});
  f.top = parent ? parent.top : f;
  frames.set(`4:${rid}`, f);
  return f;
}
function tab() {
  const wc = new EventEmitter();
  const main = frame(1, null, 'https://start.example/', 10);
  const child = frame(5, main, 'https://ads.example/frame', 11);
  const entries = ['https://start.example/'];
  let index = 0;
  Object.assign(wc, {id: 7, mainFrame: Object.assign(main, {framesInSubtree: [main, child]}), isDestroyed: () => false, opener: null,
    navigationHistory: {getActiveIndex: () => index, length: () => entries.length}});
  return {wc, main, child, history: {push(url) { entries.splice(index + 1); entries.push(url); index = entries.length - 1; }, go(i) { index = i; }}};
}
function setup() {
  const sent = [];
  const handlers = new Map();
  const t = tab();
  const engine = Object.assign(new EventEmitter(), {tabs: new Set([t.wc]), getTabById: id => (id === 7 ? t.wc : undefined)});
  const api = {session: {}, store: () => engine, handle: (name, fn) => handlers.set(name, fn), listening: () => ['x'], broadcast: (name, details) => sent.push([name.replace('aciraWebNavigation.', ''), details])};
  webNavigation.install(api);
  return {sent, handlers, ...t};
}
const navigate = (s, f, url, {renderer = false, redirect = false, push = true} = {}) => {
  if (renderer) s.wc.emit('will-frame-navigate', {url, frame: f, isMainFrame: !f.parent});
  s.wc.emit('did-start-navigation', {url, frame: f, isMainFrame: !f.parent, isSameDocument: false});
  if (redirect) s.wc.emit('did-redirect-navigation', {url, frame: f});
  if (push && !f.parent) s.history.push(url);
  f.url = url;
  s.wc.emit('did-frame-navigate', {}, url, 200, 'OK', !f.parent, 4, f.routingId);
};

test('a main-frame navigation: onBeforeNavigate → onCommitted → onDOMContentLoaded → onCompleted with Chrome\'s details', () => {
  const s = setup();
  navigate(s, s.main, 'https://news.example/');
  s.wc.emit('dom-ready');
  s.wc.emit('did-frame-finish-load', {}, true, 4, 10);
  assert.deepEqual(s.sent.map(([name]) => name), ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted']);
  const [, before] = s.sent[0], [, committed] = s.sent[1], [, completed] = s.sent[3];
  assert.equal(before.processId, -1);
  assert.equal(before.frameId, 0);
  assert.equal(before.parentFrameId, -1);
  assert.equal(before.documentId, undefined, 'no document before commit');
  assert.equal(committed.transitionType, 'typed');
  assert.deepEqual(committed.transitionQualifiers, ['from_address_bar']);
  assert.match(committed.documentId, /^[0-9A-F]{32}$/);
  assert.equal(committed.frameType, 'outermost_frame');
  assert.equal(committed.documentLifecycle, 'active');
  assert.equal(completed.documentId, committed.documentId, 'the same document through its events');
});

test('transition types: link, client and server redirects, reload, back/forward, sub-frames', () => {
  const s = setup();
  navigate(s, s.main, 'https://a.example/');
  s.wc.emit('did-frame-finish-load', {}, true, 4, 10);
  navigate(s, s.main, 'https://b.example/', {renderer: true});
  navigate(s, s.main, 'https://c.example/', {renderer: true});              // previous document still loading: a client redirect
  s.wc.emit('did-frame-finish-load', {}, true, 4, 10);
  navigate(s, s.main, 'https://d.example/', {renderer: true, redirect: true});
  s.wc.emit('did-frame-finish-load', {}, true, 4, 10);
  navigate(s, s.main, 'https://d.example/', {push: false});                  // same entry again: reload
  s.wc.emit('did-start-navigation', {url: 'https://a.example/', frame: s.main, isMainFrame: true, isSameDocument: false});
  s.history.go(1);
  s.wc.emit('did-frame-navigate', {}, 'https://a.example/', 200, 'OK', true, 4, 10);
  navigate(s, s.child, 'https://ads.example/2');
  const commits = s.sent.filter(([name]) => name === 'onCommitted').map(([, d]) => [d.url, d.transitionType, d.transitionQualifiers]);
  assert.deepEqual(commits, [
    ['https://a.example/', 'typed', ['from_address_bar']],
    ['https://b.example/', 'link', []],
    ['https://c.example/', 'link', ['client_redirect']],
    ['https://d.example/', 'link', ['server_redirect']],
    ['https://d.example/', 'reload', []],
    ['https://a.example/', 'typed', ['forward_back']],
    ['https://ads.example/2', 'auto_subframe', []]
  ]);
  const sub = s.sent.filter(([name]) => name === 'onCommitted').at(-1)[1];
  assert.equal(sub.frameId, 5);
  assert.equal(sub.parentFrameId, 0);
  assert.equal(sub.frameType, 'sub_frame');
  assert.match(sub.parentDocumentId, /^[0-9A-F]{32}$/);
});

test('same-document changes: fragment → onReferenceFragmentUpdated, pushState → onHistoryStateUpdated', () => {
  const s = setup();
  navigate(s, s.main, 'https://app.example/page');
  s.wc.emit('did-navigate-in-page', {}, 'https://app.example/page#part', true, 4, 10);
  s.wc.emit('did-navigate-in-page', {}, 'https://app.example/other', true, 4, 10);
  const names = s.sent.map(([name]) => name).slice(-2);
  assert.deepEqual(names, ['onReferenceFragmentUpdated', 'onHistoryStateUpdated']);
  assert.equal(s.sent.at(-1)[1].transitionType, 'link');
});

test('onErrorOccurred: a failed navigation reports net:: errors once; getFrame then says errorOccurred', async () => {
  const s = setup();
  s.wc.emit('did-start-navigation', {url: 'https://nope.invalid/', frame: s.main, isMainFrame: true, isSameDocument: false});
  s.wc.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid/', true, 4, 10);
  s.wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid/', true, 4, 10);
  const errors = s.sent.filter(([name]) => name === 'onErrorOccurred');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].error, 'net::ERR_NAME_NOT_RESOLVED');
  assert.equal(errors[0][1].frameId, 0);
  const found = await s.handlers.get('webNavigation.getFrame')({}, {tabId: 7, frameId: 0});
  assert.equal(found.errorOccurred, true);
});

test('getFrame / getAllFrames follow web_navigation_api.cc', async () => {
  const s = setup();
  navigate(s, s.main, 'https://site.example/');
  const getFrame = s.handlers.get('webNavigation.getFrame'), getAllFrames = s.handlers.get('webNavigation.getAllFrames');
  const all = getAllFrames({}, {tabId: 7});
  assert.deepEqual(all.map(f => [f.frameId, f.parentFrameId, f.url, f.frameType, f.processId]), [[0, -1, 'https://site.example/', 'outermost_frame', 4], [5, 0, 'https://ads.example/frame', 'sub_frame', 4]]);
  assert.equal(all[1].parentDocumentId, all[0].documentId);
  const main = getFrame({}, {tabId: 7, frameId: 0});
  assert.deepEqual(Object.keys(main).sort(), ['documentId', 'documentLifecycle', 'errorOccurred', 'frameType', 'parentFrameId', 'url']);
  assert.deepEqual(getFrame({}, {documentId: all[1].documentId}).url, 'https://ads.example/frame');
  assert.equal(getFrame({}, {documentId: all[1].documentId, frameId: 0}), null, 'a documentId with a different frameId');
  assert.throws(() => getFrame({}, {documentId: 'zzz'}), /Invalid documentId\./);
  assert.throws(() => getFrame({}, {tabId: 7}), /Either documentId or both tabId and frameId must be specified\./);
  assert.equal(getFrame({}, {tabId: 99, frameId: 0}), null);
  assert.equal(getAllFrames({}, {tabId: 99}), null);
});

test('renderer: chrome.webNavigation with URL filters, events from the main process, frames through the main process', async () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'web-navigation');
  const world = extensionWorld({manifest_version: 3, permissions: ['webNavigation']}, {packages, worker: true, answer: name => (name === 'webNavigation.getAllFrames' ? [{frameId: 0}] : undefined)});
  const nav = world.chrome.webNavigation;
  const all = [], filtered = [];
  nav.onCommitted.addListener(d => all.push(d.url));
  nav.onCommitted.addListener(d => filtered.push(d.url), {url: [{hostSuffix: 'example.com', pathPrefix: '/watch'}, {urlMatches: '^https://x\\.test/'}]});
  for (const url of ['https://www.example.com/watch?v=1', 'https://www.example.com/home', 'https://x.test/a', 'https://other.test/watch']) world.emit('aciraWebNavigation.onCommitted', {url});
  assert.deepEqual(all.length, 4);
  assert.deepEqual(filtered, ['https://www.example.com/watch?v=1', 'https://x.test/a']);
  const hosts = [];
  nav.onBeforeNavigate.addListener(d => hosts.push(d.url), {url: [{hostContains: '.youtube'}]});
  world.emit('aciraWebNavigation.onBeforeNavigate', {url: 'https://youtube.com/'});
  world.emit('aciraWebNavigation.onBeforeNavigate', {url: 'https://notyoutube.com/'});
  assert.deepEqual(hosts, ['https://youtube.com/'], 'hostContains has an implicit leading dot');
  assert.deepEqual(plain(await nav.getAllFrames({tabId: 7})), [{frameId: 0}]);
  assert.throws(() => nav.getFrame({tabId: -1, frameId: 0}), /Error in invocation of webNavigation\.getFrame/);
  assert.equal(nav.TransitionType.AUTO_SUBFRAME, 'auto_subframe');
  const without = extensionWorld({manifest_version: 3, permissions: ['tabs']}, {packages, worker: true});
  assert.equal(without.chrome.webNavigation, undefined);
});
