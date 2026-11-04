'use strict';
// A small local log in the profile folder (<user data>/logs/blocked.log) for the few lines a bug report needs, such as which host a phishing list blocked
// on a page. A packaged Acira writes its console nowhere, so without this a blocked resource (Netflix's video, 2 Nov) failed without a trace. Nothing is
// sent anywhere. Bounded: past `maxBytes` the older half is dropped. Never throws.
// It was logs/main.log until beta.10, a second file of that name beside <user data>/main.log (main-process errors, process-errors.cjs); a profile's
// old logs/main.log becomes blocked.log the first time a line is written, so one name means one file.
const fs = require('node:fs'), path = require('node:path');
function createMainLog({ directory, io = fs, now = () => new Date(), maxBytes = 1024 * 1024, echo = line => console.warn(line) }) {
  const file = path.join(directory, 'blocked.log'); let moved = false;
  return function log(line) {
    const text = `${now().toISOString()} ${String(line).replace(/[\r\n]+/g, ' ').slice(0, 1000)}\n`;
    try { echo(line); } catch { /* the console may be gone at quit */ }
    try {
      io.mkdirSync(directory, { recursive: true });
      if (!moved) { moved = true; try { if (!io.existsSync(file)) io.renameSync(path.join(directory, 'main.log'), file); } catch { /* none from an older Acira */ } }
      let size = 0; try { size = io.statSync(file).size; } catch { /* first line */ }
      if (size + text.length > maxBytes) { const kept = io.readFileSync(file, 'utf8').slice(-Math.floor(maxBytes / 2)); io.writeFileSync(file, kept.slice(kept.indexOf('\n') + 1)); }
      io.appendFileSync(file, text);
    } catch { /* a read-only profile keeps working */ }
  };
}
module.exports = { createMainLog };
