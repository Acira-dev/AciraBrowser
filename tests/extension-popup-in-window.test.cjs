'use strict';
// 13.6, bug A of the Linux report (9 Nov 2026): on Wayland an app cannot place its windows, so the toolbar popup (a window of its own) landed wherever the
// compositor put it. Where the window system cannot place windows the popup is now a view inside the browser window, placed by Acira from the icon's rectangle
// (desktop/browser-services/extension-popup-host.cjs, extension-popup-window.cjs). Mac, Windows and Linux on X11 keep the window they always had.
// Wayland is emulated here the way the real thing behaves: the window answers { 0, 0 } to getBounds() and drops the position of setBounds().
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ExtensionPopup, installPopupFrames, closeInWindowPopups, popupOf} = require('../desktop/browser-services/extension-popup-window.cjs');
const host = require('../desktop/browser-services/extension-popup-host.cjs');
const {popupHostFor, rimLayers} = host;
const RIMS = rimLayers(false);
const {GAP, MARGIN} = require('../desktop/browser-services/extension-popup-placement.cjs');
const {isFollowScript} = require('../desktop/browser-services/extension-popup-follow.cjs');
const {METRICS_SCRIPT} = require('../desktop/browser-services/extension-popup-fit.cjs');

const WAYLAND = {XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0'}, X11 = {XDG_SESSION_TYPE: 'x11', DISPLAY: ':0'};

class FakeContents extends EventEmitter {
  constructor() { super(); this.urls = []; this.closed = false; this.focusCalls = 0; this.focused = false; }
  loadURL(url) { this.urls.push(url); return Promise.resolve(); }
  isDestroyed() { return this.closed; } isDevToolsOpened() { return false; } closeDevTools() {} close() { this.closed = true; this.emit('destroyed'); }
  getURL() { return this.urls[this.urls.length - 1] || ''; } setWindowOpenHandler() {} getZoomFactor() { return this.zoom || 1; }
  focus() { this.focusCalls++; this.focused = true; } isFocused() { return this.focused; }
}
class FakeView {
  constructor() { this.webContents = new FakeContents(); this.bounds = {x: 0, y: 0, width: 0, height: 0}; this.visible = true; this.children = []; this.radius = 0; }
  setBackgroundColor(color) { this.background = color; } setBorderRadius(radius) { this.radius = radius; } setBounds(bounds) { this.bounds = {...bounds}; } getBounds() { return {...this.bounds}; }
  setVisible(visible) { this.visible = visible; }
}
class FakeRim extends FakeView { setBackgroundColor(color) { this.color = color; } }
/** The browser window: a Wayland-like one answers { 0, 0 } for its position; its content is a stack of views (the order of addChildView is the order on screen, last on top). */
class FakeBrowserWindow extends EventEmitter {
  constructor(width = 1088, height = 700) {
    super();
    this.width = width; this.height = height; this.destroyed = false; this.focused = true;
    this.stack = [];
    this.contentView = {get children() { return stack(); }, addChildView: view => { const at = this.stack.indexOf(view); if (at >= 0) this.stack.splice(at, 1); this.stack.push(view); }, removeChildView: view => { const at = this.stack.indexOf(view); if (at >= 0) this.stack.splice(at, 1); }};
    const stack = () => this.stack;
  }
  getBounds() { return {x: 0, y: 0, width: this.width, height: this.height}; }
  getContentBounds() { return this.getBounds(); }
  isFocused() { return this.focused; } isDestroyed() { return this.destroyed; } getTitle() { return 'Acira'; }
}
/** Window popups (the old host) on a Wayland-like system: the position is dropped, the compositor's own spot stays. */
class WaylandWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.size = {width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false; this.focused = false;
    this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)};
    WaylandWindow.all.push(this);
  }
  getBounds() { return {x: 0, y: 0, ...this.size}; } getContentBounds() { return this.getBounds(); } setBounds(bounds) { this.size = {width: bounds.width, height: bounds.height}; }
  show() { this.visible = true; } isVisible() { return this.visible; } isFocused() { return this.focused; } getParentWindow() { return null; }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.visible = false; }
}
WaylandWindow.all = [];
WaylandWindow.getAllWindows = () => WaylandWindow.all.filter(window => !window.destroyed);

