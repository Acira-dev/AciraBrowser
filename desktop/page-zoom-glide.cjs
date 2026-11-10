'use strict';
// Plus, minus and Reset used to change a website's zoom in one frame: the page's real zoom is a re-layout, so the picture cut from the old
// size to the new one, while a trackpad pinch (Chromium's own page scale, drawn by the compositor) plays over many frames. This glides the
// step the way a pinch does and then lands the real zoom:
//
//   zoom in  (100% -> 110%)  the page grows from its top-left corner (a page scale, the old layout enlarged), then the real zoom lands
//   zoom out (110% -> 100%)  the real zoom lands first, shown enlarged to the old size, and the page shrinks to fit
//
// Chromium's page scale never goes below 1, so zoom out is run backwards; either way the page always fills its card (no blank strip at
// the right or bottom). The page scale is Emulation.setPageScaleFactor through a short-lived debugger attach (the way tab sleep already
// attaches one), set on a timer by a critically damped spring: the same curve as the interface's own springs (page-motion.cjs springAt),
// so a page the interface draws (ui/pageZoomGlide.ts) and a website glide alike. No input events are sent: the page sees a visual-viewport
// scale for about 200 ms, as it does under a pinch, and one resize when the real zoom lands, as it did before.
//
// The zoom LEVEL is never touched by the glide: the saved level, the chip and the bubble change on the press (main.cjs browserCommand);
// only the picture catches up. Anything the glide cannot do (no motion, a hidden page, a debugger already attached by DevTools or an
// extension, a command that fails, a jump of more than 1.6x) lands at once, which is exactly the old cut.
//
// 13.5: no glide while the page's main frame is navigating, from the start of the navigation until it commits (watch()). A renderer crashed once (exit 11) 80 ms into a zoom out glide, with a
// dozen page scale commands in flight, while the page's second navigation (a JS challenge redirect) was committing; no dump was kept. Page scale commands racing a document swap are the only
// thing the glide does that a plain zoom step does not, so a step asked for during a navigation is applied at once (the caller's cut), and a navigation that starts under a running glide
// lands it at once (the final zoom now, the scale back to 1, the session let go). Glides outside navigations are untouched.
const pageDebugger = require('./page-debugger.cjs');
const MAX_RATIO = 1.6, TICK_MS = 5, SETTLE_SCALE = .001, SETTLE_SPEED = .06, DEADLINE_FACTOR = 3, DEADLINE_MIN_MS = 700;
const EPS = 1e-6;

/** What to do when the page, laid out at `state.layout` and shown enlarged by `state.scale` (>= 1), is asked for `target` (all fractions
 * of 100%). `cut`: no glide, apply the target now. `none`: already there. `glide`: lay the page out at `layout` now (a landing, when it
 * is not the layout it has), start from `scale`, and move to `goal`; the glide ends when the scale reaches 1 (zoom out, `layout` is the
 * target) or when it reaches `goal` (zoom in: the target is then laid out). */
function planGlide(state, target, cap = MAX_RATIO) {
  const { layout, scale } = state;
  if (![layout, scale, target].every(Number.isFinite) || layout <= 0 || target <= 0 || scale < 1 - EPS) return { kind: 'cut' };
  const visual = layout * scale;
  if (Math.abs(target - layout) < EPS && Math.abs(scale - 1) < EPS) return { kind: 'none' };
  if (target >= layout - EPS) {
    const goal = target / layout;
    if (goal <= cap + EPS) return { kind: 'glide', layout, scale, goal, lands: false };
    // Further from the layout it was laid out at than a page scale should go: land where it is now and glide the rest.
    const rest = target / visual;
    if (visual - layout > EPS && rest >= 1 - EPS && rest <= cap + EPS) return { kind: 'glide', layout: visual, scale: 1, goal: rest, lands: true };
    return { kind: 'cut' };
  }
  const enlarged = visual / target;
  if (enlarged >= 1 - EPS && enlarged <= cap + EPS) return { kind: 'glide', layout: target, scale: enlarged, goal: 1, lands: true };
  return { kind: 'cut' };
}

