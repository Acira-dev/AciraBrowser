'use strict';
// An extension's toolbar popup was a bare square rectangle flush against the toolbar (reported 6 Nov 2026). electron-chrome-extensions makes its
// window with `roundedCorners: false` and a BrowserWindow's own page cannot be clipped, so Acira makes the window (desktop/browser-services/
// extension-popup-window.cjs): the system's rounded frame where there is one, Acira's menu radius (8 px x Interface size) on macOS, the same size
// logic, the same lifecycle. These tests pin the frame per platform, the lifecycle the library's PopupView had, and the engine hook.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events'), fs = require('node:fs'), path = require('node:path');
const {ExtensionPopup, popupFrame, installPopupFrames, ownPage, popupOf, BOUNDS, MATERIAL_RADIUS} = require('../desktop/browser-services/extension-popup-window.cjs');
const {GAP} = require('../desktop/browser-services/extension-popup-placement.cjs');

const rect = (x, y, width, height) => ({x, y, width, height});

// ---- fakes: just what the class touches
class FakeContents extends EventEmitter {
  constructor(options) { super(); this.options = options; this.urls = []; this.closed = false; this.devtools = false; this.devtoolsClosed = 0; }
  loadURL(url) { this.urls.push(url); return Promise.resolve(); }
  isDestroyed() { return this.closed; }
  isDevToolsOpened() { return this.devtools; }
  closeDevTools() { this.devtools = false; this.devtoolsClosed++; }
  close() { this.closed = true; }
  getURL() { return this.urls[this.urls.length - 1] || ''; }
  setWindowOpenHandler(handler) { this.openHandler = handler; }
  focus() { this.focusCalls = (this.focusCalls || 0) + 1; }
}
class FakeView {
  constructor(options) { this.options = options; this.webContents = new FakeContents(options); this.calls = []; }
  setBackgroundColor(color) { this.calls.push(['background', color]); }
  setBorderRadius(radius) { this.calls.push(['radius', radius]); }
  setBounds(bounds) { this.bounds = bounds; this.calls.push(['bounds', {...bounds}]); }
}
class FakeWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options; this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false; this.focused = false;
    this.parentWindow = options.parent || null; this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)};
    FakeWindow.all.push(this);
  }
  getBounds() { return {...this.bounds}; }
  setBounds(bounds) { this.bounds = {...bounds}; }
  getContentBounds() { return this.content || this.getBounds(); }
  getParentWindow() { return this.parentWindow; }
  show() { this.visible = true; }
  isFocused() { return this.focused; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; }
}
FakeWindow.all = [];
FakeWindow.getAllWindows = () => FakeWindow.all.filter(window => !window.destroyed);
FakeWindow.fromId = id => FakeWindow.all.find(window => window.id === id && !window.destroyed) || null;

function fixture({platform = 'darwin', env, zoom = 1, content = rect(260, 69, 1088, 700), area = rect(0, 29, 1352, 795), anchorRect = rect(845, 39, 30, 30)} = {}) {
  FakeWindow.all = [];
  const parent = new FakeWindow({});
  parent.content = content;
  parent.bounds = {...content};
  const ui = new FakeView({});
  ui.webContents.urls.push('acira-browser-ui://ui/index.html');
  ui.webContents.getZoomFactor = () => zoom;
  parent.contentView.addChildView(ui);
  const displays = [];
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: box => { displays.push(box); return {workArea: area}; }}};
  const popup = new ExtensionPopup({extensionId: 'nngceckbapebfimnlniiiahkandclblb', session: {name: 'session'}, parent, url: 'chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup/index.html', anchorRect, alignment: 'bottom right'}, {electron, platform, env});
  return {popup, parent, electron, displays, window: popup.window, view: popup.view, contents: popup.webContents};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

// ---- the frame

