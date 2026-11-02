'use strict';
// P9 essentials: chrome.sidePanel.open() with Chrome's user-gesture rule and error strings (side_panel_api.cc / side_panel_service.cc).
const test = require('node:test'), assert = require('node:assert/strict');
const os = require('node:os');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const sidePanel = require('../desktop/browser-services/ext-api/side-panel.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');

const {MESSAGES} = sidePanel;
const mine = () => extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'side-panel');
const world = (over = {}) => ({isWorker: false, gesture: true, tab: id => (id === 5 || id === 6 ? {id} : null), tabWindowId: tab => (tab.id === 5 ? 1 : 2),
  windows: () => [1, 2], options: () => ({path: 'panel.html', enabled: true}), ...over});

test('openError: Chrome\'s rules and messages, in Chrome\'s order', () => {
  assert.equal(sidePanel.openError({tabId: 5}, world({gesture: false})), '`sidePanel.open()` may only be called in response to a user gesture.');
  assert.equal(sidePanel.openError({}, world()), 'At least one of `tabId` and `windowId` must be provided');
  assert.equal(sidePanel.openError({tabId: 99}, world()), 'No tab with id: 99.');
  assert.equal(sidePanel.openError({tabId: 5, windowId: 2}, world()), 'The specified tab does not belong to the specified window.');
  assert.equal(sidePanel.openError({tabId: 5, windowId: 1}, world()), null);
  assert.equal(sidePanel.openError({tabId: 5}, world({options: () => ({enabled: true})})), 'No active side panel for tabId: 5');
  assert.equal(sidePanel.openError({tabId: 5}, world({options: () => ({path: 'p.html', enabled: false})})), 'No active side panel for tabId: 5');
  assert.equal(sidePanel.openError({windowId: 7}, world()), 'No window with id: 7.');
  assert.equal(sidePanel.openError({windowId: 2}, world({options: () => ({enabled: true})})), 'No active side panel for windowId: 2');
  assert.equal(sidePanel.openError({windowId: 2}, world()), null);
  assert.equal(sidePanel.openError({windowId: 7}, world({windows: () => []})), null, 'a window the engine has not been told about is not refused');
  assert.equal(sidePanel.openError({tabId: 5}, world({isWorker: true, gesture: false})), null, 'a service worker is not gesture-checked (see side-panel.cjs)');
});

test('renderer: open() passes the page\'s user activation; a worker passes none; the schema checks the arguments', async () => {
  const seen = [];
  const answer = (name, args) => { seen.push([name, ...args]); return undefined; };
  const page = extensionWorld({manifest_version: 3, permissions: ['sidePanel']}, {packages: mine(), worker: false, answer, userGesture: true});
  await page.chrome.sidePanel.open({tabId: 5});
  assert.deepEqual(seen.at(-1), ['sidePanel.open', {tabId: 5}, true]);
  page.setGesture(false);
  await page.chrome.sidePanel.open({windowId: 1});
  assert.deepEqual(seen.at(-1), ['sidePanel.open', {windowId: 1}, false]);
  const worker = extensionWorld({manifest_version: 3, permissions: ['sidePanel']}, {packages: mine(), worker: true, answer, userGesture: true});
  await worker.chrome.sidePanel.open({tabId: 5});
  assert.deepEqual(seen.at(-1), ['sidePanel.open', {tabId: 5}, false]);
  assert.throws(() => worker.chrome.sidePanel.open({tabId: 'x'}), {message: /Error in invocation of sidePanel\.open\(sidePanel\.OpenOptions options, optional function callback\)/});
  assert.deepEqual(plain(worker.chrome.sidePanel.Side), {LEFT: 'left', RIGHT: 'right'});
  assert.equal(await worker.chrome.sidePanel.setOptions({path: 'a.html'}), undefined);
  const none = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages: mine()});
  assert.equal(none.chrome.sidePanel, undefined);
  const mv2 = extensionWorld({manifest_version: 2, permissions: ['sidePanel']}, {packages: mine()});
  assert.equal(mv2.chrome.sidePanel, undefined, 'sidePanel is Manifest V3 only');
  // the error from the main process is the extension's rejection and its lastError
  const refused = extensionWorld({manifest_version: 3, permissions: ['sidePanel']}, {packages: mine(), worker: false, answer: name => (name === 'sidePanel.open' ? {__acira_error: MESSAGES.gesture} : undefined)});
  await assert.rejects(refused.chrome.sidePanel.open({tabId: 5}), {message: MESSAGES.gesture});
  assert.equal(await new Promise(resolve => refused.chrome.sidePanel.open({tabId: 5}, () => resolve(refused.chrome.runtime.lastError.message))), MESSAGES.gesture);
});

test('main: open() is checked against the engine store before the panel host is asked; setOptions still opens and closes as before', async () => {
  const handlers = new Map(), opened = [];
  const tabs = new Map([[5, {id: 5, isDestroyed: () => false, getURL: () => 'https://a.test/'}]]);
  const win = {id: 1, isDestroyed: () => false};
  const store = {getTabById: id => tabs.get(id), tabToWindow: new WeakMap([[tabs.get(5), win]]), windows: new Set([win]), getTabs() { return []; }};
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); }, sendEvent() {}, broadcastEvent() {}};
  const extension = {id: ID, name: 'Panel', manifest: {manifest_version: 3, permissions: ['sidePanel'], side_panel: {default_path: 'panel.html'}}};
  const session = {extensions: {getExtension: () => extension, on() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  const host = {current: () => null, async open(details) { opened.push(details); return {windowId: 1}; }, close: async () => {}};
  installExtensionApis({ctx: {router, store}}, {session, userData: os.tmpdir(), sidePanelHost: host});
  const open = (type, input, gesture) => handlers.get('sidePanel.open').callback({type, extension, sender: null}, input, gesture);
  assert.deepEqual(await open('frame', {tabId: 5}, false), {__acira_error: MESSAGES.gesture});
  assert.deepEqual(await open('frame', {}, true), {__acira_error: MESSAGES.noTarget});
  assert.deepEqual(await open('frame', {tabId: 9}, true), {__acira_error: 'No tab with id: 9.'});
  assert.equal(opened.length, 0, 'nothing reached the panel host');
  assert.equal(await open('frame', {tabId: 5}, true), undefined);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].tabId, 5);
  assert.equal(await open('service-worker', {tabId: 5}, false), undefined, 'a worker is let through');
  assert.equal(opened.length, 2);
  // the panel is switched off for the tab: nothing to show
  await handlers.get('sidePanel.setOptions').callback({type: 'frame', extension}, {tabId: 5, enabled: false});
  assert.deepEqual(await open('frame', {tabId: 5}, true), {__acira_error: 'No active side panel for tabId: 5'});
});
