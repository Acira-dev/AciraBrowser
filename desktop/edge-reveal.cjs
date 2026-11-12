'use strict';
// R3-68 Seamless: when does the toolbar (top edge) or the sidebar (left edge, or the right one when the sidebar stands there) show, and when does it go away again?
// The page is a native view stacked above the interface, so the interface never sees the pointer at the window's edge;
// main watches the cursor instead. All of the rules live here, in one pure state machine with no Electron imports and an
// injected clock, so every rule has a test (tests/edge-reveal.test.cjs). The poller at the bottom feeds it.
// Numbers: docs/launch/research/SEAMLESS_MODE_SPEC.md §4.2 to §4.4 (Zen's compact mode, measured, plus the fixes its users
// ask for: a dwell before it shows, holds, a grace that is never restarted by jitter, tolerance outside the window).

// R4-24 (founder: "the hot zone is too thin, I have to really edge my mouse, especially with multiple monitors"): the zones are
// wider inside the window, a pointer arriving fast or pushing against the edge needs less dwell, and a push that carries the
// pointer out across the left or top edge (onto a neighbouring monitor) still reveals when it stops just past the edge.
const EDGE = { top: 8, side: 10 };          // the zone inside the window along each edge, in DIPs (Zen keeps an 8px sliver)
const DWELL = { top: 90, side: 90 };        // resting in the zone this long shows the edge
const DWELL_PUSH = { top: 40, side: 40 };   // pressing against the edge (within 1px) or arriving fast means it
const PUSH = 1;
const APPROACH = 0.6;              // px/ms toward the edge on the way in: intent, so the shorter dwell applies
const SWEEP = 24;                  // px along the edge since the dwell began: a pass (scrolling, heading elsewhere), not a rest; the dwell restarts
const EXIT = { top: 100, side: 160 };       // a push out across the edge: how far past it the pointer may stop and still reveal
const EXIT_DWELL = 50;             // ... how long it must stay there (going on to the other monitor never reveals)
const EXIT_WINDOW = 700;           // ... and within how long of crossing
const EXIT_FROM = 120;             // the crossing counts when the last sample inside was this close to that edge
// R5 (founder, again: "I can't open the sidebar in Seamless", maximized, a second monitor on the left): a real flick to the edge
// overshoots far onto the neighbour, sees nothing, and comes straight back. Coming back in this close to the edge it left by,
// this soon after leaving, is the same intent as stopping at a wall: it reveals at once.
const BOUNCE = { top: 96, side: 96 };
const BOUNCE_WINDOW = 1200;
const GRACE = { top: 300, side: 200 };      // after leaving the revealed chrome (+ LEEWAY), before it hides
const KEY_GRACE = 400;             // after a keyboard reveal (Ctrl+L, a pin) lets go
const MIN_VISIBLE = 400;           // no show-then-vanish
const LOCKOUT = 250;               // no re-reveal right after a hide (a jittery pointer cannot make a flicker loop)
const LEEWAY = 8;                  // around the revealed chrome that still counts as on it
const OUTSIDE = 200;               // the pointer may wander this far outside the window it left (Zen: 200 sideways), ...
const OUTSIDE_CAP = 2500;          // ... for at most this long
// R8 (founder: "I come to the side to repeat the video and the sidebar opens, the YouTube controls get cooked"): the edge is also
// where pages put things to use (a seek bar, a slider, a link, text to select). When the page says the pointer is over one of
// them (`engaged`), a rest in the zone is not yet a request for the sidebar: it takes this long, or less when the pointer is
// pressed against the very edge (nothing a page draws is there, so that is the person asking). Over empty page it stays 90/40.
// Why 650: a click on a control that was just reached lands 150 to 450 ms after arriving, and a reveal covers the page
// (the pointer leaves it, a press goes to the sidebar), so the dwell has to outlast the click, not race it.
const ENGAGED_DWELL = { top: 650, side: 650 };
const ENGAGED_PUSH = { top: 260, side: 260 };

