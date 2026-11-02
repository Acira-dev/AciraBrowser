// Re-check a few catalog extensions on the real app, with a worker-startup trace. For each slug: store install into a fresh test profile,
// worker running + its console/exceptions from the very first line (browser-level CDP auto-attach, waitForDebuggerOnStart, set up before the
// install), toolbar button → popup state + screenshot (or what opens when there is no popup), options page + screenshot, content scripts on a
// matching page (a local fixture when a match pattern covers it, else the first host the manifest names), then a restart: loaded, worker,
// popup again. Never signs in, never types into an extension, never creates an account.
//   cd <short-path checkout, e.g. a junction C:\ae\r7\x → this worktree>   (Windows MAX_PATH: unpacked packages are deep)
//   SLUGS=notion-clipper,lastpass node qa/extension-matrix/recheck.mjs     env: PROFILE, OUT, WAIT_MS (popup settle, 6000), RESTART (1), USER_SCRIPTS (1)
//   Store installs take 40–120 s each: MODE=install PROFILE=x fills a profile, then the same PROFILE without MODE reloads each extension
//   (its worker starts again under the trace) and runs the checks.
// Takes a native slot (C:\ae\slot-N.lock, flag wx), one Electron at a time, try/finally, hard cap 9.5 min.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {startApp, sleep} from '../d-harness.mjs';
import {CATALOG} from './catalog.mjs';

const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const ITEMS = (process.env.SLUGS || '').split(',').filter(Boolean).map(slug => CATALOG.find(c => c.slug === slug) || (() => { throw Error('unknown slug ' + slug); })());
if (!ITEMS.length) throw Error('SLUGS=<catalog slugs>');
const PROFILE = process.env.PROFILE || `rc-${ITEMS[0].slug}-${Date.now().toString(36)}`;
const OUT = path.resolve(process.env.OUT || `qa/artifacts/ext-matrix/recheck/${PROFILE}`); await fs.mkdir(OUT, {recursive: true});
const WAIT = +(process.env.WAIT_MS || 6000);
const byId = new Map(ITEMS.map(item => [item.id, item]));
const ownerOf = url => { const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(url || ''); return m && byId.get(m[1]); };

const devtoolsPort = async app => { const userData = await app.main(({app}) => app.getPath('userData')); for (let i = 0; i < 50; i++) { try { return +(await fs.readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch {} await sleep(100); } throw Error('no DevToolsActivePort'); };
const targets = async port => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
/** One CDP socket with flat sessions (sessionId optional). */
async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const waiting = new Map(), listeners = [];
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(Error(JSON.stringify(msg.error))) : w.resolve(msg.result); } else listeners.forEach(l => { try { l(msg); } catch {} }); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, {resolve, reject}); ws.send(JSON.stringify({id: n, method, params, ...(sessionId ? {sessionId} : {})})); setTimeout(() => { if (waiting.has(n)) { waiting.delete(n); reject(Error('cdp timeout ' + method)); } }, 15000); });
  const evaluate = async (expression, sessionId) => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  return {send, evaluate, on: fn => listeners.push(fn), close: () => { try { ws.close(); } catch {} }};
}
const PAGE_STATE = `(() => { const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  const all = [...document.querySelectorAll('body *')]; const frames = [...document.querySelectorAll('iframe')].map(f => f.src).slice(0, 4);
  return {url: location.href, title: document.title, inner: [innerWidth, innerHeight], text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300), elements: all.length, visible: all.filter(vis).length, frames}; })()`;

