// Real-app extension API surface probe. Loads qa/extension-api-probe/extension (with a manifest that requests every permission Chromium
// offers Web Store extensions on Windows) into Acira on an isolated profile, then, from its service worker, an extension page and a
// content script, records every chrome.* / browser.* member and the result of the planned safe calls (1 s limit each; see plan.mjs).
// One app, one native slot (C:\ae\slot-N.lock, created with 'wx', removed in finally), bounded waits, closed in finally.
// Usage (cwd = repo, after npm run build):  node qa/extension-api-probe/run.mjs [--out <results.json>] [--root <short profile dir>]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from '../d-harness.mjs';
import {allPermissions, buildPlans, surface} from './plan.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// Where the run's copy of the probe extension is written (outside the repo by default).
const root = path.resolve(arg('--root') || path.join('C:/ae/r9/p', stamp));
const out = path.resolve(arg('--out') || path.join('qa/artifacts/extension-api-probe', stamp, 'results.json'));
const extDir = path.join(root, 'probe-extension');

async function takeSlot(name) {
  const slotRoot = process.platform === 'win32' ? 'C:/ae' : path.resolve('.qa-profiles/native-slots');
  await fs.mkdir(slotRoot, {recursive: true});
  for (let attempt = 0; attempt < 40; attempt++) {
    for (let n = 1; n <= 3; n++) {
      const file = path.join(slotRoot, `slot-${n}.lock`);
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`${name} ${new Date().toISOString()}\n`); await handle.close(); return file; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    console.log('all native slots busy; waiting 30 s');
    await sleep(30000);
  }
  throw Error('no native slot within 20 minutes');
}

