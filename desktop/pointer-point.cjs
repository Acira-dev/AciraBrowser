'use strict';
// Where the pointer is, for the edge reveal (edge-reveal.cjs), on a window system that will not say.
//
// Why: the reveal of the sidebar and of the top bar (Seamless, Hide the toolbar, a closed sidebar's left edge) is decided by main from
// screen.getCursorScreenPoint(), because the page is a native view above the interface and the interface never sees the pointer at the edge.
// On a native Wayland session (CachyOS with KDE Plasma, most Linux desktops now: Electron 38 made it the default) Electron 44.9.3 answers
// { x: 0, y: 0 } to that call every time: shell/browser/api/electron_api_screen.cc, "if (x11_util::IsWayland()) return {};", added by
// electron/electron#50092 (6 Mar 2026); its own typings say "Not supported on Wayland (Linux)". A pointer fixed at (0, 0) can never be at the
// sidebar's edge, and (depending on where the window's box sits) either never shows the top bar or shows it once and never lets it go.
// Reported on 13.6 (Discord, 11 Nov 2026); the same since beta.10: reveals never worked on native Wayland.
//
// What does work on Wayland: the pointer events the window's own views receive. The pages and the interface already report every one of them to
// main (before-mouse-event: type, and x and y in that view), for the "a button is held" rule. This file turns them into a pointer position
// in the window's own coordinates: the view's origin in the window plus the event's x and y, forgotten when the view reports the pointer left
// (mouseLeave) or goes away. No screen coordinates are involved, so the window system's refusal to give them does not matter: an event's
// globalX / globalY are never read (on Wayland they are its x and y plus a made-up window origin), and neither is the window's own x and y.
//
// Used only where the screen answer cannot be trusted: a Wayland session, or a Linux session in which the screen answer has been seen to be a
// constant (0, 0) while the pointer demonstrably moves (learned, below). Mac, Windows and X11 keep screen.getCursorScreenPoint(), unchanged.
//
// Pure (no Electron imports): everything is injected, so every rule has a test (tests/pointer-point.test.cjs, tests/edge-reveal-wayland.test.cjs).

/** Pointer events that carry a position in the view that received them. mouseLeave is handled on its own. */
const POSITIONED = new Set(['mouseMove', 'mouseDown', 'mouseUp', 'mouseWheel', 'mouseEnter', 'contextMenu']);
const LEARN_READS = 30;   // consecutive screen answers of exactly (0, 0) ...
const LEARN_FAR = 48;     // ... while the pointer events put the pointer at least this far from the origin ...
const LEARN_FRESH = 500;  // ... and the last of them is this fresh (ms): then the screen answer is a constant, not a pointer at the corner

/**
 * Is this Linux process a Wayland client? The same facts the extension popup host uses (extension-popup-host.cjs, popupHostFor): the ozone
 * platform Chromium was told to use, else the session. ozone is the --ozone-platform / --ozone-platform-hint value ('' when none was named).
 */
function waylandSession({ platform = process.platform, env = process.env, ozone = '' } = {}) {
  if (platform !== 'linux') return false;
  const chosen = String(ozone || '').toLowerCase();
  if (chosen === 'x11') return false;
  if (chosen === 'wayland') return true;
  return String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
}

/** 'events' (the window's own pointer events) or 'screen' (screen.getCursorScreenPoint()) before anything is learned. A test switch may force either, on a test profile only. */
function pointerSourceFor({ platform = process.platform, env = process.env, ozone = '' } = {}) {
  const forced = String((env.ACIRA_BROWSER_TEST_DATA && env.ACIRA_POINTER_SOURCE) || '').toLowerCase();
  if (forced === 'events' || forced === 'screen') return forced;
  return waylandSession({ platform, env, ozone }) ? 'events' : 'screen';
}

// One answer for the whole run once a Linux session has shown that the screen answer is a constant (0, 0): every window uses the events from then on.
let learnedConstant = false;
const learnedNow = () => learnedConstant;
const forgetForTests = () => { learnedConstant = false; };

/**
 * One per window. `note(owner, event, origin)` is called for every pointer event a view of the window receives (owner: any value that names the
 * view, origin: that view's { x, y } in the window's content, DIPs); `point()` is where the pointer is in the window's content coordinates, or
 * null when it is not over any of the window's views.
 */
function createPointerSource({ platform = process.platform, env = process.env, ozone = '', now = Date.now, log = () => {} } = {}) {
  const base = pointerSourceFor({ platform, env, ozone });
  const forced = Boolean(env.ACIRA_BROWSER_TEST_DATA && (env.ACIRA_POINTER_SOURCE === 'events' || env.ACIRA_POINTER_SOURCE === 'screen'));
  // Events are recorded on every Linux session (so a constant screen answer can be recognised) and wherever a test forces a source; Mac and Windows record nothing.
  const listening = platform === 'linux' || forced;
  let owner = null, last = null, stamp = 0, zeroRuns = 0;

  const source = {
    /** Does main need to feed this? (False on Mac and Windows: nothing is wired or recorded there.) */
    get listening() { return listening; },
    /** Is the pointer taken from the window's own events now? */
    eventsMode() { return base === 'events' || (platform === 'linux' && learnedConstant && !forced); },
    note(from, event, origin) {
      if (!listening || !event || typeof event.type !== 'string') return;
      if (event.type === 'mouseLeave') {
        // Only the view that has the pointer can say it left: the page the pointer moved on from may report its leave after the interface has already reported the enter.
        if (from === owner) { owner = null; last = null; }
        return;
      }
      if (!POSITIONED.has(event.type)) return;
      const ox = origin && Number(origin.x), oy = origin && Number(origin.y), x = Number(event.x), y = Number(event.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      owner = from; last = { x: ox + x, y: oy + y }; stamp = now();
    },
    /** A view went away (a closed page): if it had the pointer, nobody has it now. */
    forget(from) { if (from === owner) { owner = null; last = null; } },
    point() { return last ? { x: last.x, y: last.y } : null; },
    /** Every screen answer the poller got, so a constant (0, 0) on a session not recognised as Wayland is learned. */
    noteCursorRead(point) {
      if (platform !== 'linux' || forced || base === 'events' || learnedConstant) return;
      const zero = !!point && point.x === 0 && point.y === 0;
      const known = !!last && now() - stamp <= LEARN_FRESH && Math.hypot(last.x, last.y) >= LEARN_FAR;
      if (!(zero && known)) { zeroRuns = 0; return; }
      if (++zeroRuns >= LEARN_READS) { learnedConstant = true; try { log('The system gave no pointer position (always 0, 0): the window\'s own pointer events are used for the edge reveal.'); } catch { /* a log that throws */ } }
    },
    /** For the trace and the tests. */
    state() { return { mode: source.eventsMode() ? 'events' : 'screen', owner: owner !== null, point: source.point(), learned: learnedConstant }; },
  };
  return source;
}

module.exports = { createPointerSource, pointerSourceFor, waylandSession, learnedNow, forgetForTests, POSITIONED, LEARN_READS, LEARN_FAR, LEARN_FRESH };