function setup({size = [1088, 700], zoom = 1, anchorRect = {x: 950, y: 3, width: 30, height: 30}, env = WAYLAND, platform = 'linux', ozone = ''} = {}) {
  WaylandWindow.all = []; host.forgetForTests();
  const parent = new FakeBrowserWindow(...size);
  const ui = new FakeView(); ui.webContents.urls.push('acira-browser-ui://ui/index.html'); ui.webContents.zoom = zoom; ui.bounds = {x: 0, y: 0, width: size[0], height: size[1]};
  parent.contentView.addChildView(ui);
  const Base = class extends WaylandWindow {}; Base.getAllWindows = () => [parent, ...WaylandWindow.getAllWindows()]; Base.fromId = () => null;
  const electron = {BaseWindow: Base, WebContentsView: FakeView, View: FakeRim, BrowserWindow: {getAllWindows: () => []}, nativeTheme: {shouldUseDarkColors: false},
    app: {commandLine: {getSwitchValue: name => (name === 'ozone-platform' ? ozone : '')}}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 0, width: 1920, height: 1080}})}};
  const make = (extra = {}) => new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html', anchorRect, alignment: 'bottom right', ...extra}, {electron, platform, env, diagnostics: () => {}});
  return {parent, ui, electron, make};
}
const open = async (f, size, extra) => { const popup = f.make(extra); await popup.whenReady(); popup.webContents.emit('preferred-size-changed', {}, size); return popup; };
const shownOnTop = (parent, popup) => parent.stack[parent.stack.length - 1] === popup.view;

// ---- which host

test('popupHostFor: Mac and Windows always keep the window; Linux gets the in-window view only where the system cannot place windows (a Wayland session, the wayland ozone switch, or a window that already answered { 0, 0 })', () => {
  for (const platform of ['darwin', 'win32']) assert.equal(popupHostFor({platform, env: WAYLAND}), 'window', platform);
  assert.equal(popupHostFor({platform: 'linux', env: X11}), 'window');
  assert.equal(popupHostFor({platform: 'linux', env: {}}), 'window', 'no session facts: as before');
  assert.equal(popupHostFor({platform: 'linux', env: WAYLAND}), 'parent');
  assert.equal(popupHostFor({platform: 'linux', env: {WAYLAND_DISPLAY: 'wayland-1'}}), 'parent');
  assert.equal(popupHostFor({platform: 'linux', env: WAYLAND, ozone: 'x11'}), 'window', '--ozone-platform=x11 runs through XWayland, where positions work');
  assert.equal(popupHostFor({platform: 'linux', env: X11, ozone: 'wayland'}), 'parent');
  assert.equal(popupHostFor({platform: 'linux', env: X11, learned: true}), 'parent');
  // the test switch needs a test profile; a person's own profile cannot be pushed into the other host from the environment
  assert.equal(popupHostFor({platform: 'darwin', env: {ACIRA_BROWSER_TEST_DATA: '/tmp/x', ACIRA_POPUP_HOST: 'parent'}}), 'parent');
  assert.equal(popupHostFor({platform: 'darwin', env: {ACIRA_POPUP_HOST: 'parent'}}), 'window');
  assert.equal(popupHostFor({platform: 'linux', env: {...WAYLAND, ACIRA_BROWSER_TEST_DATA: '/tmp/x', ACIRA_POPUP_HOST: 'window'}}), 'window');
});

test('on Mac, Windows and Linux X11 the popup is the window it always was: no view in the browser window, no rims', () => {
  for (const [platform, env] of [['darwin', WAYLAND], ['win32', WAYLAND], ['linux', X11]]) {
    const f = setup({platform, env}), popup = f.make();
    assert.equal(popup.hostKind, 'window', platform);
    assert.equal(f.parent.stack.length, 1, 'only the interface is in the browser window');
    assert.ok(WaylandWindow.all.length === 1 && WaylandWindow.all[0] === popup.window);
    popup.destroy();
  }
});

// ---- where it is drawn (pictures A1, A2, A1b)

test('A1 / A2: under the icon, its right edge on the icon\'s, inside the browser window, at the sizes of the pictures (324 x 204 and 600 x 430); no screen coordinate is read', async () => {
  for (const [width, height] of [[324, 204], [600, 430]]) {
    const f = setup(), popup = await open(f, {width, height});
    assert.equal(popup.hostKind, 'parent');
    const b = popup.view.bounds;
    assert.deepEqual([b.width, b.height], [width, height]);
    assert.equal(b.y, 3 + 30 + GAP, 'under the icon');
    assert.equal(b.x + b.width, 950 + 30, 'right edge on the icon\'s right edge (the icon is in the right half)');
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1088 && b.y + b.height <= 700);
    assert.equal(popup.window.getBounds().x, b.x, 'the stand-in reports the view\'s place in the window');
    assert.equal(WaylandWindow.all.length, 0, 'no window of its own was made');
    popup.destroy();
  }
});

