/** The tab strip's spring (stiffness 360, damping 38) sampled at 33 even steps over 480ms, the same curve the sidebar's
 * CSS slide uses, so the native page and the sidebar move as one. 480ms at Premium; Fast runs it in 240 (`pace` .5, the interface's
 * --motion-pace), like the sidebar, the page card and a page the interface draws. */
const SPRING = [0, .03361, .112, .21091, .31536, .41656, .50969, .59255, .66451, .72589, .77752, .82045, .85584, .88478, .9083, .9273, .94258, .95483, .9646, .97237, .97853, .9834, .98725, .99027, .99265, .99452, .99598, .99712, .99801, .99871, .99925, .99967, 1];
const spring = progress => { const at = Math.min(1, Math.max(0, progress)) * (SPRING.length - 1), i = Math.min(SPRING.length - 2, Math.floor(at)); return SPRING[i] + (SPRING[i + 1] - SPRING[i]) * (at - i); };

/** A spring given the way the interface gives it (src/ui/springs.ts: a perceptual duration in seconds and a bounce), so the native
 * page and the sliding chrome follow the same curve. Position after `t` seconds from rest, 0 to 1. */
function springAt(spec, t) {
  const omega = Math.PI * 2 / Math.max(.05, spec.duration), zeta = 1 - Math.max(0, Math.min(.95, spec.bounce)), y0 = -1;
  if (t <= 0) return 0;
  if (zeta >= .9999) { const b = omega * y0, e = Math.exp(-omega * t); return 1 + (y0 + b * t) * e; }
  const wd = omega * Math.sqrt(1 - zeta * zeta), decay = zeta * omega, e = Math.exp(-decay * t), b = decay * y0 / wd;
  return 1 + e * (y0 * Math.cos(wd * t) + b * Math.sin(wd * t));
}
/** Seconds until the spring stays within `tolerance` of its target (the same measure the interface's easing uses). */
function springSettle(spec, tolerance = .004) {
  const step = 1 / 240; let last = 0;
  for (let i = 1; i <= 240 * 6; i++) { const t = i * step; if (Math.abs(springAt(spec, t) - 1) > tolerance) last = t; else if (t - last > .1) break; }
  return last + step;
}
const validSpring = spring => spring && Number.isFinite(spring.duration) && Number.isFinite(spring.bounce) && spring.duration > 0;
/** The pace a set-length glide runs at (the interface's --motion-pace: .5 in Fast, 1 at Premium); anything else is 1. */
const paceOf = pace => Number.isFinite(pace) && pace > 0 && pace <= 1 ? pace : 1;
/** Fast's pace: half of Premium (beta.14 item 16). A copy of `fastPace` in src/ui/motionTokens.ts; tests/sidebar-slide-speed.test.ts keeps them equal. */
const FAST_PACE = .5;
/** That pace from a layout's `motionSpeed` (the interface sends 1 / --motion-scale: 1/1.7 Premium, 1/.6 Fast, 1 Off): Fast is
 * the only speed above 1; Premium keeps its 480ms. */
const layoutPace = motionSpeed => Number(motionSpeed) > 1 ? FAST_PACE : 1;

/** The page's corner radius, applied to the native view once per distinct value. A WebContentsView has one radius for all four
 * corners (no per-corner API, and a parent View's radius does not clip it: qa/native-clip-probe.mjs). `entry.radius` is what the view
 * has now; `entry.radiusGoal` is where a running move is taking it. */
function applyRadius(entry, radius) {
  const next = Math.max(0, Math.round(radius));
  if (entry.radius !== next) { entry.view.setBorderRadius(next); entry.radius = next; }
}

/** A held glide keeps the page's layout at one size while its view's edges follow the card on every frame: the view is exactly the card's rectangle (all four edges on the spring,
 * so the 6 px frame strip around an inset card is never covered and the landing has nothing to snap), and the page lays out at the larger of its two sizes through the viewport
 * override (`enableDeviceEmulation({viewSize})`: the view shows that layout clipped to the view, never scaled). One layout at the start of a widening, one at the landing of a
 * narrowing, none in between. `entry.layoutHold` is the size in force; it is released `RELEASE_QUIET` ms after the glide lands (the view's last size has reached the page by then), or at once when any other placement takes over. */
