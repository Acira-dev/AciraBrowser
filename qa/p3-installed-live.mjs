// runtime.onInstalled in the real app (P3): an unpacked extension gets reason "install" on its first load, "update" with previousVersion when its folder
// changed version and it is reloaded (and on a plain reload), "install" again after it is removed and loaded anew, and NOTHING when the app is restarted
// with the extension still installed; runtime.onStartup: never during those, exactly once after the restart. The worker starts lazily; the report is made from inside its onInstalled listener. One app per phase on one
// isolated profile (two launches of the same profile), one native slot, bounded waits, closed in finally.
// Usage (cwd = repo or a short path with the same layout):  node qa/p3-installed-live.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('C:/ae/p3/' + stamp);
const out = path.resolve('qa/artifacts/p3-runtime', `installed-${stamp}.json`);
const profile = path.resolve('.qa-profiles', 'pi' + Date.now().toString(36));
const reports = [];
const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => { try { reports.push({name: url.searchParams.get('name'), data: JSON.parse(body), at: Date.now()}); } catch {} res.end('ok'); });
      return;
    }
    res.statusCode = 404; res.end('no');
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = 'http://127.0.0.1:' + server.address().port;
const until = async (read, ms, every = 300) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };
const installed = () => reports.filter(r => r.name === 'i.onInstalled').map(r => ({...r.data.details, version: r.data.version}));
const dir = path.join(root, 'ext-i');
const writeVersion = async version => {
  const manifest = JSON.parse(await fs.readFile(path.resolve('qa/p3-runtime/ext-i/manifest.json'), 'utf8'));
  manifest.version = version;
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
};

const result = {started: new Date().toISOString(), steps: {}};
let app;
const open = async () => {
  app = await startApp({root: profile, env: {ACIRA_DEV: '0'}});
  await app.main(({dialog}) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [globalThis.__p3Folder]});
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
  });
  const profileId = (await app.state()).activeBrowserProfileId;
  app.profileId = profileId;
  app.ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
};
try {
  await (process.env.ACIRA_SLOT_HELD ? (work => work()) : work => withSlot('p3-installed-live', work))(async () => {
    await fs.mkdir(dir, {recursive: true});
    for (const file of await fs.readdir(path.resolve('qa/p3-runtime/ext-i'))) await fs.copyFile(path.resolve('qa/p3-runtime/ext-i', file), path.join(dir, file));
    await fs.writeFile(path.join(dir, 'config.js'), `self.P3 = ${JSON.stringify({server: base})};\n`);
    await writeVersion('1.0');
    await open();
    await app.main((_m, folder) => { globalThis.__p3Folder = folder; }, dir);
    const loaded = await app.ext({type: 'load'});
    const entry = (loaded.extensions || []).find(e => e.name === 'Acira P3 install probe');
    if (!entry) throw Error('did not load: ' + JSON.stringify(loaded).slice(0, 300));
    const id = entry.id;
    await app.act({type: 'tab.new', url: base + '/x'});   // a tab keeps the profile busy like a person's session
    // 1. first load
    await until(() => installed().length >= 1, 40000);
    await sleep(2500);
    result.steps.install = installed();
    // 2. the folder gets version 1.1, reload
    await writeVersion('1.1');
    const before = installed().length;
    await app.ext({type: 'reload', extensionId: id});
    await until(() => installed().length > before, 40000);
    await sleep(2500);
    result.steps.updateToNewVersion = installed().slice(before);
    // 3. plain reload (same version)
    const before2 = installed().length;
    await app.ext({type: 'reload', extensionId: id});
    await until(() => installed().length > before2, 40000);
    await sleep(2500);
    result.steps.reload = installed().slice(before2);
    // 4. remove, load again: install again
    const before3 = installed().length;
    await app.ext({type: 'remove', extensionId: id});
    await sleep(1500);
    await app.ext({type: 'load'});
    await until(() => installed().length > before3, 40000);
    await sleep(2500);
    result.steps.removedThenLoaded = installed().slice(before3);
    result.totalBeforeRestart = installed().length;
    await app.close(); app = null;
    // 6. the app starts again with the extension still installed: no onInstalled, only the worker's start
    const startedBefore = reports.filter(r => r.name === 'i.started').length;
    const startupsBefore = reports.filter(r => r.name === 'i.onStartup').length;   // none: install, update, reload and reinstall are not a startup
    await open();
    await until(() => reports.filter(r => r.name === 'i.started').length > startedBefore, 60000);
    await app.act({type: 'tab.new', url: base + '/y'});
    await sleep(8000);
    result.steps.restartWorkerStarted = reports.filter(r => r.name === 'i.started').length > startedBefore;
    result.steps.restartInstalled = installed().slice(result.totalBeforeRestart);
    result.steps.startupsBeforeRestart = startupsBefore;
    result.steps.startupsAfterRestart = reports.filter(r => r.name === 'i.onStartup').length - startupsBefore;
    result.mainAlive = await app.main(() => true).then(() => true, () => false);
  });
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2500);
  console.error(result.error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
}
result.reports = reports.map(r => [r.name, r.data]);
result.finished = new Date().toISOString();
const s = result.steps;
result.pass = !result.error && JSON.stringify(s.install) === JSON.stringify([{reason: 'install', version: '1.0'}])
  && JSON.stringify(s.updateToNewVersion) === JSON.stringify([{reason: 'update', previousVersion: '1.0', version: '1.1'}])
  && JSON.stringify(s.reload) === JSON.stringify([{reason: 'update', previousVersion: '1.1', version: '1.1'}])
  && JSON.stringify(s.removedThenLoaded) === JSON.stringify([{reason: 'install', version: '1.1'}])
  && s.restartWorkerStarted === true && Array.isArray(s.restartInstalled) && s.restartInstalled.length === 0
  && s.startupsBeforeRestart === 0 && s.startupsAfterRestart === 1;
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({pass: result.pass, steps: result.steps, error: result.error || null, mainAlive: result.mainAlive}, null, 1));
process.exitCode = result.pass ? 0 : 1;
