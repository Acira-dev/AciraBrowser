// Stream D: memory saver without Playwright. Playwright keeps every page "visible" and "captured", so under it a hidden tab can neither
// freeze nor sleep. The app is driven through its own UI page over a bare CDP socket; pages under test are seen through the fixture server
// and short-lived page sockets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {httpFixture, sleep, poll} from './d-harness.mjs';
const root = path.resolve('.qa-profiles/d-sleep-raw'); await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const beats = {}, loads = {}, report = [];
// One second of a very quiet 440 Hz tone: audible to Chromium (silence or a zero-length clip is not) without bothering anyone.
const tone = (() => { const n = 8000, data = Buffer.alloc(n); for (let i = 0; i < n; i++) data[i] = 128 + Math.round(10 * Math.sin(2 * Math.PI * 440 * i / 8000)); const head = Buffer.alloc(44); head.write('RIFF', 0); head.writeUInt32LE(36 + n, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(8000, 24); head.writeUInt32LE(8000, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34); head.write('data', 36); head.writeUInt32LE(n, 40); return Buffer.concat([head, data]); })();
const fx = await httpFixture((req, res) => {
  const url = new URL(req.url, 'http://x'), name = url.pathname.slice(1);
  if (url.pathname === '/beat') { beats[url.searchParams.get('id')] = Date.now(); res.statusCode = 204; return res.end(); }
  if (url.pathname === '/tone.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(tone); }
  loads[name] = (loads[name] || 0) + 1;
  res.setHeader('content-type', 'text/html');
  const heartbeat = `<script>setInterval(()=>fetch('/beat?id=${name}').catch(()=>{}),100)</script>`;
  const extra = name === 'form' ? '<input id=t>' : name === 'media' ? '<audio id=m src="/tone.wav" loop></audio>' : name === 'unload' ? "<script>addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='x'})</script>" : '';
  res.end(`<title>${name}</title><body style="height:5000px">${name}${extra}${heartbeat}`);
});
const base = `http://127.0.0.1:${fx.port}`, localhost = `http://localhost:${fx.port}`, age = id => Date.now() - (beats[id] || 0);
const debugPort = 20000 + Math.floor(Math.random() * 20000);
const electron = path.resolve('node_modules/electron/dist/electron.exe');
const child = spawn(electron, [path.resolve('desktop/main.cjs'), `--remote-debugging-port=${debugPort}`], {
  env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: root, ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_PERF: '1', ACIRA_MEMORY_SAVER_IDLE_MS: '26000', ACIRA_MEMORY_SAVER_FREEZE_MS: '5000', ACIRA_MEMORY_SAVER_TICK_MS: '1000', ACIRA_MEMORY_SAVER_DEBUG: '1'},
  stdio: ['ignore', 'pipe', 'pipe']});
const logs = []; child.stdout.on('data', d => logs.push(String(d))); child.stderr.on('data', d => logs.push(String(d)));
function connect(url) { return new Promise((resolve, reject) => {
  const socket = new WebSocket(url), waiting = new Map(); let nextId = 1;
  socket.onmessage = event => { const message = JSON.parse(event.data), entry = waiting.get(message.id); if (!entry) return; waiting.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); };
  socket.onerror = reject;
  socket.onopen = () => resolve({
    close: () => socket.close(),
    evaluate: async (expression, userGesture = false) => { const out = await new Promise((ok, bad) => { const id = nextId++; waiting.set(id, {resolve: ok, reject: bad}); socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true, userGesture}})); }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || 'evaluate failed'); return out.result.value; }});
}); }
let ui;
const targets = async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json());
const act = action => ui.evaluate(`window.acira.dispatch(${JSON.stringify(action)}).then(()=>true)`);
const state = () => ui.evaluate('Promise.resolve(window.acira.getSnapshot()).then(s=>JSON.stringify(s))').then(JSON.parse);
const tab = async (name, host = base) => (await state()).tabs.find(t => t.url === `${host}/${name}`);
const inPage = async (name, expression, host = base, userGesture = false) => { const target = (await targets()).find(t => t.type === 'page' && t.url === `${host}/${name}`); assert.ok(target, `${name} has a live page`); const page = await connect(target.webSocketDebuggerUrl); try { return await page.evaluate(expression, userGesture); } finally { page.close(); } };
try {
  const target = await poll(async () => (await targets()).find(t => t.url === 'acira-browser-ui://ui/index.html'), Boolean, 'ui target', 40000);
  ui = await connect(target.webSocketDebuggerUrl);
  await poll(() => ui.evaluate('Boolean(window.acira?.getSnapshot)'), Boolean, 'window.acira', 30000);
  await sleep(800); await ui.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Skip setup');b?.click();return !!b})()`); await sleep(600);
  await act({type: 'settings.update', patch: {memorySaver: {enabled: true, idleMinutes: 15, neverSleep: ['localhost']}}});
  const open = async (name, host = base) => { await act({type: 'tab.new', url: `${host}/${name}`}); await poll(() => age(name) < 1000, Boolean, `${name} running`, 20000); await sleep(300); };
  for (const name of ['plain', 'form', 'media', 'unload']) await open(name);
  await open('never', localhost);
  await inPage('plain', 'scrollTo(0,500),1'); await inPage('form', "(()=>{const i=document.getElementById('t');i.focus();i.value='typed by the user';i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()");
  await inPage('media', "(()=>{const m=document.getElementById('m');m.volume=0.05;return m.play().then(()=>1)})()", base, true);
  for (const name of ['a', 'b', 'c']) await open(name);
  await act({type: 'tab.new', url: `${base}/home`}); await poll(() => age('home') < 1000, Boolean, 'home running', 20000);
  // 1. Hidden, unprotected tabs freeze after the freeze delay; the shown tab keeps running.
  await poll(() => age('a') > 2500 && age('b') > 2500 && age('c') > 2500, Boolean, 'hidden tabs freeze', 30000);
  assert.ok(age('home') < 2500, 'the shown tab keeps running'); assert.ok(!(await state()).tabs.some(t => t.sleeping && ['a', 'b', 'c'].some(n => t.url.endsWith('/' + n))), 'frozen is not asleep'); report.push('hidden tabs stop running timers after the freeze delay; the shown tab keeps running');
  // 2. Showing a frozen tab resumes it at once, without a reload.
  const loadsBefore = loads.a; await act({type: 'tab.select', id: (await tab('a')).id}); await poll(() => age('a') < 1500, Boolean, 'a resumes', 8000);
  assert.equal(loads.a, loadsBefore, 'a frozen tab resumes without reloading'); report.push('selecting a frozen tab resumes it immediately with no reload');
  // 3. Closing a frozen tab works.
  await act({type: 'tab.close', id: (await tab('c')).id}); await poll(async () => !(await tab('c')), Boolean, 'c closed', 8000); report.push('a frozen tab closes normally');
  // 4. After the idle time the safe tabs sleep and keep their place; the protected ones stay awake.
  await poll(async () => (await tab('plain'))?.sleeping && (await tab('b'))?.sleeping, Boolean, 'plain and b sleep', 70000);
  const awake = async name => { const t = await tab(name, name === 'never' ? localhost : base); return t && !t.sleeping; };
  for (const name of ['form', 'media', 'unload', 'never']) assert.ok(await awake(name), `${name} must stay awake`);
  const entry = await tab('b'); assert.ok(entry.title && entry.url === `${base}/b`, 'a sleeping tab keeps its title and address'); report.push('idle tabs sleep and keep title/address; edited form, playing audio, beforeunload page and never-sleep site stay awake');
  // 5. Waking: reload at the same scroll position; the sleeping flag clears.
  await act({type: 'tab.select', id: (await tab('plain')).id}); const resumed = Date.now(); await poll(() => beats.plain > resumed, Boolean, 'plain runs again', 15000);
  assert.ok(!(await tab('plain')).sleeping); await poll(() => inPage('plain', 'Math.round(scrollY)'), y => y === 500, 'scroll restored', 10000); report.push('opening a sleeping tab reloads it at the same scroll position; sleeping flag clears');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} catch (error) {
  console.log('SWEEPS', logs.join('').split(/\r?\n/).filter(l => l.includes('tab-sleep')).slice(-4).join('\n')); console.log('AGES', JSON.stringify({a: age('a'), b: age('b'), c: age('c'), home: age('home')})); try { console.log('UI', JSON.stringify(await ui.evaluate("document.body.innerText.slice(0,300)")), JSON.stringify((await state()).tabs.map(t => [t.url.replace(base, ''), !!t.sleeping, t.loading]))); } catch {}
  throw error;
} finally { try { ui?.close(); } catch {} try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'}); } catch {} fx.server.closeAllConnections?.(); await fx.close(); }
