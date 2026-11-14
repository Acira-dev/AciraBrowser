'use strict';
// 13.8, a hand test (Mac): "when I'm in Seamless mode and I press on an extension, the top bar or sidebar I'm working in should stay there, even though I
// opened the extension." The popup is a window of its own that takes the keyboard, so the browser window was deactivated and the edge controller hid the bar under the
// open popup (edge-reveal.cjs: "Window deactivation hides at once, unless something holds the edge open"); a popup that is a view of the window (Wayland) leaves the
// focus alone but the pointer goes down into it and the grace runs out. desktop/edge-popup-hold.cjs holds the edge a popup was opened from for as long as it is open.
// No Electron starts here: the popup class runs on stand-ins for the windows and views, the controller on a fake clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {zonesFor, createPopupHold, noteExtensionPopup, OPENING_MS} = require('../desktop/edge-popup-hold.cjs');
const {createEdgeController, GRACE, MIN_VISIBLE} = require('../desktop/edge-reveal.cjs');
const {ExtensionPopup, installPopupFrames} = require('../desktop/browser-services/extension-popup-window.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('desktop/main.cjs');
const rect = (x, y, width, height) => ({x, y, width, height});

// ---- zonesFor: which of the shown bars a popup came from

const SIZE = {topHeight: 72, sideWidth: 240};

test('zonesFor: nothing shown holds nothing (a shortcut pressed while no bar is up)', () => {
  assert.deepEqual(zonesFor({anchor: rect(845, 39, 30, 30), size: SIZE, shown: {top: false, side: false}}), {top: false, side: false});
  assert.deepEqual(zonesFor({anchor: rect(845, 39, 30, 30), size: SIZE, shown: null}), {top: false, side: false});
});

test('zonesFor: the button in the top bar holds the top bar; the button in the sidebar holds the sidebar (the other bar, if it is also up, is not held)', () => {
  const both = {top: true, side: true};
  assert.deepEqual(zonesFor({anchor: rect(845, 20, 30, 30), size: SIZE, shown: both, width: 1200}), {top: true, side: false});
  assert.deepEqual(zonesFor({anchor: rect(20, 300, 30, 30), size: SIZE, shown: both, width: 1200}), {top: false, side: true});
  assert.deepEqual(zonesFor({anchor: rect(845, 20, 30, 30), size: SIZE, shown: {top: true, side: false}}), {top: true, side: false});
  assert.deepEqual(zonesFor({anchor: rect(20, 300, 30, 30), size: SIZE, shown: {top: false, side: true}}), {top: false, side: true});
});

test('zonesFor: a sidebar on the right is measured from the right, and the Interface size scales the box (CSS px to DIPs)', () => {
  assert.deepEqual(zonesFor({anchor: rect(1150, 300, 30, 30), size: SIZE, shown: {top: true, side: true}, width: 1200, sidebarSide: 'right'}), {top: false, side: true});
  assert.deepEqual(zonesFor({anchor: rect(20, 300, 30, 30), size: SIZE, shown: {top: true, side: true}, width: 1200, sidebarSide: 'right'}), {top: true, side: true}, 'on the left it is in neither: both shown bars');
  // 125 %: the button's centre is at (200, 40) CSS px = (250, 50) DIPs: under the 72 high top bar, past the 240 wide sidebar
  assert.deepEqual(zonesFor({anchor: rect(185, 25, 30, 30), scale: 1.25, size: SIZE, shown: {top: true, side: true}}), {top: true, side: false});
  assert.deepEqual(zonesFor({anchor: rect(185, 25, 30, 30), scale: 1, size: SIZE, shown: {top: true, side: true}}), {top: true, side: true}, 'at 100 % the same box is in the corner both bars share');
});

test('zonesFor: a box in neither bar, an unknown or empty one (the extensions menu, a button that is not drawn) holds whatever is shown', () => {
  const shown = {top: true, side: false};
  assert.deepEqual(zonesFor({anchor: rect(500, 400, 30, 30), size: SIZE, shown}), shown, 'in neither');
  assert.deepEqual(zonesFor({anchor: rect(0, 0, 0, 0), size: SIZE, shown}), shown, 'a stale rectangle of 0 x 0');
  assert.deepEqual(zonesFor({anchor: undefined, size: SIZE, shown}), shown);
  assert.deepEqual(zonesFor({anchor: {x: NaN, y: 1, width: 10, height: 10}, size: SIZE, shown}), shown);
  assert.deepEqual(zonesFor({anchor: rect(20, 300, 30, 30), size: undefined, shown: {top: true, side: true}}), {top: true, side: true}, 'no sizes');
  assert.deepEqual(zonesFor({anchor: rect(20, 300, 30, 30), size: SIZE, shown: {top: false, side: true}, sidebarSide: 'right', width: 1200}), {top: false, side: true}, 'only the shown bar can be held');
});

// ---- the hold itself

function popupStub({anchorRect = rect(845, 20, 30, 30), parent = {id: 1}} = {}) {
  const popup = new EventEmitter();
  Object.assign(popup, {anchorRect, parent, destroyed: false, hidden: true, isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; this.emit('gone'); }});
  return popup;
}
function holdFor({shown = {top: true, side: false}, clock = {t: 1000}, window = {id: 1, isDestroyed: () => false}} = {}) {
  const hold = createPopupHold({window: () => window, shown: () => shown, geometry: () => ({scale: 1, size: SIZE, width: 1200, sidebarSide: 'left'}), now: () => clock.t});
  return {hold, clock, window, shown};
}

