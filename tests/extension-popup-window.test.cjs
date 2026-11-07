'use strict';
// An extension's toolbar popup was a bare square rectangle flush against the toolbar (founder, 6 Nov 2026). electron-chrome-extensions makes its
// window with `roundedCorners: false` and a BrowserWindow's own page cannot be clipped, so Acira makes the window (desktop/browser-services/
// extension-popup-window.cjs): the system's rounded frame where there is one, Acira's menu radius (8 px x Interface size) on macOS, the same size
// logic, the same lifecycle. These tests pin the frame per platform, the lifecycle the library's PopupView had, and the engine hook.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events'), fs = require('node:fs'), path = require('node:path');
const {ExtensionPopup, popupFrame, installPopupFrames, BOUNDS, MATERIAL_RADIUS} = require('../desktop/browser-services/extension-popup-window.cjs');
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

function fixture({platform = 'darwin', zoom = 1, content = rect(260, 69, 1088, 700), area = rect(0, 29, 1352, 795), anchorRect = rect(845, 39, 30, 30)} = {}) {
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
  const popup = new ExtensionPopup({extensionId: 'nngceckbapebfimnlniiiahkandclblb', session: {name: 'session'}, parent, url: 'chrome-extension://nngceckbapebfimnlniiiahkandclblb/popup/index.html', anchorRect, alignment: 'bottom right'}, {electron, platform});
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
  const linux = fixture({platform: 'linux'});
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

function engineFixture({withPopupUrl = true, withTab = true, withWindow = true} = {}) {
  const f = fixture();
  const calls = [], emitted = [];
  const tab = {id: 7};
  const engine = {
    popup: undefined,
    ctx: {session: {name: 'session'}, emit: (name, popup) => emitted.push([name, popup]), router: {sendEvent: (...args) => calls.push(['sendEvent', ...args])},
      store: {getTabById: id => (withTab && id === 7 ? tab : undefined), getActiveTabOfCurrentWindow: () => (withTab ? tab : undefined), tabToWindow: new WeakMap(withWindow ? [[tab, f.parent]] : []), tabDetailsCache: new Map([[7, {id: 7}]])}},
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

test('an action with no popup page, no tab or no window is the library\'s own answer (onClicked, its errors)', () => {
  for (const options of [{withPopupUrl: false}, {withTab: false}, {withWindow: false}]) {
    const e = engineFixture(options);
    installPopupFrames(e.runtime, {electron: e.electron, platform: 'darwin'});
    click(e);
    assert.deepEqual(e.calls.filter(call => call[0] === 'library activateClick'), [['library activateClick', 'aaaa']], JSON.stringify(options));
    assert.equal(e.emitted.length, 0);
  }
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
  const hooks = toolbar.split("installPopupFrames(runtime);").length - 1;
  assert.equal(hooks, 2);
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
