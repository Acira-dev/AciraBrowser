'use strict';
// 13.5: a private window that shows only its New Tab page had NO extension buttons at all, even for extensions allowed in private.
// main.cjs 'extensions.toolbar-target' answered null in a private window unless a website tab was loaded. An ordinary window shows the buttons of the
// profile there (target -1); a private window now shows those of its own private session (the pinned ones that run in it), and a click with no
// website tab opens the popup in that window (the engine has not met a private window until a website page is handed to it).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const {EventEmitter} = require('node:events');

const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
const handler = main.slice(main.indexOf("case 'extensions.toolbar-target':"), main.indexOf("case 'filters.profile-status':"));

test('main.cjs: a private window on its New Tab page asks the toolbar for its own private session\'s buttons; Tor and a window without that profile do not', () => {
  assert.ok(handler.length > 500);
  // the private branch exists, is for pages that are not websites, in a private window, never Tor, and only for this window's own private profile
  assert.match(handler, /privateOwn=tab\.contentKind!=='web'&&privateMode&&!torMode&&tab\.browserProfileId===state\.activeBrowserProfileId\?state\.browserProfiles\.find\(p=>p\.id===tab\.browserProfileId&&p\.private\):null/);
  assert.match(handler, /privateOwn\?[^]*?extensionToolbar\.privateProfileTarget\(require\('electron'\)\.session\.fromPartition\(privateOwn\.partition\)\):direct\}/);
  // the ordinary window's path is as before
  assert.match(handler, /tab\.contentKind!=='web'&&!privateMode&&tab\.browserProfileId===state\.activeBrowserProfileId\?extensionToolbar\.profileTarget\(tab\.browserProfileId\)/);
  // the toolbar is given the window, so a click with no website tab has one to open the popup in
  assert.match(main, /createExtensionToolbar\(\{manager:extensionManager,getWindow:\(\)=>mainWindow,/);
});

// ---- the toolbar adapter, with the extension engine stubbed
function loadToolbar(runtimes) {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron-chrome-extensions') return {ElectronChromeExtensions: {fromSession: session => runtimes.get(session) || null, handleCRXProtocol() {}}, setSessionPartitionResolver() {}};
    return original.call(this, request, ...rest);
  };
  const file = require.resolve('../desktop/browser-services/extension-toolbar.cjs');
  delete require.cache[file];
  try { return require(file); } finally { Module._load = original; }
}

test('the toolbar adapter answers the private window\'s no-tab target through the private session, and nothing for a session that runs no extension', () => {
  const session = {name: 'private session'}, plain = {name: 'memory-only private session'};
  const engine = {activateClick() {}, getPopupUrl() { return ''; }, ctx: {store: {}, emit() {}}};
  const runtimes = new Map([[session, {api: {browserAction: engine}, on() {}}]]);
  const {createExtensionToolbar} = loadToolbar(runtimes);
  const given = {supported: true, profileId: 'private-1', partition: 'persist:acira-private-ext-window-1', webContentsId: -1, pinnedIds: ['aaaa'], actionIds: ['aaaa', 'bbbb']};
  const manager = {privateProfileTarget: s => (s === session ? given : null), isPrivateSession: s => s === session, list: () => ({extensions: []})};
  const window = {id: 5, isDestroyed: () => false};
  const toolbar = createExtensionToolbar({getContext: () => null, getProfiles: () => [], getSession: () => null, manager, getWindow: () => window});
  assert.equal(typeof toolbar.privateProfileTarget, 'function');
  assert.deepEqual(toolbar.privateProfileTarget(session), given);
  assert.equal(engine.activateClick.framedPopups, true, 'its buttons open Acira\'s framed popup, in the window given');
  const none = {supported: false, profileId: null, partition: null, webContentsId: null, pinnedIds: [], actionIds: []};
  assert.deepEqual(toolbar.privateProfileTarget(plain), none, 'a private session that runs no extension has no buttons');
  assert.deepEqual(toolbar.privateProfileTarget(null), none);
});

// ---- the click with no website tab, in a window the engine has not met
test('a click with no website tab opens the popup in the window the toolbar was given when the engine knows no window yet (a private window before its first website)', () => {
  const {installPopupFrames, ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
  class W extends EventEmitter {
    constructor(o = {}) { super(); this.options = o; this.contentView = {children: [], addChildView: v => this.contentView.children.push(v)}; this.bounds = {x: 0, y: 0, width: 800, height: 600}; this.destroyed = false; }
    getBounds() { return this.bounds; } setBounds(b) { this.bounds = b; } getContentBounds() { return this.bounds; } getParentWindow() { return null; }
    show() {} focus() {} isFocused() { return false; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; } setMinimumSize() {}
  }
  class C extends EventEmitter { loadURL() { return Promise.resolve(); } isDestroyed() { return false; } getURL() { return ''; } setWindowOpenHandler() {} focus() {} close() {} isDevToolsOpened() { return false; } }
  class V { constructor() { this.webContents = new C(); } setBackgroundColor() {} setBorderRadius() {} setBounds() {} }
  const electron = {BaseWindow: Object.assign(W, {getAllWindows: () => [], fromId: () => null}), WebContentsView: V, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 0, width: 1400, height: 900}})}};
  const calls = [], emitted = [], mine = new W();
  const makeEngine = () => ({popup: undefined, ctx: {session: {extensions: new EventEmitter()}, emit: (name, popup) => emitted.push([name, popup]), store: {getTabById: () => undefined, getActiveTabOfCurrentWindow: () => undefined, tabToWindow: new WeakMap(), windows: new Set()}},
    getPopupUrl: (id, tab) => { calls.push(['getPopupUrl', id, tab]); return 'chrome-extension://' + id + '/popup.html'; }, activateClick(d) { calls.push(['library', d.extensionId]); }});
  const click = engine => engine.activateClick({eventType: 'click', extensionId: 'aaaa', tabId: -1, anchorRect: {x: 700, y: 20, width: 30, height: 30}, alignment: 'bottom right'});

  const withWindow = makeEngine();
  assert.equal(installPopupFrames({api: {browserAction: withWindow}}, {electron, platform: 'darwin', getWindow: () => mine}), true);
  click(withWindow);
  assert.equal(emitted.length, 1, 'a popup opened');
  assert.ok(emitted[0][1] instanceof ExtensionPopup);
  assert.equal(emitted[0][1].parent, mine, 'in the private window');
  assert.ok(!calls.some(call => call[0] === 'library'), 'not the library\'s "Unable to get active tab"');

  // no window to give, or a window that is gone: the library's own answer, as before
  for (const getWindow of [undefined, () => null, () => ({isDestroyed: () => true})]) {
    calls.length = 0; emitted.length = 0;
    const engine = makeEngine();
    installPopupFrames({api: {browserAction: engine}}, {electron, platform: 'darwin', ...(getWindow ? {getWindow} : {})});
    click(engine);
    assert.deepEqual(calls.filter(call => call[0] === 'library'), [['library', 'aaaa']]);
    assert.equal(emitted.length, 0);
  }
});