test('popupFrame: macOS clips the page to the menus\' radius (8 px x Interface size) in a transparent window that keeps the system shadow; Windows asks for the system\'s rounded corners; Linux is as before', () => {
  assert.equal(MATERIAL_RADIUS, JSON.parse(fs.readFileSync(path.join(__dirname, '../design-tokens.json'), 'utf8')).geometry.materialRadius);
  for (const [scale, radius] of [[0.8, 6], [1, 8], [1.1, 9], [1.25, 10], [1.5, 12]]) assert.equal(popupFrame({platform: 'darwin', scale}).radius, radius, `${scale}`);
  const mac = popupFrame({platform: 'darwin', scale: 1});
  assert.deepEqual([mac.kind, mac.window.transparent, mac.window.hasShadow, mac.window.backgroundColor], ['clipped', true, true, '#00000000']);
  const win = popupFrame({platform: 'win32', scale: 1.5});
  assert.deepEqual([win.kind, win.radius, win.window.roundedCorners, win.window.transparent], ['system', 0, true, undefined]);  // Windows 11 rounds it, Windows 10 cannot
  const linux = popupFrame({platform: 'linux', scale: 1.25});
  assert.deepEqual([linux.kind, linux.radius, linux.window.roundedCorners, linux.window.transparent], ['square', 0, false, undefined]);
});

test('the window is the library\'s (frameless, a child of the browser window, fixed, off the taskbar) with the frame of its platform; the page is a view with the library\'s preferences', () => {
  const mac = fixture({platform: 'darwin', zoom: 1.25});
  assert.equal(mac.window.options.frame, false);
  assert.equal(mac.window.options.parent, mac.parent);
  for (const flag of ['movable', 'maximizable', 'minimizable', 'fullscreenable', 'resizable']) assert.equal(mac.window.options[flag], false, flag);
  assert.equal(mac.window.options.skipTaskbar, true);
  assert.equal(mac.window.options.show, false);
  assert.deepEqual([mac.window.options.transparent, mac.window.options.hasShadow, mac.window.options.roundedCorners], [true, true, false]);
  assert.deepEqual(mac.view.options.webPreferences, {session: {name: 'session'}, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, enablePreferredSizeMode: true});
  assert.deepEqual(mac.view.calls.slice(0, 2), [['background', '#ffffff'], ['radius', 10]]);  // 8 x 1.25, as the menus
  assert.equal(mac.window.contentView.children[0], mac.view);
  const win = fixture({platform: 'win32'});
  assert.equal(win.window.options.roundedCorners, true);
  assert.equal(win.window.options.transparent, undefined);
  assert.ok(!win.view.calls.some(call => call[0] === 'radius'), 'Windows rounds the window itself');
  assert.equal(win.window.options.backgroundColor, '#ffffff');
  const linux = fixture({platform: 'linux', env: {XDG_SESSION_TYPE: 'x11'}});
  assert.equal(linux.window.options.roundedCorners, false);
});

// ---- the lifecycle (the library's PopupView)

test('the page loads, shows the window at its first preferred size and keeps its place under the icon at every later size', async () => {
  const f = fixture();
  await f.popup.whenReady();
  assert.deepEqual(f.contents.urls.slice(-1), ['chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup/index.html']);
  assert.equal(f.window.visible, false, 'hidden until the page says how big it is');
  const icon = {right: 260 + 845 + 30, bottom: 69 + 39 + 30};
  for (const [width, height] of [[480, 600], [300, 260], [420, 420], [240, 180], [480, 600]]) {
    f.contents.emit('preferred-size-changed', {}, {width, height});
    assert.equal(f.window.visible, true);
    assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [width, height]);
    assert.equal(f.window.bounds.x + f.window.bounds.width, icon.right, `${width}x${height}`);
    assert.equal(f.window.bounds.y, icon.bottom + GAP);
    assert.deepEqual(f.view.bounds, {x: 0, y: 0, width, height});
  }
  assert.deepEqual(f.displays.slice(-1)[0], {x: 1105, y: 108, width: 30, height: 30});
});

test('the page of the popup gets the keyboard when the window shows (a WebContentsView in a BaseWindow does not: typing went nowhere until the person clicked into Bitwarden\'s password field)', async () => {
  const f = fixture();
  await f.popup.whenReady();
  assert.equal(f.contents.focusCalls || 0, 0, 'nothing is focused while the window is hidden');
  f.contents.emit('preferred-size-changed', {}, {width: 480, height: 600});
  assert.equal(f.window.visible, true);
  assert.equal(f.contents.focusCalls, 1, 'the page is focused with the window');
  f.contents.emit('preferred-size-changed', {}, {width: 300, height: 260});
  assert.equal(f.contents.focusCalls, 1, 'a later size does not take the keyboard again');
  f.contents.close();
  assert.doesNotThrow(() => f.popup.show(), 'a page that is gone is not focused');
});