test('a popup holds its bar while it exists and lets go the moment it is gone; the holds the interface sent are kept and returned as they are when no popup is open', () => {
  const {hold} = holdFor();
  const base = {top: false, side: true};
  assert.equal(hold.merge(base), base, 'no popup: the very same object');
  const popup = popupStub();
  assert.ok(hold.add(popup));
  assert.deepEqual(hold.merge(base), {top: true, side: true});
  assert.deepEqual(hold.holds(), {top: true, side: false});
  popup.destroy();
  assert.equal(hold.open, 0);
  assert.equal(hold.merge(base), base);
  assert.deepEqual(hold.holds(), {top: false, side: false});
});

test('two popups: the bar stays held until the last is gone (an engine that closes one and opens the next in the same tick leaves no gap)', () => {
  const {hold} = holdFor();
  const first = popupStub(), second = popupStub();
  hold.add(first); hold.add(second);
  first.destroy();
  assert.deepEqual(hold.holds(), {top: true, side: false});
  second.destroy();
  assert.deepEqual(hold.holds(), {top: false, side: false});
});

test('a popup dropped without saying so (destroyed, no "gone") ends its hold at the next look; one that never shows holds only while it is opening', () => {
  const dropped = holdFor();
  const popup = popupStub();
  dropped.hold.add(popup);
  popup.destroyed = true;
  assert.deepEqual(dropped.hold.holds(), {top: false, side: false});
  const slow = holdFor();
  const loading = popupStub();
  slow.hold.add(loading);
  slow.clock.t += OPENING_MS - 1;
  assert.deepEqual(slow.hold.holds(), {top: true, side: false}, 'still opening');
  slow.clock.t += 2;
  assert.deepEqual(slow.hold.holds(), {top: false, side: false}, 'a page that never loads does not keep a bar open for good');
  loading.hidden = false;
  assert.deepEqual(slow.hold.holds(), {top: true, side: false}, 'but a popup that is on screen holds for as long as it is');
});

test('nothing shown at the popup, or no popup at all: no hold is taken', () => {
  const none = holdFor({shown: {top: false, side: false}});
  assert.equal(none.hold.add(popupStub()), null);
  assert.equal(none.hold.open, 0);
  assert.equal(none.hold.add(null), null);
  assert.equal(none.hold.add({}), null);
  const broken = createPopupHold({window: () => ({id: 1}), shown: () => { throw new Error('no edge yet'); }});
  assert.equal(broken.add(popupStub()), null, 'a window with no edge state yet takes none and does not throw');
});