// Animation speed (Settings > Appearance): the waits between the pointer and the bar are about intent, not motion, but "Fast" and "None" ask for a bar
// that does not make you wait (reported 6 Nov: Briski's "it takes 1 second to appear": the 650ms engaged wait below was most of it, whatever the speed).
// PREMIUM is the numbers above, untouched (the same objects). FAST serves Fast and None (Off / Reduce motion): the motion differs, the waits do not.
// Floors, from simulating the controller against passing pointers (tests/edge-reveal.test.cjs "Fast waits"): 60/30ms is the shortest rest/arrival pair that
// keeps every crossing of the zone, every slide along it faster than 0.4px/ms and every touch of 30ms or less a pass (30ms is also two samples of the 16ms
// poller); below it touches of 20 to 30ms and slides up to 0.5px/ms reveal. The engaged waits (a control under the pointer) keep most of R8's reason, a click
// on a control just reached lands 150 to 450ms after arriving: 400 / 180ms give the click most of that window; Premium keeps 650 / 260.
const PREMIUM = { dwell: DWELL, push: DWELL_PUSH, engaged: ENGAGED_DWELL, engagedPush: ENGAGED_PUSH, grace: GRACE, keyGrace: KEY_GRACE, minVisible: MIN_VISIBLE, lockout: LOCKOUT };
const FAST = { dwell: { top: 60, side: 60 }, push: { top: 30, side: 30 }, engaged: { top: 400, side: 400 }, engagedPush: { top: 180, side: 180 }, grace: { top: 180, side: 120 }, keyGrace: 250, minVisible: 250, lockout: 150 };
/** The waits for each speed the interface reports (`input.speed`: 'premium' | 'fast' | 'off'); anything else is Premium. */
const WAITS = { premium: PREMIUM, fast: FAST, off: FAST };
const waitsFor = speed => (typeof speed === 'string' && Object.hasOwn(WAITS, speed) ? WAITS[speed] : PREMIUM);

const ZONES = ['top', 'side'];
const TRACE = !!process.env.ACIRA_EDGE_TRACE;   // timestamps of every change, on stdout, for the QA rig
const fresh = () => ({ phase: 'hidden', since: 0, shownAt: 0, leaveAt: 0, lockUntil: 0, blocked: false, outsideAt: 0, pinned: false, held: false, keyed: false, returnWait: false, via: '' });

/** Which edges this window may reveal at all. Seamless: its two switches (the side one only with tabs in the sidebar). Other
 * views: never the top (the toolbar is there); the side is the closed sidebar's, when there is one, it is not open for good,
 * and that view's "Show the closed sidebar at the left edge" switch is on (R5: Full off, Compact and Focus on by default;
 * `peek` is {full, compact, focus} from main, and a view it does not name shows, as before).
 * `topAuto` (Settings > Appearance > Layout > Hide the toolbar: tabs in a sidebar, the toolbar hides like Seamless's in Full, Compact or Focus): the top
 * edge is always there (the toolbar has no other way back) and so is a closed sidebar's (its button is in the hidden toolbar), whatever those switches say. */
function enabledEdges(input) {
  const seamless = input.view === 'seamless', edges = input.edges || { top: true, side: true }, peek = input.peek || {}, auto = !!input.topAuto && !seamless;
  return {
    top: !!((seamless && edges.top) || auto),
    side: !!(input.vertical && (seamless ? edges.side : !input.docked && (auto || peek[input.view] !== false))),
  };
}

const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const distanceOutside = (point, b) => {
  const dx = Math.max(b.x - point.x, 0, point.x - (b.x + b.width - 1)), dy = Math.max(b.y - point.y, 0, point.y - (b.y + b.height - 1));
  return Math.hypot(dx, dy);
};

/** One controller per window. `sample()` is called every tick with what main can see and returns which edges are shown.
 * Input: point (global cursor, DIPs, or null), bounds (the window's content bounds, DIPs), focused, suspended (minimized, HTML
 * fullscreen, setup), view ('seamless' or another), vertical (tabs in the sidebar), docked (the sidebar is open for good),
 * edges {top, side} (the Seamless switches), topAuto (the toolbar is hidden outside Seamless, enabledEdges), peek {full, compact, focus} (the closed sidebar's switch per view), keys {top, side} (a key press asked for the edge: Ctrl+L, F10, a new tab), holds {top, side}
 * (what keeps a showing edge open: a popup, a drag, focus in the chrome), sidebarSide ('left' or 'right': the edge the sidebar comes from;
 * the right one is the left one seen in a mirror, so the pointer is mirrored across the window before any rule looks at it), size {topHeight, sideWidth} (how big the revealed chrome
 * is, DIPs), pressed (a button held in any frame, an in-page drag, a native menu or dialog: nothing reveals), engaged (the page
 * reports something to use under the pointer: a longer rest is needed, see ENGAGED_DWELL), band (DIPs of screen above the window that the system keeps for itself
 * while it is fullscreen: the menu bar's band on a notched display, 0 elsewhere), speed ('premium', 'fast' or 'off': which waits apply, see WAITS),
 * cornerOnly (Windows' caption corner watch, caption-notch.cjs: only the `caption` corner shows the top).
 * Pins (Ctrl+Shift+E) are set with pin(). */
