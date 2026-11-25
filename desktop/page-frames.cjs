'use strict';
// Hidden tabs give their graphics memory back (13.11 / Beta 14, gpu-mem).
// On a Mac every page view is hosted inside the window's own layer tree, and a page view hidden the way Acira hides tabs never tells Chromium's
// DelegatedFrameHost that it is hidden (Chromium 152, browser_compositor_view_mac.mm: UseParentLayerCompositor): viz kept every hidden tab's last
// frame, and the raster tiles that frame uses, for as long as the tab lived (GPU process 509 MB at 30 tabs on 13.9, Chrome 214).
// Chromium's own switch for this (HideDelegatedFrameHostMac) is not used: it would also let go of the frames of a whole window covered for five
// minutes, the interface's included. Instead, per page: after a one-pixel capture with `stayHidden` (the page stays hidden and sees nothing), the
// widget is hidden the way Chromium's Mac code passes on; taken out of the window right after, the view has no parent layer, and Chromium drops its
// frame (viz::FrameEvictionManager keeps at most five saved frames, visible ones included).
// The tabs used last (KEEP_WARM) stay as they are, for the instant switch; the others let their frame go once hidden for SETTLE_MS (one at a time,
// on a timer, never on the switch itself), and every hidden page once hidden for IDLE_MS (four minutes: before Memory Saver freezes a page at five).
// Never while a page plays or played sound in the last minute, is captured, is in full screen, has DevTools open, is frozen, or is held by another
// feature (exempt()).
// Back on screen, a page that let its frame go is put back under the page being left and drawn there; the page being left stays on screen until the
// arriving page has drawn (a one-pixel capture of it resolves), bounded by HOLD_MAX_MS (a page busy that long on its return): never a blank or half-drawn page area. A press on it during
// that time ends the wait and goes on to the arriving page.
const KEEP_WARM = 2, SETTLE_MS = 2000, IDLE_MS = 240000, HOLD_MAX_MS = 1000, CAPTURE_MAX_MS = 3000;

