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
const {placePopup, interfaceScale, anchorOnScreen, MARGIN} = require('./extension-popup-placement.cjs');
const {popupHostFor, ParentSurface, interfaceOrigin, interfaceView, contentArea, learn, learned} = require('./extension-popup-host.cjs');
const {trace} = require('./ext-trace.cjs');
const {fitStep, laidOutIn, METRICS_SCRIPT} = require('./extension-popup-fit.cjs');
const {attachPopupDiagnostics, placementFacts} = require('./extension-popup-diagnostics.cjs');

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

/** Is this an ordinary web address (http or https, no credentials in it)? */
function webAddress(address) {
  try { const url = new URL(String(address)); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password; } catch { return false; }
}

/** Is this address a page of the extension itself (chrome-extension://<its id>/...)? */
function ownPage(address, extensionId) {
  try { const url = new URL(String(address)); return url.protocol === 'chrome-extension:' && url.hostname === extensionId && !url.username && !url.password; } catch { return false; }
}

const clampSize = (value, min, max) => Math.floor(Math.min(max, Math.max(Number(value) || 0, min)));
// After a resize the page is measured to see whether it fits (extension-popup-fit.cjs): a short wait lets the page lay out in its new window,
// and a handful of rounds is more than the worst case needs (a scrollbar's room, then a pixel or two of rounding).
const FIT_DELAY = 40, FIT_ROUNDS = 6;
// How long after the load a report that is the window's own minimum size echoed back is not taken for the page's size (isMinimumEcho): the echo arrives within
// about 100 ms of the load (25 ms to 80 ms measured with Proton Pass); a second is generous and a page that really shrinks later is as it always was.
const ECHO_MS = 1000;
// A window of 25 DIPs is a fractional number of pixels at 125 % (31.25) and its page reads 26 px: the echo is the minimum plus a pixel or two.
const ECHO_SLACK = 2;
// A held report (holdEcho) is checked every ECHO_RECHECK_MS, at most ECHO_CHECKS times: laid out in the window it has twice in a row, with nothing else reported, it is taken.
const ECHO_RECHECK_MS = 250, ECHO_CHECKS = 8;
// How many asked sizes a popup remembers the extra room of (a page asks for a handful of sizes: one for each of its screens).
const LEARNED = 24;
// How long after a press on its own button closed an in-window popup the click that completes that press can still arrive (a slow click, a held button).
const PRESS_MS = 1000;

/** The ozone platform Chromium was told to use (--ozone-platform / --ozone-platform-hint), '' when none was named. */
function ozoneOf(electron) {
  try { const line = electron.app && electron.app.commandLine; return (line && (line.getSwitchValue('ozone-platform') || line.getSwitchValue('ozone-platform-hint'))) || ''; } catch { return ''; }
}
function isDark(electron) { try { return Boolean(electron.nativeTheme && electron.nativeTheme.shouldUseDarkColors); } catch { return false; } }
// What takes a popup that is a view of the browser window away with it: the window changing shape or going out of sight.
// ('hide' is not one: a window that is shown reports it on its own at times (seen in a test run, 600 ms after a popup opened), and a hidden window takes its views with it.)
const PARENT_EVENTS = Object.freeze(['resize', 'move', 'maximize', 'unmaximize', 'minimize', 'enter-full-screen', 'leave-full-screen']);

// The popups that exist, so the application menu can tell that the keyboard is in one (popupOf).
const openPopups = new Set();

/** The toolbar popup whose page is this web contents, or null. */
function popupOf(contents) {
  if (!contents) return null;
  for (const popup of openPopups) if (popup.webContents === contents && !popup.destroyed) return popup;
  return null;
}

