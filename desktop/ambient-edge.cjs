'use strict';
/**
 * Ambient mode's eyes (Beta 14, F6). The page's own edge colours, reduced to two short rows of colours: down the edge beside the sidebar (SIDE_STOPS) and along the top (TOP_STOPS).
 * The interface turns them into a light that spills into the sidebar and the toolbar (src/ui/ambient.ts). Nothing leaves the machine and nothing is saved: a row is ~20 numbers.
 *
 * Cheap by construction, and only when everything says it should run:
 *   - the setting is on; the tab is the one on screen; it is not private, Tor or secured (the site colour's own `blocked`); the window is the focused one; no tab is sharing the window.
 *     Otherwise nothing is captured, nothing is scheduled, and the interface is told once to put the light away.
 *   - two THIN captures of the page, never the page: the top 24 DIP (the strip the site-colour engine reads too: when it read it a moment ago, this reuses it) and 24 DIP down the side the
 *     sidebar is on. Each is reduced to a handful of segment colours in place.
 *   - when: a navigation (the engine's own load + 350 ms, +1.6 s, +4.2 s; an in-page navigation + 500 ms), the tab coming on screen, the setting or the sidebar's side changing, the window
 *     taking focus. And while the page moves: after a scroll (the wheel, a scroll gesture, a scroll key) at most twice a second with a last read 300 ms after it stops, and while a video plays at
 *     most once every 1.5 s. Motion Off: only the navigations and the tab coming on screen (the light is static then; nothing follows the page).
 *   - a read that differs from the last by less than a few levels is not sent.
 */
const STRIP_DIP = 24, SIDE_STOPS = 16, TOP_STOPS = 24, TIMEOUT_MS = 3000;
const MIN_GAP_MS = 450, SCROLL_SETTLE_MS = 300, VIDEO_GAP_MS = 1500, SAME_LEVELS = 5;
/** A page given a new size (a sidebar opening or closing, a layout switch, the window resized) is read again once it has settled at that size, and once more for a page that lays out late. */
const RESIZE_SETTLE_MS = 600, RESIZE_LATE_MS = 1600;
/** ...and its new colours fade in slowly and evenly, longer than the switch that changed its size: never a late pop (a 300 ms fast-start fade stepped the margin 8 to 12 levels a frame. Linear, the
 *  colour page's green-to-red margin (96 levels) moves 1.1 levels a drawn frame at 120 Hz over 700 ms, 0.9 over 850 ms, real windows). */
const RESIZE_FADE_MS = 850;
/** F1 (reported 17 Nov: "it must recolour INSTANTLY when a tab with colours opens or is switched to"): main keeps the last read of each tab (about 30, ~40 numbers each, dropped with the tab, never for a private, Tor or secured tab, and none while
 *  Ambient is off) and pushes it the moment the tab comes on screen, with a quick fade; the fresh read follows at once (no 300 ms wait, no 450 ms gap: that gap is only for scroll reads). */
const KEEP_SAMPLES = 30, SWITCH_FADE_MS = 140;

