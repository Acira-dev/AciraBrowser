// chrome.tabs on the real app (package P1): a QA extension (qa/extension-api-probe/tabs-e2e) drives chrome.tabs against real Acira tabs of an
// isolated profile and the script checks the effect on Acira's own state (order, pinned, active, muted) and the events the extension heard.
// One app, one native slot (C:\ae\slot-N.lock, wx), bounded waits, closed in finally. Never touches the real profile, focus or the screen.
//   node qa/extension-api-probe/tabs-e2e.mjs [--keep]   (cwd = repo, after npm run build)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from '../d-harness.mjs';

const started = Date.now(), log = (...a) => console.log(((Date.now() - started) / 1000).toFixed(1) + 's', ...a);
const stamp = Date.now().toString(36);
const extDir = path.resolve('C:/ae/p1-tabs-e2e', stamp, 'ext');
const checks = [];
const check = (name, ok, detail) => { checks.push({name, ok: !!ok, detail: detail === undefined ? undefined : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}); log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)); };

async function takeSlot(name) {
  for (let attempt = 0; attempt < 90; attempt++) {
    for (let n = 1; n <= 3; n++) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`${name} ${new Date().toISOString()}\n`); await handle.close(); return file; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    log('all native slots busy; waiting 30 s');
    await sleep(30000);
  }
  throw Error('no native slot within 45 minutes');
}

