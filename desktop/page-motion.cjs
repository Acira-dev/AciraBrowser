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
  entry.wantedRadius = Math.max(0, Math.round(radius));
  const next = entry.dock?.holed ? 0 : entry.wantedRadius;   // Beta 14: a page standing in the device toolbox's hole is a device's screen: square, and given its corners back (wantedRadius) when the toolbox goes
  if (entry.radius !== next) { entry.view.setBorderRadius(next); entry.radius = next; }
}

/** A held glide keeps the page's layout at one size while its view's edges follow the card on every frame: the view is exactly the card's rectangle (all four edges on the spring,
 * so the 6 px frame strip around an inset card is never covered and the landing has nothing to snap), and the page lays out at the larger of its two sizes through the viewport
 * override (`enableDeviceEmulation({viewSize})`: the view shows that layout clipped to the view, never scaled). One layout at the start of a widening, one at the landing of a
 * narrowing, none in between. `entry.layoutHold` is the size in force; it is released `RELEASE_QUIET` ms after the glide lands (the view's last size has reached the page by then), or at once when any other placement takes over. */
const canHoldLayout = entry => { const wc = entry.view?.webContents; if (entry.dock?.noHold) return false; /* Beta 14: DevTools' device mode owns the page's viewport override while it is on */ return !!wc && typeof wc.enableDeviceEmulation === 'function' && typeof wc.disableDeviceEmulation === 'function'; };
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
const BUSY = .6, BUSY_EVERY = 90, THIN_GAP = 33, LIVE_PROBE = 30;
/** D136 (22 Nov 2026): a LIVE glide (a light page laid out with its view at every step: `live` in placePageBounds) falls back to the held layout when its page FALLS BEHIND its view, read on the page's own
 * frame clock (`clock.frameAge`, D112's, asked at every frame of a live glide), and no longer when its renderer is busy (`clock.busy`, BUSY above). A page that lays its text out again at every step keeps up
 * on 1.0 to 1.9 cores: BUSY held the 7,900-element wrapping page at +51 to +120 ms in every glide while its frames came 14 to 24 ms apart at the longest, and that re-wrap in mid-glide cut the page's right
 * end for 14 to 24 frames, up to 162 pt (real window, 22 Nov). The page falls behind when (what main itself read, hidden, 22 Nov, 120 Hz, the sidebar closing and opening at 168, 240 and 312, Premium
 * and Fast, and Full -> Seamless, 17 takes):
 * - LATE_REFRESHES: a frame of it begins more than two display refreshes late (16.7 ms here, 33 ms at 60 Hz). Pages that keep up: every frame within 15.3 ms (the 7,900-element page with three times
 *   the wrapping text; 12.7 ms with D134's text, 7.7 ms a 4,000-element article with pictures, tables and a sticky header, 3.8 ms the plain page). A page doing 20 ms of work in every frame: 22 to 28 ms,
 *   40 ms of work: 45 to 49 ms.
 * - BEHIND_STEPS: the view takes three steps in a row with no frame of the page between them (a page that draws nothing at all: its late frame never answers). Pages that keep up: 2 in a row at most
 *   (the wrapping pages and the article as the sidebar opens). 20 and 40 ms of work in every frame: 3 at +77 ms. Held at +77 to +106 ms (the share of a core: +111 and +130 ms).
 * A late frame holds a NARROWING only (the view shrinks in either direction). Held at its final size, a narrowing stands short of its edge by a strip of its own colour; a widening held at its final size
 * shows its far end cut until the view has grown, which is what the live glide is for. On the real window (22 Nov) the page with three times the wrapping text began frames late in a widening and was
 * held: its right end cut up to 114 pt at Wide (Premium) and 254 pt at Wide (Fast), where live it lags as a strip of its own colour (8 frames, 35 pt); a widening on the refresh lock already waits
 * for a late page (D112, PAGE_LATE). So a widening falls back only when its page stops drawing (BEHIND_STEPS).
 * A page that cannot be asked (no frame clock, or the ask fails) keeps BUSY's rule. */
const LATE_REFRESHES = 2, BEHIND_STEPS = 3;
/** D136 (14.3): EVERY widening on D112's refresh lock (a close, either side; one step a page frame) that kept up decides again whether its page is remembered: a median gap between its steps of
 * REMEMBER_REFRESHES refreshes or more remembers it (so even its FIRST narrowing starts held), a smaller one forgets it (a page that fell behind once, or was slow for a while, is live again).
 * A gap count would not do: the 1x-text page, which keeps up, skips every other refresh on every close (16.7 ms), and a single late frame of its open had it remembered for good (real window, 23 Nov). Measured on the real window (main's step log of the closes, 23 Nov): the 3x-text page 24.8 to 30.4 ms a step (3 refreshes; it falls behind on every open), the 1x-text page
 * 8.3 to 21.8 ms (it keeps up), the busy 40 ms pages 33.3; the fall-behind line is BEHIND_STEPS (3 steps with no frame). REMEMBER_STEPS: at least that many steps to judge by. */
