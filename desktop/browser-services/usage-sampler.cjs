'use strict';
// Sampling for the daily usage message (schema 4, Beta 14): active time, memory, and the few facts about this computer that are asked once. Everything is reduced to a
// number or a yes/no here and to a bucket in usage-facts.cjs; nothing that names a person, a file or an app leaves this module. All the outside world (the app, the
// screen, the power monitor, a process to read the Dock) is passed in, so the tests run it with fakes.
const path = require('node:path');

const TICK_MS = 30000;
const IDLE_LIMIT_S = 60;
const MEMORY_EVERY = 10; // a memory sample every 10th tick (5 minutes)

/** Active time and memory. A tick counts 30 s of use only while a window of Acira is focused and the computer has not been idle for a minute. */
function createUsageSampler({ metrics, app, powerMonitor, BrowserWindow, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let timer = null, ticks = 0;
  const focused = () => { try { return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused()); } catch { return false; } };
  const idle = () => { try { return Number(powerMonitor.getSystemIdleTime()); } catch { return 0; } };
  function tick() {
    ticks++;
    try { if (focused() && idle() < IDLE_LIMIT_S) metrics.noteActive(TICK_MS / 1000); } catch { /* counting must never disturb the browser */ }
    if (ticks % MEMORY_EVERY === 1) {
      try { const total = app.getAppMetrics().reduce((sum, item) => sum + Number(item?.memory?.workingSetSize || 0), 0) * 1024; if (total > 0) metrics.noteMemory(total); } catch { /* ignore */ }
    }
  }
  return {
    start() { if (timer) return; timer = setIntervalFn(tick, TICK_MS); timer.unref?.(); },
    stop() { if (timer) clearIntervalFn(timer); timer = null; },
    tick,
  };
}

/** Whether Acira's shortcut is pinned to the Windows taskbar: the taskbar's own folder of pinned shortcuts holds a .lnk whose name says Acira. Never lists anything else. */
function pinnedToTaskbar({ platform, env, fs, productName }) {
  if (platform !== 'win32') return undefined;
  try {
    const folder = path.join(env.APPDATA || '', 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
    if (!env.APPDATA || !fs.existsSync(folder)) return false;
    const needle = String(productName || 'Acira').toLowerCase().split(' ')[0];
    return fs.readdirSync(folder).some((name) => name.toLowerCase().endsWith('.lnk') && name.toLowerCase().includes(needle));
  } catch { return undefined; }
}
/** Whether Acira is in the macOS Dock: the Dock's own preferences list the apps it holds by bundle id; only Acira's id is looked for and nothing else is kept. */
function inDock({ platform, readDockJson, bundleId }) {
  if (platform !== 'darwin' || !bundleId) return undefined;
  try {
    const json = readDockJson(); if (typeof json !== 'string' || !json) return undefined;
    const tiles = JSON.parse(json)['persistent-apps'];
    return Array.isArray(tiles) ? tiles.some((tile) => tile?.['tile-data']?.['bundle-identifier'] === bundleId) : false;
  } catch { return undefined; }
}
/** gpu_compositing's own word: 'enabled…' is on, a word with 'disabled' is off, anything else is unknown. */
const gpuOn = (status) => { const text = String(status && status.gpu_compositing || ''); return text.startsWith('enabled') ? true : text.includes('disabled') ? false : undefined; };

/** The raw facts about this computer for the message. Each is true/false/number or undefined (unknown); the message maps them to closed lists. */
function systemFacts({ app, screen, platform, env = {}, fs, productName, bundleId, readDockJson, filterUpdatedAt, updaterStatus, now = Date.now }) {
  const facts = {};
  try { facts.defaultBrowser = Boolean(app.isDefaultProtocolClient('https')); } catch { /* unknown */ }
  facts.pinnedToTaskbar = pinnedToTaskbar({ platform, env, fs, productName });
  facts.inDock = inDock({ platform, readDockJson, bundleId });
  try { facts.gpuAccel = gpuOn(app.getGPUFeatureStatus()); } catch { /* unknown */ }
  try { const primary = screen.getPrimaryDisplay(); facts.displayScale = primary.scaleFactor; facts.monitors = screen.getAllDisplays().length; } catch { /* unknown */ }
  try { const at = typeof filterUpdatedAt === 'function' ? filterUpdatedAt() : undefined; const time = typeof at === 'number' ? at : Date.parse(at); if (Number.isFinite(time)) facts.filterListsUpdated = now() - time < 7 * 86400000; } catch { /* unknown */ }
  try { const status = typeof updaterStatus === 'function' ? updaterStatus() : undefined; if (status && typeof status === 'object') facts.updateFailed = status.status === 'error'; } catch { /* unknown */ }
  return facts;
}

module.exports = { createUsageSampler, systemFacts, pinnedToTaskbar, inDock, gpuOn, TICK_MS, IDLE_LIMIT_S };