class ExtensionPopup extends EventEmitter {
  /** opts: {extensionId, session, parent, url, anchorRect (CSS px of the interface page), alignment}; deps: {electron, platform, env, diagnostics (the trace hook, a test's own)}. */
  constructor(opts, {electron = require('electron'), platform = process.platform, diagnostics = attachPopupDiagnostics, env = process.env} = {}) {
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
    this.learned = new Map();                 // the extra room the window needed for each size the page asked for: "273x374" -> {width, height}
    this.size = undefined;                    // the size of the window as this class last set it
    this.fitTimer = undefined;
    this.echoRecheckMs = ECHO_RECHECK_MS;     // how long a held minimum-size report waits before the page is looked at again (holdEcho); a test's own
    const {BaseWindow, WebContentsView} = electron;
    const scale = interfaceScale(opts.parent);
    this.platform = platform;
    this.frame = popupFrame({platform, scale});
    // Where the window system lets an app place windows the popup is a window of its own, as it always was; where it does not (Wayland) it is a view inside the
    // browser window (extension-popup-host.cjs). The page, its sizing, its events and its lifecycle are the same.
    this.hostKind = popupHostFor({platform, env, ozone: ozoneOf(electron), learned: learned()});
    const pagePreferences = {session: opts.session, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, enablePreferredSizeMode: true};
    if (this.hostKind === 'parent') {
      this.view = new WebContentsView({webPreferences: pagePreferences});
      this.view.setBackgroundColor('#ffffff');
      this.radius = Math.round(MATERIAL_RADIUS * scale);
      this.view.setBorderRadius(this.radius);
      this.view.setBounds({x: 0, y: 0, width: BOUNDS.maxWidth, height: BOUNDS.maxHeight});
      this.window = new ParentSurface({electron, parent: opts.parent, view: this.view, radius: this.radius, dark: isDark(electron)});
    } else {
      this.window = new BaseWindow({
        show: false, frame: false, parent: opts.parent, movable: false, maximizable: false, minimizable: false, fullscreenable: false, resizable: false, skipTaskbar: true,
        // Hidden, and as large as a popup may be while its page loads: Chrome loads the page at that size, and pages that size themselves from
        // window.innerWidth / innerHeight in a script (Surfshark's does: body width = innerWidth) are fixed at whatever they read, here 25 x 25.
        width: BOUNDS.maxWidth, height: BOUNDS.maxHeight, ...this.frame.window
      });
      this.view = new WebContentsView({webPreferences: pagePreferences});
      // An extension page that sets no background is white, as in the library's window.
      this.view.setBackgroundColor('#ffffff');
      if (this.frame.radius) this.view.setBorderRadius(this.frame.radius);
      this.window.contentView.addChildView(this.view);
      this.view.setBounds({x: 0, y: 0, width: BOUNDS.maxWidth, height: BOUNDS.maxHeight});
    }
    this.webContents = this.view.webContents;
    // A link or window.open from the popup to a website or to the extension's own page (Floccus' "Add profile" opens its options page this way, Mister
    // Download Manager's "How to fix it" a help page): the default is a window that is a child of this popup, and it closed with the popup 70 ms later, so
    // nothing ever showed. The page opens where the extension's own chrome.tabs.create puts it (opts.openPage: a tab for a website, the extension window
    // for its own page), and the popup closes as it does in Chrome when a page opens. Anything else keeps the default.
    this.webContents.setWindowOpenHandler?.(details => {
      if (typeof opts.openPage !== 'function' || !(ownPage(details && details.url, this.extensionId) || webAddress(details && details.url))) return {action: 'allow'};
      try { Promise.resolve(opts.openPage(details.url)).catch(error => console.error(error)); } catch (error) { console.error(error); }
      return {action: 'deny'};
    });
    this.webContents.on('preferred-size-changed', this.updatePreferredSize);
    this.webContents.on('devtools-closed', this.maybeClose);
    this.webContents.on('render-process-gone', this.markGone);
    // The page closing itself (window.close(): uBlock Origin Lite's "Remove an element", Bitwarden after it fills a login, OneTab after it sends the tabs)
    // destroys its contents and takes the view out of the window, but the window stayed: an empty box with the system's shadow, holding the keyboard, until
    // the person clicked somewhere else. Chrome closes the popup with its page.
    this.webContents.on('destroyed', this.destroy);
    this.window.on('blur', this.maybeClose);
    if (this.hostKind === 'parent') this.closeWithTheWindow();
    this.window.on('closed', this.destroy);
    this.parent.once('closed', this.destroy);
    openPopups.add(this);
    // What this popup does on this computer goes to the local extension trace (extension-popup-diagnostics.cjs): it never changes what the popup does.
    try { diagnostics(this); } catch { /* a log that cannot be written is not a reason to lose the popup */ }
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

  updatePreferredSize = (_event, size) => {
    // The window keeps the size the page asked for while a report that may be the echo of the window that was shrunk before it is looked into (holdEcho).
    if (this.isMinimumEcho(size)) { this.holdEcho(size); return; }
    this.releaseEcho();
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) this.reported = {width: size.width, height: size.height};
    this.setSize(size); if (this.hidden) this.show();
  };