/** `count` segment colours along one axis of a BGRA strip: the mean of each segment's pixels as [r, g, b]. axis 'y': down the strip; axis 'x': along it. */
function segmentMeans(bitmap, width, height, axis, count) {
  const out = [], along = axis === 'y' ? height : width, across = axis === 'y' ? width : height;
  if (!bitmap || !(along > 0) || !(across > 0) || bitmap.length < width * height * 4) return null;
  for (let i = 0; i < count; i++) {
    const a = Math.floor(along * i / count), b = Math.max(a + 1, Math.floor(along * (i + 1) / count));
    let r = 0, g = 0, bl = 0, n = 0;
    for (let p = a; p < b; p++) for (let q = 0; q < across; q++) {
      const x = axis === 'y' ? q : p, y = axis === 'y' ? p : q, o = (y * width + x) * 4;
      bl += bitmap[o]; g += bitmap[o + 1]; r += bitmap[o + 2]; n++;
    }
    out.push([Math.round(r / n), Math.round(g / n), Math.round(bl / n)]);
  }
  return out;
}
/** Beta 14, F1 (3): a page whose edges are white, grey or black (YouTube) gives no colour from two 24 DIP strips. `usable` asks what ambientColours.ts asks (colourful AND bright, chroma 22 / luma 56). */
const usable = rows => rows.some(c => (Math.max(...c) - Math.min(...c)) >= 22 && (.2126 * c[0] + .7152 * c[1] + .0722 * c[2]) >= 56);
const WIDE_WIDTH = 64;
/** The fallback's `count` segment colours along one axis of a reduced capture of the WHOLE page, over the part of it that is near that edge (`from`..`to` of the other axis, in cells). A segment's colour is the mean of its colourful pixels,
 *  taken as the colour only to the degree they cover it (a small logo on a black page stays the plain, grey mean: no light), so a grid of thumbnails gives its colour and a page with one red button gives none. */
function segmentMeansWide(bitmap, width, height, axis, count, from, to) {
  const out = [], along = axis === 'y' ? height : width;
  if (!bitmap || bitmap.length < width * height * 4 || !(along > 0)) return null;
  const smooth = (a, b, v) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };
  for (let i = 0; i < count; i++) {
    const a = Math.floor(along * i / count), b = Math.max(a + 1, Math.floor(along * (i + 1) / count));
    let r = 0, g = 0, bl = 0, n = 0, wr = 0, wg = 0, wb = 0, ws = 0, colourful = 0;
    for (let p = a; p < b; p++) for (let q = from; q < to; q++) {
      const x = axis === 'y' ? q : p, y = axis === 'y' ? p : q, o = (y * width + x) * 4, B = bitmap[o], G = bitmap[o + 1], R = bitmap[o + 2], ch = Math.max(R, G, B) - Math.min(R, G, B);
      r += R; g += G; bl += B; n++; const w = ch * ch; wr += R * w; wg += G * w; wb += B * w; ws += w; if (ch >= 30) colourful++;
    }
    const k = smooth(.04, .25, colourful / Math.max(1, n)), plain = [r / n, g / n, bl / n], hue = ws > 0 ? [wr / ws, wg / ws, wb / ws] : plain;
    out.push([0, 1, 2].map(c => Math.round(plain[c] + (hue[c] - plain[c]) * k)));
  }
  return out;
}
/** Is this read the same as the last, within a few levels everywhere? */
function sameRead(a, b, levels = SAME_LEVELS) {
  if (!a || !b || a.side !== b.side || !!a.wide !== !!b.wide || a.l.length !== b.l.length || a.t.length !== b.t.length) return false;
  const near = (x, y) => x.every((row, i) => row.every((v, k) => Math.abs(v - y[i][k]) <= levels));
  if (!!a.r !== !!b.r || !!a.b !== !!b.b || (a.r && (a.r.length !== b.r.length || a.b.length !== b.b.length))) return false;
  return near(a.l, b.l) && near(a.t, b.t) && (!a.r || (near(a.r, b.r) && near(a.b, b.b)));
}

