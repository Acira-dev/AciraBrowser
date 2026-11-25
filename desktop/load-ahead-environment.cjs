'use strict';
// Beta 14: the machine facts that stop "load ahead": battery saver, low memory, a metered connection. Each answer is kept for ENV_TTL_MS, and
// every probe that cannot tell (no such tool, a timeout, an odd answer) says "fine": loading ahead is the optional extra, but a guess that stops
// it for no reason would be a bug nobody could find. Platform support, honestly:
//   battery saver: macOS Low Power Mode (pmset), Linux power-saver profile (powerprofilesctl)
//   metered:       Linux (NetworkManager); macOS gives an app no such flag, so it is not detected there
//   Windows:       Battery Saver and a metered connection are NOT detected: Windows answers both only through its own APIs, and the ways to ask from
//                  here are a script host (Acira starts none: tests/no-script-host.test.cjs) or Acira's signed helper, which has no such job yet.
//                  Memory pressure is still checked on Windows (below), so there loading ahead stops for memory only.
//   memory:        macOS: the system's own pressure level (sysctl kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical; the "free pages"
//                  count of a Mac is nearly always tiny, so it says nothing); Windows and Linux: the memory saver's "under pressure" rule
//                  (desktop/tab-sleep.cjs underPressure) on Electron's system memory info
const { execFile } = require('node:child_process');
const { underPressure } = require('./tab-sleep.cjs');
const { ENV_TTL_MS } = require('./load-ahead.cjs');


const defaultRun = (file, args, timeout = 4000) => new Promise(resolve => {
  try { execFile(file, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout || ''))); } catch { resolve(''); }
});

/** Pure readers of what each tool says (tested with canned output). */
const readers = {
  macLowPower: out => /\blowpowermode\s+1\b/i.test(out),
  macPressure: out => Number.parseInt(String(out).trim(), 10) >= 2,
  linuxSaver: out => String(out).trim() === 'power-saver',
  linuxMetered: out => /METERED:\s*(yes|guess-yes)/i.test(out),
};

/** `memory()` is Electron's process.getSystemMemoryInfo() (KB); `run(file, args, timeoutMs)` answers the tool's text. Resolves to
 *  null (fine) or the reason loading must stop: 'battery-saver' | 'memory' | 'metered'. */
function createEnvironmentProbe({ platform = process.platform, run = defaultRun, memory = () => process.getSystemMemoryInfo(), now = Date.now, ttl = ENV_TTL_MS } = {}) {
  let at = -Infinity, last = null, inflight = null;
  const saver = async () => {
    if (platform === 'darwin') return readers.macLowPower(await run('/usr/bin/pmset', ['-g'], 2500));
    if (platform === 'linux') return readers.linuxSaver(await run('powerprofilesctl', ['get'], 2500));
    return false;
  };
  const metered = async () => {
    if (platform === 'linux') return readers.linuxMetered(await run('nmcli', ['-t', '-f', 'GENERAL.METERED', 'device', 'show'], 2500));
    return false;
  };
  const low = async () => {
    try {
      if (platform === 'darwin') return readers.macPressure(await run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], 1500));
      const info = memory(); return Boolean(info) && underPressure({ free: Number(info.free) * 1024, total: Number(info.total) * 1024 });
    } catch { return false; }
  };
  async function ask() {
    if (await low()) return 'memory';
    try { if (await saver()) return 'battery-saver'; } catch { /* cannot tell: fine */ }
    try { if (await metered()) return 'metered'; } catch { /* cannot tell: fine */ }
    return null;
  }
  return async function environment() {
    if (now() - at < ttl) return last;
    if (inflight) return inflight;
    inflight = ask().then(answer => { last = answer; at = now(); return answer; }, () => null).finally(() => { inflight = null; });
    return inflight;
  };
}

module.exports = { createEnvironmentProbe, readers };
