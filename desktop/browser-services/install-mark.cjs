'use strict';
// Beta 14, brief B9: one install is counted once. Two small marks decide whether a message may say `firstEver` and whether it is a returning install. Neither is an id.
//
// 1. The first-message mark, in the user data folder: `<userData>/usage-mark.json` {"sent":true,"last":"YYYY-MM-DD"}. It says that a first message was sent from this data folder, and the UTC day of the
//    latest one. Not the install folder (an update replaces it) and not page storage. So an update, a repair, the same or a newer installer over an existing install, a reinstall that keeps data, and
//    turning sharing off and on again all find it and never send `firstEver` again (they are `updateFrom` / `updateResult` only). It carries no id, no time and no version. It is not deleted when sharing
//    is turned off (that is what makes turning it back on count once); it goes with the data folder. An install from before this file existed is read from metrics.json's `lastSent`.
// 2. The "installed here before" marker, outside the data folder, for a wipe and reinstall: a yes/no with no id, no date and no version.
//    - Windows: the uninstaller leaves `HKCU\Software\AciraBrowserInstalledBefore` `InstalledBefore` = 1 when the person chooses "Remove and delete my data" (packaging/installer/AciraUninstall.cs and
//      packaging/acira-installer.nsh). The app only reads it.
//    - macOS: there is no uninstaller (dragging the app to the Trash runs nothing), so the app writes a preferences value (`defaults` domain = the bundle id, key `InstalledBefore`) when its first message
//      has been sent, and reads it.
//    - Elsewhere: none.
//    The next first-ever message of an install whose data folder was wiped carries `returning: 'yes'`, so it is counted as a returning install, not as a new person. Both marks are listed on acira://usage.
//    A test profile (ACIRA_BROWSER_TEST_DATA) never touches the real registry or preferences: it uses the file named by ACIRA_RETURNING_MARK_FILE, or nothing.
const fs = require('node:fs'), path = require('node:path'), { execFile } = require('node:child_process');

const FILE = 'usage-mark.json';
const WINDOWS_KEY = 'HKCU\\Software\\AciraBrowserInstalledBefore', WINDOWS_VALUE = 'InstalledBefore';
const MAC_KEY = 'InstalledBefore';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What the data folder remembers: whether a first message was ever sent, and the day of the latest. Never throws; a missing, odd or unreadable file is "nothing sent". */
function readMark(directory, io = fs) {
  try {
    const saved = JSON.parse(io.readFileSync(path.join(directory, FILE), 'utf8'));
    return { sent: Boolean(saved && saved.sent === true), last: saved && typeof saved.last === 'string' && DAY.test(saved.last) ? saved.last : '' };
  } catch { return { sent: false, last: '' }; }
}
/** Records that a message was sent on `day` (UTC). Never throws: a folder that cannot be written only means the next start asks again. Returns whether it was written. */
function writeMark(directory, day, io = fs) {
  try {
    if (!DAY.test(String(day))) return false;
    io.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, FILE);
    io.writeFileSync(file + '.tmp', JSON.stringify({ sent: true, last: day })); io.renameSync(file + '.tmp', file);
    return true;
  } catch { return false; }
}

const run = (command, args, exec) => new Promise((resolve) => { try { exec(command, args, { encoding: 'utf8', windowsHide: true, timeout: 2500 }, (error, output) => resolve(error ? null : String(output))); } catch { resolve(null); } });

/** The "installed here before" marker for this platform. `get()` is true only when the marker is there; `leave()` writes it (macOS only: on Windows the uninstaller writes it). Both are async and never throw. */
function createReturningMark({ platform = process.platform, bundleId = '', testFile, testData = false, exec = execFile } = {}) {
  if (testData) { // a test profile: a file stands in for the registry or the preferences, or there is nothing
    const file = typeof testFile === 'string' && testFile ? testFile : '';
    return { kind: file ? 'test file' : 'none', get: async () => Boolean(file) && fs.existsSync(file),
      leave: async () => { if (file && platform === 'darwin') { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '1'); } catch { /* nothing to leave */ } } } };
  }
  if (platform === 'win32') {
    return { kind: 'registry', get: async () => /REG_DWORD\s+0x0*1\b/.test((await run('reg.exe', ['query', WINDOWS_KEY, '/v', WINDOWS_VALUE], exec)) || ''), leave: async () => {} };
  }
  if (platform === 'darwin' && /^[A-Za-z0-9.-]{3,100}$/.test(bundleId)) {
    return { kind: 'preferences',
      get: async () => /^\s*(1|true|yes)\s*$/i.test((await run('/usr/bin/defaults', ['read', bundleId, MAC_KEY], exec)) || ''),
      leave: async () => { await run('/usr/bin/defaults', ['write', bundleId, MAC_KEY, '-bool', 'true'], exec); } };
  }
  return { kind: 'none', get: async () => false, leave: async () => {} };
}

module.exports = { FILE, WINDOWS_KEY, WINDOWS_VALUE, MAC_KEY, readMark, writeMark, createReturningMark };
