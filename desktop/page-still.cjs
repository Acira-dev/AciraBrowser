'use strict';
// Switching workspaces (round 3, motion fix): a website's native view cannot fade, so it used to vanish in one frame and the
// page area sat empty (near-black in dark) until the next page, or its new-tab art, arrived. The outgoing page now leaves as a
// still: its picture is taken the moment the switch is asked for, laid over the page area in a transparent native layer (the
// same kind of layer the centred-panel scrim uses), the page views swap beneath it, and the still fades out on the workspace
// crossfade's length (a dissolve curve, not the crossfade's fast-out: the new page's own art rises at an even pace), so the old page dissolves into the new one. Off (reduced motion) never gets here.
// The page swap waits for the still, bounded: a slow capture, or a still that cannot be made, falls back to the old instant swap.
// The dissolve runs a little longer than the crossfade (1.3x) so it still carries the page while the incoming page's own art finishes arriving.
const DISSOLVE_STRETCH = 1.3;
const HOLD_MAX_MS = 120, SETTLE_MS = 32, FADE_MS = 130, RELEASE_MS = 20000, MAX_WIDTH = 1600, AWAIT_SWAP_MS = 500;
// Round 4 (new tab -> website): the interface draws the new tab page, and the moment a website replaces it the interface has already
// dropped it (the tab switch is applied on the input frame), so there is nothing left to capture. Instead a picture of the settled new
// tab page is kept ready (primed) in this layer, painted and parked just outside the window, and the switch only moves it over the page
// area: no capture, no decode, no first paint on the switch path, so it lands on the same frame as the switch. The website appears
// beneath it and the picture dissolves on the house crossfade (130 ms x speed scale). A navigation holds the picture until the new
// page has painted (bounded), so a page that has not drawn yet never shows as a white or dark frame.
const PRIME_MAX_WIDTH = 2560, PRIME_QUALITY = 92, SHOWN_SETTLE_MS = 34, NAV_HOLD_MS = 450;
/** Runs in the interface (main sends it as `(${uiAtRest})()`): true when nothing of the window's frame is in motion. A picture of the
 * new tab page is only worth keeping if it is of the page at rest: taken while the sidebar glides (the layout view transition, the page
 * content held in its old box by followPage), it shows the page displaced by the sidebar's width beside a bare strip of the page card,
 * and a navigation in the next second laid that over the website (founder, 1 Nov: a flat grey panel as wide as the sidebar, the new tab
 * page cut off behind it). The bounds the picture is keyed to are the glide's final ones from its first frame, so the key cannot tell. */