test('noteExtensionPopup: the popup goes to the window it belongs to (by object or by id), never to another window or a closed one', () => {
  const a = holdFor({window: {id: 11, isDestroyed: () => false}}), b = holdFor({window: {id: 12, isDestroyed: () => false}});
  const closed = holdFor({window: {id: 13, isDestroyed: () => true}});
  noteExtensionPopup(popupStub({parent: {id: 12}}));
  assert.deepEqual([a.hold.open, b.hold.open, closed.hold.open], [0, 1, 0]);
  noteExtensionPopup(popupStub({parent: a.window}));
  assert.deepEqual([a.hold.open, b.hold.open], [1, 1]);
  noteExtensionPopup(popupStub({parent: undefined}));
  noteExtensionPopup(null);
  assert.deepEqual([a.hold.open, b.hold.open], [1, 1], 'a popup with no window, or none at all: nobody holds');
});

// ---- the real popup class and the engine hook, with the toolbar glue's listener

class FakeContents extends EventEmitter {
  constructor(options) { super(); this.options = options; this.urls = []; this.closed = false; }
  loadURL(url) { this.urls.push(url); return Promise.resolve(); }
  isDestroyed() { return this.closed; }
  isDevToolsOpened() { return false; }
  closeDevTools() {}
  close() { this.closed = true; }
  getURL() { return this.urls[this.urls.length - 1] || ''; }
  setWindowOpenHandler() {}
  focus() {}
}
class FakeView {
  constructor(options) { this.options = options; this.webContents = new FakeContents(options); }
  setBackgroundColor() {}
  setBorderRadius() {}
  setBounds(bounds) { this.bounds = bounds; }
}
class FakeWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options; this.bounds = {x: 0, y: 0, width: options.width || 0, height: options.height || 0}; this.destroyed = false; this.focused = false; this.visible = false;
    this.contentView = {children: [], addChildView: view => this.contentView.children.push(view)};
    this.id = FakeWindow.all.push(this);
  }
  getBounds() { return {...this.bounds}; }
  setBounds(bounds) { this.bounds = {...bounds}; }
  getContentBounds() { return this.content || this.getBounds(); }
  getParentWindow() { return null; }
  show() { this.visible = true; }
  isFocused() { return this.focused; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
}
FakeWindow.all = [];
FakeWindow.getAllWindows = () => FakeWindow.all.filter(window => !window.destroyed);
FakeWindow.fromId = id => FakeWindow.all.find(window => window.id === id && !window.destroyed) || null;

/** An engine as the toolbar glue sees it: the library's `activateClick` patched by installPopupFrames, its 'browser-action-popup-created' event on `runtime`, and the listener extension-toolbar.cjs registers. */
function chain({shown = {top: true, side: false}, platform = 'darwin', env = {}} = {}) {
  FakeWindow.all = [];
  const parent = new FakeWindow({});
  parent.content = rect(0, 0, 1200, 800);
  const tab = {id: 7};
  const runtime = new EventEmitter();
  const engine = {
    popup: undefined,
    ctx: {session: {name: 'session', extensions: new EventEmitter()}, emit: (name, popup) => runtime.emit(name, popup), router: {sendEvent() {}},
      store: {getTabById: id => (id === 7 ? tab : undefined), getActiveTabOfCurrentWindow: () => tab, tabToWindow: new WeakMap([[tab, parent]]), tabDetailsCache: new Map([[7, {id: 7}]])}},
    getPopupUrl: extensionId => 'chrome-extension://' + extensionId + '/popup.html',
    activateClick() { throw new Error('the library\'s own click: not expected'); },
  };
  runtime.api = {browserAction: engine};
  const electron = {BaseWindow: FakeWindow, WebContentsView: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: rect(0, 0, 1352, 824)})}};
  assert.equal(installPopupFrames(runtime, {electron, platform}), true);
  runtime.on('browser-action-popup-created', noteExtensionPopup);   // extension-toolbar.cjs attach / attachPrivate
  const state = {shown};
  const hold = createPopupHold({window: () => parent, shown: () => state.shown, geometry: () => ({scale: 1, size: SIZE, width: 1200, sidebarSide: 'left'})});
  const click = (extensionId = 'aaaa', anchorRect = rect(845, 20, 30, 30)) => engine.activateClick({eventType: 'click', extensionId, tabId: 7, anchorRect, alignment: 'bottom right'});
  return {parent, engine, runtime, hold, state, click};
}