function createPageFrames({ now = Date.now, later = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id), keepWarm = KEEP_WARM, settleMs = SETTLE_MS, idleMs = IDLE_MS, holdMaxMs = HOLD_MAX_MS,
  release: letGo, restore, exempt = () => null, capture, outgoing, boundsOf = null, watchPress = null, mark = null, log = null, coverWait = null } = {}) {
  const hidden = []; // most recently hidden first
  let job = null, disposed = false, sweepTimer = null, busy = false;
  const drop = entry => { const i = hidden.indexOf(entry); if (i >= 0) hidden.splice(i, 1); };
  const cold = entry => !!entry?.framesReleased;
  function schedule(ms) { if (disposed) return; if (sweepTimer) cancel(sweepTimer); sweepTimer = later(sweep, ms); sweepTimer?.unref?.(); }
  /** Let go of the frame of one hidden page past the warm ones (or of any page hidden for idleMs) whose time has come; the next pass follows it. */
  function sweep() {
    sweepTimer = null;
    if (disposed || busy || job) { if (job) schedule(settleMs); return; }
    const t = now(); let next = Infinity;
    for (let i = 0; i < hidden.length; i++) {
      const entry = hidden[i]; if (entry.framesReleased) continue;
      const age = t - (entry.hiddenAt || t), due = i >= keepWarm ? settleMs : idleMs;
      if (age < due) { next = Math.min(next, due - age); continue; }
      if (exempt(entry)) { next = Math.min(next, settleMs * 15); continue; }
      busy = true; entry.framesShownMeanwhile = false;
      const done = gone => {
        busy = false;
        if (gone === true && hidden.includes(entry) && !entry.framesShownMeanwhile) { entry.framesReleased = true; log?.('frames released', entry.tabId || '', 'rank', hidden.indexOf(entry), Math.round(age / 1000) + ' s'); }
        schedule(50);
      };
      let result; try { result = letGo(entry); } catch { result = false; }
      Promise.resolve(result).then(done, () => done(false));
      return;
    }
    if (Number.isFinite(next)) schedule(Math.max(50, next));
  }
  function stopHold(reason) {
    const j = job; if (!j) return 0; job = null; cancel(j.timer); try { j.unwatch?.(); } catch { /* closed */ }
    const runs = [...j.queued.values()]; j.queued.clear();
    for (const run of runs) { try { run(); } catch { /* a closed page */ } }
    log?.('frames hold released', reason, j.id, Math.round(now() - j.at) + ' ms');
    if (mark) try { mark(j.other, 'acira-frames-released'); } catch { /* closed */ }
    schedule(settleMs);
    return runs.length;
  }
  function noteShown(entry) { drop(entry); entry.everShown = true; entry.hiddenAt = null; entry.framesShownMeanwhile = true; }
  function noteHidden(entry) { if (!entry.everShown) return; drop(entry); hidden.unshift(entry); entry.hiddenAt = now(); schedule(settleMs); }
  /** A page view is about to be shown (`showing`) or hidden; `run` changes the view. A page that let its frame go is put back first; while one other page is
   * on screen, the arriving page goes under it and the change that hides the other waits until the arriving page has drawn. */
  function flip(entry, run, showing, id) {
    if (disposed) { run(); return; }
    if (job) {
      if (!showing && entry !== job.target) { job.queued.set(entry, () => { run(); noteHidden(entry); }); return; }
      stopHold(showing ? 'another page shown' : 'the arriving page hidden');
    }
    if (showing && cold(entry)) {
      const other = outgoing ? outgoing(entry) : null;
      try { restore(entry, other); } catch { /* the window is closing */ }
      entry.framesReleased = false;
      if (other && capture) {
        const j = job = { target: entry, other, id, at: now(), queued: new Map(), timer: null, bounds: boundsOf ? JSON.stringify(boundsOf(entry)) : null, unwatch: null };
        run(); noteShown(entry);
        try { j.unwatch = watchPress ? watchPress(other, entry, () => { if (job === j) stopHold('press'); }) : null; } catch { j.unwatch = null; }
        log?.('frames hold', id);
        j.timer = later(() => { if (job === j) stopHold('time'); }, holdMaxMs);
        Promise.resolve().then(() => capture(entry)).then(() => { if (job === j) stopHold('drawn'); }, () => { if (job === j) stopHold('no capture'); });
        return;
      }
    }
    // D151: a page that has drawn nothing yet, shown while the interface floats over the pages, is see-through, and the interface's page surface
    // that covers it there lands a few frames after a native change: the page being left stays on screen beneath it for `coverWait(entry)` ms,
    // so the window's material never shows in between (the same hold as a page that comes back, ended by time instead of a capture).
    const wait = showing && coverWait ? coverWait(entry) : 0;
    const other = wait > 0 && outgoing ? outgoing(entry) : null;
    if (other) {
      const j = job = { target: entry, other, id, at: now(), queued: new Map(), timer: null, bounds: boundsOf ? JSON.stringify(boundsOf(entry)) : null, unwatch: null };
      run(); noteShown(entry);
      try { j.unwatch = watchPress ? watchPress(other, entry, () => { if (job === j) stopHold('press'); }) : null; } catch { j.unwatch = null; }
      log?.('cover hold', id, wait + ' ms');
      j.timer = later(() => { if (job === j) stopHold('covered'); }, wait);
      return;
    }
    run();
    if (showing) noteShown(entry); else noteHidden(entry);
  }
  function relayout() { if (job && boundsOf && job.bounds !== JSON.stringify(boundsOf(job.target))) stopHold('layout'); }
  function forget(entry) { drop(entry); entry.framesReleased = false; if (job && (job.target === entry || job.queued.has(entry))) stopHold('closed'); }
  function dispose() { disposed = true; stopHold('dispose'); if (sweepTimer) cancel(sweepTimer); hidden.length = 0; }
  return { flip, cold, sweep, relayout, forget, dispose, get holding() { return !!job; }, get order() { return [...hidden]; } };
}

/** The Electron side of letting a hidden page view's frame go (Mac): a one-pixel capture with `stayHidden` (the page stays hidden and sees nothing),
 * then the view leaves the window. Only for a view that is hidden, in `parent`, and throttled when hidden (a test profile keeps hidden pages painting:
 * nothing to give back there). Resolves true when the view left the window; a capture that fails or takes longer than CAPTURE_MAX_MS changes nothing. */
async function letGoOfFrame({ parent, view }) {
  const wc = view?.webContents, ok = () => !!parent && !!wc && !wc.isDestroyed() && !view.getVisible() && parent.children.includes(view);
  if (!ok() || (typeof wc.getBackgroundThrottling === 'function' && !wc.getBackgroundThrottling())) return false;
  let timer; try { await Promise.race([wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }, { stayHidden: true, stayAwake: false }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('capture timed out')), CAPTURE_MAX_MS); })]); }
  catch { return false; } finally { clearTimeout(timer); }
  if (!ok()) return false; // shown again or closed meanwhile: leave it be
  parent.removeChildView(view);
  return true;
}
module.exports = { createPageFrames, letGoOfFrame, KEEP_WARM, SETTLE_MS, IDLE_MS, HOLD_MAX_MS, CAPTURE_MAX_MS };