/** Does a manifest match pattern cover this URL? (scheme, host, path; enough for choosing a test page) */
function covers(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/.test(url);
  const m = /^(\*|https?|file|ftp|wss?):\/\/([^/]*)(\/.*)$/.exec(pattern); if (!m) return false;
  const u = new URL(url), scheme = u.protocol.slice(0, -1);
  if (m[1] === '*' ? !['http', 'https'].includes(scheme) : m[1] !== scheme) return false;
  const host = m[2].replace(/:\d+$/, '');
  if (host !== '*' && !(host.startsWith('*.') ? (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))) : u.hostname === host)) return false;
  return new RegExp('^' + m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(u.pathname + u.search);
}
function contentPage(manifest, fixture) {
  const matches = (manifest.content_scripts || []).flatMap(s => s.matches || []);
  if (!matches.length) return null;
  if (matches.some(p => covers(p, fixture))) return {url: fixture, local: true};
  const host = matches.map(p => /^(?:\*|https?):\/\/(\*\.)?([^/*]+)\//.exec(p)).find(Boolean);
  return host ? {url: `https://${host[1] ? 'www.' : ''}${host[2]}/`, local: false} : null;
}

let slot;
for (let i = 0; i < 40 && !slot; i++) { for (const n of [1, 2, 3]) { const f = `C:\\ae\\slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`ext-recheck ${ITEMS.map(i => i.slug).join(',')} ${new Date().toISOString()}\n`); await h.close(); slot = f; break; } catch {} } if (!slot) await sleep(30000); }
if (!slot) { log('no native slot free'); process.exit(3); }
let app, server, browser; const events = [], R = {checked: new Date().toISOString(), profile: PROFILE, extensions: {}};
const push = entry => { if (events.length < 20000) events.push({t: +((Date.now() - t0) / 1000).toFixed(1), ...entry}); };
const cap = setTimeout(async () => { log('CAP reached'); R.error = 'cap reached'; R.events = events; await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1)).catch(() => {}); try { await app?.close(); } catch {} await fs.rm(slot, {force: true}); process.exit(4); }, 570000);

/** Browser-level auto-attach: every extension target of ours (worker, popup, options, offscreen) is traced from its first line. */
async function traceTargets(app, phase) {
  const port = await devtoolsPort(app), version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = await connect(version.webSocketDebuggerUrl), traced = new Map();
  cdp.on(msg => {
    if (msg.method === 'Target.attachedToTarget') {
      const {sessionId, targetInfo, waitingForDebugger} = msg.params, item = ownerOf(targetInfo.url);
      const go = () => waitingForDebugger && cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
      if (!item) { cdp.send('Target.setAutoAttach', {autoAttach: false, waitForDebuggerOnStart: false, flatten: true}, sessionId).catch(() => {}); go(); return; }
      traced.set(sessionId, {slug: item.slug, type: targetInfo.type, url: targetInfo.url});
      push({phase, kind: 'attach', slug: item.slug, type: targetInfo.type, url: targetInfo.url.slice(51, 160)});
      (async () => { await cdp.send('Runtime.enable', {}, sessionId).catch(() => {}); await cdp.send('Log.enable', {}, sessionId).catch(() => {}); go(); })();
      return;
    }
    const info = msg.sessionId && traced.get(msg.sessionId); if (!info) return;
    const base = {phase, slug: info.slug, type: info.type, page: info.url.slice(51, 110)};
    if (msg.method === 'Runtime.consoleAPICalled') push({...base, kind: 'console', level: msg.params.type, text: msg.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 1200)});
    else if (msg.method === 'Runtime.exceptionThrown') { const d = msg.params.exceptionDetails; push({...base, kind: 'exception', text: (d.exception?.description || d.text || '').slice(0, 1500), url: (d.url || '').slice(51), line: d.lineNumber}); }
    else if (msg.method === 'Log.entryAdded') push({...base, kind: 'log', level: msg.params.entry.level, text: msg.params.entry.text.slice(0, 800), url: (msg.params.entry.url || '').slice(0, 160)});
    else if (msg.method === 'Target.detachedFromTarget') traced.delete(msg.sessionId);
  });
  await cdp.send('Target.setDiscoverTargets', {discover: true}).catch(() => {});
  await cdp.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true});
  return {cdp, port};
}

async function setUp(app) {
  const state = await app.state(), profileId = state.activeBrowserProfileId, partition = state.browserProfiles[0].partition;
  // The install review is a native message box: answer it as "Load extension". Extension windows never show or take focus (the QA window is hidden).
  await app.main(({app: electronApp, dialog, session}, partition) => {
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    const target = session.fromPartition(partition);
    electronApp.on('browser-window-created', (_event, window) => { if (window.webContents?.session !== target) return; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.show = () => {}; window.showInactive = () => {}; window.focus = () => {}; });
  }, partition);
  return {partition, ext: request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request})};
}
const running = (app, partition) => app.main(({session}, p) => Object.values(session.fromPartition(p).serviceWorkers.getAllRunning()).map(w => w.scope), partition).catch(() => []);
const capture = async (app, prefix, file) => { const png = await app.main(async ({webContents}, prefix) => { const wc = webContents.getAllWebContents().find(x => !x.isDestroyed() && x.getURL().startsWith(prefix)); return wc ? (await wc.capturePage()).toPNG().toString('base64') : null; }, prefix).catch(() => null); if (png) await fs.writeFile(path.join(OUT, file), Buffer.from(png, 'base64')); return png ? file : null; };
const closeExtensionWindows = (app, id) => app.main(({BrowserWindow}, prefix) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w.webContents.getURL().startsWith(prefix)) w.close(); }, `chrome-extension://${id}/`).catch(() => {});

