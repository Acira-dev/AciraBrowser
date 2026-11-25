'use strict';
// Beta 14.4 live wallpaper (battery, this release's first aim): whether the computer runs on battery and whether macOS Low Power Mode is on, for the
// New Tab's video (src/ui/liveWallpaper.ts pauses it). Battery comes from Electron's powerMonitor (its on-battery / on-ac events). Electron has no
// Low Power Mode API: on macOS `pmset -g` says `lowpowermode 1`; it is read when the interface asks (a New Tab with a video showing, then once a
// minute while that video plays) and on power events, never on a timer of its own. Windows' battery saver has no Electron API either: there the
// battery rule (Play on battery off by default) covers it. Main says changes to the interface as `{type:'power-state', onBattery, lowPower}`.
// Keep this file ASCII only (main's script text stays one byte per character).
const { execFile } = require('node:child_process');

/** `pmset -g` output -> whether Low Power Mode is on. Pure. */
const lowPowerFromPmset = text => /^\s*lowpowermode\s+1\s*$/m.test(String(text || ''));

function createPowerState({ powerMonitor, emit, platform = process.platform, run = (cb) => execFile('/usr/bin/pmset', ['-g'], { timeout: 2000 }, cb) }) {
  let onBattery = false, lowPower = false, asking = false, faked = false;
  try { onBattery = powerMonitor.isOnBatteryPower() === true; } catch {}
  const send = () => { try { emit({ type: 'power-state', onBattery, lowPower }); } catch {} };
  const readLowPower = () => {
    if (platform !== 'darwin' || asking || faked) return;
    asking = true;
    run((error, stdout) => { asking = false; const next = !error && lowPowerFromPmset(stdout); if (next !== lowPower) { lowPower = next; send(); } });
  };
  const battery = value => () => { if (faked) return; if (onBattery !== value) { onBattery = value; send(); } readLowPower(); };
  powerMonitor.on('on-battery', battery(true));
  powerMonitor.on('on-ac', battery(false));
  for (const name of ['resume', 'unlock-screen', 'thermal-state-change', 'speed-limit-change']) powerMonitor.on(name, readLowPower);
  readLowPower();
  return {
    /** The interface asks (a New Tab with a video showing): the current answer at once, and Low Power Mode read again behind it. */
    state() { readLowPower(); return { onBattery, lowPower }; },
    /** Test mode only (the hidden rig): set what the Mac would say. */
    fake(patch) { faked = true; if (typeof patch?.onBattery === 'boolean') onBattery = patch.onBattery; if (typeof patch?.lowPower === 'boolean') lowPower = patch.lowPower; send(); return { onBattery, lowPower }; },
  };
}

module.exports = { createPowerState, lowPowerFromPmset };
