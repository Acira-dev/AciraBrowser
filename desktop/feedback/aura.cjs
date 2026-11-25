'use strict';
// Beta 14: the aura, "a small one-time light instead of a pop-up" for the Early Member mark and for every new rank. It flows out of the profile button,
// stays close to it, and goes back into it, closing as a ring around the profile picture. It is a small transparent layer INSIDE the browser window, made
// the way the page dimming is (page-scrim.cjs): one WebContentsView added to the window's contentView above the pages, its own tiny page (aura-page.cjs),
// created when an aura is due and released when it is over. Not a separate window, not part of a web page.
//
// It never takes focus and needs no dismissal. A native layer cannot let a click through its own rectangle, so the rectangle is only as big as the glow
// (150 x 120 at 100 % interface scale), and the moment the pointer comes near it the glow draws back (`pointer`).
//
// It never cuts. Every ending is the same animated draw-back into the button along the curve it came out on (aura-timeline.cjs): after the hold, the pointer
// near, Seamless's toolbar revealed, a pop-up / menu / toast open, the window moving or resizing, losing focus, fullscreen, screen sharing. The only exceptions
// are the window going away (nothing left to animate) and motion set to Off, where there is no aura at all: the ring just fades in (`onRing`, then `done`).
//
// This module needs from the rest of the browser only what is injected (see createAura's parameters); the feedback service's `auraPending` / `auraDone` are
// passed in as `pending` and `done`, so "twice for the same mark" stays the service's own record.
const { createTimeline } = require('./aura-timeline.cjs');
const { canPlay, blockers, pointerNearRect } = require('./aura-conditions.cjs');
const { LOOK, pageUrl } = require('./aura-page.cjs');

// The handoff to the resting ring. The interface draws the resting ring when it hears the aura is done (an event, a rings request, a render); the layer's own ring (identical, opaque) stays over it until the
// interface says that ring is DRAWN (`ringUp`, then RING_PAINT_MS for the paint to reach the screen), never shorter than HANDOFF_MS, and never longer than RING_WAIT_MAX_MS if the interface does not say (its
// toolbar is gone, the window is busy): then it fades anyway. A fixed wait could not be right on a busy machine: the layer's ring faded over a picture with no ring yet, and the ring dipped for a frame.
const TICK_MS = 33, PROXIMITY = 36, HANDOFF_MS = 120, RING_PAINT_MS = 50, RING_WAIT_MAX_MS = 700, RING_FADE_MS = 100, RING_FADE_PLAIN_MS = 320, COUNTS_AT = 0.6, EDGE = 4;
/** The neutral colour of the Early Member mark, per appearance: a near-white halo on dark; on light a near-white halo cannot be seen, so a soft neutral grey carries it. */
const NEUTRAL = Object.freeze({ dark: [226, 230, 240], light: [96, 104, 122] });

/** "#rrggbb" -> [r, g, b], or null. */
function parseColor(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value || ''));
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : null;
}

/** Where the layer goes. `avatar`: the profile picture's rectangle in the window's content coordinates (DIPs); `scale`: the interface scale (1 = 100 %);
 * `toolbarBottom`: the toolbar's lower edge (null when the button is not in a toolbar: the sidebar's foot); `size`: the window's content size.
 * The glow hangs BELOW the button where the button is in the top half of the window (the toolbar), and rises ABOVE it where it is in the bottom half (the sidebar's
 * foot): "in the nearest corner of the page". Horizontally it is centred on the button and kept inside the window. */
function auraGeometry({ avatar, toolbarBottom = null, scale = 1, size, placement }) {
  const S = scale, W = LOOK.width * S, H = LOOK.height * S;
  const cx = avatar.x + avatar.width / 2, cy = avatar.y + avatar.height / 2;
  const ringOuter = avatar.width / 2 + (LOOK.ring.gap + LOOK.ring.stroke) * S;
  const above = placement ? placement === 'above' : toolbarBottom === null && cy > size.height / 2;
  const x = Math.max(EDGE, Math.min(size.width - W - EDGE, cx - W / 2));
  const y = above ? cy + ringOuter + S * 0.5 - H : cy - ringOuter - S * 0.5;
  const rect = { x: Math.round(x), y: Math.round(Math.max(0, y)), width: Math.round(W), height: Math.round(H) };
  const reach = above ? null : rect.y + rect.height - (toolbarBottom ?? cy + ringOuter);
  return { rect, ox: cx - rect.x, oy: cy - rect.y, above, ringRadius: avatar.width / 2 + LOOK.ring.gap * S + (LOOK.ring.stroke * S) / 2, stroke: LOOK.ring.stroke * S, gap: LOOK.ring.gap * S, avatar: avatar.width, reach, S };
}

