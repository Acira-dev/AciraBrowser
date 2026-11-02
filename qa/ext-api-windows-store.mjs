// A real Chrome Web Store extension doing a window job on the real app (package P2): install it into an isolated test profile, open its toolbar
// popup, optionally press one control, and report the windows its own service worker sees afterwards plus the native windows.
//   cd C:\ae\p2w
//   EXT_ID=<store id> PROFILE=p2-bitwarden ACTION=dump  node qa/ext-api-windows-store.mjs      list the popup's controls (no click)
//   EXT_ID=... PROFILE=... CLICK="pop out" node qa/ext-api-windows-store.mjs                     press the first control whose text / title / aria-label matches
//   EXPECT_URL=<substring> EXPECT_TYPE=popup                                                     assert a window whose tab url contains it (and its type)
// Never signs in, never types into an extension, never creates an account; windows stay hidden; one Electron, try/finally, 9 min cap.
import fs from 'node:fs/promises';
import {rmSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {startApp, sleep, poll} from './d-harness.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const ID = process.env.EXT_ID; if (!ID) throw Error('EXT_ID=<store id>');
const PROFILE = process.env.PROFILE || 'p2-' + ID.slice(0, 6);
const OUT = path.resolve(process.env.OUT || path.join('qa/artifacts/ext-api-windows-store', `${PROFILE}-${Date.now()}`));
await fs.mkdir(OUT, {recursive: true});
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const report = {id: ID, profile: PROFILE, steps: []};

const devtoolsPort = async app => { const userData = await app.main(({app: a}) => a.getPath('userData')); for (let i = 0; i < 80; i++) { try { return +(await fs.readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch { /* not yet */ } await sleep(100); } throw Error('no DevToolsActivePort'); };
const targets = async port => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const waiting = new Map();
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(Error(JSON.stringify(msg.error))) : w.resolve(msg.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, {resolve, reject}); ws.send(JSON.stringify({id: n, method, params})); setTimeout(() => { if (waiting.has(n)) { waiting.delete(n); reject(Error('cdp timeout ' + method)); } }, 20000); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  /** A press with the mouse events a person makes (sent to the page over the debugging protocol: the real cursor never moves). */
  const press = async selector => {
    const at = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; })()`);
    if (!at) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, x: at.x, y: at.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1});
    return at;
  };
  return {evaluate, press, close: () => { try { ws.close(); } catch { /* closed */ } }};
}

const fixtureServer = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset=utf-8><title>window fixture</title><h1>window fixture</h1>'); });
await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/`;
let slot, app;
let deadline;   // started once a slot is ours: waiting for one is not part of the run
try {
  slot = await takeSlot('p2-windows-store');
  deadline = setTimeout(() => { console.error('hard cap'); try { rmSync(slot, {force: true}); } catch { /* released */ } process.exit(2); }, 9 * 60 * 1000);
  log('slot', slot);
  app = await startApp({root: path.resolve('.qa-profiles', 'store', PROFILE), env: {ACIRA_DEV: '0'}});
  const state = await app.state(), profileId = state.activeBrowserProfileId, partition = state.browserProfiles[0].partition;
  // The install review is a native message box: answer "Load extension". Windows of the profile never show or take focus.
  await app.main(({app: electronApp, dialog, session}, partition) => {
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    const target = session.fromPartition(partition);
    electronApp.on('browser-window-created', (_event, window) => { if (window.webContents?.session !== target) return; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.show = () => {}; window.showInactive = () => {}; window.focus = () => {}; });
  }, partition);
  const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
  const listed = (await ext({type: 'list'})).extensions || [];
  let entry = listed.find(e => e.id === ID);
  if (!entry) {
    const started = Date.now();
    const result = await ext({type: 'install', extensionId: ID}).catch(e => ({error: String(e.message || e)}));
    entry = (result.extensions || []).find(e => e.id === ID);
    report.install = {ms: Date.now() - started, error: result.error || (entry ? undefined : 'not listed'), name: entry?.name, version: entry?.version};
    log('install', JSON.stringify(report.install));
    if (!entry) throw Error('install failed: ' + report.install.error);
  } else report.install = {already: true, name: entry.name, version: entry.version};
  await ext({type: 'pin', extensionId: ID, pinned: true}).catch(() => {});
  report.name = entry.name;
  await app.act({type: 'tab.new', url: fixtureUrl}).catch(() => {});
  await sleep(2500);
  const port = await devtoolsPort(app);
  const sw = await poll(async () => (await targets(port)).find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${ID}/`)), Boolean, 'extension service worker', 90000).catch(() => null);
  report.serviceWorker = !!sw;
  const before = new Set((await targets(port)).map(t => t.id));
  log('open the popup from the toolbar');
  report.click = await app.ui.locator(`browser-action-list button.action[id="${ID}"]`).first().click({timeout: 10000}).then(() => 'clicked', e => 'click failed: ' + e.message.slice(0, 120));
  const popup = await poll(async () => (await targets(port)).find(t => t.type === 'page' && !before.has(t.id) && t.url.startsWith(`chrome-extension://${ID}/`)), Boolean, 'popup page', 30000).catch(() => null);
  report.popup = popup ? popup.url : null;
  if (popup) {
    const page = await connect(popup.webSocketDebuggerUrl);
    await sleep(+(process.env.WAIT_MS || 5000));
    const controls = `(() => [...document.querySelectorAll('button, a, [role=button], [role=menuitem], input[type=button]')].map((e, i) => ({i, tag: e.tagName, text: (e.innerText || '').trim().slice(0, 40), title: e.title || '', aria: e.getAttribute('aria-label') || '', cls: String(e.className).slice(0, 50)})).slice(0, 80))()`;
    report.popupState = await page.evaluate(`({url: location.href, title: document.title, size: [innerWidth, innerHeight], text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300)})`);
    report.controls = await page.evaluate(controls);
    log('popup', JSON.stringify(report.popupState));
    if (process.env.ACTION === 'dump') log('controls', JSON.stringify(report.controls));
    if (process.env.EVAL_POPUP) { report.eval = await page.evaluate(process.env.EVAL_POPUP).catch(e => 'error ' + e.message); log('eval', JSON.stringify(report.eval).slice(0, 1500)); }
    if (process.env.INSPECT) log('inspect', await page.evaluate(`(() => { const w = ${JSON.stringify(process.env.INSPECT.toLowerCase())}; const hit = [...document.querySelectorAll('body *')].filter(e => (e.innerText || '').trim().toLowerCase() === w).sort((a, b) => a.outerHTML.length - b.outerHTML.length)[0]; if (!hit) return 'none'; let n = hit; for (let i = 0; i < 2 && n.parentElement; i++) n = n.parentElement; return n.outerHTML.slice(0, 900); })()`));
    const want = process.env.CLICK;
    if (want) {
      // CLICK="first|second": each is pressed in turn (the smallest element whose text, title or aria-label contains it).
      report.pressed = [];
      await page.evaluate(`(() => { window.__errs = []; const on = (type, fn) => EventTarget.prototype.addEventListener.call(window, type, fn); on('error', e => window.__errs.push('error: ' + e.message)); on('unhandledrejection', e => window.__errs.push('rejection: ' + String(e.reason && e.reason.message || e.reason))); const ce = console.error; console.error = (...a) => { window.__errs.push('console.error: ' + a.map(String).join(' ').slice(0, 300)); ce.apply(console, a); }; })()`);
      // The popup's chrome.windows / chrome.tabs calls and what came back (callback or promise form), so a failure shows which member said what.
      await page.evaluate(`(() => { window.__calls = []; for (const [ns, names] of [['windows', ['create', 'update', 'get', 'getAll', 'getCurrent', 'getLastFocused', 'remove']], ['tabs', ['create', 'update', 'move', 'query']]]) for (const name of names) { const original = chrome[ns] && chrome[ns][name]; if (typeof original !== 'function') continue; chrome[ns][name] = function (...args) { const entry = {call: ns + '.' + name, args: JSON.stringify(args.filter(a => typeof a !== 'function')).slice(0, 200)}; window.__calls.push(entry); const last = args[args.length - 1]; if (typeof last === 'function') { args[args.length - 1] = (...r) => { entry.result = JSON.stringify(r).slice(0, 160); entry.lastError = chrome.runtime.lastError && chrome.runtime.lastError.message; return last(...r); }; return original.apply(this, args); } const p = original.apply(this, args); if (p && p.then) p.then(v => { entry.result = JSON.stringify(v).slice(0, 160); }, e => { entry.error = String(e && e.message || e); }); return p; }; } })()`);
      for (const one of want.split('|')) {
        // "css:<selector>" presses the first element that matches the selector
        const pressed = one.trim().startsWith('css:') ? await page.press(one.trim().slice(4)).then(at => (at ? 'pressed at ' + JSON.stringify(at) : false)) : await page.evaluate(`(() => { const w = ${JSON.stringify(one.trim().toLowerCase())}; const label = e => ((e.innerText || '') + ' ' + (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '')).trim().toLowerCase(); const hits = [...document.querySelectorAll('button, a, [role=button], [role=menuitem], input[type=button], li, div, span, svg, td')].filter(e => label(e).includes(w)).sort((a, b) => label(a).length - label(b).length); const el = hits[0]; if (!el) return false; (el.closest('button, a, [role=button], [role=menuitem]') || el).setAttribute('data-qa-press', '1'); return label(el).slice(0, 40); })()`).then(async label => { if (label) { await page.press('[data-qa-press="1"]'); await page.evaluate('document.querySelectorAll("[data-qa-press]").forEach(e => e.removeAttribute("data-qa-press"))'); } return label; });
        report.pressed.push(pressed); log('pressed', one, '->', pressed);
        await sleep(900);
      }
      await sleep(+(process.env.AFTER_MS || 4000));
      report.popupErrors = await page.evaluate('window.__errs || []').catch(() => null);
      report.popupCalls = await page.evaluate('window.__calls || []').catch(() => null);
      log('popup calls', JSON.stringify(report.popupCalls));
      report.popupAfter = await page.evaluate(`({url: location.href, text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 300)})`).catch(() => null);
      log('popup errors', JSON.stringify(report.popupErrors), 'after', JSON.stringify(report.popupAfter));
    }
    page.close();
  }
  // What the extension itself sees afterwards, and the native windows.
  if (sw) {
    const worker = await connect((await targets(port)).find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${ID}/`)).webSocketDebuggerUrl);
    report.windows = await worker.evaluate('chrome.windows.getAll({populate: true}).then(list => list.map(w => ({id: w.id, type: w.type, state: w.state, focused: w.focused, left: w.left, top: w.top, width: w.width, height: w.height, tabs: (w.tabs || []).map(t => (t.url || "").slice(0, 120))})))').catch(e => 'error ' + e.message);
    log('windows (as the extension sees them)', JSON.stringify(report.windows));
    report.current = await worker.evaluate('chrome.windows.getCurrent().then(w => w.id)').catch(e => 'error ' + e.message);
    if (process.env.EXPECT_URL) {
      const found = Array.isArray(report.windows) && report.windows.find(w => w.tabs.some(u => u.includes(process.env.EXPECT_URL)));
      report.expect = {url: process.env.EXPECT_URL, found: !!found, type: found?.type, wantType: process.env.EXPECT_TYPE || null, ok: !!found && (!process.env.EXPECT_TYPE || found.type === process.env.EXPECT_TYPE)};
      log('expect', JSON.stringify(report.expect));
      if (found) {
        report.native = await app.main(({BaseWindow}, wid) => { const w = BaseWindow.getAllWindows().find(x => x.id === wid); return w ? {bounds: w.getBounds(), url: w.webContents?.getURL(), title: w.getTitle()} : null; }, found.id);
        const png = await app.main(async ({BrowserWindow}, wid) => { const w = BrowserWindow.getAllWindows().find(x => x.id === wid); return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null; }, found.id).catch(() => null);
        if (png) { await fs.writeFile(path.join(OUT, 'window.png'), Buffer.from(png, 'base64')); report.shot = path.join(OUT, 'window.png'); }
        await worker.evaluate(`chrome.windows.remove(${found.id}).then(() => "removed", e => e.message)`).then(m => { report.removed = m; }, () => {});
      }
    }
    worker.close();
  }
  report.nativeWindows = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => ({id: w.id, bounds: w.getBounds(), url: w.webContents?.getURL() || null})));
  report.mainAlive = await app.main(() => true).then(() => true, () => false);
} catch (error) {
  report.error = String(error?.stack || error).slice(0, 1500);
  console.error(report.error);
} finally {
  clearTimeout(deadline);
  try { await app?.close(); } catch { /* gone */ }
  fixtureServer.close();
  if (slot) await releaseSlot(slot);
}
await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log('wrote', path.join(OUT, 'report.json'));
process.exitCode = report.error || (report.expect && !report.expect.ok) ? 1 : 0;
