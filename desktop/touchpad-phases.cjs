'use strict';
// The two-finger swipe on Windows and Linux: begin / changed / ended rebuilt from what Electron lets JavaScript see.
//
// macOS tells the swipe when the fingers land, move and lift (NSEvent phases, read by a native monitor). Electron 45 shows JavaScript no phase, no
// momentum and no "precise" flag for a touchpad scroll on the other two systems, and Chromium's own history swipe is switched off in Electron
// (CanOverscrollContent() is false). What is visible:
//   - the page's DOM `wheel` events: the deltas, small and frequent for a touchpad (page preload, in DIP);
//   - the types of the input events Chromium reports for the page (`input-event` in main): `gestureFlingStart` is the fingers lifting on Linux (X11
//     scroll with zero offsets, Wayland axis_stop; the fling controller filters it, but observers are still told), `gestureScrollEnd` is the end of
//     a scroll: on Windows (Direct Manipulation) the lift without inertia, and after the inertia the end of the coast.
// This module turns those into the same samples the Mac monitor makes, for the same tracker (createSwipeTracker in swipe-nav.cjs). It is made to
// be safe by construction: it acts only on a sequence it fully recognises and does NOTHING otherwise, so the worst case is "no swipe", never a
// wrong navigation, a double step or a broken scroll (it never touches the page's own scrolling at all):
//   1. A swipe is recognised only from a smooth touchpad-like stream: PROBE_EVENTS plain wheel events close together, none notch-sized, one
//      direction, not all the same size. A mouse wheel, a tilt wheel (about 100 px a click), a slow wheel, Shift/Ctrl/Alt/Meta + wheel and a
//      touchscreen pan (no wheel events at all) never start one.
//   2. It commits only on a lift it can see: a lift marker, or (Windows only, whose inertia has no marker until the coast ends) a coast that
//      is clearly the fingers' deceleration once the swipe is worth completing.
//   3. With the arrow showing and no lift seen after a quiet gap it CANCELS. The hold-for-list only waits when this machine has shown that it
//      sends lift markers.
//   4. One step: after a commit or a cancel everything is ignored until the wheel has been quiet for a moment (the coast), so there is no step from
//      inertia and no double step.
// Pure: time is injected, nothing here touches Electron.

/** A smooth stream: this many plain wheel events, each at most GAP_MS after the one before, within SPAN_MS of the first. */
const PROBE_EVENTS = 4, GAP_MS = 40, SPAN_MS = 160;
/** A single wheel event this large (DIP) is a notch of a mouse wheel or a tilt wheel (about 100 px), not a touchpad; identical events this large too. */
const NOTCH = 40, SAME_SIZE = 20;
/** Quiet this long with no event and no lift seen: the swipe is cancelled, or (armed, lift markers known) the fingers are resting for the list. */
const QUIET_MS = 250;
/** After a lift or a cancel the stream (inertia) is ignored until this quiet. */
const COAST_QUIET_MS = 150;
/** A lift marker waits this long for the last wheel events (a different process sends them) to land first. */
const LIFT_DELAY_MS = 30;
/** The list may stay open this long without a lift being seen; then it is let go (never committed). */
const HOLD_CAP_MS = 8000;
/** A `gestureScrollEnd` this soon after a wheel event of a recognised swipe counts as the machine's lift marker. */
const LEARN_MS = 400;
/** Windows coast: this many wheel events in a row that only shrink, the last at most this fraction of the strongest. */
const COAST_EVENTS = 5, COAST_RATIO = .6, COAST_MIN_PEAK = 8;

