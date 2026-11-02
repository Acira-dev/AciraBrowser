// Stream D: input -> first frame that shows the change, for the clicks people make all day, at 1, 30 and 100 tabs on a profile with real history.
//   node qa/d-latency.mjs [--tabs 1,30,100] [--reps 7] [--history 5000]      D_MAIN=<another desktop/main.cjs> measures other code (an A/B)
// Acira is started directly and driven over plain CDP (no Playwright: its attachment changes how pages behave). Every number is the median of --reps runs,
// measured in the page: t0 is the moment the event is dispatched, t1 the first animation frame in which the DOM already shows the change (the frame that
// paints it). For Ctrl+T the key goes through CDP Input.dispatchKeyEvent, so main handles it as it handles a real key. One visible instance; tabs beyond
// 30 are New tab pages (no native page view), so 100 tabs stays a 30-page window. Closed in finally.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const COUNTS = String(arg('tabs', '1,30,100')).split(',').map(Number), REPS = Math.min(Number(arg('reps', 7)), 15), HISTORY = Math.min(Number(arg('history', 5000)), 5000);
const root = path.resolve('.qa-profiles', 'd-latency-' + Date.now()); await fs.mkdir(root, {recursive: true});
async function json(port, p) { for (let i = 0; i < 100; i++) { try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json(); } catch { await sleep(200); } } throw new Error('no debugging port'); }
async function connect(url) { const ws = new WebSocket(url); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); }); let id = 0; const waiting = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } }; return {send: (method, params = {}) => new Promise(resolve => { const n = ++id; waiting.set(n, resolve); ws.send(JSON.stringify({id: n, method, params})); setTimeout(() => { if (waiting.delete(n)) resolve({error: 'timeout'}); }, 20000); }), close: () => ws.close()}; }
const ev = async (client, expression) => { const r = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><body style="font:16px sans-serif"><h1>${req.url}</h1>`); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const median = list => { const sorted = list.filter(v => v !== null).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const port = 9400 + Math.floor(Math.random() * 400); let pid = 0;
const exe = path.resolve('node_modules/electron/dist/electron.exe'), main = path.resolve(process.env.D_MAIN || 'desktop/main.cjs');
const child = spawn(exe, [main, `--remote-debugging-port=${port}`], {stdio: 'ignore', env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: root, ACIRA_PERF: '1'}});
const result = {main: path.relative(process.cwd(), main), history: HISTORY, reps: REPS, byTabs: {}};
let ui = null, overlay = null;
// the app must not outlive the rig: a timeout or Ctrl+C ends this process, and its Electron tree goes with it
const stopApp = () => { try { spawnSync('taskkill', ['/PID', String(pid || child.pid), '/T', '/F'], {timeout: 20000}); } catch {} };
process.on('exit', stopApp); for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => process.exit(1));
try {
  for (let i = 0; i < 150 && !ui; i++) { const t = (await json(port, '/json')).find(x => x.url === 'acira-browser-ui://ui/index.html' && x.type === 'page'); if (t) ui = await connect(t.webSocketDebuggerUrl); else await sleep(200); }
  for (let i = 0; i < 100 && !(await ev(ui, 'Boolean(window.acira&&window.acira.getSnapshot)')); i++) await sleep(200);
  pid = Number(spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' -and $_.CommandLine -notmatch '--type=' } | Sort-Object CreationDate | Select-Object -Last 1 -ExpandProperty ProcessId`], {encoding: 'utf8'}).stdout.trim()) || child.pid;
  for (let i = 0; i < 60; i++) { if (await ev(ui, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Skip setup/.test(x.textContent));if(b){b.click();return true;}return !document.querySelector('.fr-prism');})()`)) break; await sleep(250); } await sleep(1200);
  // a profile with real history and bookmarks
  for (let at = 0; at < HISTORY; at += 250) await ev(ui, `window.acira.dispatch({type:'history.restore',visits:Array.from({length:${Math.min(250, HISTORY - at)}},(_,i)=>({id:'seed-'+(${at}+i),title:'Seeded page '+(${at}+i)+' about things',url:'https://seed'+((${at}+i)%150)+'.example/path/'+(${at}+i),time:String(1000000-(${at}+i)).padStart(8,'0'),profileId:''}))})`);
  for (let i = 0; i < 40; i++) await ev(ui, `window.acira.dispatch({type:'bookmark.add',url:'https://bookmark${i}.example/',title:'Bookmark ${i}',parentId:null,index:${i}})`);
  const tabCount = () => ev(ui, `window.acira.getSnapshot().then(s=>s.tabs.length)`);
  // measure(label, setup, act, check): act runs in the page at t0; check() is true once the DOM shows the change
  const measure = async (act, check, settleMs = 700) => {
    const value = await ev(ui, `(async()=>{const done=new Promise(resolve=>{const check=()=>(${check});const obs=new MutationObserver(()=>{if(check()){obs.disconnect();requestAnimationFrame(()=>resolve(performance.timeOrigin+performance.now()));}});obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});setTimeout(()=>{obs.disconnect();resolve(null);},2500);});const t0=performance.timeOrigin+performance.now();(${act});const t1=await done;return t1===null?null:Math.round((t1-t0)*10)/10;})()`);
    await sleep(settleMs); return value;
  };
  const pointer = (selector, extra = '') => `(()=>{const el=${selector};const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,o={bubbles:true,cancelable:true,composed:true,button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,view:window};el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));const u={...o,buttons:0};el.dispatchEvent(new PointerEvent('pointerup',u));el.dispatchEvent(new MouseEvent('mouseup',u));el.dispatchEvent(new MouseEvent('click',u));${extra}})()`;
  for (const count of COUNTS) {
    let have = await tabCount();
    while (have < count) { const web = have < 30; await ev(ui, `window.acira.dispatch({type:'tab.new',url:${JSON.stringify(web ? `http://127.0.0.1:${server.address().port}/t${have}` : 'acira://new')}})`); have++; if (have % 5 === 0) await sleep(300); }
    while (have > count) { const id = await ev(ui, `window.acira.getSnapshot().then(s=>s.tabs.at(-1).id)`); await ev(ui, `window.acira.dispatch({type:'tab.close',id:${JSON.stringify(id)}})`); have--; await sleep(60); }
    await sleep(4000);
    const rows = {};
    const tabsInStrip = `document.querySelectorAll('.browser-tab, .acira-compact-tab').length`;
    const run = async (label, fn) => { const values = []; for (let i = 0; i < REPS; i++) { try { values.push(await fn(i)); } catch (error) { values.push(null); } } rows[label] = {median: median(values), worst: Math.max(...values.map(v => v ?? 0)), n: values.filter(v => v !== null).length, values}; };
    // tab click in the strip: an inactive tab becomes the selected one
    await run('strip tab click', async () => {
      const id = await ev(ui, `(()=>{const tabs=[...document.querySelectorAll('.browser-tab:not(.selected), .acira-compact-tab:not(.selected)')].filter(t=>t.getClientRects().length);const t=tabs[Math.floor(tabs.length/2)];return t&&t.dataset.tabId||t&&t.id||null;})()`);
      return measure(pointer(`document.querySelector('[data-tab-id="${id}"]')||document.getElementById(${JSON.stringify(id)})`), `(()=>{const el=document.querySelector('[data-tab-id="${id}"]')||document.getElementById(${JSON.stringify(id)});return !!el&&el.classList.contains('selected');})()`);
    });
    // + button: one more tab in the strip
    await run('+ button', async () => { const before = await tabCount(); const v = await measure(pointer(`[...document.querySelectorAll('button[aria-label="New tab"]')].filter(b=>b.getClientRects().length).pop()`), `${tabsInStrip}>${before}`); return v; });
    await run('Ctrl+T', async () => {
      const before = await tabCount(), t0Holder = {}; const probe = ev(ui, `(async()=>{const done=new Promise(resolve=>{const obs=new MutationObserver(()=>{if(document.querySelectorAll('.browser-tab, .acira-compact-tab').length>${before}){obs.disconnect();requestAnimationFrame(()=>resolve(performance.timeOrigin+performance.now()));}});obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true});setTimeout(()=>{obs.disconnect();resolve(null);},2500);});window.__t0=performance.timeOrigin+performance.now();const t1=await done;return t1===null?null:Math.round((t1-window.__t0)*10)/10;})()`);
      await sleep(30); await ev(ui, `window.__t0=performance.timeOrigin+performance.now()`);
      for (const type of ['rawKeyDown', 'keyUp']) await ui.send('Input.dispatchKeyEvent', {type, modifiers: 2, windowsVirtualKeyCode: 84, key: 't', code: 'KeyT', text: type === 'rawKeyDown' ? 't' : undefined});
      const v = await probe; await sleep(700); return v;
    });
    // close x: the last tab goes
    await run('close x', async () => { const id = await ev(ui, `(()=>{const tabs=[...document.querySelectorAll('.browser-tab, .acira-compact-tab')].filter(t=>t.dataset.tabId&&!t.dataset.leaving);return tabs.at(-1).dataset.tabId;})()`); const gone = `(()=>{const el=document.querySelector('[data-tab-id="${id}"]');return !el||el.dataset.leaving!==undefined;})()`; return measure(pointer(`document.querySelector('[data-tab-id="${id}"] .tab-close, [data-tab-id="${id}"] .acira-compact-tab-close')`), gone, 900); });
    // main menu: the popup shows in the overlay renderer; clocks of both renderers are the same epoch
    await run('menu open', async () => {
      if (!overlay) { const target = (await json(port, '/json')).find(x => /view=overlay/.test(x.url)); if (target) { overlay = await connect(target.webSocketDebuggerUrl); await ev(overlay, `window.__seen=[];new MutationObserver(()=>{const p=document.querySelector('.sheet-popup');if(p&&p.style.visibility!=='hidden'&&!p.hasAttribute('data-preparing')&&!window.__armed0){window.__armed0=performance.timeOrigin+performance.now();}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true});true`); } }
      if (!overlay) return null;
      await ev(overlay, `window.__armed0=0;true`);
      const t0 = await ev(ui, `(()=>{const t=performance.timeOrigin+performance.now();${pointer(`[...document.querySelectorAll('button')].find(b=>/Open Acira menu|Acira menu|^Menu/.test(b.getAttribute('aria-label')||''))||document.querySelector('.menu-button')`)};return t;})()`);
      await sleep(900); const t1 = await ev(overlay, `window.__armed0`); await ev(overlay, `window.acira.getBrowserLayout().then(l=>window.acira.closeOverlay(l.overlay&&l.overlay.id))`); await sleep(700);
      return t1 ? Math.round((t1 - t0) * 10) / 10 : null;
    });
    // Alt+T: the tab viewer shows in the overlay renderer (same clock as the page)
    await run('Alt+T', async () => {
      if (!overlay) return null;
      await ev(overlay, 'window.__armed0=0;true'); const t0 = await ev(ui, 'performance.timeOrigin+performance.now()');
      for (const type of ['rawKeyDown', 'keyUp']) await ui.send('Input.dispatchKeyEvent', {type, modifiers: 1, windowsVirtualKeyCode: 84, key: 't', code: 'KeyT', text: type === 'rawKeyDown' ? 't' : undefined});
      await sleep(900); const t1 = await ev(overlay, 'window.__armed0'); await ev(overlay, 'window.acira.getBrowserLayout().then(l=>window.acira.closeOverlay(l.overlay&&l.overlay.id))'); await sleep(700);
      return t1 ? Math.round((t1 - t0) * 10) / 10 : null;
    });
    // toolbar layout switch (compact <-> normal): a settings change, first frame in which the page root's class or the toolbar's height differs
    await run('compact<->normal', async (i) => {
      const next = i % 2 === 0 ? 'automatic' : 'expanded';
      return measure(`window.acira.dispatch({type:'settings.update',patch:{toolbarLayout:'${next}'}})`, `(()=>{const key=document.querySelector('.browser-root').className+'|'+Math.round(document.querySelector('.browser-toolbar')?.getBoundingClientRect().height||0);if(window.__lay===undefined)window.__lay=key;if(window.__lay!==key){window.__lay=key;return true;}return false;})()`, 900);
    });
    result.byTabs[count] = rows; console.error('tabs', count, JSON.stringify(rows));
  }
  console.log(JSON.stringify(result, null, 1));
  await fs.mkdir('.tmp-d/latency', {recursive: true}); await fs.writeFile(`.tmp-d/latency/${process.env.LABEL || 'run'}-${Date.now()}.json`, JSON.stringify(result, null, 1));
} finally {
  try { ui?.close(); overlay?.close(); } catch {}
  spawnSync('taskkill', ['/PID', String(pid || child.pid), '/T', '/F'], {timeout: 20000}); server.close();
}
