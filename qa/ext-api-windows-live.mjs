// chrome.windows on the real app (package P2): a small MV3 test extension is loaded into an isolated test profile and its service worker and
// a page of it (opened by windows.create as a popup window) are driven over CDP. Checks: the caller's own window, populate, popup windows
// with bounds / focused:false, update (bounds, state), normal windows with web addresses, remove, the events (created / removed /
// focus with WINDOW_ID_NONE / windowTypes filter), and that a private window is invisible to the extension.
// Never signs in, never types anywhere, windows stay hidden (ACIRA_BROWSER_TEST_HIDDEN), no focus is taken, one Electron, try/finally, 6 min cap.
//   cd C:\ae\p2w   (a short real directory whose desktop / qa / dist / node_modules / … are junctions)
//   node qa/native-slot.mjs p2-windows-live -- node qa/ext-api-windows-live.mjs
import fs from 'node:fs/promises';
import {rmSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {startApp, sleep, poll} from './d-harness.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.env.OUT || path.join('qa/artifacts/ext-api-windows-live', stamp, 'results.json'));
const results = {started: stamp, checks: [], notes: []};
const check = (name, ok, detail) => { results.checks.push({name, ok: !!ok, detail}); console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail)); };
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset=utf-8><title>fixture ${req.url}</title><h1>fixture ${req.url}</h1>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const extDir = path.resolve('wx' + Date.now().toString(36));
await fs.mkdir(extDir, {recursive: true});
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Acira windows probe', version: '1.0', permissions: ['tabs'], background: {service_worker: 'sw.js'}, action: {default_title: 'windows'}}));
await fs.writeFile(path.join(extDir, 'sw.js'), `
self.__ev = []; self.__popupOnly = []; self.__normalOnly = [];
const brief = x => (x && typeof x === 'object' ? {id: x.id, type: x.type, left: x.left, width: x.width, state: x.state, tabs: x.tabs && x.tabs.length} : x);
for (const name of ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']) chrome.windows[name].addListener((...a) => self.__ev.push([name, ...a.map(brief)]));
chrome.windows.onCreated.addListener(w => self.__popupOnly.push(w.id), {windowTypes: ['popup']});
chrome.windows.onCreated.addListener(w => self.__normalOnly.push(w.id), {windowTypes: ['normal']});
`);
await fs.writeFile(path.join(extDir, 'page.html'), '<!doctype html><meta charset=utf-8><title>popup page</title><p>popup page</p><script src="page.js"></script>');
await fs.writeFile(path.join(extDir, 'page.js'), `chrome.windows.getCurrent({populate: true}).then(w => { self.__current = w; document.title = 'current ' + w.id; }); chrome.windows.getLastFocused().then(w => { self.__lastFocused = w; });`);

const devtoolsPort = async app => { const userData = await app.main(({app: a}) => a.getPath('userData')); for (let i = 0; i < 80; i++) { try { return +(await fs.readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch { /* not yet */ } await sleep(100); } throw Error('no DevToolsActivePort'); };
const targets = async port => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const waiting = new Map();
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(Error(JSON.stringify(msg.error))) : w.resolve(msg.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiting.set(n, {resolve, reject}); ws.send(JSON.stringify({id: n, method, params})); setTimeout(() => { if (waiting.has(n)) { waiting.delete(n); reject(Error('cdp timeout ' + method)); } }, 20000); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  return {evaluate, close: () => { try { ws.close(); } catch { /* closed */ } }};
}

let app, sw, popupPage, port, id, slot;
let deadline;   // started once a slot is ours: waiting for one is not part of the run
const inSw = expression => sw.evaluate(expression);
const windowsOfMain = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => ({id: w.id, visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), maximized: w.isMaximized(), bounds: w.getBounds(), url: w.webContents ? w.webContents.getURL() : null, title: w.getTitle()})));
const events = () => inSw('self.__ev');
// A native state change (maximize) shows a hidden window: these test windows stay invisible, unfocusable and click-through.
const quiet = ids => app.main(({BrowserWindow}, wanted) => { for (const w of BrowserWindow.getAllWindows()) if (wanted.includes(w.id) && !w.isDestroyed()) { w.setFocusable(false); w.setIgnoreMouseEvents(true); w.setOpacity(0); } }, ids);