  /**
   * A report that may be the window's own minimum size echoed back, in the moments after the page loaded. load() puts the window at the minimum (25 x 25) when the page
   * has loaded, so the page re-lays out in a 25 px viewport and reports that, and what it then lays out in that viewport (25 x 25, then 25 x 56). Proton Pass asks
   * 600 x 430, and its own script then sets its size from the window it is in (--popup-width = the document's clientWidth): a window taken to 25 px by those
   * reports kept the page at 25 px, and it rested at the narrowest its words fit, a 56 x 311 sliver, at every opening. A report with a side at the minimum, right
   * after the page had asked for a real size (both sides above it), is such a report until the page shows it is not (holdEcho). Only in the first ECHO_MS after the
   * load; a first report at the minimum is a size (the popup must show), and so is any later one.
   */
  isMinimumEcho(size) {
    if (!size || !this.reported || !(Date.now() < this.echoUntil)) return false;
    return (size.width <= BOUNDS.minWidth + ECHO_SLACK || size.height <= BOUNDS.minHeight + ECHO_SLACK) && this.reported.width > BOUNDS.minWidth + ECHO_SLACK && this.reported.height > BOUNDS.minHeight + ECHO_SLACK;
  }

  /**
   * The window goes back to the size the page asked for (a report of the 25 px window that was gone when the page laid out is not a size), and the report is held: if
   * the page has laid out in the window it has, and for a further ECHO_RECHECK_MS says nothing else (a page that was only echoing lays out in its window and reports its own
   * size, which releases the held one), the minimum is what the page wants, and the window takes it as it always did. checkEcho does that, with the same rule as fit():
   * a size only counts if the page was laid out in the window it is measured in (laidOutIn).
   */
  holdEcho(size) {
    this.echoPending = {width: size.width, height: size.height};
    this.echoQuiet = false;
    this.setSize(this.reported);
    this.armEchoCheck(ECHO_CHECKS);
  }

  releaseEcho() { this.echoPending = undefined; this.echoQuiet = false; clearTimeout(this.echoTimer); }

  armEchoCheck(rounds) {
    clearTimeout(this.echoTimer);
    this.echoTimer = setTimeout(() => { void this.checkEcho(rounds); }, this.echoRecheckMs);
    this.echoTimer.unref?.();
  }

  async checkEcho(rounds) {
    const pending = this.echoPending, contents = this.webContents;
    if (!pending || this.destroyed || !this.window || !contents || contents.isDestroyed() || typeof contents.executeJavaScript !== 'function') return;
    const measured = this.size;
    let metrics; try { metrics = await contents.executeJavaScript(METRICS_SCRIPT); } catch { return; }
    if (this.echoPending !== pending || this.destroyed || !this.window) return;   // a size came (or the popup went) while the page was measured
    let zoom = 1; try { zoom = contents.getZoomFactor?.() || 1; } catch { /* gone */ }
    if (!laidOutIn(metrics, measured, zoom) || this.size !== measured) { this.echoQuiet = false; if (rounds > 1) this.armEchoCheck(rounds - 1); return; }
    // Laid out in its window: once is the page's layout of the moment (Proton's script sets its size 50 ms after a resize), twice in a row, with nothing reported
    // in between, is what the page wants.
    if (!this.echoQuiet) { this.echoQuiet = true; if (rounds > 1) this.armEchoCheck(rounds - 1); return; }
    this.echoPending = undefined; this.echoQuiet = false;
    this.reported = pending;
    this.setSize(pending);
  }

  maybeClose = () => {
    // DevTools open beside a popup, or the focus in another application, keep it open (the library's rule).
    if (this.webContents && !this.webContents.isDestroyed() && this.webContents.isDevToolsOpened()) return;
    const {BaseWindow, BrowserWindow} = this.electron;
    const windows = [...BaseWindow.getAllWindows(), ...(BrowserWindow ? BrowserWindow.getAllWindows() : [])];
    const focused = windows.find(window => { try { return window.isFocused(); } catch { return false; } });
    if (!focused) { trace('toolbar popup stays: no window of Acira has focus', this.extensionId); return; }
    let title = ''; try { title = String(focused.getTitle()).slice(0, 40); } catch { /* gone */ }
    trace('toolbar popup closes: focus moved to another window of Acira', this.extensionId, {id: focused.id, title});
    this.closeBecause('focus moved');
  };