test('A1b: from the Settings row (the window is too short for 430 px below the icon) it slides up and stays inside, as the window popup does', async () => {
  const f = setup({anchorRect: {x: 1002, y: 396, width: 30, height: 30}});
  const popup = await open(f, {width: 600, height: 430});
  const b = popup.view.bounds;
  assert.equal(b.height, 430);
  assert.equal(b.y + b.height, 700 - MARGIN, 'slid up to the window\'s bottom margin');
  assert.ok(b.x + b.width <= 1088 - MARGIN && b.x >= MARGIN);
});

test('Interface size: the icon\'s rectangle is in CSS px of a zoomed page, the gap and margin grow with it, and the interface page\'s own origin is the origin', async () => {
  const f = setup({zoom: 1.5, anchorRect: {x: 600, y: 2, width: 30, height: 30}});
  f.ui.bounds = {x: 10, y: 20, width: 1088, height: 700};
  const popup = await open(f, {width: 300, height: 200});
  const b = popup.view.bounds;
  assert.equal(b.y, 20 + 2 * 1.5 + 30 * 1.5 + GAP * 1.5);
  assert.equal(b.x + b.width, 10 + 600 * 1.5 + 30 * 1.5);
});

test('the size follows the page up to 800 x 600 and never past the browser window: a short or narrow window holds less, the page scrolls inside', async () => {
  let f = setup(), popup = await open(f, {width: 2000, height: 2000});
  assert.deepEqual([popup.view.bounds.width, popup.view.bounds.height], [800, 600]);
  f = setup({size: [500, 400], anchorRect: {x: 440, y: 3, width: 30, height: 30}}); popup = await open(f, {width: 2000, height: 2000});
  assert.deepEqual([popup.view.bounds.width, popup.view.bounds.height], [500 - 2 * MARGIN, 400 - 2 * MARGIN]);
  assert.ok(popup.view.bounds.x >= 0 && popup.view.bounds.y >= 0 && popup.view.bounds.x + popup.view.bounds.width <= 500 && popup.view.bounds.y + popup.view.bounds.height <= 400);
  popup.webContents.emit('preferred-size-changed', {}, {width: 100, height: 100});
  assert.deepEqual([popup.view.bounds.width, popup.view.bounds.height], [100, 100], 'and back down with the page');
});

// ---- on top, nothing under it, the keyboard in it

test('the popup is added on top of the interface and every page, in a frame of Acira\'s menu radius with a hairline under it, hidden until the page has a size, and takes the keyboard', async () => {
  const f = setup({zoom: 1.25}), popup = f.make();
  await popup.whenReady();
  assert.equal(popup.view.visible, false, 'hidden until the page says how big it is');
  assert.equal(f.parent.stack.length, 1 + RIMS.length + 1);
  assert.equal(popup.view.radius, 10, 'the menus\' 8 px x Interface size');
  assert.equal(popup.webContents.focusCalls, 0);
  popup.webContents.emit('preferred-size-changed', {}, {width: 300, height: 200});
  assert.equal(popup.view.visible, true);
  assert.ok(shownOnTop(f.parent, popup), 'on top of everything in the window');
  assert.equal(popup.webContents.focusCalls, 1, 'the page has the keyboard');
  const rims = f.parent.stack.slice(1, -1);
  assert.equal(rims.length, RIMS.length);
  assert.ok(rims.every(rim => rim.visible && rim.bounds.width > 300 && rim.bounds.height > 200), 'each rim is a little larger than the page and under it');
  assert.ok(rims.some(rim => rim.bounds.x === popup.view.bounds.x - 1 && rim.bounds.width === 302), 'the hairline is one pixel around it');
  // a page view added later goes on top of the interface but the popup is raised again when it shows: here it was added first and stays above
  const later = new FakeView(); f.parent.contentView.addChildView(later);
  popup.show();
  assert.ok(shownOnTop(f.parent, popup));
});

// ---- how it closes

