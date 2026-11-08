'use strict';
// The window an extension's toolbar popup lives in.
//
// electron-chrome-extensions 4.9.0 makes it a plain frameless BrowserWindow with `roundedCorners: false`: a bare rectangle, square corners, flush
// against the toolbar. It cannot be changed afterwards (the corners are a creation option, a BrowserWindow's own page cannot be clipped), so for
// the toolbar's popups Acira makes the window itself: this class has the library's PopupView contract (what its toolbar glue, the extension-action
// sizing and chrome.action.openPopup use: extensionId, whenReady(), setSize(), updatePosition(), the events 'will-resize' 'resized' 'will-move'
// 'moved', destroy()) and is installed over BrowserActionAPI.activateClick for each runtime (installPopupFrames below).
//
// The frame is the system's wherever the system has a rounded one, and Acira's own menus' measure elsewhere (popupFrame):
//  - macOS: a transparent frameless window; the page sits in a WebContentsView clipped to materialRadius (8 px x Interface size, the radius
//    Acira's menus and overlay use: desktop/composition.cjs), and the window keeps the system shadow and hairline, which follow that shape.
//  - Windows: the library's window as it was, with `roundedCorners: true`: Windows 11 rounds it (the system's corner preference), Windows 10
//    draws square corners, as it does for every window.
//  - Linux: as before.
// The extension's page is never touched: no CSS, no script, its size logic stays in extension-action-sizing.cjs.
const {EventEmitter} = require('node:events');
const {placePopup, interfaceScale, anchorOnScreen} = require('./extension-popup-placement.cjs');
const {trace} = require('./ext-trace.cjs');
const {fitStep, METRICS_SCRIPT} = require('./extension-popup-fit.cjs');

// The library's limits for a popup's size.
const BOUNDS = Object.freeze({minWidth: 25, minHeight: 25, maxWidth: 800, maxHeight: 600});
// design-tokens.json geometry.materialRadius: the corner radius of every Acira menu and panel.
const MATERIAL_RADIUS = 8;

/** The frame a popup window gets on a platform: window options, and the radius its page is clipped to (0 = the system rounds it, or nobody). */
function popupFrame({platform = process.platform, scale = 1} = {}) {
  if (platform === 'darwin') return {kind: 'clipped', radius: Math.round(MATERIAL_RADIUS * scale), window: {transparent: true, hasShadow: true, roundedCorners: false, backgroundColor: '#00000000'}};
  if (platform === 'win32') return {kind: 'system', radius: 0, window: {roundedCorners: true, backgroundColor: '#ffffff'}};
  return {kind: 'square', radius: 0, window: {roundedCorners: false, backgroundColor: '#ffffff'}};
}

const clampSize = (value, min, max) => Math.floor(Math.min(max, Math.max(Number(value) || 0, min)));
// After a resize the page is measured to see whether it fits (extension-popup-fit.cjs): a short wait lets the page lay out in its new window,
// and a handful of rounds is more than the worst case needs (a scrollbar's room, then a pixel or two of rounding).
const FIT_DELAY = 40, FIT_ROUNDS = 6;

class ExtensionPopup extends EventEmitter {
  /** opts: {extensionId, session, parent, url, anchorRect (CSS px of the interface page), alignment}; deps: {electron, platform}. */
  constructor(opts, {electron = require('electron'), platform = process.platform} = {}) {
    super();
    this.electron = electron;
    this.destroyed = false;
    this.hidden = true;
    this.parent = opts.parent;
    this.extensionId = opts.extensionId;
    this.anchorRect = opts.anchorRect;
    this.alignment = opts.alignment;
    this.base = undefined;                    // the size the page asked for (inside the library's limits)
    this.extra = {width: 0, height: 0};       // what the window has been given on top, to hold the page (scrollbar room, rounding)
    this.size = undefined;                    // the size of the window as this class last set it
    this.fitTimer = undefined;
    const {BaseWindow, WebContentsView} = electron;
    this.frame = popupFrame({platform, scale: interfaceScale(opts.parent)});
    this.window = new BaseWindow({
      show: false, frame: false, parent: opts.parent, movable: false, maximizable: false, minimizable: false, fullscreenable: false, resizable: false, skipTaskbar: true,
      // Hidden, and as large as a popup may be while its page loads: Chrome loads the page at that size, and pages that size themselves from
      // window.innerWidth / innerHeight in a script (Surfshark's does: body width = innerWidth) are fixed at whatever they read, here 25 x 25.
      width: BOUNDS.maxWidth, height: BOUNDS.maxHeight, ...this.frame.window
    });
    this.view = new WebContentsView({webPreferences: {session: opts.session, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, enablePreferredSizeMode: true}});
    // An extension page that sets no background is white, as in the library's window.
    this.view.setBackgroundColor('#ffffff');
    if (this.frame.radius) this.view.setBorderRadius(this.frame.radius);
    this.window.contentView.addChildView(this.view);
    this.view.setBounds({x: 0, y: 0, width: BOUNDS.maxWidth, height: BOUNDS.maxHeight});
    this.webContents = this.view.webContents;
    this.webContents.on('preferred-size-changed', this.updatePreferredSize);
    this.webContents.on('devtools-closed', this.maybeClose);
    this.webContents.on('render-process-gone', this.markGone);
    this.window.on('blur', this.maybeClose);
    this.window.on('closed', this.destroy);
    this.parent.once('closed', this.destroy);
    this.readyPromise = this.load(opts.url);
  }

