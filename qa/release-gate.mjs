// Release gate: the one command the coordinator runs on a finished build before anything is handed over.
//   node qa/release-gate.mjs <path to win-unpacked> [--tor]
// 31 Oct (r22): every source test passed, yet the installed app never opened, because a desktop file required a file under src/ that the package doesn't ship.
// One line per check, PASS / FAIL / WARN with the reason; exit code 1 on any FAIL; the whole run must stay under 5 minutes (a check that would start past the budget FAILs as not run).
//   1 alive      the exe opens, stays open 28 s (past the splash's 20 s timeout), main window titled exactly "Acira", responding, closes on CloseMainWindow   qa/release-alive.ps1
//   2 loads      every require()/import()/literal file reference under desktop/ resolves inside app.asar, and the walker is proven able to fail      qa/release-asar-loads.cjs
//   3 rigs       the core-flow rigs run against the packaged exe (D_APP_EXE), one at a time, each in a native slot                                    RIGS below
//   4 identity   user agent has the Chrome/152.0.0.0 and AciraBrowser/ tokens (no Electron), a test profile has no metrics endpoint                                    qa/release-identity.mjs
//                nothing appeared in the real %APPDATA%\AciraBrowser (listing before/after)
// Every app runs on a throwaway profile under .qa-profiles with ACIRA_BROWSER_TEST_DATA; processes are only ever stopped by pid, never by image name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {withSlot} from './native-slot.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_MS = 5 * 60_000, ALIVE_SECONDS = 28;

// Core-flow rigs run on the packaged exe. All use the shared harness (qa/d-harness.mjs startApp, which honours D_APP_EXE), a local fixture server, no live network.
const RIGS = [
  {name: 'coord-fresh-start', env: {ACIRA_BARE_START_OUT: path.join(os.tmpdir(), 'release-gate-bare-start.json')}, why: 'bare first launch with no warmed key, first screen reaches secure startup, a second launch hands its URL to the running window'},
  {name: 'd-tabs', why: 'tab operations: move to new window, duplicate, pin, mute, reopen closed, close others, address-bar search vs URL'},
  {name: 'e-toolbar-new-tab', why: 'new tab: the toolbar target for a website tab and the New Tab page resolves and the page opens'},
  {name: 'd-settings-ui', why: 'Settings panels work through the real UI (shortcuts, search engines, downloads, permissions)'},
  {name: 'd-popup-bugs', why: 'Acira popups (tab menu, group editor, viewers) open, align, take clicks, close on Esc; the tab-menu Back row must be clickable'},
  {name: 'd-sidebar-key', why: 'sidebar opens and closes (Ctrl+S in sidebar layout), Save page elsewhere'},
  {name: 'd-private', why: 'private window opens, is ephemeral, leaves no residue'},
];
const TOR_RIG = {name: 'n-tor-window', why: 'Tor window connects (live network, only with --tor)'};

const args = process.argv.slice(2), withTor = args.includes('--tor');
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('Usage: node qa/release-gate.mjs <path to win-unpacked> [--tor]'); process.exit(2); }
const unpacked = path.resolve(target), exe = path.join(unpacked, 'AciraBrowser.exe'), asarFile = path.join(unpacked, 'resources', 'app.asar');
if (process.platform !== 'win32') { console.error('The release gate runs the Windows build: run it on Windows.'); process.exit(2); }
for (const f of [exe, asarFile]) if (!fs.existsSync(f)) { console.error(`Not a win-unpacked folder: ${f} is missing.`); process.exit(2); }

const started = Date.now(), results = [];
const sec = (ms) => (ms / 1000).toFixed(1) + 's';
let slotWait = 0;
const elapsed = () => Date.now() - started - slotWait;
/** Native slots are shared with other sessions: waiting for one isn't the gate's own time, so it doesn't spend the budget. */
const slot = (name, work) => { const asked = Date.now(); return withSlot(name, (file) => { slotWait += Date.now() - asked; return work(file); }); };
function report(name, status, detail, ms) {
  results.push({name, status});
  console.log(`${status.padEnd(4)}  ${name.padEnd(26)} ${sec(ms).padStart(6)}  ${detail}`);
}
/** Runs one check; a thrown error is a FAIL with its message, never a crash that hides the other checks. */
async function check(name, run, {minMs = 0} = {}) {
  if (elapsed() + minMs > BUDGET_MS) return report(name, 'FAIL', `not run: the 5-minute budget was spent (${sec(elapsed())})`, 0);
  const t = Date.now();
  try { const out = await run(); report(name, out.status || (out.ok ? 'PASS' : 'FAIL'), out.detail, Date.now() - t); }
  catch (error) { report(name, 'FAIL', 'threw: ' + String(error?.stack || error).split('\n').slice(0, 2).join(' | ').slice(0, 300), Date.now() - t); }
}
/** Runs a child to completion with a hard cap; the whole tree is stopped by pid on timeout. Resolves {status, out, timedOut}. */
function run(command, argv, {env = {}, timeoutMs}) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, {cwd: REPO, env: {...process.env, ...env}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', timedOut = false;
    const take = (d) => { out = (out + d).slice(-20000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => { timedOut = true; spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({status: 1, out: out + e.message, timedOut}); });
    child.on('close', (status) => { clearTimeout(timer); resolve({status: status ?? 1, out, timedOut}); });
  });
}
const lastLine = (text) => text.trim().split(/\r?\n/).filter(Boolean).pop() || '(no output)';