test('it closes when the keyboard goes to another view of the window (an outside press), on Escape, and when the window changes shape or hides; the page and the views go with it', async () => {
  const closers = [
    ['blur', popup => popup.window.emit('blur')],
    ['the page losing the keyboard', popup => popup.webContents.emit('blur')],
    ['Escape', popup => { const event = {preventDefault() { this.prevented = true; }}; popup.webContents.emit('before-input-event', event, {type: 'keyDown', key: 'Escape'}); assert.equal(event.prevented, true); }],
    ['resize', popup => popup.parent.emit('resize')], ['move', popup => popup.parent.emit('move')], ['maximize', popup => popup.parent.emit('maximize')],
    ['enter-full-screen', popup => popup.parent.emit('enter-full-screen')], ['minimize', popup => popup.parent.emit('minimize')],
    ['the window closing', popup => popup.parent.emit('closed')],
  ];
  for (const [name, close] of closers) {
    const f = setup(), popup = await open(f, {width: 300, height: 200});
    assert.equal(popup.destroyed, false, name);
    close(popup);
    assert.equal(popup.destroyed, true, name);
    assert.equal(f.parent.stack.length, 1, `${name}: the page and its rims left the window`);
    assert.equal(popup.webContents.isDestroyed(), true, `${name}: its page is closed`);
  }
});

test('other keys and presses inside the popup do not close it, nor does the window reporting hide (it takes its views with it)', async () => {
  const f = setup(), popup = await open(f, {width: 300, height: 200});
  f.parent.emit('hide');
  popup.webContents.emit('before-input-event', {}, {type: 'keyDown', key: 'a'});
  popup.webContents.emit('before-input-event', {}, {type: 'keyUp', key: 'Escape'});
  popup.window.emit('focus');
  assert.equal(popup.destroyed, false);
});

test('a tab switch or a navigation closes the popups of that window (closeInWindowPopups, called where the active page changes), and no other window\'s', async () => {
  const f = setup(), popup = await open(f, {width: 300, height: 200});
  const other = setup(); const stranger = await open(other, {width: 300, height: 200});
  assert.equal(closeInWindowPopups(f.parent), 1);
  assert.equal(popup.destroyed, true);
  assert.equal(stranger.destroyed, false, 'another browser window\'s popup stays');
  assert.equal(closeInWindowPopups(f.parent), 0);
  const win = setup({platform: 'darwin'}), windowPopup = await open(win, {width: 300, height: 200});
  assert.equal(closeInWindowPopups(win.parent), 0, 'a window popup is not touched: it closes on focus as it always did');
  assert.equal(windowPopup.destroyed, false);
  closeInWindowPopups(undefined);
  assert.equal(stranger.destroyed, true, 'with no window named, every in-window popup closes');
});

test('popupOf finds the in-window popup whose page has the keyboard (Close Tab and Reload act on it, not on the tab behind)', async () => {
  const f = setup(), popup = await open(f, {width: 300, height: 200});
  assert.equal(popupOf(popup.webContents), popup);
  popup.destroy();
  assert.equal(popupOf(popup.webContents), null);
});

// ---- the button

