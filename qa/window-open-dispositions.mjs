// Where does a page's new window land: a tab or a pop-up window? Chrome's rule, in the real app (isolated profile, hidden windows):
//   a link with target=_blank / Ctrl+click / middle click / window.open(url) / window.open(url,'_blank'[,'noopener']) -> a TAB
//     (foreground for a plain click, background for Ctrl or middle click); window.open without noopener keeps window.opener
//   window.open with a size, a position, popup=1 or minimal-UI features -> a pop-up WINDOW, opener kept (OAuth pop-ups)
// Reads pages only: no credentials, no form is submitted. The only clicks are on this script's own local page (and, with --gmail, on the
// public "Sign in" link of workspace.google.com, whose destination is only observed).
//   node qa/native-slot.mjs window-open -- node qa/window-open-dispositions.mjs [--cases | --gmail | --private] [out.json]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mode = process.argv.slice(2).find(arg => arg.startsWith('--')) || '--cases';
const out = process.argv.slice(2).find(arg => !arg.startsWith('--'));

const CASES_PAGE = `<!doctype html><meta charset=utf-8><title>cases</title><style>body{font:16px sans-serif;padding:20px}a,button{display:block;margin:10px 0;padding:8px;font-size:18px}</style>
<a id="link-blank" target="_blank" href="/target?case=link-blank">link target=_blank</a>
<a id="link-ctrl" target="_blank" href="/target?case=link-ctrl">link ctrl+click</a>
<a id="link-middle" target="_blank" href="/target?case=link-middle">link middle-click</a>
<a id="link-noopener" target="_blank" rel="noopener" href="/target?case=link-noopener">link target=_blank rel=noopener</a>
<button id="wo-plain">window.open(url)</button>
<button id="wo-blank">window.open(url,'_blank')</button>
<button id="wo-noopener">window.open(url,'_blank','noopener')</button>
<button id="wo-noreferrer">window.open(url,'_blank','noopener,noreferrer')</button>
<button id="wo-named">window.open(url,'named')</button>
<button id="wo-size">window.open(url,'x','width=500,height=600')</button>
<button id="wo-popup1">window.open(url,'x','popup=1')</button>
<button id="wo-popupyes">window.open(url,'x','popup=yes,width=640,height=760')</button>
<button id="wo-minimal">window.open(url,'x','menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes')</button>
<button id="wo-noopener-size">window.open(url,'x','noopener,width=500,height=600')</button>
<button id="wo-popup0">window.open(url,'x','popup=0')</button>
<script>
window.__msgs = []; window.__r = {};
addEventListener('message', event => window.__msgs.push(event.data));
const features = {'wo-plain': undefined, 'wo-blank': ['_blank'], 'wo-noopener': ['_blank', 'noopener'], 'wo-noreferrer': ['_blank', 'noopener,noreferrer'], 'wo-named': ['named'],
  'wo-size': ['x', 'width=500,height=600'], 'wo-popup1': ['x', 'popup=1'], 'wo-popupyes': ['x', 'popup=yes,width=640,height=760'],
  'wo-minimal': ['x', 'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'], 'wo-noopener-size': ['x', 'noopener,width=500,height=600'], 'wo-popup0': ['x', 'popup=0']};
for (const id of Object.keys(features)) document.getElementById(id).addEventListener('click', () => { const args = features[id] || []; const w = window.open('/target?case=' + id, ...args); window.__r[id] = {returned: w !== null}; });
</script>`;
const TARGET_PAGE = `<!doctype html><meta charset=utf-8><title>target</title><body>target<script>
const info = {case: new URL(location.href).searchParams.get('case'), opener: window.opener !== null, name: window.name, innerWidth, innerHeight};
document.title = 'target ' + info.case; window.__info = info;
try { if (window.opener) window.opener.postMessage(info, '*'); } catch {}
</script>`;

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/cases') res.end(CASES_PAGE); else if (url.pathname === '/target') res.end(TARGET_PAGE); else { res.statusCode = 404; res.end('no'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve))};
}

