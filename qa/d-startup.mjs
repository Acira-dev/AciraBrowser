// Stream D: cold-start timing. Launches the real app (visible window: a hidden one never paints) on a disposable profile and reports
// milliseconds since the process started for: modules loaded -> app ready -> database -> window created -> UI loaded -> window shown ->
// first frame -> new tab painted, plus the time until the active page of a restored session has committed.
// usage: node qa/d-startup.mjs <fresh|warm|restored30> [runs=5] [label=run]   (env D_STARTUP_EXE overrides the electron binary / packaged exe)
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {sleep, poll} from './d-harness.mjs';
const scenario = process.argv[2] || 'warm', runs = Number(process.argv[3] || 5), label = process.argv[4] || 'run';
const exe = process.env.D_STARTUP_EXE || path.resolve('node_modules/electron/dist/electron.exe');
const entryArgs = process.env.D_STARTUP_EXE ? [] : [path.resolve('desktop/main.cjs')];
const work = path.resolve('.qa-profiles/d-startup'); await fs.mkdir(work, {recursive: true});
const PORT = 38517;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>page ${req.url}</title><body>${req.url}</body>`); });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };

function connect(url) { return new Promise((resolve, reject) => {
  const socket = new WebSocket(url), waiting = new Map(); let nextId = 1;
  socket.onmessage = event => { const message = JSON.parse(event.data), entry = waiting.get(message.id); if (!entry) return; waiting.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
  socket.onerror = reject;
  socket.onopen = () => resolve({close: () => socket.close(), evaluate: async expression => { const out = await new Promise((ok, bad) => { const id = nextId++; waiting.set(id, {resolve: ok, reject: bad}); socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}})); }); return out.result?.value; }});
}); }

/** Launch once; resolve with the timing marks. keep=false closes the app right after measuring. */
async function launch(profile, {measure = true, after = null, extraEnv = {}} = {}) {
  const trace = path.join(work, `trace-${Date.now()}.json`), debugPort = 20000 + Math.floor(Math.random() * 20000);
  const spawnedAt = Date.now();
  const child = spawn(exe, [...entryArgs, `--remote-debugging-port=${debugPort}`], {env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, ACIRA_STARTUP_TRACE: trace, ...extraEnv, ...(process.env.D_STARTUP_PROFILE ? {ACIRA_STARTUP_PROFILE: path.join(work, `${label}-${scenario}.cpuprofile`)} : {})}, stdio: 'ignore'});
  let ui, result = null;
  try {
    const target = await poll(async () => { try { return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.url.startsWith('acira-browser-ui://ui/index.html') && !t.url.includes('view=overlay')); } catch { return null; } }, Boolean, 'ui target', 60000);
    ui = await connect(target.webSocketDebuggerUrl);
    await poll(() => fs.stat(trace).then(() => true, () => false), Boolean, 'window shown', 60000);
    const main = JSON.parse(await fs.readFile(trace, 'utf8'));
    await sleep(600);
    const renderer = await ui.evaluate(`JSON.stringify({origin: performance.timeOrigin, marks: Object.fromEntries(performance.getEntriesByType('mark').reverse().map(m => [m.name, m.startTime])), paint: Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime])), nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? {fetchStart: n.fetchStart, responseEnd: n.responseEnd, domInteractive: n.domInteractive, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd} : null; })()})`).then(JSON.parse);
    const since = value => value == null ? null : Math.round((renderer.origin + value) - main.timeOrigin);
    // a restored session: when did the active page finish loading (polled)?
    // The renderer's own busy time (script, layout, style, all tasks) since it started, from the DevTools Performance domain.
    const metrics = await ui.evaluate('0').then(() => null).catch(() => null);
    let pageReady = null;
    if (scenario === 'restored30') pageReady = await poll(async () => { const s = JSON.parse(await ui.evaluate(`Promise.resolve(window.acira.getSnapshot()).then(s=>JSON.stringify({loading:s.tabs.find(t=>t.id===s.activeTabId)?.loading,title:s.tabs.find(t=>t.id===s.activeTabId)?.title,count:s.tabs.length}))`)); return s.loading === false && /^page /.test(s.title) ? Math.round(Date.now() - main.timeOrigin) : null; }, v => v !== null, 'active page loaded', 30000).catch(() => null);
    result = {
      spawnToProcessStart: Math.round(main.timeOrigin - spawnedAt),
      modulesLoaded: main.marks['requires-done'], splashShown: main.marks['splash-shown'], appReady: main.marks['app-ready'], secureStartup: main.marks['secure-startup'], databaseOpen: main.marks['database-open'], startBegin: main.marks['start-begin'], windowCreate: main.marks['window-create'],
      uiLoaded: main.marks['ui-loaded'], windowShown: main.marks['window-show'], mainCpuAtShow: main.cpu?.['window-show'], mainCpuAtReady: main.cpu?.['app-ready'], mainCpuModules: main.cpu?.['requires-done'], mainCpuAtLoaded: main.cpu?.['ui-loaded'],
      uiFirstPaint: since(renderer.paint['first-contentful-paint']), uiRenderBegin: since(renderer.marks['acira-render-begin']), uiFirstFrame: since(renderer.marks['acira-first-frame']), layoutSent: since(renderer.marks['acira-layout-sent']), firstLayout: main.marks['first-layout'], newTabPainted: since(renderer.marks['acira-newtab-painted']),
      // Inside the interface renderer (its own timeline, from navigation start): html+css+js fetched, script evaluated up to the first render, render to the first layout report.
      uiFetched: renderer.nav && Math.round(renderer.nav.responseEnd), uiScriptToRender: renderer.nav && Math.round(renderer.marks['acira-render-begin'] - renderer.nav.responseEnd), uiRenderToLayout: renderer.marks['acira-layout-sent'] != null ? Math.round(renderer.marks['acira-layout-sent'] - renderer.marks['acira-render-begin']) : null,
      ...(pageReady == null ? {} : {restoredPageReady: pageReady}),
    };
    if (after) await after(ui);
  } finally { try { ui?.close(); } catch {} try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'}); } catch {} await killPort(debugPort); await sleep(1500); await fs.rm(trace, {force: true}); }
  return result;
}
async function killPort(port) { await new Promise(resolve => { const p = spawn('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='AciraBrowser.exe' OR Name='Acira.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`], {stdio: 'ignore'}); p.on('exit', resolve); }); }
async function killStray() { /* every launch is killed by its own debugging port; nothing else is touched */ }

