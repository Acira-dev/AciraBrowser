'use strict';
// Centred panels (tab viewer, profiles, command bar, Ctrl+Tab switcher) are modal moments: the page behind them dims so
// the panel is the only focus and a search field on the page underneath can't read as a second one (round 7). Acira
// pages live in the chrome view and websites in their own native views, so neither renderer can dim the other: one
// transparent native layer over the page area does, under the popup host and above every page. The layer's own page
// draws the tint and eases it with a CSS transition (in 200ms with the panel, out in 130ms), so the compositor animates
// it; a translucent view background colour is not composited. A click on it closes the panel, as a click on the page did.
const KINDS = new Set(['tabs', 'palette', 'switcher', 'whats-new']);
const OPEN_MS = 200, CLOSE_MS = 130, RELEASE_MS = 30000;
const BASE = 'html,body{height:100%;margin:0;background:rgb(0 0 0 / 0)}html{transition:background-color 200ms cubic-bezier(.23,1,.32,1)}';

/** The tint for a layout's overlay: 35% on dark chrome, 20% on light, none for anchored menus and toasts. */
function scrimAlpha(overlay, appearance) {
  return overlay && KINDS.has(overlay.kind) ? (appearance === 'dark' ? .35 : .2) : 0;
}

function createPageScrim({ WebContentsView, getWindow, onDismiss = () => {}, reducedMotion = () => false }) {
  let view = null, ready = null, target = 0, levelKey = null, hideTimer = null, releaseTimer = null, version = 0;
  const live = () => view && !view.webContents.isDestroyed();
  /** Made when the first centred panel asks for a tint (its page is a whole renderer process, so an idle window carries none) and released 30 s after the tint is gone. */
  function ensure() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (!live()) {
      levelKey = null; target = 0;
      view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, partition: 'acira-page-scrim' } });
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const contents = view.webContents;
      ready = new Promise(resolve => contents.once('did-finish-load', () => { contents.insertCSS(BASE).then(resolve, resolve); }));
      contents.loadURL('data:text/html,<body>').catch(() => {});
      contents.on('input-event', (_event, input) => { if (input.type === 'mouseDown' && target > 0) onDismiss(); });
    }
    if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
    return view;
  }
  /** One rule holds the current tint and its transition time; replacing it lets the compositor ease between them. */
  async function level(alpha, ms) {
    const mine = ++version, contents = view.webContents; await ready;
    if (mine !== version || contents.isDestroyed()) return;
    const previous = levelKey;
    levelKey = await contents.insertCSS(`html{background:rgb(0 0 0 / ${alpha})!important;transition-duration:${ms}ms!important}`).catch(() => null);
    if (previous) contents.removeInsertedCSS(previous).catch(() => {});
  }
  /** Called on every applied layout and when the overlay closes. Keeps the scrim over the pages and under the popup. */
  function update(overlay, pageBounds, appearance) {
    const next = pageBounds ? scrimAlpha(overlay, appearance) : 0;
    if (!next && !live()) return;
    const layer = ensure(); if (!layer) return;
    if (next > 0) {
      const win = getWindow();
      if (win.contentView.children.at(-1) !== layer) win.contentView.addChildView(layer);
      layer.setBounds({ x: Math.round(pageBounds.x), y: Math.round(pageBounds.y), width: Math.round(pageBounds.width), height: Math.round(pageBounds.height) });
    }
    if (next === target) return;
    clearTimeout(releaseTimer); releaseTimer = null;
    const opening = next > target, ms = reducedMotion() ? 0 : opening ? OPEN_MS : CLOSE_MS;
    target = next; clearTimeout(hideTimer); hideTimer = null;
    if (opening) layer.setVisible(true);
    void level(next, ms);
    if (!next) {
      hideTimer = setTimeout(() => { if (!target && live()) view.setVisible(false); }, ms + 40);
      releaseTimer = setTimeout(() => { if (!target) release(); }, RELEASE_MS); releaseTimer.unref?.();
    }
  }
  function release() { clearTimeout(hideTimer); clearTimeout(releaseTimer); hideTimer = releaseTimer = null; if (live()) { try { getWindow()?.contentView.removeChildView(view); } catch {} view.webContents.close(); } view = null; ready = null; levelKey = null; ++version; }
  function destroy() { target = 0; release(); }
  return { update, destroy, get alpha() { return target; } };
}

module.exports = { createPageScrim, scrimAlpha };