function createAura({
  WebContentsView, getWindow, live, cursor, pending, done, onRing = () => {}, reducedMotion = () => false, restoreFocus = () => {},
  /** Whether the picture the aura closes on keeps a RESTING ring of its own (the interface draws it and says so: `ringUp`), which the layer's ring hands over to. Beta 14 (14 Nov) puts the rank ring on the new tab page's picture only, so the toolbar
   * and sidebar pictures stay plain: false (the default) = the layer's ring closes, rests a moment and fades away on its own, with nothing to wait for. True is the earlier design (the handoff below), kept for an owner who wants the ring back there. */
  restingRing = false,
  now = Date.now, setTick = setInterval, clearTick = clearInterval, setTimer = setTimeout, clearTimer = clearTimeout, frozen = false, timeline: timelineOptions,
}) {
  const isFrozen = () => (typeof frozen === 'function' ? Boolean(frozen()) : Boolean(frozen));
  let view = null, ready = null, run = null, tick = null, wait = null, ringTimers = [];
  const later = (fn, ms) => { const timer = setTimer(fn, ms); ringTimers.push(timer); return timer; };
  const alive = () => view && !view.webContents.isDestroyed();

  function ensure() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (!alive()) {
      view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: true, partition: 'acira-aura' } });
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const contents = view.webContents;
      // It never takes focus: a layer added to a window can be handed the keyboard by the engine; if it ever is, it goes straight back to where it was (the page or the interface).
      contents.on('focus', () => { try { restoreFocus(); } catch { /* nothing to give back */ } });
      ready = new Promise((resolve) => contents.once('did-finish-load', resolve));
      contents.loadURL(pageUrl()).catch(() => {});
    }
    // Always the last child before the popup host takes it back: above the pages and the toolbar, below the pop-ups (an open pop-up ends the aura anyway).
    if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
    return view;
  }
  const script = (code) => (alive() ? view.webContents.executeJavaScript(code, false).catch(() => null) : Promise.resolve(null));

  function release() {
    clearTimer(wait); wait = null;
    for (const timer of ringTimers) clearTimer(timer);
    ringTimers = [];
    if (tick) { clearTick(tick); tick = null; }
    run = null;
    if (alive()) { try { getWindow()?.contentView.removeChildView(view); } catch { /* the window is going away */ } view.webContents.close(); }
    view = null; ready = null;
  }

  /** Pointer position in the layer's coordinates (the window's content), from the injected screen cursor and the window's content origin. */
  function pointerInContent() {
    const win = getWindow(), point = cursor?.();
    if (!win || win.isDestroyed() || !point) return null;
    const box = win.getContentBounds();
    return { x: point.x - box.x, y: point.y - box.y };
  }
  const factsNow = (rect) => ({ ...live(), seamless: !!run?.seamless, hideable: !!run?.hideable, buttonVisible: run ? run.buttonVisible !== false : true, pointerNear: pointerNearRect(pointerInContent(), rect, PROXIMITY * (run?.geometry?.S ?? 1)) });

  function begin(reason) {
    if (!run || run.ending) return;
    const sample = run.timeline.sample(now());
    // An ending that comes before the glow was really out does not count as "seen": no ring, the mark stays owed for the next chance.
    run.counts = sample.p >= COUNTS_AT || sample.phase === 'hold' || sample.phase === 'back';
    run.ending = reason;
    // A toolbar that went away has no picture to close a ring around: the glow just draws back (the resting ring comes with the picture when the toolbar is next shown; the service sets it when the mark is done).
    const options = { ring: run.counts && run.ringWanted && reason !== 'hidden' };
    run.timeline.end(now(), reason, options);
    void script(`window.__aura.end(${now()}, ${JSON.stringify(reason)}, ${JSON.stringify(options)})`);
  }

  function finish() {
    const current = run;
    if (!current || current.finishing) return;
    current.finishing = true;
    clearTick(tick); tick = null;
    const consumed = Boolean(current.counts);
    const wantsRing = current.ringWanted && consumed && current.timeline.sample(now()).ring;
    // The glow is drawn back; the ring is whole. The resting ring beneath it (the profile picture's own, drawn by the interface) appears now, identical to it,
    // and a moment later this one fades: nothing changes on screen at the handoff.
    if (wantsRing) onRing({ id: current.id, rank: current.rank });
    const finishAll = () => { release(); if (consumed) done(current.id); current.resolve?.({ played: true, consumed, reason: current.ending }); };
    if (wantsRing) {
      const fadeMs = restingRing ? RING_FADE_MS : RING_FADE_PLAIN_MS;
      let held = false, up = restingRing ? Boolean(current.ringIsUp) : true, fading = false;
      const fade = () => { if (fading) return; fading = true; void script(`window.__aura.fadeRing(${fadeMs})`); wait = setTimer(finishAll, fadeMs + 20); };
      later(() => { held = true; if (up) later(fade, RING_PAINT_MS); }, HANDOFF_MS);
      later(fade, RING_WAIT_MAX_MS);
      current.ringUp = () => { if (up) return; up = true; if (held) later(fade, RING_PAINT_MS); };
    } else finishAll();
  }

  function onTick() {
    if (!run) return;
    // A page view added while the aura is on (a tab switch) would cover it: it stays the last child, above the pages.
    const win = getWindow();
    if (alive() && win && !win.isDestroyed() && win.contentView.children.at(-1) !== view) { try { win.contentView.addChildView(view); } catch { /* the window is going away */ } }
    const facts = factsNow(run.geometry.rect);
    const reasons = blockers(facts);
    if (reasons.length && !run.ending) begin(reasons[0]);
    const sample = run.timeline.sample(now());
    // The unhurried endings come from the timeline itself (the hold ran out, or Seamless's ten seconds): they always count as seen.
    if (sample.phase !== 'out' && sample.phase !== 'hold' && !run.ending) { run.ending = sample.reason; run.counts = true; }
    if (sample.done) finish();
  }

  /** The aura is due for `request.id` (what the feedback service owes: its auraPending). Returns a promise of {played, ...}: it resolves when the aura is over, or at once with
   * {played:false, reasons} when it may not play now (the caller asks again at its next chance: a focus, a layout, a popup closing). `request`:
   * {id, avatar, toolbarBottom, scale, appearance, color, seamless, size, rank}. `id` 'earlyMember' leaves no ring; 'rank:<rank>' closes as a ring in `color`. */
  async function play(request) {
    if (run) return { played: false, reasons: ['busy'] };
    const geometry = auraGeometry(request);
    const verdict = canPlay({ ...live(), seamless: !!request.seamless, hideable: !!request.hideable, buttonVisible: request.buttonVisible !== false, pointerNear: pointerNearRect(pointerInContent(), geometry.rect, PROXIMITY * geometry.S) }, { id: request.id, pending: pending() });
    if (!verdict.ok) return { played: false, reasons: verdict.reasons };
    const ringWanted = String(request.id).startsWith('rank:');   // the mark's and the points' aura leave no ring
    if (reducedMotion()) {
      // Motion set to Off: no aura. The ring simply fades in (the interface does that on `onRing`), and the mark counts as shown.
      if (ringWanted) onRing({ id: request.id, rank: request.rank, motionOff: true });
      done(request.id);
      return { played: false, consumed: true, reasons: ['motion-off'] };
    }
    if (!ensure()) return { played: false, reasons: ['no-window'] };
    run = { id: request.id, rank: request.rank, geometry, request, ringWanted, seamless: !!request.seamless, hideable: !!request.hideable, buttonVisible: request.buttonVisible !== false, timeline: createTimeline(timelineOptions), ending: null, counts: false, finishing: false, resolve: null };
    const result = new Promise((resolve) => { run.resolve = resolve; });
    const rgb = ringWanted ? parseColor(request.color) || NEUTRAL[request.appearance === 'light' ? 'light' : 'dark'] : NEUTRAL[request.appearance === 'light' ? 'light' : 'dark'];
    view.setBounds(geometry.rect);
    await ready;
    if (!run || !alive()) return { played: false, reasons: ['gone'] };
    const config = { w: geometry.rect.width, h: geometry.rect.height, ox: geometry.ox, oy: geometry.oy, S: geometry.S, above: geometry.above, rgb, core: LOOK.core, peak: LOOK.peak, ringRadius: geometry.ringRadius, stroke: geometry.stroke, gap: geometry.gap, avatar: geometry.avatar };
    await script(`window.__aura.setup(${JSON.stringify(config)}); window.__aura.freeze(${isFrozen()});`);
    const startedAt = now();
    run.timeline.start(startedAt, { rest: !!request.seamless, ring: ringWanted });
    view.setVisible(true);
    try { if (view.webContents.isFocused()) restoreFocus(); } catch { /* the layer is going away */ }
    await script(`window.__aura.start(${startedAt}, ${JSON.stringify({ rest: !!request.seamless, ring: ringWanted })})`);
    tick = setTick(onTick, TICK_MS); tick.unref?.();
    return result;
  }

  return {
    play,
    /** An ending from outside (a pop-up opening, the window moving or resizing, the toolbar revealed): the same draw-back. No-op when nothing plays. */
    end(reason) { begin(reason || 'end'); },
    /** The interface tells, every frame while an aura plays, where the profile picture is and whether the toolbar it is on is showing: `update` {visible, avatar?, toolbarBottom?, scale?, size?}. The toolbar
     * revealed or hidden is an ending (aura-conditions: 'revealed', 'hidden'), the same draw-back as every other; and the layer FOLLOWS a picture that moves (a resize, the toolbar sliding in), so a
     * draw-back always closes on the picture itself and never on the place it was. Returns {followed}. */
    follow(update) {
      if (!run || !update || run.finishing) return { followed: false };
      run.buttonVisible = update.visible !== false;
      const avatar = update.avatar;
      if (update.visible !== false && avatar && Number.isFinite(avatar.x) && Number.isFinite(avatar.y) && avatar.width > 0 && avatar.height > 0 && update.size && update.size.width > 0 && update.size.height > 0) {
        const next = auraGeometry({ avatar, toolbarBottom: update.toolbarBottom ?? null, scale: update.scale > 0 ? update.scale : run.geometry.S, size: update.size, placement: run.geometry.above ? 'above' : 'below' });
        const was = run.geometry, moved = next.rect.x !== was.rect.x || next.rect.y !== was.rect.y || next.rect.width !== was.rect.width || next.rect.height !== was.rect.height;
        const inside = Math.abs(next.ox - was.ox) > 0.25 || Math.abs(next.oy - was.oy) > 0.25 || Math.abs(next.ringRadius - was.ringRadius) > 0.05 || next.avatar !== was.avatar;
        if (moved || inside) {
          run.geometry = next;
          if (alive()) {
            if (moved) view.setBounds(next.rect);
            if (inside) void script(`window.__aura.reanchor(${JSON.stringify({ ox: next.ox, oy: next.oy, ringRadius: next.ringRadius, stroke: next.stroke, gap: next.gap, avatar: next.avatar, S: next.S })}, ${now()})`);
          }
        }
      }
      return { followed: true };
    },
    /** The interface says its resting ring is drawn (after the aura's draw-back handed it over): the layer's own, identical ring can fade now. No-op when no ring is being handed over. */
    ringUp() { if (!run) return { ok: false }; run.ringIsUp = true; if (run.ringUp) run.ringUp(); return { ok: true }; },
    /** The window moved or was resized: a quick draw-back (the layer's place is no longer right). */
    geometryChanged() { begin('moved'); },
    /** The window is going away: nothing is left to animate. */
    destroy() { const current = run; release(); current?.resolve?.({ played: false, reasons: ['destroyed'] }); },
    get active() { return Boolean(run); },
    /** Prototype and tests only: run one tick by hand and draw this instant's frame in the layer (the page is frozen when `frozen: true`). */
    async step() { onTick(); if (run && alive()) await script(`window.__aura.renderAt(${now()})`); if (run?.timeline.sample(now()).done) finish(); },
    get view() { return view; },
    /** Where the layer and the ring are right now (the rectangle, the ring's centre in the layer and its radius), or null when nothing plays: the pictures measure the ring against it. */
    get geometry() { return run ? run.geometry : null; },
    get state() { return run ? run.timeline.sample(now()) : null; },
  };
}

module.exports = { createAura, auraGeometry, parseColor, NEUTRAL, TICK_MS, PROXIMITY };