const REMEMBER_REFRESHES = 2.75, REMEMBER_STEPS = 4;
const medianGap = at => { const gaps = at.slice(1).map((t, i) => t - at[i]).sort((a, b) => a - b); return gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2; };
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
/** How long the native page waits when a sidebar column OPENS: 2.5 display frames, whatever the display's refresh (its frame interval is `frameInterval`: main's 1000 / displayFrequency): 21 ms at 120 Hz (this Mac's ProMotion: the interface's rAF
 * ran at a median 8.3 ms through every dock measured), 42 ms at 60 Hz (not measured on hardware: the lag is the pipeline's, a number of display frames). The interface's picture of a frame reaches the screen after main's setBounds of the
 * same instant; without the wait the native page leads the sidebar's edge and a strip of the page card shows between them (placePageBounds). */
const OPEN_LEAD_FRAMES = 2.5;
/** An edge that gives room takes each whole point STEP_LAG_FRAMES display frames after its curve reaches it, and lands LAND_LAG_FRAMES after the curve's end (D97, placePageBounds). Real docks (19 Nov,
 * interleaved): with the curve, a 1 device px line in 1 of 3 (a step at +333 ms and the landing at +458); steps a frame later, the line at the landing in 2 of 9; steps and landing a frame later, 0 in
 * 26 docks at 168 and 240 (default, dense, minimal, right) but 2 of 5 at Wide (312: a step, 14-15 levels); steps two frames later, 0 of 7 at Wide and 0 of 5 at 240, Mini expands 0 of 3. */
const STEP_LAG_FRAMES = 2, LAND_LAG_FRAMES = 1;
/** D112 (20 Nov): a page view that GROWS SIDEWAYS a frame at a time with the docked sidebar's own slide (a column closing or collapsing, on either side) takes its steps ON THE DISPLAY'S REFRESH, one for each refresh, REFRESH_AIM of the
 * way through it. A page's content keeps up with one resize per refresh and no more: a second resize inside the same refresh (or a step that slips into the next one) leaves the content one step behind the view, and it stays one step
 * behind for as long as a resize comes every refresh. That step is a strip of the page's backing between its content and its edge: 10 pt at Standard and 16 at Wide for up to 15 frames in a Mini collapse on the right, 9 to 12 frames at
 * the far edge on the left. The steps came from setTimeout (whole milliseconds, 8 / 9 / 8 against a refresh of 8.33), so two shared a refresh every few frames. Real window, the view's edge ramped 8 pt a frame: steps placed on the
 * refresh, 0 strip frames in 27 of 27 ramps at 2.5, 4.5 and 6.5 ms after the refresh instant (live and held layouts); at 0.5 ms after it, 4 of 12 ramps with a strip; with setTimeout's steps, 3 of 4.
 * The refresh instant is the page's own frame clock (`clock.frameAge(webContents)`: how long ago the page's current frame began, asked again for every frame of the glide); the middle one of the last few answers is used.
 * The view takes no step before the page's first answer (it comes with the page's next frame; REFRESH_FIRST_WAIT refreshes at most), and its first step is the first such place after that answer: a first step taken anywhere in its refresh showed
 * the strip for one frame (6 px at the first moving frame, 1 take of 2). Without an answer (no such clock, a page that draws no frames) the steps are the ones they were. A view that gives room (a dock, an expand) cannot show the strip and keeps its steps untouched: STEP_LAG_FRAMES and LAND_LAG_FRAMES
 * were measured on them. ACIRA_PAGE_REFRESH_LOCK=0 (tests and rigs only) turns the lock off. */
const REFRESH_AIM = .42, REFRESH_SAMPLES = 5, REFRESH_FIRST_WAIT = 2;
/** Three more rules of a growing view's steps, each from a strip that was still there with the steps on the refresh (real window, 20 Nov):
 * - TO THE INSTANT (`clock.at`): a timer of whole milliseconds fired 1 to 3.5 ms after its instant, and a step that stood in the last part of its refresh reached the page after the page's frame for the next refresh had begun: one
 *   frame of strip in the middle of a glide (8 px at +50 ms, 2 takes of 4).
 * - THE FIRST STEP IS ONE POINT, AND THE REFRESH AFTER IT BRINGS NONE: the first resize after rest is drawn a frame before its content whatever its place in the refresh: 6 to 10 px for one frame at the first moving frame in 5 takes
 *   of 8, 26 px where the first step was a held page's 20 pt. One point is 2 device px for that one frame. A page that lays out with its view was still a step behind at the next resize (8 to 14 px for one more frame, 3 takes of 3);
 *   with one refresh left empty after the first point, 0 frames over 2 px (and with two one-point steps: the same, a frame later). The step after that takes the curve.
 * - A PAGE THAT IS LATE IS NOT RESIZED IN THAT REFRESH: when the page has begun no frame since the last resize, or began its last one more than PAGE_LATE of a refresh late (its own work, a long layout), the resize waits for the next
 *   refresh, STEP_SKIPS refreshes in a row at most. Resized all the same, the page fell a step behind and stayed there (a held heavy page whose frames began 6 to 7 ms late: 11 frames, up to 28 px). */