function createEdgeController({ now = Date.now } = {}) {
  const zones = { top: fresh(), side: fresh() };
  let lastBounds = null, prev = null, lastInside = null, exit = null, crossed = null, lastSide = null, T = PREMIUM;

  const geometryChanged = () => { for (const zone of ZONES) { const z = zones[zone]; if (z.phase === 'dwelling') { z.phase = 'hidden'; z.since = 0; } z.blocked = true; } exit = null; crossed = null; };

  function sample(input) {
    T = waitsFor(input.speed);
    const t = now(), b = input.bounds, rawPoint = input.point, side = input.sidebarSide === 'right' ? 'right' : 'left';
    // The sidebar on the right is the left sidebar in a mirror: across the window's width, so its edge zone, its approach, its push out
    // across the edge and its keep-open rectangle are the left ones, rule for rule. The caption corner (Windows) stays where it is.
    const point = side === 'right' && rawPoint && b ? { x: 2 * b.x + b.width - 1 - rawPoint.x, y: rawPoint.y } : rawPoint;
    // The window moved or resized (grabbing its border must not pop the sidebar): block both zones until the pointer leaves them.
    if (lastBounds && b && !same(lastBounds, b)) geometryChanged();
    if (side !== lastSide) { if (lastSide) { prev = null; lastInside = null; geometryChanged(); } lastSide = side; }
    lastBounds = b ? { ...b } : null;
    // Pointer velocity (px/ms) from the previous sample: arriving fast at an edge is intent; sliding along it is a pass.
    const dt = prev && point ? t - prev.t : 0;
    const v = dt > 0 && dt <= 100 ? { x: (point.x - prev.x) / dt, y: (point.y - prev.y) / dt } : { x: 0, y: 0 };
    prev = point ? { x: point.x, y: point.y, t } : null;
    const holds = input.holds || { top: false, side: false }, size = input.size || { topHeight: 0, sideWidth: 0 };
    const enabled = enabledEdges(input);
    const why = { top: '', side: '' };
    const inside = !!(point && b && point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height);
    const rel = inside ? { x: point.x - b.x, y: point.y - b.y } : null;
    // The zones belong to the window in use: an unfocused window never starts a reveal.
    const live = input.focused !== false;
    // Windows: the caption buttons' corner (top right, hidden with the toolbar) shows the top at once, so the buttons are back
    // under the pointer before it can click where they are.
    const caption = input.caption && rawPoint && inside ? rawPoint.x - b.x >= b.width - input.caption.width && rel.y < input.caption.height : false;
    // macOS fullscreen on a notched display: the window sits below the camera housing and the menu bar comes down in the band above it, so
    // the pointer that goes to "the top" ends in that band, outside the window. It is at the top edge of the screen, which is what the zone
    // stands for: it counts as pressing against the window's top edge, and keeps the bar open while it stays there.
    const inBand = !!(point && b && input.band > 0 && point.x >= b.x && point.x < b.x + b.width && point.y < b.y && point.y >= b.y - input.band);
    // `cornerOnly` (Windows, caption-notch.cjs createCaptionCorner): the top is the caption buttons alone and only their corner shows them; no edge strip, push-out or bounce.
    const cornerOnly = !!input.cornerOnly;
    const trigger = {
      top: !!(live && (rel && ((!cornerOnly && rel.y <= EDGE.top) || caption) || (!cornerOnly && inBand))),
      // (The caption buttons' corner belongs to the top: with the sidebar on the right it shares its upper end with the side zone.)
      side: !!(live && rel && rel.x <= EDGE.side && rel.y > EDGE.top && rel.y < b.height - EDGE.top && !caption),
    };
    // A push out across the left or top edge (the two monitors: the window's edge is not the screen's, so the pointer
    // slips past it): remember where it crossed; if it stops close past that edge, that is a reveal, not a trip to the neighbour.
    // Back in, close to the edge it left by, soon after leaving: the overshoot came back (BOUNCE).
    const bounced = { top: false, side: false };
    if (inside && crossed) {
      if (live && t - crossed.at <= BOUNCE_WINDOW) {
        if (crossed.zone === 'side') bounced.side = rel.x <= BOUNCE.side && rel.y > EDGE.top && rel.y < b.height - EDGE.top;
        else bounced.top = !cornerOnly && rel.y <= BOUNCE.top;
      }
      crossed = null;
    }
    if (inside) { lastInside = { rel, t }; exit = null; }
    else if (point && b && live && !exit && lastInside && t - lastInside.t <= 100) {
      const crossedSide = point.x < b.x && lastInside.rel.x <= EXIT_FROM && point.y >= b.y + EDGE.top && point.y < b.y + b.height - EDGE.top;
      const crossedTop = point.y < b.y && lastInside.rel.y <= EXIT_FROM && point.x >= b.x && point.x < b.x + b.width;
      exit = crossedTop ? { zone: 'top', at: t, still: 0 } : crossedSide ? { zone: 'side', at: t, still: 0 } : { zone: '', at: t, still: 0 };
      crossed = exit.zone ? { zone: exit.zone, at: t } : null;
    }
    if (exit?.zone && point && b && !inside) {
      const past = exit.zone === 'side' ? b.x - point.x : b.y - point.y;
      const across = exit.zone === 'side' ? point.y >= b.y && point.y < b.y + b.height : point.x >= b.x && point.x < b.x + b.width;
      if (past > EXIT[exit.zone] || !across || t - exit.at > EXIT_WINDOW) exit.zone = '';
      else if (Math.hypot(v.x, v.y) < 0.25) { if (!exit.still) exit.still = t; } else exit.still = 0;
    }
    const exited = { top: bounced.top || (!cornerOnly && exit?.zone === 'top' && !!exit.still && t - exit.still >= EXIT_DWELL), side: bounced.side || (exit?.zone === 'side' && !!exit.still && t - exit.still >= EXIT_DWELL) };
    const toward = { top: -v.y, side: -v.x }, along = { top: point ? point.x : 0, side: point ? point.y : 0 };
    const pushing = { top: !!(rel && rel.y <= PUSH) || inBand, side: !!(rel && rel.x <= PUSH) };
    const onChrome = {
      top: inBand || !!(inside && rel.y <= size.topHeight + LEEWAY),
      // Full/Compact/Focus keep one connected frame: crossing into its toolbar is not leaving for the page (with the toolbar hidden there is no such frame: Seamless's rule).
      side: !!(inside && (rel.x <= size.sideWidth + LEEWAY || input.view !== 'seamless' && !input.topAuto && rel.y <= size.topHeight + LEEWAY)),
    };

    for (const zone of ZONES) {
      const z = zones[zone];
      const suspended = !!input.suspended || !enabled[zone];
      if (suspended) { if (z.phase !== 'hidden') why[zone] = input.suspended ? 'suspended' : 'disabled'; Object.assign(z, fresh(), { lockUntil: z.lockUntil, blocked: trigger[zone] }); continue; }
      if (z.blocked && !trigger[zone]) z.blocked = false;
      // A key press (Ctrl+L, F10, a new tab) or a pin asks for the edge and shows it; a menu, a drag or focus in the chrome only
      // keeps what is already showing (a right-click in the page must never pop the toolbar).
      const asked = !!(input.keys && input.keys[zone]) || z.pinned, held = asked || !!holds[zone];
      // Outside the window: the pointer may roam OUTSIDE px for OUTSIDE_CAP ms after it left; both limits end the tolerance.
      let near = false;
      if (point && b && !inside) {
        if (!z.outsideAt) z.outsideAt = t;
        near = distanceOutside(point, b) <= OUTSIDE && t - z.outsideAt <= OUTSIDE_CAP;
      } else if (inside) z.outsideAt = 0;
      const keeps = onChrome[zone] || near;

      if (z.phase === 'hidden' || z.phase === 'dwelling') {
        // Something holds the edge open that the pointer did not ask for (Ctrl+L, a page prompt, a pin): it shows, and when the
        // hold ends it leaves with the keyboard's longer grace.
        if (asked) { z.phase = 'shown'; z.shownAt = t; z.leaveAt = 0; z.held = true; z.keyed = true; z.via = 'key'; why[zone] = z.pinned ? 'pinned' : 'key'; continue; }
        // A held button (a seek bar, a slider, text being selected, a drawing, a drag; in any frame), an in-page drag or a native
        // menu or dialog is not a rest at the edge: nothing comes up under it, and nothing after it either until the pointer has
        // left the edge and come back (reported 30 Oct; R8: this also holds for the overshoot-and-return reveals above and below).
        if (input.pressed) { z.phase = 'hidden'; z.since = 0; z.blocked = z.blocked || !!trigger[zone]; why[zone] = 'pressed'; continue; }
        if (exited[zone] && !z.blocked && t >= z.lockUntil) { z.phase = 'shown'; z.shownAt = t; z.leaveAt = 0; z.held = false; z.keyed = false; z.via = 'exit'; z.outsideAt = t; why[zone] = 'exit'; exit = null; continue; }
        if (!trigger[zone] || z.blocked) { z.phase = 'hidden'; z.since = 0; continue; }
        // (The caption buttons' own corner in `cornerOnly`: the hidden buttons are under the pointer, so they come back at once, lock-out or not.)
        if (t < z.lockUntil && !(cornerOnly && caption)) { z.phase = 'hidden'; z.since = 0; continue; }
        if (z.phase === 'hidden') { z.phase = 'dwelling'; z.since = t; z.fast = toward[zone] >= APPROACH; z.anchor = along[zone]; }
        // Sliding along the edge (a pass on the way somewhere, a scroll with the pointer parked near the edge) is not a rest: the
        // dwell counts only while the pointer stays within SWEEP px along the edge (sampling-rate independent).
        else if (Math.abs(along[zone] - z.anchor) > SWEEP && !caption) { z.since = t; z.fast = false; z.anchor = along[zone]; }
        const engaged = !!input.engaged && !caption;
        const need = zone === 'top' && caption ? 0 : engaged ? (pushing[zone] ? T.engagedPush[zone] : T.engaged[zone]) : pushing[zone] || z.fast ? T.push[zone] : T.dwell[zone];
        if (t - z.since >= need) { z.phase = 'shown'; z.shownAt = t; z.leaveAt = 0; z.held = false; z.keyed = false; z.via = caption && zone === 'top' ? 'caption' : 'pointer'; why[zone] = z.via; }
        continue;
      }

      // shown or leaving
      // Window deactivation (main's blur, not the interface's) hides at once, unless something holds the edge open.
      if (!input.focused && !held) { Object.assign(z, fresh(), { lockUntil: t + T.lockout, blocked: trigger[zone] }); why[zone] = 'blur'; continue; }
      const wasHeld = z.held; z.held = held;
      if (held) { z.phase = 'shown'; z.leaveAt = 0; z.returnWait = false; why[zone] = z.pinned ? 'pinned' : 'hold'; continue; }
      // A hold just ended with the pointer outside the window (a menu closed): wait until it is back, then grace.
      if (wasHeld && !inside) z.returnWait = true;
      if (z.returnWait) { if (inside) z.returnWait = false; else { z.phase = 'shown'; z.leaveAt = 0; why[zone] = 'return'; continue; } }
      if (keeps) { z.phase = 'shown'; z.leaveAt = 0; if (onChrome[zone]) z.keyed = false; why[zone] = near && !onChrome[zone] ? 'outside' : 'pointer'; continue; }
      // Not on the chrome, nothing holds it: the grace runs. A timer that is running is never restarted by jitter.
      if (z.phase === 'shown') { z.phase = 'leaving'; z.leaveAt = t; }
      if (t - z.leaveAt >= (z.keyed ? T.keyGrace : T.grace[zone]) && t - z.shownAt >= T.minVisible) {
        Object.assign(z, fresh(), { lockUntil: t + T.lockout, blocked: trigger[zone] }); why[zone] = 'left';
      } else why[zone] = 'grace';
    }
    return { top: zones.top.phase === 'shown' || zones.top.phase === 'leaving', side: zones.side.phase === 'shown' || zones.side.phase === 'leaving', why };
  }

  /** Pin an edge open (Ctrl+Shift+E in Seamless) or let it go; letting go starts the normal grace. */
  function pin(zone, on) { if (!zones[zone]) return; zones[zone].pinned = !!on; }
  /** Esc, or a click in the page: hide the edge now. It stays hidden until the pointer has left its zone and the lockout is over. */
  function dismiss(zone) { const z = zones[zone]; if (!z) return; Object.assign(z, fresh(), { lockUntil: now() + T.lockout, blocked: true }); }
  const pinned = zone => !!zones[zone]?.pinned;
  const phase = zone => zones[zone].phase;
  /** Is anything shown or about to be (the poller keeps its fast cadence while so). */
  const active = () => ZONES.some(zone => zones[zone].phase !== 'hidden' || zones[zone].pinned);
  return { sample, geometryChanged, pin, dismiss, pinned, phase, active, constants: { EDGE, DWELL, DWELL_PUSH, APPROACH, SWEEP, EXIT, EXIT_DWELL, EXIT_WINDOW, GRACE, MIN_VISIBLE, LOCKOUT, LEEWAY, OUTSIDE, OUTSIDE_CAP } };
}