  /** The library's name for the window (extension-action-sizing.cjs and the QA rigs read it). */
  get browserWindow() { return this.window; }

  /** The page's process is gone (a crash, or the extension was unloaded under it): the window is an empty shell that must not count as a popup. */
  markGone = () => { this.gone = true; };

  /** Is there still a page in this window? A popup whose page failed to load, whose process is gone or whose contents were closed is a stale entry. */
  isLive() {
    const contents = this.webContents;
    return !this.destroyed && !this.gone && !this.loadFailed && Boolean(contents) && !contents.isDestroyed();
  }

  updatePreferredSize = (_event, size) => { this.setSize(size); if (this.hidden) this.show(); };

  maybeClose = () => {
    // DevTools open beside a popup, or the focus in another application, keep it open (the library's rule).
    if (this.webContents && !this.webContents.isDestroyed() && this.webContents.isDevToolsOpened()) return;
    const {BaseWindow, BrowserWindow} = this.electron;
    const windows = [...BaseWindow.getAllWindows(), ...(BrowserWindow ? BrowserWindow.getAllWindows() : [])];
    const focused = windows.find(window => { try { return window.isFocused(); } catch { return false; } });
    if (!focused) { trace('toolbar popup stays: no window of Acira has focus', this.extensionId); return; }
    let title = ''; try { title = String(focused.getTitle()).slice(0, 40); } catch { /* gone */ }
    trace('toolbar popup closes: focus moved to another window of Acira', this.extensionId, {id: focused.id, title});
    this.destroy();
  };

  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.fitTimer);
    if (this.parent) {
      if (!this.parent.isDestroyed()) this.parent.off('closed', this.destroy);
      this.parent = undefined;
    }
    const contents = this.webContents, window = this.window;
    this.window = undefined;
    if (contents && !contents.isDestroyed() && contents.isDevToolsOpened()) contents.closeDevTools();
    if (window && !window.isDestroyed()) { window.off('closed', this.destroy); window.destroy(); }
    // A window does not close the page of a view it held: without this the extension's popup page would live on, hidden.
    if (contents && !contents.isDestroyed()) contents.close();
  };

  show() {
    this.hidden = false;
    this.window?.show();
  }

  async load(url) {
    try { await this.webContents.loadURL(url); } catch (error) { this.loadFailed = true; console.error(error); }
    if (this.destroyed) return;
    this.setSize({width: BOUNDS.minWidth, height: BOUNDS.minHeight});
  }

  isDestroyed() { return this.destroyed; }

  /** Resolves when the popup finishes loading. */
  whenReady() { return this.readyPromise; }

  /**
   * The size the page asks for, inside the library's limits; the popup keeps its place under the icon at every size. What the window was given
   * on top of that to hold the page (a scrollbar's room, a pixel of rounding) stays while the page asks for the same size and is measured
   * again when it asks for another.
   */
  setSize(rect) {
    if (!this.window || !this.parent) return;
    const base = {width: clampSize(rect?.width, BOUNDS.minWidth, BOUNDS.maxWidth), height: clampSize(rect?.height, BOUNDS.minHeight, BOUNDS.maxHeight)};
    if (!this.base || this.base.width !== base.width || this.base.height !== base.height) this.extra = {width: 0, height: 0};
    this.base = base;
    this.resize();
    this.fitSoon(FIT_ROUNDS);
  }

  /** The window at the page's size plus what it was given on top, never past the library's limits. */
  resize() {
    const size = {width: Math.min(BOUNDS.maxWidth, this.base.width + this.extra.width), height: Math.min(BOUNDS.maxHeight, this.base.height + this.extra.height)};
    this.size = size;
    this.emit('will-resize', size);
    this.place(size);
    this.emit('resized');
  }

  fitSoon(rounds) {
    clearTimeout(this.fitTimer);
    if (this.destroyed || rounds <= 0) return;
    this.fitTimer = setTimeout(() => { void this.fit(rounds); }, FIT_DELAY);
    this.fitTimer.unref?.();
  }

  /** Measures the page in its window; if it does not fit and the window may still grow, grows it (once per round) and measures again. */
  async fit(rounds) {
    const contents = this.webContents;
    if (this.destroyed || !this.window || !this.base || !contents || contents.isDestroyed() || typeof contents.executeJavaScript !== 'function') return;
    let metrics;
    try { metrics = await contents.executeJavaScript(METRICS_SCRIPT); } catch { return; }   // a page that is loading or going away
    if (this.destroyed || !this.window || this.window.isDestroyed()) return;
    // The size this class set, not getBounds(): Windows hands back whole pixels converted to DIPs, a value off by one at 125 % and 150 %.
    const step = fitStep(metrics, this.size, {maxWidth: BOUNDS.maxWidth, maxHeight: BOUNDS.maxHeight});
    if (!step.width && !step.height) return;
    this.extra = {width: this.extra.width + step.width, height: this.extra.height + step.height};
    this.resize();
    this.fitSoon(rounds - 1);
  }

  /** The library's updatePosition(): for the current size. */
  updatePosition() {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    this.place({width: bounds.width, height: bounds.height});
  }

  place(size) {
    const window = this.window, parent = this.parent;
    if (!window || !parent || window.isDestroyed() || parent.isDestroyed?.()) return;
    const css = this.anchorRect || {x: 0, y: 0, width: 0, height: 0};
    const scale = interfaceScale(parent);
    const anchor = anchorOnScreen({x: Number(css.x) || 0, y: Number(css.y) || 0, width: Number(css.width) || 0, height: Number(css.height) || 0}, parent, scale);
    const display = this.electron.screen.getDisplayMatching({x: Math.round(anchor.x), y: Math.round(anchor.y), width: Math.max(1, Math.round(anchor.width)), height: Math.max(1, Math.round(anchor.height))});
    const spot = placePopup({anchor, size, window: parent.getContentBounds(), area: display.workArea, scale});
    this.emit('will-move', {x: spot.x, y: spot.y});
    window.setBounds({x: spot.x, y: spot.y, width: size.width, height: size.height});
    this.view.setBounds({x: 0, y: 0, width: size.width, height: size.height});
    this.emit('moved');
  }
}

