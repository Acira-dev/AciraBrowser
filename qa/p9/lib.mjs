// Shared helpers for the P9 extension-API rigs (capture, devtools, debugger, identity, tts, system): one isolated profile, one app, a
// native slot (qa/native-slot.mjs) held for the run, everything closed in finally. Extensions load unpacked through Acira's own path
// (window.acira.extensions({type: 'load'}), the folder dialog answered) or install from the Web Store into the isolated profile.
import http from 'node:http';
import {rmSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {install, sleep, answerAppDialogs} from '../extension-matrix/lib.mjs';
import {startApp} from '../d-harness.mjs';
import {takeSlot, releaseSlot} from '../native-slot.mjs';
export {sleep, install};

export const until = async (read, ms, every = 300) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await read(); if (v) return v; } catch {} await sleep(every); } return null; };

/** A local fixture server: handler(req, res, url) answers or returns false for the default page. Reports POSTed to /report?k=... land in `reports`. */
export async function fixtureServer(handler = () => false) {
  const reports = {};
  const server = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('access-control-allow-origin', '*');
      if (req.method === 'OPTIONS') { res.setHeader('access-control-allow-methods', 'POST, GET'); res.setHeader('access-control-allow-headers', 'content-type'); res.end(); return; }
      if (req.method === 'POST' && url.pathname === '/report') {
        let body = ''; req.on('data', d => { body += d; if (body.length > 5e6) req.destroy(); });
        req.on('end', () => { try { (reports[url.searchParams.get('k') || 'x'] ||= []).push(JSON.parse(body)); } catch {} res.end('ok'); });
        return;
      }
      if (handler(req, res, url) !== false) return;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset=utf-8><title>P9 fixture</title><style>html,body{margin:0;height:100%;background:#e0218a}</style><h1 style="color:#fff;font:48px sans-serif;margin:40px">P9 fixture</h1>');
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {server, reports, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close()};
}

/** Loads an unpacked extension folder through Acira's own "Load unpacked" path. Returns its id. */
export async function loadUnpacked(app, folder) {
  await app.main(({dialog}, dir) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); }, folder);
  const loaded = await app.ext({type: 'load'});
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
  const entry = (loaded.extensions || []).find(e => e.name === manifest.name);
  if (!entry) throw Error('extension did not load: ' + JSON.stringify(loaded).slice(0, 400));
  return entry.id;
}

/** Copies a fixture folder to a fresh run folder (with an optional config.js) and returns the copy's path. */
export async function stageFixture(source, root, config) {
  const dir = path.join(root, path.basename(source) + '-' + Date.now().toString(36));
  await fs.mkdir(dir, {recursive: true});
  for (const file of await fs.readdir(source)) await fs.copyFile(path.join(source, file), path.join(dir, file));
  if (config) await fs.writeFile(path.join(dir, 'config.js'), `self.P9_CONFIG = ${JSON.stringify(config)};\n`);
  return dir;
}

export const partitionOf = async app => (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;

/** Clicks an extension's toolbar button the way the toolbar does (the engine's browserAction.activate with a click on that tab). */
export async function clickAction(app, id, tabId) {
  const partition = await partitionOf(app);
  return app.main(({session}, args) => {
    const ext = process.mainModule.require(args.module).ElectronChromeExtensions.fromSession(session.fromPartition(args.partition));
    return ext.ctx.router.handlers.get('browserAction.activate').callback({type: 'frame', sender: null}, {eventType: 'click', extensionId: args.id, tabId: args.tabId});
  }, {partition, id, tabId, module: path.resolve('node_modules/electron-chrome-extensions')});
}

/** Runs `work(app)` on a fresh isolated profile (a short folder under .qa-profiles: Chromium's profile paths stay under MAX_PATH from
 *  this deep worktree) with a native slot; closes everything after. */
export async function withApp(name, work, {env = {}, args = []} = {}) {
  const slot = await takeSlot('p9-' + name);
  // A crash of the rig itself (an unhandled rejection after the app died) must not leave the slot held for everybody else.
  const freeSlot = () => { try { rmSync(slot, {force: true}); } catch {} };
  process.on('exit', freeSlot);
  let app;
  try {
    app = await startApp({root: path.resolve('.qa-profiles', 'p9' + Date.now().toString(36)), env: {ACIRA_DEV: '0', ...env}, args});
    await app.main(({dialog}) => {
      globalThis.__reviews = [];
      dialog.showMessageBox = async (...a) => { const o = a.at(-1) || {}; globalThis.__reviews.push({title: o.title, message: o.message}); return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    });
    await app.main(answerAppDialogs);
    app.profileId = (await app.state()).activeBrowserProfileId;
    app.ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId: app.profileId, ...request});
    try { return await work(app); } catch (error) { console.log('APP LOG TAIL', (app.logs || []).join('').slice(-3500)); throw error; }
  } finally {
    try { await app?.close(); } catch {}
    await releaseSlot(slot);
  }
}

export async function writeResult(name, value) {
  const dir = path.resolve('qa/artifacts/p9'); await fs.mkdir(dir, {recursive: true});
  const file = path.join(dir, name + '.json'); await fs.writeFile(file, JSON.stringify(value, null, 1)); return file;
}