function uiAtRest() {
  const root = document.documentElement;
  for (const name of ['data-mode-switch', 'data-page-live', 'data-fr-switch', 'data-theme-settle', 'data-edge-snapshot']) if (root.hasAttribute(name)) return false;
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running' && animation.playState !== 'pending') continue;
    const effect = animation.effect; if (!effect) continue;
    if (effect.pseudoElement && String(effect.pseudoElement).indexOf('::view-transition') === 0) return false;
    const timing = effect.getComputedTiming && effect.getComputedTiming();
    if (!timing || !Number.isFinite(timing.endTime) || timing.endTime > 3000) continue;
    const target = effect.target;
    if (target && target.closest && target.closest('.ed-rail, .browser-toolbar, .page-area')) return false;
  }
  return true;
}
const parked = rect => ({ x: -rect.width - 64, y: rect.y, width: rect.width, height: rect.height });
const roundRect = rect => ({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
const BASE = 'html,body{height:100%;margin:0;background:rgb(0 0 0 / 0)}html{background-repeat:no-repeat;background-position:top left;background-size:100% 100%}';

function createPageStill({ WebContentsView, getWindow, later = (fn, ms) => setTimeout(fn, ms) }) {
  let view = null, ready = null, hideTimer = null, releaseTimer = null, version = 0, job = null, cssKey = null, primed = null, primeSeq = 0, fadeKey = null;
  const queued = new Map();
  let disposed = false;
  const live = () => view && !view.webContents.isDestroyed();
  const wait = ms => new Promise(resolve => later(resolve, ms));

  function ensure() {
    if (disposed) return null;
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (!live()) {
      cssKey = null;
      view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, partition: 'acira-page-still' } });
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const contents = view.webContents;
      ready = new Promise(resolve => contents.once('did-finish-load', () => { contents.insertCSS(BASE).then(resolve, resolve); }));
      contents.loadURL('data:text/html,<body>').catch(() => {});
      // A press on a covering picture ends it at once and goes on to the page beneath, so the dissolve never eats a click or a scroll.
      contents.on?.('before-mouse-event', (event, mouse) => {
        const j = job; if (!j || !j.cover || !mouse) return;
        const press = mouse.type === 'mouseDown' || mouse.type === 'mouseWheel';
        if (!(press && !j.hidden) && !(mouse.type === 'mouseUp' && j.pressed)) return;
        event.preventDefault?.();
        if (press) { j.hidden = true; j.pressed = mouse.type === 'mouseDown'; if (live()) view.setVisible(false); } else j.pressed = false;
        const target = j.target?.(); if (target && !target.isDestroyed()) { try { target.sendInputEvent({ ...mouse }); } catch { /* the page closed */ } }
      });
    }
    return view;
  }
  /** Run every page swap that is waiting. A swap is never dropped: a still that goes stale, is abandoned or released still lets the
   * pages beneath it change, or the page the layout shows stays hidden (R5). */
  function flush() {
    const runs = [...queued.values()]; queued.clear();
    for (const run of runs) { try { run(); } catch { /* a closed page */ } }
    return runs.length;
  }
  function release() {
    clearTimeout(hideTimer); clearTimeout(releaseTimer); hideTimer = releaseTimer = null; ++version; job = null; flush();
    if (live()) { try { getWindow()?.contentView.removeChildView(view); } catch { /* the window is closing */ } view.webContents.close(); }
    view = null; ready = null; cssKey = null; primed = null; fadeKey = null; ++primeSeq;
  }
  // Releasing an active transition must flush swaps; a destroyed owner must
  // discard them and reject delayed captures from recreating its layer.
  function destroy() { disposed = true; queued.clear(); release(); }
  /** The pages have swapped under the still (or there was nothing to swap): start its fade and schedule its removal. */
  function leave(j) {
    if (j.left || !j.shown || j.abandoned || !live()) return;
    j.left = true;
    const contents = view.webContents, mine = version;
    contents.insertCSS(`html{opacity:0!important;transition:opacity ${j.ms}ms cubic-bezier(.3,0,.2,1)!important}`).then(key => { if (mine === version) fadeKey = key; }, () => {});
    hideTimer = later(() => { if (mine === version && live()) view.setVisible(false); }, j.ms + 60);
    releaseTimer = later(() => { if (mine === version) release(); }, RELEASE_MS); releaseTimer?.unref?.();
  }
  /** The capture is done (or gave up): run the swaps that waited, and let the still go once they have run. */
  function finish(j) {
    if (job !== j) return;
    j.ready = true;
    const ran = flush();
    if (job !== j) return; // a released swap may have started another transition
    // setVisible(true) precedes the first-frame wait. The hold deadline can land
    // in that wait, while shown is still false: remove the current picture as
    // well as any previous one, invalidate late work, and let priming resume.
    if (!j.shown) {
      ++version; job = null;
      if (live()) {
        view.setVisible(false);
        const mine = version;
        releaseTimer = later(() => { if (mine === version) release(); }, RELEASE_MS); releaseTimer?.unref?.();
      }
      return;
    }
    if (ran) leave(j); else later(() => { if (job === j) leave(j); }, AWAIT_SWAP_MS);
  }

  /** Lay the still over `bounds` with the picture. Resolves once the still has had a frame to paint. */
  async function show(jpeg, bounds, j, mine) {
    const layer = ensure(); if (!layer) return;
    const contents = layer.webContents; await ready;
    const stale = () => mine !== version || j.abandoned || contents.isDestroyed();
    if (stale()) return;
    const win = getWindow(); if (!win || win.isDestroyed()) return;
    clearTimeout(hideTimer); clearTimeout(releaseTimer);
    // Held at full opacity first: the still is on screen before the pages beneath swap.
    const previous = cssKey;
    cssKey = await contents.insertCSS(`html{background-image:url(data:image/jpeg;base64,${jpeg.toString('base64')})!important;opacity:1!important;transition:none!important}`).catch(() => null);
    if (previous) contents.removeInsertedCSS(previous).catch(() => {});
    if (stale()) return;
    layer.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
    if (win.contentView.children.at(-1) !== layer) win.contentView.addChildView(layer);
    layer.setVisible(true);
    await wait(SETTLE_MS);
    if (stale()) return;
    j.shown = true;
  }

  /** The switch was asked for: take the outgoing page's picture. `pageView` is the page's native view. */
  function begin(pageView, { scale = 1.7, stretch = DISSOLVE_STRETCH } = {}) {
    if (disposed || !pageView || pageView.webContents.isDestroyed()) return;
    // A still still being made is abandoned for this one: the swaps it held run now (under its picture, if it is up), not later.
    // An earlier picture that is up (waiting for its swap, or fading) is taken over by this still: if this one cannot be made, it comes down.
    const covering = !!job && !!job.shown;
    if (job && !job.ready) { job.abandoned = true; job.ready = true; flush(); }
    const contents = pageView.webContents, bounds = pageView.getBounds(), mine = ++version;
    primed = null; ++primeSeq;
    const j = job = { ready: false, shown: false, abandoned: false, left: false, covering, ms: Math.round(FADE_MS * scale * stretch) };
    (async () => {
      try {
        let image = await contents.capturePage();
        if (mine !== version || j.abandoned || image.isEmpty()) return;
        if (image.getSize().width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH, quality: 'good' });
        const jpeg = image.toJPEG(82);
        if (jpeg && jpeg.length) await show(jpeg, bounds, j, mine);
      } catch { /* no still: the swap is instant, as it was */ }
      finally { if (job === j && !j.ready) finish(j); }
    })();
    later(() => { if (job === j && !j.ready) { j.abandoned = !j.shown; finish(j); } }, HOLD_MAX_MS);
  }

  /** A page view is about to be shown or hidden. While a still is being made the change waits (latest per page wins) so the swap lands under it. */
  function flip(entry, run, showing = false) {
    if (disposed) return;
    if (job && !job.ready) { queued.set(entry, run); return; }
    run();
    if (job && job.cover) { if (showing && !job.swapped) { const j = job; later(() => { j.swapped = true; settle(j); }, SHOWN_SETTLE_MS); } return; }
    if (job && job.ready && job.shown) leave(job);
  }

  /** A covering picture leaves once a page is showing beneath it and (for a navigation) that page has painted. */
  function settle(j) { if (j === job && j.swapped && j.held) leave(j); }

  /** Keep a picture of `rect` in `contents` (the interface's settled new tab page) ready in the layer, painted and parked outside the
   * window. `key` names what it shows (tab, size, appearance); cover() only uses a picture whose key still matches.
   * `rest` (async, true when the interface is at rest: uiAtRest) is asked before the capture and again after it: a picture taken while
   * the frame moves is never kept, whatever its key says. Resolves true (kept), false (not made), or 'moving' (the interface was in
   * motion: ask again a moment later). */
  async function prime(contents, rect, key, { rest = null } = {}) {
    if (disposed || !contents || contents.isDestroyed() || (job && !job.left) || !rect || rect.width < 2 || rect.height < 2) return false;
    const mine = ++primeSeq, area = roundRect(rect);
    try {
      if (rest && !(await rest())) return 'moving';
      if (mine !== primeSeq) return false;
      let image = await contents.capturePage(area);
      if (mine !== primeSeq || (job && !job.left) || image.isEmpty()) return false;
      if (rest && !(await rest())) return 'moving';
      if (mine !== primeSeq) return false;
      if (image.getSize().width > PRIME_MAX_WIDTH) image = image.resize({ width: PRIME_MAX_WIDTH, quality: 'best' });
      const jpeg = image.toJPEG(PRIME_QUALITY); if (!jpeg || !jpeg.length) return false;
      const layer = ensure(); if (!layer) return false;
      const layerContents = layer.webContents; await ready;
      if (mine !== primeSeq || (job && !job.left) || layerContents.isDestroyed()) return false;
      const previous = cssKey, fade = fadeKey;
      cssKey = await layerContents.insertCSS(`html{background-image:url(data:image/jpeg;base64,${jpeg.toString('base64')})!important;opacity:1!important;transition:none!important}`).catch(() => null);
      if (previous) layerContents.removeInsertedCSS(previous).catch(() => {});
      if (fade) { fadeKey = null; layerContents.removeInsertedCSS(fade).catch(() => {}); }
      const win = getWindow();
      if (!cssKey || mine !== primeSeq || (job && !job.left) || !win || win.isDestroyed()) return false;
      clearTimeout(hideTimer); clearTimeout(releaseTimer); hideTimer = releaseTimer = null; ++version; job = null;
      layer.setBounds(parked(area));
      if (!win.contentView.children.includes(layer)) win.contentView.addChildView(layer);
      layer.setVisible(true);
      primed = { key, rect: area };
      return true;
    } catch { return false; }
  }

  /** The new tab page is being replaced by a website: move the primed picture over the page area now (synchronously, no capture), let the
   * page appear beneath it, and dissolve. `until` (a navigation) holds the picture until the page has painted, bounded by NAV_HOLD_MS.
   * `target` is the arriving page's contents (a press on the picture goes on to it). Returns false when no matching picture is ready. */
  function cover({ key, scale = 1.7, until = null, target = null, above = null } = {}) {
    const win = getWindow();
    if (!primed || primed.key !== key || !live() || (job && !job.left) || !win || win.isDestroyed()) return false;
    const layer = view, rect = primed.rect; primed = null; ++primeSeq;
    clearTimeout(hideTimer); clearTimeout(releaseTimer); hideTimer = releaseTimer = null; ++version;
    const j = job = { ready: true, shown: true, abandoned: false, left: false, cover: true, swapped: false, held: !until, hidden: false, pressed: false, target, ms: Math.round(FADE_MS * scale) };
    // Over the pages and the interface, under any popup or panel layer (`above` names the slot among the window's other layers).
    const others = win.contentView.children.filter(child => child !== layer), at = typeof above === 'function' ? above(others) : others.length;
    if (win.contentView.children.indexOf(layer) !== at) win.contentView.addChildView(layer, Math.max(0, Math.min(others.length, at)));
    layer.setBounds(rect);
    layer.setVisible(true);
    if (until) Promise.resolve(until).then(() => { j.held = true; settle(j); }, () => { j.held = true; settle(j); });
    // Bounded: the picture never outstays a page that will not paint, or a swap that never comes.
    later(() => { j.held = true; settle(j); }, NAV_HOLD_MS);
    later(() => { if (job === j && !j.swapped) { j.swapped = true; settle(j); } }, AWAIT_SWAP_MS);
    return true;
  }

  /** The new tab page is no longer on screen: forget the picture and let the layer go after a while. */
  function drop() {
    if (job && !job.left) return;
    if (primed || live()) ++primeSeq;
    primed = null;
    if (live() && !job) { view.setVisible(false); clearTimeout(releaseTimer); const mine = version; releaseTimer = later(() => { if (mine === version) release(); }, RELEASE_MS); releaseTimer?.unref?.(); }
  }

  return { begin, flip, prime, cover, drop, release, destroy, get holding() { return !!job && !job.ready; }, get primedKey() { return primed?.key ?? null; } };
}

