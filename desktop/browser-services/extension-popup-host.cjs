'use strict';
// Where an extension's toolbar popup lives: a window of its own (Mac, Windows, Linux on X11: as it always was) or, where the window system will not let an
// application place its windows, a view inside the browser window.
//
// Why: on Wayland (KDE Plasma 6 on CachyOS, 13.4, 9 Nov 2026) Electron 44 answers { x: 0, y: 0 } to getBounds()/getPosition() and drops the x and y of
// setBounds ("introspecting or programmatically changing the global window coordinates is prohibited"), so a popup that is a window of its own lands
// wherever the compositor puts it: the same corner for a 27 x 100 popup and a 600 x 430 one, not under its icon. Acira's own menus never had the problem: they are views
// inside the browser window, placed by Acira. This is the same for the popup. The page is a WebContentsView added on top of the browser window's content (above
// the interface and every page view, so nothing under it can be clicked), placed from the icon's rectangle in the window's own coordinates (no screen numbers),
// drawn in Acira's menu frame: the menu radius and a hairline (a page view cannot draw a shadow outside itself, and a second renderer for one would cost memory).
//
// ExtensionPopup (extension-popup-window.cjs) keeps one contract for both: this file gives it a stand-in for the window (ParentSurface) with the few calls it makes.
const {EventEmitter} = require('node:events');

/** What the host choice reads: positions the window system will not honour. */
function popupHostFor({platform = process.platform, env = process.env, ozone = '', learned = false} = {}) {
  const forced = String((env.ACIRA_BROWSER_TEST_DATA && env.ACIRA_POPUP_HOST) || '').toLowerCase();
  if (forced === 'window' || forced === 'parent') return forced;
  if (platform !== 'linux') return 'window';
  if (learned) return 'parent';   // an earlier popup was placed and the window system answered { 0, 0 } (extension-popup-diagnostics positionUnknown)
  const chosen = String(ozone || '').toLowerCase();
  if (chosen === 'x11') return 'window';
  if (chosen === 'wayland') return 'parent';
  return String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || Boolean(env.WAYLAND_DISPLAY) ? 'parent' : 'window';
}

// One answer for the whole run once a window popup has shown that the system ignored its position (see extension-popup-window.cjs, learnPositions).
let learnedUnknown = false;
const learn = () => { learnedUnknown = true; };
const learned = () => learnedUnknown;
const forgetForTests = () => { learnedUnknown = false; };

/** The browser window's own coordinates of the interface page's origin (the toolbar's CSS pixels are measured from it). */
function interfaceView(window) {
  const INTERFACE = /^acira-browser-ui:\/\/ui\/index\.html(?!\?view=overlay)/;
  const walk = (view, depth) => {
    if (!view || depth > 4) return null;
    try { const contents = view.webContents; if (contents && !contents.isDestroyed() && INTERFACE.test(contents.getURL())) return view; } catch { /* going away */ }
    for (const child of view.children || []) { const found = walk(child, depth + 1); if (found) return found; }
    return null;
  };
  try { return walk(window && window.contentView, 0); } catch { return null; }
}
function interfaceOrigin(window) {
  try { const view = interfaceView(window); const b = view && view.getBounds && view.getBounds(); if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) return {x: b.x, y: b.y}; } catch { /* no interface yet */ }
  return {x: 0, y: 0};
}

/** The part of the window the popup may use: its whole content, in its own coordinates. */
function contentArea(window) {
  let size = {width: 0, height: 0};
  try { const b = window.getContentBounds(); size = {width: b.width, height: b.height}; } catch { /* gone */ }
  return {x: 0, y: 0, width: size.width, height: size.height};
}

/**
 * The edge of a popup view, drawn around it with plain views (no renderer): [grow px, offset down px, colour], outermost first, the hairline last. They are Acira's
 * menu tokens (panels.css) in the one way a page view allows: --menu-rim is a 1 px ring at 8 % black (light) or white at 10 % (dark), --menu-e2 a shadow that is almost
 * all underneath (0 16px 24px -8px at 6 % in light; 0 24px 48px -16px at 40 % and two nearer ones in dark), built from a few rounded rectangles of a percent or two
 * each, since a view cannot blur. The ring of the light frame is the sum of every layer at the edge, so the hairline's own share is small.
 */
