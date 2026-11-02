// 1Password / Proton Pass check on the real app, over the app's own DevTools port (Playwright starts Electron with --remote-debugging-port=0).
// For each extension: worker present, toolbar button → what opens (Proton: popup.html; 1Password with no account: its setup page, then
// Continue → the Sign in screen), content scripts on a local sign-in fixture (worlds, page resources, in-field icon), then 45 s idle
// and the toolbar button again. Never signs in, never types into an extension, never creates an account.
//   cd <short-path checkout>   (Windows MAX_PATH: unpacked packages are deep)
//   node qa/extension-matrix/pm-trace.mjs            env: PM_PROFILE (under .qa-profiles, reused), OUT, IDLE_MS (45000), IDS (1password,proton)
// Takes a native slot (C:\ae\slot-N.lock, flag wx), one Electron, try/finally, hard cap. Store installs into the test profile only.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {startApp, sleep} from '../d-harness.mjs';

const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const OUT = path.resolve(process.env.OUT || `qa/artifacts/ext-matrix/pm-trace-${Date.now()}`); await fs.mkdir(OUT, {recursive: true});
const ALL = {'1password': {id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', opens: '/app/app.html'}, proton: {id: 'ghmbeldphafepmbegfdlkpapadhbakde', opens: '/popup.html'}};
const IDS = (process.env.IDS || '1password,proton').split(',').map(name => ({name, ...ALL[name]}));
const IDLE = +(process.env.IDLE_MS || 45000);

const devtoolsPort = async app => { const userData = await app.main(({app}) => app.getPath('userData')); for (let i = 0; i < 50; i++) { try { return +(await fs.readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch {} await sleep(100); } throw Error('no DevToolsActivePort'); };
const targets = async port => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function attach(url) {
  const ws = new WebSocket(url); let id = 0; const waiting = new Map(), listeners = [];
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(Error(JSON.stringify(msg.error))) : w.resolve(msg.result); } else listeners.forEach(l => l(msg)); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, {resolve, reject}); ws.send(JSON.stringify({id: n, method, params})); setTimeout(() => { if (waiting.has(n)) { waiting.delete(n); reject(Error('cdp timeout ' + method)); } }, 15000); });
  const evaluate = async (expression, contextId) => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, ...(contextId ? {contextId} : {})}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  return {send, evaluate, on: fn => listeners.push(fn), close: () => { try { ws.close(); } catch {} }};
}
const PAGE_STATE = `(() => { const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  const all = [...document.querySelectorAll('body *')]; return {url: location.href, inner: [innerWidth, innerHeight], text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300), elements: all.length, visible: all.filter(vis).length}; })()`;