// ---- QA server: fixture pages + the command channel of the extension page
const queue = [], waiting = [], reports = new Map(), waitersFor = new Map();
let hello = null, seq = 0, swReport = null, popupReport = null;
const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    if (url.pathname === '/cmd') {
      let answered = false;
      const reply = () => { if (answered) return; answered = true; const cmd = queue.shift(); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(cmd || {})); };
      if (queue.length) return reply();
      const wake = () => { clearTimeout(timer); reply(); };
      const timer = setTimeout(() => { const at = waiting.indexOf(wake); if (at >= 0) waiting.splice(at, 1); reply(); }, 20000);
      waiting.push(wake);
      return;
    }
    if (req.method === 'POST') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (url.pathname === '/hello') hello = data;
          if (url.pathname === '/sw-report') swReport = data;
          if (url.pathname === '/popup-report') popupReport = data;
          if (url.pathname === '/report') { reports.set(data.id, data); waitersFor.get(data.id)?.(data); }
        } catch { /* ignore */ }
        res.end('ok');
      });
      return;
    }
    const n = url.pathname.split('/').pop() || '0';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="${n === '1' ? 'fr' : 'en'}"><meta charset="utf-8"><title>Page ${n}</title><body style="font:16px system-ui"><h1>Page ${n}</h1></body></html>`);
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const command = (body, ms = 15000) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { waitersFor.delete(id); reject(Error(`no answer to ${JSON.stringify(body).slice(0, 80)}`)); }, ms);
  waitersFor.set(id, data => { clearTimeout(timer); waitersFor.delete(id); resolve(data); });
  queue.push({id, ...body});
  const wake = waiting.shift(); if (wake) wake();
});
const call = async (name, ...args) => command({call: name, args});
const callback = async (name, ...args) => (await command({call: name, args, callback: true})).value;
const ok = async (name, ...args) => { const r = await call(name, ...args); if (!r.ok) throw Error(`${name} failed: ${r.error}`); return r.value; };
const events = async () => (await command({op: 'events'})).value;
// Events arrive a moment after the call that caused them: collect until the wanted one shows (or 4 s), keep everything heard.
const heardAll = [];
const heardWhere = async (match, ms = 4000) => { const end = Date.now() + ms; for (;;) { heardAll.push(...await events()); const found = heardAll.find(match); if (found || Date.now() > end) return found || null; await sleep(150); } };
const until = async (read, ms, every = 250) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };

let slot, app;
try {
  await fs.mkdir(extDir, {recursive: true});
  for (const file of ['manifest.json', 'sw.js', 'page.html', 'page.js', 'cs.js', 'blank.html', 'popup.html', 'popup.js']) {
    const text = await fs.readFile(path.resolve('qa/extension-api-probe/tabs-e2e', file), 'utf8');
    await fs.writeFile(path.join(extDir, file), text.replace('__BASE__', base));
  }
  slot = await takeSlot('p1-tabs-e2e');
  app = await startApp({root: path.resolve('.qa-profiles', 'p1' + stamp), env: {ACIRA_DEV: '0'}});
  await app.main(({dialog}, folder) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
  }, extDir);
  const state0 = await app.state(), profileId = state0.activeBrowserProfileId;
  const partition = state0.browserProfiles.find(p => p.id === profileId).partition;
  const loaded = await app.ui.evaluate(request => window.acira.extensions(request), {profileId, type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === 'Acira tabs e2e');
  if (!entry) throw Error('QA extension did not load: ' + JSON.stringify(loaded).slice(0, 300));
  log('loaded', entry.id);
  const act = a => app.act(a);
  const tabsNow = async () => (await app.state()).tabs;
  const find = async n => (await tabsNow()).find(t => t.url === `${base}/p/${n}`);

  // 1. three real web tabs
  for (const n of [1, 2, 3]) await act({type: 'tab.new', url: `${base}/p/${n}`});
  await until(async () => (await tabsNow()).filter(t => t.url.startsWith(base)).length === 3 && (await tabsNow()).every(t => !t.loading), 30000);
  await sleep(800);
  // The command page: a hidden window of the profile's session (as the probe does), not a tab.
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 500, height: 400, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__p1Page = w; w.loadURL(args.url);
  }, {partition, url: `chrome-extension://${entry.id}/page.html?base=${encodeURIComponent(base)}`});
  if (!await until(() => hello, 30000)) throw Error('the extension page never said hello');
  await events();   // drop anything heard so far
  heardAll.length = 0;

  // 2. query: Acira's own order and the active tab
  const listed = (await ok('tabs.query', {})).filter(t => t.url && t.url.startsWith(base));
  const acira = (await tabsNow()).filter(t => t.url.startsWith(base));
  check('query lists the three tabs in Acira order', JSON.stringify(listed.map(t => t.url)) === JSON.stringify(acira.map(t => t.url)), listed.map(t => t.url));
  check('query indexes follow the strip', listed.every((t, i) => i === 0 || t.index > listed[i - 1].index), listed.map(t => t.index));
  const activeNow = (await app.state()).activeTabId;
  const current = await ok('tabs.query', {active: true, currentWindow: true});
  check('query({active, currentWindow}) is Acira\'s active tab', current.length === 1 && current[0].url === (await tabsNow()).find(t => t.id === activeNow)?.url, current.map(t => t.url));
  const one = listed.find(t => t.url.endsWith('/p/1')), two = listed.find(t => t.url.endsWith('/p/2')), three = listed.find(t => t.url.endsWith('/p/3'));
  check('get returns Acira fields', await ok('tabs.get', one.id).then(t => t.url === one.url && t.pinned === false && t.groupId === -1 && typeof t.lastAccessed === 'number' && t.windowId === one.windowId, () => false));
  const missing = await call('tabs.get', 987654);
  check('get of an unknown id rejects with Chromium\'s message', !missing.ok && missing.error === 'No tab with id: 987654.', missing.error);

  // sender.tab of a content script's message is Electron's own object; extensions index tabs with it (Vimium), so it must agree with chrome.tabs.
  await ok('tabs.reload', one.id);   // the content script's hello went out before this page existed: ask for another
  const senders = await until(async () => { const list = (await command({op: 'senders'})).value; return list.some(s => s.url === one.url) && list; }, 15000) || [], seen = senders.find(s => s.url === one.url);
  // KNOWN: Electron builds sender.tab itself and fills windowId / index with 0 (id is right). Reported, not asserted: chrome.tabs cannot change it.
  check('sender.tab of a content script message carries the right id (windowId / index are Electron\'s zeros: known)', seen && seen.tab && seen.tab.id === one.id, {sender: seen && seen.tab && {id: seen.tab.id, windowId: seen.tab.windowId, index: seen.tab.index}, tabsGet: {id: one.id, windowId: one.windowId, index: one.index}});
  const pong = await call('tabs.sendMessage', one.id, {ping: 7});
  check('sendMessage reaches the content script of that page (messaging unchanged)', pong.ok && pong.value && pong.value.pong === 7 && pong.value.url === one.url, pong);

  const everything = await ok('tabs.query', {currentWindow: true});
  const ntpTab = everything.find(tab => tab.url === 'chrome://newtab/');
  check('the new-tab page is a tab too: listed, with an id and no page', ntpTab && typeof ntpTab.id === 'number' && ntpTab.discarded === false && ntpTab.status === 'complete', ntpTab || everything.map(tab => tab.url));
  const idsAreUnique = new Set(everything.map(tab => tab.id)).size === everything.length;
  check('every tab id is unique and the indexes run 0..n-1', idsAreUnique && everything.every((tab, i) => tab.index === i), everything.map(tab => [tab.id, tab.index]));
  await ok('tabs.setZoom', one.id, 1.5);
  const zoomed = await until(async () => (await find(1))?.zoom === 150, 6000);
  check('setZoom changes Acira\'s own zoom state; getZoom reads it', zoomed && await ok('tabs.getZoom', one.id) === 1.5, (await find(1))?.zoom);
  await ok('tabs.setZoom', one.id, 0);
  check('setZoom(0) resets to the default', await until(async () => (await find(1))?.zoom === 100, 6000));
  const blank = await ok('tabs.create', {});
  check('create({}) opens the new-tab page and returns a Tab with an id', typeof blank.id === 'number' && blank.url === 'chrome://newtab/', blank);
  check('update and remove accept that id right away', (await ok('tabs.update', blank.id, {url: `${base}/p/7`})).id === blank.id && await until(async () => (await tabsNow()).some(tab => tab.url === `${base}/p/7`), 8000));
  await ok('tabs.remove', blank.id);
  check('that tab is closed in Acira', await until(async () => !(await tabsNow()).some(tab => tab.url === `${base}/p/7`), 8000));
  await act({type: 'tab.select', id: (await find(1)).id});

  // 3. create at an index, in the background
  const activeBefore = (await app.state()).activeTabId;
  const created = await ok('tabs.create', {url: `${base}/p/4`, index: 1, active: false});
  const afterCreate = await tabsNow();
  const order1 = afterCreate.filter(t => t.url.startsWith(base)).map(t => t.url.split('/').pop());
  check('create(index 1, active false): at that index (after the new-tab page), active tab unchanged', order1.join() === '4,1,2,3' && (await app.state()).activeTabId === activeBefore, order1);
  check('create returns the Tab with that index', created.index === 1 && created.active === false && (created.url || created.pendingUrl) === `${base}/p/4`, created);
  const gotCreated = await heardWhere(e => e.event === 'onCreated' && e.args[0].id === created.id);
  check('onCreated was heard for it (with url, index 1)', gotCreated && (gotCreated.args[0].url || gotCreated.args[0].pendingUrl) === `${base}/p/4` && gotCreated.args[0].index === 1, gotCreated || heardAll.map(e => e.event));

  // 4. pin, mute, activate, move
  await ok('tabs.update', created.id, {pinned: true});
  check('update(pinned) pins it first in Acira', (await tabsNow())[0]?.url === `${base}/p/4` && (await tabsNow())[0].pinned === true, (await tabsNow()).map(t => `${t.pinned ? '*' : ''}${t.url}`));
  const gotPinned = await heardWhere(e => e.event === 'onUpdated' && e.args[0] === created.id && e.args[1].pinned === true);
  check('pinning fired onUpdated({pinned})', gotPinned, heardAll.map(e => e.event + JSON.stringify(e.args[1] || '')));
  const gotMoved = await heardWhere(e => e.event === 'onMoved' && e.args[0] === created.id);
  check('pinning moved it in front of the others: onMoved(1 -> 0)', gotMoved && gotMoved.args[1].fromIndex === 1 && gotMoved.args[1].toIndex === 0, gotMoved || heardAll.map(e => e.event));
  const muted = await ok('tabs.update', two.id, {muted: true});
  check('update(muted) mutes with reason extension', muted.mutedInfo?.muted === true && muted.mutedInfo.reason === 'extension' && (await find(2))?.muted === true, muted.mutedInfo);
  await ok('tabs.update', two.id, {muted: false});
  await ok('tabs.update', one.id, {active: true});
  check('update(active) selects it in Acira', (await app.state()).activeTabId === (await find(1))?.id);
  check('onActivated heard (and onHighlighted)', await heardWhere(e => e.event === 'onActivated' && e.args[0].tabId === one.id) && await heardWhere(e => e.event === 'onHighlighted' && e.args[0].tabIds[0] === one.id), heardAll.map(e => e.event));
  await ok('tabs.move', one.id, {index: -1});
  const order = (await tabsNow()).filter(t => t.url.startsWith(base)).map(t => t.url.split('/').pop());
  check('move(index -1) sends it to the end', order[order.length - 1] === '1', order);
  check('onMoved heard for the moved tab', await heardWhere(e => e.event === 'onMoved' && e.args[0] === one.id), heardAll.map(e => e.event));

  // 5. a private tab stays invisible
  await act({type: 'tab.new', privacy: 'private', url: `${base}/p/9`});
  await sleep(2500);
  const all = await ok('tabs.query', {});
  await heardWhere(() => false, 1200);
  check('a private tab is not listed and raises no event', !all.some(t => (t.url || '').endsWith('/p/9')) && !heardAll.some(e => JSON.stringify(e.args).includes('/p/9')), {listed: all.length, heard: heardAll.length});

  // 6. language, highlight, capture, reload, remove, errors
  check('detectLanguage reads the page language', await ok('tabs.detectLanguage', one.id) === 'fr', await call('tabs.detectLanguage', one.id));
  const rows = (await ok('tabs.query', {})).filter(t => t.url && t.url.startsWith(base));
  const target = rows.find(t => t.url.endsWith('/p/2'));
  await ok('tabs.highlight', {tabs: target.index});
  check('highlight activates that index', (await app.state()).activeTabId === (await find(2))?.id);
  const shot = await call('tabs.captureVisibleTab', null, {format: 'jpeg', quality: 50});
  check('captureVisibleTab answers (data URL) or fails with Chromium\'s reason', shot.ok ? /^data:image\/jpeg;base64,/.test(shot.value) : /No active web contents|permission/.test(shot.error), shot.ok ? shot.value.slice(0, 30) : shot.error);
  await ok('tabs.reload', target.id, {bypassCache: true});
  await ok('tabs.remove', target.id);
  await until(async () => !(await find(2)), 10000);
  check('remove closes it in Acira', !(await find(2)));
  check('onRemoved heard with the window', await heardWhere(e => e.event === 'onRemoved' && e.args[0] === target.id && typeof e.args[1].windowId === 'number'), heardAll.map(e => e.event));
  const badWindow = await call('tabs.create', {url: `${base}/p/5`, windowId: 424242});
  check('create in an unknown window rejects with Chromium\'s message', !badWindow.ok && badWindow.error === 'No window with id: 424242.', badWindow.error);
  const badUrl = await call('tabs.create', {url: 'javascript:alert(1)'});
  check('create(javascript:) is refused', !badUrl.ok && /JavaScript URLs are not allowed/.test(badUrl.error), badUrl.error);
  const bad = await call('tabs.query', {nope: 1});
  check('query with an unknown property is Chromium\'s argument error', !bad.ok && /Unexpected property: 'nope'/.test(bad.error), bad.error);
  const swDone = await until(() => swReport, 20000);
  check('the service worker context: windows.getCurrent (callback + promise), tabs.query, tabs.create(extension page) all work', swDone && !swDone.error && swDone.getCurrentCallback.id > 0 && swDone.getCurrentCallback.lastError === null && swDone.getCurrentPromise > 0 && swDone.created && swDone.found.includes(swDone.created.id), swDone);
  // 6b. what Chrono Download Manager's "OPEN MANAGER" does: windows.getCurrent(callback), tabs.query({url}) for its page, tabs.create({active, url: extension page})
  const winCb = await callback('windows.getCurrent');
  check('windows.getCurrent(callback) answers with a window and no lastError (Chrono retries this every second until it does)', winCb && winCb.lastError === null && winCb.value && typeof winCb.value.id === 'number', winCb);
  const pageUrl = `chrome-extension://${entry.id}/blank.html`;
  const none = await ok('tabs.query', {url: pageUrl + '*'});
  check('tabs.query({url: <own page>*}) finds nothing before it is open', none.length === 0, none);
  const opened = await call('tabs.create', {active: true, url: pageUrl});
  check('tabs.create({url: an extension page}) opens it', opened.ok && (opened.value.url || opened.value.pendingUrl) === pageUrl, opened);
  const found = opened.ok ? await ok('tabs.query', {url: pageUrl + '*'}) : [];
  check('tabs.query({url: <own page>*}) then finds it', found.length === 1 && found[0].id === opened.value?.id, found);
  const relative = await call('tabs.create', {url: 'blank.html?second=1', active: false});
  check('tabs.create with a relative extension url resolves against the extension', relative.ok && (relative.value.url || relative.value.pendingUrl) === pageUrl + '?second=1', relative);
  for (const tab of [opened, relative]) if (tab.ok) await call('tabs.remove', tab.value.id);

  // Chrono's default ("standalone window") opens its manager with windows.create(extension page, popup): windows is P2's; recorded here so the report can say what happens.
  const popupWin = await call('windows.create', {url: pageUrl, type: 'popup', focused: true});
  check('INFO windows.create({url: extension page, type: popup}) -> ' + (popupWin.ok ? 'opened' : popupWin.error), true, popupWin);
  if (popupWin.ok && popupWin.value && popupWin.value.id) await call('windows.remove', popupWin.value.id);

  // 6c. a popup's current window, with the browser window not focused (the QA window never is): once as a page in a helper window (how the Web Store rigs
  //     open popups), once as the real toolbar popup hosted by the window
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 300, height: 200, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__p1Popup = w; w.loadURL(args.url);
  }, {partition, url: `chrome-extension://${entry.id}/popup.html`});
  const stateNow = await app.state(), activeUrl = stateNow.tabs.find(tab => tab.id === stateNow.activeTabId)?.url;
  const helperSaw = await until(() => popupReport, 15000);
  check('a popup page: tabs.query({active, currentWindow}) answers with the active tab although no window is focused', helperSaw && !helperSaw.error && helperSaw.query.length === 1 && helperSaw.query[0].url === activeUrl && helperSaw.lastFocused.length === 1, helperSaw);
  popupReport = null;
  await app.main(() => { try { globalThis.__p1Popup?.destroy(); } catch { /* gone */ } });
  await app.ui.evaluate(request => window.acira.extensions(request), {profileId, type: 'pin', extensionId: entry.id}).catch(() => {});
  await sleep(800);
  try {
    await app.ui.locator('.native-extension-actions:visible browser-action-list button.action').first().click({timeout: 8000});
    const toolbarSaw = await until(() => popupReport, 12000);
    check('INFO the toolbar popup (hosted by the window) answers the same: ' + JSON.stringify(toolbarSaw && toolbarSaw.query && toolbarSaw.query.map(tab => tab.url)), true, toolbarSaw);
    await app.ui.keyboard.press('Escape').catch(() => {});
  } catch (error) { log('toolbar button not available in this rig:', String(error.message).slice(0, 100)); }
  await sleep(500);

  // 7. a tab moved into a new window: Acira opens the address there and closes the old tab; the extension still sees one tab, with its id
  const mover = (await ok('tabs.query', {url: `${base}/p/3`}))[0], moverAcira = await find(3);
  heardAll.length = 0;
  await act({type: 'tab.move-window', id: moverAcira.id});
  const attached = await heardWhere(e => e.event === 'onAttached' && e.args[0] === mover.id, 8000);
  check('moving a tab to a new window: onDetached + onAttached for the same tab id, no removal', attached && heardAll.some(e => e.event === 'onDetached' && e.args[0] === mover.id) && !heardAll.some(e => e.event === 'onRemoved' && e.args[0] === mover.id), {mover: [mover.id, mover.windowId], heard: heardAll.map(e => e.event + ':' + (e.args[0]?.id ?? e.args[0]?.tabId ?? e.args[0]) + ':' + (e.args[1]?.windowId ?? e.args[0]?.windowId ?? e.args[1]?.newWindowId ?? e.args[1]?.oldWindowId ?? '')), now: (await ok('tabs.query', {url: mover.url})).map(tab => [tab.id, tab.windowId])});
  const moved = await call('tabs.get', mover.id);
  check('that tab keeps its id and now reports the new window', moved.ok && moved.value.windowId !== mover.windowId && moved.value.url === mover.url, moved.ok ? {was: mover.windowId, now: moved.value.windowId} : moved.error);
  check('main process alive', await app.main(() => true).then(() => true, () => false));
} catch (error) {
  check('run finished without an exception', false, String(error && error.stack || error));
} finally {
  try { await app?.main(() => { try { globalThis.__p1Page?.destroy(); } catch {} }); } catch { /* closing */ }
  try { await app?.close(); } catch { /* closing */ }
  server.close(); server.closeAllConnections?.();
  if (slot) await fs.rm(slot, {force: true});
}
const failed = checks.filter(c => !c.ok);
const out = path.resolve('qa/artifacts/extension-api-probe', `tabs-e2e-${stamp}.json`);
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify({started: new Date(started).toISOString(), checks}, null, 1));
console.log(`${checks.length - failed.length}/${checks.length} checks passed; wrote ${out}`);
process.exitCode = failed.length ? 1 : 0;
