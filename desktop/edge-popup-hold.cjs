'use strict';
// 13.8, a hand test (Mac): "when I'm in Seamless mode and I press on an extension, the top bar or sidebar I'm working in should stay there, even though I
// opened the extension." While an extension's popup is open, the bar or sidebar it was opened from stays revealed, exactly as it does for Acira's own menus and
// popovers (edge-reveal.cjs `holds`), and goes by the normal rules only after the popup has closed.
//
// What happened: the popup is a window of its own (a view of the browser window on Wayland, extension-popup-window.cjs). The moment it shows it takes the keyboard, so
// the browser window is no longer focused, and the controller hides what it shows when its window is deactivated unless something holds the edge open ("Window
// deactivation ... hides at once, unless something holds the edge open"); the interface's own holds (a menu, a press, focus in the chrome) all end with that focus. A
// popup that is a view of the window (Wayland) leaves the focus alone, but the pointer goes down into it, out of the bar, and the grace runs out under an open popup.
//
// Every popup of every kind (a click on the toolbar's button, a pinned extension in the sidebar, the extensions menu, an extension's shortcut, chrome.action.openPopup:
// the interface presses the extension's own button for the last two, BrowserExtensionActions.tsx) is made by the one engine hook, which tells the toolbar glue with
// 'browser-action-popup-created' (extension-popup-window.cjs installPopupFrames). That event is the only thing used here: the popup's file is not touched.
// Pure logic and a tiny registry; no Electron.

/** A popup that has not shown yet (its page is loading) holds for at most this long: a page that never loads must not keep a bar open for good. */
const OPENING_MS = 5000;
/** The bars' sizes are the interface's own boxes; an anchor on their rim still counts as in them. */
const LEEWAY = 8;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const usable = anchor => !!anchor && finite(anchor.x) && finite(anchor.y) && finite(anchor.width) && finite(anchor.height) && anchor.width > 0 && anchor.height > 0;

/**
 * Which of the shown edges a popup was opened from. `shown` is what the controller shows at the moment the popup is made ({top, side}); `anchor` is the button's box
 * in the interface's CSS pixels, `scale` the Interface size (CSS px to DIPs), `size` the bars' boxes in DIPs ({topHeight, sideWidth}), `width` the window's content width and
 * `sidebarSide` where the sidebar is (a right sidebar is measured from the right).
 * - Nothing shown: nothing to keep (an extension's shortcut pressed while no bar is up).
 * - The button lies in one shown bar: that bar. In both (the corner they share): both.
 * - It lies in neither shown bar, or its box is unknown (the extensions menu's own box, a button that is not drawn): whatever is shown, which is what the popup came out of.
 */
function zonesFor({ anchor, scale = 1, size, width = 0, sidebarSide = 'left', shown } = {}) {
  const live = { top: !!(shown && shown.top), side: !!(shown && shown.side) };
  if (!live.top && !live.side) return { top: false, side: false };
  if (!usable(anchor) || !size) return live;
  const k = finite(scale) && scale > 0 ? scale : 1;
  const x = (anchor.x + anchor.width / 2) * k, y = (anchor.y + anchor.height / 2) * k;
  const along = sidebarSide === 'right' && width > 0 ? width - x : x;
  const from = {
    top: live.top && size.topHeight > 0 && y < size.topHeight + LEEWAY,
    side: live.side && size.sideWidth > 0 && along < size.sideWidth + LEEWAY,
  };
  return from.top || from.side ? from : live;
}

// Weakly held: a closed window's hold (it keeps that window's whole closure alive) must not outlive the window just because no popup was ever made after it closed.
const registry = new Set();
const holdsNow = () => { const alive = []; for (const ref of [...registry]) { const hold = ref.deref(); if (hold) alive.push(hold); else registry.delete(ref); } return alive; };
const sameWindow = (a, b) => !!a && !!b && (a === b || (a.id !== undefined && a.id === b.id));
const destroyed = popup => { try { return typeof popup.isDestroyed === 'function' ? !!popup.isDestroyed() : !!popup.destroyed; } catch { return true; } };

/**
 * One per browser window. `window()` is the window, `shown()` what its edge controller shows now, `geometry()` the numbers `zonesFor` reads. `holds()` is what the popups of this
 * window keep open; `merge(base)` adds it to the holds the interface sent (the controller's `holds` input), returning `base` itself when no popup is open.
 */
function createPopupHold({ window, shown, geometry, now = Date.now }) {
  const entries = new Set();
  const hold = {
    window,
    /** A popup was made: hold the edges it came from until it is gone. Returns the entry, or null when nothing was showing. */
    add(popup) {
      if (!popup || typeof popup.once !== 'function') return null;
      let zones;
      try { zones = zonesFor({ anchor: popup.anchorRect, ...(geometry ? geometry() : {}), shown: shown() }); } catch { zones = { top: false, side: false }; }
      if (!zones.top && !zones.side) return null;
      const entry = { popup, zones, at: now() };
      entries.add(entry);
      popup.once('gone', () => { entries.delete(entry); });
      return entry;
    },
    holds() {
      const out = { top: false, side: false };
      const t = now();
      for (const entry of [...entries]) {
        // A popup the engine dropped without saying so ends its hold the same way (its page and window are gone).
        if (destroyed(entry.popup)) { entries.delete(entry); continue; }
        if (entry.popup.hidden === true && t - entry.at > OPENING_MS) continue;
        if (entry.zones.top) out.top = true;
        if (entry.zones.side) out.side = true;
      }
      return out;
    },
    merge(base) {
      if (!entries.size) return base;
      const held = hold.holds();
      return held.top || held.side ? { top: !!(base && base.top) || held.top, side: !!(base && base.side) || held.side } : base;
    },
    get open() { return entries.size; },
  };
  holdsNow();   // drops the holds of windows that are gone
  registry.add(new WeakRef(hold));
  return hold;
}

/** 'browser-action-popup-created': the popup goes to the window it belongs to (a window that is closed gets nothing). */
function noteExtensionPopup(popup) {
  try {
    if (!popup) return;
    for (const hold of holdsNow()) {
      let win = null;
      try { win = hold.window(); } catch { win = null; }
      if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) continue;
      if (sameWindow(win, popup.parent)) hold.add(popup);
    }
  } catch { /* a hold that cannot be taken is never a reason to lose the popup */ }
}

module.exports = { zonesFor, createPopupHold, noteExtensionPopup, OPENING_MS, LEEWAY };