  destroy = () => {
    if (this.destroyed) return;
    this.destroyed = true;
    openPopups.delete(this);
    clearTimeout(this.fitTimer);
    clearTimeout(this.echoTimer);
    for (const [contents, handler] of this.pressWatch || []) { try { if (!contents.isDestroyed()) contents.off('before-mouse-event', handler); } catch { /* gone */ } }
    this.pressWatch = undefined;
    if (this.parent) {
      if (!this.parent.isDestroyed()) { this.parent.off('closed', this.destroy); for (const [name, handler] of this.parentHandlers || []) this.parent.off(name, handler); }
      this.parent = undefined;
    }
    const contents = this.webContents, window = this.window;
    this.window = undefined;
    if (contents && !contents.isDestroyed() && contents.isDevToolsOpened()) contents.closeDevTools();
    if (window && !window.isDestroyed()) { window.off('closed', this.destroy); window.destroy(); }
    // A window does not close the page of a view it held: without this the extension's popup page would live on, hidden.
    if (contents && !contents.isDestroyed()) contents.close();
    this.emit('gone');
  };

  show() {
    this.hidden = false;
    this.window?.show();
    // A WebContentsView in a BaseWindow is not focused when the window shows (a BrowserWindow focuses its own page, which is what the library's popup
    // had): checked in a bare Electron, window focused, page not, until webContents.focus(). Without it typing went nowhere and an autofocus field
    // (Bitwarden's master password) took no keys until the person clicked into it; Chrome's popup has the keyboard at once.
    const contents = this.webContents;
    if (contents && !contents.isDestroyed()) { try { contents.focus(); } catch { /* the window or page went away */ } }
    if (this.hostKind === 'parent' && !this.pressWatch) this.watchOutsidePresses();
    this.emit('shown');
    if (this.hostKind === 'window' && this.platform === 'linux') this.learnPositions();
  }

  /**
   * A popup that is a window of its own on Linux: 300 ms after it shows, did the window system put it where it was asked? If it answered { 0, 0 } (Wayland) every
   * later popup of this run is a view of the browser window instead (extension-popup-host.cjs); this one stays where the compositor put it.
   */
  learnPositions() {
    const timer = setTimeout(() => {
      try {
        if (this.destroyed || !this.window || this.window.isDestroyed() || !this.asked) return;
        if (placementFacts(this.asked, this.window.getBounds()).positionUnknown) learn();
      } catch { /* the window went away */ }
    }, 300);
    if (timer.unref) timer.unref();
  }

  async load(url) {
    try { await this.webContents.loadURL(url); } catch (error) { this.loadFailed = true; console.error(error); }
    if (this.destroyed) return;
    this.echoUntil = Date.now() + ECHO_MS;
    this.setSize({width: BOUNDS.minWidth, height: BOUNDS.minHeight});
  }

  isDestroyed() { return this.destroyed; }

  /** Resolves when the popup finishes loading. */
  whenReady() { return this.readyPromise; }

  /**
   * A popup inside the browser window closes when the window changes shape or hides, on Escape in the page, and (through closeInWindowPopups, from the places
   * that know a tab switched or navigated) when the page under it is another. Outside presses close it through the window's blur (ParentSurface).
   */
  closeWithTheWindow() {
    const parent = this.parent;
    this.parentHandlers = [];
    for (const name of PARENT_EVENTS) { const handler = () => this.closeBecause('window ' + name); try { parent.on(name, handler); this.parentHandlers.push([name, handler]); } catch { /* an event this window does not have */ } }
    this.webContents.on('before-input-event', (event, input) => {
      if (input && input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault && event.preventDefault(); this.closeBecause('Escape'); }
    });
  }

  /**
   * A press on any other view of the window closes the popup at once. The window's blur does it too (ParentSurface), but a press on a part of the interface that takes
   * no keyboard (a drag area, a disabled control) moves no focus, and a window system that is slow to say who has the keyboard closes the popup late; the press itself is
   * what the person did.
   */
  watchOutsidePresses() {
    const children = (this.parent && this.parent.contentView && this.parent.contentView.children) || [];
    this.pressWatch = [];
    for (const view of children) {
      const contents = view !== this.view && view.webContents;
      if (!contents || contents.isDestroyed()) continue;
      const onInterface = view === interfaceView(this.parent);
      const handler = (_event, input) => {
        if (!input || input.type !== 'mouseDown') return;
        const onButton = onInterface && this.pressOnAnchor(input);
        if (onButton) this.closedByAnchorPressAt = Date.now();   // the press half of a click on its own button: that click is the toggle
        this.closeBecause(onButton ? 'press on its button' : 'press outside');
      };
      try { contents.on('before-mouse-event', handler); this.pressWatch.push([contents, handler]); } catch { /* a view that takes no listeners */ }
    }
  }