/** A critically damped spring (the interface's bounce-0 spring, perceptual duration `duration` seconds) from `from` at speed `speed`
 * towards `goal`, `t` seconds on. Exact, so any frame length gives the same curve. */
function springStep(from, speed, goal, duration, t) {
  const omega = Math.PI * 2 / Math.max(.05, duration), a = from - goal, b = speed + omega * a, e = Math.exp(-omega * t);
  return { x: goal + (a + b * t) * e, v: (b - omega * (a + b * t)) * e };
}

/** The glide's perceptual duration in seconds: the page-zoom token (160 ms, a frequent surface) at the interface's speed: 205 ms at
 * Premium, 95 ms at Fast, null when motion is off. src/ui/motionTokens.ts holds the same number (tests/page-zoom-glide.test.ts). */
const BASE_SECONDS = .16;
function glideSeconds(speed) {
  if (speed === 'fast') return Math.round(BASE_SECONDS * .6 * 200) / 200;
  if (speed === 'premium') return Math.round(BASE_SECONDS * (1 + (1.7 - 1) * .4) * 200) / 200;
  return null;
}
/** How hard a glide starts: the interface's `kick` (a share of the spring's natural speed), so the first painted frame already moves. */
const kickFor = speed => speed === 'fast' ? .15 : speed === 'premium' ? .4 : 0;