/** Windows' caption corner watch (13.7): with a caption hidden over the page, the next look comes before a pointer moving CORNER_REACH DIPs per ms (a fast flick) could reach
 * its corner: 16 ms near it, the idle 250 ms from 2500 DIPs away. One cursor read per look. */
const CORNER_REACH = 10;
const cornerLook = distance => Math.max(16, Math.min(250, Math.round(distance / CORNER_REACH)));

/** The poller: one timer for the whole app, however many windows. 16ms while an Acira window that can use the edges is
 * focused (or an edge is showing); a slow look-around otherwise, so an idle browser does no per-frame work.
 * `windows()` returns [{ window, state, emit(event), size(), holds(), suspended(), controller }] for every window. Optional: `pointerEvents()` (the window's own
 * pointer source, { point() } in content coordinates, when the system's answer cannot be trusted: Wayland, pointer-point.cjs; null otherwise) and `cursorRead(point)`
 * (every screen answer, so a constant (0, 0) is learned). */
function watchChromeEdges({ app, windows, screen, view, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = null, stopped = false;
  const seen = new Map();
  const entryOf = item => { let entry = seen.get(item); if (!entry) { entry = { edge: createEdgeController({ now }), last: { top: false, side: false, pinned: { top: false, side: false } }, listening: false }; seen.set(item, entry); } return entry; };
  const step = () => {
    timer = null;
    let fast = false, soon = 250;
    for (const item of windows()) {
      const win = item.window;
      if (!win || win.isDestroyed?.()) { seen.delete(item); continue; }
      const entry = entryOf(item);
      // Windows: main's caption fallback (caption-watch.cjs) looks at the pointer on this tick whoever holds the keyboard; it can never break the poller.
      try { item.captionTick?.(); } catch {}
      if (!entry.listening) { entry.listening = true; const change = () => entry.edge.geometryChanged(); for (const name of ['resize', 'move']) win.on?.(name, change); }
      // A fullscreen window is the only thing its display shows: another app holding the keyboard (the other monitor, Spotlight, a notification) must not stop
      // its edges, or the sidebar "would not reveal" until a click gave the window the keyboard back. `live()` is main's word for that (the window's Space is showing).
      const state = item.state, effective = view(state), focused = !!win.isFocused?.() || !!item.live?.(), peek = item.peek?.() || null;
      // Windows, Sidebar mode: the caption buttons' notch shows while the pointer is along the top (caption-notch.cjs; its own controller, the same rules as Seamless's top edge).
      // Nothing is sent to the interface: `item.notchShown(shown)` is main's caption overlay going visible or transparent.
      const notchInput = item.notch?.() || null;
      if (notchInput || entry.notchShown) {
        const notch = entry.notchWatch ??= require('./caption-notch.cjs').createCaptionNotch({ now });
        const shown = notch.sample({
          point: focused || notch.active() ? screen.getCursorScreenPoint() : null, bounds: win.getContentBounds(), focused,
          suspended: !!item.suspended?.() || !!win.isMinimized?.() || !!win.isFullScreen?.(), active: !!notchInput?.active, hidden: !!notchInput?.hidden,
          speed: item.speed?.() || 'premium', pressed: !!item.pressed?.(),
        });
        // Compared with what main's caption actually is, not with what this poller told it last: main resets its own state when the layout leaves the mode (a docked right sidebar,
        // full screen, a view switch), and a poller that remembers "shown" would never say so again, leaving the notch hidden under a pointer resting at the top.
        const current = item.notchIsShown ? !!item.notchIsShown() : !!entry.notchShown;
        if (shown !== current) item.notchShown?.(shown);
        entry.notchShown = shown;
        if ((notchInput?.active && focused) || notch.active()) fast = true;
      }
      // Windows, 13.7: the corner watch (caption-notch.cjs createCaptionCorner). A caption hidden over the page (Seamless, Hide the toolbar, the notch) shows its buttons the
      // moment the pointer is in their corner, whether or not this window has the keyboard. Told to main after the toolbar's own news below (`reportCorner`), so the overlay
      // is painted once, over the toolbar when one is coming or in its box when none is. While the corner is hidden and nothing else keeps the fast cadence, the poller looks
      // sooner the closer the pointer is to it, so the corner is seen within a tick of the pointer reaching it even in a window that is not in front.
      const cornerInput = item.corner?.() || null;
      let reportCorner = () => {};
      if (cornerInput || entry.cornerShown) {
        const watch = entry.cornerWatch ??= require('./caption-notch.cjs').createCaptionCorner({ now });
        const watching = !!cornerInput?.active, point = watching || watch.active() ? screen.getCursorScreenPoint() : null, box = win.getContentBounds();
        const shown = watch.sample({
          point, bounds: box, suspended: !!item.suspended?.() || !!win.isMinimized?.() || !!win.isFullScreen?.(), active: watching, hidden: !!cornerInput?.hidden,
          height: cornerInput?.height, speed: item.speed?.() || 'premium', pressed: !!item.pressed?.(),
        });
        if (watch.active()) fast = true;
        else if (watching && cornerInput.hidden) soon = Math.min(soon, cornerLook(require('./caption-notch.cjs').cornerDistance(point, box, cornerInput.height)));
        reportCorner = () => { const current = item.cornerIsShown ? !!item.cornerIsShown() : !!entry.cornerShown; if (shown !== current) item.cornerShown?.(shown); entry.cornerShown = shown; };
      }
      const input = { view: effective, vertical: !!state?.settings?.verticalTabs, sidebarSide: state?.settings?.sidebarSide === 'right' ? 'right' : 'left', docked: !!item.docked?.(), edges: item.edges?.() || { top: true, side: true }, peek, topAuto: !!item.topAuto?.(), speed: item.speed?.() || 'premium' };
      const enabled = enabledEdges(input);
      // ACIRA_EDGE_TRACE: what the controller is told (view, layout, the switches) and what that allows, whenever it changes.
      if (TRACE) { const line = JSON.stringify({ ...input, enabled }); if (line !== entry.input) { entry.input = line; console.log('[edge-input]', Date.now(), line); } }
      // Nothing to watch in a view whose edges are all off (Full with a closed sidebar, by default): no per-frame work.
      const wants = focused && (enabled.top || enabled.side);
      if (!wants && !entry.edge.active() && !entry.last.top && !entry.last.side && !entry.last.pinned.top && !entry.last.pinned.side) { reportCorner(); continue; }
      fast = true;
      if (TRACE) { const line = JSON.stringify({ pressed: !!item.pressed?.(), engaged: !!item.engaged?.(), ...item.why?.() }); if (line !== entry.intent) { entry.intent = line; console.log('[edge-intent]', Date.now(), line); } }
      // Wayland (pointer-point.cjs): the system never says where the pointer is (Electron answers {0,0}), so the window's own pointer events do. They are in the
      // window's content coordinates, so the box is the content's size at the origin: only the width and height of getContentBounds() are used, never its x and y (on Wayland
      // those are a made-up constant, and an event's globalX / globalY are its x and y plus that same made-up origin). Everywhere else: as it always was.
      const content = win.getContentBounds(), events = item.pointerEvents?.() || null;
      const bounds = events ? { x: 0, y: 0, width: content.width, height: content.height } : content;
      const looking = focused || entry.edge.active();
      const point = !looking ? null : events ? events.point() : screen.getCursorScreenPoint();
      if (looking && !events) item.cursorRead?.(point);
      if (TRACE) { const line = JSON.stringify({ mode: events ? 'events' : 'screen', point, bounds }); if (line !== entry.pointerLine && Date.now() - (entry.pointerAt || 0) >= 250) { entry.pointerLine = line; entry.pointerAt = Date.now(); console.log('[edge-point]', Date.now(), line); } }
      const result = entry.edge.sample({
        point,
        bounds,
        band: !events && win.isFullScreen?.() ? Math.max(0, bounds.y - (screen.getDisplayMatching?.(bounds)?.bounds.y ?? bounds.y)) : 0,
        focused,
        suspended: !!item.suspended?.() || !!win.isMinimized?.(),
        ...input,
        keys: item.keys?.() || { top: false, side: false },
        holds: item.holds?.() || { top: false, side: false },
        size: item.size?.() || { topHeight: 0, sideWidth: 0 },
        caption: item.caption?.() || null,
        pressed: !!item.pressed?.(),
        engaged: !!item.engaged?.(),
      });
      const pinned = { top: entry.edge.pinned('top'), side: entry.edge.pinned('side') };
      if (TRACE && (result.top !== entry.last.top || result.side !== entry.last.side)) console.log('[edge]', Date.now(), JSON.stringify({ top: result.top, side: result.side, why: result.why, focused, view: effective }));
      // A page that covers the whole window leaves the interface with nothing to paint, and Chromium stops giving it frames (about
      // 3 a second): the first reveal would wait half a second for one. While the pointer dwells on an edge, the page gives up
      // one pixel, which wakes the interface; the reveal's own layout (or the pointer leaving) puts it back.
      const dwelling = ZONES.some(zone => entry.edge.phase(zone) === 'dwelling');
      if (dwelling && !entry.waking) { entry.waking = true; item.wake?.(true); }
      // The page gives its pixel back when nothing is dwelling AND nothing is showing: it stayed one short at the bottom when the dwell ended in a
      // reveal that left the page's bounds as they were (the reveal's own layout then has nothing to change), now that a fullscreen Seamless page covers the whole window.
      else if (entry.waking && !dwelling && !entry.edge.active()) { entry.waking = false; item.wake?.(false); }
      if (result.top !== entry.last.top || result.side !== entry.last.side || pinned.top !== entry.last.pinned.top || pinned.side !== entry.last.pinned.side) {
        entry.last = { top: result.top, side: result.side, pinned };
        item.emit({ type: 'chrome-edge', top: result.top, side: result.side, pinned });
      }
      reportCorner();
    }
    if (!stopped) timer = schedule(tick, fast ? 16 : soon);
    timer?.unref?.();
  };
  // One window's trouble (a getter that throws mid-close, a bad cursor read) must never stop the poller for every window: it would end every edge reveal and the Windows
  // caption's fallback with it, with no sign. The next look comes 250 ms later; the first line of each distinct trouble is written down.
  let lastTrouble = '';
  const tick = () => {
    try { step(); } catch (error) {
      const text = String(error?.message || error).slice(0, 200);
      if (text !== lastTrouble) { lastTrouble = text; try { console.warn('The edge poller skipped a look:', text); } catch {} }
      if (!stopped && !timer) { timer = schedule(tick, 250); timer?.unref?.(); }
    }
  };
  app.whenReady().then(() => { if (!stopped && !timer) { timer = schedule(tick, 250); timer?.unref?.(); } });
  app.on('will-quit', () => { stopped = true; if (timer) cancel(timer); });
  return { tick, pin: (item, zone, on) => { entryOf(item).edge.pin(zone, on); }, dismiss: (item, zone) => { entryOf(item).edge.dismiss(zone); }, pinned: (item, zone) => !!seen.get(item)?.edge.pinned(zone), entryFor: item => seen.get(item) };
}

module.exports = { createEdgeController, watchChromeEdges, cornerLook, CORNER_REACH, WAITS, waitsFor, EDGE, DWELL, DWELL_PUSH, APPROACH, SWEEP, EXIT, EXIT_DWELL, EXIT_WINDOW, EXIT_FROM, BOUNCE, BOUNCE_WINDOW, GRACE, KEY_GRACE, MIN_VISIBLE, LOCKOUT, LEEWAY, OUTSIDE, OUTSIDE_CAP, ENGAGED_DWELL, ENGAGED_PUSH };
