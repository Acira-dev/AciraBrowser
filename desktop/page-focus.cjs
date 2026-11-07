'use strict';
// Keyboard focus follows the page, as in Chrome (founder, 6 Nov: "I click a tab in the sidebar, go to another app, come back,
// press Space, and nothing happens"). Acira's interface and every website are separate web contents, and only one of them holds the
// keyboard. A press in the sidebar gives it to the interface, and nothing gave it back unless the tab on screen changed, so Space
// (pause), the arrow keys and Page Down went to the sidebar. Two rules put it back, each only when the interface holds it and is not
// being used for typing or keyboard navigation:
//   1. chose(): a press that chose a page (a tab, a favorite, a bookmark) hands the keyboard to the tab on screen once it is shown.
//   2. activated(): when the window becomes the active one again (back from another app), the same, unless the interface's own
//      focus is in a text field (the address bar while typing, a search box, a rename field) or was put there with the keyboard
//      (Tab, F6, arrows: `:focus-visible`), which keeps it.

const ACTIVATE_DELAY_MS = 120;
const RETRY_MS = 50;
const RETRIES = 12;

/** Runs inside the interface page: does what has focus there want to keep it? Kept as one function so main can send its source and a
 * test can call it with a stand-in document. */
function interfaceKeepsFocus(doc) {
  const el = doc && doc.activeElement;
  if (!el || el === doc.body || el === doc.documentElement) return false;
  const tag = String(el.tagName || '').toUpperCase();
  const type = String(el.type || '').toLowerCase();
  const role = typeof el.getAttribute === 'function' ? String(el.getAttribute('role') || '').toLowerCase() : '';
  const typing = el.isContentEditable === true || tag === 'TEXTAREA' || tag === 'SELECT'
    || (tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type))
    || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role);
  if (typing) return true;
  // A press with the mouse leaves a button focused but not `:focus-visible`; Tab, F6 and the arrow keys do.
  try { return el.matches(':focus-visible') === true; } catch { return false; }
}
const INTERFACE_FOCUS_PROBE = `(${interfaceKeepsFocus.toString()})(document)`;

/**
 * env: window() the BaseWindow, chrome() the interface's webContents, page() the tab on screen as {id, contents, visible} or null
 * (no web page, locked, gone), blocked() true while something else owns the keyboard (a sign-in card, a dialog, a popup),
 * focus(contents) gives a webContents the keyboard. timers is injectable for tests.
 */
function createPageFocus({window, chrome, page, blocked = () => false, focus, timers = {setTimeout, clearTimeout}}) {
  let activateTimer = null;
  const live = value => Boolean(value && !(typeof value.isDestroyed === 'function' && value.isDestroyed()));
  /** Does the interface hold the keyboard for typing or keyboard navigation right now? Not asked of a page or popup that holds it. */
  const interfaceBusy = async () => {
    const ui = chrome();
    if (!live(ui) || !ui.isFocused()) return false;
    try { return (await ui.executeJavaScript(INTERFACE_FOCUS_PROBE)) !== false; } catch { return true; }   // cannot say: leave it where it is
  };
  return {
    /** A press chose a page. The tab may still be on its way to the screen (a switch, a new tab), so look a few times. */
    chose() {
      const look = async left => {
        if (blocked()) return;
        const win = window();
        if (!live(win)) return;
        const shown = page();
        if (shown && live(shown.contents) && shown.visible) {
          // It took a few looks (a tab on its way to the screen): the person may have moved on meanwhile, a rename field open in the interface.
          if (left < RETRIES && await interfaceBusy()) return;
          if (blocked()) return;
          focus(shown.contents);
          return;
        }
        if (left > 0) timers.setTimeout(() => look(left - 1), RETRY_MS);
      };
      void look(RETRIES);
    },
    /** The window became the active one (back from another app). */
    activated() {
      timers.clearTimeout(activateTimer);
      activateTimer = timers.setTimeout(async () => {
        activateTimer = null;
        if (blocked()) return;
        const win = window(), ui = chrome();
        if (!live(win) || !win.isFocused() || !live(ui) || !ui.isFocused()) return;     // the page (or a popup) already has the keyboard
        const shown = page();
        if (!shown || !live(shown.contents) || !shown.visible) return;
        if (await interfaceBusy()) return;
        if (blocked() || !win.isFocused() || !ui.isFocused()) return;                    // looked again: the answer is old if the person moved
        focus(shown.contents);
      }, ACTIVATE_DELAY_MS);
    },
    dispose() { timers.clearTimeout(activateTimer); activateTimer = null; },
  };
}

module.exports = {createPageFocus, interfaceKeepsFocus, INTERFACE_FOCUS_PROBE, ACTIVATE_DELAY_MS, RETRY_MS, RETRIES};