test('every way a popup opens ends in the engine\'s activateClick (the toolbar button, the sidebar\'s button, the extensions menu\'s row, an extension\'s shortcut and chrome.action.openPopup press the extension\'s own button): that one event holds the bar', () => {
  const library = path.join(root, 'node_modules', 'electron-chrome-extensions', 'dist', 'cjs', 'index.js');
  if (fs.existsSync(library)) {
    const source = fs.readFileSync(library, 'utf8');
    const open = source.slice(source.indexOf('this.openPopup = (event, options) =>'), source.indexOf('handle("browserAction.openPopup"'));
    assert.match(open, /this\.activateClick\(\{/, 'the library\'s openPopup goes through activateClick (the patched one)');
    assert.match(source, /this\.activateClick\(details\);/, 'and so does the interface\'s browserAction.activate');
  }
  const actions = read('src/components/BrowserExtensionActions.tsx');
  assert.match(actions, /button\.click\(\);return;\}/, 'the shortcut and action.openPopup press the extension\'s own button');
  assert.match(actions, /bridge\(\)\?\.activate\(target\.partition!/, 'or activate it directly when it has no button');
  assert.match(read('desktop/browser-services/ext-api/surfaces/main-glue.cjs'), /deps\.sendToChrome\(\{type:'extension-popup',extensionId:request\.extensionId\}\)/);
});

test('a click on the toolbar\'s button: the popup is made, the top bar is held; the same button again closes it and the hold goes', () => {
  const c = chain();
  c.click('aaaa');
  assert.ok(c.engine.popup);
  assert.deepEqual(c.hold.holds(), {top: true, side: false});
  c.click('aaaa');
  assert.equal(c.hold.open, 0);
  assert.deepEqual(c.hold.holds(), {top: false, side: false});
});

test('a pinned extension in the sidebar holds the sidebar; another extension\'s button replaces the popup without a gap', () => {
  const c = chain({shown: {top: true, side: true}});
  c.click('aaaa', rect(20, 300, 30, 30));
  assert.deepEqual(c.hold.holds(), {top: false, side: true});
  c.click('bbbb', rect(845, 20, 30, 30));
  assert.equal(c.engine.popup.extensionId, 'bbbb');
  assert.deepEqual(c.hold.holds(), {top: true, side: false}, 'the second one came from the top bar');
});

test('a popup the page closes itself, an extension reloaded under it, and the browser window closing all end the hold', () => {
  const c = chain();
  c.click('aaaa');
  c.engine.popup.webContents.emit('destroyed');
  assert.equal(c.hold.open, 0, 'window.close() in the popup');
  c.click('aaaa');
  c.engine.ctx.session.extensions.emit('extension-unloaded', {}, {id: 'aaaa'});
  assert.equal(c.hold.open, 0, 'reload or turn off');
  c.click('aaaa');
  assert.equal(c.hold.open, 1);
  c.parent.destroy();
  assert.equal(c.hold.open, 0, 'the window closed');
});

test('opened with no bar showing (a shortcut or action.openPopup while the bar is away): nothing is held, and a bar that appears later is not held by it', () => {
  const c = chain({shown: {top: false, side: false}});
  c.click('aaaa');
  assert.ok(c.engine.popup);
  assert.equal(c.hold.open, 0);
  c.state.shown = {top: true, side: false};
  assert.deepEqual(c.hold.holds(), {top: false, side: false});
});

// ---- the edge controller with the hold (the reported sequence), on a fake clock

const WIN = {x: 100, y: 50, width: 1200, height: 800};
const at = (x, y) => ({x: WIN.x + x, y: WIN.y + y});

/** Seamless, tabs on top: the pointer rests at the top edge until the bar shows, then goes down onto the toolbar. Returns the controller, the clock and a sampler. */
function seamless(extra = {}) {
  const clock = {t: 10_000}, controller = createEdgeController({now: () => clock.t});
  const base = {view: 'seamless', vertical: false, docked: false, edges: {top: true, side: true}, size: {topHeight: 72, sideWidth: 0}, bounds: WIN, suspended: false, engaged: false, pressed: false, ...extra};
  const sample = input => controller.sample({...base, holds: {top: false, side: false}, focused: true, point: at(500, 40), ...input});
  const run = (ms, input) => { let last; for (let i = 0; i < ms; i += 16) { last = sample(input); clock.t += 16; } return last; };
  return {controller, clock, sample, run};
}

test('the reported sequence, a popup window (macOS, Windows, X11): the bar is up, the button is pressed, the popup takes the keyboard. Before: the bar went at once. Now: it stays for as long as the popup is open and goes by the normal rules after it', () => {
  // before (3731e2a4): holds are only what the interface sends, and the interface's own hold ended with its focus
  const before = seamless();
  assert.equal(before.run(600, {point: at(500, 3)}).top, true, 'the pointer at the top edge brings the bar');
  assert.equal(before.run(200, {point: at(850, 35)}).top, true, 'on the toolbar\'s button');
  const gone = before.sample({point: at(850, 35), focused: false});
  assert.equal(gone.top, false, 'the popup takes the keyboard: the controller hides the bar under the open popup (the bug)');
  assert.equal(gone.why.top, 'blur');

  const hold = holdFor({shown: {top: true, side: false}}), now = seamless();
  assert.equal(now.run(600, {point: at(500, 3)}).top, true);
  now.run(200, {point: at(850, 35)});
  const popup = popupStub();
  hold.hold.add(popup);
  const opened = () => ({holds: hold.hold.merge({top: false, side: false}), focused: false});
  let last = now.run(3000, {point: at(850, 35), ...opened()});
  assert.equal(last.top, true, 'three seconds into the open popup, the pointer still on the button');
  last = now.run(3000, {point: at(850, 300), ...opened()});
  assert.equal(last.top, true, 'the pointer goes down into the popup, away from the bar');
  assert.equal(last.why.top, 'hold');
  // the popup closes: the keyboard comes back to the window, the pointer is over the page: the normal grace, then it goes
  popup.destroy();
  const after = {point: at(850, 300), holds: hold.hold.merge({top: false, side: false}), focused: true};
  assert.equal(now.sample(after).top, true, 'not at once: the grace first');
  const left = now.run(GRACE.top + MIN_VISIBLE + 200, after);
  assert.equal(left.top, false, 'then it goes by the normal rules');
});

test('a popup that is a view of the window (Wayland): the window keeps the keyboard, the pointer goes down into the popup, and the grace would run out under it', () => {
  const plain = seamless();
  plain.run(600, {point: at(500, 3)});
  plain.run(200, {point: at(850, 35)});
  assert.equal(plain.run(GRACE.top + MIN_VISIBLE + 400, {point: at(850, 300)}).top, false, 'before: the bar went away with the popup still open');
  const hold = holdFor({shown: {top: true, side: false}}), now = seamless();
  now.run(600, {point: at(500, 3)});
  now.run(200, {point: at(850, 35)});
  hold.hold.add(popupStub());
  assert.equal(now.run(GRACE.top + MIN_VISIBLE + 400, {point: at(850, 300), holds: hold.hold.merge({top: false, side: false})}).top, true);
});

test('the sidebar (Seamless with the tabs in the sidebar): a pinned extension\'s popup holds the sidebar, window unfocused, pointer out in the popup', () => {
  const vertical = {vertical: true, edges: {top: false, side: true}, size: {topHeight: 0, sideWidth: 240}};
  const plain = seamless(vertical);
  assert.equal(plain.run(600, {point: at(2, 400)}).side, true);
  assert.equal(plain.sample({point: at(100, 400), focused: false}).side, false, 'before: gone when the popup takes the keyboard');
  const hold = holdFor({shown: {top: false, side: true}}), now = seamless(vertical);
  assert.equal(now.run(600, {point: at(2, 400)}).side, true);
  now.run(200, {point: at(100, 400)});
  hold.hold.add(popupStub({anchorRect: rect(100, 300, 30, 30)}));
  const last = now.run(4000, {point: at(400, 420), holds: hold.hold.merge({top: false, side: false}), focused: false});
  assert.equal(last.side, true);
  assert.equal(last.top, false, 'the top bar was not up and is not asked for');
});

test('Hide the toolbar (outside Seamless) and the Windows caption: the same hold, with the caption corner input present the bar the buttons sit over stays', () => {
  const hidden = seamless({view: 'full', topAuto: true, caption: {width: 144, height: 40}});
  const hold = holdFor({shown: {top: true, side: false}});
  assert.equal(hidden.run(600, {point: at(500, 3)}).top, true);
  hidden.run(200, {point: at(850, 35)});
  hold.hold.add(popupStub());
  const last = hidden.run(4000, {point: at(850, 300), holds: hold.hold.merge({top: false, side: false}), focused: false});
  assert.equal(last.top, true, 'main\'s captionToolbarComing follows this, so the caption buttons stay drawn over the held toolbar');
});

// ---- main.cjs and the toolbar glue

test('main: the hold is merged into the controller\'s holds, per window; the toolbar glue tells it when a popup is made', () => {
  assert.match(main, /holds:\(\)=>popupHold\.merge\(edgeHolds\),keys:\(\)=>edgeKeys,/);
  assert.match(main, /const popupHold=require\('\.\/edge-popup-hold\.cjs'\)\.createPopupHold\(\{window:\(\)=>mainWindow,/);
  const toolbar = read('desktop/browser-services/extension-toolbar.cjs');
  assert.match(toolbar, /\{noteExtensionPopup\}=require\('\.\.\/edge-popup-hold\.cjs'\)/);
  assert.equal(toolbar.split("runtime.on('browser-action-popup-created',noteExtensionPopup);").length - 1, 2, 'both the ordinary and the private session');
  assert.ok(!/edge-popup-hold/.test(read('desktop/browser-services/extension-popup-window.cjs')), 'the popup\'s own file is untouched');
});

/** main.cjs's own popupHold statement, run against stand-ins for the window, the layout, the settings and the controller's last answer. */
function mainHold({unseen = false, last = {top: true, side: false}, edge = {topHeight: 90, sideWidth: 300}, scale = 1.25, side = 'left', width = 1200} = {}) {
  const start = main.indexOf('const popupHold=');
  assert.ok(start > 0, 'popupHold is where this test expects it');
  const code = main.slice(start, main.indexOf('\n', start));
  const parent = {id: 4, isDestroyed: () => false};
  const sandbox = {
    mainWindow: {...parent, getContentBounds: () => ({x: 0, y: 0, width, height: 800})},
    edgePoller: {entryFor: item => (item === sandbox.edgeItem && !unseen ? {last} : undefined)}, edgeItem: {}, layout: {edge}, uiScale: () => scale, state: {settings: {sidebarSide: side}},
    require: name => require(path.join(root, 'desktop', name.replace(/^\.\//, ''))),
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.popupHold = popupHold;', sandbox);
  return {hold: sandbox.popupHold, parent: sandbox.mainWindow, sandbox};
}

test('main: the statement reads what the controller shows, the layout\'s bar sizes (DIPs) and the Interface size, and a right sidebar mirrors', () => {
  const m = mainHold({last: {top: true, side: true}});
  const top = popupStub({anchorRect: rect(800, 30, 30, 30), parent: m.parent});   // 125 %: centre (1037, 56): under the 90 high bar, past the 300 wide sidebar
  assert.ok(m.hold.add(top));
  assert.deepEqual(m.hold.holds(), {top: true, side: false});
  const sidebar = mainHold({last: {top: true, side: true}});
  sidebar.hold.add(popupStub({anchorRect: rect(40, 400, 30, 30), parent: sidebar.parent}));   // centre (68, 512): in the sidebar
  assert.deepEqual(sidebar.hold.holds(), {top: false, side: true});
  const right = mainHold({last: {top: true, side: true}, side: 'right', scale: 1});
  right.hold.add(popupStub({anchorRect: rect(1150, 400, 30, 30), parent: right.parent}));
  assert.deepEqual(right.hold.holds(), {top: false, side: true});
  const none = mainHold({last: {top: false, side: false}});
  assert.equal(none.hold.add(popupStub({parent: none.parent})), null);
  const nobody = mainHold({unseen: true});
  assert.equal(nobody.hold.add(popupStub({parent: nobody.parent})), null, 'the controller has not seen this window yet');
});

// ---- Windows: main's own edge item and caption code, the real poller, a fake Windows window that loses the keyboard

const {realMainCaption} = require('./caption-main-vm.cjs');
const {watchChromeEdges} = require('../desktop/edge-reveal.cjs');
const runtime = require('../desktop/runtime.cjs');

function windowsRig({withHold}) {
  const state = {settings: {verticalTabs: false, windowView: 'seamless'}, windowUi: {view: 'seamless', workspaceOpen: false, webWorkspaceOpen: false}, tabs: [{id: 'tab-1', contentKind: 'web'}], activeTabId: 'tab-1'};
  let poller = null;
  const parent = {id: 31, isDestroyed: () => false};
  const hold = createPopupHold({window: () => parent, shown: () => { const last = poller.entryFor(ctx.api.edgeItem)?.last; return {top: !!last?.top, side: !!last?.side}; }, geometry: () => ({scale: 1, size: {topHeight: 72, sideWidth: 0}, width: 1200, sidebarSide: 'left'})});
  // the poller reads the window's own box; the interface's bar is 72 high
  const ctx = realMainCaption({layout: {captionHidden: true, captionFloat: true, captionNotch: false, captionHeight: 36, edge: {topHeight: 72, sideWidth: 0}}, edge: {state}, popupHold: withHold ? hold : null});
  ctx.api.setCaption();
  let next = null;
  poller = watchChromeEdges({app: {whenReady: () => ({then: fn => fn()}), on() {}}, windows: () => [ctx.api.edgeItem], screen: ctx.screen, view: s => runtime.effectiveView(s.settings, s.windowUi), now: () => ctx.clock.t, schedule: fn => { next = fn; return {unref() {}}; }, cancel() {}});
  const b = ctx.state.bounds, at = (x, y) => ({x: b.x + x, y: b.y + y});
  const run = ms => { for (let t = 0; t < ms; t += 16) { ctx.advance(16); const fn = next; next = null; if (fn) fn(); } };
  const topNow = () => ctx.emitted.filter(event => event.type === 'chrome-edge').at(-1)?.top === true;
  return {ctx, hold, parent, at, run, topNow, point: p => { ctx.screen.point = p; }};
}

test('Windows, Seamless (hidden caption over the toolbar): the toolbar and the caption buttons with it stay while an extension\'s popup is open, and go by the normal rules after it', () => {
  const popupGone = popup => popup.destroy();
  for (const withHold of [false, true]) {
    const r = windowsRig({withHold});
    r.point(r.at(500, 400)); r.run(400);
    r.point(r.at(500, 3)); r.run(700);
    assert.equal(r.topNow(), true, 'the pointer at the top edge brings the toolbar');
    r.point(r.at(850, 35)); r.run(300);
    const popup = popupStub({parent: r.parent});
    r.hold.add(popup);                       // the click on the button: the popup is made, then it takes the keyboard
    r.ctx.state.focused = false;
    r.point(r.at(850, 300)); r.run(3000);    // the pointer goes down into the popup
    assert.equal(r.topNow(), withHold, withHold ? 'held: the toolbar (and the caption buttons over it) is still up' : 'before: gone with the keyboard, the caption buttons back in their corner box');
    if (!withHold) continue;
    popupGone(popup); r.ctx.state.focused = true;
    r.run(100);
    assert.equal(r.topNow(), true, 'the popup just closed: the grace has only begun');
    r.run(2500);
    assert.equal(r.topNow(), false, 'then it goes');
  }
});
