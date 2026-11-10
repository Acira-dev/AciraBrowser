'use strict';
// One Electron debugger per page, shared. Electron lets a page's webContents.debugger be attached once; every feature that wanted it used to attach only when it was free and
// give up when it was not. Website appearance (13.3) keeps a page attached for as long as the page is told a colour scheme, so the others (a tab that is put to sleep, the
// camera and microphone check, the zoom glide, a secured page) now take a lease on the same session instead: the session is attached by the first lease and detached by the last,
// and commands pass straight through. A page that somebody else attached (Tor, a hidden cookie page) is not ours to share: acquire answers null and the caller does what it did before.
//   const lease = acquire(wc, 'zoom-glide');   // null when the page is gone or a debugger that is not ours is attached
//   await lease.sendCommand('Emulation.setPageScaleFactor', {pageScaleFactor: 1.2});
//   lease.release();                           // detaches only when no other lease is left
// lease.onDetach(fn) runs when the session ends without a release (the page crashed or went away): the lease is over and holds nothing.
const registry = new WeakMap(); // webContents -> {leases:Set, ours:boolean, hooked:boolean}

function stateOf(wc) {
  let state = registry.get(wc);
  if (!state) { state = {leases: new Set(), ours: false, hooked: false}; registry.set(wc, state); }
  return state;
}

function hook(wc, state) {
  if (state.hooked) return;
  state.hooked = true;
  try {
    wc.debugger.on?.('detach', () => {
      state.ours = false;
      const gone = [...state.leases]; state.leases.clear();
      for (const lease of gone) { lease.over = true; try { lease.ended?.(); } catch { /* a caller's handler must not stop the others */ } }
    });
  } catch { /* a stand-in without events */ }
}

/** A lease on the page's debugger, or null: the page is gone, or a debugger that is not ours is attached (the caller gives up, as before). */
function acquire(wc, owner = '') {
  if (!wc || wc.isDestroyed?.()) return null;
  const state = stateOf(wc), debug = wc.debugger;
  if (state.ours) { try { if (!debug.isAttached()) { state.ours = false; for (const lease of state.leases) lease.over = true; state.leases.clear(); } } catch { state.ours = false; } }
  if (!state.ours) {
    let attached = false;
    try { attached = debug.isAttached(); } catch { return null; }
    if (attached) return null;
    try { debug.attach('1.3'); } catch { return null; }
    state.ours = true;
  }
  hook(wc, state);
  const lease = {
    owner, over: false, ended: null,
    sendCommand: (method, params, sessionId) => lease.over ? Promise.reject(new Error('The debugger session ended.')) : debug.sendCommand(method, params, sessionId),
    on: (event, listener) => debug.on?.(event, listener),
    removeListener: (event, listener) => debug.removeListener?.(event, listener),
    /** Called once when the session ends under the lease. */
    onDetach(fn) { lease.ended = fn; return lease; },
    release() {
      if (lease.over) return;
      lease.over = true; state.leases.delete(lease);
      if (!state.leases.size && state.ours) { state.ours = false; try { if (debug.isAttached()) debug.detach(); } catch { /* already detached */ } }
    },
  };
  state.leases.add(lease);
  return lease;
}

/** Whether we hold the session (any lease), and how many. */
function held(wc) { const state = registry.get(wc); return state ? state.leases.size : 0; }

/** Leases that only describe how a page looks and are held for as long as the page lives: Website appearance (13.3) keeps one on every tab it tells a colour scheme. */
const PASSIVE = ['appearance'];

/**
 * Is somebody ELSE using this page's debugger (13.5, tab sleep)? True when a debugger is attached that is not our session (Tor, a hidden cookie page, any other client),
 * when a lease of a different kind is open (a camera check, a zoom glide, a secured page, tab sleep's own freeze: all brief), and when it cannot be told. False when no debugger is
 * attached, or when the session is ours and every lease on it is one of `passive`. Fails towards true: a page that might be inspected is never put to sleep. DevTools is a separate
 * client (webContents.isDevToolsOpened) and is not looked at here.
 */
function inUseByOthers(wc, passive = PASSIVE) {
  try {
    if (!wc.debugger.isAttached()) return false;
    const state = registry.get(wc);
    if (!state || !state.ours || !state.leases.size) return true;
    for (const lease of state.leases) if (lease.over || !passive.includes(lease.owner)) return true;
    return false;
  } catch { return true; }
}

module.exports = {acquire, held, inUseByOthers, PASSIVE};