  /** Closes the popup and remembers why (the trace's closing line says it). */
  closeBecause(reason) {
    if (!this.closeReason) this.closeReason = reason;
    this.destroy();
  }

  /** Is this press (in the interface view's own coordinates) on the extension's button the popup hangs from? */
  pressOnAnchor(input) {
    const css = this.anchorRect, parent = this.parent;
    if (!css || !parent) return false;
    const scale = interfaceScale(parent), slack = 2, x = Number(input.x), y = Number(input.y);
    return x >= css.x * scale - slack && x <= (css.x + css.width) * scale + slack && y >= css.y * scale - slack && y <= (css.y + css.height) * scale + slack;
  }

  /** The largest the popup may be: the library's 800 x 600, and inside the browser window when it is a view of it. */
  limits() {
    if (this.hostKind !== 'parent' || !this.parent) return {maxWidth: BOUNDS.maxWidth, maxHeight: BOUNDS.maxHeight};
    const area = contentArea(this.parent), margin = Math.round(MARGIN * interfaceScale(this.parent));
    return {maxWidth: Math.max(BOUNDS.minWidth, Math.min(BOUNDS.maxWidth, area.width - 2 * margin)), maxHeight: Math.max(BOUNDS.minHeight, Math.min(BOUNDS.maxHeight, area.height - 2 * margin))};
  }

  /**
   * The size the page asks for, inside the library's limits; the popup keeps its place under the icon at every size. What the window was given
   * on top of that to hold the page (a scrollbar's room, a pixel or two of rounding) stays while the page asks for the same size. For another
   * size it is what the window needed the last time the page asked for that size (none the first time, measured again either way).
   * At 125 % uBlock Origin Lite asked 288 x 374, then 272 x 374 (its page is 273 x 374.6: the width it reports without a scrollbar is a pixel short, and in a
   * window that wide a scrollbar comes and it asks 15 px more), over and over, every few milliseconds, and a window that went back to no extra room at
   * each ask never kept the pixel or two that holds the page: the popup changed width for as long as it was open.
   */
  setSize(rect) {
    if (!this.window || !this.parent) return;
    const max = this.limits();
    const base = {width: clampSize(rect?.width, BOUNDS.minWidth, max.maxWidth), height: clampSize(rect?.height, BOUNDS.minHeight, max.maxHeight)};
    if (!this.base || this.base.width !== base.width || this.base.height !== base.height) this.extra = {...(this.learned.get(`${base.width}x${base.height}`) || {width: 0, height: 0})};
    this.base = base;
    this.resize();
    this.fitSoon(FIT_ROUNDS);
  }

  /** The window at the page's size plus what it was given on top, never past the library's limits. */
  resize() {
    const max = this.limits();
    const size = {width: Math.min(max.maxWidth, this.base.width + this.extra.width), height: Math.min(max.maxHeight, this.base.height + this.extra.height)};
    this.size = size;
    this.emit('will-resize', size);
    this.place(size);
    this.emit('resized');
  }

  fitSoon(rounds) {
    if (this.destroyed || rounds <= 0) { clearTimeout(this.fitTimer); this.fitAt = undefined; return; }
    // A measure that is on its way keeps its time: a page that asks for a new size more often than FIT_DELAY (uBlock Origin Lite asked every
    // 10 to 50 ms while a scrollbar came and went) pushed the measure back for as long as it asked, and was never measured. (A timer a second
    // late is one that was cleared: a new one is set.)
    if (this.fitAt && Date.now() - this.fitAt < 1000) { this.fitRounds = Math.max(rounds, this.fitRounds || 0); return; }
    clearTimeout(this.fitTimer);
    this.fitAt = Date.now() + FIT_DELAY; this.fitRounds = rounds;
    this.fitTimer = setTimeout(() => { this.fitAt = undefined; void this.fit(this.fitRounds); }, FIT_DELAY);
    this.fitTimer.unref?.();
  }