// [id, how to click, expected kind, expected opener on the new page]
const EXPECT = {
  'link-blank': ['click', 'tab-fg', false], 'link-ctrl': ['ctrl', 'tab-bg', false], 'link-middle': ['middle', 'tab-bg', false], 'link-noopener': ['click', 'tab-fg', false],
  'wo-plain': ['click', 'tab-fg', true], 'wo-blank': ['click', 'tab-fg', true], 'wo-noopener': ['click', 'tab-fg', false], 'wo-noreferrer': ['click', 'tab-fg', false], 'wo-named': ['click', 'tab-fg', true],
  'wo-size': ['click', 'popup', true], 'wo-popup1': ['click', 'popup', true], 'wo-popupyes': ['click', 'popup', true], 'wo-minimal': ['click', 'popup', true], 'wo-noopener-size': ['click', 'popup', false], 'wo-popup0': ['click', 'tab-fg', true],
};

async function launch() {
  const {launchPreparedNative} = await import('./prepared-native.mjs');
  const data = path.resolve('.qa-profiles/wo-' + Date.now());
  const app = await launchPreparedNative({executablePath: createRequire(import.meta.url)('electron'), args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'}});
  app.process().stderr?.on('data', chunk => { const line = String(chunk).trim(); if (/Error|Uncaught|TypeError|ReferenceError|not a function/.test(line)) console.log('   [main stderr]', line.slice(0, 400)); });
  let ui; for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
  if (!ui) throw Error('UI page not found');
  try { await ui.getByRole('button', {name: 'Skip setup', exact: true}).click({timeout: 8000}); } catch { /* past setup */ }
  // Log what Electron hands every window-open handler (details are read-only; the handler's own answer is passed through untouched).
  await app.evaluate(({webContents}) => {
    const proto = Object.getPrototypeOf(webContents.getAllWebContents()[0]);
    if (proto.__openLog) return; proto.__openLog = true; globalThis.__openLog = [];
    const original = proto.setWindowOpenHandler;
    proto.setWindowOpenHandler = function (handler) { const self = this; return original.call(this, details => { const answer = handler(details); try { globalThis.__openLog.push({from: self.getURL().slice(0, 60), url: details.url.slice(0, 80), disposition: details.disposition, features: details.features, frameName: details.frameName, action: answer.action, createWindow: typeof answer.createWindow}); } catch {} return answer; }); };
  });
  return {app, ui, data};
}

const isUi = p => /^acira-browser-ui:/.test(p.url());
const snap = ui => ui.evaluate(async () => { const s = await window.acira.getSnapshot(); return {active: s.activeTabId, tabs: s.tabs.map(t => ({id: t.id, url: t.url, title: t.title, loading: t.loading, requested: t.requestedUrl || null, privacy: t.privacy || null, opener: t.openerId || null}))}; });
const windowsOf = app => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(w => ({id: w.id, url: w.webContents.getURL(), visible: w.isVisible(), width: w.getBounds().width, height: w.getBounds().height, title: w.getTitle()})).filter(w => /^https?:/.test(w.url)));

async function openTab(ui, app, url, extra = {}) {
  const before = await snap(ui);
  await ui.evaluate(([u, e]) => window.acira.dispatch({type: 'tab.new', url: u, ...e}), [url, extra]);
  for (let i = 0; i < 200; i++) { const now = await snap(ui); const fresh = now.tabs.find(t => !before.tabs.some(b => b.id === t.id)); if (fresh) { for (let j = 0; j < 300; j++) { const page = app.windows().find(p => !isUi(p) && p.url().startsWith(url.split('?')[0].replace(/\/$/, ''))); if (page) return {page, tabId: fresh.id}; await wait(100); } } await wait(100); }
  throw Error('tab did not appear for ' + url);
}

/** Runs one action on the page and reports where the new window landed. */
async function observe(ctx, caseId, action) {
  const {app, ui} = ctx;
  const before = await snap(ui), winsBefore = new Set((await windowsOf(app)).map(w => w.id));
  await app.evaluate(() => { globalThis.__openLog.length = 0; });
  await action();
  let after = before, newWins = [], newTabs = [];
  for (let i = 0; i < 40; i++) { await wait(150); after = await snap(ui); newTabs = after.tabs.filter(t => !before.tabs.some(b => b.id === t.id)); newWins = (await windowsOf(app)).filter(w => !winsBefore.has(w.id)); if (newTabs.length || newWins.length) break; }
  await wait(900);
  after = await snap(ui); newTabs = after.tabs.filter(t => !before.tabs.some(b => b.id === t.id)); newWins = (await windowsOf(app)).filter(w => !winsBefore.has(w.id));
  // the new tab's title and address reach the tab strip (a view a page opened must report them like any other page)
  for (let i = 0; i < 24 && newTabs[0] && !newTabs[0].title; i++) { await wait(250); after = await snap(ui); newTabs = after.tabs.filter(t => !before.tabs.some(b => b.id === t.id)); }
  const log = await app.evaluate(() => globalThis.__openLog.slice());
  let kind = 'none';
  if (newTabs.length && !newWins.length) kind = after.active === newTabs[0].id ? 'tab-fg' : 'tab-bg';
  else if (newWins.length && !newTabs.length) kind = 'popup';
  else if (newWins.length && newTabs.length) kind = 'both';
  const result = {caseId, kind, tab: newTabs[0] || null, win: newWins[0] ? {url: newWins[0].url, width: newWins[0].width, height: newWins[0].height} : null, log: log.map(l => `${l.disposition}|${JSON.stringify(l.features)}|${l.action}${l.createWindow === 'function' ? '+createWindow' : ''}`)};
  const target = app.windows().find(p => !isUi(p) && p.url().includes('case=' + caseId));
  const source = app.windows().find(p => !isUi(p) && p.url().includes('/cases'));
  result.openerSide = source ? await source.evaluate(id => ({returned: window.__r && window.__r[id] ? window.__r[id].returned : null, messages: (window.__msgs || []).filter(m => m && m.case === id).length}), caseId).catch(() => null) : null;
  result.target = target ? await target.evaluate(() => window.__info || null).catch(() => null) : null;
  return result;
}

async function runCases(ctx, server, label, openOpts = {}) {
  const {app, ui} = ctx;
  const rows = []; let bad = 0;
  const only = process.env.WO_ONLY ? process.env.WO_ONLY.split(',') : null;
  for (const [id, [how, wantKind, wantOpener]] of Object.entries(EXPECT)) {
    if (only && !only.includes(id)) continue;
    const {page, tabId} = await openTab(ui, app, server.base + '/cases', openOpts);
    await ui.evaluate(t => window.acira.dispatch({type: 'tab.select', id: t}), tabId).catch(() => {});
    await wait(300);
    const opts = how === 'ctrl' ? {modifiers: ['Control']} : how === 'middle' ? {button: 'middle'} : {};
    const result = await observe(ctx, id, () => page.click('#' + id, opts));
    const opener = result.target ? result.target.opener : null;
    const linked = !wantOpener || !result.openerSide || (result.openerSide.returned === true && result.openerSide.messages === 1);
    const ok = result.kind === wantKind && (result.target ? opener === wantOpener : true) && (id.startsWith('wo-') ? linked : true);
    if (!ok) bad++;
    rows.push({...result, wantKind, wantOpener, ok});
    console.log((ok ? 'ok  ' : 'FAIL') + ' ' + label.padEnd(8) + id.padEnd(18) + 'got ' + result.kind.padEnd(8) + 'want ' + wantKind.padEnd(8) + 'opener ' + String(opener).padEnd(5) + '(want ' + wantOpener + ') ret/msg ' + (result.openerSide ? result.openerSide.returned + '/' + result.openerSide.messages : '-') + ' tab "' + (result.tab ? (result.tab.title || '').slice(0, 14) : '') + '" ' + (result.win ? `win ${result.win.width}x${result.win.height} ` : '') + result.log.join(' ; '));
    if (only) console.log('   tab state:', JSON.stringify(result.tab), JSON.stringify(await app.evaluate(({webContents}, c) => webContents.getAllWebContents().filter(w => w.getURL().includes('case=' + c)).map(w => ({title: w.getTitle(), loading: w.isLoading(), titleListeners: w.listenerCount('page-title-updated'), finish: w.listenerCount('did-finish-load')})), id)));
    // clean up: close the extra tab / window and the case tab
    if (result.tab) await ui.evaluate(t => window.acira.dispatch({type: 'tab.close', id: t}), result.tab.id).catch(() => {});
    if (result.win) await app.evaluate(({BrowserWindow}, u) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL() === u) w.destroy(); }, result.win.url).catch(() => {});
    await ui.evaluate(t => window.acira.dispatch({type: 'tab.close', id: t}), tabId).catch(() => {});
    await wait(200);
  }
  return {rows, bad};
}

