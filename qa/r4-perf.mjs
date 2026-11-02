// Round 4 perf rig (R4-37): per-process memory by role, idle CPU and page load times, for Acira (any app folder, for A/B) or Chrome.
// One owned browser per run, one native slot (C:\ae\slot-N.lock, flag wx) held for the run and released in finally, at most 30 tabs,
// every wait bounded, the owned process tree closed in finally (CDP Browser.close, then only verified owned descendants are stopped).
//   node qa/r4-perf.mjs --make-template                    once: an Acira profile with its encryption key committed and setup skipped
//   node qa/r4-perf.mjs --label base --app C:/ae/r4/perf/base [--sites real|static|frames] [--tabs 10|30] [--sleep] [--settle 25] [--idle 20]
//        [--extra "--switch=value"] (repeatable, extra command-line switches)   [--env NAME=value] (repeatable)
//   node qa/r4-perf.mjs --browser chrome --label chrome [--tabs 10|30]
// Acira runs copy the template (no first-run restart, no welcome scene) and add --inspect on the main process; after the idle sample the
// rig asks the main process which renderer serves what (UI, overlay, page, iframe, extension, other). No CDP session is attached while
// the idle sample is taken. Writes C:/ae/r4/perf/runs/<label>-<stamp>.json and prints one summary line.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {REAL_SITES, cpuInterval} from './lightweight-policy.mjs';

const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const HERE = path.dirname(fileURLToPath(import.meta.url)), PERF = 'C:/ae/r4/perf';
const argv = process.argv.slice(2), has = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const multi = n => argv.flatMap((v, i) => v === '--' + n ? [argv[i + 1]] : []);
const which = opt('browser', 'acira'), label = opt('label', which), mode = opt('sites', 'real'), TABS = Number(opt('tabs', 10));
const SETTLE = Number(opt('settle', 25)), IDLE = Number(opt('idle', 20)), SLEEP = has('sleep'), SLEEP_WAIT = Number(opt('sleep-wait', 100));
const appDir = path.resolve(opt('app', path.join(HERE, '..'))), TEMPLATE = path.join(PERF, 'template');
if (!['acira', 'chrome'].includes(which) || !['real', 'static', 'frames'].includes(mode) || !(TABS >= 1 && TABS <= 30)) throw new Error('bad arguments');
const deadline = Date.now() + 9 * 60 * 1000; // a slot is held at most 10 minutes
const left = (cap = 10000) => { const ms = Math.min(cap, deadline - Date.now()); if (ms <= 0) throw new Error('run deadline'); return ms; };

async function takeSlot() {
  const until = Date.now() + 20 * 60 * 1000;
  for (let round = 0; round < 45; round++) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const h = await fs.open(file, 'wx'); await h.writeFile(`r4-perf ${label} ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    if (Date.now() > until) break;
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
async function ps(file, args = [], timeout = 20000) { const out = await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, file), ...args], {timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true}); return out.stdout.trim(); }
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function poll(fn, what, cap = 25000) { const end = Date.now() + Math.min(cap, left(cap)); let last; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(200); } throw new Error(what + ' timed out' + (last ? ': ' + last.message : '')); }
async function json(port, suffix) { const r = await fetch(`http://127.0.0.1:${port}${suffix}`, {signal: AbortSignal.timeout(2500)}); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
const clients = new Set();
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let seq = 0;
  const client = {
    send(method, params = {}, cap = 10000) { return new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, left(cap)); pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params})); }); },
    close() { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('closed')); } pending.clear(); try { socket.close(); } catch {} clients.delete(client); },
  };
  socket.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } const p = m.id && pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); };
  await new Promise((resolve, reject) => { const t = setTimeout(() => { try { socket.close(); } catch {} reject(new Error('connect timeout')); }, 5000); socket.onopen = () => { clearTimeout(t); resolve(); }; socket.onerror = () => { clearTimeout(t); reject(new Error('socket error')); }; });
  socket.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('peer closed')); } pending.clear(); clients.delete(client); };
  clients.add(client); return client;
}
async function evaluate(client, expression, cap = 10000) { const out = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, cap); if (out.exceptionDetails) throw new Error('evaluate: ' + (out.exceptionDetails.exception?.description || out.exceptionDetails.text)); return out.result?.value; }
const closeClients = async () => { for (const c of [...clients]) c.close(); await sleep(150); };