async function openFromToolbar(app, port, cdpPort, item, manifest, tag, fixture) {
  const before = new Set((await targets(port)).map(t => t.id));
  const click = await app.ui.locator(`browser-action-list button.action[id="${item.id}"]`).first().click({timeout: 8000}).then(() => 'clicked', e => 'click failed: ' + e.message.slice(0, 120));
  const popup = (manifest.action || manifest.browser_action || {}).default_popup;
  let page; for (let i = 0; i < 32 && !page; i++) { page = (await targets(port)).find(t => t.type === 'page' && !before.has(t.id) && t.url.startsWith(`chrome-extension://${item.id}/`)); if (!page) await sleep(250); }
  if (!page) {
    await sleep(3000);
    const opened = (await targets(port)).filter(t => !before.has(t.id)).map(t => t.type + ' ' + t.url.slice(0, 120));
    return {click, popup: popup || null, opened: false, newTargets: opened, tabShot: await capture(app, fixture, `${item.slug}${tag}-tab-after-click.png`)};
  }
  await sleep(WAIT); let s;
  try {
    s = await connect(page.webSocketDebuggerUrl);
    const out = {click, popup: popup || null, opened: true, ...(await s.evaluate(PAGE_STATE).catch(e => ({error: e.message})))};
    // A popup that is a frame of a website (Todoist) renders inside that frame: read it too.
    out.siteFrames = [];
    for (const frame of (await targets(port)).filter(t => t.type === 'iframe' && !before.has(t.id)).slice(0, 3)) {
      const f = await connect(frame.webSocketDebuggerUrl).catch(() => null); if (!f) continue;
      // Runtime.enable replays the frame's stored console messages and exceptions; elementFromPoint says what covers the middle.
      const said = []; f.on(m => { if (m.method === 'Runtime.exceptionThrown') said.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300)); if (m.method === 'Runtime.consoleAPICalled' && /error|warn/.test(m.params.type)) said.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
      await f.send('Runtime.enable').catch(() => {}); await sleep(600);
      const state = await f.evaluate(PAGE_STATE).catch(e => ({url: frame.url, error: e.message}));
      state.middle = await f.evaluate(`(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e ? e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 60) + ' ' + (e.innerText || '').slice(0, 60) : null; })()`).catch(() => null);
      state.console = said.slice(0, 12); out.siteFrames.push(state); f.close();
    }
    out.shot = await capture(app, page.url.split('#')[0].split('?')[0], `${item.slug}${tag}-popup.png`);
    // POPUP_CLICK=<slug>:<button text> presses one popup control (never a sign-in or account control) and photographs the page afterwards.
    const [clickSlug, clickText] = (process.env.POPUP_CLICK || '').split(':');
    if (clickSlug === item.slug && clickText && !tag) {
      out.pressed = await s.evaluate(`(() => { const want = ${JSON.stringify(clickText.toLowerCase())}; const el = [...document.querySelectorAll('button, a, [role=button], li, div, span')].filter(e => (e.innerText || '').trim().toLowerCase().startsWith(want)).sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0]; if (!el) return 'not found'; el.click(); return 'clicked ' + el.tagName; })()`).catch(e => 'error ' + e.message);
      await sleep(3500); out.afterPress = await capture(app, fixture, `${item.slug}-after-press.png`);
    }
    return out;
  } catch (error) { return {click, popup: popup || null, opened: true, url: page.url, error: String(error.message || error.type || error).slice(0, 200)}; }
  finally { s?.close(); await closeExtensionWindows(app, item.id); await sleep(600); }
}
/** One check of one extension; a failure is recorded on the row and the run goes on. */
const guard = async fn => { try { return await fn(); } catch (error) { return {error: String(error?.message || error?.type || error).slice(0, 300)}; } };

