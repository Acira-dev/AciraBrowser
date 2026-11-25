'use strict';
// A local recording of a touchpad swipe stream, so a person on Windows or Linux whose swipe misbehaves can send us a real one (the golden files for
// tests/touchpad-phases.test.cjs come from these). OFF unless ACIRA_TOUCHPAD_LOG=1 is in the environment; never in a private window. It writes one JSON
// line per event to touchpad-log.jsonl in the user data folder, and nothing leaves the computer. Numbers only, no page data:
//   {k:'h', ...}              once: the system (platform, architecture, Electron and Chromium versions, display size and scale, whether the setting is on)
//   {k:'w', t, s, dx, dy, m, d}  a wheel event: time (ms since the first line), s 'p' page or 'i' sidebar, deltas in DIP, m 1 when Shift/Ctrl/Alt/Meta is held, d deltaMode
//   {k:'m', t, s, type}       a lift or scroll marker Chromium reported: gestureFlingStart, gestureFlingCancel or gestureScrollEnd (nothing else)
//   {k:'e', t, e, ...}        what the swipe did: start, armed, list, select, commit (direction, steps), cancel
// Capped at 3 MB (a final {k:'cap'} line). Pure: the file system and the clock are injected.

const MAX_BYTES = 3 * 1024 * 1024, FLUSH_MS = 300;
const MARKERS = new Set(['gestureFlingStart', 'gestureFlingCancel', 'gestureScrollEnd']);
const EFFECTS = new Set(['start', 'armed', 'list', 'select', 'commit', 'cancel', 'warm']);

const number = value => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : undefined);
const text = (value, allowed) => (typeof value === 'string' && allowed.has(value) ? value : undefined);
const clean = object => { for (const key of Object.keys(object)) if (object[key] === undefined) delete object[key]; return object; };

/** `header()` returns the system facts for the first line. `after`/`clear` are timers (injected for tests). */
function createTouchpadLog({file, fs, now = () => Date.now(), header = () => ({}), after = (fn, ms) => setTimeout(fn, ms), clear = timer => clearTimeout(timer)}) {
  let lines = [], size = 0, timer = null, capped = false, origin = null, wroteHeader = false;
  const stamp = () => { const t = now(); if (origin === null) origin = t; return Math.round((t - origin) * 10) / 10; };

  function push(entry) {
    if (capped) return;
    const line = JSON.stringify(entry) + '\n';
    if (size + line.length > MAX_BYTES) { capped = true; lines.push('{"k":"cap"}\n'); schedule(); return; }
    size += line.length; lines.push(line); schedule();
  }
  function schedule() { if (!timer) { timer = after(() => { timer = null; flush(); }, FLUSH_MS); timer?.unref?.(); } }
  function flush(sync = false) {
    clear(timer); timer = null;
    if (!lines.length) return;
    let out = lines.join(''); lines = [];
    if (!wroteHeader) {
      wroteHeader = true;
      let facts = {};
      try { facts = header() || {}; } catch { /* the header is only a convenience */ }
      out = JSON.stringify(clean({k: 'h', v: 1, platform: typeof facts.platform === 'string' ? facts.platform.slice(0, 12) : undefined, arch: typeof facts.arch === 'string' ? facts.arch.slice(0, 12) : undefined,
        electron: typeof facts.electron === 'string' ? facts.electron.slice(0, 24) : undefined, chrome: typeof facts.chrome === 'string' ? facts.chrome.slice(0, 24) : undefined,
        dw: number(facts.displayWidth), dh: number(facts.displayHeight), scale: number(facts.scale), setting: facts.setting === true})) + '\n' + out;
    }
    try { if (sync) fs.appendFileSync(file, out); else fs.appendFile(file, out, () => {}); } catch { /* a log that cannot be written is silently dropped */ }
  }

  /** One entry from the swipe controller: {k:'w'|'m'|'e', ...}. Only the fields above are kept, as numbers or from fixed lists. */
  function note(entry) {
    if (!entry || typeof entry !== 'object') return;
    const t = stamp();
    if (entry.k === 'w') push(clean({k: 'w', t, s: entry.s === 'i' ? 'i' : 'p', dx: number(entry.dx), dy: number(entry.dy), m: entry.m ? 1 : 0, d: number(entry.d)}));
    else if (entry.k === 'm') { const type = text(entry.type, MARKERS); if (type) push({k: 'm', t, s: entry.s === 'i' ? 'i' : 'p', type}); }
    else if (entry.k === 'e') { const e = text(entry.e, EFFECTS); if (e) push(clean({k: 'e', t, e, direction: entry.direction === 'back' || entry.direction === 'forward' ? entry.direction : undefined, steps: number(entry.steps), index: number(entry.index), count: number(entry.count), on: typeof entry.on === 'boolean' ? entry.on : undefined})); }
  }
  return {note, flush: () => flush(false), dispose: () => flush(true), get size() { return size; }, get capped() { return capped; }};
}

module.exports = {createTouchpadLog, MAX_BYTES};