const canHoldLayout = entry => { const wc = entry.view?.webContents; return !!wc && typeof wc.enableDeviceEmulation === 'function' && typeof wc.disableDeviceEmulation === 'function'; };
function holdLayout(entry, size) {
  const wc = entry.view.webContents, held = entry.layoutHold;
  if (!wc || wc.isDestroyed?.() || (held && held.width === size.width && held.height === size.height)) return;
  wc.enableDeviceEmulation({screenPosition: 'desktop', viewPosition: {x: 0, y: 0}, deviceScaleFactor: 0, viewSize: {width: size.width, height: size.height}, scale: 1});
  entry.layoutHold = {width: size.width, height: size.height};
}
function releaseLayout(entry, clock) {
  if (entry.releaseTimer) { (clock?.cancel ?? clearTimeout)(entry.releaseTimer); entry.releaseTimer = null; }
  entry.liveHold = false;
  if (!entry.layoutHold) return;
  entry.layoutHold = null;
  const wc = entry.view?.webContents;
  if (wc && !wc.isDestroyed?.()) wc.disableDeviceEmulation();
}
/** How long the view stands on its final rectangle before the page's layout is let go (the landing of a held glide). The view's size travels to the page's renderer
 * as visual properties, one in flight at a time, while the end of the viewport override goes over its own channel at once: released in the same turn as the last
 * `setBounds`, the page laid out at the size its renderer last heard (the glide's last pixel short, 1279 wide) and again when the final size arrived 25 to 35 ms later,
 * a second re-layout of a heavy site (qa/regression-guard c2 `off · heavy page`: 7 of 16 reps of the Sidebar mode morph on the guard's 2500-card page at Fast .6, every run at .5, and a known 1 in 3 at Premium).
 * Letting the view stand for a few frames first costs nothing the eye can see (the page shows exactly what it showed) and the release then lands on the size that is there. */
const RELEASE_QUIET = 64;
function releaseLayoutAfter(entry, clock, quiet = RELEASE_QUIET) {
  if (entry.releaseTimer) { clock.cancel(entry.releaseTimer); entry.releaseTimer = null; }
  if (!entry.layoutHold) return;
  entry.releaseTimer = clock.later(() => { entry.releaseTimer = null; releaseLayout(entry, clock); }, quiet);
}

/** A slide asks `clock.busy(webContents)` (the share of one core the page's renderer used since the last call, or undefined) every
 * BUSY_EVERY ms. A page above BUSY on two checks in a row cannot keep up with a layout per frame: for the rest of that slide it is
 * resized every THIN_GAP ms instead (about 30 a second), and the last move still lands on the final size. A translation does no
 * page layout, so a busy renderer never lowers the cadence of a slide that keeps its viewport. Never a blur or a matte. */
const BUSY = .6, BUSY_EVERY = 90, THIN_GAP = 33;
/** The docked sidebar opening or closing, and the toolbar rows going or coming as the view enters or leaves Seamless (`smooth`): a
 * page whose near edges move (sideways or up and down) with its far edges staying put keeps the larger of its two sizes while it
 * glides, so its contents move with the chrome at the display's frame rate and the site lays out once, never once per frame (a heavy
 * site re-wrapped its text three or four times a second and stood cut off in between). The page takes its final size at the start of
 * a widening, and when the glide has all but landed on a narrowing. */
const SIDEWAYS = 40, DROP = 16, FAR_EDGE = 12, LANDED = 4;
/** A held slide may carry a picture of the page's old layout (`clock.dissolve`, page-dissolve.cjs), so its one re-layout is dissolved
 * instead of cut. The page changes size only once the picture stands over it: a widening glides at its old size for up to EARLY_WAIT ms
 * (about three frames, while the picture is made) and then takes its final size; a narrowing has its picture made as the glide
 * nears its end (PRELAND, of the eased distance) and waits up to LAND_WAIT ms for it at the landing. Without a picture (none made in
 * time, no layer, reduced motion) the slide goes on exactly as it would have. */
