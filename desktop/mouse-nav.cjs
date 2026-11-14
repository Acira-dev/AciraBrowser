'use strict';
// The mouse's back and forward buttons (buttons 4 and 5; 3 and 4 in a page's MouseEvent.button), as Chromium handles them.
//
// Chromium's rule lives in its content layer, which Electron is: when the renderer is done with the RELEASE of either button and did not
// consume it, the outermost web contents under the pointer goes back or forward, if it can (content/browser/renderer_host/
// render_widget_host_impl.cc OnMouseEventAck -> content/browser/web_contents/web_contents_impl.cc HandleMouseEvent). A page that cancels the
// mouseup or the auxclick of that button keeps it: Blink merges the two results (third_party/blink/renderer/core/input/event_handler.cc
// HandleMouseReleaseEvent), so web apps can use the buttons themselves. A tab's page, a pane of a split, a Link preview, an extension popup
// and an extension side panel are web contents of their own, so each already steps its own history under the pointer, on the release, once.
//
// What Acira adds, and nothing more:
//  1. Acira's interface (the sidebar, the toolbar, Acira's own pages) and its popup layer are web contents too, so Chromium would step THEIR
//     history. Chrome's own interface is not a web page: a side button over it goes back in the active tab (Windows: WM_APPCOMMAND ->
//     IDC_BACK). Over the interface the button is kept from the interface page and the active tab steps on the release, through the same
//     Back as the toolbar's. Over an open menu or panel of the popup layer nothing happens (Chrome's menus take the pointer).
//  2. A tab's history also holds Acira's own pages (the New Tab it was opened from), which its page's web contents does not have: when the
//     page could not step by itself and did not cancel the button (desktop/page-input-preload.cjs says which), the tab's own Back takes it
//     there, as Chrome goes back to its New Tab page.
//  3. One step per click. Electron on Linux turns the button's PRESS into the window's 'app-command' (shell/browser/native_window_views.cc
//     OnMouseEvent) while Chromium still steps on the release, and a mouse driver may send WM_APPCOMMAND besides the button on Windows: a
//     back/forward app-command that comes with a side-button press or release in this window is dropped. Alone (a keyboard's Browser Back
//     key, a driver that sends only the command) it still steps the active tab.
//
//  4. Over the sidebar's own body (its tab list and workspaces, its footer), as in Arc and Zen: back goes to the previous workspace and forward to
//     the next, in the switcher's order, through the switcher's own workspace.select (and its motion). Nothing past the first or the last (no
//     wrap, like Zen, and no fall-through to the tab), nothing while a menu or panel is open. With only one workspace there is nothing to switch
//     to, so the sidebar's body steps the tab, as the rest of the interface does (rule 1). The toolbar, the address field and the caption strip
//     keep the tab's back and forward. Which part of the interface is under the pointer is asked of the interface page itself (sidebarZone,
//     on the press; used on the release).
//
// env: active(direction) steps the active tab (-1 back, +1 forward) as the toolbar's Back/Forward does; tabStep(tabId, direction) steps that
// tab through Acira's own history; tabCanStep(tabId, direction) does that tab's own history have an entry there; zoneAt(x, y) which part of the
// interface is at that point ('sidebar' | 'other', a promise); workspace(direction) steps the workspace (nothing past the ends); workspaces() how many the switcher lists; blocked() a menu
// or panel is open; now and timers are injectable.

const BUTTONS = Object.freeze({back: -1, forward: 1});
/** How long after a side-button press or release an app-command is taken to be that button's (Linux sends it with the press, a driver with either). */
const DEDUPE_MS = 600;
/** How long an app-command waits for the mouse event it may belong to (on Linux the command comes before the press reaches the page). */
const APP_COMMAND_DELAY_MS = 120;
/** How long a page's own answer (did it cancel the button?) is awaited after the release. */
const REPORT_MS = 500;

const directionOf = button => (Object.hasOwn(BUTTONS, button) ? BUTTONS[button] : 0);
/** How long the release waits for the interface's answer about the point under the pointer (asked on the press). */
const ZONE_MS = 250;

/**
 * Runs inside Acira's interface page (main sends its source): which part of the interface is at (x, y), in CSS pixels. 'sidebar' is the sidebar's
 * own body: its tab list and workspaces, its footer. Not the caption strip at its top (the window's drag area), not its resize edge, not a text
 * field; the toolbar and the address field are never inside the sidebar element (with the address in the sidebar they sit above it). A hidden
 * sidebar (tabs on top) is no sidebar. Anything else is 'other'.
 */
function sidebarZone(doc, x, y) {
  const el = doc && typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
  if (!el || typeof el.closest !== 'function') return 'other';
  const sidebar = el.closest('.acira-sidebar');
  if (!sidebar || sidebar.getAttribute('aria-hidden') === 'true' || sidebar.hasAttribute('inert')) return 'other';
  if (el.closest('.sb-caption, .sb-resize, input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]')) return 'other';
  return 'sidebar';
}
const sidebarZoneProbe = (x, y) => `(${sidebarZone.toString()})(document, ${Number(x) || 0}, ${Number(y) || 0})`;
/** The workspace a side button or a swipe over the sidebar goes to: the one before (-1) or after (+1) in the switcher's list, never wrapping
 *  round, none with fewer than two. */
