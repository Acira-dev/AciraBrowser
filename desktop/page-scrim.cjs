'use strict';
// Centred panels (tab viewer, profiles, command bar, Ctrl+Tab switcher) are modal moments: the page behind them dims so
// the panel is the only focus and a search field on the page underneath can't read as a second one (round 7). Acira
// pages live in the chrome view and websites in their own native views, so neither renderer can dim the other: one
// transparent native layer over the page area does, under the popup host and above every page. The layer's own page
// draws the tint and eases it with a CSS transition (in 200ms with the panel, out in 130ms), so the compositor animates
// it; a translucent view background colour is not composited. A click on it closes the panel, as a click on the page did.
const KINDS = new Set(['tabs', 'palette', 'switcher', 'transfer', 'whats-new', 'ranks', 'insider', 'member-card']);
const OPEN_MS = 200, CLOSE_MS = 130, RELEASE_MS = 30000;
/** D188 part 2: the Ctrl+Tab viewer comes on the press, for a tap as for a hold, so its veil waits this long behind it: a tap (Ctrl let go sooner) shows the viewer alone and never draws the veil, and
 *  a hold's veil eases in after the viewer is there. The veil also starts its way out when Ctrl goes up (`viewerLeaving`), not when the viewer's surface has closed 150 ms later: it never outlives the viewer. */
const SWITCHER_VEIL_MS = 120;
const BASE = 'html,body{height:100%;margin:0;background:rgb(0 0 0 / 0)}html{transition:background-color 200ms cubic-bezier(.23,1,.32,1)}';

/** The tint for a layout's overlay: 35% on dark chrome, 20% on light, none for anchored menus and toasts. */
function scrimAlpha(overlay, appearance) {
  // Beta 14: a dialog dims the WHOLE window (the sample's modal scrim: 30 % dark, 14 % light), in its own tints, over 300 ms on the house curve, and a click on it does not close it.
  if (overlay && overlay.kind === 'dialog') return appearance === 'dark' ? .30 : .14;
  return overlay && KINDS.has(overlay.kind) ? (appearance === 'dark' ? .35 : .2) : 0;
}
const scrimTint = (overlay, appearance) => overlay && overlay.kind === 'dialog' ? (appearance === 'dark' ? '6 8 14' : '20 24 34') : '0 0 0';
const DIALOG_MS = 300, DIALOG_EASE = 'cubic-bezier(.2,0,0,1)';

function createPageScrim({ WebContentsView, getWindow, onDismiss = () => {}, reducedMotion = () => false }) {
  let view = null, ready = null, target = 0, levelKey = null, hideTimer = null, releaseTimer = null, version = 0, targetTint = '0 0 0', modalOn = false;
  let veilTimer = null, veilArgs = null, leaving = false, switcherUp = false, lastAppearance = 'light';
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
      contents.on('input-event', (_event, input) => { if (input.type === 'mouseDown' && target > 0 && !modalOn) onDismiss(); });
    }
    if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
    return view;
  }
  /** One rule holds the current tint and its transition time; replacing it lets the compositor ease between them. */
  async function level(alpha, ms, tint = '0 0 0', ease = '') {
    const mine = ++version, contents = view.webContents; await ready;
    if (mine !== version || contents.isDestroyed()) return;
    const previous = levelKey;
    levelKey = await contents.insertCSS(`html{background:rgb(${tint} / ${alpha})!important;transition-duration:${ms}ms!important${ease ? `;transition-timing-function:${ease}!important` : ''}}`).catch(() => null);
    if (previous) contents.removeInsertedCSS(previous).catch(() => {});
  }
  /** Called on every applied layout and when the overlay closes. Keeps the scrim over the pages and under the popup. */
  function update(overlay, pageBounds, appearance, windowBox = null) {
    lastAppearance = appearance;
    if (overlay && overlay.kind === 'switcher') {
      switcherUp = true;
      if (leaving) return;                                     // Ctrl is up: this viewer's veil is on its way out and does not come back
      if (target === 0) {                                      // the viewer has just come: its veil waits (a tap never shows it)
        veilArgs = [overlay, pageBounds, appearance, windowBox];
        if (veilTimer === null) veilTimer = setTimeout(() => { veilTimer = null; if (!leaving && veilArgs) apply(...veilArgs); }, SWITCHER_VEIL_MS);
        return;
      }
    } else { clearTimeout(veilTimer); veilTimer = null; veilArgs = null; leaving = false; switcherUp = false; }
    apply(overlay, pageBounds, appearance, windowBox);
  }
  /** Ctrl went up: the Ctrl+Tab viewer starts its reverse. Its veil is dropped now (a veil that was never drawn never will be) and eases out over the same time. */
  function viewerLeaving() {
    if (!switcherUp) return;                                   // no viewer is up: nothing leaves, and the next one's veil is not held back
    clearTimeout(veilTimer); veilTimer = null; veilArgs = null; leaving = true;
    if (target > 0) apply(undefined, null, lastAppearance);
  }
  function apply(overlay, pageBounds, appearance, windowBox = null) {
    const dialog = Boolean(overlay && overlay.kind === 'dialog' && windowBox);
    const box = dialog ? windowBox : pageBounds, tint = scrimTint(overlay, appearance);
    const next = box ? scrimAlpha(overlay, appearance) : 0;
    if (next) modalOn = dialog;
    if (!next && !live()) return;
    const layer = ensure(); if (!layer) return;
    if (next > 0) {
      const win = getWindow();
      if (win.contentView.children.at(-1) !== layer) win.contentView.addChildView(layer);
      layer.setBounds({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
    }
    if (next === target && (!next || tint === targetTint)) return;
    clearTimeout(releaseTimer); releaseTimer = null;
    const opening = next > target, ms = reducedMotion() ? 0 : dialog || (!next && modalOn) ? DIALOG_MS : opening ? OPEN_MS : CLOSE_MS;
    if (next) targetTint = tint;
    target = next; clearTimeout(hideTimer); hideTimer = null;
    if (opening || next) layer.setVisible(true);
    void level(next, ms, next ? tint : targetTint, dialog || (!next && modalOn) ? DIALOG_EASE : '');
    if (!next) {
      hideTimer = setTimeout(() => { if (!target && live()) view.setVisible(false); modalOn = false; }, ms + 40 + (modalOn ? 80 : 0));
      releaseTimer = setTimeout(() => { if (!target) release(); }, RELEASE_MS); releaseTimer.unref?.();
    }
  }
  function release() { clearTimeout(hideTimer); clearTimeout(releaseTimer); hideTimer = releaseTimer = null; if (live()) { try { getWindow()?.contentView.removeChildView(view); } catch {} view.webContents.close(); } view = null; ready = null; levelKey = null; ++version; }
  function destroy() { target = 0; release(); }
  return { update, destroy, viewerLeaving, get alpha() { return target; } };
}

module.exports = { createPageScrim, scrimAlpha, SWITCHER_VEIL_MS };
