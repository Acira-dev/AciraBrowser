'use strict';
// A Linux user (CachyOS, KDE, 9 Nov 2026, 0.1.0-beta.13.4) opened Proton Pass from Settings > Extensions: the popup came up not under its icon but at a
// fixed place to the left and below it, the same top-left corner for a 27 x 100 window and for a 600 x 430 one. A toolbar popup is a window of its own
// (desktop/browser-services/extension-popup-window.cjs) that is put where its icon is with setBounds({x, y}) from a window origin read with
// getContentBounds(). Electron 44's own documentation: "On Wayland, getBounds() returns { x: 0, y: 0, ... } as introspecting or programmatically
// changing the global window coordinates is prohibited" (the same for getPosition and setPosition): the app can neither read where the browser window is
// nor say where the popup goes, so the compositor places the popup wherever its own rules put it.
//
// This file models such a window system. The first test states what 13.4 does there when nothing says it is Wayland (it is true today for the window host, which
// stays the host everywhere the system can place windows). The second is the behaviour 13.6 needs, and it failed on 13.4 (the popup was wherever the compositor put it:
// y 426 where 77 was expected): on a Wayland session the popup is drawn under its icon, inside the browser window (extension-popup-host.cjs). More of it in
// tests/extension-popup-in-window.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ExtensionPopup} = require('../desktop/browser-services/extension-popup-window.cjs');
const {createPopupDiagnostics} = require('../desktop/browser-services/extension-popup-diagnostics.cjs');
const {GAP} = require('../desktop/browser-services/extension-popup-placement.cjs');

class FakeContents extends EventEmitter {
  constructor() { super(); this.urls = []; this.closed = false; }
  loadURL(url) { this.urls.push(url); return Promise.resolve(); }
  isDestroyed() { return this.closed; } isDevToolsOpened() { return false; } closeDevTools() {} close() { this.closed = true; }
  getURL() { return this.urls[this.urls.length - 1] || ''; } setWindowOpenHandler() {} focus() {} getZoomFactor() { return 1; }
}
class FakeView {
  constructor() { this.webContents = new FakeContents(); this.bounds = {x: 0, y: 0, width: 0, height: 0}; }
  setBackgroundColor() {} setBorderRadius() {} setBounds(bounds) { this.bounds = {...bounds}; } getBounds() { return {...this.bounds}; } setVisible() {}
}
/** A window on a system where the app cannot place or locate windows: bounds always say { 0, 0 }, setBounds keeps the size and drops the position. */
class WaylandWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options; this.size = {width: options.width || 0, height: options.height || 0}; this.visible = false; this.destroyed = false;
    this.parentWindow = options.parent || null; this.focused = !options.parent; this.contentView = {children: [], addChildView: view => { const at = this.contentView.children.indexOf(view); if (at >= 0) this.contentView.children.splice(at, 1); this.contentView.children.push(view); }, removeChildView: view => { const at = this.contentView.children.indexOf(view); if (at >= 0) this.contentView.children.splice(at, 1); }};
    this.compositorSpot = {x: 66, y: 426};   // where the compositor put the reported popup, whatever the app asked for
    this.requests = [];
    WaylandWindow.all.push(this);
  }
  getBounds() { return {x: 0, y: 0, ...this.size}; }
  getContentBounds() { return this.getBounds(); }
  setBounds(bounds) { this.requests.push({...bounds}); this.size = {width: bounds.width, height: bounds.height}; }
  screenRect() { return {...this.compositorSpot, ...this.size}; }
  getParentWindow() { return this.parentWindow; }
  show() { this.visible = true; } isVisible() { return this.visible; } isFocused() { return this.focused; }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.visible = false; }
}
WaylandWindow.all = [];
WaylandWindow.getAllWindows = () => WaylandWindow.all.filter(window => !window.destroyed);

function open({diagnostics, env = {}} = {}) {
  WaylandWindow.all = [];
  const parent = new WaylandWindow({width: 1088, height: 700});
  const ui = new FakeView(); ui.webContents.urls.push('acira-browser-ui://ui/index.html'); parent.contentView.addChildView(ui);
  const electron = {BaseWindow: WaylandWindow, WebContentsView: FakeView, View: FakeView, BrowserWindow: {getAllWindows: () => []}, screen: {getDisplayMatching: () => ({workArea: {x: 0, y: 0, width: 1920, height: 1080}})}};
  const popup = new ExtensionPopup({extensionId: 'ghmbeldphafepmbegfdlkpapadhbakde', session: {}, parent, url: 'chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/popup.html',
    anchorRect: {x: 845, y: 39, width: 30, height: 30}, alignment: 'bottom right'}, {electron, platform: 'linux', env, diagnostics});
  return {popup, parent};
}

test('the window host (13.4, and anywhere nothing says Wayland) on a window system that cannot place windows: the popup asks for a spot worked out from an origin it cannot read, the system drops it, and the trace says so', async () => {
  const lines = [], timers = [];
  const diagnostics = createPopupDiagnostics({trace: (...parts) => lines.push(parts), enabled: () => true, placedDelay: 0, probeDelays: [], setTimer: (work, delay) => { timers.push({work, delay}); return {unref() {}}; }, clearTimer() {}});
  const {popup} = open({diagnostics: diagnostics.attach});
  await popup.whenReady();
  popup.webContents.emit('preferred-size-changed', {}, {width: 27, height: 100});
  assert.equal(popup.window.visible, true);
  const asked = popup.window.requests.slice(-1)[0];
  assert.deepEqual([asked.width, asked.height], [27, 100]);
  assert.ok(asked.x > 800 && asked.y === 39 + 30 + GAP, 'the maths put it under the icon, from an origin of 0, 0');
  assert.deepEqual(popup.window.getBounds(), {x: 0, y: 0, width: 27, height: 100}, 'the window reports { 0, 0 } whatever was asked');
  assert.notDeepEqual([popup.window.screenRect().x, popup.window.screenRect().y], [asked.x, asked.y], 'the compositor put it elsewhere');
  timers.filter(timer => timer.delay === 0).forEach(timer => timer.work());
  const placed = lines.find(line => line[0] === 'toolbar popup placed')[2];
  assert.deepEqual([placed.positionHonoured, placed.positionUnknown], [false, true], 'the log tells a Wayland-like system from a window manager that moved it');
});

/** Where the popup's page really is in the browser window's own coordinates: the window's place on the screen when it is a window of its own. */
function pageRect(popup, parent) {
  if (popup.hostedIn === 'parent' || popup.hostKind === 'parent') { const b = popup.view.getBounds(); return {x: parent.getContentBounds().x + b.x, y: parent.getContentBounds().y + b.y, width: b.width, height: b.height}; }
  return popup.window.screenRect();
}

test('13.6: on a Wayland session the popup is drawn under its icon, inside the browser window, with its right edge on the icon\'s (on 13.4 it was wherever the compositor put it)', async () => {
  const {popup, parent} = open({env: {XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0'}});
  await popup.whenReady();
  popup.webContents.emit('preferred-size-changed', {}, {width: 300, height: 260});
  const rect = pageRect(popup, parent);
  assert.equal(rect.y, 39 + 30 + GAP, 'under the icon');
  assert.equal(rect.x + rect.width, 845 + 30, 'right edge on the icon\'s right edge (the icon is in the right half of the window)');
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1088 && rect.y + rect.height <= 700, 'inside the browser window');
  assert.equal(WaylandWindow.all.length, 1, 'the browser window is the only window');
});
