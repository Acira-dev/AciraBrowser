'use strict';
// Beta 14: picture in picture over a fullscreen Space (macOS). The team, in a fullscreen Acira window on the Mac, pressed YouTube's picture-in-picture button and saw nothing until he left
// fullscreen: Chromium's small video window belongs to the desktop Space unless its AppKit collection behaviour says otherwise (CanJoinAllSpaces, FullScreenAuxiliary), and in Electron it is not
// a BrowserWindow, so setVisibleOnAllWorkspaces cannot reach it. Two things tell main that a video went into picture in picture: a page's `enterpictureinpicture` event
// (browser-services/pip-signal-preload.cjs, every frame of every session, Tor and private ones too: a plain listener in the preload's own world, nothing wrapped) and Acira's own pop-outs
// (the now-playing card, Alt+P, the automatic one). Main then asks the native module to put that behaviour on the window (mac-material.mm pipSpaces), a few times, because the window may be
// shown a moment after the event. The change is a flag on the window: its place, size, level, content and focus are never touched, and nothing changes for a page that is not in picture in
// picture. Not macOS: nothing happens.
const DELAYS_MS = [0, 60, 160, 400, 1000, 2200];
/** One entry is usually told twice (the page's event and Acira's own pop-out): a second signal this soon after the first changes nothing, the series already running covers it. */
const QUIET_MS = 150;

function createPipSpaces({ platform = process.platform, apply, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, delays = DELAYS_MS, quiet = QUIET_MS } = {}) {
  let timers = [], signals = 0, changed = 0, startedAt = -Infinity;
  const clear = () => { for (const t of timers) clearTimer(t); timers = []; };
  return {
    /** A video entered picture in picture: set the behaviour now and again a few times (the series restarts when another entry comes later). */
    signal() {
      if (platform !== 'darwin' || typeof apply !== 'function') return false;
      const at = now(); if (at - startedAt < quiet) return true;
      startedAt = at; signals++; clear();
      for (const delay of delays) { const t = setTimer(() => { try { changed += Number(apply()) || 0; } catch { /* the native module is unavailable: the window stays where it was */ } }, delay); t?.unref?.(); timers.push(t); }
      return true;
    },
    dispose() { clear(); },
    state: () => ({ signals, changed, pending: timers.length }),
  };
}

module.exports = { createPipSpaces, DELAYS_MS, QUIET_MS };