try {
  const USERSCRIPT = `// ==UserScript==\n// @name        Acira QA marker\n// @namespace   https://acira.invalid/qa\n// @version     1.0\n// @match       http://localhost/*\n// @include     http://localhost:*/*\n// @grant       none\n// ==/UserScript==\ndocument.documentElement.dataset.aciraUserscript = 'ran';\n`;
  server = http.createServer((req, res) => { if (req.url.endsWith('.user.js')) { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.end(USERSCRIPT); return; } res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>Acira extension fixture</title><body style="font:15px system-ui;padding:40px;max-width:720px"><h1>Fixture page</h1><p>Some article text for page scripts to read. The quick brown fox jumps over the lazy dog.</p><p><a href="/next">A link</a> <img alt="tile" width="60" height="40" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='40'%3E%3Crect width='60' height='40' fill='%2336c'/%3E%3C/svg%3E"></p><form method="post" action="/done"><p><label>Email <input type="email" id="email" name="email" autocomplete="username" style="width:280px;padding:8px"></label></p><p><label>Password <input type="password" id="password" name="password" autocomplete="current-password" style="width:280px;padding:8px"></label></p><p><textarea id="notes" rows="4" cols="50">Their is a mistake in this sentense.</textarea></p></form>`); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const fixture = `http://localhost:${server.address().port}/`;
  // PROFILES (default ext-recheck) under .qa-profiles. Chromium resolves junctions when it loads an extension, so a junction to a long checkout
  // does not shorten the path: deep packages (Acrobat) fail MAX_PATH on load. Run from a real short directory whose desktop/qa/node_modules/dist
  // are junctions and whose .qa-profiles is real (prepared-native refuses a redirected profile).
  const root = path.resolve('.qa-profiles', process.env.PROFILES || 'ext-recheck', PROFILE);
  // ---- Phase 1: fresh profile, install with the trace already attached.
  app = await startApp({root, env: {ACIRA_DEV: '0'}});
  let {cdp, port} = await traceTargets(app, 'install'); browser = cdp;
  let {partition, ext} = await setUp(app);
  const manifests = {}, already = (await ext({type: 'list'})).extensions;
  for (const item of ITEMS) {
    const started = Date.now();
    // Store installs are slow (40–120 s each): MODE=install fills the profile in one slot hold; a later run reloads each one so its worker
    // starts again under the trace.
    const result = already.some(e => e.id === item.id) ? await ext({type: 'reload', extensionId: item.id}).catch(e => ({error: String(e.message || e)})).then(async r => r.error ? r : ext({type: 'list'}))
      : await ext({type: 'install', extensionId: item.id}).catch(e => ({error: String(e.message || e)}));
    const entry = (result.extensions || []).find(e => e.id === item.id);
    const row = R.extensions[item.slug] = {id: item.id, install: {ms: Date.now() - started, error: result.error || (entry ? undefined : 'not listed'), name: entry?.name, version: entry?.version}};
    if (!entry) { log(item.slug, 'install failed', row.install.error); continue; }
    manifests[item.slug] = await app.main(({session}, a) => session.fromPartition(a.partition).extensions.getExtension(a.id)?.manifest, {partition, id: item.id});
    await ext({type: 'pin', extensionId: item.id, pinned: true}).catch(() => {});
    if (process.env.USER_SCRIPTS !== '0' && entry.wantsUserScripts) row.userScripts = await ext({type: 'userScripts', extensionId: item.id, allowed: true}).then(() => 'allowed', e => 'error ' + e.message);
    log(item.slug, already.some(e => e.id === item.id) ? 'reloaded' : 'installed', entry.version, (Date.now() - started) + 'ms');
  }
  if (process.env.MODE === 'install') { await fs.writeFile(path.join(OUT, 'install.json'), JSON.stringify({R, events}, null, 1)); throw Object.assign(Error('install-only run finished'), {done: true}); }
  await sleep(8000);
  const live = await running(app, partition);
  for (const item of ITEMS) { const row = R.extensions[item.slug]; if (!row.install.version) continue; const m = manifests[item.slug];
    row.worker = m.background?.service_worker ? (live.some(s => s.startsWith(`chrome-extension://${item.id}/`)) ? 'running' : 'not running') : (m.background ? 'event page / background page' : 'none'); }
  await app.act({type: 'tab.new', url: fixture}); await sleep(3000);
  for (const item of ITEMS) { const m = manifests[item.slug]; if (!m) continue;
    R.extensions[item.slug].toolbar = (m.action || m.browser_action) ? await guard(() => openFromToolbar(app, port, port, item, m, '', fixture)) : 'no toolbar button';
    // HOVER=<slug>: after its popup, a synthetic pointer (CDP, never the real mouse) moves over the fixture's blue tile and clicks it, and
    // the page is photographed (ColorZilla's eyedropper shows the colour under the pointer, then picks it).
    if (process.env.HOVER === item.slug) R.extensions[item.slug].hover = await guard(async () => {
      const page = (await targets(port)).find(t => t.type === 'page' && t.url.startsWith(fixture)); const s = await connect(page.webSocketDebuggerUrl);
      try {
        for (const [x, y] of [[100, 170], [110, 178], [119, 183]]) { await s.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y}); await sleep(250); }
        await sleep(1200); const moved = await capture(app, fixture, `${item.slug}-hover.png`);
        await s.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: 119, y: 183, button: 'left', clickCount: 1}); await s.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: 119, y: 183, button: 'left', clickCount: 1});
        await sleep(1500); return {moved, picked: await capture(app, fixture, `${item.slug}-picked.png`)};
      } finally { s.close(); }
    });
    log(item.slug, 'toolbar', String(JSON.stringify(R.extensions[item.slug]?.toolbar)).slice(0, 300)); }
  for (const item of ITEMS) { const m = manifests[item.slug]; if (!m) continue;
    const options = m.options_ui?.page || m.options_page; if (!options) { R.extensions[item.slug].options = 'none declared'; continue; }
    const url = `chrome-extension://${item.id}/${options.replace(/^\//, '')}`;
    await app.main(({BrowserWindow, session}, a) => { const w = new BrowserWindow({show: false, width: 1000, height: 760, webPreferences: {session: session.fromPartition(a.partition), sandbox: true, contextIsolation: true}}); w.loadURL(a.url); }, {partition, url});
    let target; for (let i = 0; i < 40 && !target; i++) { target = (await targets(port)).find(t => t.type === 'page' && t.url.startsWith(url.split('#')[0].split('?')[0])); if (!target) await sleep(250); }
    if (!target) { R.extensions[item.slug].options = {opened: false}; continue; }
    await sleep(5000);
    R.extensions[item.slug].options = await guard(async () => { const s = await connect(target.webSocketDebuggerUrl); try { return {opened: true, ...(await s.evaluate(PAGE_STATE).catch(e => ({error: e.message}))), shot: await capture(app, url.split('#')[0].split('?')[0], `${item.slug}-options.png`)}; } finally { s.close(); } });
    await closeExtensionWindows(app, item.id);
    log(item.slug, 'options', String(JSON.stringify(R.extensions[item.slug]?.options)).slice(0, 240)); }
  // Content scripts: the local fixture when a pattern covers it, else the first named host. Worlds and extension resources are read over CDP.
  const pages = new Map();
  for (const item of ITEMS) { const m = manifests[item.slug]; if (!m) continue; const p = contentPage(m, fixture); R.extensions[item.slug].content = p ? {page: p.url, local: p.local} : 'no content scripts'; if (p) pages.set(p.url, [...(pages.get(p.url) || []), item]); }
  for (const [url, items] of pages) {
    if (url !== fixture) { await app.act({type: 'tab.new', url}); await sleep(6000); }
    // A named host may redirect (mail.google.com → workspace.google.com): match on the site (last two labels of the host).
    const site = h => h.split('.').slice(-2).join('.'), want = site(new URL(url).hostname);
    const page = (await targets(port)).reverse().find(t => t.type === 'page' && (t.url.startsWith(url.replace(/\/$/, '')) || (() => { try { return !url.startsWith(fixture) && site(new URL(t.url).hostname) === want; } catch { return false; } })()));
    if (!page) { for (const item of items) R.extensions[item.slug].content.error = 'page target not found'; continue; }
    const s = await connect(page.webSocketDebuggerUrl).catch(() => null), worlds = [], resources = [];
    if (!s) { for (const item of items) R.extensions[item.slug].content.error = 'could not attach to the page'; continue; }
    s.on(m => { if (m.method === 'Runtime.executionContextCreated') { const o = m.params.context.origin || ''; if (o.startsWith('chrome-extension://')) worlds.push(o.slice(19, 51)); } if (m.method === 'Network.responseReceived' && m.params.response.url.startsWith('chrome-extension://')) resources.push(m.params.response.url.slice(19, 51)); });
    await s.send('Network.enable'); await s.send('Runtime.enable'); await s.send('Page.enable'); await s.send('Page.reload'); await sleep(url === fixture ? 5000 : 8000);
    if (url === fixture) { await s.evaluate("document.getElementById('notes').focus(), 1").catch(() => {}); await sleep(2000); }
    const added = await s.evaluate(`[...document.querySelectorAll('*')].filter(e => e.tagName.includes('-') || e.shadowRoot).map(e => e.tagName.toLowerCase()).slice(0, 12)`).catch(() => []);
    const shot = await capture(app, page.url.split('#')[0],`content-${new URL(url).hostname}.png`);
    for (const item of items) Object.assign(R.extensions[item.slug].content, {worlds: worlds.filter(w => w === item.id).length, resources: resources.filter(r => r === item.id).length, addedElements: added, shot});
    s.close();
  }
  // USERSCRIPT=<slug>: a userscript manager installs a local marker script the way a person does (open the .user.js address, press the
  // manager's own Install button), then a fresh fixture tab shows whether the script ran. Nothing is typed.
  if (process.env.USERSCRIPT && manifests[process.env.USERSCRIPT]) {
    const item = ITEMS.find(i => i.slug === process.env.USERSCRIPT);
    R.extensions[item.slug].userscript = await guard(async () => {
      const before = new Set((await targets(port)).map(t => t.id));
      await app.act({type: 'tab.new', url: fixture + 'acira-qa.user.js'});
      let page; for (let i = 0; i < 40 && !page; i++) { page = (await targets(port)).find(t => t.type === 'page' && !before.has(t.id) && t.url.startsWith(`chrome-extension://${item.id}/`)); if (!page) await sleep(250); }
      if (!page) return {installPage: false, opened: (await targets(port)).filter(t => !before.has(t.id)).map(t => t.type + ' ' + t.url.slice(0, 100))};
      await sleep(4000); const s = await connect(page.webSocketDebuggerUrl);
      try {
        const shown = await s.evaluate(PAGE_STATE).catch(e => ({error: e.message}));
        const shot = await capture(app, page.url.split('#')[0].split('?')[0], `${item.slug}-userscript-install.png`);
        const pressed = await s.evaluate(`(() => { const all = [...document.querySelectorAll('button, input[type=button], input[type=submit], a, [role=button]')]; const el = all.find(e => /^\\s*(install|confirm installation)\\b/i.test(e.innerText || e.value || '')); if (!el) return 'no install button'; el.click(); return 'clicked ' + (el.innerText || el.value).trim().slice(0, 30); })()`).catch(e => 'error ' + e.message);
        await sleep(3000);
        await app.act({type: 'tab.new', url: fixture + '?userscript=1'}); await sleep(4000);
        const check = (await targets(port)).find(t => t.type === 'page' && t.url.includes('?userscript=1'));
        const c = check && await connect(check.webSocketDebuggerUrl);
        const ran = c ? await c.evaluate(`document.documentElement.dataset.aciraUserscript || 'not ran'`).catch(e => 'error ' + e.message) : 'no page'; c?.close();
        return {installPage: true, url: page.url, text: shown.text, shot, pressed, ran};
      } finally { s.close(); }
    });
    log(item.slug, 'userscript', JSON.stringify(R.extensions[item.slug].userscript).slice(0, 300));
  }
  for (const item of ITEMS) if (manifests[item.slug]) log(item.slug, 'content',String(JSON.stringify(R.extensions[item.slug]?.content)).slice(0, 240));
  R.events = events.slice(); browser.close(); await app.close(); app = null;
  // ---- Phase 2: restart on the same profile. The trace attaches as early as the harness allows (extensions start with the app).
  if (process.env.RESTART !== '0') {
    app = await startApp({root, env: {ACIRA_DEV: '0'}});
    ({cdp, port} = await traceTargets(app, 'restart')); browser = cdp; ({partition, ext} = await setUp(app));
    await sleep(6000);
    const list = (await ext({type: 'list'})).extensions, live2 = await running(app, partition);
    await app.act({type: 'tab.new', url: fixture}); await sleep(3000);
    for (const item of ITEMS) { const m = manifests[item.slug]; if (!m) continue; const entry = list.find(e => e.id === item.id);
      const row = R.extensions[item.slug].restart = {loaded: !!entry && entry.enabled !== false, pinned: !!entry?.pinned, worker: m.background?.service_worker ? (live2.some(s => s.startsWith(`chrome-extension://${item.id}/`)) ? 'running' : 'not running') : 'n/a'};
      if (m.action || m.browser_action) row.toolbar = await guard(() => openFromToolbar(app, port, port, item, m, '-restart', fixture));
      log(item.slug, 'restart', JSON.stringify(row).slice(0, 300)); }
  }
  R.events = events;
  await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1));
  log('result', path.join(OUT, 'result.json'));
} catch (error) { if (error.done) { log(error.message); } else {
  log('ERROR', error.stack || error); R.error = String(error.stack || error); R.events = events; await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1)).catch(() => {}); process.exitCode = 1; } }
finally { clearTimeout(cap); try { browser?.close(); } catch {} try { server?.close(); } catch {} try { await app?.close(); } catch {} await fs.rm(slot, {force: true}); }
