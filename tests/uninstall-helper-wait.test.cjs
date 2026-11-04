'use strict';
// beta.10: the uninstall helper's silent run waits for the real uninstaller until it ends, with no time limit. electron-builder removes the old
// version during an update by running the UninstallString (AciraRemove.exe, this helper) with /S, and runs it again a second after any answer
// but 0. Round 2 gave the wait a 15-minute limit (the remover part of the co-founder's ea5ea64b); the review took it out again: the helper starts
// its own copy of the real uninstaller each time, so an answer while one still ran started a second one on the same folder, and after five tries
// the setup left. If the first then finished, the old version was gone with nothing to install the new one. No C# compiler runs here, so the
// source is held to the rule, and electron-builder's own template and our result macro show why.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const REMOVER = read('packaging', 'installer', 'AciraUninstall.cs');
const NSH = read('packaging', 'acira-installer.nsh');
const between = (text, start, end) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const j = text.indexOf(end, i); assert.ok(j > i, end); return text.slice(i, j); };
const silent = () => between(REMOVER, '    if (silent) {', '\n    }\n');

test('a silent run waits for the real uninstaller until it ends: no time limit, and it is never ended', () => {
  const block = silent();
  assert.match(block, /var p = Process\.Start\(new ProcessStartInfo\(run, rest\) \{ UseShellExecute = false, WorkingDirectory = Path\.GetTempPath\(\) \}\);/, 'same arguments as before');
  assert.match(block, /\n\s+p\.WaitForExit\(\); return p\.ExitCode;\n/, 'the uninstaller\'s own answer, once it has ended');
  assert.doesNotMatch(block, /WaitForExit\(\s*[^)\s]/, 'no time limit');
  assert.doesNotMatch(block, /return 4;/, 'no answer of its own while the uninstaller still runs');
  // electron-builder's uninstaller moves the old files aside and puts them back if it fails (un.atomicRMDir): ended mid-way, it could strand the
  // old version's files in its temp folder
  assert.doesNotMatch(block, /\.Kill\(|TerminateProcess/);
  assert.match(read('node_modules', 'app-builder-lib', 'templates', 'nsis', 'uninstaller.nsh'), /Function un\.atomicRMDir[\s\S]*Rename "\$INSTDIR\$R0\\\$R2" "\$PLUGINSDIR\\old-install\$R0\\\$R2"/);
  // the rest of the pass-through is as it was: nothing to run is 2, a failed start is 2, the copy for _?= is removed afterwards
  assert.match(block, /if \(real == null\) return 2;/);
  assert.match(block, /\} catch \{ return 2; \}\n\s+finally \{ try \{ if \(temp != null\) File\.Delete\(temp\); \} catch \{ \} \}/);
  // C# 5 (csc from the .NET Framework 4)
  assert.doesNotMatch(block, /out var |\?\.|\$"/);
});

test('why no limit: the setup runs the helper again after any answer but 0, each run starts its own uninstaller, and after five tries the setup leaves', () => {
  const util = read('node_modules', 'app-builder-lib', 'templates', 'nsis', 'include', 'installUtil.nsh');
  const loop = between(util, 'Function uninstallOldVersion', 'FunctionEnd');
  // the UninstallString is this helper; electron-builder runs a copy of it silently, with the old install folder pinned
  assert.match(loop, /readReg \$uninstallString "\$rootKey" "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString/);
  assert.match(loop, /ExecWait '"\$uninstallerFileNameTemp" \/S \/KEEP_APP_DATA \$0 _\?=\$installationDir' \$R0/);
  assert.match(NSH, /WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString '"\$INSTDIR\\AciraRemove\.exe" \/currentuser'/);
  // with _?= the helper copies the real uninstaller to a name of its own process: a second run while the first one's copy still ran would
  // start a second uninstaller on the same folder
  assert.match(silent(), /if \(pinned != null\) \{ temp = Path\.Combine\(Path\.GetTempPath\(\), "acira-old-uninstaller-" \+ Process\.GetCurrentProcess\(\)\.Id \+ "\.exe"\);/);
  // any answer but 0 is tried again after a second; the sixth time a box with a silent default (Cancel) ends the loop
  assert.match(loop, /CheckResult:\s+\$\{if\} \$R0 == 0\s+Return\s+\$\{endIf\}\s+Sleep 1000\s+Goto UninstallLoop/);
  assert.match(loop, /\$\{if\} \$R5 > 5\s+MessageBox MB_RETRYCANCEL\|MB_ICONEXCLAMATION "\$\(appCannotBeClosed\)" \/SD IDCANCEL IDRETRY OneMoreAttempt\s+Return/);
  // then our result macro: exit code 2 (the box only for a person running setup), and Install now opens the old version again. Both count on the
  // old uninstaller having ended, finished or rolled back, which is only so while the helper answers after it ends.
  const section = read('node_modules', 'app-builder-lib', 'templates', 'nsis', 'installSection.nsh');
  assert.match(section, /!insertmacro uninstallOldVersion SHELL_CONTEXT\n!insertmacro handleUninstallResult SHELL_CONTEXT/);
  assert.match(util, /"SHELL_CONTEXT"\s+!ifmacrodef customUnInstallCheck\s+!insertmacro customUnInstallCheck\s+Return/);
  assert.match(NSH, /the old version is untouched \(its uninstaller removes\n; atomically\)\. Install now \(--force-run\) opens that old version again/);
  const check = between(NSH, '!macro customUnInstallCheck\n', '!macro customUnInstallCheckCurrentUser');
  assert.match(check, /\$\{IfNot\} \$\{Errors\}\s+\$\{AndIf\} \$R0 != 0/);
  assert.match(check, /\$\{If\} \$\{Errors\}\s+\$\{AndIfNot\} \$\{Silent\}\s+MessageBox MB_OK\|MB_ICONEXCLAMATION "\$\(uninstallFailed\): \$R0"/);
  assert.match(check, /\$\{GetOptions\} \$R1 "--force-run" \$R2\s+\$\{IfNot\} \$\{Errors\}\s+Exec '"\$INSTDIR\\\$\{AC_APP_EXE\}"'/);
  assert.match(check, /SetErrorLevel 2\s+Quit/);
});
