// storage.onChanged in an MV3 service worker with NO extension page open (P3): Chromium never delivers it to a worker in Electron, so the worker is told by
// its own write wrappers, by content scripts (the storage shim sends what it hears) and by the main process' relay of extension pages. This run has no popup or
// options page at all. The worker (qa/p3-runtime/ext-w) logs every event it hears: (a) its own writes to local, sync and session, (b) a content script's
// writes to local and sync. Each must arrive exactly once, with the right areaName and old/new values, on the root event and on the per-area event.
// One app, one native slot, isolated profile, bounded waits, closed in finally.   node qa/p3-worker-events.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const {applyStorageSyncShim} = createRequire(import.meta.url)('../desktop/browser-services/extension-shims.cjs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('C:/ae/p3/' + stamp);
const out = path.resolve('qa/artifacts/p3-runtime', `worker-events-${stamp}.json`);
const reports = [];
const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => { try { reports.push({name: url.searchParams.get('name'), data: JSON.parse(body)}); } catch {} res.end('ok'); });
      return;
    }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>P3 worker events</title><h1>page</h1>');
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = 'http://127.0.0.1:' + server.address().port;
const until = async (read, ms, every = 300) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };
const named = name => reports.filter(r => r.name === name).map(r => r.data);
const result = {started: new Date().toISOString(), steps: {}};
let app;
try {
  await (process.env.ACIRA_SLOT_HELD ? (work => work()) : work => withSlot('p3-worker-events', work))(async () => {
    const dir = path.join(root, 'ext-w');
    await fs.mkdir(dir, {recursive: true});
    for (const file of await fs.readdir(path.resolve('qa/p3-runtime/ext-w'))) await fs.copyFile(path.resolve('qa/p3-runtime/ext-w', file), path.join(dir, file));
    await fs.writeFile(path.join(dir, 'config.js'), `self.P3 = ${JSON.stringify({server: base})};\n`);
    result.steps.shimApplied = applyStorageSyncShim(dir);   // as for a Chrome Web Store package
    app = await startApp({root: path.resolve('.qa-profiles', 'pw' + Date.now().toString(36)), env: {ACIRA_DEV: '0'}});
    await app.main(({dialog}, folder) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
      dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    }, dir);
    const profileId = (await app.state()).activeBrowserProfileId;
    const loaded = await app.ui.evaluate(request => window.acira.extensions(request), {profileId, type: 'load'});
    const entry = (loaded.extensions || []).find(e => e.name === 'Acira P3 worker events');
    if (!entry) throw Error('did not load: ' + JSON.stringify(loaded).slice(0, 300));
    // The worker starts lazily: a tab keeps the profile busy like a person's session (it has no page of the extension).
    await app.act({type: 'tab.new', url: base.replace('127.0.0.1', 'localhost') + '/warm'});   // not a match of the content script
    await until(() => named('w.started').length, 60000);
    // (a) its own writes, with no page and no content script of the extension alive yet
    await until(() => named('w.ownWritesDone').length, 30000);
    await sleep(1500);
    result.steps.afterOwnWrites = reports.filter(r => r.name === 'w.event').length;
    // (b) the page whose content script writes
    await app.act({type: 'tab.new', url: base + '/cs'});
    await until(() => named('w.csDone').length, 60000);
    await sleep(2500);
    result.steps.extensionPages = await app.main(({webContents}, id) => webContents.getAllWebContents().filter(wc => !wc.isDestroyed() && wc.getURL().startsWith('chrome-extension://' + id + '/')).map(wc => wc.getURL()), entry.id);
    result.mainAlive = await app.main(() => true).then(() => true, () => false);
  });
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2500);
  console.error(result.error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
}
result.csShim = (named('w.csDone')[0] || {}).shim;
const events = named('w.event');
const change = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort()));   // {oldValue, newValue} in a fixed order
const summarize = via => events.filter(e => e.via === via).map(e => `${e.area}:${Object.keys(e.changes).sort().join(',')}:[${Object.keys(e.changes).sort().map(key => change(e.changes[key])).join(',')}]`);
result.root = summarize('root'); result.localArea = summarize('local-area'); result.syncArea = summarize('sync-area'); result.sessionArea = summarize('session-area');
const expectRoot = [
  'local:ownLocal:[{"newValue":1}]', 'sync:ownSync:[{"newValue":1}]', 'session:ownSession:[{"newValue":1}]', 'local:ownLocal:[{"newValue":2,"oldValue":1}]',
  'local:csLocal:[{"newValue":"x"}]', 'sync:csSync:[{"newValue":"y"}]', 'local:csLocal:[{"newValue":"z","oldValue":"x"}]', 'local:csLocal:[{"oldValue":"z"}]'
];
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
result.checks = {
  noExtensionPage: Array.isArray(result.steps.extensionPages) && result.steps.extensionPages.length === 0,
  ownWritesHeard: result.steps.afterOwnWrites >= 4,
  rootExactlyOnce: sameSet(result.root, expectRoot),
  localAreaExactlyOnce: sameSet(result.localArea, expectRoot.filter(x => x.startsWith('local:'))),
  syncAreaExactlyOnce: sameSet(result.syncArea, expectRoot.filter(x => x.startsWith('sync:'))),
  sessionAreaExactlyOnce: sameSet(result.sessionArea, expectRoot.filter(x => x.startsWith('session:'))),
  shimWasOn: result.csShim === true
};
result.pass = !result.error && Object.values(result.checks).every(Boolean);
result.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify({...result, reports}, null, 1));
console.log(JSON.stringify({pass: result.pass, checks: result.checks, root: result.root, syncArea: result.syncArea, error: result.error || null, mainAlive: result.mainAlive}, null, 1));
process.exitCode = result.pass ? 0 : 1;