function createAmbientEdge({
  now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout,
  enabled = () => false,          // the setting
  blocked = () => false,          // private, Tor, secured (the site colour's own rule)
  visible = () => true,           // the tab is the one on screen
  focused = () => true,           // the window is the focused one
  capturing = () => false,        // some tab is sharing this window
  motionOff = () => false,        // animation speed Off or reduced motion
  layoutOk = () => true,          // the layout lights something: every layout except Seamless (F1: nothing to tint there, and not one capture)
  side = () => 'left',            // the sidebar's side
  push = () => {},                // (payload | null) -> the interface
} = {}) {
  const tabs = new Map(), samples = new Map();
  let lastPushed = null, cleared = true;

  const clearInterface = () => { samples.clear(); if (!cleared) { cleared = true; lastPushed = null; push(null); } };
  /** The light is put away but what main knows is kept (every tab's last read stays, so a tab switched back to is lit on its first frame, F1): the tab on screen has nothing to light (a New tab, Settings and the other pages that have no page view; a window whose page changed while it was not the focused one and so cannot be read). */
  const putAway = () => { if (!cleared) { cleared = true; lastPushed = null; push(null); } };
  const allowed = id => enabled() && layoutOk() && !blocked(id) && visible(id) && focused() && !capturing();
  /** Nothing may be drawn, whatever the tab does: the setting is off, the layout is Seamless, the tab is private / Tor / secured, or a tab is sharing the window. */
  const mustBeDark = id => !enabled() || !layoutOk() || blocked(id) || capturing();
  const remember = payload => { samples.delete(payload.id); samples.set(payload.id, payload); while (samples.size > KEEP_SAMPLES) samples.delete(samples.keys().next().value); };

  function attach(tabId, { region = async () => null, whole = async () => null, playing = () => false, cachedTop = () => null } = {}) {
    const tab = { id: tabId, timers: new Set(), reading: false, lastAt: -Infinity, dirty: false, shown: false, wide: false, scrollTimer: null, videoTimer: null, resizeTimers: [], disposed: false };
    tabs.set(tabId, tab);
    const later = (ms, fn) => { const t = schedule(() => { tab.timers.delete(t); if (!tab.disposed) fn(); }, ms); t.unref?.(); tab.timers.add(t); return t; };
    const clear = () => { for (const t of tab.timers) cancel(t); tab.timers.clear(); };

    async function read(reason) {
      if (tab.disposed || tab.reading) return;
      if (!allowed(tabId)) { if (mustBeDark(tabId)) clearInterface(); return; }
      tab.reading = true; tab.dirty = false; tab.lastAt = now();
      try {
        const left = side() !== 'right';
        let t = null, l = null, r = null, b = null, wide = false;
        if (!tab.wide) {
          const top = (reason === 'resize' ? null : cachedTop()) ?? await region({ x: 0, y: 0, width: -1, height: STRIP_DIP }), sideStrip = await region(left ? { x: 0, y: 0, width: STRIP_DIP, height: -1 } : { x: -STRIP_DIP, y: 0, width: STRIP_DIP, height: -1 });
          if (tab.disposed || !allowed(tabId) || !top || !sideStrip) return;
          t = segmentMeans(top.bitmap, top.width, top.height, 'x', TOP_STOPS); l = segmentMeans(sideStrip.bitmap, sideStrip.width, sideStrip.height, 'y', SIDE_STOPS);
          if (!t || !l) return;
          // The frame is one surface (Beta 14, "frame, one surface"): the two edges the sidebar and the toolbar are NOT on, the far side and the bottom, give the colours for the thin strips round the page card, so the light goes all the way round.
          // (only for a page whose edges have colour: a white, grey or black page is read whole below, and gives these two rows from that one capture)
          if (usable(t) || usable(l)) {
            const farStrip = await region(left ? { x: -STRIP_DIP, y: 0, width: STRIP_DIP, height: -1 } : { x: 0, y: 0, width: STRIP_DIP, height: -1 }), bottomStrip = await region({ x: 0, y: -STRIP_DIP, width: -1, height: STRIP_DIP });
            if (tab.disposed || !allowed(tabId)) return;
            if (farStrip && bottomStrip) { r = segmentMeans(farStrip.bitmap, farStrip.width, farStrip.height, 'y', SIDE_STOPS); b = segmentMeans(bottomStrip.bitmap, bottomStrip.width, bottomStrip.height, 'x', TOP_STOPS); }
          }
        }
        // white, grey or black edges (YouTube): one capture of the whole page, reduced to 64 cells wide, read near the top and near the side; the next reads of this page go straight to it (until it navigates)
        if (tab.wide || (!usable(t || []) && !usable(l || []))) {
          const img = await whole(); if (tab.disposed || !allowed(tabId)) return;
          const cw = img ? img.width : 0, ch = img ? img.height : 0, third = Math.max(1, Math.floor(cw / 3)), rows = Math.max(1, Math.floor(ch / 3));
          const wt = img && segmentMeansWide(img.bitmap, cw, ch, 'x', TOP_STOPS, 0, rows), wl = img && segmentMeansWide(img.bitmap, cw, ch, 'y', SIDE_STOPS, left ? 0 : cw - third, left ? third : cw);
          const wb = img && segmentMeansWide(img.bitmap, cw, ch, 'x', TOP_STOPS, ch - rows, ch), wr = img && segmentMeansWide(img.bitmap, cw, ch, 'y', SIDE_STOPS, left ? cw - third : 0, left ? cw : third);
          if (wt && wl) { tab.wide = true; t = wt; l = wl; r = wr && wb ? wr : null; b = wr && wb ? wb : null; wide = true; }   // no whole-page picture (or a tab that cannot give one): the strips are what they were
          else if (!t || !l) return;
        }
        const payload = { id: tabId, side: left ? 'left' : 'right', l, t, ...(r && b ? { r, b } : {}), reason, ...(wide ? { wide: true } : {}), ...(reason === 'resize' ? { fade: RESIZE_FADE_MS } : {}) };
        if (!blocked(tabId)) remember(payload);
        if (cleared || !sameRead(payload, lastPushed)) { cleared = false; lastPushed = payload; push(payload); }
      } catch { /* a page that cannot be captured gives nothing */ } finally { tab.reading = false; }
    }
    /** Read once the gap since the last read has passed. */
    const readSoon = (ms, reason) => { const wait = Math.max(ms, MIN_GAP_MS - (now() - tab.lastAt)); later(Math.max(0, wait), () => read(reason)); };
    const scheduleVideo = () => { if (tab.videoTimer) return; tab.videoTimer = later(VIDEO_GAP_MS, () => { tab.videoTimer = null; if (!motionOff() && playing() && allowed(tabId)) { void read('video'); scheduleVideo(); } }); };

    return {
      /** A new page on screen in a window that is not the focused one cannot be read (nothing is captured then), and the light on the frame is the old page's: it is put away until the window is focused again (its `recheck` reads the page and lights it). Frame, D29: a white page kept the previous page's colours. */
      navigated() { clear(); tab.wide = false; tab.videoTimer = null; tab.scrollTimer = null; if (enabled() && visible(tabId) && !blocked(tabId) && !focused()) putAway(); },
      loaded() { clear(); later(350, () => read('load')); later(1600, () => read('load')); later(4200, () => read('load')); if (!motionOff() && playing()) scheduleVideo(); },
      inPage() { clear(); tab.wide = false; later(500, () => read('in-page')); },
      /** The page moved under the pointer or a key (a wheel, a scroll gesture, a scroll key): a read at most every MIN_GAP_MS, and one 300 ms after it stops. */
      scrolled() {
        if (motionOff() || !allowed(tabId)) return;
        tab.dirty = true;
        if (tab.scrollTimer) cancel(tab.scrollTimer);
        tab.scrollTimer = schedule(() => { tab.scrollTimer = null; if (!tab.disposed && tab.dirty) void read('scroll-end'); }, SCROLL_SETTLE_MS); tab.scrollTimer.unref?.();
        if (now() - tab.lastAt >= MIN_GAP_MS && !tab.reading) void read('scroll');
      },
      /** Media started or stopped playing in the page. */
      mediaChanged() { if (playing() && !motionOff()) scheduleVideo(); },
      /** Called whenever the page is on screen (cheap): the first time after it was off screen, read it once. */
      visibleNow() {
        if (tab.shown) return;
        tab.shown = true; clear();
        // the last read of this tab is drawn at once (a quick fade), then a fresh one follows without waiting: a tab switch recolours on its first frame
        const kept = samples.get(tabId);
        if (kept && allowed(tabId)) { cleared = false; lastPushed = kept; push({ ...kept, reason: 'cached', fade: SWITCH_FADE_MS }); }
        later(0, () => read('on-screen'));
      },
      hiddenNow() { tab.shown = false; },
      /** The page was given a new size. Its edges now lie elsewhere in its content (a block that stops short of a wide page's edge reaches a narrow one's), so the light read at the old size is
       *  read again once the page has settled at the new one (the top strip captured afresh, never the 600 ms copy taken during the move), and once more for a page that lays out late. Without
       *  it the light kept the old width's colours until the next scroll: the colour page's red block beside a green margin after the sidebar opened (20 Nov, the team: 'colours that are mismatching'). */
      resized() {
        for (const t of tab.resizeTimers) { cancel(t); tab.timers.delete(t); }
        tab.resizeTimers = allowed(tabId) ? [later(RESIZE_SETTLE_MS, () => read('resize')), later(RESIZE_LATE_MS, () => read('resize'))] : [];
      },
      /** The window took focus, or a setting changed: read it once now (or put the light away). */
      recheck() { clear(); if (!allowed(tabId)) { if (mustBeDark(tabId)) clearInterface(); return; } readSoon(0, 'recheck'); },
      dispose() { tab.disposed = true; clear(); if (tab.scrollTimer) cancel(tab.scrollTimer); tabs.delete(tabId); samples.delete(tabId); },
    };
  }
  /** Beta 14, the video's light: a page that filled its view is let go of; the next read is pushed even if it equals the last one pushed (the video's own light was on the frame in between and main did not push it). */
  const forget = () => { lastPushed = null; };
  return { attach, tabs, samples, clearInterface, putAway, forget, get lastPushed() { return lastPushed; } };
}