const template = path.join(work, 'template-' + scenario);
async function prepare() {
  await killStray(); await fs.rm(template, {recursive: true, force: true}); await fs.mkdir(template, {recursive: true});
  if (scenario === 'fresh') return;
  // Run once to finish first-run setup (and for restored30 create 30 tabs), then quit gracefully so the state is saved.
  const debugPort = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(exe, [...entryArgs, `--remote-debugging-port=${debugPort}`], {env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: template, ACIRA_BROWSER_TEST_HIDDEN: '1'}, stdio: 'ignore'});
  let ui;
  try {
    const target = await poll(async () => { try { return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.url.startsWith('acira-browser-ui://ui/index.html') && !t.url.includes('view=overlay')); } catch { return null; } }, Boolean, 'ui target', 60000);
    ui = await connect(target.webSocketDebuggerUrl); await poll(() => ui.evaluate('Boolean(window.acira?.getSnapshot)'), Boolean, 'window.acira', 30000); await sleep(800);
    const skipped = await poll(() => ui.evaluate(`(()=>{const b=document.querySelector('[aria-label="Skip setup"]')||[...document.querySelectorAll('button')].find(b=>/^Skip setup$/i.test(b.textContent.trim()));if(b)b.click();return !!b})()`), Boolean, 'Skip setup button', 15000); await sleep(1200);
    if (scenario === 'restored30') {
      for (let i = 1; i <= 30; i++) { await ui.evaluate(`window.acira.dispatch({type:'tab.new',url:'http://127.0.0.1:${PORT}/p${i}',background:${i < 30 ? 'true' : 'false'}}).then(()=>true)`); }
      await sleep(2500);
    }
    await sleep(4500); // let the state be written (it is saved shortly after the last change)
  } finally { try { ui?.close(); } catch {} /* quit gracefully so the state is written, then make sure it is gone */ await sleep(300); await killPort(debugPort); await sleep(1500); }
}
await prepare();
if (scenario !== 'fresh' && !fsSync.existsSync(path.join(template, 'setup', 'onboarding.json'))) throw new Error('setup was not skipped in the template profile: the measurement would be of first run');
// D_AB="NAME=value": alternate runs with and without that variable (A = with) so machine noise hits both equally.
const ab = process.env.D_AB ? Object.fromEntries([process.env.D_AB.split('=')]) : null;
const all = [], groups = {A: [], B: []};
for (let i = 0; i < runs * (ab ? 2 : 1); i++) {
  // D_REUSE=1: keep one profile per group across runs, like a person launching the app again (the compile cache and OS file cache stay warm).
  const group0 = ab ? (i % 2 === 0 ? 'A' : 'B') : 'B', profile = path.join(work, `run-${scenario}${process.env.D_REUSE ? '-' + group0 : ''}`);
  if (!process.env.D_REUSE || !fsSync.existsSync(profile)) { await fs.rm(profile, {recursive: true, force: true}); await fs.cp(template, profile, {recursive: true}); }
  try { const group = ab ? (i % 2 === 0 ? 'A' : 'B') : 'B'; const r = await launch(profile, {extraEnv: group === 'A' && ab ? ab : {}}); all.push(r); groups[group].push(r); console.log(JSON.stringify({run: i + 1, group, ...r})); } catch (error) { console.log('run failed', String(error.message || error).slice(0, 200)); }
  await killStray();
}
const keys = [...new Set(all.flatMap(r => Object.keys(r)))];
const summarize = list => Object.fromEntries(keys.map(k => [k, median(list.map(r => r[k]).filter(v => typeof v === 'number'))]));
const best = list => Object.fromEntries(keys.map(k => [k, Math.min(...list.map(r => r[k]).filter(v => typeof v === 'number'))]).filter(([, v]) => Number.isFinite(v)));
const summary = summarize(all);
if (ab) console.log('A/B', JSON.stringify({variable: process.env.D_AB, with: summarize(groups.A), without: summarize(groups.B)}));
console.log('SUMMARY', JSON.stringify({label, scenario, runs: all.length, median: summary, best: best(all)}));
await fs.writeFile(path.join(work, `result-${label}-${scenario}.json`), JSON.stringify({label, scenario, all, median: summary}, null, 1));
server.close();
