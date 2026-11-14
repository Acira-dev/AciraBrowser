'use strict';
// Keyboard focus follows the page, as in Chrome (reported 6 Nov: "I click a tab in the sidebar, go to another app, come back,
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

/** Is this element one that is typed in (a text field, a contenteditable rename, a combobox)? Runs inside the interface page too: the probes
 * below send its source along with theirs. */
function isTextField(el) {
  const tag = String(el.tagName || '').toUpperCase();
  const type = String(el.type || '').toLowerCase();
  const role = typeof el.getAttribute === 'function' ? String(el.getAttribute('role') || '').toLowerCase() : '';
  return el.isContentEditable === true || tag === 'TEXTAREA' || tag === 'SELECT'
    || (tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type))
    || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role);
}

/** Runs inside the interface page: does what has focus there want to keep it? Kept as one function so main can send its source and a
 * test can call it with a stand-in document. */
function interfaceKeepsFocus(doc, textField = isTextField) {
  const el = doc && doc.activeElement;
  if (!el || el === doc.body || el === doc.documentElement) return false;
  if (textField(el)) return true;
  // A press with the mouse leaves a button focused but not `:focus-visible`; Tab, F6 and the arrow keys do.
  try { return el.matches(':focus-visible') === true; } catch { return false; }
}
const INTERFACE_FOCUS_PROBE = `(${interfaceKeepsFocus.toString()})(document, ${isTextField.toString()})`;

/** Runs inside the interface page: is the person typing there, in an interface that already shows tab `tabId` (the interface writes the tab it
 * shows to `window.__aciraShownTab` when it draws it, src/App.tsx)? A field that has focus from before the interface drew that tab belongs to
 * the tab that was left (the interface closes it when it draws the switch), so it does not count. */
function typingFor(doc, tabId, textField = isTextField) {
  const el = doc && doc.activeElement;
  if (!el || el === doc.body || el === doc.documentElement) return false;
  const view = doc.defaultView;
  return Boolean(view) && typeof tabId === 'string' && view.__aciraShownTab === tabId && textField(el) === true;
}
const typingProbe = tabId => `(${typingFor.toString()})(document, ${JSON.stringify(String(tabId))}, ${isTextField.toString()})`;

/**
 * Keyboard focus moves inside Acira only while its window is the active one (13.8: a background Acira whose tab on screen navigated by
 * itself came to the front and took the keyboard from the app the person was using). Giving a web contents the keyboard is not a quiet move
 * inside the window in Electron:
 *  - macOS and Linux: WebContents::Focus() first calls owner_window()->Focus(true) (shell/browser/api/electron_api_web_contents.cc), which is
 *    [NSApp activateIgnoringOtherApps:] + makeKeyAndOrderFront (shell/browser/native_window_mac.mm) or widget()->Activate()
 *    (shell/browser/native_window_views.cc): the app comes to the front over the one the person is using;
 *  - Windows: web_contents()->Focus() focuses the page's aura window, and a views FocusManager asked to focus a view of an inactive widget
 *    stores it and activates the widget (ui/views/focus/focus_manager.cc SetFocusedViewWithReason) -> HWNDMessageHandler::Activate ->
 *    ::SetForegroundWindow (ui/views/win/hwnd_message_handler.cc): Windows either flashes the taskbar button or puts Acira in front.
 * Chromium never moves the keyboard into a window that is not the active one: a tab change in an inactive window does not restore focus but
 * marks it for activation (chrome/browser/ui/views/frame/browser_view.cc OnActiveTabChanged: will_restore_focus needs
 * GetWidget()->IsActive(), else restore_focus_on_activation_), and a widget stores its focused view when it loses activation and restores
 * it when it gains it (ui/views/widget/native_widget_mac.mm OnWindowKeyStatusChanged, ui/views/widget/desktop_aura/
 * desktop_native_widget_aura.cc OnWindowActivated -> FocusManager::StoreFocusedView / RestoreFocusedView).
 * Here every focus request goes through the gate: while the window is active it is given at once; while it is not, the target is stored
 * (the latest request wins, as SetStoredFocusView) and given the keyboard by the window's own 'focus' event, in that same step, if it is
 * still a place the keyboard can go (`usable`).
 * env: active() is the window the active one, give(contents) the native focus call, usable(contents) may the stored target still take it.
 */
