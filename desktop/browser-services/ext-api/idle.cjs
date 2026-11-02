'use strict';
// chrome.idle (P9). Main side. Chrome's rules (extensions/browser/api/idle): the state is "locked" while the screen is locked, "idle" once the
// system has had no input for the detection interval (default 60 s, never below 15 s, set per extension with setDetectionInterval), "active"
// otherwise. onStateChanged fires on every change of that state for an extension that listens; the system is looked at once a second while some
// extension listens, and only every few seconds (to notice a first listener) otherwise, so an idle browser does not wake up for it.
const DEFAULT_INTERVAL = 60, MIN_INTERVAL = 15;
const STATES = ['active', 'idle', 'locked'];

/** The idle logic over a power source ({getSystemIdleState(seconds)}), so tests can drive it. */
function createIdle({source, listening, emit, setTimer = setTimeout, clearTimer = clearTimeout, busyMs = 1000, restMs = 5000}) {
  const intervals = new Map(), last = new Map();
  let timer = null, stopped = false;
  const seconds = value => Math.max(MIN_INTERVAL, Math.round(Number(value)) || DEFAULT_INTERVAL);
  const stateFor = interval => {
    try { const state = source().getSystemIdleState(seconds(interval)); return STATES.includes(state) ? state : 'active'; } catch { return 'active'; }
  };
  function check() {
    const ids = new Set(listening());
    for (const id of [...last.keys()]) if (!ids.has(id)) last.delete(id);   // a monitor lives while the extension listens
    for (const id of ids) {
      const state = stateFor(intervals.get(id));
      if (!last.has(id)) { last.set(id, state); continue; }
      if (last.get(id) !== state) { last.set(id, state); emit(id, state); }
    }
    return ids.size;
  }
  function tick() {
    timer = null; if (stopped) return;
    let busy = 0; try { busy = check(); } catch { busy = 0; }
    timer = setTimer(tick, busy ? busyMs : restMs); timer.unref?.();
  }
  return {
    start() { if (!timer && !stopped) { timer = setTimer(tick, restMs); timer.unref?.(); } },
    stop() { stopped = true; if (timer) clearTimer(timer); timer = null; },
    check,
    queryState: value => stateFor(value),
    setDetectionInterval(id, value) { intervals.set(id, seconds(value)); last.delete(id); },
    forget(id) { intervals.delete(id); last.delete(id); },
    interval: id => intervals.get(id) || DEFAULT_INTERVAL
  };
}

module.exports = {
  namespaces: ['idle'],
  createIdle,
  install(api) {
    const power = () => require('electron').powerMonitor;
    const idle = createIdle({source: power, listening: () => api.listening('idle.onStateChanged'), emit: (id, state) => api.emit(id, 'idle.onStateChanged', state)});
    api.handle('idle.queryState', (event, value) => idle.queryState(value));
    api.handle('idle.setDetectionInterval', (event, value) => { idle.setDetectionInterval(event.extension.id, value); });
    // idle.getAutoLockDelay is ChromeOS-only in Chromium 152: not bound for extensions on Windows.
    idle.start();
    // A lock or unlock is reported at once instead of at the next look.
    let detach = () => {};
    try {
      const monitor = power(), onChange = () => { try { idle.check(); } catch { /* next tick */ } };
      monitor.on('lock-screen', onChange); monitor.on('unlock-screen', onChange);
      detach = () => { monitor.removeListener('lock-screen', onChange); monitor.removeListener('unlock-screen', onChange); };
    } catch { /* no power monitor (tests) */ }
    return {forget: id => idle.forget(id), dispose() { idle.stop(); detach(); }};
  }
};