test('sizes are the library\'s: whole, never under 25, never over 800 x 600; the page announces will-resize / resized and the window will-move / moved', () => {
  const f = fixture(), events = [];
  for (const name of ['will-resize', 'resized', 'will-move', 'moved']) f.popup.on(name, value => events.push([name, value]));
  f.popup.setSize({width: 90000, height: 90000});
  assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [BOUNDS.maxWidth, BOUNDS.maxHeight]);
  f.popup.setSize({width: 3, height: NaN});
  assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [BOUNDS.minWidth, BOUNDS.minHeight]);
  f.popup.setSize({width: 300.7, height: 200.2});
  assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [300, 200]);
  assert.deepEqual(events.slice(0, 4).map(event => event[0]), ['will-resize', 'will-move', 'moved', 'resized']);
  assert.deepEqual(events[0][1], {width: BOUNDS.maxWidth, height: BOUNDS.maxHeight});
});

test('the gap and the icon follow Interface size: at 150 % the 45 px button is under the popup\'s right edge and the gap is 12 px', () => {
  const f = fixture({zoom: 1.5, anchorRect: rect(650, 26, 30, 30)});  // the page is 1088 / 1.5 CSS px wide
  f.popup.setSize({width: 480, height: 600});
  assert.equal(f.window.bounds.x + 480, 260 + 650 * 1.5 + 30 * 1.5);
  assert.equal(f.window.bounds.y, 69 + 26 * 1.5 + 30 * 1.5 + GAP * 1.5);
  assert.deepEqual(f.displays.slice(-1)[0], {x: 1235, y: 108, width: 45, height: 45});
});

test('a window that was moved or resized from outside (updatePosition) is put back under the icon', () => {
  const f = fixture();
  f.popup.setSize({width: 300, height: 260});
  f.window.bounds = {...f.window.bounds, x: 5, y: 5};
  f.popup.updatePosition();
  assert.equal(f.window.bounds.x + 300, 260 + 845 + 30);
  assert.equal(f.window.bounds.y, 69 + 39 + 30 + GAP);
});

test('destroy: the window goes, the page is closed with it (a window does not close the page of its view), DevTools too; once only', () => {
  const f = fixture();
  f.contents.devtools = true;
  f.popup.destroy();
  assert.equal(f.window.destroyed, true);
  assert.equal(f.contents.closed, true);
  assert.equal(f.contents.devtoolsClosed, 1);
  assert.equal(f.popup.isDestroyed(), true);
  assert.equal(f.parent.listenerCount('closed'), 0);
  assert.doesNotThrow(() => f.popup.destroy());
  f.popup.setSize({width: 300, height: 300});  // nothing left to size
  assert.equal(f.window.visible, false);
});

test('closing the browser window, or the popup\'s own window, closes the popup', () => {
  const a = fixture();
  a.parent.emit('closed');
  assert.equal(a.popup.isDestroyed(), true);
  const b = fixture();
  b.window.emit('closed');
  assert.equal(b.popup.isDestroyed(), true);
  assert.equal(b.contents.closed, true);
});

test('losing focus closes the popup when another window of Acira has it; not while the focus is in another application or DevTools is open (the library\'s rule)', () => {
  const away = fixture();
  away.window.emit('blur');
  assert.equal(away.popup.isDestroyed(), false, 'no window of Acira is focused: the focus is elsewhere');
  const devtools = fixture();
  devtools.parent.focused = true;
  devtools.contents.devtools = true;
  devtools.window.emit('blur');
  assert.equal(devtools.popup.isDestroyed(), false);
  const back = fixture();
  back.parent.focused = true;
  back.window.emit('blur');
  assert.equal(back.popup.isDestroyed(), true);
  const closedDevtools = fixture();
  closedDevtools.parent.focused = true;
  closedDevtools.contents.emit('devtools-closed');
  assert.equal(closedDevtools.popup.isDestroyed(), true);
});

test('the page closing itself (window.close()) closes the popup window with it, instead of leaving an empty box holding the keyboard', async () => {
  const f = fixture();
  await f.popup.whenReady();
  f.contents.emit('preferred-size-changed', {}, {width: 273, height: 375});
  assert.equal(f.window.visible, true);
  f.contents.closed = true;
  f.contents.emit('destroyed');
  assert.equal(f.popup.isDestroyed(), true);
  assert.equal(f.window.destroyed, true, 'the window went with its page');
  assert.doesNotThrow(() => f.popup.destroy(), 'closing twice is fine');
});