function createFocusGate({active, give, usable = () => true}) {
  let stored = null, held = null;
  const live = value => Boolean(value && !(typeof value.isDestroyed === 'function' && value.isDestroyed()));
  const hand = contents => { held = contents; give(contents); };
  return {
    /** 'now': given the keyboard; 'stored': kept for the window's activation; 'gone': nothing to focus. */
    request(contents) {
      if (!live(contents)) return 'gone';
      if (active()) { stored = null; hand(contents); return 'now'; }
      stored = contents;
      return 'stored';
    },
    /** The window became the active one: the stored target takes the keyboard now. Returns it, or null when there was none to give. */
    activated() {
      const contents = stored;
      stored = null;
      if (!live(contents) || !usable(contents)) return null;
      hand(contents);
      return contents;
    },
    /** A web contents of this window got the keyboard (its 'focus' event: a press, a Tab, the platform's own restore on activation). */
    focused(contents) { if (live(contents) && active()) held = contents; },
    /** Who takes the keyboard when the window is active again: the stored target, else whoever held it when the window was left. */
    holder() { return live(stored) ? stored : live(held) ? held : null; },
    stored() { return live(stored) ? stored : null; },
  };
}

/**
 * env: window() the BaseWindow, chrome() the interface's webContents, page() the tab on screen as {id, contents, visible} or null
 * (no web page, locked, gone), blocked() true while something else owns the keyboard (a sign-in card, a dialog, a popup),
 * focus(contents) gives a webContents the keyboard (main: through the focus gate above, so in a window that is not the active one it only
 * stores where the keyboard goes). windowActive() is the window the active one, holder() the web contents that takes the keyboard when it
 * is active again (createFocusGate holder). timers is injectable for tests.
 */
function createPageFocus({window, chrome, page, blocked = () => false, focus, windowActive = () => true, holder = () => null, timers = {setTimeout, clearTimeout}}) {
  let activateTimer = null;
  const live = value => Boolean(value && !(typeof value.isDestroyed === 'function' && value.isDestroyed()));
  /** Does the interface hold the keyboard? While the window is not the active one the platform may report no focus anywhere (Windows clears
   * it on deactivation), so it is whether the interface takes it back when the person returns. */
  const interfaceHolds = ui => ui.isFocused() || (!windowActive() && holder() === ui);
  /** Does the interface hold the keyboard for typing or keyboard navigation right now? Not asked of a page or popup that holds it. */
  const interfaceBusy = async () => {
    const ui = chrome();
    if (!live(ui) || !ui.isFocused()) return false;
    try { return (await ui.executeJavaScript(INTERFACE_FOCUS_PROBE)) !== false; } catch { return true; }   // cannot say: leave it where it is
  };
  /** Is the person typing in the interface, for tab `tabId`? Only asked while the interface holds the keyboard; cannot say = no (the page takes
   * it, as before). */
  const typingHere = async tabId => {
    const ui = chrome();
    if (!live(ui) || !interfaceHolds(ui)) return false;
    try { return (await ui.executeJavaScript(typingProbe(tabId))) === true; } catch { return false; }
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
          // The first look comes when main gets to it, which on a busy main is after the person has clicked the address field and started typing
          // (13.8, a Windows report: the field lost focus mid-word and the rest of the letters went to the page). The press itself blurred any
          // field, so a field typed in for this very tab was entered after it: the person's typing wins.
          if (left === RETRIES && await typingHere(shown.id)) return;
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
    /**
     * The tab on screen was just shown (a switch, a tab woken from sleep): it takes the keyboard, as Chromium's tab switch restores the
     * keyboard to the page (BrowserView::OnActiveTabChanged -> WebContents::RestoreFocus). Chromium does that in the same step as the switch,
     * so nothing the person does afterwards is undone by it; here main may get to it late (a busy main, a page that shows only once it has
     * loaded), after the person has clicked the address field and started typing. The omnibox the person types in keeps the keyboard
     * (OmniboxEditModel: what they type wins), so a page shown while they type for this tab does not take it. `still()` re-checks main's own
     * conditions after the question.
     */
    presented(contents, tabId, still = () => true) {
      const ui = chrome();
      if (!live(ui) || !interfaceHolds(ui)) { focus(contents); return; }     // the interface does not hold the keyboard: nothing to protect
      void (async () => {
        if (await typingHere(tabId)) return;
        const shown = page();
        if (!shown || shown.id !== tabId || shown.contents !== contents || !shown.visible || !live(contents) || !still()) return;
        focus(contents);
      })();
    },
    dispose() { timers.clearTimeout(activateTimer); activateTimer = null; },
  };
}

module.exports = {createPageFocus, createFocusGate, interfaceKeepsFocus, isTextField, typingFor, typingProbe, INTERFACE_FOCUS_PROBE, ACTIVATE_DELAY_MS, RETRY_MS, RETRIES};