function createZoomGlide({ now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms), cancelLater = timer => clearTimeout(timer), cap = MAX_RATIO } = {}) {
  const active = new Map();
  const moving = new WeakSet(), watched = new WeakSet();

  const targetOf = wc => active.get(wc)?.target ?? null;
  const isGliding = wc => active.has(wc);
  /** The page's main frame is between the start of a navigation to another document and its commit (or its end without one). */
  const isNavigating = wc => Boolean(wc) && moving.has(wc);

  function detach(g) {
    const done = () => { try { g.lease.release(); } catch { /* already gone */ } };
    try { g.lease.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).then(done, done); } catch { done(); }
  }
  /** The glide is over: the page is laid out at its target at scale 1 and the debugger is let go. */
  function land(g, apply = true) {
    if (g.over) return;
    g.over = true; cancelLater(g.timer); active.delete(g.wc);
    try { if (apply && !g.wc.isDestroyed() && Math.abs(g.layout - g.target) > EPS) g.wc.setZoomFactor(g.target); } catch { /* the page closed */ }
    g.layout = g.target;
    detach(g);
  }
  function send(g, scale) {
    if (g.busy) return;
    g.busy = true;
    try { g.lease.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: Math.max(1, scale) }).then(() => { g.busy = false; }, () => { g.busy = false; land(g); }); } catch { g.busy = false; land(g); }
  }
  function tick(g) {
    if (g.over || g.waiting) return;
    if (g.wc.isDestroyed()) { g.over = true; active.delete(g.wc); return; }
    const t = now(), sec = Math.max(0, (t - g.at) / 1000), s = springStep(g.from, g.speed, g.goal, g.seconds, sec);
    g.x = Math.max(1, s.x); g.v = s.v;
    if (!g.visible() || t > g.deadline || Math.abs(g.x - g.goal) < SETTLE_SCALE && Math.abs(g.v) < SETTLE_SPEED) return land(g);
    if (!(Math.abs(g.x - g.sent) <= .0004)) { g.sent = g.x; send(g, g.x); } // (also true while nothing has been sent: sent is NaN)
    g.timer = later(() => tick(g), TICK_MS);
  }
  /** Begin (or restart) a piece of the glide from the page's current scale: `plan` is a 'glide' plan. */
  function run(g, plan, kick) {
    // The spring keeps the speed it had when the page stays laid out as it was; a landing starts the new piece from rest.
    const carry = g.started && plan.layout === g.layout ? g.v : 0, landing = plan.layout !== g.layout;
    if (landing) { try { g.wc.setZoomFactor(plan.layout); } catch { return land(g); } g.layout = plan.layout; }
    g.from = plan.scale; g.goal = plan.goal; g.x = plan.scale; g.at = now();
    g.speed = kick ? kick * (Math.PI * 2 / Math.max(.05, g.seconds)) * (plan.goal - plan.scale) : carry;
    g.deadline = g.at + Math.max(DEADLINE_MIN_MS, g.seconds * 1000 * DEADLINE_FACTOR);
    g.started = true; g.sent = NaN;
    cancelLater(g.timer);
    if (!landing) return tick(g);
    // A page that has just been laid out at a new zoom (a zoom out, or a landing mid-burst) shows nothing new until it has finished laying out,
    // which can take 100 ms or more on a heavy page: the page answers this scale only after that layout, so the spring starts from the answer
    // and the shrink is played, not spent waiting.
    g.waiting = true; g.deadline = g.at + 2000; g.timer = later(() => { if (g.waiting) land(g); }, 2000);
    const answered = () => {
      if (g.over || !g.waiting) return;
      g.waiting = false; cancelLater(g.timer); g.at = now(); g.sent = g.x; g.deadline = g.at + Math.max(DEADLINE_MIN_MS, g.seconds * 1000 * DEADLINE_FACTOR); tick(g);
    };
    try { g.lease.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: Math.max(1, g.x) }).then(answered, () => land(g)); } catch { land(g); }
  }

  /** The zoom of `wc` is asked to become `target` (a fraction). Returns true when the glide has it (the caller sets nothing), false when
   * the caller must apply the zoom itself, at once. `seconds` is glideSeconds() (null: no motion), `speed` 'fast' or 'premium'. */
  function request({ wc, target, seconds, speed, visible = () => true }) {
    if (!wc || wc.isDestroyed()) return false;
    let g = active.get(wc);
    // The main frame is navigating: no glide (the caller applies the zoom itself). A glide cannot be running here, a navigation lands it as it starts; if one is, it is over.
    if (isNavigating(wc)) { if (g) land(g, false); return false; }
    const usable = seconds > 0 && visible();
    if (g) {
      g.target = target; g.seconds = usable ? seconds : g.seconds;
      if (!usable) { land(g); return true; }
      if (!g.started) return true; // still clearing a pinch: it starts on the latest target
      const plan = planGlide({ layout: g.layout, scale: g.x }, target, cap);
      if (plan.kind === 'cut') { land(g); return true; }
      if (plan.kind === 'none') { land(g); return true; }
      run(g, plan, 0);
      return true;
    }
    if (!usable) return false;
    const layout = wc.getZoomFactor(), first = planGlide({ layout, scale: 1 }, target, cap);
    if (first.kind !== 'glide') return false;
    // The page's debugger is shared (page-debugger.cjs): a tab that is told a colour scheme keeps it attached, and the glide rides on that session. Null: somebody else's debugger is attached.
    const lease = pageDebugger.acquire(wc, 'zoom-glide');
    if (!lease) return false;
    g = { wc, lease, target, layout, seconds, visible, x: 1, from: 1, goal: 1, v: 0, speed: 0, at: now(), sent: NaN, busy: false, started: false, over: false, timer: null, deadline: Infinity };
    active.set(wc, g);
    wc.once?.('destroyed', () => { g.over = true; active.delete(wc); });
    // The instant path first clears any pinch magnification the person left (visual zoom limits 1..1, then 1..5 again). The glide does too, but
    // only when the page is magnified: the toggle costs a page-wide layout (45 ms on a heavy page) and the glide must not wait for it when there
    // is nothing to clear. It starts once that is answered, so the first scale is not clamped away.
    // The magnification is cleared with the page scale command through this lease, never by toggling the visual zoom limits: that pushes the page's web preferences again, which drops the
    // Always dark override (page-debugger.cjs / site-appearance.cjs) and the page turned light for good.
    const magnified = () => { try { return Promise.resolve(g.lease.sendCommand('Page.getLayoutMetrics')).then(m => { const scale = m?.cssVisualViewport?.scale ?? m?.visualViewport?.scale; return !(Number.isFinite(scale) && scale < 1 + 1e-3); }, () => true); } catch { return Promise.resolve(true); } };
    magnified().then(pinched => pinched ? Promise.resolve(g.lease.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })) : null).catch(() => {}).then(() => {
      if (g.over) return;
      const plan = planGlide({ layout: g.layout, scale: 1 }, g.target, cap);
      if (plan.kind !== 'glide') return land(g);
      run(g, plan, kickFor(speed));
    });
    return true;
  }
  /** Stop a glide without applying its target (the page is navigating, or the caller is about to set the zoom itself). */
  function abort(wc) {
    const g = active.get(wc); if (!g) return false;
    g.over = true; cancelLater(g.timer); active.delete(wc); detach(g); return true;
  }
  /** Follow the page's main-frame navigations (once per page; call it when the page is made, before it can navigate). */
  function watch(wc) {
    if (!wc || watched.has(wc) || typeof wc.on !== 'function') return false;
    watched.add(wc);
    const over = () => { moving.delete(wc); };
    // Electron hands the details as the event's own fields; the old positional form (url, isInPlace, isMainFrame) is still passed alongside.
    wc.on('did-start-navigation', (event, _url, inPlace, mainFrame) => {
      if (!(event?.isMainFrame ?? mainFrame) || (event?.isSameDocument ?? inPlace)) return;
      moving.add(wc);
      const g = active.get(wc);
      if (g) land(g);
    });
    wc.on('did-navigate', over); // the main frame committed
    wc.on('did-stop-loading', over); // it ended without one: Stop, a download, a 204, a cancelled load
    // An aborted main-frame load (-3) is usually the predecessor that a newer navigation cancelled, so it must not end the newer one; that one ends by its own commit, failure or stop.
    wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => { if (isMainFrame && code !== -3) over(); });
    wc.on('render-process-gone', over);
    wc.once?.('destroyed', over);
    return true;
  }
  return { request, abort, targetOf, isGliding, isNavigating, watch };
}

