// Bare first launch and second-instance URL delivery, without warming the native
// encryption key. Also works against D_APP_EXE from the installed-build gate.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {poll} from './d-harness.mjs';

const nonce = randomUUID(), root = path.resolve('.qa-profiles', 'bare-start-' + nonce);
const out = process.env.ACIRA_BARE_START_OUT ? path.resolve(process.env.ACIRA_BARE_START_OUT) : path.resolve('qa/artifacts/overnight', (process.env.D_APP_EXE ? 'packaged' : 'source') + '-bare-start.json');
const exe = process.env.D_APP_EXE || createRequire(import.meta.url)('electron');
const env = {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: root, ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_PREVIEW_RECORD: '1', APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local')};
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
await Promise.all([root, env.APPDATA, env.LOCALAPPDATA, path.dirname(out)].map(dir => fs.mkdir(dir, {recursive: true})));
const readBuild = () => fs.readFile(path.join(root, 'preview-build.json'), 'utf8').then(JSON.parse).catch(() => null);
const requests = [], report = {packaged: Boolean(process.env.D_APP_EXE), root, checks: [], status: 'running'};
const server = http.createServer(async (req, res) => {
  const build = await readBuild();
  requests.push({url: req.url, secureReady: build?.events.some(e => e.event === 'secure-startup' && e.ready === true) === true});
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Fresh startup fixture</title><h1>Native startup works</h1>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`, cold = base + '/cold?opaque=1#kept', warm = base + '/warm?opaque=2#tail';
let browser, ui, diagnostics = '';
const stopOwned = () => {
  // The first process may relaunch itself. Its unique argument survives that
  // handoff, so cleanup identifies the owned process instead of all browsers.
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe','AciraBrowser.exe','AciraBrowserQA.exe') -and $_.CommandLine -like '*--acira-qa-owner=${nonce}*' } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }`], {windowsHide: true, timeout: 20000, stdio: 'ignore'});
};
const launch = url => {
  const child = spawn(exe, ['--remote-debugging-port=0', ...(process.env.D_APP_EXE ? [] : [path.resolve('desktop/main.cjs')]), '--acira-qa-owner=' + nonce, url], {env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
  child.on('error', error => { diagnostics += error.message; });
  child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-6000); }); return child;
};
const watchdog = setTimeout(() => { try { stopOwned(); } finally { process.exitCode = 1; } }, 100000);
try {
  const initial = launch(cold);
  const build = await poll(readBuild, value => value?.events.some(e => e.event === 'secure-startup' && e.ready === true) && value.events.some(e => e.event === 'renderer-loaded' && e.view === 'browser'), 'bare native secure startup', 40000);
  report.selfRelaunched = build.pid !== initial.pid;
  report.checks.push('Fresh unprepared profile reaches native secure readiness');
  const endpoint = await poll(async () => {
    const [port, socket] = (await fs.readFile(path.join(root, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
    const value = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    return value.webSocketDebuggerUrl?.endsWith(socket) ? value.webSocketDebuggerUrl : null;
  }, Boolean, 'owned CDP endpoint', 15000);
  browser = await chromium.connectOverCDP(endpoint);
  ui = await poll(() => browser.contexts()[0].pages().find(p => p.url() === 'acira-browser-ui://ui/index.html'), Boolean, 'trusted chrome');
  await poll(() => ui.evaluate(() => window.acira.getSnapshot()), state => state.tabs.some(tab => tab.url === cold), 'cold URL intact');
  await ui.getByRole('button', {name: 'Skip setup', exact: true}).dispatchEvent('click');
  await poll(() => requests, rows => rows.some(row => row.url.startsWith('/cold?')), 'cold page actually loaded');
  const second = launch(warm);
  await new Promise((resolve, reject) => { second.once('exit', resolve); second.once('error', reject); });
  const state = await poll(() => ui.evaluate(() => window.acira.getSnapshot()), state => state.tabs.some(tab => tab.url === warm), 'second-instance URL intact');
  assert.equal(state.tabs.filter(tab => tab.url === cold).length, 1); assert.equal(state.tabs.filter(tab => tab.url === warm).length, 1);
  await poll(() => requests, rows => rows.some(row => row.url.startsWith('/warm?')), 'warm page actually loaded');
  assert.equal((await readBuild()).pid, build.pid);
  assert.ok(requests.every(row => row.secureReady));
  assert.equal(await fs.access(path.join(root, 'startup-links.bin')).then(() => true, () => false), false);
  report.checks.push('Cold and second-instance URLs preserve query and fragment exactly once', 'Both pages load only after secure readiness; protected startup handoff consumed');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error.stack || error); report.diagnostics = diagnostics; process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  try { await ui?.evaluate(() => window.acira.windowControl('close')); } catch {}
  try { await browser?.close(); } catch {}
  try { stopOwned(); } catch {}
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.requests = requests; await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, checks: report.checks, error: report.error, out}));
}
