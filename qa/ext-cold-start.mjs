// Extension APIs at cold start: N cold starts of the real app on a profile that already holds store-installed extensions; in every
// extension service worker that runs after the start, checks that the engine's namespaces exist (chrome.tabs.create, windows, action …)
// and collects the worker's console errors and exceptions (Runtime.enable replays what it logged before we attached).
//   PROFILE=<folder under .qa-profiles> RUNS=5 node qa/ext-cold-start.mjs      (fill the profile first: qa/extension-matrix/recheck.mjs MODE=install)
// One Electron at a time, native slot (C:\ae\slot-N.lock, flag wx), try/finally close, hard cap 10 minutes. Never signs in.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';

const PROFILE = process.env.PROFILE; if (!PROFILE) throw Error('PROFILE=<folder under .qa-profiles>');
const RUNS = +(process.env.RUNS || 5), root = path.resolve('.qa-profiles', PROFILE);
const OUT = path.resolve(process.env.OUT || `qa/artifacts/ext-cold-start/${path.basename(PROFILE)}-${Date.now().toString(36)}`);
await fs.mkdir(OUT, {recursive: true});
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const PRESENT = `(() => { const c = globalThis.chrome || {}; return {tabsCreate: typeof (c.tabs && c.tabs.create), tabsQuery: typeof (c.tabs && c.tabs.query),
  windows: typeof (c.windows && c.windows.getAll), storage: typeof (c.storage && c.storage.local), namespaces: Object.keys(c).length,
  tabsKeys: c.tabs ? Object.keys(c.tabs).slice(0, 40).join(',') : null, list: Object.keys(c).sort().join(','),
  desc: (() => { const d = Object.getOwnPropertyDescriptor(c, 'tabs'); return d ? {c: d.configurable, w: d.writable, get: !!d.get} : null; })(), now: Date.now()}; })()`;
const BAD = /is not a function|Cannot read properties of undefined|is not defined|injectExtensionAPIs/;

function connect(url) {
  const ws = new WebSocket(url); let id = 0; const waiting = new Map(), listeners = [];
  const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(Error(JSON.stringify(msg.error))) : w.resolve(msg.result); } else listeners.forEach(fn => fn(msg)); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, {resolve, reject}); ws.send(JSON.stringify({id: n, method, params})); setTimeout(() => { if (waiting.has(n)) { waiting.delete(n); reject(Error('timeout ' + method)); } }, 5000); });
  return {ready, send, on: fn => listeners.push(fn), close: () => { try { ws.close(); } catch {} }};
}

let slot;
for (let i = 0; i < 40 && !slot; i++) { for (const n of [1, 2, 3]) { const f = `C:\\ae\\slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`ext-cold-start ${PROFILE} ${new Date().toISOString()}\n`); await h.close(); slot = f; break; } catch {} } if (!slot) await sleep(3000); }
if (!slot) { log('no native slot free'); process.exit(3); }
const results = [];
const cap = setTimeout(async () => { log('CAP reached'); await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({error: 'cap', results}, null, 1)).catch(() => {}); await fs.rm(slot, {force: true}).catch(() => {}); process.exit(4); }, 10 * 60 * 1000);
try {
  for (let run = 1; run <= RUNS; run++) {
    let app;
    try {
      app = await startApp({root, env: {ACIRA_DEV: '0'}});
      const userData = await app.main(({app}) => app.getPath('userData'));
      let port; for (let i = 0; i < 50 && !port; i++) { try { port = +(await fs.readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch { await sleep(100); } }
      // Wait for the extension workers that start with the app.
      let workers = [];
      for (let i = 0; i < 40; i++) { workers = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')); if (workers.length >= +(process.env.MIN_WORKERS || 2)) break; await sleep(250); }
      const row = {run, workers: []};
      // ONLY=<id,id>: just these extensions (Proton Pass's worker answers every chrome.* namespace as undefined to this evaluation, on
      // launch-sprint as well, so it cannot be judged this way).
      const only = (process.env.ONLY || '').split(',').filter(Boolean);
      for (const w of workers.filter(w => !only.length || only.some(id => w.url.startsWith(`chrome-extension://${id}/`)))) {
        const s = connect(w.webSocketDebuggerUrl); await s.ready; const said = [];
        s.on(m => {
          if (m.method === 'Runtime.exceptionThrown') said.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') said.push('ERR ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
          if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') said.push('LOG ' + m.params.entry.text.slice(0, 300));
        });
        await s.send('Runtime.enable').catch(() => {}); await s.send('Log.enable').catch(() => {}); await sleep(400);
        const present = await s.send('Runtime.evaluate', {expression: PRESENT, returnByValue: true}).then(r => r.result.value, e => ({error: e.message}));
        s.close();
        row.workers.push({id: w.url.slice(19, 51), url: w.url.slice(51), present, bad: said.filter(line => BAD.test(line)), errors: said.length});
      }
      results.push(row);
      log(`run ${run}:`, row.workers.map(w => `${w.id.slice(0, 6)} tabs.create=${w.present.tabsCreate} ns=${w.present.namespaces} bad=${w.bad.length}`).join(' | '));
    } catch (error) { results.push({run, error: String(error.message || error).slice(0, 300)}); log(`run ${run} failed`, error.message); }
    finally { await app?.close(); await sleep(1500); }
  }
} finally {
  clearTimeout(cap);
  const missing = results.flatMap(r => (r.workers || []).filter(w => w.present?.tabsCreate !== 'function' || w.bad.length).map(w => ({run: r.run, ...w})));
  await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({profile: PROFILE, runs: RUNS, missing, results}, null, 1));
  log(`workers checked: ${results.reduce((n, r) => n + (r.workers || []).length, 0)}; without the engine APIs or with startup errors: ${missing.length}`);
  log('result', path.join(OUT, 'result.json'));
  await fs.rm(slot, {force: true}).catch(() => {});
}
process.exit(0);