function steppedWorkspace(list, activeId, direction) {
  if (!Array.isArray(list) || list.length < 2 || (direction !== -1 && direction !== 1)) return null;
  const at = list.findIndex(item => item && item.id === activeId);
  if (at < 0) return null;
  return list[at + direction] || null;
}

function createMouseNav({active, tabStep, tabCanStep = () => false, zoneAt = null, workspace = () => {}, workspaces = () => 0, blocked = () => false, now = Date.now, timers = {setTimeout, clearTimeout}}) {
  let lastButtonAt = -Infinity, zone = null, pressBlocked = false;
  /** The interface's answer for a point, or 'other' if it does not come in time (then the tab steps, as before). */
  const zoneOf = (x, y) => {
    if (typeof zoneAt !== 'function') return Promise.resolve('other');
    let timer = null;
    const late = new Promise(resolve => { timer = timers.setTimeout(() => resolve('other'), ZONE_MS); });
    return Promise.race([Promise.resolve().then(() => zoneAt(x, y)).catch(() => 'other'), late]).then(answer => { timers.clearTimeout(timer); return answer === 'sidebar' ? 'sidebar' : 'other'; });
  };
  const pending = new Map();                          // web contents -> {tabId, direction, couldStep, timer}
  const queued = new Set();                           // app-commands waiting for their mouse event
  const noteButton = () => {
    lastButtonAt = now();
    for (const item of queued) { timers.clearTimeout(item.timer); queued.delete(item); }   // the command was this click's
  };
  const isSide = mouse => Boolean(mouse) && (mouse.type === 'mouseDown' || mouse.type === 'mouseUp') && directionOf(mouse.button) !== 0;
  return {
    /** A page's web contents (a tab, a pane) got a mouse event (before-mouse-event). Chromium steps it on the release unless the page cancels; this
     *  only remembers whether it could, for the page's answer (report). */
    page(tabId, contents, mouse) {
      if (!isSide(mouse)) return;
      noteButton();
      if (mouse.type !== 'mouseUp' || !contents) return;
      const direction = directionOf(mouse.button);
      let couldStep = true;
      try { couldStep = direction < 0 ? contents.navigationHistory.canGoBack() : contents.navigationHistory.canGoForward(); } catch { /* gone: nothing to do */ }
      const before = pending.get(contents); if (before) timers.clearTimeout(before.timer);
      const item = {tabId, direction, couldStep, timer: null};
      item.timer = timers.setTimeout(() => { if (pending.get(contents) === item) pending.delete(contents); }, REPORT_MS);
      pending.set(contents, item);
    },
    /** The page's own answer for its last release (page-input-preload.cjs): did it cancel the button? When it did not, and its web contents could
     *  not step, the tab's own history (an Acira page before it) takes the step. Returns what it did. */
    report(contents, answer) {
      const item = pending.get(contents);
      if (!item || !answer || typeof answer !== 'object' || directionOf(answer.button) !== item.direction) return 'none';
      pending.delete(contents); timers.clearTimeout(item.timer);
      if (answer.prevented === true) return 'page-kept-it';
      if (item.couldStep) return 'chromium-stepped';
      if (!tabCanStep(item.tabId, item.direction)) return 'nothing-to-step';
      tabStep(item.tabId, item.direction);
      return 'tab-stepped';
    },
    /** Acira's interface ('interface') or its popup layer ('popup') got a mouse event: a side button is kept from that page (its own history never
     *  moves); over the interface the active tab steps on the release. */
    ui(kind, mouse, event) {
      if (!isSide(mouse)) return false;
      try { event?.preventDefault(); } catch { /* no event */ }
      noteButton();
      if (kind !== 'interface') return true;
      if (mouse.type === 'mouseDown') { zone = zoneOf(mouse.x, mouse.y); pressBlocked = Boolean(blocked()); return true; }
      if (mouse.type !== 'mouseUp') return true;
      const direction = directionOf(mouse.button), asked = zone || zoneOf(mouse.x, mouse.y), wasBlocked = pressBlocked;
      zone = null; pressBlocked = false;
      // A menu or panel open at the press or the release: nothing (its own layer takes the pointer).
      void asked.then(where => { if (wasBlocked || blocked()) return; if (where === 'sidebar' && workspaces() > 1) workspace(direction); else active(direction); });
      return true;
    },
    /** The window's 'app-command'. Back/forward: dropped when it came with a side-button click, else the active tab steps (after a moment, in
     *  case the click's own mouse event is still on its way). Returns true for back/forward (handled here), false for anything else. */
    appCommand(command) {
      const direction = command === 'browser-backward' ? -1 : command === 'browser-forward' ? 1 : 0;
      if (!direction) return false;
      if (now() - lastButtonAt <= DEDUPE_MS) return true;
      const item = {timer: null};
      item.timer = timers.setTimeout(() => { if (!queued.delete(item)) return; if (now() - lastButtonAt <= DEDUPE_MS) return; active(direction); }, APP_COMMAND_DELAY_MS);
      queued.add(item);
      return true;
    },
  };
}

module.exports = {createMouseNav, directionOf, sidebarZone, sidebarZoneProbe, steppedWorkspace, DEDUPE_MS, APP_COMMAND_DELAY_MS, REPORT_MS, ZONE_MS};
