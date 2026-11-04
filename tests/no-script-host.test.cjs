'use strict';
// Acira never starts a script host on Windows. A Windows user's antivirus (Norton) deleted Acira the moment it asked for his password to
// open a locked workspace: the check ran in a hidden powershell.exe with -ExecutionPolicy Bypass -EncodedCommand, compiled C# with
// Add-Type and showed a Windows credential prompt, which is what credential-stealing malware does. The Windows-only jobs now run in
// Acira's own signed helper (desktop/windows-helper.cjs, packaging/installer/AciraVerify.cs). This fails when anything in desktop/
// names a script host or interpreter again, or a script file it could write and run.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const desktop = path.resolve(__dirname, '..', 'desktop');

const SCRIPT_HOSTS = [
  [/powershell/i, 'PowerShell'], [/\bpwsh\b/i, 'PowerShell 7'], [/add-type/i, 'PowerShell Add-Type (compiles code at run time)'],
  [/encodedcommand/i, 'an encoded PowerShell command'], [/executionpolicy/i, 'a PowerShell execution policy'],
  [/\bcsc(?:\.exe)?\b/i, 'the C# compiler'], [/\bvbc(?:\.exe)?\b/i, 'the VB compiler'], [/\bmsbuild\b/i, 'MSBuild'],
  [/\b[wc]script(?:\.exe)?\b/i, 'Windows Script Host'], [/\bmshta\b/i, 'HTML applications'],
  [/\bcmd\.exe\b/i, 'the command prompt'], [/\bComSpec\b/i, 'the command prompt'], [/['"`]\/[ck]['"`]/i, 'a command prompt /c'],
  // any case, except 'Cmd' written as the Mac key's name in shortcut labels
  [/['"`](?!Cmd['"`])cmd['"`]/i, 'the command prompt'],
  // child_process.exec and execSync always run their command through cmd.exe /d /s /c on Windows (execFile and spawn do not)
  [/\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*(?:=\s*require\(\s*|from\s*)['"`](?:node:)?child_process['"`]/, 'child_process.exec (a command prompt)'],
  [/require\(\s*['"`](?:node:)?child_process['"`]\s*\)\s*\.\s*exec(?:Sync)?\b/, 'child_process.exec (a command prompt)'],
  [/\b(?:child_?process|childProcess|cp)\s*\.\s*exec(?:Sync)?\s*\(/i, 'child_process.exec (a command prompt)'],
  [/\brundll32\b/i, 'rundll32'], [/\bregsvr32\b/i, 'regsvr32'], [/\bwmic\b/i, 'WMIC'], [/\binstallutil\b/i, 'InstallUtil'], [/\bcertutil\b/i, 'certutil'], [/\bbitsadmin\b/i, 'BITS'],
  [/['"`][^'"`\n]*\.(?:ps1|psm1|vbs|vbe|wsf|wsh|hta|jse|bat|cmd)['"`]/i, 'a script file'],
];
// The only places a pattern may appear, and exactly where.
const ALLOWED = {
  // Detection rules for websites that tell people to paste these commands ("ClickFix"); data, never run.
  [path.join('browser-services', 'page-risk.cjs')]: { lines: null, why: 'page-risk patterns' },
  // An extension's native messaging host that its own installer registered as a .bat or .cmd file runs through cmd.exe /d /s /c, as Chrome
  // runs every Windows native host. Only that branch: Acira writes no script, and an .exe host starts directly.
  [path.join('browser-services', 'native-messaging.cjs')]: { lines: [/^\/\/  - the host gets the extension origin and --parent-window, and \.bat\/\.cmd hosts run through cmd\.exe\.$/, /^  return spawn\(process\.env\.ComSpec\|\|'cmd\.exe',\['\/d','\/s','\/c',/], why: 'registered .bat/.cmd native hosts' },
};

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(file);
    return /\.(?:c?js|mjs|ts|html)$/.test(entry.name) ? [file] : [];
  });
}

test('nothing in desktop/ starts PowerShell, a command prompt, a compiler or a script host, or names a script file to run', () => {
  const found = [];
  for (const file of sources(desktop)) {
    const relative = path.relative(desktop, file), allowed = ALLOWED[relative];
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      for (const [pattern, what] of SCRIPT_HOSTS) {
        if (!pattern.test(line)) continue;
        if (allowed && (allowed.lines === null || allowed.lines.some((ok) => ok.test(line)))) continue;
        found.push(`${relative}:${index + 1} ${what}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

test('the two allowed files stay as narrow as described', () => {
  const risk = fs.readFileSync(path.join(desktop, 'browser-services', 'page-risk.cjs'), 'utf8');
  assert.doesNotMatch(risk, /child_process|\bspawn\b|\bexec(?:File)?(?:Sync)?\(|\bfork\(/, 'page-risk only matches text');
  const native = fs.readFileSync(path.join(desktop, 'browser-services', 'native-messaging.cjs'), 'utf8');
  assert.equal(native.match(/ComSpec/g).length, 1, 'one command prompt start');
  const branch = native.slice(native.indexOf('function launch('), native.indexOf('\n}\n', native.indexOf('function launch(')));
  assert.match(branch, /if\(process\.platform==='win32'&&\/\\\.\(bat\|cmd\)\$\/i\.test\(exe\)\)\{[\s\S]*ComSpec[\s\S]*\}\s*return spawn\(exe,args,\{shell:false/, 'only for a .bat/.cmd host; every other host starts directly');
  assert.doesNotMatch(native, /writeFile|appendFile|createWriteStream/, 'it never writes the host it runs');
});

test('the Windows identity check, browser icons and VPN signatures all go through Acira\'s own helper', () => {
  const read = (...parts) => fs.readFileSync(path.join(desktop, ...parts), 'utf8');
  for (const [file, job] of [[['passwords', 'gate.cjs'], /runHelper\(\[command,windowHandle\(win\)\]/], [['browser-services', 'browser-icons.cjs'], /runHelper\(\['icon'\], file,/], [['browser-services', 'vpn-control.cjs'], /runHelper\(\['signature'\], file,/]]) {
    const text = read(...file);
    assert.match(text, job, file.join('/'));
    assert.doesNotMatch(text, /System32|WindowsPowerShell|\$env:|-NoProfile|-Command\b/, file.join('/') + ' has no script left');
  }
  const helper = read('windows-helper.cjs');
  assert.match(helper, /exec\(helper,args,\{windowsHide:true,timeout:timeoutMs,maxBuffer,env,encoding:'utf8'\}/, 'started directly: no shell, the input on stdin');
  assert.doesNotMatch(helper, /shell:\s*true|spawn\(\s*['"`]|writeFile/);
  // a shell would hand the command line to cmd.exe; no child process in desktop/ asks for one
  const shells = sources(desktop).filter((file) => /shell\s*:\s*true/.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(desktop, file));
  assert.deepEqual(shells, []);
});

test('the scan itself catches what it is for', () => {
  const hits = (line) => SCRIPT_HOSTS.filter(([pattern]) => pattern.test(line)).map(([, what]) => what);
  for (const line of [
    "execFile('C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe',['-EncodedCommand',x])",
    "spawn('PWSH',['-c','x'])", "const {exec}=require('node:child_process')", "const {execFile, execSync}=require('child_process')",
    "import {exec} from 'node:child_process'", "require('child_process').exec('dir')", "childProcess.execSync('whoami')", "cp.exec(command)",
    "spawn('CMD',['/c','x'])", "spawn(process.env.COMSPEC)", "spawn('cmd.exe')", "'Add-Type -TypeDefinition'", "fs.writeFileSync(dir+'\\\\run.ps1',code)",
  ]) assert.ok(hits(line).length, line);
  for (const line of ["const {execFile,spawn}=require('node:child_process')", "/^x$/.exec(line)", "if(command)out.push('Cmd');", "mods.push(platform==='darwin'?'Cmd':'Meta')", "regex.exec(text)"])
    assert.deepEqual(hits(line), [], line);
});