const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * `opts`: now(), after(fn, ms), clear(timer) (time), emit(sample) (a tracker sample: {phase, momentum, dx, dy, x, y, natural, velocity?}),
 * snapshot() (the tracker's {armed, progress}, to know whether a swipe is worth completing), alive() (is the tracker still following this swipe),
 * coastDetect (Windows only). Wheel events: wheel({t, dx, dy, x, y, mods, mode}) with the DOM deltas in DIP (positive dx = scroll right), `t` the
 * event's time in ms, `mods` true when Shift/Ctrl/Alt/Meta is down, `mode` the deltaMode. Markers: marker(type) with an `input-event` type.
 */
function createTouchpadPhases(opts = {}) {
  const now = opts.now || Date.now, after = opts.after || ((fn, ms) => setTimeout(fn, ms)), clear = opts.clear || (timer => clearTimeout(timer));
  const emit = sample => { try { opts.emit?.(sample); } catch { /* a sample that fails never breaks the stream */ } };
  const snapshot = () => { try { return opts.snapshot?.() || {}; } catch { return {}; } };
  const alive = () => { try { return opts.alive ? Boolean(opts.alive()) : true; } catch { return false; } };

  let state = 'idle';           // idle | probing | active | coast | refused
  let probe = [], history = [], lastAt = null, lastX = 0, lastY = 0, peak = 0;
  let quiet = null, lift = null, cap = null, learned = false, holding = false;

  const timers = () => { clear(quiet); clear(lift); clear(cap); quiet = lift = cap = null; };
  const toState = next => { state = next; if (next !== 'active') { timers(); holding = false; } if (next === 'idle' || next === 'coast' || next === 'refused') { probe = []; history = []; peak = 0; } };

  // Content direction: positive dx = the content moves right = the swipe toward Back. The DOM's deltaX is the opposite (positive = scroll right).
  // In a right-to-left interface Back and Forward swap (Chromium: gesture_nav_simple.cc), so the sideways sign flips; the speed (a fling's velocity) flips with it.
  let flip = 1;
  const sampleOf = (phase, w, extra) => ({phase, momentum: 'none', dx: -(w?.dx || 0) * flip, dy: -(w?.dy || 0), x: w?.x ?? lastX, y: w?.y ?? lastY, natural: false, ...extra});
  const dominant = w => w.dx !== 0 && Math.abs(w.dx) > Math.abs(w.dy);
  const smooth = events => {
    if (events.some(e => Math.abs(e.dx) >= NOTCH)) return false;                      // a notch of a wheel
    if (events.some(e => Math.sign(e.dx) !== Math.sign(events[0].dx))) return false;   // not one direction
    const sizes = events.map(e => Math.abs(e.dx));
    if (sizes.every(size => size === sizes[0]) && sizes[0] >= SAME_SIZE) return false; // identical big steps: a wheel
    return true;
  };
  /** The signed speed of the content's sideways movement (DIP per second) over some events, the fling's velocity. */
  const velocityOf = events => {
    if (events.length < 2) return 0;
    const span = events[events.length - 1].t - events[0].t;
    if (!(span > 0)) return 0;
    return events.slice(1).reduce((sum, e) => sum - e.dx, 0) / span * 1000;
  };
  let liftSpeed = null;      // a coast's lift was found after the fact: the speed is the fingers' own, from before the coast began
  const speedAlong = () => (liftSpeed !== null ? liftSpeed : velocityOf(history.slice(-4)));

  function armQuiet() {
    clear(quiet);
    quiet = after(() => {
      quiet = null;
      if (state !== 'active' || lift) return;
      const snap = snapshot();
      if (snap.armed && learned && !holding) {
        // The fingers rest on the pad past the threshold (the list opens after the hold); only a lift marker may complete it. It never waits for ever.
        holding = true;
        cap = after(() => { cap = null; if (state === 'active') cancelNow(); }, HOLD_CAP_MS);
        return;
      }
      if (!holding) cancelNow();
    }, QUIET_MS);
  }
  function cancelNow() {
    if (state !== 'active') return;
    emit(sampleOf('cancelled'));
    toState('coast');
  }
  function liftNow() {
    lift = null;
    if (state !== 'active') return;
    emit(sampleOf('ended', null, {velocity: speedAlong() * flip}));
    liftSpeed = null;
    toState('coast');
  }
  function scheduleLift() {
    if (state !== 'active' || lift) return;
    clear(quiet); quiet = null;
    lift = after(liftNow, LIFT_DELAY_MS);
  }
  function startActive(events) {
    flip = (() => { try { return opts.rtl?.() ? -1 : 1; } catch { return 1; } })();
    toState('active');
    history = []; peak = 0; liftSpeed = null;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      history.push(e); peak = Math.max(peak, Math.abs(e.dx));
      emit(sampleOf(i === 0 ? 'began' : 'changed', e));
      if (!alive()) { toState('coast'); return; }
    }
    armQuiet();
  }
  /** Windows: a coast with no marker. Only when the swipe is worth completing (armed, or fast enough), five events in a row that only shrink. */
  function coastLooksLikeLift() {
    if (!opts.coastDetect || history.length < COAST_EVENTS) return false;
    const recent = history.slice(-COAST_EVENTS);
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].t - recent[i - 1].t > GAP_MS) return false;
      if (Math.abs(recent[i].dx) > Math.abs(recent[i - 1].dx)) return false;
    }
    if (!(peak >= COAST_MIN_PEAK) || Math.abs(recent[recent.length - 1].dx) > peak * COAST_RATIO) return false;
    // The fingers' own speed is what the events had before the coast began (the first of the shrinking run and the three before it), not the decayed speed now.
    const before = history.slice(-(COAST_EVENTS + 3), -(COAST_EVENTS - 1));
    const speed = velocityOf(before.length >= 2 ? before : history.slice(-4)), snap = snapshot();
    const worth = Boolean(snap.armed) || (Number(snap.progress) > 0 && Number(opts.flingVelocity) > 0 && speed >= opts.flingVelocity);
    if (worth) liftSpeed = speed;
    return worth;
  }

  function wheel(w) {
    const at = now();
    const gap = lastAt === null ? Infinity : at - lastAt;
    lastAt = at;
    const dx = num(w?.dx), dy = num(w?.dy), t = num(w?.t);
    if (dx === null || dy === null || t === null) { if (state === 'active') cancelNow(); else toState('refused'); return; }
    lastX = num(w.x) ?? lastX; lastY = num(w.y) ?? lastY;
    if (w.mods || w.mode) {                                    // Shift / Ctrl / Alt / Meta + wheel, or a line/page wheel: never a swipe
      if (state === 'active') cancelNow(); else if (state !== 'coast') toState('refused');
      return;
    }
    if (state === 'coast' || state === 'refused') { if (gap < COAST_QUIET_MS) return; toState('idle'); }
    if (dx === 0 && dy === 0) return;
    const e = {t, dx, dy, x: lastX, y: lastY};

    if (state === 'idle') {
      if (!dominant(e)) return;
      probe = [e]; state = 'probing';
      return;
    }
    if (state === 'probing') {
      const prev = probe[probe.length - 1];
      if (!dominant(e) || e.t - prev.t > GAP_MS || e.t - probe[0].t > SPAN_MS || e.t < prev.t) {
        probe = []; state = 'idle';
        if (dominant(e)) { probe = [e]; state = 'probing'; }
        return;
      }
      probe.push(e);
      if (probe.length < PROBE_EVENTS) return;
      if (smooth(probe)) startActive(probe); else toState('refused');
      return;
    }
    if (state === 'active') {
      history.push(e); if (history.length > 12) history.shift();
      peak = Math.max(peak, Math.abs(e.dx));
      holding = false; clear(cap); cap = null;
      emit(sampleOf('changed', e));                              // also while a lift is pending: the last events of the fingers' phase (another process sends them) still count
      if (!alive()) { toState('coast'); return; }
      if (lift) return;
      if (coastLooksLikeLift()) { scheduleLift(); return; }
      armQuiet();
    }
  }

  function marker(type) {
    const at = now();
    if (type === 'gestureFlingStart') {
      learned = true;                                           // only a touchpad makes one: this machine sends lift markers
      if (state === 'active') scheduleLift();
      else if (state === 'probing') { probe = []; state = 'idle'; }
      return;
    }
    if (type === 'gestureFlingCancel') { if (state === 'coast' || state === 'refused') toState('idle'); return; }   // fingers down: the coast is over
    if (type === 'gestureScrollEnd') {
      if (state === 'active') { if (lastAt !== null && at - lastAt <= LEARN_MS) learned = true; scheduleLift(); }
      else if (state === 'probing') { probe = []; state = 'idle'; }
    }
  }
  /** Something else took the screen (a menu, another tab, the window closing). */
  function abort() { if (state === 'active') cancelNow(); else toState('idle'); }

  return {
    wheel, marker, abort,
    get state() { return state; },
    get learned() { return learned; },
  };
}

module.exports = {createTouchpadPhases, PROBE_EVENTS, GAP_MS, SPAN_MS, NOTCH, SAME_SIZE, QUIET_MS, COAST_QUIET_MS, LIFT_DELAY_MS, HOLD_CAP_MS, LEARN_MS, COAST_EVENTS, COAST_RATIO, COAST_MIN_PEAK};
