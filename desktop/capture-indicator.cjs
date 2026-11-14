'use strict';
// Camera, microphone and screen-sharing indicator of one page (the address-bar pill with its Stop, the tab's recording dot), 13.8.
// A port of Chromium's MediaStreamCaptureIndicator::WebContentsDeviceUsage (chrome/browser/media/webrtc/media_stream_capture_indicator.cc):
//  - each capture request a page makes (one getUserMedia or getDisplayMedia call) counts for the kinds of device it opened, from the moment
//    its stream starts until every one of its devices has stopped (UIDelegate::OnStarted -> AddDevices, ~UIDelegate -> RemoveDevices);
//  - a device stops when the page has no live track left on it: track.stop() on the last one (clones included), the track ending
//    (device lost, Stop), or the document going away (navigation, frame removed, crash), as MediaStreamManager::StopDevice / DeleteRequest
//    (content/browser/renderer_host/media/media_stream_manager.cc) do;
//  - the indicator shows a kind while its count is above zero, and changes the moment a count crosses zero;
//  - Stop is StopMediaCapturing(kUserMedia | kDisplayMedia): every capture of the page ends, and the page's tracks fire 'ended'.
// Electron gives the browser side no MediaStreamUI and no event when a device stops, so the counting happens in the page itself:
// desktop/browser-services/capture-tracker-preload.cjs runs before any page script in every frame and reports the kinds of its live
// requests (and how many capture calls are still in flight) whenever they change. Main (here) combines the frames of a page.
// What the browser side does know is the grant (the permission engine said yes to a camera, microphone or screen): it shows the kind at
// once and is held until the page's tracker has answered for that call. A grant no tracker accounts for (the call failed, or the stream
// was made where no tracker runs) is settled by the older check from outside the page (capture-state.cjs liveCapture: a DevTools walk of
// the page's heap, slow on big pages), and kinds only that check can see stay under its watch. 13.7 used that check alone, every 3 s: on a
// page with a large heap (WhatsApp Web) each walk took longer than its 2 s limit, every answer was dropped, and the pill stayed until reload.
const KINDS = ['camera', 'microphone', 'screen'];
const PENDING_MS = 15000; // a granted call the tracker has seen start may take this long to settle (a camera can take seconds to open)
const UNSEEN_MS = 1000;   // a grant no tracker saw being asked for is checked from outside after this
const POLL_MS = 3000;     // kinds only the outside check can see are checked again this long after the last check ended
const CHECK_MS = 15000;   // one outside check may take this long (a 760 MB heap took 3.9 s on an M5; 13.7 gave up at 2 s and never cleared)
const MISSES = 3;         // outside checks that could not run in a row before a kind no tracker shows is let go
const STOP_WAIT_MS = 1500; // after Stop, how long the trackers have to report before the outside check ends what is left

const kindsOf = list => KINDS.filter(kind => Array.isArray(list) && list.includes(kind));

/**
 * One page's device usage.
 *   check({stop, timeoutMs}) -> Promise<kinds[] | null>: the outside check (null: could not run).
 *   sendStop(): tells every frame's tracker to stop its captures (they then report).
 *   alive(key) -> bool: whether the frame that reported under `key` is still there.
 */