const reports = {}, surfaces = {}, progress = {};
const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''; req.on('data', d => { body += d; if (body.length > 20e6) req.destroy(); });
      req.on('end', () => {
        try {
          const context = url.searchParams.get('context'), part = url.searchParams.get('part') || 'final', value = JSON.parse(body);
          if (part === 'final') reports[context] = value;
          else if (part === 'surface') surfaces[context] = value;
          else progress[context] = value;
        } catch {}
        res.end('ok');
      });
      return;
    }
    if (req.method === 'OPTIONS') { res.setHeader('access-control-allow-methods', 'POST'); res.setHeader('access-control-allow-headers', 'content-type'); res.end(); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset=utf-8><title>API probe fixture</title><h1>API probe fixture</h1><p>Plain page for the content-script probe.</p>');
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

// Build the extension folder for this run.
await fs.mkdir(extDir, {recursive: true});
const source = path.resolve('qa/extension-api-probe/extension');
for (const file of await fs.readdir(source)) await fs.copyFile(path.join(source, file), path.join(extDir, file));
const permissions = allPermissions();
const manifest = {
  manifest_version: 3, name: 'Acira API surface probe', version: '1.0', description: 'Records which extension APIs Acira exposes.',
  permissions, optional_permissions: [], host_permissions: ['<all_urls>'], optional_host_permissions: ['*://*/*'],
  background: {service_worker: 'sw.js'}, action: {default_title: 'API probe'}, options_ui: {page: 'page.html', open_in_tab: true},
  side_panel: {default_path: 'page.html'}, omnibox: {keyword: 'aciraprobe'}, commands: {probe: {description: 'Probe command'}},
  content_scripts: [{matches: ['http://127.0.0.1/*'], js: ['config.js', 'walk.js', 'cs.js'], run_at: 'document_idle'}],
  web_accessible_resources: [{resources: ['page.html'], matches: ['<all_urls>']}]
};
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const only = arg('--only'); // e.g. --only system: just that namespace family (the system.* survival check)
const plans = buildPlans({only});
await fs.writeFile(path.join(extDir, 'config.js'), `self.ACIRA_PROBE_CONFIG = ${JSON.stringify({server: base, plans})};\n`);
console.log(`permissions requested: ${permissions.length}; planned calls: ${Object.entries(plans).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);

const until = async (read, ms, every = 500) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };
let slot, app;
const result = {chromium: surface.chromium, started: new Date().toISOString(), permissionsRequested: permissions, plans, reports, notes: []};
try {
  slot = process.env.ACIRA_SLOT_HELD ? null : await takeSlot('extension-api-probe'); // ACIRA_SLOT_HELD=1: the caller (qa/native-slot.mjs) already holds the slot for a sequence of runs
  // d-harness keeps profiles under the repo's .qa-profiles; a short leaf name keeps Chromium's profile paths short.
  app = await startApp({root: path.resolve('.qa-profiles', 'xp' + Date.now().toString(36)), env: {ACIRA_DEV: '0'}, ...(process.platform === 'darwin' ? {main: path.resolve('qa/mac-interface-entry.cjs')} : {})});
  await app.main(({dialog}, folder) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
  }, extDir);
  const state = await app.state();
  const profileId = state.activeBrowserProfileId;
  const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
  const loaded = await ext({type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === manifest.name);
  result.load = {error: loaded.error || null, entry: entry || null, warnings: entry?.warnings || null};
  if (!entry) throw Error('probe extension did not load: ' + JSON.stringify(loaded).slice(0, 400));
  const id = entry.id, partition = (await app.state()).browserProfiles.find(p => p.id === profileId).partition;
  console.log('loaded', id);
  await app.main(({session}, p) => {
    globalThis.__probeSw = [];
    try { session.fromPartition(p).serviceWorkers.on('console-message', (_e, d) => globalThis.__probeSw.push(String(d.message).slice(0, 300))); } catch (e) { globalThis.__probeSw.push('listen failed ' + e); }
  }, partition);
  result.runtime = await app.main(({app}) => ({electron: process.versions.electron, chrome: process.versions.chrome, version: app.getVersion()}));
  // A web tab first (for tab/window ids and the content script).
  await app.act({type: 'tab.new', url: base + '/fixture'});
  result.contentScript = !!await until(() => reports.content_script, 30000);
  if (!result.contentScript) result.notes.push('content script report did not arrive in 30 s');
  // The extension page, in a hidden window of the profile's session (the way api-fixture opens its helper page).
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 500, height: 400, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__aciraProbePage = w; w.loadURL(args.url);
  }, {partition, url: `chrome-extension://${id}/page.html`});
  result.extensionPage = !!await until(() => reports.extension_page, 150000);
  if (!result.extensionPage) result.notes.push('extension page report did not arrive in time');
  result.serviceWorker = !!await until(() => reports.service_worker, 150000);
  if (!result.serviceWorker) result.notes.push('service worker report did not arrive in time');
  result.workers = await app.main(({session}, p) => { try { return {running: Object.values(session.fromPartition(p).serviceWorkers.getAllRunning()).map(w => w.scope), console: globalThis.__probeSw}; } catch (e) { return String(e); } }, partition);
  // The main process must still answer after every planned call (a native API that needs something Electron lacks ends it).
  await sleep(1500);
  result.mainAlive = await app.main(() => true).then(() => true, () => false);
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2000);
  console.error(result.error);
} finally {
  try { await app?.main(() => { try { globalThis.__aciraProbePage?.destroy(); } catch {} }); } catch {}
  try { await app?.close(); } catch {}
  server.close();
  if (slot) await fs.rm(slot, {force: true});
}
result.finished = new Date().toISOString();
result.surfaces = surfaces; result.progress = progress;
result.appLog = (app?.logs || []).join('').split(/\r?\n/).filter(line => /extension|chrome-extension|error|crash|fatal|permission|manifest|warning/i.test(line)).slice(-120);
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
const count = r => (r ? `${Object.keys(r.surface).length} members, ${Object.keys(r.calls).length} calls` : 'none');
console.log(`service worker: ${count(reports.service_worker)}; page: ${count(reports.extension_page)}; content script: ${count(reports.content_script)}`);
console.log('wrote', out);
console.log('main process alive after the calls:', result.mainAlive === true);
process.exitCode = reports.service_worker && reports.extension_page && result.mainAlive === true ? 0 : 1;