let slot;
for (let i = 0; i < 40 && !slot; i++) { for (const n of [1, 2, 3]) { const f = `C:\\ae\\slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`pm-trace (1Password/Proton) ${new Date().toISOString()}\n`); await h.close(); slot = f; break; } catch {} } if (!slot) await sleep(30000); }
if (!slot) { log('no native slot free'); process.exit(3); }
let app, server; const sessions = [], R = {checked: new Date().toISOString(), extensions: {}};
const cap = setTimeout(async () => { log('CAP reached'); try { await app?.close(); } catch {} await fs.rm(slot, {force: true}); process.exit(4); }, 600000);
try {
  server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Sign in fixture</title><body style="font:15px system-ui;padding:40px"><h1>Sign in</h1><form method="post" action="/done"><p><label>Email <input type="email" id="email" name="email" autocomplete="username" style="width:280px;padding:8px"></label></p><p><label>Password <input type="password" id="password" name="password" autocomplete="current-password" style="width:280px;padding:8px"></label></p><p><button type="submit">Sign in</button></p></form>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const fixture = `http://localhost:${server.address().port}/login`;
  app = await startApp({root: path.resolve('.qa-profiles', process.env.PM_PROFILE || 'pm-trace'), env: {ACIRA_DEV: '0'}});
  const port = await devtoolsPort(app), state = await app.state(), profileId = state.activeBrowserProfileId, partition = state.browserProfiles[0].partition;
  const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
  // The install review is a native message box: answer it as "Load extension"; extension windows never show or take focus (the QA window is hidden).
  await app.main(({app: electronApp, dialog, session}, partition) => {
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    const target = session.fromPartition(partition);
    electronApp.on('browser-window-created', (_event, window) => { if (window.webContents?.session !== target) return; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.show = () => {}; window.showInactive = () => {}; window.focus = () => {}; });
  }, partition);
  let list = (await ext({type: 'list'})).extensions;
  for (const item of IDS) { if (!list.find(e => e.id === item.id)) { log('installing', item.name); await ext({type: 'install', extensionId: item.id}); } await ext({type: 'pin', extensionId: item.id, pinned: true}); }
  list = (await ext({type: 'list'})).extensions;
  await app.act({type: 'tab.new', url: fixture}); await sleep(3500);
  const capture = async (prefix, file) => { const png = await app.main(async ({webContents}, prefix) => { const wc = webContents.getAllWebContents().find(x => !x.isDestroyed() && x.getURL().startsWith(prefix)); return wc ? (await wc.capturePage()).toPNG().toString('base64') : null; }, prefix).catch(() => null); if (png) await fs.writeFile(path.join(OUT, file), Buffer.from(png, 'base64')); return !!png; };
  const closeExtensionWindows = id => app.main(({BrowserWindow}, prefix) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents.getURL().startsWith(prefix)) w.close(); }, `chrome-extension://${id}/`).catch(() => {});
  const openFromToolbar = async (item, tag) => {
    await app.ui.locator(`browser-action-list button.action[id="${item.id}"]`).first().click({timeout: 8000});
    let page; for (let i = 0; i < 40 && !page; i++) { page = (await targets(port)).find(t => t.type === 'page' && t.url.startsWith(`chrome-extension://${item.id}${item.opens}`)); if (!page) await sleep(250); }
    if (!page) return {opened: false};
    await sleep(6000); const s = await attach(page.webSocketDebuggerUrl); sessions.push(s);
    const out = {opened: true, ...(await s.evaluate(PAGE_STATE))};
    if (item.name === '1password' && /#\/page\/welcome/.test(out.url) && tag === '') {
      // 1Password with no account opens its setup page (as in Chrome); Continue leads to the Sign in screen. Nothing is typed.
      out.continue = await s.evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].find(x => /^\\s*Continue/.test(x.textContent)); if (!b) return 'no Continue button'; b.click(); return 'clicked'; })()`);
      await sleep(4000); out.afterContinue = await s.evaluate(PAGE_STATE);
    }
    out.shot = await capture(`chrome-extension://${item.id}${item.opens}`, `${item.name}${tag}.png`);
    s.close(); await closeExtensionWindows(item.id); await sleep(800);
    return out;
  };
  for (const item of IDS) {
    const all = await targets(port);
    R.extensions[item.name] = {installed: list.find(e => e.id === item.id)?.version || null, worker: !!all.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${item.id}/`))};
    R.extensions[item.name].toolbar = await openFromToolbar(item, '');
    log(item.name, JSON.stringify(R.extensions[item.name]).slice(0, 400));
  }
  // Settings pages the manifests declare (Proton Pass: settings.html; 1Password declares none), in a hidden window of the profile session.
  for (const item of IDS) {
    const manifest = await app.main(({session}, args) => session.fromPartition(args.partition).extensions.getExtension(args.id)?.manifest, {partition, id: item.id});
    const options = manifest?.options_ui?.page || manifest?.options_page; if (!options) continue;
    const url = `chrome-extension://${item.id}/${options.replace(/^\//, '')}`;
    await app.main(({BrowserWindow, session}, args) => { const w = new BrowserWindow({show: false, width: 900, height: 700, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); w.loadURL(args.url); }, {partition, url});
    let target; for (let i = 0; i < 40 && !target; i++) { target = (await targets(port)).find(t => t.type === 'page' && t.url.startsWith(url)); if (!target) await sleep(250); }
    if (!target) { R.extensions[item.name].settings = {opened: false}; continue; }
    await sleep(5000); const s = await attach(target.webSocketDebuggerUrl); sessions.push(s);
    R.extensions[item.name].settings = {opened: true, ...(await s.evaluate(PAGE_STATE)), shot: await capture(url, `${item.name}-settings.png`)};
    s.close(); await closeExtensionWindows(item.id);
    log(item.name, 'settings', JSON.stringify(R.extensions[item.name].settings).slice(0, 300));
  }
  // Content scripts on the sign-in fixture: reload with the network watched, focus the email field, read what the extensions added.
  const page = (await targets(port)).find(t => t.type === 'page' && t.url.startsWith(fixture));
  if (page) {
    const s = await attach(page.webSocketDebuggerUrl); sessions.push(s); const worlds = [], resources = [];
    s.on(m => { if (m.method === 'Runtime.executionContextCreated' && (m.params.context.origin || '').startsWith('chrome-extension://')) worlds.push(m.params.context.name); if (m.method === 'Network.responseReceived' && m.params.response.url.startsWith('chrome-extension://')) resources.push(m.params.response.status + ' ' + m.params.response.url.replace(/^chrome-extension:\/\/[a-p]{32}/, m.params.response.url.slice(19, 27) + '…')); });
    await s.send('Network.enable'); await s.send('Page.enable'); await s.send('Page.reload'); await sleep(4000); await s.send('Runtime.enable'); await sleep(800);
    await s.evaluate("document.getElementById('email').focus(), 1"); await sleep(2500);
    const dom = await s.evaluate(`(() => ({added: [...document.querySelectorAll('*')].filter(e => e.tagName.includes('-')).map(e => e.tagName.toLowerCase().replace(/-[0-9a-f]{4}$/, '')), emailAttributes: [...document.getElementById('email').attributes].map(a => a.name).filter(n => n.startsWith('data-'))}))()`);
    R.content = {worlds: [...new Set(worlds)], resources, ...dom, shot: await capture(fixture, 'login-fixture.png')};
    log('content', JSON.stringify(R.content).slice(0, 500));
  }
  if (IDLE > 0) {
    await sleep(IDLE);
    R.afterIdle = {idleMs: IDLE, running: await app.main(({session}, p) => Object.values(session.fromPartition(p).serviceWorkers.getAllRunning()).map(w => w.scope), partition)};
    for (const item of IDS) R.afterIdle[item.name] = await openFromToolbar(item, '-after-idle');
    log('after idle', JSON.stringify(R.afterIdle).slice(0, 600));
  }
  await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1));
  log('result', path.join(OUT, 'result.json'));
} catch (error) { log('ERROR', error.stack || error); process.exitCode = 1; }
finally { clearTimeout(cap); for (const s of sessions) s.close(); try { server?.close(); } catch {} try { await app?.close(); } catch {} await fs.rm(slot, {force: true}); }
