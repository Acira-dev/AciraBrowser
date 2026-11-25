'use strict';
// Beta 14.0: the video's small pop-out window (Chromium's picture in picture, macOS) remembers where the person left it and how big, between uses and across restarts, per profile, like Arc's.
//
// The window is Chromium's own, not an Electron window; its frame is read and set through AppKit (desktop/native/mac-material.mm pipFrame / pipPlace). Inside one run Chromium keeps a window's frame
// from one entry to the next (measured: the same NSWindow number, the moved frame stays), so this only has to carry it across restarts and between profiles:
//  - when a video enters picture in picture, the saved frame of the profile that owns the video is put on the window ONCE per window (a person who drags it afterwards is never fought), a few times
//    over the first two seconds because the window may be shown a moment after the event: at once on the signal, then on the next frames (16, 33, 60, 120 ms) and later ones, so it is not seen at
//    Chromium's default place first. The saved WIDTH is used with the window's own aspect ratio (a video of another shape would otherwise be
//    squeezed), and the frame is clamped onto the screen that holds its centre, or onto the main screen when that display is gone (a laptop away from its monitor).
//  - while a window is up it is looked at every 600 ms; a frame that stayed the same for two looks and differs from the saved one is saved (the person dragged or resized it). Nothing is written when
//    nothing changed, nor for a window the person never touched.
// Stored in <user data>/pip-window.json by main: { "<profile id>": { x, y, width, height } } in screen points, origin at the top left of the main display (Electron's); the native module's AppKit
// frames (origin at the bottom left) are converted here. Private windows keep it in memory only. Not macOS (no native module): nothing happens, the system places the window.

const FAST_LOOKS = 1500, POLL_MS = 600, RESTORE_DELAYS_MS = [16, 33, 60, 120, 450, 900, 1800], MIN_WIDTH = 200, SETTLED_LOOKS = 2, GONE_LOOKS = 3;

/** deps: frame() the pop-out window's AppKit frame or null; place(x, y, w, h) (AppKit); primaryHeight() the main display's height; displays() [{ workArea: {x,y,width,height} }] (Electron, top-left origin);
 *  store { read(): object, write(object) }; setTimer / clearTimer; log(message). */
function createPipMemory({ frame, place, primaryHeight, displays, store, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  let timers = [], pollTimer = null, profile = null, placedFor = new Set(), seen = null, steady = 0, gone = 0, ours = null;   // ours: the frame the window was left at by us (or by Chromium before the person touched it)

  const toTop = f => ({ x: Math.round(f.x), y: Math.round(primaryHeight() - (f.y + f.height)), width: Math.round(f.width), height: Math.round(f.height) });
  const toApp = r => ({ x: r.x, y: primaryHeight() - (r.y + r.height), width: r.width, height: r.height });
  const same = (a, b, slack = 2) => !!a && !!b && ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) <= slack);
  const valid = r => !!r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width >= MIN_WIDTH && r.height >= MIN_WIDTH * .3;
  const read = () => { try { return (store.read() || {})[profile] || null; } catch { return null; } };

  /** The saved rectangle fitted onto a screen: width kept (never more than the screen), the window's own aspect, inside the work area of the display that holds its centre (else the first). */
  function fit(saved, current) {
    const list = (displays() || []).map(d => d.workArea).filter(Boolean); if (!list.length) return null;
    const cx = saved.x + saved.width / 2, cy = saved.y + saved.height / 2;
    const area = list.find(a => cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height) || list[0];
    const aspect = current.width > 0 && current.height > 0 ? current.height / current.width : saved.height / saved.width;
    let width = Math.min(Math.round(saved.width), area.width), height = Math.round(width * aspect);
    if (height > area.height) { height = area.height; width = Math.round(height / aspect); }
    const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width), y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
    return { x, y, width, height };
  }

  function restore() {
    const current = frame(true); if (!current || placedFor.has(current.number)) return;     // true: a window that is not on screen yet is found too
    placedFor.add(current.number);   // once per window: whatever happens next is the person's
    ours = toTop(current);
    const saved = read(); if (!valid(saved)) return;
    const target = fit(saved, current); if (!target || same(ours, target)) return;
    const app = toApp(target);
    try { place(app.x, app.y, app.width, app.height); ours = target; } catch (error) { log('pip window: could not be placed: ' + (error && error.message || error)); }
  }

  function look() {
    pollTimer = null;
    const current = frame();
    if (!current) { if (++gone >= GONE_LOOKS) { stop(); return; } schedule(); return; }
    gone = 0;
    const now = toTop(current), saved = read();
    if (seen && same(now, seen, 1)) steady++; else { steady = 0; seen = now; }
    // settled (the person let go) and not what is saved: remember it. A window not yet restored is left alone (its frame is Chromium's default until the restore ran).
    if (steady >= SETTLED_LOOKS - 1 && placedFor.has(current.number) && ours && !same(now, ours, 3) && !same(now, saved || {}, 2)) {
      try { store.write({ ...(store.read() || {}), [profile]: now }); } catch (error) { log('pip window: its place could not be saved: ' + (error && error.message || error)); }
      ours = now; steady = 0;
    }
    schedule();
  }
  const schedule = () => { if (!pollTimer) { pollTimer = setTimer(look, POLL_MS); pollTimer?.unref?.(); } };
  function stop() { clearTimer(pollTimer); pollTimer = null; seen = null; steady = 0; gone = 0; }

  /** Acira's own pop-out request (the automatic one, the card, Alt+P) is about to be made: the window is looked for every millisecond from now (up to ~1.5 s) and placed the moment it exists, before the
   *  page's own `enterpictureinpicture` can even travel to main (measured: the signal arrives ~16 ms after the window is on screen, one frame at Chromium's default place). */
  let fast = null, fastLeft = 0;
  function fastLook() {
    fast = null;      // done when the window is placed now, or was already ours (the same window again)
    try { restore(); const current = frame(true); if (current && placedFor.has(current.number)) { fastLeft = 0; return; } } catch (error) { log('pip window: ' + (error && error.message || error)); fastLeft = 0; return; }
    if (--fastLeft > 0) { fast = setTimer(fastLook, 1); fast?.unref?.(); }
  }
  return {
    arm(profileId) {
      if (typeof frame !== 'function' || typeof place !== 'function') return false;
      profile = String(profileId || 'default'); if (!valid(read())) return false;      // nothing saved: nothing to place, no watching
      clearTimer(fast); fastLeft = FAST_LOOKS; fast = setTimer(fastLook, 1); fast?.unref?.(); return true;
    },
    /** A video of this profile went into picture in picture (a page's own button, the card, Alt+P, the automatic pop-out): put the saved frame on its window and watch it. */
    entered(profileId) {
      if (typeof frame !== 'function' || typeof place !== 'function') return false;
      profile = String(profileId || 'default');
      for (const t of timers) clearTimer(t); timers = [];
      try { restore(); } catch (error) { log('pip window: ' + (error && error.message || error)); }      // at once, on the signal
      for (const delay of RESTORE_DELAYS_MS) { const t = setTimer(() => { try { restore(); } catch (error) { log('pip window: ' + (error && error.message || error)); } }, delay); t?.unref?.(); timers.push(t); }
      gone = 0; schedule();
      return true;
    },
    dispose() { for (const t of timers) clearTimer(t); timers = []; clearTimer(fast); fast = null; fastLeft = 0; stop(); },
    state: () => ({ profile, watching: !!pollTimer, placed: [...placedFor] }),
    /** Tests: one look now. */
    look,
  };
}

module.exports = { createPipMemory, POLL_MS, RESTORE_DELAYS_MS, SETTLED_LOOKS };