const EARLY_WAIT = 130, LAND_WAIT = 360, PRELAND = .9;

/** A page that follows the chrome (the docked sidebar opening or closing, a toolbar easing, a floating reveal) runs on the chrome's
 * spring, one viewport per display frame, and its corner radius is interpolated with it. Any other change is committed at once. */
function placePageBounds(entry, target, animated, clock = {now: () => performance.now(), later: (fn, delay) => setTimeout(fn, delay), cancel: clearTimeout}, frameInterval = 1000 / 60, motion, pageSpring, radius, smooth, pace = 1, lag = null) {
  // A placement while a slide is under way (the chrome's own transition measures the page on every frame, a toolbar easing to its
  // new height) becomes the slide's new end: the move keeps its curve and the viewport takes a new size at once. Snapped to its
  // end, the page ran ahead of the chrome it was following and covered it.
  const run = entry.slideRun;
  // A placement while a resizing slide is under way (the toolbar easing to its height measures the page on every frame) becomes the
  // slide's new end: the move keeps its curve and its far edge, and nothing jumps.
  if (run && entry.boundsTimer && !animated && run.resizing) {
    run.target = target;
    if (entry.layoutHold) holdLayout(entry, {width: Math.max(entry.layoutHold.width, target.width), height: Math.max(entry.layoutHold.height, target.height)});
    if (Number.isFinite(radius)) entry.radiusGoal = Math.round(radius);
    return;
  }
  if (run && entry.boundsTimer && !animated && entry.view.getBounds().width === target.width && entry.view.getBounds().height === target.height) {
    // Chrome arriving (the page's edge moving right or down) takes its room at once, so the page never covers it as it comes in;
    // chrome leaving keeps the slide.
    const now = entry.view.getBounds(), jump = Object.fromEntries(['x', 'y'].filter(key => target[key] > now[key]).map(key => [key, target[key]]));
    run.target = target; run.start = {...run.start, width: target.width, height: target.height, ...jump};
    if (now.width !== target.width || now.height !== target.height || Object.keys(jump).length) entry.view.setBounds({...now, ...jump, width: target.width, height: target.height});
    if (Number.isFinite(radius)) entry.radiusGoal = Math.round(radius);
    return;
  }
  if (entry.boundsTimer) clock.cancel(entry.boundsTimer);
  entry.boundsTimer = null; entry.slideRun = null;
  if (entry.releaseTimer) { clock.cancel(entry.releaseTimer); entry.releaseTimer = null; }   // a landed glide still waiting to let go of its layout: this placement decides
  if (entry.cover) { entry.cover.drop(); entry.cover = null; }
  let start = entry.view.getBounds();
  const started = clock.now(), hasRadius = Number.isFinite(radius);
  let fromRadius = Number.isFinite(entry.radius) ? entry.radius : radius;
  if (hasRadius) entry.radiusGoal = Math.round(radius);
  // A native view cannot scale its composited contents independently of its viewport, so a page whose size follows the chrome is
  // resized on every frame of the chrome's spring: the site lays out live at the display's frame rate and its far edge never moves.
  // (A frosted matte used to hide one atomic resize; we asked for the frame rate instead, R6.)
  const resizing = start.width !== target.width || start.height !== target.height, slide = motion === 'slide';
  const hold = !!smooth && slide && resizing && Math.abs(start.x + start.width - target.x - target.width) <= FAR_EDGE && Math.abs(start.y + start.height - target.y - target.height) <= FAR_EDGE && (Math.abs(start.x - target.x) >= SIDEWAYS || Math.abs(start.y - target.y) >= DROP);
  const dissolve = hold ? clock.dissolve : null, early = hold && target.width >= start.width && target.height >= start.height;
  // The edges-exact glide (see holdLayout): a held glide with no picture of the old layout over it, on a page whose view can take the viewport override.
  const exact = hold && !dissolve && canHoldLayout(entry);
  // The docked sidebar's slide (no spring of its own): the card the interface draws beside the sidebar is round from its first frame, so the page's corners are too, and its far
  // bottom edge rises on the same spring as the interface's card (founder, 5 Nov: the corner started square and then popped round, and the bottom line blinked in at the landing).
  // The same slide beside a sidebar on the RIGHT: the card's right edge follows the sidebar and its left edge stays. There is no held glide there (the held view would stand over the
  // sidebar, and its text would jump when it landed): the page is resized a frame at a time, but its corners are the card's from the first frame all the same.
  const beside = !hold && !!smooth && slide && resizing && Math.abs(start.x - target.x) <= FAR_EDGE && Math.abs(start.y + start.height - target.y - target.height) <= FAR_EDGE && Math.abs(start.x + start.width - target.x - target.width) >= SIDEWAYS;
  const docked = (hold || beside) && !validSpring(pageSpring);
  if (docked && hasRadius && Math.round(radius) > fromRadius) fromRadius = Math.round(radius);
  // (Not with a picture of the old layout over the page: that layer, off unless ACIRA_DISSOLVE=1, keeps the old size.)
  const rising = docked && !dissolve && Math.abs(start.y - target.y) < DROP;
  if (!animated || (resizing && !slide)) { entry.view.setBounds(target); releaseLayout(entry, clock); if (hasRadius) { applyRadius(entry, radius); entry.radiusGoal = undefined; } return; }
  if (exact) {
    // The page keeps the layout it has (or this view's size) and takes the larger of that and the target: a widening lays out once here, at its final size; a narrowing keeps its old one until it lands.
    const lay = entry.layoutHold || {width: start.width, height: start.height};
    holdLayout(entry, {width: Math.max(lay.width, target.width), height: Math.max(lay.height, target.height)});
  } else releaseLayout(entry, clock);
  // A slide may bring its own spring (Seamless edge reveals: a reveal and a hide each have one, already at the speed); without it, the
  // sidebar's 480ms curve, at the speed's pace.
  const own = slide && validSpring(pageSpring) ? pageSpring : null, settleMs = own ? Math.round(springSettle(own) * 1000) : 0;
  // A glide on its own spring may hold one pair of edges back (`lag`, ms): the page's top and bottom edges wait for the chrome that is leaving their way, or its left and right edges wait for the one that is. The glide ends when the later pair has settled.
  const edgeLag = own && lag ? {x: Math.max(0, Math.min(600, Number(lag.x) || 0)), y: Math.max(0, Math.min(600, Number(lag.y) || 0))} : {x: 0, y: 0};
  const duration = own ? settleMs + Math.max(edgeLag.x, edgeLag.y) : Math.round((slide ? 480 : 280) * paceOf(pace));
  const cadence = Math.max(1000 / 360, Math.min(1000 / 30, Number(frameInterval) || 1000 / 60));
  const lead = 0;
  const current = {start, target, resizing, hold: hold && !exact};
  if (slide) entry.slideRun = current;
  let last = start, thin = false, strained = 0, probedAt = 0;
  if (slide) clock.busy?.(entry.view.webContents);
  let cover = null, picture = null, held = null, laidOut = false, watching = false, landed = false, sized = true, ready = 0, nearAt = null;
  // The slide of a page that a tab switch hid goes on to its end; it makes no picture then, and a picture it has comes down.
  const hidden = () => entry.view.getVisible?.() === false;
  const beginCover = area => { if (hidden()) { cover = null; return null; } try { cover = dissolve?.begin(entry.view, area) ?? null; } catch { cover = null; } entry.cover = cover; cover?.ready.then(ok => { ready = ok ? 1 : -1; }); return cover; };
  // The page is about to change size: have its new layout reported, and dissolve the picture into it once it is.
  const watchLayout = () => { watching = true; cover.release(cover.laidOut.then(() => { laidOut = true; })); };
  const frame = () => {
    entry.boundsTimer = null;
    if (entry.view.webContents?.isDestroyed()) { entry.slideRun = null; return; }
    if (cover && !cover.dropped && hidden()) cover.drop();
    const elapsed = Math.max(0, clock.now() - started - lead), {start: from, target: to} = current;
    let progress = Math.min(1, elapsed / duration), eased = own ? (progress >= 1 ? 1 : springAt(own, progress * duration / 1000)) : slide ? spring(progress) : 1 - Math.pow(1 - progress, 3);
    // Edges, not sizes, are interpolated and rounded, so an edge that stays put stays on the same pixel in every frame. With no lag both pairs follow `eased`, exactly as before.
    const easedAfter = wait => !wait ? eased : progress >= 1 ? 1 : elapsed <= wait ? 0 : springAt(own, Math.min(settleMs, elapsed - wait) / 1000);
    const easedX = easedAfter(edgeLag.x), easedY = easedAfter(edgeLag.y);
    const edge = (a, b, e = eased) => Math.round(a + (b - a) * e), left = edge(from.x, to.x, easedX), top = edge(from.y, to.y, easedY), right = edge(from.x + from.width, to.x + to.width, easedX), bottom = edge(from.y + from.height, to.y + to.height, easedY);
    let bounds = {x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top)};
    if (current.hold) {
      if (Math.abs(left - to.x) <= LANDED && Math.abs(top - to.y) <= LANDED) progress = 1;
      bounds = progress >= 1 ? {...to} : {x: left, y: top, width: Math.max(from.width, to.width), height: rising ? Math.max(1, bottom - top) : Math.max(from.height, to.height)};
      if (dissolve && !early && !cover && !landed && eased >= PRELAND) beginCover();
      if (progress >= 1 && dissolve && !early && !landed) {
        // A narrowing has landed: the page still holds its old layout, which is what the picture shows. The glide goes on (the page
        // keeps its held size) until the picture stands, bounded; then the page takes its final size under it.
        if (!cover) beginCover();
        nearAt ??= elapsed;
        if (cover && !ready && elapsed - nearAt < LAND_WAIT) {
          const hold = {x: left, y: top, width: Math.max(from.width, to.width), height: rising ? Math.max(1, bottom - top) : Math.max(from.height, to.height)};
          if (Object.keys(hold).some(key => hold[key] !== last[key])) { entry.view.setBounds(hold); last = hold; }
          entry.boundsTimer = clock.later(frame, cadence);
          return;
        }
        landed = true; held = last;
        if (cover && (ready < 1 || !cover.show(held, entry.radius))) cover.drop();
      }
      if (!sized) {
        // A widening at its old size until the picture of the old layout stands over the page: then the page takes its final size.
        if (progress >= 1 || ready < 0 || (!ready && elapsed >= EARLY_WAIT)) { sized = true; cover.drop(); }
        else if (ready > 0) sized = true;
        else bounds = {x: left, y: top, width: from.width, height: from.height};
      }
    }
    if (cover && landed && held && !cover.dropped) cover.show({x: bounds.x, y: bounds.y, width: held.width, height: held.height}, entry.radius);
    if (cover && early && sized && !cover.dropped) { picture = {x: bounds.x, y: bounds.y, width: Math.max(from.width, to.width), height: rising ? bounds.height : Math.max(from.height, to.height)}; cover.show(picture, entry.radius); }
    if (Object.keys(bounds).some(key => bounds[key] !== last[key])) { if (cover && !watching && (bounds.width !== last.width || bounds.height !== last.height)) watchLayout(); entry.view.setBounds(bounds); last = bounds; }
    if (exact && progress >= 1) releaseLayoutAfter(entry, clock);
    if (hasRadius) { const goal = entry.radiusGoal ?? Math.round(radius); applyRadius(entry, progress >= 1 ? goal : fromRadius + (goal - fromRadius) * Math.min(1, Math.max(0, eased))); if (progress >= 1) entry.radiusGoal = undefined; }
    if (progress < 1) {
      if (slide && current.resizing && !current.hold && clock.busy && elapsed - probedAt >= BUSY_EVERY) { probedAt = elapsed; strained = clock.busy(entry.view.webContents) >= BUSY ? strained + 1 : 0; if (strained >= 2) thin = true; }
      const step = thin ? Math.max(cadence, THIN_GAP) : cadence, deadline = lead + Math.min(duration, (Math.floor(elapsed / step) + 1) * step);
      entry.boundsTimer = clock.later(frame, Math.max(1, deadline - (clock.now() - started)));
    } else if (entry.slideRun === current) entry.slideRun = null;
  };
  if (dissolve && early && beginCover({width: Math.max(start.width, target.width), height: Math.max(start.height, target.height)})) sized = false;
  frame();
}
/** A page whose box the interface moves itself, a frame at a time, and sends each frame's rectangle "at once" (`pageImmediate`): a split's panes following the card through a
 * layout switch (src/ui/sharedMotion.ts followPage: the docked sidebar opening or closing, a view switch, Sidebar mode) and the page under the toolbar easing back in as the view
 * leaves Seamless (the header's height animation, followed by the ResizeObserver). Each of those rectangles resized the view and the site laid out again, 13 to 20 times per
 * pane per slide on a heavy site (reported 10 Nov 2026, Windows: "split view with 3 tabs, everything is laggy"; three panes cost 2.2 CPU-seconds of page work for one
 * sidebar open, one page 0.36). The interface now also sends the size the page is going to (`hold`): the view still takes every rectangle exactly as sent, on the interface's
 * own clock, and the page lays out once at the larger of the size it had when the movement began and the size it ends at (the held layout of a glide, holdLayout above).
 * Let go RELEASE_QUIET ms after the first layout that no longer carries the hold, or LIVE_QUIET ms after the last rectangle that did (the movement stopped without a word). */