/** The founder's report: workspace.google.com/intl/en-US/gmail/, signed out, "Sign in". Only observes where accounts.google.com loads. */
async function runGmail(ctx) {
  const {app, ui} = ctx;
  const {page, tabId} = await openTab(ui, app, 'https://workspace.google.com/intl/en-US/gmail/');
  await page.waitForLoadState('load', {timeout: 45000}).catch(() => {}); await wait(5000);
  const found = await page.evaluate(() => {
    const items = [...document.querySelectorAll('a,button')].filter(el => /^\s*sign in\s*$/i.test(el.textContent || '') && el.getBoundingClientRect().width > 0);
    return items.map((el, index) => { el.setAttribute('data-wo-probe', String(index)); const attrs = {}; for (const a of el.attributes) attrs[a.name] = a.value.slice(0, 160); return {index, tag: el.tagName, attrs, text: el.textContent.trim().slice(0, 40), rect: JSON.stringify(el.getBoundingClientRect())}; });
  });
  console.log('Sign in candidates:', JSON.stringify(found, null, 1));
  if (!found.length) throw Error('no visible Sign in element');
  const cdp = await page.context().newCDPSession(page);
  const listeners = [];
  for (const item of found) {
    const {result} = await cdp.send('Runtime.evaluate', {expression: `document.querySelector('[data-wo-probe="${item.index}"]')`});
    const got = await cdp.send('DOMDebugger.getEventListeners', {objectId: result.objectId, depth: 0}).catch(() => ({listeners: []}));
    listeners.push({index: item.index, listeners: got.listeners.map(l => l.type)});
  }
  console.log('Event listeners on the candidates:', JSON.stringify(listeners));
  await page.evaluate(() => { window.__openedProbe = []; const original = window.open; window.open = function (...args) { window.__openedProbe.push(args.map(String)); return original.apply(this, args); }; });
  const result = await observe(ctx, 'gmail-signin', () => page.click('[data-wo-probe="' + found[0].index + '"]'));
  const probe = await page.evaluate(() => window.__openedProbe).catch(() => null);
  console.log('Sign in click ->', JSON.stringify({kind: result.kind, tab: result.tab && result.tab.url.slice(0, 90), win: result.win && result.win.url.slice(0, 90), log: result.log, windowOpenCalls: probe}));
  return {found, listeners, result, probe};
}

const {withSlot} = await import('./native-slot.mjs');
let exit = 1;
await withSlot('window-open-dispositions', async () => {
  const server = await startServer();
  const ctx = await launch();
  try {
    const report = {mode};
    if (mode === '--gmail') report.gmail = await runGmail(ctx), exit = 0;
    else if (mode === '--private') { const r = await runCases(ctx, server, 'private', {privacy: 'private'}); report.cases = r.rows; exit = r.bad ? 1 : 0; console.log(r.bad ? `${r.bad} private case(s) differ` : 'all private cases match'); }
    else { const r = await runCases(ctx, server, 'normal'); report.cases = r.rows; exit = r.bad ? 1 : 0; console.log(r.bad ? `${r.bad} case(s) differ` : 'all cases match'); }
    if (out) fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 1));
  } catch (error) { console.log('ERROR', error.stack || error); } finally { await ctx.app.close().catch(() => {}); await server.close(); }
});
process.exit(exit);