function createCaptureIndicator({check, sendStop = () => {}, alive = () => true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  const frames = new Map();      // frame key -> {kinds: string[], pending: number}
  const granted = new Set();     // kinds the browser granted to this document
  const waiting = new Map();     // kind -> {since, sawPending, due}: granted, not yet answered for by a tracker
  const unseen = new Set();      // kinds only the outside check sees
  const listeners = new Set();
  let shown = [], timer = null, checking = null, misses = 0, lastCheckEnd = 0, generation = 0, disposed = false;

  const prune = () => { for (const key of [...frames.keys()]) { let here = true; try { here = alive(key) !== false; } catch { here = false; } if (!here) frames.delete(key); } };
  const pendingNow = () => { let sum = 0; for (const frame of frames.values()) sum += frame.pending; return sum; };
  const tracked = () => { const kinds = new Set(); for (const frame of frames.values()) for (const kind of frame.kinds) if (granted.has(kind)) kinds.add(kind); return kinds; };
  function compute() { const live = tracked(); return KINDS.filter(kind => live.has(kind) || waiting.has(kind) || unseen.has(kind)); }
  function update() {
    if (disposed) return;
    const next = compute();
    if (next.join() === shown.join()) return;
    shown = next;
    for (const listener of [...listeners]) try { listener(next); } catch { /* one watcher must not stop the others */ }
  }

  /** The trackers answered: a granted call they saw start has settled (resolved or failed) once nothing is in flight. */
  function settle() {
    prune();
    const pending = pendingNow(), live = tracked();
    for (const [kind, item] of waiting) {
      if (live.has(kind)) { waiting.delete(kind); continue; } // the tracker shows it: it owns it now
      if (pending > 0) { item.sawPending = true; continue; }
      if (item.sawPending) item.due = 0; // settled with nothing live of this kind: failed, or made where no tracker runs
    }
    for (const kind of live) unseen.delete(kind);
  }

  function schedule() {
    if (disposed) return;
    clearTimer(timer); timer = null;
    if (checking) return;
    let at = Infinity;
    for (const item of waiting.values()) at = Math.min(at, item.due !== undefined ? item.due : item.since + (item.sawPending ? PENDING_MS : UNSEEN_MS));
    if (unseen.size) at = Math.min(at, lastCheckEnd + POLL_MS);
    if (shown.length && frames.size) at = Math.min(at, now() + POLL_MS); // a frame that went without a word (its process ended) is let go
    if (at === Infinity) return;
    timer = setTimer(tick, Math.max(0, at - now()));
    timer?.unref?.();
  }

  function tick() {
    timer = null;
    if (disposed) return;
    prune(); settle();
    const t = now();
    let due = unseen.size > 0 && t >= lastCheckEnd + POLL_MS;
    for (const item of waiting.values()) if ((item.due !== undefined ? item.due : item.since + (item.sawPending ? PENDING_MS : UNSEEN_MS)) <= t) { item.due = 0; due = true; }
    update();
    if (due) void runCheck(); else schedule();
  }

  async function runCheck() {
    if (checking) return checking;
    const mine = generation;
    checking = (async () => { try { const live = await check({stop: false, timeoutMs: CHECK_MS}); return live === null || live === undefined ? null : kindsOf(live); } catch { return null; } })();
    const live = await checking;
    checking = null; lastCheckEnd = now();
    if (disposed) return live;
    if (mine !== generation) { schedule(); return live; } // the document changed meanwhile: its answer is old; what the new one needs is planned now
    if (live === null) {
      // The page could not be looked at (another debugger holds it, or it did not answer in time): try again a few times, then trust the
      // trackers, which said nothing of these kinds is live. 13.7 kept the pill forever here.
      if (++misses >= MISSES) { for (const [kind, item] of waiting) if (item.due === 0) waiting.delete(kind); unseen.clear(); misses = 0; }
      else for (const item of waiting.values()) if (item.due === 0) item.due = now() + POLL_MS;
    } else {
      misses = 0;
      const liveTracked = tracked();
      for (const [kind, item] of waiting) if (item.due === 0) { waiting.delete(kind); if (live.includes(kind) && !liveTracked.has(kind)) unseen.add(kind); }
      for (const kind of [...unseen]) if (!live.includes(kind)) unseen.delete(kind);
    }
    update(); schedule();
    return live;
  }
  const pause = ms => new Promise(resolve => { const t = setTimer(resolve, ms); t?.unref?.(); });
  /** Waits (up to STOP_WAIT_MS) for the trackers to report that nothing is live. */
  async function trackersQuiet() { const until = now() + STOP_WAIT_MS; while (tracked().size && now() < until) await pause(50); prune(); return !tracked().size; }

  return {
    /** The permission engine granted these kinds (a getUserMedia or getDisplayMedia call is about to start its stream). */
    grant(kinds) {
      kinds = kindsOf(kinds); if (!kinds.length || disposed) return;
      prune();
      const pending = pendingNow() > 0;
      for (const kind of kinds) { granted.add(kind); waiting.set(kind, {since: now(), sawPending: pending}); }
      update(); schedule();
    },
    /** The browser let the page ask the person for these kinds in a picker it does not see the answer of (the macOS system share
     *  picker): nothing shows until the page's tracker reports a stream of that kind. */
    allow(kinds) { if (disposed) return; for (const kind of kindsOf(kinds)) granted.add(kind); update(); schedule(); },
    /** A frame's tracker reported: the kinds of its live capture requests and how many capture calls it has in flight. */
    report(key, value) {
      if (disposed || typeof key !== 'string' || !value || typeof value !== 'object') return;
      const pending = Number.isSafeInteger(value.pending) && value.pending > 0 ? Math.min(value.pending, 1000) : 0;
      frames.set(key, {kinds: kindsOf(value.kinds), pending});
      settle(); update(); schedule();
    },
    /** A frame's document went away (it navigated, was removed): its captures ended with it. */
    frameGone(key) { if (frames.delete(key)) { settle(); update(); schedule(); } },
    /** The page committed a new document, or its process ended: every capture of the old one ended (MediaStreamManager cancels them all). */
    reset() {
      generation++; frames.clear(); granted.clear(); waiting.clear(); unseen.clear(); misses = 0;
      clearTimer(timer); timer = null; update();
    },
    /** Stop: every frame stops its captures, the page is told ('ended'); what no tracker can account for is ended from outside.
     *  Resolves true when nothing is left, false when something could not be stopped. */
    async stop() {
      if (disposed) return true;
      const hadShown = shown.length > 0;
      waiting.clear(); update();
      try { sendStop(); } catch { /* a frame that is going away */ }
      const quiet = await trackersQuiet();
      if (disposed) return true;
      // Every tracker answered and nothing is left that only the outside check sees (or nothing was shown at all): done.
      if (quiet && !unseen.size && (frames.size || !hadShown)) { update(); schedule(); return true; }
      // Kinds no tracker shows, a tracker that did not answer, or a page with no tracker: end every capture track from outside, as 13.7's
      // Stop did (it fires 'ended' too, so a tracker that is there reports).
      while (checking) await checking;
      const mine = generation;
      let ended = null;
      try { ended = await check({stop: true, timeoutMs: CHECK_MS}); } catch { ended = null; }
      lastCheckEnd = now();
      if (disposed) return true;
      if (mine !== generation) { schedule(); return true; } // the document went away: so did its captures
      if (ended === null || ended === undefined) { schedule(); return false; }
      unseen.clear(); update();
      const done = await trackersQuiet();
      update(); schedule();
      return done;
    },
    /** Called with the kinds shown, now and on every change. Returns the unsubscribe. */
    watch(listener) { listeners.add(listener); try { listener(shown); } catch { /* the watcher's own problem */ } return () => listeners.delete(listener); },
    kinds: () => shown.slice(),
    dispose() { disposed = true; generation++; clearTimer(timer); timer = null; listeners.clear(); frames.clear(); waiting.clear(); unseen.clear(); },
    // For tests.
    _state: () => ({frames: [...frames].map(([key, value]) => [key, value.kinds.slice(), value.pending]), granted: [...granted], waiting: [...waiting.keys()], unseen: [...unseen], checking: !!checking}),
  };
}

/** One indicator per page web contents, made the first time anything asks; it goes with the page. */
const registry = new WeakMap();
function indicatorOf(wc, make) {
  if (!wc || wc.isDestroyed?.()) return null;
  let indicator = registry.get(wc);
  if (!indicator) {
    indicator = make();
    registry.set(wc, indicator);
    try { wc.once('destroyed', () => { indicator.dispose(); registry.delete(wc); }); } catch { /* a stand-in without events */ }
  }
  return indicator;
}
const existing = wc => (wc ? registry.get(wc) || null : null);

module.exports = {createCaptureIndicator, indicatorOf, existing, KINDS, PENDING_MS, UNSEEN_MS, POLL_MS, CHECK_MS, MISSES, STOP_WAIT_MS};
