// P3 live check (storage + runtime + extension.*) in the real app on an isolated profile: two unpacked test extensions (qa/p3-runtime/ext-a, ext-b)
// and a local page exercise sync quotas/areas/onChanged, managed, setUninstallURL (opened on removal), openOptionsPage, getContexts,
// requestUpdateCheck, extension-to-extension and web-page-to-extension messaging (externally_connectable). One app, one native slot, try/finally.
// Usage (cwd = repo, after npm run build:runtime + vite build):  node qa/p3-runtime-live.mjs [--out <results.json>]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';
import {createRequire} from 'node:module';
const {applyStorageSyncShim} = createRequire(import.meta.url)('../desktop/browser-services/extension-shims.cjs');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('C:/ae/p3/' + stamp);
const out = path.resolve(arg('--out') || path.join('qa/artifacts/p3-runtime', stamp + '.json'));
const reports = {}, hits = [];

const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => { try { const v = JSON.parse(body); const name = url.searchParams.get('name'); (reports[name] = reports[name] || []).push(v); } catch {} res.end('ok'); });
      return;
    }
    if (url.pathname === '/page') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><meta charset="utf-8"><title>P3 page</title><body>P3 external page<script>
const B = new URL(location.href).searchParams.get('b');
const report = (name, data) => fetch('/report?name=' + name, {method: 'POST', body: JSON.stringify(data === undefined ? null : data)});
(async () => {
  const out = {hasChrome: typeof chrome, hasRuntime: !!(window.chrome && chrome.runtime), hasSendMessage: !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage), id: window.chrome && chrome.runtime && chrome.runtime.id};
  try { out.send = await new Promise((resolve, reject) => { chrome.runtime.sendMessage(B, {fromPage: true}, r => { const e = chrome.runtime.lastError; e ? reject(new Error(e.message)) : resolve(r); }); setTimeout(() => reject(new Error('timeout')), 5000); }); } catch (e) { out.sendError = String(e && e.message || e); }
  try { out.connect = await new Promise((resolve, reject) => { const port = chrome.runtime.connect(B, {name: 'page-port'}); port.onMessage.addListener(m => { resolve(m); port.disconnect(); }); port.onDisconnect.addListener(() => { const e = chrome.runtime.lastError; if (e) reject(new Error(e.message)); }); port.postMessage({pagePing: 1}); setTimeout(() => reject(new Error('timeout')), 5000); }); } catch (e) { out.connectError = String(e && e.message || e); }
  report('page.external', out);
})();
</script>`);
      return;
    }
    if (url.pathname === '/uninstalled') { hits.push(url.pathname); res.setHeader('content-type', 'text/html'); res.end('<title>uninstalled</title>bye'); return; }
    res.statusCode = 404; res.end('not found');
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = 'http://127.0.0.1:' + server.address().port;
const until = async (read, ms, every = 400) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };

async function copyExtension(name, config) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, {recursive: true});
  for (const file of await fs.readdir(path.resolve('qa/p3-runtime', name))) await fs.copyFile(path.resolve('qa/p3-runtime', name, file), path.join(dir, file));
  await fs.writeFile(path.join(dir, 'config.js'), `self.P3 = ${JSON.stringify(config)};\n`);
  return dir;
}

const result = {started: new Date().toISOString(), base, notes: []};
let app;
try {
  // ACIRA_SLOT_HELD=1: a caller (qa/native-slot.mjs ... -- <script>) already holds the native slot for a sequence of runs.
  await (process.env.ACIRA_SLOT_HELD ? (work => work()) : work => withSlot('p3-runtime-live', work))(async () => {
    app = await startApp({root: path.resolve('.qa-profiles', 'p3' + Date.now().toString(36)), env: {ACIRA_DEV: '0'}});
    let folder = null;
    await app.main(({dialog}) => {
      globalThis.__p3Folder = null;
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [globalThis.__p3Folder]});
      dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    });
    const profileId = (await app.state()).activeBrowserProfileId;
    const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
    const load = async (dir, name) => {
      await app.main((_m, dir) => { globalThis.__p3Folder = dir; }, dir);
      const loaded = await ext({type: 'load'});
      const entry = (loaded.extensions || []).find(e => e.name === name);
      if (!entry) throw Error('did not load ' + name + ': ' + JSON.stringify(loaded).slice(0, 400));
      return entry;
    };
    const dirB = await copyExtension('ext-b', {server: base});
    const b = await load(dirB, 'Acira P3 receiver');
    result.b = {id: b.id, warnings: b.warnings || null};
    await until(() => reports['b.started'], 30000);
    const dirA = await copyExtension('ext-a', {server: base, b: b.id});
    result.shimApplied = applyStorageSyncShim(dirA); // as for a Chrome Web Store package
    const a = await load(dirA, 'Acira P3 probe');
    result.a = {id: a.id, warnings: a.warnings || null};
    // A web tab first (so there is a window with a tab), then the page that talks to B.
    await app.act({type: 'tab.new', url: base + '/page?b=' + b.id});
    await until(() => reports['page.external'], 40000);
    await until(() => reports['a.sw'], 90000);
    await until(() => reports['cs.report'], 60000);
    await sleep(1500);
    result.extensionPages = await app.main(({webContents}, id) => webContents.getAllWebContents().filter(wc => !wc.isDestroyed() && wc.getURL().startsWith('chrome-extension://' + id + '/')).map(wc => ({url: wc.getURL(), type: wc.getType()})), a.id);
    result.tabsBeforeRemove = ((await app.state()).tabs || []).map(t => t.url).filter(Boolean);
    // Removing A opens the uninstall URL it registered.
    result.removeA = await ext({type: 'remove', extensionId: a.id}).then(r => ({ok: !r.error, error: r.error || null}), e => ({error: String(e)}));
    await until(() => hits.length, 15000);
    result.uninstallHits = hits.slice();
    result.tabsAfterRemove = (await app.state()).tabs?.map(t => t.url).filter(Boolean);
    result.mainAlive = await app.main(() => true).then(() => true, () => false);
  });
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 3000);
  console.error(result.error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
}
result.reports = reports;
result.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
console.log('wrote', out);
console.log(JSON.stringify(result, null, 1).slice(0, 12000));
process.exitCode = result.error ? 1 : 0;