/** Electron glue: a thin capture of one edge strip of a page, as BGRA. `rect.width` or `rect.height` of -1 means the page's whole width or height; a negative x counts from the right edge, a negative y from the bottom. */
async function captureRegion(wc, rect, size) {
  const width = rect.width < 0 ? Math.max(200, Math.round(size.width)) : rect.width, height = rect.height < 0 ? Math.max(120, Math.round(size.height)) : rect.height;
  const x = rect.x < 0 ? Math.max(0, Math.round(size.width) + rect.x) : rect.x, y = rect.y < 0 ? Math.max(0, Math.round(size.height) + rect.y) : rect.y;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), TIMEOUT_MS));
  const image = await Promise.race([wc.capturePage({ x, y, width, height }, { stayHidden: true, stayAwake: false }).catch(() => null), timeout]);
  if (!image || image.isEmpty()) return null;
  const got = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 });
  return bitmap.length === got.width * got.height * 4 ? { bitmap, width: got.width, height: got.height } : null;
}

/** The whole page as one small picture (64 wide), BGRA: the fallback's single capture (cheaper than the two strips it follows: one readback, then a resize in the GPU process). */
async function captureWhole(wc, size) {
  const width = Math.max(200, Math.round(size.width)), height = Math.max(120, Math.round(size.height));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), TIMEOUT_MS));
  const image = await Promise.race([wc.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true, stayAwake: false }).catch(() => null), timeout]);
  if (!image || image.isEmpty()) return null;
  const small = image.resize({ width: WIDE_WIDTH, quality: 'good' }), got = small.getSize(1), bitmap = small.toBitmap({ scaleFactor: 1 });
  return bitmap.length === got.width * got.height * 4 ? { bitmap, width: got.width, height: got.height } : null;
}

module.exports = { createAmbientEdge, segmentMeans, segmentMeansWide, captureWhole, usable, sameRead, captureRegion, STRIP_DIP, SIDE_STOPS, TOP_STOPS, MIN_GAP_MS, SCROLL_SETTLE_MS, VIDEO_GAP_MS, RESIZE_SETTLE_MS, RESIZE_LATE_MS, RESIZE_FADE_MS, KEEP_SAMPLES, SWITCH_FADE_MS };