/** A page view should be shown (`visible`) or hidden: route the change through the stills (`outer` first, the workspace still, then
 * `inner`, the new tab still), which hold it while a picture is being made; `apply(visible)` changes the view itself.
 * R5 (founder: "when I switch between tabs the page is completely empty though YouTube is playing; it only appears after I open and
 * close the sidebar"): the change is measured against what was last asked for the page, not only against the view's own state.
 * A change waiting in a still has not reached the view yet, so a switch taken back while the still is being made (website -> new tab
 * page -> the same website, Ctrl+Tab tapped twice) found the view still shown, asked for nothing, and the waiting hide ran after the
 * return: the active page stayed hidden until the next layout change. Now the return replaces the waiting change. Returns true when
 * a change was routed. */
function presentPage(entry, visible, { outer, inner, apply }) {
  const shown = entry.view.getVisible(), asked = typeof entry.askedVisible === 'boolean' ? entry.askedVisible : shown;
  if (shown === visible && asked === visible) return false;
  entry.askedVisible = visible;
  outer.flip(entry, () => inner.flip(entry, () => apply(visible), visible));
  return true;
}

module.exports = { createPageStill, presentPage, uiAtRest, HOLD_MAX_MS, FADE_MS, DISSOLVE_STRETCH, NAV_HOLD_MS, SHOWN_SETTLE_MS, AWAIT_SWAP_MS };