try {
  slot = await takeSlot('p2-windows-live');
  deadline = setTimeout(() => { console.error('hard cap reached'); try { rmSync(slot, {force: true}); } catch { /* released */ } process.exit(2); }, 6 * 60 * 1000);
  app = await startApp({root: path.resolve('.qa-profiles', 'pw' + Date.now().toString(36)), env: {ACIRA_DEV: '0'}});
  await app.main(({dialog}, folder) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
  }, extDir);
  const state = await app.state(), profileId = state.activeBrowserProfileId;
  const loaded = await app.ui.evaluate(request => window.acira.extensions(request), {profileId, type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === 'Acira windows probe');
  if (!entry) throw Error('extension did not load: ' + JSON.stringify(loaded).slice(0, 300));
  id = entry.id;
  await app.act({type: 'tab.new', url: base + '/first'});
  port = await devtoolsPort(app);
  const swTarget = await poll(async () => (await targets(port)).find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`)), Boolean, 'service worker target', 60000);
  sw = await connect(swTarget.webSocketDebuggerUrl);
  await poll(() => inSw('typeof chrome.windows.getAll'), v => v === 'function', 'chrome.windows in the worker', 20000);

  // ---- A. the window the extension sees
  const main = (await windowsOfMain()).filter(w => w.url !== undefined);
  const first = await inSw('chrome.windows.getAll({populate: true})');
  check('getAll lists exactly the one ordinary window', first.length === 1 && first[0].type === 'normal' && first[0].incognito === false, first);
  const mainId = first[0]?.id;
  check('the window id is the native window id', main.some(w => w.id === mainId), {mainId, windows: main.map(w => w.id)});
  // (the tab's address reaches the engine's tab record a moment after the page loads: wait for it)
  const populated = await poll(async () => { const list = await inSw('chrome.windows.getAll({populate: true})'); return (list[0]?.tabs || []).some(t => String(t.url).startsWith(base + '/first')) ? list : null; }, Boolean, 'populated tab', 20000).catch(() => null);
  check('populate lists the web tab', !!populated, first[0]?.tabs);
  const cur = await inSw('chrome.windows.getCurrent()');
  check('getCurrent from the worker is that window', cur.id === mainId, cur);
  check('get(WINDOW_ID_CURRENT) too', (await inSw('chrome.windows.get(chrome.windows.WINDOW_ID_CURRENT)')).id === mainId);
  check('getLastFocused answers a window', (await inSw('chrome.windows.getLastFocused()')).id === mainId);
  check('unknown id -> Chromium\'s message', (await inSw('chrome.windows.get(987654).then(() => "resolved", e => e.message)')) === 'No window with id: 987654.');
  check('constants', (await inSw('[chrome.windows.WINDOW_ID_NONE, chrome.windows.WINDOW_ID_CURRENT]')).join() === '-1,-2');

  // ---- B. a private window is invisible to the extension
  await app.ui.evaluate(() => window.acira.openWindow('private'));
  const privateWindow = await poll(async () => (await windowsOfMain()).find(w => w.id !== mainId), Boolean, 'private window', 20000);
  const afterPrivate = await inSw('chrome.windows.getAll({populate: true})');
  check('a private window is not listed', afterPrivate.length === 1 && afterPrivate[0].id === mainId, afterPrivate.map(w => w.id));
  check('and not reachable by id', (await inSw(`chrome.windows.get(${privateWindow.id}).then(() => "resolved", e => e.message)`)) === `No window with id: ${privateWindow.id}.`);
  check('nor updatable / removable', (await inSw(`Promise.all([chrome.windows.update(${privateWindow.id}, {state: 'maximized'}).then(() => 'ok', e => e.message), chrome.windows.remove(${privateWindow.id}).then(() => 'ok', e => e.message)])`)).every(m => m === `No window with id: ${privateWindow.id}.`));
  check('the private window is still there', (await windowsOfMain()).some(w => w.id === privateWindow.id));
  await app.main(({BaseWindow}, wid) => { BaseWindow.getAllWindows().find(w => w.id === wid)?.close(); }, privateWindow.id);
  await sleep(800);

  // ---- C. a popup window made of an extension page: bounds, focused:false, tabs, events
  await inSw('self.__ev.length = 0; 0');
  const popup = await inSw(`chrome.windows.create({url: 'page.html', type: 'popup', left: 120, top: 90, width: 420, height: 520, focused: false})`);
  check('create popup: a popup window with one tab', popup.type === 'popup' && popup.tabs?.length === 1 && popup.tabs[0].url === `chrome-extension://${id}/page.html`, popup);
  check('create popup: asked bounds', near(popup.left, 120) && near(popup.top, 90) && near(popup.width, 420, 20) && near(popup.height, 520, 20), popup);
  check('create popup: not focused', popup.focused === false, popup);
  await quiet([popup.id]);
  const mainPopup = await app.main(({BrowserWindow}, wid) => { const w = BrowserWindow.getAllWindows().find(x => x.id === wid); return w ? {bounds: w.getBounds(), focused: w.isFocused(), url: w.webContents.getURL(), menu: w.isMenuBarVisible()} : null; }, popup.id);
  check('the native window matches', mainPopup && near(mainPopup.bounds.x, popup.left) && mainPopup.url === `chrome-extension://${id}/page.html` && mainPopup.focused === false, mainPopup);
  check('getAll lists it as a popup, filters work', (await inSw(`chrome.windows.getAll({windowTypes: ['popup']})`)).map(w => w.id).join() === String(popup.id) && (await inSw(`chrome.windows.getAll({windowTypes: ['normal']})`)).map(w => w.id).join() === String(mainId));
  check('tabs.query sees the popup\'s tab', (await inSw(`chrome.tabs.query({windowId: ${popup.id}})`)).length === 1);
  const created = (await events()).filter(e => e[0] === 'onCreated');
  check('onCreated fired once, with the popup type', created.length === 1 && created[0][1].id === popup.id && created[0][1].type === 'popup', created);
  check('windowTypes filters on onCreated', (await inSw('self.__popupOnly')).join() === String(popup.id) && (await inSw('self.__normalOnly')).length === 0);
  // the page in the popup asks for ITS window (not the last focused one)
  popupPage = (await poll(async () => (await targets(port)).find(t => t.type === 'page' && t.url === `chrome-extension://${id}/page.html`), Boolean, 'popup page target', 30000));
  const page = await connect(popupPage.webSocketDebuggerUrl);
  const own = await poll(() => page.evaluate('self.__current || null'), Boolean, 'getCurrent in the popup page', 15000);
  const last = await page.evaluate('self.__lastFocused || null');
  check('getCurrent in the popup page is the popup itself', own.id === popup.id && own.type === 'popup' && own.tabs?.length === 1, own);
  check('getLastFocused there is another matter', last && last.id !== undefined, last);
  page.close();

  // ---- D. update
  const moved = await inSw(`chrome.windows.update(${popup.id}, {left: 200, top: 150, width: 500, height: 400})`);
  check('update bounds', near(moved.left, 200) && near(moved.top, 150) && near(moved.width, 500, 20) && near(moved.height, 400, 20), moved);
  const maximized = await inSw(`chrome.windows.update(${popup.id}, {state: 'maximized'})`);
  check('update state maximized', maximized.state === 'maximized', maximized);
  const normal = await inSw(`chrome.windows.update(${popup.id}, {state: 'normal'})`);
  check('update state normal', normal.state === 'normal', normal);
  check('state + bounds is refused', (await inSw(`chrome.windows.update(${popup.id}, {state: 'maximized', width: 600}).then(() => 'ok', e => e.message)`)) === 'Invalid value for state');
  check('off-screen bounds are refused', /^Invalid value for bounds/.test(await inSw(`chrome.windows.update(${popup.id}, {left: 99999, top: 99999}).then(() => 'ok', e => e.message)`)));
  await sleep(400);
  check('onBoundsChanged fired for the popup', (await events()).some(e => e[0] === 'onBoundsChanged' && e[1].id === popup.id), (await events()).slice(-5));

  // ---- E. a popup with a web address, a normal window with web addresses
  const web = await inSw(`chrome.windows.create({url: '${base}/popup-web', type: 'popup', width: 380, height: 300, focused: false})`);
  await quiet([web.id]);
  check('popup with a web page', web.type === 'popup' && web.tabs?.length === 1, web);
  const normalWindow = await inSw(`chrome.windows.create({url: ['${base}/n1', '${base}/n2'], focused: false})`);
  check('normal window: an Acira window with two tabs', normalWindow.type === 'normal' && normalWindow.tabs.length === 2, normalWindow);
  // (Chrome too answers windows.create with tabs whose url is still empty while they load: ask again for the addresses)
  const addresses = async wid => poll(async () => { const w = await inSw(`chrome.windows.get(${wid}, {populate: true})`); return w.tabs.every(t => t.url) ? w.tabs.map(t => t.url).join() : null; }, Boolean, 'tab addresses', 20000).catch(() => null);
  check('the popup\'s tab shows its web address', await addresses(web.id) === base + '/popup-web');
  check('the normal window\'s tabs show both addresses', await addresses(normalWindow.id) === `${base}/n1,${base}/n2`);
  check('now two normal windows', (await inSw(`chrome.windows.getAll({windowTypes: ['normal']})`)).length === 2);
  check('onCreated for the new normal window is in the log', (await events()).some(e => e[0] === 'onCreated' && e[1].id === normalWindow.id && e[1].type === 'normal'));

  // ---- E1. the extension's own page in a window of the default type (Chrono's standalone manager is a popup; others leave type out)
  const ownPage = await inSw(`chrome.windows.create({url: chrome.runtime.getURL('page.html'), focused: false})`);
  check('own extension page, default type: a window showing it', ownPage.tabs?.length === 1 && ownPage.tabs[0].url.startsWith(`chrome-extension://${id}/page.html`), ownPage);
  const otherPage = await inSw(`chrome.windows.create({url: 'chrome-extension://bcdefghijklmnopabcdefghijklmnopa/x.html', type: 'popup'}).then(() => 'opened', e => e.message)`);
  check("another extension's page is refused", otherPage === 'Extension windows require ordinary web destinations.', otherPage);
  await quiet([ownPage.id]);
  await inSw(`chrome.windows.remove(${ownPage.id})`);

  // ---- E2. tabId: a tab moves into a new window (its address opens there, the old tab closes: Acira's own Move to new window)
  const tabToMove = await inSw(`chrome.tabs.create({url: '${base}/moveme', active: false})`);
  await poll(async () => (await inSw(`chrome.tabs.query({})`)).find(t => t.id === tabToMove.id && String(t.url).includes('/moveme')), Boolean, 'the tab to move has its address', 20000).catch(() => null);
  const movedWindow = await inSw(`chrome.windows.create({tabId: ${tabToMove.id}, focused: false})`);
  check('create with tabId: a new normal window with one tab', movedWindow.type === 'normal' && movedWindow.tabs?.length === 1 && movedWindow.id !== mainId, movedWindow);
  check('...showing the moved address', await addresses(movedWindow.id) === base + '/moveme');
  check('...and the old tab is closed', !!(await poll(async () => ((await inSw('chrome.tabs.query({})')).some(t => t.id === tabToMove.id) ? null : true), Boolean, 'old tab closed', 15000).catch(() => null)));
  await sleep(300);

  // ---- F. focus events (the native focus is simulated: the QA windows must never take it)
  await inSw('self.__ev.length = 0; 0');
  await app.main(({BaseWindow}, wid) => { BaseWindow.getAllWindows().find(w => w.id === wid)?.emit('focus'); }, mainId);
  await sleep(150);
  await app.main(({BaseWindow}, wid) => { BaseWindow.getAllWindows().find(w => w.id === wid)?.emit('blur'); }, mainId);
  await sleep(400);
  const focusLog = (await events()).filter(e => e[0] === 'onFocusChanged').map(e => e[1]);
  check('onFocusChanged: the window, then WINDOW_ID_NONE when nothing is focused', focusLog.join() === `${mainId},-1`, focusLog);

  // ---- G. remove
  await inSw('self.__ev.length = 0; 0');
  const gone = [popup.id, web.id, normalWindow.id, movedWindow.id];
  for (const wid of gone) await inSw(`chrome.windows.remove(${wid})`);
  await poll(async () => (await inSw('chrome.windows.getAll()')).length, v => v === 1, 'windows closed', 20000).catch(() => {});
  const left = await inSw('chrome.windows.getAll()');
  check('remove closes the windows', left.length === 1 && left[0].id === mainId, left.map(w => w.id));
  const removed = (await events()).filter(e => e[0] === 'onRemoved').map(e => e[1]).sort();
  check('onRemoved for each', removed.join() === [...gone].sort().join(), removed);
  check('after all that the main process answers', await app.main(() => true).then(() => true, () => false));
} catch (error) {
  results.error = String(error?.stack || error).slice(0, 1500);
  console.error(results.error);
  check('run completed', false, results.error);
} finally {
  clearTimeout(deadline);
  try { sw?.close(); } catch { /* gone */ }
  try { await app?.close(); } catch { /* gone */ }
  server.close();
  if (slot) await releaseSlot(slot);
  try { await fs.rm(extDir, {recursive: true, force: true}); } catch { /* temp */ }
}
results.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(results, null, 1));
const failed = results.checks.filter(c => !c.ok);
console.log(`${results.checks.length - failed.length}/${results.checks.length} checks passed; wrote ${out}`);
process.exitCode = failed.length ? 1 : 0;