const RIM_LAYERS = Object.freeze({
  light: Object.freeze([[5, 12, 'rgba(0,0,0,0.010)'], [3, 8, 'rgba(0,0,0,0.012)'], [2, 4, 'rgba(0,0,0,0.014)'], [1, 1, 'rgba(0,0,0,0.012)'], [1, 0, 'rgba(0,0,0,0.045)']]),
  dark: Object.freeze([[9, 18, 'rgba(0,0,0,0.07)'], [6, 12, 'rgba(0,0,0,0.08)'], [3, 6, 'rgba(0,0,0,0.09)'], [1, 1, 'rgba(0,0,0,0.12)'], [1, 0, 'rgba(255,255,255,0.10)']]),
});
const rimLayers = dark => (dark ? RIM_LAYERS.dark : RIM_LAYERS.light);

/**
 * The stand-in for the library's window: what ExtensionPopup asks of its BaseWindow, done with the popup's view inside the browser window.
 * electron: {View}; parent: the browser window; view: the popup page's WebContentsView; options: {radius, dark}.
 */
class ParentSurface extends EventEmitter {
  constructor({electron, parent, view, radius = 0, dark = false}) {
    super();
    this.parentWindow = parent; this.view = view; this.radius = radius; this.destroyedFlag = false; this.visible = false;
    this.rims = [];
    this.layers = rimLayers(dark);
    const View = electron && electron.View;
    if (typeof View === 'function') {
      for (const [grow, , color] of this.layers) {
        try {
          const rim = new View();
          rim.setBackgroundColor(color);
          if (typeof rim.setBorderRadius === 'function') rim.setBorderRadius(radius + grow);
          rim.setVisible && rim.setVisible(false);
          this.rims.push(rim);
        } catch { /* a view that cannot be made is a rim fewer */ }
      }
    }
    this.contentView = {children: [view], addChildView() {}, removeChildView() {}};
    // Everything below the page, outermost first, then the page itself on top.
    for (const rim of this.rims) parent.contentView.addChildView(rim);
    parent.contentView.addChildView(view);
    try { view.setVisible(false); } catch { /* an older view */ }
    // The page losing the keyboard to another view of the window is the window's blur (extension-popup-window.cjs closes on it).
    try { view.webContents.on('blur', () => this.emit('blur')); } catch { /* fake or gone */ }
  }
  getParentWindow() { return this.parentWindow; }
  isDestroyed() { return this.destroyedFlag; }
  isVisible() { return this.visible && !this.destroyedFlag; }
  isFocused() { try { return Boolean(this.view.webContents.isFocused()); } catch { return false; } }
  setMinimumSize() { /* a view has no minimum: its size is the popup's */ }
  getBounds() { return {...this.view.getBounds()}; }
  /** In the browser window's own coordinates. */
  setBounds(bounds) {
    if (this.destroyedFlag) return;
    this.view.setBounds({x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height});
    this.rims.forEach((rim, index) => { const [grow, offsetY] = this.layers[index]; rim.setBounds({x: bounds.x - grow, y: bounds.y - grow + offsetY, width: bounds.width + 2 * grow, height: bounds.height + 2 * grow}); });
  }
  /** On top of the interface and every page: both the rims and the page are added again, which moves them to the top in that order. */
  show() {
    if (this.destroyedFlag) return;
    this.visible = true;
    for (const rim of this.rims) { this.parentWindow.contentView.addChildView(rim); try { rim.setVisible(true); } catch { /* gone */ } }
    this.parentWindow.contentView.addChildView(this.view);
    try { this.view.setVisible(true); } catch { /* gone */ }
  }
  destroy() {
    if (this.destroyedFlag) return;
    this.destroyedFlag = true; this.visible = false;
    const content = this.parentWindow && !this.parentWindow.isDestroyed() ? this.parentWindow.contentView : null;
    if (content) { for (const rim of this.rims) { try { content.removeChildView(rim); } catch { /* not there */ } } try { content.removeChildView(this.view); } catch { /* not there */ } }
    this.emit('closed');
  }
}

module.exports = {popupHostFor, ParentSurface, interfaceOrigin, interfaceView, contentArea, learn, learned, forgetForTests, rimLayers, RIM_LAYERS};
