'use strict';
// Beta 14: the aura's whole motion as one pure function of time. Nothing here knows about Electron or the page: `createTimeline` is given a clock reading
// with every call and answers where the glow is (`p`, 0 = drawn back into the profile button, 1 = fully out) and how much of the ring is closed (`r`). The aura's
// page (aura-page.cjs) contains THIS function's own source and runs it every frame; main runs the same function to know when the aura is over; the tests and the
// prototype rig call it with a made-up clock. So the three can never disagree, and a frame can be asked for at any time (stepped, without waiting for the real one).
//
// The numbers are the brief's starting numbers (E5), to be judged in the prototype: out 0.4 s, still 2.4 s (toolbar visible) or until the toolbar is revealed
// (Seamless; it fades after 10 s if never), back in 0.3 s, and 0.2 s for an early ending. The curve is one of the app's own, cubic-bezier(.4, 0, .2, 1) (the
// even S-curve it uses for things that come and go): an ease-out like the menus' (.16, 1, .3, 1) puts 80 % of the glow out in the first 0.1 s and, played
// backwards, holds it fully out and then snaps it away in the last 0.1 s, which is what a draw-back must not look like. Both are one parameter (`curve`);
// the prototype videos show both and the README recommends one.
//
// "It never cuts" and "the exit is the entrance in reverse" are built into the shape: an ending of any kind (after the hold, the pointer near, the toolbar
// revealed, a pop-up, the window moving) draws back along the SAME curve the glow came out on, retraced from wherever it is, at the speed of a full ending
// (0.3 s) or a quick one (0.2 s). The ring closes as it draws back: `r` goes from 0 to 1 over the draw-back (so the last frame of the glow is a complete ring, the
// frame the resting ring beneath it must match) and is 0 for the whole of the way out and the hold.
//
// This function is stringified into the page: it must stay self-contained (no requires, no outer names).
function createTimeline(options) {
  const config = Object.assign({ outMs: 400, holdMs: 2400, restMs: 10000, backMs: 300, quickMs: 200, minBackMs: 120, curve: [0.4, 0, 0.2, 1] }, options || {});
  const [x1, y1, x2, y2] = config.curve;
  const axis = (a, b, t) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  /** The curve: eased progress for a linear progress `u` in [0, 1]. */
  const ease = (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0, hi = 1, t = u;
    for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (axis(x1, x2, t) < u) lo = t; else hi = t; }
    return axis(y1, y2, t);
  };
  /** The linear progress that the curve maps to `p` (the way back). */
  const unease = (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const u = (lo + hi) / 2; if (ease(u) < p) lo = u; else hi = u; }
    return (lo + hi) / 2;
  };
  const clamp = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
  // phase: 'idle' | 'out' | 'hold' | 'back' | 'done'
  const s = { phase: 'idle', t0: 0, rest: false, tb: 0, u0: 1, p0: 1, backMs: 0, reason: null, ring: true };
  /** Moves the machine to `now`: crosses every boundary the time has passed (at the boundary's own time, so a late call changes nothing). */
  const settle = (now) => {
    if (s.phase === 'out' && now >= s.t0 + config.outMs) s.phase = 'hold';
    if (s.phase === 'hold') {
      const limit = s.t0 + config.outMs + (s.rest ? config.restMs : config.holdMs);
      // Seamless's ten seconds with the toolbar never shown: the button is not there, so there is no ring to close into; the glow just draws back.
      if (now >= limit) { if (s.rest) s.ring = false; beginBack(limit, s.rest ? 'rest' : 'hold', false); }
    }
    if (s.phase === 'back' && now >= s.tb + s.backMs) s.phase = 'done';
  };
  const beginBack = (at, reason, quick) => {
    const p = peek(at);
    s.phase = 'back'; s.tb = at; s.reason = reason; s.p0 = p; s.u0 = unease(p);
    s.backMs = Math.max(config.minBackMs, (quick ? config.quickMs : config.backMs) * s.u0);
  };
  const peek = (now) => {
    if (s.phase === 'idle') return 0;
    if (s.phase === 'out') return ease(clamp((now - s.t0) / config.outMs));
    if (s.phase === 'hold') return 1;
    if (s.phase === 'back') return ease(s.u0 * (1 - clamp((now - s.tb) / s.backMs)));
    return 0;
  };
  return {
    config, ease, unease,
    /** The glow starts flowing out at `now`. `rest`: Seamless (it waits for the toolbar, up to restMs, instead of holding holdMs); `ring`: false for the Early Member mark (no ring is left behind). */
    start(now, { rest = false, ring = true } = {}) { s.phase = 'out'; s.t0 = now; s.rest = !!rest; s.ring = ring !== false; s.reason = null; },
    /** An ending: the glow draws back (only the reasons 'hold' and 'rest' are the unhurried 0.3 s; every other is the quick 0.2 s). `options.ring: false` leaves no ring (an ending too early to count). No-op once drawing back. */
    end(now, reason, options) {
      settle(now);
      if (s.phase === 'out' || s.phase === 'hold') { if (options && options.ring === false) s.ring = false; beginBack(now, reason || 'end', reason !== 'hold' && reason !== 'rest'); }
    },
    /** Where everything is at `now`: {phase, p, r, done, reason}. `ring` is false when this aura leaves no ring (Early Member). */
    sample(now) {
      settle(now);
      const p = peek(now);
      let r = 0;
      if (s.phase === 'back') r = s.p0 > 0 ? clamp((s.p0 - p) / s.p0) : 1;
      else if (s.phase === 'done') r = 1;
      return { phase: s.phase, p, r: s.ring ? r : 0, ring: s.ring, done: s.phase === 'done', reason: s.reason };
    },
    /** When the machine next changes on its own (a timer for main), or null (idle, done, or drawing back: that one's end is `endsAt`). */
    nextBoundary() {
      if (s.phase === 'out') return s.t0 + config.outMs;
      if (s.phase === 'hold') return s.t0 + config.outMs + (s.rest ? config.restMs : config.holdMs);
      if (s.phase === 'back') return s.tb + s.backMs;
      return null;
    },
    get phase() { return s.phase; },
  };
}

module.exports = { createTimeline };