test('pressing the extension\'s own button while its popup is open: the press closes it (the press, at the button\'s place) and the click that completes that press is the toggle, not a new open; a press anywhere else is not', async () => {
  const f = setup();
  const engine = {popup: undefined, ctx: {store: {tabToWindow: new Map(), createTab() {}}, session: {extensions: new EventEmitter()}, emit() {}}, getPopupUrl: id => `chrome-extension://${id}/popup.html`, activateClick() { throw new Error('the library\'s own'); }};
  const tab = {id: 5};
  engine.ctx.store.tabToWindow.set(tab, f.parent); engine.ctx.store.getTabById = () => tab; engine.ctx.store.getActiveTabOfCurrentWindow = () => tab;
  assert.equal(installPopupFrames({api: {browserAction: engine}}, {electron: f.electron, platform: 'linux'}), true);
  const click = () => engine.activateClick({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', tabId: 5, anchorRect: {x: 950, y: 3, width: 30, height: 30}, alignment: 'bottom right'});
  const press = (x, y) => f.ui.webContents.emit('before-mouse-event', {}, {type: 'mouseDown', x, y});
  const saved = {...process.env}; Object.assign(process.env, WAYLAND);
  try {
    click();
    const first = engine.popup;
    assert.equal(first.hostKind, 'parent');
    await first.whenReady(); first.webContents.emit('preferred-size-changed', {}, {width: 300, height: 200});
    press(965, 18);                                   // the press, on the button
    assert.equal(first.destroyed, true);
    click();                                          // the click that completes it
    assert.equal(engine.popup, undefined, 'it closed and stayed closed');
    click();                                          // a new press and click opens it
    const second = engine.popup;
    assert.ok(second && second !== first && !second.destroyed);
    await second.whenReady(); second.webContents.emit('preferred-size-changed', {}, {width: 300, height: 200});   // (a popup is shown once its page has loaded)
    press(400, 300);                                  // a press elsewhere closes it, and is not half of a click on the button
    assert.equal(second.destroyed, true);
    assert.equal(second.closedByAnchorPressAt, undefined);
    click();
    assert.ok(engine.popup && engine.popup !== second && !engine.popup.destroyed, 'the next click on the button opens it');
    // the blur path (the keyboard moved by other means) is never a toggle either
    const third = engine.popup; await third.whenReady(); third.webContents.emit('preferred-size-changed', {}, {width: 300, height: 200});   // (a popup is shown once its page has loaded)
    third.window.emit('blur');
    assert.equal(third.destroyed, true); assert.equal(third.closedByAnchorPressAt, undefined);
    click();
    assert.ok(engine.popup && engine.popup !== third && !engine.popup.destroyed);
    // a click long after the press (not the same one) opens it
    const fourth = engine.popup; await fourth.whenReady(); fourth.webContents.emit('preferred-size-changed', {}, {width: 300, height: 200});
    press(965, 18); fourth.closedByAnchorPressAt -= 5000;
    click();
    assert.ok(engine.popup && engine.popup !== fourth && !engine.popup.destroyed);
    // clicking while it is open and nothing pressed first (a keyboard click) still toggles it shut
    const live = engine.popup; click();
    assert.equal(live.destroyed, true);
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});

// ---- Wayland found out by asking

test('a Linux window popup that is not where it was asked (the system answers { 0, 0 }) makes every later popup of the run a view of the browser window', async () => {
  const f = setup({platform: 'linux', env: {}});            // nothing in the environment says Wayland
  const first = f.make(); await first.whenReady();
  assert.equal(first.hostKind, 'window');
  first.webContents.emit('preferred-size-changed', {}, {width: 27, height: 100});
  assert.ok(first.asked.x > 800, 'the window path asked for a spot');
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.equal(host.learned(), true);
  const second = f.make(); assert.equal(second.hostKind, 'parent');
  host.forgetForTests();
  // an honest window system teaches nothing
  const honest = setup({platform: 'linux', env: {}}); honest.electron.BaseWindow = class extends WaylandWindow { getBounds() { return {x: this.at.x, y: this.at.y, ...this.size}; } setBounds(b) { this.at = {x: b.x, y: b.y}; this.size = {width: b.width, height: b.height}; } };
  const popup = honest.make(); await popup.whenReady(); popup.webContents.emit('preferred-size-changed', {}, {width: 300, height: 200});
  await new Promise(resolve => setTimeout(resolve, 380));
  assert.equal(host.learned(), false);
  host.forgetForTests();
});

// ---- main.cjs: the page under the popup changed

test('main closes the in-window popups of its window when the active tab changes or navigates, and does nothing while the page stays', async () => {
  const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '../desktop/main.cjs'), 'utf8');
  const start = text.indexOf("let popupContext='';"), end = text.indexOf('function broadcast(key){');
  assert.ok(start > 0 && end > start, 'the hook is in main.cjs');
  assert.match(text.slice(end, end + 200), /noteExtensionPopupContext\(\)/, 'broadcast calls it after every state change');
  const f = setup(), popup = await open(f, {width: 300, height: 200});
  const state = {tabs: [{id: 'a', url: 'https://a.example/'}, {id: 'b', url: 'https://b.example/'}], activeTabId: 'a'};
  const run = new Function('state', 'mainWindow', 'require', `${text.slice(start, end)}; return noteExtensionPopupContext;`)(state, f.parent, () => ({closeInWindowPopups: window => closeInWindowPopups(window)}));
  run();                                      // the first look only records the page
  assert.equal(popup.destroyed, true, 'a popup open at the first look is closed: it belongs to a page that was already there');
  const again = await open(f, {width: 300, height: 200});
  run(); run();
  assert.equal(again.destroyed, false, 'the same page: nothing closes');
  state.tabs[0].url = 'https://a.example/next'; run();
  assert.equal(again.destroyed, true, 'a navigation closes it');
  const third = await open(f, {width: 300, height: 200});
  state.activeTabId = 'b'; run();
  assert.equal(third.destroyed, true, 'a tab switch closes it');
  state.tabs = []; state.activeTabId = null;
  assert.doesNotThrow(() => run());
});

test('a mouse press on any other view of the window closes the popup at once, whether or not the keyboard moved; a release, a move or a press inside the popup does not; the listeners go with the popup', async () => {
  const f = setup(), page = new FakeView(); page.webContents.urls.push('https://example.com/'); f.parent.contentView.addChildView(page);
  const popup = await open(f, {width: 300, height: 200});
  for (const view of [f.ui, page]) assert.equal(view.webContents.listenerCount('before-mouse-event'), 1, 'watching every other view');
  assert.equal(popup.webContents.listenerCount('before-mouse-event'), 0, 'not its own page');
  page.webContents.emit('before-mouse-event', {}, {type: 'mouseUp'}); page.webContents.emit('before-mouse-event', {}, {type: 'mouseMove'}); popup.webContents.emit('before-mouse-event', {}, {type: 'mouseDown'});
  assert.equal(popup.destroyed, false);
  f.ui.webContents.emit('before-mouse-event', {}, {type: 'mouseDown'});
  assert.equal(popup.destroyed, true);
  assert.equal(popup.closedByAnchorPressAt, undefined, 'a press on another view is not a press on the button');
  for (const view of [f.ui, page]) assert.equal(view.webContents.listenerCount('before-mouse-event'), 0, 'the listeners went with it');
  const again = await open(f, {width: 300, height: 200}); again.destroy();
  assert.equal(page.webContents.listenerCount('before-mouse-event'), 0);
});

test('the popup\'s edge follows Acira\'s menu tokens: a ring that is black at a few percent in light and white at 10 % in dark, outermost soft layers first, the ring last and one pixel out; the dark frame is the heavier shadow', async () => {
  const light = setup(), dark = setup();
  dark.electron.nativeTheme.shouldUseDarkColors = true;
  const lp = await open(light, {width: 300, height: 200}), dp = await open(dark, {width: 300, height: 200});
  const colors = popup => popup.window.rims.map(rim => rim.color);
  assert.deepEqual(colors(lp), rimLayers(false).map(layer => layer[2]));
  assert.deepEqual(colors(dp), rimLayers(true).map(layer => layer[2]));
  assert.match(colors(lp).slice(-1)[0], /^rgba\(0,0,0,/, 'the light ring is black');
  assert.match(colors(dp).slice(-1)[0], /^rgba\(255,255,255,0\.10\)$/, 'the dark ring is white at 10 %, the menu\'s dark rim');
  const grows = layers => layers.map(layer => layer[0]);
  assert.equal(grows(rimLayers(false)).slice(-1)[0], 1);
  assert.deepEqual(grows(rimLayers(false)), [...grows(rimLayers(false))].sort((a, b) => b - a), 'outermost first, so each layer sits under the next');
  const alpha = layers => layers.slice(0, -2).reduce((sum, layer) => sum + Number(/,([\d.]+)\)$/.exec(layer[2])[1]), 0);
  assert.ok(alpha(rimLayers(true)) > alpha(rimLayers(false)) * 4, 'the dark shadow is much stronger, as --menu-e2 is');
});

test('13.8: a popup inside the browser window follows its page down too (the follower is the same; the browser window\'s own area is the limit)', async () => {
  const f = setup(), popup = f.make();
  await popup.whenReady();
  const page = {content: 320};
  popup.webContents.executeJavaScript = async script => {
    const w = popup.size.width, h = popup.size.height;
    if (isFollowScript(script)) return {iw: w, ih: h, ch: h, eh: page.content, pins: 3};
    assert.equal(script, METRICS_SCRIPT);
    return {iw: w, ih: h, cw: w, ch: h, sw: w, sh: Math.max(h, page.content), fh: h};
  };
  Object.assign(popup.follower, {pollMs: 5, quietPollMs: 5, nudgeMs: 3, settleMs: 0});
  popup.webContents.emit('preferred-size-changed', {}, {width: 300, height: 320});
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(popup.hostKind, 'parent');
  assert.equal(popup.size.height, 320);
  page.content = 100;   // the page follows its window (html { height: 100% }): no report, the window stays 320 tall on 13.7
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(popup.size.height, 100, 'the in-window popup comes down to its page');
  assert.equal(popup.size.width, 300);
  assert.equal(f.parent.stack.length > 1, true, 'and is still a view of the browser window');
  popup.destroy();
});