/**
 * BrowserActionAPI.activateClick (the toolbar button, the button's keyboard shortcut and chrome.action.openPopup all end here), with the popup in this
 * file's window. Everything else about it is the library's: a second click closes the popup, an action with no popup page gets `onClicked`, the
 * popup belongs to the window of the tab it opens for. Returns false (and leaves the library's own popups) when the engine is not the one this is
 * written against.
 */
function installPopupFrames(runtime, {electron = require('electron'), platform = process.platform} = {}) {
  const engine = runtime?.api?.browserAction;
  if (!engine || typeof engine.activateClick !== 'function' || typeof engine.getPopupUrl !== 'function' || !engine.ctx?.store || typeof engine.ctx.emit !== 'function') return false;
  if (engine.activateClick.framedPopups) return true;
  const original = engine.activateClick;
  function activateClick(details) {
    const {extensionId, tabId, anchorRect, alignment} = details || {};
    if (this.popup) {
      // Only a popup with a live page is closed by the click that follows it; a stale one (its page gone) is cleared away and the click opens the popup.
      const toggle = !this.popup.isDestroyed() && this.popup.extensionId === extensionId && this.popup.isLive();
      this.popup.destroy();
      this.popup = undefined;
      if (toggle) return undefined;
    }
    const store = this.ctx.store;
    const tab = tabId >= 0 ? store.getTabById(tabId) : store.getActiveTabOfCurrentWindow();
    const url = tab && this.getPopupUrl(extensionId, tab.id);
    const parent = tab && url && store.tabToWindow.get(tab);
    // No tab, no popup page or no window: the library's own answer (onClicked, or its error).
    if (!parent) return original.call(this, details);
    this.popup = new ExtensionPopup({extensionId, session: this.ctx.session, parent, url, anchorRect, alignment}, {electron, platform});
    this.ctx.emit('browser-action-popup-created', this.popup);
    return undefined;
  }
  activateClick.framedPopups = true;
  // Reload, update, turn off or remove: the engine closes the extension's popup page but not the window around it (a BaseWindow holds the view), so the
  // popup is closed here. Left in place it was a stale entry, and the first click after the reload only closed it.
  try {
    engine.ctx.session?.extensions?.on?.('extension-unloaded', (_event, extension) => {
      const popup = engine.popup;
      if (!popup || popup.isDestroyed() || popup.extensionId !== extension?.id) return;
      popup.destroy();
      engine.popup = undefined;
    });
  } catch { /* an engine without extension events keeps the click-time check above */ }
  engine.activateClick = activateClick;
  return true;
}

module.exports = {ExtensionPopup, popupFrame, installPopupFrames, BOUNDS, MATERIAL_RADIUS};