// Pages for the local modes. "frames": one page per tab on 127.0.0.1 with one same-origin and three cross-site (localhost) iframes.
function fixtures() {
  const page = (title, body) => `<!doctype html><meta charset=utf-8><title>${title}</title><body style="font:16px sans-serif"><h1>${title}</h1><p>A static page.</p>${body}`;
  const second = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(page('frame ' + q.url, '')); });
  const first = http.createServer((q, r) => {
    r.setHeader('content-type', 'text/html');
    if (q.url.startsWith('/frames-')) { const p = second.address().port; r.end(page(q.url, `<iframe src="/child"></iframe>` + [1, 2, 3].map(i => `<iframe src="http://localhost:${p}/x${i}"></iframe>`).join(''))); }
    else r.end(page(q.url, ''));
  });
  return {first, second, async listen() { await new Promise(r => first.listen(0, '127.0.0.1', r)); await new Promise(r => second.listen(0, '127.0.0.1', r)); }, close() { first.closeAllConnections?.(); second.closeAllConnections?.(); first.close(); second.close(); }};
}

// Main-process probe (runs through the Node inspector of Acira's main process): which renderer pid serves which webContents / frame.
const ROLE_PROBE = `(async()=>{const {app,webContents}=process.mainModule.require('electron');const wcs=[];
for(const wc of webContents.getAllWebContents()){let pid=-1;try{pid=wc.getOSProcessId();}catch{}const frames=[];try{for(const f of wc.mainFrame.framesInSubtree)frames.push({pid:f.osProcessId,url:String(f.url).slice(0,90),main:f===wc.mainFrame});}catch{}
let prefs=null;try{const p=wc.getLastWebPreferences?.()||{};prefs={preload:p.preload?String(p.preload).split(/[\\\\/]/).pop():null,partition:p.partition||null,subframes:!!p.nodeIntegrationInSubFrames,title:wc.getTitle().slice(0,40),storage:wc.session.storagePath?String(wc.session.storagePath).split(/[\\\\/]/).slice(-2).join('/'):'memory'};}catch{}
wcs.push({id:wc.id,type:wc.getType(),url:wc.getURL().slice(0,140),pid,frames,destroyed:wc.isDestroyed(),prefs});}
const metrics=app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,serviceName:m.serviceName||null,name:m.name||null,privateKB:m.memory.privateBytes??null,workingSetKB:m.memory.workingSetSize}));
const v8=process.mainModule.require('node:v8'),heap=v8.getHeapStatistics(),usage=process.memoryUsage(),mb=v=>Math.round(v/1048576*10)/10;
const mainMemory={rss:mb(usage.rss),heapUsed:mb(usage.heapUsed),heapTotal:mb(usage.heapTotal),external:mb(usage.external),arrayBuffers:mb(usage.arrayBuffers),mallocedMemory:mb(heap.malloced_memory),spaces:Object.fromEntries(v8.getHeapSpaceStatistics().map(s=>[s.space_name,mb(s.space_used_size)]))};
return JSON.stringify({wcs,metrics,mainMemory});})()`;
function roleOf(wc) {
  const u = wc.url || '';
  if (/^acira-browser-ui:/.test(u)) return /view=overlay/.test(u) ? 'overlay' : /^acira-browser-ui:\/\/ui\/index\.html$/.test(u) ? 'ui' : 'ui:' + (u.match(/view=([a-z-]+)/)?.[1] || u.replace(/^acira-browser-ui:\/\/ui\//, '').slice(0, 24));
  if (wc.type === 'backgroundPage' || /^chrome-extension:/.test(u)) return 'extension';
  if (/^https?:/.test(u)) return 'page';
  return 'other:' + (u.split(/[:?]/)[0] || 'blank');
}

const result = {schema: 1, browser: which, label, mode, tabs: TABS, sleep: SLEEP, app: appDir, extra: multi('extra'), env: multi('env'), when: new Date().toISOString(), status: 'INVALID'};
let slot, child, executable, port, iport, root, nonce = randomUUID(), server;
const owned = action => ps('lightweight-owned.ps1', ['-Action', action, '-Executable', executable, '-Nonce', nonce, '-Profile', root, '-Port', String(port)], 15000).then(JSON.parse);
const inspectRoot = async () => { const v = await owned('inspect'); if (v.roots.length > 1) throw new Error('multiple owned roots'); return v.roots[0] || null; };

async function shutdown() {
  const receipt = {};
  try {
    if (executable && port && root && await inspectRoot()) {
      try { const v = await json(port, '/json/version'); const c = await connect(v.webSocketDebuggerUrl); await c.send('Browser.close', {}, 3000).catch(() => {}); receipt.close = 'Browser.close'; } catch (e) { receipt.closeError = e.message; }
      for (let i = 0; i < 40 && await inspectRoot(); i++) await sleep(250);
      if (await inspectRoot()) receipt.stopped = await owned('stop');
    }
  } catch (e) { receipt.error = e.message; }
  await closeClients(); return receipt;
}

async function launch(extraArgs, env) {
  const args = which === 'acira'
    ? [...(iport ? [`--inspect=${iport}`] : []), path.join(appDir, 'desktop', 'main.cjs'), `--user-data-dir=${root}`, `--acira-perf-run=${nonce}`, `--remote-debugging-port=${port}`, ...extraArgs]
    : [`--user-data-dir=${root}`, `--acira-perf-run=${nonce}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', ...extraArgs, 'about:blank'];
  const log = await fs.open(path.join(PERF, 'runs', `${label}-${nonce.slice(0, 8)}.stderr.log`), 'w');
  child = spawn(executable, args, {stdio: ['ignore', log.fd, log.fd], env, windowsHide: false}); child.on('error', () => {}); child.on('close', () => log.close().catch(() => {}));
  const rootProc = await poll(inspectRoot, 'owned root', 30000);
  await poll(() => json(port, '/json/version'), 'CDP', 30000);
  return rootProc;
}
function acEnv(extra = {}) {
  const env = {...process.env};
  for (const k of ['ELECTRON_RUN_AS_NODE', 'ACIRA_DEV', 'ACIRA_BROWSER_TEST_HIDDEN', 'ACIRA_TEST_SERVICES_DELAY_MS', 'ACIRA_STARTUP_PROFILE', 'ACIRA_MEMORY_SAVER_FREEZE_MS', 'ACIRA_MEMORY_SAVER_IDLE_MS', 'ACIRA_MEMORY_SAVER_TICK_MS', 'NODE_OPTIONS']) delete env[k];
  Object.assign(env, {ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: root, ACIRA_PERF: '1', APPDATA: path.join(root, 'fixture-roaming'), LOCALAPPDATA: path.join(root, 'fixture-local'), ACIRA_NO_SPLASH: '1'}, extra);
  for (const pair of multi('env')) { const i = pair.indexOf('='); env[pair.slice(0, i)] = pair.slice(i + 1); }
  return env;
}
async function uiClient() {
  const t = await poll(async () => (await json(port, '/json/list')).find(x => x.type === 'page' && x.url === 'acira-browser-ui://ui/index.html'), 'Acira UI', 30000);
  const ui = await connect(t.webSocketDebuggerUrl);
  await poll(() => evaluate(ui, 'Boolean(window.acira?.getSnapshot)'), 'bridge', 20000);
  return ui;
}

async function makeTemplate() {
  executable = await fs.realpath(path.join(appDir, 'node_modules/electron/dist/electron.exe'));
  root = path.join(PERF, 'template-work-' + nonce.slice(0, 8)); port = await freePort();
  await fs.mkdir(path.join(root, 'fixture-roaming'), {recursive: true}); await fs.mkdir(path.join(root, 'fixture-local'), {recursive: true});
  await launch([], acEnv());
  // The first launch of a profile restarts once to commit the OS encryption key (same switches, same CDP port); the UI comes after it.
  const ui = await uiClient();
  result.templateRoot = await inspectRoot();
  let clicked = false;
  await poll(async () => { const s = await evaluate(ui, `(()=>{const b=document.querySelector('button.fr-skip:not(:disabled)');if(b){b.click();return 'clicked';}return document.querySelector('.fr-stage,.fr-prism')?'present':'absent';})()`); if (s === 'clicked') clicked = true; return s === 'absent' && clicked; }, 'setup skipped', 25000);
  await sleep(6000); result.template = {root};
}

// --refresh-template: open the template itself until every downloaded list is on disk (the threat lists finish after the first window
// closes), so measured runs see the steady state instead of a first-day download and parse in the main process.
async function refreshTemplate() {
  executable = await fs.realpath(path.join(appDir, 'node_modules/electron/dist/electron.exe'));
  root = TEMPLATE; port = await freePort();
  await launch([], acEnv());
  await uiClient();
  const lists = ['phishing.txt', 'malware.txt', 'phishing-db.txt'].map(f => path.join(TEMPLATE, 'threat-lists', f));
  await poll(async () => { for (const f of lists) await fs.access(f); return true; }, 'threat lists on disk', 150000);
  await sleep(8000); result.refreshed = lists; result.status = 'VALID';
}

async function measure() {
  executable = which === 'acira' ? await fs.realpath(path.join(appDir, 'node_modules/electron/dist/electron.exe')) : await ps('lightweight-executable.ps1', ['-Browser', 'chrome']);
  root = path.join(PERF, 'profiles', `${label}-${nonce.slice(0, 8)}`); port = await freePort(); iport = which === 'acira' ? await freePort() : 0;
  await fs.mkdir(path.dirname(root), {recursive: true});
  if (which === 'acira') { await fs.cp(TEMPLATE, root, {recursive: true}); await fs.mkdir(path.join(root, 'fixture-roaming'), {recursive: true}); await fs.mkdir(path.join(root, 'fixture-local'), {recursive: true}); }
  else await fs.mkdir(root, {recursive: true});
  server = fixtures(); await server.listen();
  const base = `http://127.0.0.1:${server.first.address().port}`;
  const list = mode === 'real' ? REAL_SITES : Array.from({length: 10}, (_, i) => `${base}/${mode === 'frames' ? 'frames' : 'page'}-${i + 1}`);
  const sites = Array.from({length: TABS}, (_, i) => list[i % list.length] + (i >= list.length && mode !== 'real' ? `?copy=${i}` : ''));
  const sleepEnv = SLEEP ? {ACIRA_MEMORY_SAVER_FREEZE_MS: '20000', ACIRA_MEMORY_SAVER_IDLE_MS: '60000', ACIRA_MEMORY_SAVER_TICK_MS: '5000'} : {};
  const launchedAt = Date.now();
  const rootProc = await launch(multi('extra'), which === 'acira' ? acEnv(sleepEnv) : (() => { const e = {...process.env}; delete e.ELECTRON_RUN_AS_NODE; return e; })());
  if (rootProc.bootstrap) throw new Error('template did not carry the committed key (bootstrap restart)');
  result.rootPid = rootProc.pid;
  let ui, browser;
  if (which === 'acira') {
    ui = await uiClient(); result.bridgeReadyMs = Date.now() - launchedAt;
    if (await evaluate(ui, `Boolean(document.querySelector('button.fr-skip,.fr-stage,.fr-prism'))`)) throw new Error('template shows setup');
    const tabIds = sites.map(() => 'tab-' + randomUUID());
    for (let i = 0; i < sites.length; i++) { await evaluate(ui, `window.acira.dispatch(${JSON.stringify({type: 'tab.new', id: tabIds[i], url: sites[i]})})`); await sleep(300); }
    await evaluate(ui, `window.acira.dispatch({type:'tab.select',id:${JSON.stringify(tabIds[0])}})`);
  } else {
    const v = await json(port, '/json/version'); browser = await connect(v.webSocketDebuggerUrl);
    const initial = (await json(port, '/json/list')).filter(t => t.type === 'page');
    const ids = []; for (const url of sites) { ids.push((await browser.send('Target.createTarget', {url})).targetId); await sleep(300); }
    for (const t of initial) await browser.send('Target.closeTarget', {targetId: t.id}).catch(() => {});
    await browser.send('Target.activateTarget', {targetId: ids[0]});
  }
  await sleep(SETTLE * 1000); left();
  // Page evidence (a short CDP attach per page; all detached before the idle sample).
  const targets = await json(port, '/json/list');
  result.pages = [];
  for (const t of targets.filter(x => x.type === 'page' && /^https?:/.test(x.url))) {
    try { const c = await connect(t.webSocketDebuggerUrl); result.pages.push({url: t.url.slice(0, 120), ...(await evaluate(c, `(()=>{const n=performance.getEntriesByType('navigation')[0];return {title:document.title.slice(0,60),ready:document.readyState,ttfb:Math.round(n?.responseStart||0),dcl:Math.round(n?.domContentLoadedEventEnd||0),load:Math.round(n?.loadEventEnd||0),frames:window.frames.length};})()`, 4000))}); c.close(); }
    catch (e) { result.pages.push({url: t.url.slice(0, 120), error: e.message}); }
  }
  result.oopifTargets = targets.filter(x => x.type === 'iframe').length;
  if (SLEEP) { await sleep(SLEEP_WAIT * 1000); left(); }
  await closeClients();
  const live = await inspectRoot(); if (!live || live.pid !== rootProc.pid) throw new Error('owned root changed');
  // A short-lived helper the app starts (no --type switch) reads as a second "browser"; sample again rather than fail.
  const sample = async () => { let last; for (let i = 0; i < 3; i++) { const v = last = JSON.parse(await ps('proc-sample.ps1', ['-RootPid', String(live.pid)], 30000)); if (v.types?.browser?.n === 1) return v; await sleep(1500); } throw new Error('contaminated sample: ' + JSON.stringify((last?.procs || []).filter(p => p.type === 'browser').map(p => ({pid: p.pid, name: p.name, cmd: p.cmd})))); };
  // --profile-main: a V8 CPU profile of the main process over the idle window (through its inspector), summarised by self time.
  let profiler = null;
  if (has('profile-main') && which === 'acira') { const t = (await poll(() => json(iport, '/json/list'), 'main inspector', 10000))[0]; profiler = await connect(t.webSocketDebuggerUrl); await profiler.send('Profiler.enable'); await profiler.send('Profiler.setSamplingInterval', {interval: 500}); await profiler.send('Profiler.start'); }
  const before = await sample(); await sleep(IDLE * 1000); const after = await sample();
  if (profiler) {
    const {profile} = await profiler.send('Profiler.stop', {}, 20000); profiler.close();
    const file = path.join(PERF, 'runs', `${label}-${nonce.slice(0, 8)}.cpuprofile`); await fs.writeFile(file, JSON.stringify(profile));
    const dt = new Map(); const n = profile.samples.length; for (let i = 0; i < n; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
    const self = new Map(); let total = 0; for (const node of profile.nodes) { const us = dt.get(node.id) || 0; total += us; const f = node.callFrame, key = `${f.functionName || '(anon)'} ${String(f.url).split(/[\\/]/).pop()}:${f.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + us); }
    const busy = [...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).reduce((s, [, v]) => s + v, 0);
    result.mainProfile = {file, totalMs: Math.round(total / 1000), jsBusyMs: Math.round(busy / 1000), top: [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`)};
  }
  // CPU over the processes present in both samples (a renderer that closes in between would make the tree total go backwards).
  { const seconds = (after.cpuSnapshotEpochMs - before.cpuSnapshotEpochMs) / 1000, was = new Map(before.procs.map(p => [p.pid, p.cpu])); result.idleCpu = +(after.procs.reduce((s, p) => s + (was.has(p.pid) ? Math.max(0, p.cpu - was.get(p.pid)) : 0), 0) / seconds * 100).toFixed(2); }
  result.privateMB = after.privateMB; result.processes = after.pids; result.procs = after.procs;
  const base0 = new Map(before.procs.map(p => [p.pid, p.cpu])); const cpuOf = p => base0.has(p.pid) ? Math.max(0, p.cpu - base0.get(p.pid)) / ((after.cpuSnapshotEpochMs - before.cpuSnapshotEpochMs) / 1000) * 100 : 0;
  // Roles.
  const roles = new Map(); const add = (pid, role) => { if (pid > 0) { if (!roles.has(pid)) roles.set(pid, new Set()); roles.get(pid).add(role); } };
  if (which === 'acira') {
    const target = (await poll(() => json(iport, '/json/list'), 'main inspector', 10000))[0];
    const main = await connect(target.webSocketDebuggerUrl);
    const probe = JSON.parse(await evaluate(main, ROLE_PROBE, 15000)); main.close();
    result.webContents = probe.wcs; result.appMetrics = probe.metrics; result.mainMemory = probe.mainMemory;
    for (const wc of probe.wcs) { if (wc.destroyed) continue; const role = roleOf(wc); add(wc.pid, role); for (const f of wc.frames) if (!f.main && f.pid > 0 && f.pid !== wc.pid) add(f.pid, 'iframe'); }
    result.frameStats = {pages: probe.wcs.filter(w => roleOf(w) === 'page').length, subframes: probe.wcs.filter(w => roleOf(w) === 'page').reduce((s, w) => s + w.frames.length - 1, 0), oopifProcesses: [...roles.values()].filter(s => s.size === 1 && s.has('iframe')).length};
    result.tabsWithPage = probe.wcs.filter(w => roleOf(w) === 'page').length;
  }
  const byRole = {};
  for (const p of after.procs) {
    let role = p.type;
    if (p.type === 'renderer') { const set = roles.get(p.pid); role = which === 'chrome' ? 'renderer' : set ? [...set].sort().join('+') : 'renderer:unmapped'; if (/\bpage\b/.test(role) && role !== 'page') role = role.includes('iframe') ? 'page+iframe' : role; }
    byRole[role] ??= {n: 0, mb: 0, cpu: 0}; byRole[role].n++; byRole[role].mb = +(byRole[role].mb + p.mb).toFixed(1); byRole[role].cpu = +(byRole[role].cpu + cpuOf(p)).toFixed(2);
  }
  result.byRole = byRole;
  const loads = result.pages.map(p => p.load).filter(v => v > 0).sort((a, b) => a - b); result.loadMedianMs = loads.length ? loads[Math.floor(loads.length / 2)] : null;
  const dcls = result.pages.map(p => p.dcl).filter(v => v > 0).sort((a, b) => a - b); result.dclMedianMs = dcls.length ? dcls[Math.floor(dcls.length / 2)] : null;
  result.status = 'VALID';
}

const out = path.join(PERF, 'runs', `${label}-${mode}-${TABS}${SLEEP ? '-sleep' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
try {
  // --slot-held <file>: the A/B driver (qa/r4-perf-ab.mjs) already holds a slot for this series and releases it itself.
  if (opt('slot-held')) result.slot = opt('slot-held'); else { slot = await takeSlot(); result.slot = slot; }
  if (has('make-template')) { await makeTemplate(); }
  else if (has('refresh-template')) { await refreshTemplate(); }
  else { try { await fs.access(path.join(TEMPLATE, 'Local State')); } catch { if (which === 'acira') throw new Error('no template: run --make-template first'); } await measure(); }
} catch (e) { result.error = e.stack || String(e); process.exitCode = 1; }
finally {
  result.cleanup = await shutdown();
  try { server?.close(); } catch {}
  if (slot) await fs.rm(slot, {force: true});
  if (has('make-template') && result.template && !result.cleanup.stopped) { await fs.rm(TEMPLATE, {recursive: true, force: true}); await fs.rename(result.template.root, TEMPLATE); for (const d of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache']) await fs.rm(path.join(TEMPLATE, d), {recursive: true, force: true}); result.template.saved = TEMPLATE; if (!result.error) result.status = 'VALID'; }
  else if (root && !has('make-template') && !has('refresh-template') && !has('keep-profile')) await fs.rm(root, {recursive: true, force: true, maxRetries: 3}).catch(() => {});
  await fs.mkdir(path.dirname(out), {recursive: true}); await fs.writeFile(out, JSON.stringify(result, null, 2));
  const brief = Object.fromEntries(Object.entries(result.byRole || {}).sort((a, b) => b[1].mb - a[1].mb).map(([k, v]) => [k, `${v.n}x ${v.mb}MB ${v.cpu}%`]));
  console.log(JSON.stringify({status: result.status, label, mode, tabs: TABS, sleep: SLEEP, privateMB: result.privateMB, processes: result.processes, mainMemory: result.mainMemory ? `heap ${result.mainMemory.heapUsed}/${result.mainMemory.heapTotal} ext ${result.mainMemory.external}` : undefined, idleCpu: result.idleCpu, mainProfile: result.mainProfile, loadMedianMs: result.loadMedianMs, dclMedianMs: result.dclMedianMs, pages: result.pages?.length, tabsWithPage: result.tabsWithPage, frameStats: result.frameStats, oopifTargets: result.oopifTargets, byRole: brief, error: result.error?.split('\n')[0], cleanup: result.cleanup, out}));
}
