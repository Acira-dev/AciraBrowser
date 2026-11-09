// Memory rig: launches the dev build of this checkout on a throwaway profile under /tmp/acira-qa/memory-rig/ with an inspector on
// the main process, seeds N tabs (pinned / linked to a favorite), and serves POST /eval on 127.0.0.1:$RAM_PORT. Never touches a real profile.
//   node qa/memory-rig/driver.mjs <run> ; env RAM_SEED = one|seven (default seven), RAM_EXT=1 installs nothing (extension case is a separate step)
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const REPO = process.env.RAM_REPO || path.resolve(new URL('../..', import.meta.url).pathname);
process.chdir(REPO);
const repoRequire = createRequire(REPO + '/package.json');
const SAFE = '/tmp/acira-qa/memory-rig/';
const RUN = process.argv[2] || 'seven', ROOT = path.join(SAFE, RUN), PORT = Number(process.env.RAM_PORT || 9831);
if (!path.resolve(ROOT).startsWith(SAFE)) throw new Error('profile must live under ' + SAFE);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fresh = process.env.RIG_KEEP !== '1' || !(await fs.stat(path.join(ROOT, 'browser.sqlite')).then(() => true, () => false));
if (fresh) await fs.rm(ROOT, {recursive: true, force: true});
await fs.mkdir(ROOT, {recursive: true});
const SITES = {
  pin: ['https://en.wikipedia.org/wiki/Web_browser', 'https://news.ycombinator.com/', 'https://developer.mozilla.org/en-US/', 'https://www.bbc.com/news', 'https://docs.python.org/3/'],
  fav: ['https://www.theguardian.com/international', 'https://www.w3.org/'],
};
// 'fixture' run (13.2): five pinned tabs and one plain active tab on local pages (no live sites, nothing audible) so the sleep rules can be checked in the real app:
// /tall (scroll to restore), /ambient (muted looping video), /loud (unmuted looping video), /form (a typed draft), /plain.
const FIX_PORT = Number(process.env.RAM_FIX || 9834), FIX = 'http://127.0.0.1:' + FIX_PORT;
const LOCAL = process.env.RAM_LOCAL === '1';
// RAM_LOCAL=1 (13.3): the seven-tab run (5 pinned + 2 Favorites) on seven local pages instead of the live sites, so a measurement uses no network.
if (LOCAL) { SITES.pin = [1, 2, 3, 4, 5].map(i => FIX + '/site' + i); SITES.fav = [6, 7].map(i => FIX + '/site' + i); }
if (RUN === 'fixture' || LOCAL) {
  const clip = (muted) => `<video id=v ${muted ? 'muted' : ''} loop playsinline width=160 height=90></video><script>(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');let n=0;const t=setInterval(()=>{x.fillStyle='hsl('+(n++*20%360)+',70%,50%)';x.fillRect(0,0,160,90);},50);const r=new MediaRecorder(c.captureStream(15),{mimeType:'video/webm'});const parts=[];r.ondataavailable=e=>parts.push(e.data);r.onstop=()=>{clearInterval(t);const v=document.getElementById('v');v.src=URL.createObjectURL(new Blob(parts,{type:'video/webm'}));v.play().then(()=>{window.__playing=true;});};r.start();setTimeout(()=>r.stop(),1500);})()</script>`;
  const pages = {
    '/tall': '<h1>Tall page</h1><div style="height:6000px;background:linear-gradient(#fff,#bcd)">tall</div><p id=end>end</p>',
    '/ambient': clip(true), '/loud': clip(false),
    '/form': '<textarea id=t></textarea><script>document.getElementById("t").value="a draft the person typed"</script>',
    '/plain': '<h1>Plain page</h1><p>nothing here</p>',
  };
  for (let i = 1; i <= 7; i++) pages['/site' + i] = '<h1>Local site ' + i + '</h1>' + ('<p>Plain text for a page that is shown, left and slept: ' + 'words '.repeat(60) + '</p>').repeat(150);
  http.createServer((req, res) => { const u = new URL(req.url, FIX).pathname; res.setHeader('content-type', 'text/html; charset=utf-8'); res.statusCode = pages[u] ? 200 : 404; res.end('<!doctype html><meta charset=utf-8><title>' + u + '</title><body style="margin:0;font:16px sans-serif">' + (pages[u] || 'no')); }).listen(FIX_PORT, '127.0.0.1');
}
async function prepare() {
  const nonce = randomUUID(), marker = path.join(ROOT, `native-key-${nonce}.json`);
  const env = {...process.env, ACIRA_BROWSER_TEST_DATA: ROOT, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(ROOT, 'dl'), ACIRA_PREPARE_PROFILE: ROOT, ACIRA_PREPARE_NONCE: nonce, APPDATA: path.join(ROOT, 'fixture-roaming'), LOCALAPPDATA: path.join(ROOT, 'fixture-local')};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(repoRequire('electron'), ['--use-mock-keychain', '--mute-audio', path.resolve(REPO, 'qa/prepare-native-profile.cjs')], {env, stdio: 'ignore'});
  let result; for (let i = 0; i < 800 && !result; i++) { try { const r = JSON.parse(await fs.readFile(marker, 'utf8')); if (r.nonce === nonce) result = r; } catch {} await sleep(30); }
  if (!result?.ready) throw new Error(result?.error || 'key preparation did not finish');
  for (let i = 0; i < 800; i++) { try { process.kill(result.pid, 0); } catch { break; } await sleep(30); }
  await fs.unlink(marker).catch(() => {}); child.kill();
  return env;
}
let env;
if (fresh) {
  const {BrowserDatabase} = repoRequire(REPO + '/desktop/database.cjs'), {createInitialState, makeTab} = repoRequire(REPO + '/desktop/runtime.cjs');
  const s0 = createInitialState(), pid = s0.activeBrowserProfileId;
  if (RUN === 'one') { s0.tabs = [makeTab('a', 'Start', 'https://en.wikipedia.org/wiki/Web_browser', pid)]; s0.activeTabId = 'a'; }
  else if (RUN === 'fixture') {
    s0.tabs = [];
    [['pin0', '/tall'], ['pin1', '/ambient'], ['pin2', '/loud'], ['pin3', '/form'], ['pin4', '/plain']].forEach(([id, path_]) => { const t = makeTab(id, id, FIX + path_, pid); t.pinned = process.env.RAM_UNPIN !== '1'; s0.tabs.push(t); });
    s0.tabs.push(makeTab('act', 'Active', FIX + '/plain?active', pid)); s0.activeTabId = 'act';
  } else {
    s0.tabs = [];
    SITES.pin.forEach((u, i) => { const t = makeTab('pin' + i, 'Pin ' + i, u, pid); t.pinned = process.env.RAM_UNPIN !== '1'; s0.tabs.push(t); });
    SITES.fav.forEach((u, i) => { const t = makeTab('fav' + i, 'Fav ' + i, u, pid); t.favoriteId = 'fav-' + i; s0.tabs.push(t); });
    s0.activeTabId = 'pin0';
  }
  Object.assign(s0.settings, {onboardingComplete: true, askBeforeClosing: false, appearance: 'light', reducedMotion: true});
  if (process.env.RAM_LANG) s0.settings.language = process.env.RAM_LANG;   // 13.3: a language other than English, to see the packed catalogs unpack in the real app
  Object.assign(s0.windowUi, {view: 'full', workspaceOpen: true, webWorkspaceOpen: true});
  const db = new BrowserDatabase(path.join(ROOT, 'browser.sqlite')); db.saveWindow('main', s0); db.close();
  env = await prepare();
} else { env = {...process.env, ACIRA_BROWSER_TEST_DATA: ROOT, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(ROOT, 'dl'), APPDATA: path.join(ROOT, 'fixture-roaming'), LOCALAPPDATA: path.join(ROOT, 'fixture-local')}; delete env.ELECTRON_RUN_AS_NODE; }
env.HOME = path.join(ROOT, 'home'); await fs.mkdir(env.HOME, {recursive: true}); await fs.mkdir(env.APPDATA, {recursive: true}); await fs.mkdir(env.LOCALAPPDATA, {recursive: true});
const CDP_PORT = Number(process.env.RAM_CDP || 9832), INSPECT_PORT = Number(process.env.RAM_INSPECT || 9833);
const args = ['--use-mock-keychain', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`, `--inspect=${INSPECT_PORT}`];
if (process.env.RIG_FLAGS) args.push(...process.env.RIG_FLAGS.split(' ').filter(Boolean));
args.push(path.resolve(REPO, 'desktop/main.cjs'));
const child = spawn(repoRequire('electron'), args, {env, stdio: ['ignore', 'pipe', 'pipe']});
const mainLog = []; child.stdout.on('data', d => mainLog.push('[out] ' + d.toString().trimEnd())); child.stderr.on('data', d => mainLog.push('[err] ' + d.toString().trimEnd()));
const getJson = async url => { for (let i = 0; i < 300; i++) { try { return await (await fetch(url)).json(); } catch { await sleep(200); } } throw new Error('no ' + url); };
const targets = await getJson(`http://127.0.0.1:${INSPECT_PORT}/json/list`);
const ws = new WebSocket(targets[0].webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const waiting = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const inspect = expression => new Promise(res => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true}})); }).then(d => { if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 400)); return d.result.result.value; });
const app = {evaluate: (fn, arg) => inspect(`(async()=>{const e=process.mainModule.require('electron');return await (${fn.toString()})(e, ${JSON.stringify(arg === undefined ? null : arg)});})()`), close: async () => { try { child.kill('SIGTERM'); } catch {} }};
const mainPid = await app.evaluate(() => process.pid);
if (mainPid !== child.pid) { console.error('ABORT: inspector reached pid', mainPid, 'not', child.pid); child.kill('SIGKILL'); process.exit(9); }
let userData = ''; for (let i = 0; i < 100; i++) { userData = await app.evaluate(({app}) => app.isReady() ? app.getPath('userData') : '').catch(() => ''); if (userData) break; await sleep(200); }
if (!path.resolve(userData).startsWith(SAFE)) { console.error('ABORT: userData is', userData); child.kill('SIGKILL'); process.exit(9); }
console.log('userData', userData, 'pid', child.pid);
await app.evaluate(() => { globalThis.__rigErrors = []; process.on('uncaughtException', error => { globalThis.__rigErrors.push(String(error && error.stack || error).slice(0, 600)); }); });
let uiTarget; for (let i = 0; i < 300 && !uiTarget; i++) { try { uiTarget = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(t => t.type === 'page' && t.url === 'acira-browser-ui://ui/index.html'); } catch {} if (!uiTarget) await sleep(200); }
if (!uiTarget) throw new Error('no UI page');
const uiWs = new WebSocket(uiTarget.webSocketDebuggerUrl); await new Promise((res, rej) => { uiWs.onopen = res; uiWs.onerror = rej; });
let uiSeq = 0; const uiWaiting = new Map(); uiWs.onmessage = m => { const d = JSON.parse(m.data); if (d.id && uiWaiting.has(d.id)) { uiWaiting.get(d.id)(d); uiWaiting.delete(d.id); } };
const ui = {evaluate: (fn, arg) => new Promise(res => { const id = ++uiSeq; uiWaiting.set(id, res); uiWs.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression: `(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`, awaitPromise: true, returnByValue: true, userGesture: true}})); }).then(d => { if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 400)); return d.result?.result?.value; })};
for (let i = 0; i < 150; i++) { if (await ui.evaluate(() => !!window.acira && !!window.acira.dispatch).catch(() => false)) break; await sleep(200); }
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const snap = () => ui.evaluate(() => window.acira.getSnapshot());
child.on('exit', () => { console.log('app exited'); process.exit(0); });
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const ctx = {app, ui, act, snap, sleep, ROOT, mainLog, fs, path, child};
http.createServer((req, res) => {
  if (req.method !== 'POST') { res.end('ok'); return; }
  let body = ''; req.on('data', c => body += c); req.on('end', async () => {
    try {
      if (req.url === '/quit') { res.end('bye'); await app.close().catch(() => {}); setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch {} process.exit(0); }, 4000); return; }
      const out = await new AsyncFunction(...Object.keys(ctx), body)(...Object.values(ctx));
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out === undefined ? null : out, null, 1));
    } catch (e) { res.statusCode = 500; res.end(String(e && e.stack || e)); }
  });
}).listen(PORT, '127.0.0.1', () => console.log('READY', PORT));
setTimeout(() => { console.log('watchdog: 90min'); app.close().catch(() => {}); try { process.kill(child.pid, 'SIGKILL'); } catch {} process.exit(0); }, 90 * 60_000).unref();
