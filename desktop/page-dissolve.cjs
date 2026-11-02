'use strict';
// The docked sidebar opening or closing (and the toolbar rows going or coming as the view enters or leaves Seamless) lays the page
// out once, and page-motion.cjs keeps that layout off the glide (a held slide). That one re-wrap still landed as a cut, and on a slow
// page the old layout stood beside a bare strip until it did. Here it is dissolved: a picture of the page as it stood is laid over
// it in a transparent native layer (the kind page-still.cjs uses), the page takes its new layout beneath, and the picture fades out
// once the page has drawn it. Never a blur or a matte, and the glide itself is never slowed: the picture only outlasts it.
//
//   const cover = dissolve.begin(pageView)    // reads the page's surface now
//   await cover.ready                         // true: the picture is painted in the layer, parked outside the window
//   cover.show(bounds, radius)                // over the page, where the page's old layout is (again each frame, to follow it)
//   cover.release(done)                       // fades the picture once `done` (the page has laid out) has settled
//   cover.drop()                              // gone at once
// Nothing here is needed: a picture that cannot be made, or arrives after the page has laid out, leaves the slide as it was.
// OFF by default (desktop/main.cjs, ACIRA_DISSOLVE=1 turns it on): fading through the page background made the whole page, a playing video
// included, blink to the background mid-glide (on YouTube the page's brightness went 16-18% above both ends for 2-3 frames), and the
// cross-dissolve it replaced showed every line twice. The single re-layout stays a cut.
const FADE_MS = 140, READY_MAX_MS = 320, PAINT_MS = 20, SETTLE_MS = 17, POLL_MS = 50, POLL_MAX_MS = 420, HOLD_MAX_MS = 700, EXPIRY_MS = 2000, LAID_OUT_MAX_MS = 1500, RELEASE_MS = 15000, QUALITY = 84, OUT_SHARE = .4, IN_SHARE = .85;
const parked = rect => ({ x: -rect.width - 64, y: 0, width: rect.width, height: rect.height });
const rounded = rect => ({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
const BASE = 'html,body{height:100%;margin:0;background:rgb(0 0 0 / 0)}';
/** The layer is two child elements, set once per picture: `b` (the page's own background, covering the layer's whole area) holding `p` (the
 * picture, at the size the page had, at the top left). Their own style, not stacked style sheets (those did not reliably cascade in the
 * order they were added, and a later picture stayed transparent), and not the root (a root's background is painted on the canvas,
 * which an opacity does not fade). */
const STILL = (jpeg, size, color) => `{ let back = document.getElementById('b'); if (!back) { back = document.createElement('div'); back.id = 'b'; back.innerHTML = '<div id=p></div>'; document.body.appendChild(back); }
  back.style.cssText = 'position:fixed;inset:0;background:${color};opacity:1;transition:none';
  document.getElementById('p').style.cssText = 'position:absolute;left:0;top:0;width:${size.width}px;height:${size.height}px;background:url(data:image/jpeg;base64,${jpeg}) 0 0/100% 100% no-repeat;opacity:1;transition:none'; 1 }`;
const CLEAR = `document.getElementById('b')?.remove(); 1`;
/** Fade through the page's background, never across: the picture fades out over the background first, then the background fades out
 * over the page (which has laid out beneath), so at no moment are the old layout and the new one both on screen. A cross-dissolve of two
 * different wraps of the same text shows every line twice at its middle, and that reads as a glitch (a founder's photo, 1 Nov). */
const FADE = (out, into) => `{ const picture = document.getElementById('p').style, back = document.getElementById('b').style;
  picture.transition = 'opacity ${out}ms linear'; picture.opacity = '0';
  back.transition = 'opacity ${into}ms cubic-bezier(0,0,.2,1) ${out}ms'; back.opacity = '0'; 1 }`;
/** The page's own background, read down the right-hand edge of its picture (the middle value of each channel): where the layer is
 * larger than the picture (a widening: the page's final area is wider than its old layout was) this fills the rest, so the whole area
 * dissolves together and no strip of the new layout shows beside the old one. */
function edgeColor(image) {
  try {
    const { width, height } = image.getSize(), bitmap = image.crop({ x: Math.max(0, width - 3), y: 0, width: 1, height }).toBitmap(), rows = [];
    for (let i = 0; i < 33; i++) { const at = Math.min(height - 1, Math.round((i + .5) * height / 33)) * 4; rows.push([bitmap[at + 2], bitmap[at + 1], bitmap[at]]); }
    const mid = channel => rows.map(row => row[channel]).sort((a, b) => a - b)[rows.length >> 1];
    return `rgb(${mid(0)},${mid(1)},${mid(2)})`;
  } catch { return 'transparent'; }
}
/** A picture's luminance at 96 x 48: how much it shows (its spread) and how far two of them differ (their mean gap). */
const THUMB = { width: 96, height: 48 };
function luminance(image) {
  const bitmap = image.resize({ ...THUMB, quality: 'good' }).toBitmap(), out = new Float32Array(THUMB.width * THUMB.height);
  for (let i = 0; i < out.length; i++) out[i] = bitmap[i * 4 + 2] * .3 + bitmap[i * 4 + 1] * .59 + bitmap[i * 4] * .11;
  return out;
}
const spread = values => { let mean = 0; for (const v of values) mean += v; mean /= values.length; let sum = 0; for (const v of values) sum += (v - mean) * (v - mean); return Math.sqrt(sum / values.length); };
const gap = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; };
/** Runs in the page: resolves a couple of frames after the page has next been resized, which is when its new layout is on its way to
 * the screen (false when no resize comes in time). Registered before the page changes size, so it cannot miss the resize. */
const LAID_OUT = `new Promise(done => { const finish = () => requestAnimationFrame(() => requestAnimationFrame(() => done(true))); addEventListener('resize', finish, { once: true, capture: true }); setTimeout(() => done(false), ${LAID_OUT_MAX_MS}); })`;

function createPageDissolve({ WebContentsView, getWindow, above = null, fadeMs = () => FADE_MS, later = (fn, ms) => setTimeout(fn, ms), now = () => performance.now(), trace = null }) {
  let layer = null, loaded = null, releaseTimer = null, cover = null, disposed = false, seq = 0;
  const live = () => layer && !layer.webContents.isDestroyed();
  const wait = ms => new Promise(resolve => later(resolve, ms));

  function ensure() {
    if (disposed) return null;
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (!live()) {
      
      layer = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'acira-page-dissolve' } });
      layer.setBackgroundColor('#00000000'); layer.setVisible(false);
      const contents = layer.webContents;
      loaded = new Promise(resolve => contents.once('did-finish-load', () => { contents.insertCSS(BASE).then(resolve, resolve); }));
      contents.loadURL('data:text/html,<body>').catch(() => {});
      // A press or a wheel on the picture ends it at once and goes on to the page beneath, so it never eats a click or a scroll.
      contents.on?.('before-mouse-event', (event, mouse) => {
        const c = cover; if (!c || !c.shown || c.dropped || !mouse) return;
        const press = mouse.type === 'mouseDown' || mouse.type === 'mouseWheel';
        if (!press && !(mouse.type === 'mouseUp' && c.pressed)) return;
        event.preventDefault?.();
        if (press) { c.pressed = mouse.type === 'mouseDown'; c.drop(); } else c.pressed = false;
        const target = c.target; if (target && !target.isDestroyed()) { try { target.sendInputEvent({ ...mouse }); } catch { /* the page closed */ } }
      });
    }
    return layer;
  }
  function park() { if (live()) { try { layer.setVisible(false); layer.setBounds(parked({ width: 8, height: 8 })); } catch { /* the window is closing */ } } }
  function scheduleRelease() {
    clearTimeout(releaseTimer);
    releaseTimer = later(() => { if (cover || !live()) return; try { getWindow()?.contentView.removeChildView(layer); } catch { /* the window is closing */ } layer.webContents.close(); layer = loaded = null; }, RELEASE_MS);
    releaseTimer?.unref?.();
  }

  /** Read the page's surface now and get a picture of it painted in the layer. The layer is made `area` large (at least the page's size
   * now) and only ever moves from then on: the layer is a web view itself, and one resized on every frame stands transparent between
   * its frames. The picture keeps the size the page has now, at the layer's top left. */
  function begin(pageView, area = null) {
    // A page that is not shown has nothing to dissolve: its slide runs on after a tab switch, and a picture made for it at the end of
    // the glide stood over the page that is shown now (founder, 1 Nov: a grey panel over the new tab page).
    if (disposed || !pageView || pageView.webContents.isDestroyed() || pageView.getVisible?.() === false) return null;
    if (cover) cover.drop();
    const target = pageView.webContents, mine = ++seq, size = pageView.getBounds(), room = { width: Math.max(size.width, area?.width ?? 0), height: Math.max(size.height, area?.height ?? 0) };
    const c = cover = { id: mine, target, view: pageView, shown: false, dropped: false, pressed: false, fading: false, ready: null, laidOut: null, old: null, show, release, drop };
    const shown = () => !target.isDestroyed() && c.view.getVisible?.() !== false;
    clearTimeout(releaseTimer); trace?.('begin');
    // Whatever happens to the slide that asked for it, a picture never outlasts this.
    const expiry = later(() => c.drop(), EXPIRY_MS); expiry?.unref?.();
    // Listening starts now, well before the page changes size, so the page's resize cannot get ahead of it.
    c.laidOut = laidOut(target);
    const taking = new Promise(resolve => { try { target.capturePage().then(resolve, () => resolve(null)); } catch { resolve(null); } });
    c.ready = Promise.race([(async () => {
      const image = await taking; trace?.('step captured');
      if (!image || image.isEmpty() || c.dropped) return false;
      c.old = image;
      const jpeg = image.toJPEG(QUALITY); trace?.('step encoded', jpeg.length);
      if (!jpeg || !jpeg.length) return false;
      // Each step of the work on this thread is under a frame; the slide's own frames run between them.
      await new Promise(resolve => setImmediate(resolve));
      const view = ensure(); if (!view) return false;
      await loaded;
      if (c.dropped || !live()) return false;
      const color = edgeColor(image); trace?.('step colour');
      const script = STILL(jpeg.toString('base64'), size, color); trace?.('step script');
      const set = await view.webContents.executeJavaScript(script).catch(() => null); trace?.('step set');
      // Painted where it cannot be seen (as page-still.cjs primes the new tab picture), so showing it is only a change of bounds.
      const win = getWindow(); if (!set || c.dropped || !win || win.isDestroyed()) return false;
      view.setBounds(parked(room));
      if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
      view.setVisible(true);
      await wait(PAINT_MS);
      if (c.dropped) return false;
      c.painted = true;
      return true;
    })().catch(() => false), wait(READY_MAX_MS).then(() => false)]).then(ok => { trace?.('ready', ok); return ok; });
    return c;

    /** Over the page: `bounds` is the layer's area (the picture sits at its top left at the size the page had when it was begun, the
     * rest of the area has the page's background). The first call puts the picture there, above the pages. */
    function show(bounds, radius) {
      if (!c.painted || c.dropped || !live() || cover !== c) return false;
      if (!shown()) { c.drop(); return false; }
      const win = getWindow(); if (!win || win.isDestroyed()) return false;
      if (!c.shown) {
        const others = win.contentView.children.filter(child => child !== layer), at = typeof above === 'function' ? above(others) : others.length;
        if (win.contentView.children.indexOf(layer) !== at) win.contentView.addChildView(layer, Math.max(0, Math.min(others.length, at)));
        c.shown = true; trace?.('show', rounded(bounds));
      }
      if (Number.isFinite(radius)) layer.setBorderRadius(Math.max(0, Math.round(radius)));
      layer.setBounds(rounded(bounds)); layer.setVisible(true);
      return true;
    }
    /** The page has laid out (`done` settled): the picture dissolves once the page shows its new layout, which is not the same moment
     * (a heavy page draws it some frames after laying it out, and a machine that is busy later still): a capture of the page is
     * compared with the picture until it shows something that is not blank and not the old layout. Bounded. */
    function release(done) {
      if (c.dropped || c.releasing) return;
      c.releasing = true; trace?.('release');
      const limit = later(() => fade(), HOLD_MAX_MS); limit?.unref?.();
      (async () => {
        try { await done; } catch { /* the page went */ }
        const end = now() + POLL_MAX_MS;
        while (!c.dropped && cover === c) {
          await wait(c.polled ? POLL_MS : SETTLE_MS); c.polled = true;
          if (c.dropped) return;
          if (!shown()) { c.drop(); return; }
          if (await settled(c) || now() >= end) break;
        }
        fade();
      })().catch(() => fade());
    }
    /** True once a capture of the page shows a layout other than the picture's, and not a blank one (or when that cannot be told). */
    async function settled() {
      try {
        const live = await Promise.race([target.capturePage(), wait(150).then(() => null)]);
        if (!live || live.isEmpty() || c.dropped || !c.old) return false;
        const a = c.old.getSize(), b = live.getSize(), crop = { x: 0, y: 0, width: Math.min(a.width, b.width), height: Math.min(a.height, b.height) };
        if (crop.width < 8 || crop.height < 8) return true;
        const before = luminance(c.old.crop(crop)), after = luminance(live.crop(crop));
        trace?.('look', Math.round(spread(after)), Math.round(spread(before)), Math.round(gap(before, after) * 10) / 10);
        return spread(after) >= .6 * spread(before) && gap(before, after) >= 1.5;
      } catch { return true; }
    }
    function fade() {
      if (c.dropped || cover !== c || c.fading) return;
      if (!c.shown || !live()) { c.drop(); return; }
      const ms = Math.max(80, Math.round(fadeMs())), out = Math.round(ms * OUT_SHARE), into = Math.round(ms * IN_SHARE), contents = layer.webContents;
      c.fading = true; trace?.('fade', out, into);
      contents.executeJavaScript(FADE(out, into)).catch(() => {});
      later(() => c.drop(), out + into + 60);
    }
    function drop() {
      if (c.dropped) return;
      c.dropped = true; c.old = null; trace?.('drop');
      if (cover === c) { cover = null; park(); if (live()) layer.webContents.executeJavaScript(CLEAR).catch(() => {}); scheduleRelease(); }
    }
  }

  /** Resolves once `contents` (the page) has next been resized and has drawn a couple of frames, or after a limit. Start it before the
   * page changes size. */
  function laidOut(contents) {
    return new Promise(resolve => {
      if (!contents || contents.isDestroyed()) { resolve(false); return; }
      const timer = later(() => resolve(false), LAID_OUT_MAX_MS + 100);
      timer?.unref?.();
      try { contents.executeJavaScript(LAID_OUT).then(ok => resolve(!!ok), () => resolve(false)); } catch { resolve(false); }
    });
  }
  /** The page left the screen (another tab, hidden): a picture of it must not stand over what shows now. */
  function dropFor(contents) { if (cover && cover.target === contents) cover.drop(); }
  function teardown() {
    if (cover) cover.drop();
    clearTimeout(releaseTimer);
    if (live()) { try { getWindow()?.contentView.removeChildView(layer); } catch { /* the window is closing */ } layer.webContents.close(); }
    layer = loaded = null;
  }
  function destroy() { disposed = true; teardown(); }
  /** The sidebar (or the view) is about to change: have the layer ready, so the first picture does not wait for it to be made. */
  function warm() { if (ensure() && !cover) scheduleRelease(); }
  return { begin, warm, laidOut, dropFor, release: () => { if (cover) cover.drop(); }, destroy, get active() { return !!cover; } };
}

module.exports = { createPageDissolve, FADE_MS, READY_MAX_MS, PAINT_MS, SETTLE_MS, POLL_MS, POLL_MAX_MS, HOLD_MAX_MS, EXPIRY_MS };
