'use strict';
// Mac readiness (docs/launch/MAC_PORTING.md): every Windows-only API in desktop/ must sit behind a platform check, so `npm start` on macOS
// reaches a window instead of dying on `app.setAppUserModelId is not a function`. A use passes when the 500 characters of code before it
// check the platform (process.platform / platform ===), uses optional chaining or a typeof guard, or when the file is on the
// short allowlist below (modules that are only ever loaded on Windows or are themselves the guard).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..', 'desktop');

// Windows-only Electron APIs (undefined on macOS/Linux, so calling them throws), and Windows-only programs.
const WINDOWS_ONLY = [
  /\.setAppUserModelId\(/, /\.setUserTasks\(/, /\.setJumpList\(/, /\.getJumpListSettings\(/,
  /\.setThumbarButtons\(/, /\.setThumbnailClip\(/, /\.setThumbnailToolTip\(/, /\.setOverlayIcon\(/, /\.setAppDetails\(/,
  /\.setTitleBarOverlay\(/, /\.setBackgroundMaterial\(/, /\.hookWindowMessage\(/, /\.isWindowMessageHooked\(/,
  /\.writeShortcutLink\(/, /\.readShortcutLink\(/,
  /\b(?:execFile|execFileSync|exec|execSync|spawn|spawnSync)\(\s*['"`](?:tasklist|taskkill|reg|reg\.exe|cmd|cmd\.exe|powershell|powershell\.exe|wmic|wmic\.exe|schtasks|icacls|attrib)['"`]/,
  /['"`]tasklist['"`]/,
];
const GUARD = /process\.platform|\bplatform\s*[!=]==?|win32|darwin|\?\.\(|\?\.[A-Za-z_]|typeof [\w.]+\s*[!=]==?\s*['"]function['"]|isWindows|IS_WIN/;
// Files that are the guard themselves or only load on Windows.
const ALLOW = new Map([
  ['platform.cjs', 'the window chrome table: takes the platform as an argument'],
  [path.join('passwords', 'gate.cjs'), 'Windows Hello gate; windowsVerifier() returns unavailable when platform !== win32'],
  [path.join('accounts', 'default-browser.cjs'), 'registry reads return null unless win32 (see the checks at the top of each function)'],
]);

function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : files(path.join(dir, e.name))) : e.name.endsWith('.cjs') ? [path.join(dir, e.name)] : []); }

test('Windows-only APIs and programs in desktop/ are behind a platform guard', () => {
  const bad = [];
  for (const file of files(root)) {
    const relative = path.relative(root, file);
    if (ALLOW.has(relative)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const text = lines.join('\n');
    lines.forEach((line, index) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return; // comments
      for (const pattern of WINDOWS_ONLY) {
        const hit = pattern.exec(line);
        if (!hit) continue;
        // 500 characters of code before the call itself (the long one-line modules put the guard on the same line, before the call)
        const offset = lines.slice(0, index).reduce((n, l) => n + l.length + 1, 0) + hit.index;
        const before = text.slice(Math.max(0, offset - 500), offset + hit[0].length);
        if (!GUARD.test(before)) bad.push(`${relative}:${index + 1}  ${line.trim().slice(Math.max(0, hit.index - 40), hit.index + 80)}`);
        break;
      }
    });
  }
  assert.deepEqual(bad, [], 'Windows-only call without a platform guard (add one, or explain it in ALLOW):\n' + bad.join('\n'));
});

test('the guard test knows the APIs that crashed a Mac boot', () => {
  const sample = ["app.setAppUserModelId('x')", "win.setThumbarButtons([])", "execFile('tasklist', [])"];
  for (const line of sample) assert.ok(WINDOWS_ONLY.some(pattern => pattern.test(line)), line);
});
