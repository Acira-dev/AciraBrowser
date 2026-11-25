'use strict';
// What "Move to another computer" shares across the app's windows, with nothing of Electron in it (main.cjs hands in the few Electron things as functions):
// the relay client and the transport over it, the bag every window's transfer service reads its sessions from, the name this computer gives itself, and the
// three things that must happen around a live transfer: nudge the windows (progress at most ten times a second), keep the computer awake, and get the person's
// attention when the other computer joins while the sheet is closed. Spec sections 5.2, 6, 12.2 and 14 of the design notes.
const { createRelay } = require('./relay.cjs');
const { createTransport } = require('./session.cjs');
const { transferActive } = require('./index.cjs');

const PROGRESS_GAP = 100; // ms: ten nudges a second at most while only the progress moves

/**
 * The label the other computer shows (spec 5.2): the host name without its network suffix and its dashes ("Alexs-MacBook-Air.local" -> "Alexs MacBook Air"),
 * and "Windows PC" for the name Windows gives a computer nobody named ("DESKTOP-7F3K2QP").
 */
function deviceLabel(hostname, platform) {
  const base = String(hostname ?? '').split('.')[0].replace(/[\u0000-\u001f\u007f]/g, ' ');
  const words = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (platform === 'win32') {
    if (!words || /^(DESKTOP|LAPTOP|WIN|PC|WORKSTATION)[- _]?[A-Z0-9]{5,12}$/i.test(base.trim())) return 'Windows PC';
    return words;
  }
  if (!words) return platform === 'darwin' ? 'Mac' : platform === 'linux' ? 'Linux PC' : 'Another computer';
  return words;
}

/** The signature of what a screen shows apart from its progress: when it changes the windows hear at once. */
function signature(shared) {
  const out = shared.out?.view, inc = shared.inc?.view;
  return JSON.stringify([out?.state, out?.reason ?? null, out?.peer?.label ?? null, inc?.state, inc?.reason ?? null, inc?.peer?.label ?? null, shared.applying?.done.length ?? -1, Boolean(shared.incoming)]);
}

/**
 * @param options {
 *   endpoint      the relay address, or '' (a test profile with none, or a build without one): then there is no transport and the code roads say so
 *   fetch         (url, init) => Promise<Response>  the active profile's session, so a proxy the person chose is used
 *   version       Acira's version, for the user agent and the device
 *   platform      'darwin' | 'win32' | 'linux'
 *   hostname      os.hostname()
 *   emit          (event) => void  tell every window ({type:'transfer-changed'})
 *   powerSaveBlocker { start(type), stop(id) }  Electron's (optional)
 *   attention     () => void  flash the frame / bounce the dock (optional)
 *   sheetOpen     () => boolean  is the transfer sheet open in any window
 *   timings, now, timers, createRelayImpl, createTransportImpl, random, sleep   for tests
 * }
 */
function createTransferHub(options) {
  const now = options.now || Date.now;
  const timers = options.timers || { setTimeout, clearTimeout };
  const shared = {};
  const device = () => ({ label: deviceLabel(options.hostname, options.platform), platform: options.platform, appVersion: String(options.version || '') });
  let transport = null;
  if (options.endpoint) {
    const relay = (options.createRelayImpl || createRelay)({ endpoint: options.endpoint, fetch: options.fetch, userAgent: 'Acira/' + options.version, ...(options.relayOptions || {}) });
    transport = (options.createTransportImpl || createTransport)({ relay, device, ...(options.timings ? { timings: options.timings } : {}), ...(options.random ? { random: options.random } : {}), ...(options.sleep ? { sleep: options.sleep } : {}) });
  }

  // ---- the nudge: everything that changes the screen at once, progress at most ten times a second
  let lastSignature = '', lastSent = 0, pending = null;
  const send = () => { pending = null; lastSent = now(); try { options.emit({ type: 'transfer-changed' }); } catch { /* a window that is closing */ } };

  // ---- awake while a transfer is live (prevent-app-suspension: the screen may sleep, the app may not), released when the last one ends
  let blocker = null;
  const syncPower = () => {
    const live = transferActive(shared);
    if (live && blocker === null && options.powerSaveBlocker) { try { blocker = options.powerSaveBlocker.start('prevent-app-suspension'); } catch { blocker = null; } }
    if (!live && blocker !== null) { try { options.powerSaveBlocker.stop(blocker); } catch { /* already stopped */ } blocker = null; }
  };

  // ---- the other computer joined while the sheet is closed: flash the frame (Windows) or bounce the dock (Mac) once
  let lastOutgoing = null;
  const noticeJoin = () => {
    const state = shared.out?.view.state ?? null;
    if (state === 'confirming' && lastOutgoing !== 'confirming' && options.attention && !options.sheetOpen?.()) { try { options.attention(); } catch { /* a courtesy */ } }
    lastOutgoing = state;
  };

  /** The service's `emit`: called on every change. */
  function changed() {
    syncPower();
    noticeJoin();
    const next = signature(shared);
    if (next !== lastSignature || now() - lastSent >= PROGRESS_GAP) {
      lastSignature = next;
      if (pending) { timers.clearTimeout(pending); pending = null; }
      send();
      return;
    }
    if (!pending) pending = timers.setTimeout(send, Math.max(0, PROGRESS_GAP - (now() - lastSent)));
  }

  return {
    shared, device, transport, relay: Boolean(transport), changed,
    /** What every window's service is made with: the same transport, the same bag, the same nudge. */
    serviceDeps: () => ({ transport, shared, emit: changed }),
    /** Quitting: both sessions end (best effort), and the computer may sleep again. */
    async cancelAll() { try { await transport?.cancelAll(); } finally { shared.out = null; shared.inc = null; syncPower(); } },
    dispose() { if (pending) timers.clearTimeout(pending); pending = null; syncPower(); }
  };
}

module.exports = { createTransferHub, deviceLabel, signature, PROGRESS_GAP };
