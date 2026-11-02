// Runs every live QA script that uses the shared harness, one after another, and writes a verdict table.
//   node qa/run-all-live.mjs <label>                     against the source tree (desktop/main.cjs)
//   D_APP_EXE=<AciraBrowser.exe> node qa/run-all-live.mjs <label>     against a packaged build (folder or asar)
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {takeSlot, releaseSlot} from './native-slot.mjs';
const label = process.argv[2] || 'run';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error('Use a simple report label.');
// Entries are qualification targets; registration alone is not native PASS evidence.
const scripts = ['d-profiles', 'd-private', 'd-permissions', 'd-permission-state', 'd-shortcuts', 'd-zoom', 'd-downloads', 'd-download-toasts', 'd-menu-tools', 'd-popup-bugs', 'd-restore', 'd-output', 'd-certs', 'd-spellcheck', 'd-tabs', 'd-popups', 'd-crash', 'd-windows', 'd-dialog', 'd-screenshare', 'd-context', 'd-unload', 'd-download-folder', 'd-settings-ui', 'd-sleep', 'd-proxy', 'd-download-restart', 'd-capture', 'd-opener-history', 'd-sidebar-key', 'd-e2e',
  'd-services-gate', 'd-window-bounds', 'd-profile-details', 'd-site-cert', 'd-private-tabs', 'd-private-newtab', 'd-import-running',
  'h-peek', 'h-registry', 'h-rewind', 'h-routines', 'h-setup-viewport', 'h-split', 'h-undo', 'h-window-undo', 'newtab-artwork-controls', 'settings-search-providers', 'settings-target-routing', 'vpn-controls', 'usage-consent', 'website-languages', 'profile-menu-forms-native', 'quick-protection-bookmark', 'rtl-interface-matrix', 'persistent-split-groups'];
const only = process.argv.slice(3), list = only.length ? scripts.filter(name => only.includes(name)) : scripts, rows = [];
if (!list.length || only.some(name => !scripts.includes(name))) throw Error('Unknown live QA script.');
const fixture = path.resolve('.qa-profiles', 'live-' + label + '-imports');
const env = {...process.env, APPDATA: path.join(fixture, 'roaming'), LOCALAPPDATA: path.join(fixture, 'local')};
fs.mkdirSync(env.APPDATA, {recursive: true}); fs.mkdirSync(env.LOCALAPPDATA, {recursive: true});
fs.mkdirSync('.tmp-d', {recursive: true});
const logDir = path.resolve('.tmp-d', 'live-' + label); fs.mkdirSync(logDir, {recursive: true});
// These service checks intentionally stub Electron's native message box. A
// visible product window routes questions to Acira's custom dialog instead.
// The dedicated dialog/capture tests separately exercise that real UI.
const nativeDialogMocks = new Set(['d-permissions', 'd-permission-state', 'd-downloads', 'd-download-folder', 'd-proxy', 'd-settings-ui', 'd-capture', 'd-private-tabs']);
const report = () => fs.writeFileSync(`.tmp-d/live-${label}.json`, JSON.stringify({label, packaged: process.env.D_APP_EXE || null, planned: list, rows}, null, 1));
// Keep the script parent alive until its owned tree is stopped on timeout. A
// spawnSync timeout kills only node.exe and can strand its Electron children.
const runScript = name => new Promise(resolve => {
  let tail = '', timedOut = false, interrupted = false, error = null;
  const scriptEnv = {...env};
  if (nativeDialogMocks.has(name)) { delete scriptEnv.D_VISIBLE; scriptEnv.ACIRA_BROWSER_TEST_HIDDEN = '1'; }
  const child = spawn(process.execPath, [`qa/${name}.mjs`], {env: scriptEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const append = data => { tail = (tail + String(data)).slice(-65536); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const stop = () => {
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
    else child.kill('SIGKILL');
  };
  const interrupt = () => { interrupted = true; stop(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const timer = setTimeout(() => { timedOut = true; stop(); }, 420000);
  child.on('error', err => { error = err.message; });
  child.on('close', status => {
    clearTimeout(timer); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    fs.writeFileSync(path.join(logDir, name + '.log'), tail);
    resolve({status, timedOut, interrupted, tail, error});
  });
});
for (const name of list) {
  // ACIRA_QA_SLOT=1: hold one shared native slot (C:/ae/slot-1..3.lock) while this script's app runs, so other sessions interleave.
  const slotFile = process.env.ACIRA_QA_SLOT ? await takeSlot('run-all-live ' + label + ' ' + name) : null;
  let started = Date.now(), run;
  try { started = Date.now(); run = await runScript(name); } finally { if (slotFile) await releaseSlot(slotFile); }
  const ok = run.status === 0 && !run.timedOut && !run.interrupted && !run.error, tail = [run.error, run.timedOut ? 'Timed out; owned process tree stopped.' : '', run.tail].filter(Boolean).join('\n').split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 800);
  const skipped = /"skipped"\s*:/.test(run.tail);
  rows.push({name, ok, skipped, log: path.join(logDir, name + '.log'), seconds: Math.round((Date.now() - started) / 1000), ...(!ok || skipped ? {tail} : {})});
  report();
  console.log(`${ok ? skipped ? 'SKIP' : 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${rows.at(-1).seconds}s${ok && !skipped ? '' : '  ' + tail}`);
  if (!ok && !process.env.ACIRA_LIVE_CONTINUE) break; // Inspect/fix a failure before starting another native instance (ACIRA_LIVE_CONTINUE=1 keeps going to list every failure).
}
console.log(`${rows.filter(r => r.ok && !r.skipped).length}/${list.length} passed (${rows.length} attempted, ${rows.filter(r => r.skipped).length} skipped)`);
process.exit(rows.length === list.length && rows.every(r => r.ok) ? 0 : 1);