/** The visual zoom limits (1..5) that let a trackpad pinch magnify a website, applied once per page, when it is made. Applying them again later pushes the page's web preferences
 * to its renderer, and that drops the Always dark override of a page that holds a debugger session (a link preview that becomes a tab already holds one): so a page made by anything
 * other than the tab path (the link preview) gets them at creation, and the tab path finds them there. */
const limited = new WeakSet();
function ensureLimits(wc) {
  if (!wc || limited.has(wc)) return false;
  limited.add(wc);
  try { Promise.resolve(wc.setVisualZoomLevelLimits(1, 5)).catch(() => {}); } catch { /* the page is gone */ }
  return true;
}

/** Clears a pinch magnification the person left on a website before its zoom is set the instant way. A page that holds a debugger session (Always dark; Light / Dark that differ from
 * Acira's appearance; the glide) is cleared with the page scale command through that session: the old way, toggling the visual zoom limits, pushes the web preferences again and drops its
 * Auto Dark Mode override (the page turned light until it was reloaded). A page without a session keeps the old way (nothing to lose). `afterToggle` runs once the old way has been used
 * on a page that holds a session by then (the command failed, or the session came up while the toggle ran), so the caller can tell the appearance again. Resolves when done, never rejects. */
function clearMagnification(wc, { afterToggle = null } = {}) {
  // The old way. A session may have come up while it ran (the page's appearance attaches at dom-ready): then its override is told again once the toggle is over.
  const told = () => { try { if (pageDebugger.held(wc) > 0) afterToggle?.(); } catch { /* the caller's */ } };
  const toggle = () => Promise.resolve().then(() => wc.setVisualZoomLevelLimits(1, 1)).then(() => { if (!wc.isDestroyed()) return wc.setVisualZoomLevelLimits(1, 5); }).then(told, error => { told(); throw error; });
  if (!wc || wc.isDestroyed()) return Promise.resolve(false);
  const lease = pageDebugger.held(wc) > 0 ? pageDebugger.acquire(wc, 'zoom-clear') : null;
  if (!lease) return toggle().then(() => true, () => false);
  return Promise.resolve().then(() => lease.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })).then(() => true, () => toggle().then(() => true, () => false)).finally(() => { try { lease.release(); } catch { /* gone */ } });
}

module.exports = { MAX_RATIO, planGlide, springStep, glideSeconds, kickFor, createZoomGlide, BASE_SECONDS, ensureLimits, clearMagnification };