  /** Measures the page in its window; if it does not fit and the window may still grow, grows it (once per round) and measures again. */
  async fit(rounds) {
    const contents = this.webContents;
    if (this.destroyed || !this.window || !this.base || !contents || contents.isDestroyed() || typeof contents.executeJavaScript !== 'function') return;
    const measured = this.size, base = this.base, extra = this.extra;   // the window the page is measured in, and the asked size and extra room it is made of
    let metrics;
    try { metrics = await contents.executeJavaScript(METRICS_SCRIPT); } catch { return; }   // a page that is loading or going away
    if (this.destroyed || !this.window || this.window.isDestroyed()) return;
    // The numbers are of the window the page had when the script ran, if the page was laid out in it. A page that has not caught up with its window (its
    // viewport is still the window's previous size) has none: Bitwarden's 480 x 600 page, measured in the 25 x 25 viewport it had right after the load while the
    // window already had 480 x 600, "overflowed" by 455 px; the window grew by the 320 px left to the 800 px limit, the sizing measure then read 800 in the
    // 800 px window, and the popup stayed 800 wide: the page's content clipped by its own 480 px body and scrolled sideways, the 320 px beyond it empty.
    // Measure again once the page has the window's size.
    let zoom = 1; try { zoom = contents.getZoomFactor?.() || 1; } catch { /* gone */ }
    if (!laidOutIn(metrics, measured, zoom)) { this.fitSoon(rounds - 1); return; }
    const step = fitStep(metrics, measured, this.limits());   // measured, not getBounds(): Windows hands back whole pixels converted to DIPs, a value off by one at 125 % and 150 %
    if (!step.width && !step.height) return;
    const needed = {width: extra.width + step.width, height: extra.height + step.height};
    // What that size of page needs is kept for the next time the page asks for it (setSize), even if the window is another one by now.
    const key = `${base.width}x${base.height}`;
    this.learned.delete(key); this.learned.set(key, {...needed});
    if (this.learned.size > LEARNED) this.learned.delete(this.learned.keys().next().value);
    // The window is still the one that was measured: it takes the room now. If the page asked for another size while it was measured (a page that keeps
    // asking: uBlock Origin Lite), the numbers are of a window that is gone and the window is not grown by them: it gave Dark Reader 527 x 600 around a
    // 276 x 580 page and uBlock Origin Lite 521 x 600, since the window only ever grows. They are kept for their own size above, and the page is measured again.
    if (this.size === measured && this.base.width === base.width && this.base.height === base.height) { this.extra = needed; this.resize(); }
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
    if (this.hostKind === 'parent') return this.placeInWindow(size);
    const css = this.anchorRect || {x: 0, y: 0, width: 0, height: 0};
    const scale = interfaceScale(parent);
    const anchor = anchorOnScreen({x: Number(css.x) || 0, y: Number(css.y) || 0, width: Number(css.width) || 0, height: Number(css.height) || 0}, parent, scale);
    const display = this.electron.screen.getDisplayMatching({x: Math.round(anchor.x), y: Math.round(anchor.y), width: Math.max(1, Math.round(anchor.width)), height: Math.max(1, Math.round(anchor.height))});
    const spot = placePopup({anchor, size, window: parent.getContentBounds(), area: display.workArea, scale});
    this.emit('will-move', {x: spot.x, y: spot.y});
    this.asked = {x: spot.x, y: spot.y, width: size.width, height: size.height};
    window.setBounds({x: spot.x, y: spot.y, width: size.width, height: size.height});
    this.view.setBounds({x: 0, y: 0, width: size.width, height: size.height});
    this.emit('moved');
  }

  /**
   * The popup as a view of the browser window: the icon's rectangle (CSS px of the interface page x Interface size, from the interface page's own origin) in
   * the window's coordinates, the same rule as the window's (right edge on the icon's when it is in the right half, a flip, a slide in), and the window's
   * own content as the only area. No screen numbers anywhere: that is the point.
   */
  placeInWindow(size) {
    const parent = this.parent, css = this.anchorRect || {x: 0, y: 0, width: 0, height: 0};
    const scale = interfaceScale(parent), origin = interfaceOrigin(parent), area = contentArea(parent);
    const anchor = {x: origin.x + (Number(css.x) || 0) * scale, y: origin.y + (Number(css.y) || 0) * scale, width: (Number(css.width) || 0) * scale, height: (Number(css.height) || 0) * scale};
    const spot = placePopup({anchor, size, window: area, area, scale});
    this.emit('will-move', {x: spot.x, y: spot.y});
    this.asked = {x: spot.x, y: spot.y, width: size.width, height: size.height};
    this.window.setBounds(this.asked);
    this.emit('moved');
  }
}