const LIVE_QUIET = 250;
const validSize = size => !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
function placeLive(entry, target, hold, clock, radius) {
  if (entry.boundsTimer) { clock.cancel(entry.boundsTimer); entry.boundsTimer = null; }
  entry.slideRun = null;
  if (entry.cover) { entry.cover.drop(); entry.cover = null; }
  if (entry.releaseTimer) { clock.cancel(entry.releaseTimer); entry.releaseTimer = null; }
  if (validSize(hold) && canHoldLayout(entry)) {
    // The size in force when the movement began (a held layout still standing from a glide that just landed counts), the size it goes to, and this frame's: never smaller than the view.
    const now = entry.view.getBounds(), lay = entry.layoutHold || {width: now.width, height: now.height};
    holdLayout(entry, {width: Math.max(lay.width, Math.round(hold.width), target.width), height: Math.max(lay.height, Math.round(hold.height), target.height)});
    entry.liveHold = true;
    entry.releaseTimer = clock.later(() => { entry.releaseTimer = null; entry.liveHold = false; releaseLayout(entry, clock); }, LIVE_QUIET);
  } else { entry.liveHold = false; releaseLayout(entry, clock); }
  entry.view.setBounds(target);
  if (Number.isFinite(radius)) { applyRadius(entry, radius); entry.radiusGoal = undefined; }
}
/** The interface's movement has ended (a layout without the hold reached this page): its layout is let go once the last rectangle has reached the page. */
function endLive(entry, clock) {
  if (!entry.liveHold) return;
  entry.liveHold = false;
  if (entry.layoutHold) releaseLayoutAfter(entry, clock); else if (entry.releaseTimer) { clock.cancel(entry.releaseTimer); entry.releaseTimer = null; }
}
module.exports = {placePageBounds, placeLive, endLive, applyRadius, springAt, springSettle, layoutPace, FAST_PACE, LIVE_QUIET, RELEASE_QUIET};