const PAGE_LATE = .5, STEP_SKIPS = 3;
/** - NO TWO RESIZES CLOSER THAN STEP_ROOM OF A REFRESH: a step that fired 3.5 ms late (main busy) stood 7 ms into its refresh and the next, on time, 4.8 ms after it; the page took both in one of its frames and stood a
 *   step behind for the rest of the glide (the two-colour page on the left, Standard: 13 frames, 26 px at the far edge, 1 take of 4). The step after a late one goes a refresh further. */
const STEP_ROOM = .75;
/** Cancels a step's timer: one made by `clock.at` cancels itself, any other is the clock's. */
const cancelStep = (clock, handle) => { if (handle && typeof handle.cancel === 'function') handle.cancel(); else clock.cancel(handle); };

/** A page that follows the chrome (the docked sidebar opening or closing, a toolbar easing, a floating reveal) runs on the chrome's
 * spring, one viewport per display frame, and its corner radius is interpolated with it. Any other change is committed at once.
 * `switching` (D134): the glide belongs to a switch the person made (the interface's layout says `pageSwitch`: a view change, Hide the toolbar, a layout change). */
function placePageBounds(entry, target, animated, clock = {now: () => performance.now(), later: (fn, delay) => setTimeout(fn, delay), cancel: clearTimeout}, frameInterval = 1000 / 60, motion, pageSpring, radius, smooth, pace = 1, lag = null, switching = false) {
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
    if (now.width !== target.width || now.height !== target.height || Object.keys(jump).length) { entry.view.setBounds({...now, ...jump, width: target.width, height: target.height}); entry.onBounds?.({...now, ...jump, width: target.width, height: target.height}); }
    if (Number.isFinite(radius)) entry.radiusGoal = Math.round(radius);
    return;
  }
  if (entry.boundsTimer) cancelStep(clock, entry.boundsTimer);
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
  const holdWanted = !!smooth && slide && resizing && Math.abs(start.x + start.width - target.x - target.width) <= FAR_EDGE && Math.abs(start.y + start.height - target.y - target.height) <= FAR_EDGE && (Math.abs(start.x - target.x) >= SIDEWAYS || Math.abs(start.y - target.y) >= DROP);
  // The docked sidebar's own slide (sideways only, no spring of its own) of a page that is cheap to lay out (main says so: `entry.sidewaysLive`, desktop/page-weight.cjs): the page is resized on every frame
  // with the card, so its layout follows the chrome and nothing is cut at the far edge or jumps at the landing (reported 17 Nov 00:20: Reddit's Log In cut for the glide, the header re-laid at its end). A page that
  // falls behind during it (D136: on its own frame clock, LATE_REFRESHES and BEHIND_STEPS) falls back to the held layout (`degraded`, below); a heavy page never starts live.
  // D134 (22 Nov 2026): so is a switch the person made (`switching`), though its top edge moves as well or it runs on a spring of its own. Held, the page was laid out at its FINAL size at once (holdLayout,
  // below) and the view grew over it: Full -> Seamless beside a sidebar on the left showed the page's right end cut (234 pt at 240, the Log In pill wholly gone from +25 to +106 ms, the cut closing at
  // +416 ms) and its bottom 30 pt; Hide the toolbar its bottom 30 pt for 250 ms. A Seamless edge reveal (a spring of its own, never `switching`) and a heavy page keep the held glide.
  const live = holdWanted && entry.sidewaysLive === true && canHoldLayout(entry) && (switching || (!validSpring(pageSpring) && Math.abs(start.y - target.y) < DROP));
  const hold = holdWanted && !live;
  // D136 (14.3): a live NARROWING of a page whose last live glide fell behind (`degraded` below, on its frame clock) starts held at its final size. Started live, the fall-back's own layout reached the
  // screen too late: the 3x-text page's open (7,900 elements) cut its right end 43 to 69 pt for 3 to 7 frames before the strip of its colour came (fell behind at +51 ms, its held layout ~30 to 45 ms
  // more, then two refreshes to the screen). Remembered per tab for the same address (`entry.fellBehind`); a page that keeps up is never remembered. (`__d136OpenUndo`: rig only, the open as before.)
  const address = () => { try { return String(entry.view.webContents?.getURL?.() ?? ''); } catch { return ''; } };
  // D136 (14.3): beside a sidebar on the RIGHT the page is not live or held (`beside` below): resized a step at a time, a page that cannot lay out at that pace was cut at its moving right edge on the open
  // (the 3x-text page at 312: up to 31 pt for 7 frames, real window 23 Nov). A light page's narrowing there (`besideOpen`) is judged on its frame clock as a live glide is, and held at its final size when it
  // falls behind or was remembered: the page stands at its final layout from its left edge, the sidebar comes in over the strip of its colour at the right.
  const besideOpen = !holdWanted && !!smooth && slide && resizing && entry.sidewaysLive === true && canHoldLayout(entry) && target.width < start.width && Math.abs(start.x - target.x) <= FAR_EDGE
    && Math.abs(start.y - target.y) < DROP && Math.abs(start.x + start.width - target.x - target.width) >= SIDEWAYS && globalThis.__d136OpenUndo !== true;
  const heldFromStart = (live || besideOpen) && (target.width < start.width || target.height < start.height) && typeof clock.frameAge === 'function' && globalThis.__d136Undo !== true && globalThis.__d136OpenUndo !== true
    && typeof entry.fellBehind === 'string' && entry.fellBehind === address();
  const dissolve = hold ? clock.dissolve : null, early = hold && target.width >= start.width && target.height >= start.height;
  // The edges-exact glide (see holdLayout): a held glide with no picture of the old layout over it, on a page whose view can take the viewport override.
  const exact = hold && !dissolve && canHoldLayout(entry);
  // The docked sidebar's slide (no spring of its own): the card the interface draws beside the sidebar is round from its first frame, so the page's corners are too, and its far
  // bottom edge rises on the same spring as the interface's card (founder, 5 Nov: the corner started square and then popped round, and the bottom line blinked in at the landing).
  // The same slide beside a sidebar on the RIGHT: the card's right edge follows the sidebar and its left edge stays. There is no held glide there (the held view would stand over the
  // sidebar, and its text would jump when it landed): the page is resized a frame at a time, but its corners are the card's from the first frame all the same.
  const beside = !hold && !!smooth && slide && resizing && Math.abs(start.x - target.x) <= FAR_EDGE && Math.abs(start.y + start.height - target.y - target.height) <= FAR_EDGE && Math.abs(start.x + start.width - target.x - target.width) >= SIDEWAYS;
  const docked = (holdWanted || beside) && !validSpring(pageSpring);
  if (docked && hasRadius && Math.round(radius) > fromRadius) fromRadius = Math.round(radius);
  // (Not with a picture of the old layout over the page: that layer, off unless ACIRA_DISSOLVE=1, keeps the old size.)
  const rising = docked && !dissolve && Math.abs(start.y - target.y) < DROP;
  let keepHeld = false;
  if (!animated || (resizing && !slide)) { entry.view.setBounds(target); entry.onBounds?.(target); releaseLayout(entry, clock); if (hasRadius) { applyRadius(entry, radius); entry.radiusGoal = undefined; } return; }
  if (exact) {
    // The page keeps the layout it has (or this view's size) and takes the larger of that and the target: a widening lays out once here, at its final size; a narrowing keeps its old one until it lands.
    const lay = entry.layoutHold || {width: start.width, height: start.height};
    holdLayout(entry, {width: Math.max(lay.width, target.width), height: Math.max(lay.height, target.height)});
  } else if (animated && slide && entry.layoutHold && entry.layoutHold.width >= Math.max(start.width, target.width) && entry.layoutHold.height >= Math.max(start.height, target.height) && globalThis.__d96Undo !== true) {   // (`__d96Undo`: rig only, the regression guard's negative control, qa/regression-guard c8)
    // D96 (19 Nov): a layout still held when a glide starts (the interface's own movement of this page, placeLive, a toolbar easing back, handed over to main's glide: by then main has
    // already said endLive) and big enough for the whole glide stays held through it and is let go when the glide lands. Let go here, at the glide's start, the page laid out once at the live rectangle (the toolbar coming back on the guard's heavy page: 1034x743 at +41 ms, then the
    // final 1034x714 at +420 ms: two layouts where one is the rule), whenever the live rectangle came a few frames before the glide.
    entry.liveHold = false; keepHeld = true;
  } else releaseLayout(entry, clock);
  // A slide may bring its own spring (Seamless edge reveals: a reveal and a hide each have one, already at the speed); without it, the
  // sidebar's 480ms curve, at the speed's pace.
  const own = slide && validSpring(pageSpring) ? pageSpring : null, settleMs = own ? Math.round(springSettle(own) * 1000) : 0;
  // A glide on its own spring may hold one pair of edges back (`lag`, ms): the page's top and bottom edges wait for the chrome that is leaving their way, or its left and right edges wait for the one that is. The glide ends when the later pair has settled.
  const edgeLag = own && lag ? {x: Math.max(0, Math.min(600, Number(lag.x) || 0)), y: Math.max(0, Math.min(600, Number(lag.y) || 0))} : {x: 0, y: 0};
  const duration = own ? settleMs + Math.max(edgeLag.x, edgeLag.y) : Math.round((slide ? 480 : 280) * paceOf(pace));
  const cadence = Math.max(1000 / 360, Math.min(1000 / 30, Number(frameInterval) || 1000 / 60));
  // OPENING a sidebar column (the page's left edge moving right, or its right edge moving left): the page waits OPEN_LEAD_FRAMES. Real window, light look, 60 Hz (17 Nov; widest frame of each take, strip of the page card between the
  // sidebar's edge and the page): no wait 22-30 pt on the Mini and Hidden docks (57 pt on Fast); 1 frame 0.5 pt Mini but 13 pt Hidden; 1.5 frames 1 / 0.5 / 3.5 / 12.5 (Mini right) / 6 (Fast); 2 frames 1 / 1 / 0.5 / 10.5 / 2; 2.5 frames
  // 0 / - / 1 / 0 / 0 on every cell tried (all at 120 Hz: 1 frame = 8.3 ms) (Mini left and right, Hidden right, Fast). CLOSING a column the page covering the leaving edge shows nothing (0 pt in every take) and a wait there opens a strip (27 pt at 2 frames): no wait.
  // ACIRA_PAGE_LEAD_FRAMES=n (tests and rigs only) replaces the wait by n frames; 0 = none.
  const opening = slide && !own && (target.x - start.x >= 4 || (start.x + start.width) - (target.x + target.width) >= 4);
  const leadEnv = process.env.ACIRA_PAGE_LEAD_FRAMES, hasEnv = leadEnv !== undefined && leadEnv !== '';
  const leadMs = hasEnv ? Math.round(cadence * Math.max(0, Math.min(4, Number(leadEnv) || 0))) : Math.round(cadence * OPEN_LEAD_FRAMES);
  const lead = opening ? leadMs : 0;
  // D112: a view that grows SIDEWAYS with the docked sidebar's own slide (a close, a Mini collapse, either side) takes its steps on the display's refresh (REFRESH_AIM above). A glide on a spring of its own (an edge
  // reveal, a layout morph: the interface times itself against the page there) and a toolbar row leaving keep the steps they had: nothing was measured on them. Nor does the left side's held glide of a
  // heavy page (`exact`): with a resize every refresh its frames, the heavy ones, fell behind at the far edge (8 and 11 frames, 79 and 20 px, Wide and Standard, 2 real takes of 3; the timer's own steps: 2 frames).
  // A heavy page beside a sidebar on the right (`entry.sidewaysLive === false`) keeps them too: it is resized live on the timer's steps as on the release tip (D112-HEAVY, open: a held layout there
  // ended its strip but left the frame showing between it and the drawer; the cure is one clock with the drawer's picture).
  // D134: a switch the person made that WIDENS a light page it makes live (beside a sidebar on the left) takes them too, its top edge moving or not, its own spring or not: on the real window, 0 frames of
  // the page cut or short of its edge at 168, 240, 312 and Fast. Beside a sidebar on the RIGHT a switch keeps the timer's steps (not live: resized a step at a time as on the line): there the refresh's
  // steps left the page short of its moving edge at the start (1 to 3 frames, up to 27 pt, 2 takes of 3) where the line's own steps did 0 to 11 frames up to 12 pt. A switch that only grows the page's
  // height (the toolbar leaving: Hide the toolbar) keeps the timer's steps too: the toolbar's rise and landing (D118, D119, D123) were measured on them.
  const growing = slide && resizing && !opening && !exact && entry.sidewaysLive !== false && target.width > start.width && typeof clock.frameAge === 'function' && process.env.ACIRA_PAGE_REFRESH_LOCK !== '0'
    && (switching && live ? target.width - start.width >= SIDEWAYS : !own && Math.abs(start.y - target.y) < DROP);
  // D136: a live glide asks its page's frame clock at every frame too, to know when the page falls behind (LATE_REFRESHES, BEHIND_STEPS). (`__d136Undo`: rig only, the before on the same build: the share of a
  // core decides, and a narrowing holds at the size it has.)
  const judgeLate = (live || besideOpen) && typeof clock.frameAge === 'function' && globalThis.__d136Undo !== true;
  // An edge that gives room steps STEP_LAG_FRAMES display frames after its curve (below). ACIRA_PAGE_STEP_FRAMES=n and ACIRA_PAGE_LAND_FRAMES=n (tests and rigs only) set its steps' and its landing's lag in frames.
  const frames = (v, fallback) => v !== undefined && v !== '' ? Math.max(0, Math.min(4, Number(v) || 0)) : fallback;
  const stepLag = cadence * frames(process.env.ACIRA_PAGE_STEP_FRAMES, STEP_LAG_FRAMES), landLag = cadence * frames(process.env.ACIRA_PAGE_LAND_FRAMES, LAND_LAG_FRAMES);
  const current = {start, target, resizing, hold: hold && !exact};
  if (slide) entry.slideRun = current;
  let last = start, thin = false, strained = 0, probedAt = 0, degraded = false;
  if (heldFromStart) { degraded = true; holdLayout(entry, {width: target.width < start.width ? target.width : Math.max(start.width, target.width), height: target.height < start.height ? target.height : Math.max(start.height, target.height)}); }
  if (slide) clock.busy?.(entry.view.webContents);
  // The display's refresh as the page's own frames tell it: each answer is a refresh instant on this clock; the middle one of the last few (compared within one refresh) is used.
  let resizedAt = null, refresh = null, asking = false, locked = false, steppedFree = false, pageFrames = 0, framesAtResize = 0, lastAge = 0, skips = 0, grownAt = [], woke = false, rest = false; const answers = [];
  // D136: a frame of the page has answered since the view's last step (`answered`), steps in a row without one (`unanswered`), a frame that began LATE_REFRESHES late (`lateFrame`), the page cannot be asked (`noClock`).
  let answered = false, unanswered = 0, lateFrame = false, noClock = !judgeLate;
  // A step at its instant: to the instant where the clock can (`clock.at`), else the clock's timer.
  const stepAt = instant => typeof clock.at === 'function' ? clock.at(frame, instant) : clock.later(frame, Math.max(1, instant - clock.now()));
  const askRefresh = () => {
    if (!(growing || (judgeLate && !noClock && !degraded)) || asking || entry.slideRun !== current) return;
    let answer; try { answer = clock.frameAge(entry.view.webContents); } catch { noClock = true; return; }
    if (!answer || typeof answer.then !== 'function') { noClock = true; return; }
    asking = true;
    answer.then(age => {
      asking = false;
      if (entry.slideRun !== current) return;
      pageFrames++; lastAge = Number.isFinite(age) && age >= 0 ? age : 0;
      answered = true; if (lastAge > LATE_REFRESHES * cadence) lateFrame = true;
      if (growing && Number.isFinite(age) && age >= 0 && age < 1000) {
        answers.push(clock.now() - age); if (answers.length > REFRESH_SAMPLES) answers.shift();
        // the middle one of the last few, each taken within half a refresh of the newest (a frame's own time stands up to 3 ms early or late now and then)
        const newest = answers[answers.length - 1], around = answers.map(at => { let off = ((at - newest) % cadence + cadence) % cadence; if (off > cadence / 2) off -= cadence; return off; }).sort((a, b) => a - b);
        const first = refresh === null; refresh = newest + (around.length % 2 ? around[(around.length - 1) / 2] : (around[around.length / 2 - 1] + around[around.length / 2]) / 2);
        // The first answer: the step that was waiting for the timer's own instant is moved to its place on the refresh (this refresh's, if that place is still to come).
        if (first && !locked && !steppedFree && entry.boundsTimer) {
          const now = clock.now(), place = refresh + (Math.ceil((now + .5 - refresh) / cadence - REFRESH_AIM) + REFRESH_AIM) * cadence;
          cancelStep(clock, entry.boundsTimer); locked = true; entry.boundsTimer = stepAt(place);
        }
      }
      askRefresh();
    }, () => { asking = false; noClock = true; });
  };
  // The instant of the next step: the nominal one, moved to its place in a refresh AFTER the one this turn runs in (never two steps in one refresh). After steps that were taken on the timer alone (a page that answered late)
  // the first step placed this way leaves one refresh empty before it: those stood anywhere in their refresh, and a page left a step behind by them only catches up in a refresh that brings no resize.
  // And never closer than STEP_ROOM of a refresh to the last resize: a step that fired late (main busy) stood at the end of its refresh, and the next one on time came 4.8 ms after it, both in one frame of the page.
  const onRefresh = nominal => { if (refresh === null) return nominal; let index = Math.max(Math.floor((clock.now() - refresh) / cadence) + (locked || !steppedFree ? 1 : 2), Math.floor((nominal - refresh) / cadence)); if (resizedAt !== null && refresh + (index + REFRESH_AIM) * cadence - resizedAt < STEP_ROOM * cadence) index++; locked = true; return refresh + (index + REFRESH_AIM) * cadence; };
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
    // An edge that gives room lands LAND_LAG later than its curve's end: until then it stands on its last point (only while `landLag` holds it; nothing else of the glide waits).
    const holding = opening && landLag > 0 && progress >= 1 && elapsed < duration + landLag;
    const easedAfter = wait => !wait ? eased : progress >= 1 ? 1 : elapsed <= wait ? 0 : springAt(own, Math.min(settleMs, elapsed - wait) / 1000);
    const easedX = easedAfter(edgeLag.x), easedY = easedAfter(edgeLag.y);
    const before = Math.max(0, elapsed - stepLag), easedThen = wait => progress >= 1 ? 1 : own ? (!wait ? (before <= 0 ? 0 : springAt(own, Math.min(settleMs, before) / 1000)) : before <= wait ? 0 : springAt(own, Math.min(settleMs, before - wait) / 1000)) : slide ? spring(before / duration) : 1 - Math.pow(1 - before / duration, 3);
    const thenX = easedThen(edgeLag.x), thenY = easedThen(edgeLag.y);
    // D74: within one point of its place an edge is IN its place. Rounded to the nearest point, an edge stood one point short while the spring settled inside its last point (it settles to 0.4 %: 1 pt of
    // a 240 pt travel): the page 1 pt from the window's edge for the tail of a close, a dark line on a bright page for up to 250 ms.
    // D93 (19 Nov): but only where landing early COVERS the chrome it meets. An edge moving the other way (the page giving room to chrome that arrives: a dock, a toolbar coming back) that landed
    // early stood up to a point AHEAD of the arriving edge, and the card's dark fill under the page showed between them: a dark line 1 to 2 px wide along the page's edge and round its top corner
    // at the end of a dock (+367 to +433 ms at Standard, 19 to 24 levels). There the edge is rounded toward the chrome (never ahead of where the curve puts it) and lands with the curve.
    // `cover` is the way an edge grows the page: -1 for the left and top edges, +1 for the right and bottom.
    // (A move that keeps the page's size keeps it in every frame: the far edge is the near one plus the size.)
    // ONE RULE ON THE SCREEN'S CLOCK for an edge that gives room (D93, D97, D89; 19 Nov): it follows the arriving chrome's DRAWN edge. The page already waits OPEN_LEAD_FRAMES so that its curve
    // stands with the interface's pictures on the screen; a picture that comes a frame late stood a fraction short of a page that had just taken a whole point: one frame of the card's dark fill
    // as a 1 device px line beside the page (D97, docks with the minimal sidebar, 3 of 4; and the first D89 sightings at the Mini expand's 238 -> 239 step). So its whole-point steps are taken
    // STEP_LAG_FRAMES DISPLAY FRAMES LATER on the curve (where the curve stood that long before; at Wide one frame was not always enough), rounded toward the chrome, and it lands a frame after the curve's end, when the drawn edge does (an earlier landing on main's own clock,
    // a quarter point short, uncovered the sidebar's last device pixel for 2 to 3 frames in every Mini expand: the interface's picture reaches the screen ~2.5 frames after main's setBounds).
    const edge = (a, b, e, cover, then) => { const at = a + (b - a) * e; if (e >= 1) return holding && (b - a) * cover < 0 ? (cover < 0 ? Math.floor(b - 1e-6) : Math.ceil(b + 1e-6)) : b; if ((b - a) * cover >= 0) return Math.abs(b - at) < 1 ? b : Math.round(at); const was = a + (b - a) * Math.min(e, then); return cover < 0 ? Math.floor(was + 1e-6) : Math.ceil(was - 1e-6); },
      left = edge(from.x, to.x, easedX, -1, thenX), top = edge(from.y, to.y, easedY, -1, thenY),
      right = from.width === to.width ? left + to.width : edge(from.x + from.width, to.x + to.width, easedX, 1, thenX), bottom = from.height === to.height ? top + to.height : edge(from.y + from.height, to.y + to.height, easedY, 1, thenY);
    let bounds = {x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top)};
    if (current.hold) {
      if (Math.abs(left - to.x) <= LANDED && Math.abs(top - to.y) <= LANDED) progress = 1;
      bounds = progress >= 1 && !holding ? {...to} : {x: left, y: top, width: Math.max(from.width, to.width), height: rising ? Math.max(1, bottom - top) : Math.max(from.height, to.height)};
      if (dissolve && !early && !cover && !landed && eased >= PRELAND) beginCover();
      if (progress >= 1 && dissolve && !early && !landed) {
        // A narrowing has landed: the page still holds its old layout, which is what the picture shows. The glide goes on (the page
        // keeps its held size) until the picture stands, bounded; then the page takes its final size under it.
        if (!cover) beginCover();
        nearAt ??= elapsed;
        if (cover && !ready && elapsed - nearAt < LAND_WAIT) {
          const hold = {x: left, y: top, width: Math.max(from.width, to.width), height: rising ? Math.max(1, bottom - top) : Math.max(from.height, to.height)};
          if (Object.keys(hold).some(key => hold[key] !== last[key])) { entry.view.setBounds(hold); entry.onBounds?.(hold); last = hold; }
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
    // A view that grows (REFRESH_AIM and PAGE_LATE above), in this order: no step before the page's first answer (REFRESH_FIRST_WAIT refreshes at most); the first one a single point, late page or not, and none in the refresh after it;
    // none in a refresh the page is late in (STEP_SKIPS in a row at most).
    if (growing && progress < 1 && (bounds.width !== last.width || bounds.height !== last.height)) {
      const stay = () => { bounds = {x: last.x, y: last.y, width: last.width, height: last.height}; };
      if (!locked) { if (!steppedFree && elapsed < REFRESH_FIRST_WAIT * cadence) stay(); }
      else if (!woke) { const near = (from, to) => from + Math.max(-1, Math.min(1, to - from)), l = near(last.x, bounds.x), t = near(last.y, bounds.y), r = near(last.x + last.width, bounds.x + bounds.width), b = near(last.y + last.height, bounds.y + bounds.height); bounds = {x: l, y: t, width: r - l, height: b - t}; rest = true; }
      else if (rest) { rest = false; stay(); }
      else if ((pageFrames <= framesAtResize || lastAge > PAGE_LATE * cadence) && skips < STEP_SKIPS) { skips++; stay(); }
    }
    if (Object.keys(bounds).some(key => bounds[key] !== last[key])) { if (cover && !watching && (bounds.width !== last.width || bounds.height !== last.height)) watchLayout(); if (growing && !locked) steppedFree = true; if (growing && (bounds.width !== last.width || bounds.height !== last.height)) { woke = true; grownAt.push(clock.now()); skips = 0; framesAtResize = pageFrames; resizedAt = clock.now(); } if (judgeLate && !noClock && !degraded && (bounds.width !== last.width || bounds.height !== last.height)) { unanswered = answered ? 0 : unanswered + 1; answered = false; } entry.view.setBounds(bounds); entry.onBounds?.(bounds); last = bounds; }
    if ((exact || degraded || keepHeld) && progress >= 1 && !holding) releaseLayoutAfter(entry, clock);
    if (hasRadius) { const goal = entry.radiusGoal ?? Math.round(radius); applyRadius(entry, progress >= 1 ? goal : fromRadius + (goal - fromRadius) * Math.min(1, Math.max(0, eased))); if (progress >= 1 && !holding) entry.radiusGoal = undefined; }
    if (progress < 1 || holding) {
      // A live glide whose page falls behind goes on with one layout: smooth frames, nothing laid out again until the landing. A widening holds at its final size (the page's far end is cut and comes into
      // view with the glide). D136: a narrowing holds at its FINAL size too (the page stands short of its edge by a strip of its own colour that closes as the view narrows; nothing is cut and nothing is
      // laid out again at the landing). Held at the size it had (before D136), its right end was cut more and more and the page re-wrapped when it landed (the sidebar opening: 27 to 31 frames, up to 134 pt).
      const fallback = () => globalThis.__d136Undo === true ? {width: Math.max(last.width, to.width), height: Math.max(last.height, to.height)}
        : {width: to.width < from.width ? to.width : Math.max(last.width, to.width), height: to.height < from.height ? to.height : Math.max(last.height, to.height)};
      const narrowing = to.width < from.width || to.height < from.height;
      if (judgeLate && !noClock && !degraded && ((lateFrame && narrowing) || unanswered >= BEHIND_STEPS)) { degraded = true; holdLayout(entry, fallback()); if (globalThis.__d136OpenUndo !== true) entry.fellBehind = address(); }
      else if (slide && current.resizing && !current.hold && !degraded && clock.busy && (!live || noClock) && elapsed - probedAt >= (live ? LIVE_PROBE : BUSY_EVERY)) {
        probedAt = elapsed; strained = clock.busy(entry.view.webContents) >= BUSY ? strained + 1 : 0;
        if (strained >= 2) { if (live) { degraded = true; holdLayout(entry, fallback()); } else thin = true; }
      }
      const step = thin ? Math.max(cadence, THIN_GAP) : cadence, deadline = lead + Math.min(holding ? duration + landLag : duration, (Math.floor(elapsed / step) + 1) * step);
      entry.boundsTimer = growing && refresh !== null ? stepAt(onRefresh(started + deadline)) : clock.later(frame, Math.max(1, deadline - (clock.now() - started)));
    } else {
      // D136 (14.3): a widening that kept up decides again (REMEMBER_REFRESHES above): remembered when it drew at that pace or slower, forgotten when faster.
      if (growing && !degraded && grownAt.length >= REMEMBER_STEPS && globalThis.__d136OpenUndo !== true) entry.fellBehind = medianGap(grownAt) >= REMEMBER_REFRESHES * cadence ? address() : undefined;
      if (entry.slideRun === current) entry.slideRun = null;
    }
  };
  if (dissolve && early && beginCover({width: Math.max(start.width, target.width), height: Math.max(start.height, target.height)})) sized = false;
  askRefresh();
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
  if (entry.boundsTimer) { cancelStep(clock, entry.boundsTimer); entry.boundsTimer = null; }
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
  entry.onBounds?.(target);
  if (Number.isFinite(radius)) { applyRadius(entry, radius); entry.radiusGoal = undefined; }
}
/** The interface's movement has ended (a layout without the hold reached this page): its layout is let go once the last rectangle has reached the page. */
function endLive(entry, clock) {
  if (!entry.liveHold) return;
  entry.liveHold = false;
  if (entry.layoutHold) releaseLayoutAfter(entry, clock); else if (entry.releaseTimer) { clock.cancel(entry.releaseTimer); entry.releaseTimer = null; }
}
/** `clock.at` for a real clock (D112): `fn` at `instant` on performance.now()'s clock, to a fraction of a millisecond: a timer to 2.5 ms before it, then the loop's own turns (setImmediate, which lets every other event through)
 * until the instant has come. The handle cancels itself (`cancelStep`). */
function stepAtInstant(fn, instant) {
  const handle = {timer: null, turn: null, over: false, cancel() { handle.over = true; if (handle.timer) clearTimeout(handle.timer); if (handle.turn) clearImmediate(handle.turn); handle.timer = handle.turn = null; }};
  const poll = () => { handle.turn = null; if (handle.over) return; if (performance.now() >= instant) { handle.over = true; fn(); } else handle.turn = setImmediate(poll); };
  handle.timer = setTimeout(() => { handle.timer = null; poll(); }, Math.max(0, instant - performance.now() - 2.5));
  return handle;
}
/** `clock.frameAge` for a real page (D112, REFRESH_AIM): how long ago, in ms, the page's current frame began, by the page's own clock (requestAnimationFrame's time against performance.now(), both read in the page, so no two
 * processes' clocks are compared). Asked in the isolated world Acira's own reads of a page run in (2078); it resolves at the page's next frame, and never for a page that draws none. null when the page cannot be asked. */
const FRAME_AGE_WORLD = 2078, FRAME_AGE = 'new Promise(r=>requestAnimationFrame(t=>r(performance.now()-t)))';
function pageFrameAge(webContents) {
  try {
    if (!webContents || webContents.isDestroyed?.() || typeof webContents.executeJavaScriptInIsolatedWorld !== 'function') return null;
    return Promise.resolve(webContents.executeJavaScriptInIsolatedWorld(FRAME_AGE_WORLD, [{code: FRAME_AGE}], false));
  } catch { return null; }
}
module.exports = {SPRING, pageFrameAge, stepAtInstant, REFRESH_AIM, placePageBounds, placeLive, endLive, applyRadius, springAt, springSettle, layoutPace, holdLayout, releaseLayout, releaseLayoutAfter, canHoldLayout, FAST_PACE, LIVE_QUIET, RELEASE_QUIET};
