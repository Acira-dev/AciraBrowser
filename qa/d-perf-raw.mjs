// Stream D: tab weight, measured from the OS process list (no Playwright, which would keep pages captured and awake).
// usage: node qa/d-perf-raw.mjs <off|on> ; env D_PERF_FREEZE_MS (default 100000), D_PERF_IDLE_MS (default 200000)
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sleep, poll} from './d-harness.mjs';
const mode = process.argv[2] === 'on' ? 'on' : 'off', root = path.resolve(`.qa-profiles/d-perf-raw-${mode}`);
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const sites = ['youtube.com/watch?v=jNQXAC9IVRw', 'excalidraw.com', 'x.com/explore', 'reddit.com/r/popular', 'github.com/torvalds/linux', 'en.wikipedia.org/wiki/Web_browser', 'theguardian.com/international', 'app.diagrams.net', 'notion.so/product', 'amazon.com'];
const debugPort = 20000 + Math.floor(Math.random() * 20000);
const child = spawn(path.resolve('node_modules/electron/dist/electron.exe'), [path.resolve('desktop/main.cjs'), `--remote-debugging-port=${debugPort}`], {
  env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: root, ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_PERF: '1', ACIRA_MEMORY_SAVER_FREEZE_MS: process.env.D_PERF_FREEZE_MS || '100000', ACIRA_MEMORY_SAVER_IDLE_MS: process.env.D_PERF_IDLE_MS || '200000', ACIRA_MEMORY_SAVER_TICK_MS: '5000'}, stdio: 'ignore'});
function connect(url) { return new Promise((resolve, reject) => {
  const socket = new WebSocket(url), waiting = new Map(); let nextId = 1;
  socket.onmessage = event => { const message = JSON.parse(event.data), entry = waiting.get(message.id); if (!entry) return; waiting.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
  socket.onerror = reject;
  socket.onopen = () => resolve({close: () => socket.close(), evaluate: async expression => { const out = await new Promise((ok, bad) => { const id = nextId++; waiting.set(id, {resolve: ok, reject: bad}); socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}})); }); return out.result?.value; }});
}); }
const targets = async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json());
let ui; const act = a => ui.evaluate(`window.acira.dispatch(${JSON.stringify(a)}).then(()=>true)`);
const state = () => ui.evaluate('Promise.resolve(window.acira.getSnapshot()).then(s=>JSON.stringify(s))').then(JSON.parse);
const run = promisify(execFile);
const processes = async () => { const {stdout} = await run('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime | ConvertTo-Json -Compress'], {maxBuffer: 1 << 26}); return JSON.parse(stdout); };
// The browser main process is found by its debugging port: the spawned pid is not always the process that ends up serving it.
const ours = list => { const root = list.find(p => p.Name === 'electron.exe' && String(p.CommandLine).includes(`--remote-debugging-port=${debugPort}`) && !String(p.CommandLine).includes('--type=')); const ids = new Set(root ? [root.ProcessId] : []); for (let grew = true; grew;) { grew = false; for (const p of list) if (ids.has(p.ParentProcessId) && !ids.has(p.ProcessId)) { ids.add(p.ProcessId); grew = true; } } return list.filter(p => ids.has(p.ProcessId)); };
const cpuSeconds = p => (Number(p.KernelModeTime) + Number(p.UserModeTime)) / 1e7;
// RAM is the sum of each process's private memory (what it alone costs); working set double-counts shared pages and is reported for reference.
async function measure(label, seconds = 15) {
  const first = ours(await processes()), t0 = Date.now(); await sleep(seconds * 1000); const second = ours(await processes()), elapsed = (Date.now() - t0) / 1000;
  const before = new Map(first.map(p => [p.ProcessId, cpuSeconds(p)]));
  const cpu = second.reduce((sum, p) => sum + Math.max(0, cpuSeconds(p) - (before.get(p.ProcessId) ?? cpuSeconds(p))), 0) / elapsed * 100;
  const tabs = (await state()).tabs;
  const out = {label, processes: second.length, renderers: second.filter(p => /--type=renderer/.test(String(p.CommandLine))).length, privateMb: Math.round(second.reduce((s, p) => s + Number(p.PrivatePageCount), 0) / 1048576), workingSetMb: Math.round(second.reduce((s, p) => s + Number(p.WorkingSetSize), 0) / 1048576), cpuPercentOfOneCore: Math.round(cpu * 10) / 10, sleepingTabs: tabs.filter(t => t.sleeping).length, tabs: tabs.length};
  console.log(JSON.stringify(out)); return out;
}
try {
  const target = await poll(async () => (await targets()).find(t => t.url === 'acira-browser-ui://ui/index.html'), Boolean, 'ui target', 40000);
  ui = await connect(target.webSocketDebuggerUrl); await poll(() => ui.evaluate('Boolean(window.acira?.getSnapshot)'), Boolean, 'window.acira', 30000);
  await sleep(800); await ui.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Skip setup');b?.click();return !!b})()`); await sleep(600);
  await act({type: 'settings.update', patch: {memorySaver: {enabled: mode === 'on', idleMinutes: 15, neverSleep: []}}});
  const loaded = [];
  for (const site of sites) {
    await act({type: 'tab.new', url: site}); const id = (await state()).tabs.at(-1).id;
    const t = await poll(async () => (await state()).tabs.find(x => x.id === id), x => x && (x.error || (!x.loading && x.title)), site, 45000).catch(() => null);
    loaded.push(`${site} ${t && !t.error ? 'ok' : 'FAIL'}`);
    if (site.startsWith('youtube')) { const page = (await targets()).find(x => x.type === 'page' && x.url.includes('youtube.com')); if (page) { const p = await connect(page.webSocketDebuggerUrl); await p.evaluate("document.querySelector('video')?.pause()").catch(() => {}); p.close(); } }
  }
  console.log(JSON.stringify({mode, loaded: loaded.join('; ')}));
  await act({type: 'tab.select', id: (await state()).tabs.find(t => t.url.includes('wikipedia')).id});
  const results = [await measure('all 10 live (just loaded)')];
  await sleep(Number(process.env.D_PERF_FREEZE_MS || 100000) + 15000); results.push(await measure('after freeze delay'));
  await sleep(Number(process.env.D_PERF_IDLE_MS || 200000) - Number(process.env.D_PERF_FREEZE_MS || 100000) + 20000); results.push(await measure('after sleep delay'));
  await fs.writeFile(`.tmp-d/perf-raw-${mode}.json`, JSON.stringify({mode, loaded, results}, null, 1));
} finally { try { ui?.close(); } catch {} try { const root = (await processes()).find(p => p.Name === 'electron.exe' && String(p.CommandLine).includes(`--remote-debugging-port=${debugPort}`) && !String(p.CommandLine).includes('--type=')); for (const pid of new Set([child.pid, root?.ProcessId].filter(Boolean))) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {stdio: 'ignore'}); } catch {} }