test('popupOf finds the popup whose page has the keyboard, so the menu\'s Close Tab / Reload act on the popup and not on the tab behind it', () => {
  const f = fixture();
  assert.equal(popupOf(f.contents), f.popup);
  assert.equal(popupOf({}), null, 'a page that is no popup\'s');
  assert.equal(popupOf(null), null);
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const run = main.slice(main.indexOf('function runMenu('), main.indexOf('function runMenu(') + 1800);
  assert.match(run, /extensionPopup=contents&&require\('\.\/browser-services\/extension-popup-window\.cjs'\)\.popupOf\(contents\)/);
  assert.match(run, /if\(extensionPopup\)\{if\(command\.action==='close-tab'\|\|command\.action==='close-window'\)\{extensionPopup\.destroy\(\);return;\}/);
  assert.ok(run.indexOf('popupOf(contents)') < run.indexOf('showMain()'), 'asked before the main window is shown and the shortcut runs on its tab');
  f.popup.destroy();
  assert.equal(popupOf(f.contents), null, 'a closed popup is none');
});

test('a page that fails to load is logged, not thrown, and the popup still sizes', async () => {
  FakeWindow.all = [];
  const f = fixture();
  const original = f.contents.loadURL;
  f.contents.loadURL = () => Promise.reject(new Error('ERR_FAILED'));
  const logged = [], log = console.error;
  console.error = error => logged.push(String(error.message));
  try { await f.popup.load('chrome-extension://x/popup.html'); } finally { console.error = log; f.contents.loadURL = original; }
  assert.deepEqual(logged, ['ERR_FAILED']);
  assert.deepEqual([f.window.bounds.width, f.window.bounds.height], [BOUNDS.minWidth, BOUNDS.minHeight]);
});

// ---- the engine hook (BrowserActionAPI.activateClick)

function engineFixture({withPopupUrl = true, withTab = true, withWindow = true, currentWindow = false} = {}) {
  const f = fixture();
  const calls = [], emitted = [];
  const tab = {id: 7};
  const engine = {
    popup: undefined,
    ctx: {session: {name: 'session', extensions: new EventEmitter()}, emit: (name, popup) => emitted.push([name, popup]), router: {sendEvent: (...args) => calls.push(['sendEvent', ...args])},
      store: {getTabById: id => (withTab && id === 7 ? tab : undefined), getActiveTabOfCurrentWindow: () => (withTab ? tab : undefined), tabToWindow: new WeakMap(withWindow ? [[tab, f.parent]] : []), tabDetailsCache: new Map([[7, {id: 7}]]),
      ...(currentWindow ? {lastFocusedWindowId: f.parent.id = 2} : {})}},
    getPopupUrl: (extensionId, tabId) => { calls.push(['getPopupUrl', extensionId, tabId]); return withPopupUrl ? 'chrome-extension://' + extensionId + '/popup.html' : ''; },
    activateClick(details) { calls.push(['library activateClick', details.extensionId]); }
  };
  const runtime = {api: {browserAction: engine}};
  return {...f, engine, runtime, calls, emitted, electron: f.electron};
}
const click = (e, extensionId = 'aaaa', tabId = 7) => e.engine.activateClick({eventType: 'click', extensionId, tabId, anchorRect: rect(845, 39, 30, 30), alignment: 'bottom right'});

test('installPopupFrames: a click opens the popup in the framed window, tells the toolbar glue (action.openPopup waits for this event), and keeps it as the engine\'s popup', () => {
  const e = engineFixture();
  assert.equal(installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'}), true);
  click(e);
  assert.equal(e.emitted.length, 1);
  assert.equal(e.emitted[0][0], 'browser-action-popup-created');
  assert.ok(e.emitted[0][1] instanceof ExtensionPopup);
  assert.equal(e.emitted[0][1].extensionId, 'aaaa');
  assert.equal(e.engine.popup, e.emitted[0][1]);
  assert.equal(e.emitted[0][1].parent, e.parent, 'the popup belongs to the window of the tab');
  assert.ok(!e.calls.some(call => call[0] === 'library activateClick'));
});

test('a second click on the same button closes it; another extension\'s button replaces it', () => {
  const e = engineFixture();
  installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
  click(e, 'aaaa');
  const first = e.engine.popup;
  click(e, 'aaaa');
  assert.equal(first.isDestroyed(), true);
  assert.equal(e.engine.popup, undefined);
  assert.equal(e.emitted.length, 1, 'no new popup on the closing click');
  click(e, 'aaaa');
  const second = e.engine.popup;
  click(e, 'bbbb');
  assert.equal(second.isDestroyed(), true);
  assert.equal(e.engine.popup.extensionId, 'bbbb');
  assert.equal(e.emitted.length, 3);
});

test('reloading an extension closes its open popup: the first click afterwards opens the popup instead of closing a stale one', () => {
  const e = engineFixture();
  installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
  click(e, 'aaaa');
  const first = e.engine.popup;
  // another extension unloading leaves it alone
  e.engine.ctx.session.extensions.emit('extension-unloaded', {}, {id: 'bbbb'});
  assert.equal(first.isDestroyed(), false);
  assert.equal(e.engine.popup, first);
  // the reload: unload, then load again
  e.engine.ctx.session.extensions.emit('extension-unloaded', {}, {id: 'aaaa'});
  assert.equal(first.isDestroyed(), true, 'the window goes with the page');
  assert.equal(e.engine.popup, undefined);
  e.engine.ctx.session.extensions.emit('extension-loaded', {}, {id: 'aaaa'});
  click(e, 'aaaa');
  assert.equal(e.emitted.length, 2, 'the first click after the reload opens a popup');
  assert.notEqual(e.engine.popup, first);
  assert.equal(e.engine.popup.isDestroyed(), false);
});

test('a popup whose page is gone is a stale entry: the click clears it and opens the popup, it does not just close it', async () => {
  for (const make of [
    popup => popup.webContents.emit('render-process-gone', {}, {reason: 'crashed'}),
    popup => { popup.webContents.close(); },
    popup => { popup.loadFailed = true; }
  ]) {
    const e = engineFixture();
    installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
    click(e, 'aaaa');
    const stale = e.engine.popup;
    assert.equal(stale.isLive(), true);
    make(stale);
    assert.equal(stale.isLive(), false);
    click(e, 'aaaa');
    assert.equal(stale.isDestroyed(), true);
    assert.equal(e.emitted.length, 2, 'a new popup opened');
    assert.notEqual(e.engine.popup, stale);
  }
});

test('an action with no popup page, no tab or no window is the library\'s own answer (onClicked, its errors)', () => {
  for (const options of [{withPopupUrl: false}, {withTab: false}, {withWindow: false}]) {
    const e = engineFixture(options);
    installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
    click(e);
    assert.deepEqual(e.calls.filter(call => call[0] === 'library activateClick'), [['library activateClick', 'aaaa']], JSON.stringify(options));
    assert.equal(e.emitted.length, 0);
  }
});

test('with no website tab (only the New Tab page or Settings is open) the button opens the popup in the window that was in use (Acira\'s own window is not in the engine\'s list: its last-focused id is), from the extension\'s default popup', () => {
  // tab id -1 is what the toolbar sends there; a stale id (the website tab closed while the New Tab page stayed) finds no tab either
  for (const tabId of [-1, 7]) {
    const e = engineFixture({withTab: false, currentWindow: true});
    installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
    click(e, 'aaaa', tabId);
    assert.equal(e.emitted.length, 1, 'tab ' + tabId + ': a popup opened');
    assert.ok(e.emitted[0][1] instanceof ExtensionPopup);
    assert.equal(e.emitted[0][1].parent, e.parent, 'it belongs to the current window');
    assert.deepEqual(e.calls.find(call => call[0] === 'getPopupUrl'), ['getPopupUrl', 'aaaa', -1], 'the default popup, not a tab\'s');
    assert.ok(!e.calls.some(call => call[0] === 'library activateClick'));
    click(e, 'aaaa', tabId);
    assert.equal(e.engine.popup, undefined, 'a second click closes it');
  }
  // an action with no popup page still gets the library's answer (onClicked needs a tab), and so does a profile with no window at all
  for (const options of [{withTab: false, currentWindow: true, withPopupUrl: false}, {withTab: false}]) {
    const e = engineFixture(options);
    installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
    click(e, 'aaaa', -1);
    assert.deepEqual(e.calls.filter(call => call[0] === 'library activateClick'), [['library activateClick', 'aaaa']], JSON.stringify(options));
    assert.equal(e.emitted.length, 0);
  }
});

test('a link or window.open from the popup to a website or to the extension\'s own page opens it through the store (Floccus\' "Add profile", MDM\'s "How to fix it"), anything else keeps the default', async () => {
  const f = fixture(), opened = [], id = 'fnaicdffflnofjppbagibeoednhnbjhg';
  const popup = new ExtensionPopup({extensionId: id, session: {name: 'session'}, parent: f.parent, url: 'chrome-extension://' + id + '/dist/html/options.html#/', anchorRect: rect(845, 39, 30, 30), alignment: 'bottom right', openPage: url => { opened.push(url); return Promise.resolve(); }}, {electron: f.electron, platform: 'darwin'});
  const handler = popup.webContents.openHandler;
  assert.equal(typeof handler, 'function');
  assert.deepEqual(handler({url: 'chrome-extension://' + id + '/dist/html/options.html#/new'}), {action: 'deny'}, 'no stray window that closes with the popup');
  assert.deepEqual(opened, ['chrome-extension://' + id + '/dist/html/options.html#/new']);
  assert.deepEqual(handler({url: 'https://misterdownloadmanager.com/help/browser-help.html#not-installed'}), {action: 'deny'}, 'a website opens as a tab (MDM\'s "How to fix it" did nothing)');
  assert.deepEqual(opened.slice(1), ['https://misterdownloadmanager.com/help/browser-help.html#not-installed']);
  assert.deepEqual(handler({url: 'http://127.0.0.1:9933/'}), {action: 'deny'});
  assert.deepEqual(handler({url: 'https://user:secret@example.com/'}), {action: 'allow'}, 'an address with credentials in it keeps the default');
  assert.deepEqual(handler({url: 'javascript:alert(1)'}), {action: 'allow'}, 'anything that is neither a website nor its own page keeps the default');
  assert.deepEqual(handler({url: 'about:blank'}), {action: 'allow'});
  assert.deepEqual(handler({url: 'chrome-extension://' + 'a'.repeat(32) + '/page.html'}), {action: 'allow'}, 'another extension\'s page keeps the default');
  assert.equal(opened.length, 3);
  assert.equal(ownPage('chrome-extension://' + id + '/x', id), true);
  assert.equal(ownPage('chrome-extension://' + id + '.evil.example/x', id), false);
  assert.equal(ownPage('https://' + id + '/x', id), false);
  assert.equal(ownPage('not a url', id), false);
  // a popup that was given no way to open pages leaves everything to the default
  const plain = new ExtensionPopup({extensionId: id, session: {name: 'session'}, parent: f.parent, url: 'chrome-extension://' + id + '/popup.html', anchorRect: rect(845, 39, 30, 30)}, {electron: f.electron, platform: 'darwin'});
  assert.deepEqual(plain.webContents.openHandler({url: 'chrome-extension://' + id + '/x'}), {action: 'allow'});
  // a refused open does not throw out of the handler
  const failing = new ExtensionPopup({extensionId: id, session: {name: 'session'}, parent: f.parent, url: 'chrome-extension://' + id + '/popup.html', anchorRect: rect(845, 39, 30, 30), openPage: () => { throw new Error('no'); }}, {electron: f.electron, platform: 'darwin'});
  const quiet = console.error; console.error = () => {};
  try { assert.deepEqual(failing.webContents.openHandler({url: 'chrome-extension://' + id + '/x'}), {action: 'deny'}); } finally { console.error = quiet; }
});

test('installPopupFrames gives the popup the store\'s createTab for pages the popup opens', () => {
  const e = engineFixture();
  const made = [];
  e.engine.ctx.store.createTab = async details => { made.push(details); };
  installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
  click(e);
  e.engine.popup.webContents.openHandler({url: 'chrome-extension://aaaa/options.html#/new'});
  assert.deepEqual(made, [{url: 'chrome-extension://aaaa/options.html#/new', active: true, windowId: -2}], 'opened in front, in the current window, through the store (the fixture\'s extension is \'aaaa\')');
});

test('a page a toolbar popup opens goes to the current window, not to the engine\'s last focused one (an extension page\'s window that had the focus in between)', async () => {
  const e = engineFixture();
  const store = e.engine.ctx.store, resolved = [];
  store.lastFocusedWindowId = 99;   // an extension page's own window (a Bitwarden vault tab, an options page) that was the last to have the focus
  // as the engine's store does: a createTab that names no window is given the last focused one
  store.createTab = async details => { const copy = {...details}; if (!copy.windowId) copy.windowId = store.lastFocusedWindowId; resolved.push(copy.windowId); };
  installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
  for (let round = 0; round < 2; round++) {
    click(e);
    e.engine.popup.webContents.openHandler({url: 'https://example.com/help'});
    await tick();
    e.engine.popup.destroy();   // the popup closes when its page opens; the second press then opens a new one, not the toggle that closes it
  }
  assert.deepEqual(resolved, [-2, -2], 'both times the current window (13.6: the last focused window, 99, each time)');
});

test('installPopupFrames leaves an engine it was not written for alone, and installs once', () => {
  assert.equal(installPopupFrames(null), false);
  assert.equal(installPopupFrames({api: {}}), false);
  assert.equal(installPopupFrames({api: {browserAction: {activateClick() {}}}}), false);
  const e = engineFixture();
  assert.equal(installPopupFrames(e.runtime, {electron: e.electron}), true);
  const hooked = e.engine.activateClick;
  assert.equal(installPopupFrames(e.runtime, {electron: e.electron}), true);
  assert.equal(e.engine.activateClick, hooked);
});

// ---- guards on what this relies on

test('electron-chrome-extensions 4.9.0 still has the PopupView and activateClick this replaces', () => {
  const source = fs.readFileSync(path.join(__dirname, '../node_modules/electron-chrome-extensions/dist/cjs/index.js'), 'utf8');
  assert.ok(/roundedCorners: false,/.test(source), 'the library\'s popup window is square by choice: the reason this file exists');
  const at = source.indexOf('  activateClick(details) {');
  assert.ok(at > 0);
  const body = source.slice(at, source.indexOf('  activateContextMenu(details) {', at));
  for (const part of ['this.popup.isDestroyed()', 'this.popup.destroy()', 'getTabById(tabId)', 'getActiveTabOfCurrentWindow()', 'this.getPopupUrl(extensionId, tab.id)', 'tabToWindow.get(tab)', 'new PopupView({', 'session: this.ctx.session', 'this.ctx.emit("browser-action-popup-created", this.popup)', 'browserAction.onClicked'])
    assert.ok(body.includes(part), part);
  assert.ok(/BrowserActionAPI = class \{/.test(source) && /browserAction: new BrowserActionAPI\(this\.ctx\)/.test(source), 'the engine is reachable as runtime.api.browserAction');
  assert.ok(/this\.activateClick\(\{\s*eventType: "click"/.test(source), 'openPopup() goes through activateClick, so it is framed too');
});

test('the toolbar adapter frames the popups of every runtime it attaches (ordinary and private sessions), then sizes them', () => {
  const toolbar = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/extension-toolbar.cjs'), 'utf8');
  // the ordinary session's popups, and a private session's (which is given its window: it is one window's, and the engine may not have met it yet)
  const hooks = toolbar.split("installPopupFrames(runtime);").length - 1, privateHooks = toolbar.split("installPopupFrames(runtime,{getWindow});").length - 1;
  assert.deepEqual([hooks, privateHooks], [1, 1]);
  assert.equal(toolbar.split("runtime.on('browser-action-popup-created',fitExtensionAction)").length - 1, 2);
  assert.ok(!toolbar.includes('placeExtensionPopup'));
});

test('a toolbar popup is a window of the browser window it opened from for chrome.windows (it is no longer a BrowserWindow of its own)', () => {
  const host = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/ext-api/windows/host.cjs'), 'utf8');
  const at = host.indexOf('function windowOf(contents)');
  const body = host.slice(at, host.indexOf('const displays =', at));
  assert.ok(body.includes("window.getParentWindow()) || window"), 'a window found by its view climbs to its parent');
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.ok(main.includes('for(let up=win?.getParentWindow?.();up&&!up.isDestroyed();up=win.getParentWindow?.())win=up;'));
});

test('extension-action-sizing reads the page of a framed popup from the popup, and of the library\'s from its window', () => {
  const sizing = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/extension-action-sizing.cjs'), 'utf8');
  assert.ok(sizing.includes('popup?.webContents||window?.webContents'));
});