// The founder's real data folder, listed before and after every app run. It must not change; a listing is path + size + mtime of every file.
const realData = path.join(process.env.APPDATA || '', 'AciraBrowser');
function listing(dir) {
  const map = new Map();
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { const s = fs.statSync(p); map.set(p, `${s.size}:${Math.round(s.mtimeMs)}`); } catch { /* vanished mid-walk */ } }
    }
  };
  walk(dir); return map;
}
/** Is the founder's own installed Acira running? Then its own writes into the real folder make the listing diff meaningless. */
function realAciraRunning() {
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'acira-browser').toLowerCase();
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-Process AciraBrowser -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }"], {encoding: 'utf8', windowsHide: true});
  return (ps.stdout || '').split(/\r?\n/).some((p) => p.trim() && p.trim().toLowerCase().startsWith(installed));
}
const dataBefore = listing(realData), realWasRunning = realAciraRunning();

const profileRoot = path.join(REPO, '.qa-profiles');
fs.mkdirSync(profileRoot, {recursive: true});
const gateProfile = path.join(profileRoot, 'release-gate-alive-' + process.pid);

console.log(`Release gate for ${unpacked}`);

// 1 -- opens and stays open
await check('1 alive', () => slot('release-gate alive', async () => {
  const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'qa', 'release-alive.ps1'), '-Exe', exe, '-Profile', gateProfile, '-Seconds', String(ALIVE_SECONDS)], {timeoutMs: 100_000});
  fs.rmSync(gateProfile, {recursive: true, force: true});
  let j; try { j = JSON.parse(lastLine(r.out)); } catch { return {ok: false, detail: `no verdict from release-alive.ps1${r.timedOut ? ' (timed out)' : ''}: ${lastLine(r.out).slice(0, 200)}`}; }
  return j.ok ? {ok: true, detail: `${j.processes} processes alive after ${ALIVE_SECONDS} s, window titled '${j.title}', responding, closed on CloseMainWindow`} : {ok: false, detail: `${j.reason} (processes ${j.processes})`};
}), {minMs: 45_000});

// 2 -- everything it loads is shipped
const {checkAsar, selfTest} = require('./release-asar-loads.cjs');
await check('2 loads: desktop requires', async () => {
  const r = checkAsar(asarFile);
  if (r.problems.length) return {ok: false, detail: `${r.problems.length} load(s) missing from app.asar: ` + r.problems.slice(0, 4).map((p) => `${p.file} -> ${p.request}`).join('; ')};
  return {ok: true, detail: `${r.scanned} desktop scripts, every require and file reference resolves inside app.asar (${r.optional.length} try/catch-guarded or Mac-only loads absent: ${[...new Set(r.optional.map((p) => path.posix.basename(p.request)))].join(', ') || 'none'})`};
});
await check('2 loads: walker can fail', async () => {
  const r = await selfTest(asarFile, profileRoot);
  return {ok: r.ok, detail: r.detail};
});

// 3 -- key rigs on the packaged exe
const rigs = withTor ? [...RIGS, TOR_RIG] : RIGS;
for (const rig of rigs) {
  await check(`3 rig ${rig.name}`, () => slot('release-gate ' + rig.name, async () => {
    const r = await run(process.execPath, [`qa/${rig.name}.mjs`], {env: {...rig.env, D_APP_EXE: exe}, timeoutMs: 110_000});
    const tail = lastLine(r.out).slice(0, 220);
    if (r.timedOut) return {ok: false, detail: `timed out after 110 s (${rig.why})`};
    return r.status === 0 ? {ok: true, detail: rig.why} : {ok: false, detail: `exit ${r.status}: ${tail}`};
  }), {minMs: 25_000});
}

// 4 -- identity and data
await check('4 identity + metrics', () => slot('release-gate identity', async () => {
  const r = await run(process.execPath, ['qa/release-identity.mjs'], {env: {D_APP_EXE: exe}, timeoutMs: 100_000});
  let j; try { j = JSON.parse(lastLine(r.out)); } catch { return {ok: false, detail: `no verdict${r.timedOut ? ' (timed out)' : ''}: ${lastLine(r.out).slice(0, 200)}`}; }
  return j.ok ? {ok: true, detail: `page and request user agent "${j.pageUserAgent.replace(/^.*?(Chrome\/)/, '$1')}"; test profile metrics configured:${j.metrics.configured}`} : {ok: false, detail: j.problems.join('; ').slice(0, 300)};
}), {minMs: 25_000});
await check('4 real data untouched', async () => {
  const after = listing(realData), added = [], removed = [], changed = [];
  for (const [p, v] of after) { if (!dataBefore.has(p)) added.push(p); else if (dataBefore.get(p) !== v) changed.push(p); }
  for (const p of dataBefore.keys()) if (!after.has(p)) removed.push(p);
  const total = added.length + removed.length + changed.length, rel = (p) => path.relative(realData, p);
  if (!total) return {ok: true, detail: `${realData}: ${dataBefore.size} files, identical before and after`};
  const sample = [...added.map((p) => '+' + rel(p)), ...removed.map((p) => '-' + rel(p)), ...changed.map((p) => '~' + rel(p))].slice(0, 5).join(', ');
  if (realWasRunning) return {status: 'WARN', detail: `${total} change(s) in ${realData} (${sample}), but the founder's installed Acira is running and writes there itself: inconclusive, re-run with it closed`};
  return {ok: false, detail: `${added.length} added, ${removed.length} removed, ${changed.length} changed in the real ${realData}: ${sample}`};
});

const failed = results.filter((r) => r.status === 'FAIL').length, warned = results.filter((r) => r.status === 'WARN').length;
console.log(`RELEASE GATE: ${failed ? 'FAIL' : 'PASS'}  ${results.length - failed - warned}/${results.length} passed${warned ? `, ${warned} warning` : ''}${failed ? `, ${failed} FAILED` : ''}  in ${sec(elapsed())}${elapsed() > BUDGET_MS ? '  (over the 5-minute budget)' : ''}`);
process.exit(failed ? 1 : 0);