/**
 * The window that was last in use, for a toolbar click that has no website tab to name one. Acira's own window is not in the engine's `windows`
 * (getCurrentWindow() answers nothing), but the engine's lastFocusedWindowId is its id, and Electron knows the window by it.
 */
function windowInUse(store, electron, getWindow) {
  try {
    const registered = typeof store.getCurrentWindow === 'function' ? store.getCurrentWindow() : undefined;
    const id = store.lastFocusedWindowId;
    const found = registered || (Number.isInteger(id) && typeof electron.BaseWindow?.fromId === 'function' ? electron.BaseWindow.fromId(id) : undefined) || (typeof getWindow === 'function' ? getWindow() : undefined);
    return found && !found.isDestroyed?.() ? found : undefined;
  } catch { return undefined; }
}

/**
 * BrowserActionAPI.activateClick (the toolbar button, the button's keyboard shortcut and chrome.action.openPopup all end here), with the popup in this
 * file's window. Everything else about it is the library's: a second click closes the popup, an action with no popup page gets `onClicked`, the
 * popup belongs to the window of the tab it opens for. Returns false (and leaves the library's own popups) when the engine is not the one this is
 * written against.
 */
function installPopupFrames(runtime, {electron = require('electron'), platform = process.platform, getWindow} = {}) {
  const engine = runtime?.api?.browserAction;
  if (!engine || typeof engine.activateClick !== 'function' || typeof engine.getPopupUrl !== 'function' || !engine.ctx?.store || typeof engine.ctx.emit !== 'function') return false;
  if (engine.activateClick.framedPopups) return true;
  const original = engine.activateClick;
  function activateClick(details) {
    const {extensionId, tabId, anchorRect, alignment} = details || {};
    if (this.popup) {
      // Only a popup with a live page is closed by the click that follows it; a stale one (its page gone) is cleared away and the click opens the popup.
      const toggle = !this.popup.isDestroyed() && this.popup.extensionId === extensionId && this.popup.isLive();
      // A popup inside the browser window closes at the press on its own button (watchOutsidePresses); the click that follows that press is the toggle, not a new open.
      const pressedClosed = this.popup.hostKind === 'parent' && this.popup.isDestroyed() && this.popup.extensionId === extensionId && this.popup.closedByAnchorPressAt && Date.now() - this.popup.closedByAnchorPressAt < PRESS_MS;
      this.popup.destroy();
      this.popup = undefined;
      if (toggle || pressedClosed) return undefined;
    }
    const store = this.ctx.store;
    const tab = tabId >= 0 ? store.getTabById(tabId) : store.getActiveTabOfCurrentWindow();
    let url = tab && this.getPopupUrl(extensionId, tab.id);
    let parent = tab && url && store.tabToWindow.get(tab);
    if (!tab) {
      // No website tab at all (the New Tab page or Settings is all that is open: those pages have no view the engine knows, and the toolbar sends
      // -1, or the id of a website tab that has closed since): the library throws "Unable to get active tab" and the button was dead. The popup
      // opens from the extension's default popup in the window that was in use, as Chrome's does on its own New Tab page.
      url = this.getPopupUrl(extensionId, -1);
      parent = url ? windowInUse(store, electron, getWindow) : undefined;
    }
    // No popup page or no window (or no tab and no window in use): the library's own answer (onClicked, or its error).
    if (!parent) return original.call(this, details);
    this.popup = new ExtensionPopup({extensionId, session: this.ctx.session, parent, url, anchorRect, alignment, openPage: typeof store.createTab === 'function' ? pageUrl => store.createTab({url: pageUrl, active: true, windowId: -2}) : undefined}, {electron, platform});
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

/** Closes the popups that are views of this browser window (the tab changed or navigated under them). Window popups close on focus as ever. */
function closeInWindowPopups(window) {
  let closed = 0;
  for (const popup of [...openPopups]) if (popup.hostKind === 'parent' && !popup.destroyed && (!window || popup.parent === window)) { popup.closeBecause('page changed'); closed++; }
  return closed;
}

module.exports = {ExtensionPopup, popupFrame, installPopupFrames, closeInWindowPopups, ownPage, popupOf, BOUNDS, MATERIAL_RADIUS};
