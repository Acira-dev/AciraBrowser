// P3 with a real Web Store extension: Vimium keeps its settings in chrome.storage.sync and reads them in its content scripts. A setting written from an
// extension page (the options page's own world) must reach the content script of a web page: the shim's sync area, storage.onChanged with areaName
// "sync", and the hint letters Vimium draws. Installs through Acira's own store path on an isolated profile; one app, try/finally.
// Run inside a native slot:  node qa/native-slot.mjs p3-vimium -- node qa/p3-real-sync.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, install, installedManifest, sleep} from './extension-matrix/lib.mjs';

const ID = 'dbepggeogbaibhgnhhndojpepiihcmeb';
const out = path.resolve('qa/artifacts/p3-runtime', `real-sync-${Date.now()}.json`);
const result = {started: new Date().toISOString(), steps: {}};
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><meta charset="utf-8"><title>P3 vimium</title><h1>P3 Vimium</h1><p><a href="/a">alpha</a> <a href="/b">beta</a> <a href="/c">gamma</a> <a href="/d">delta</a> <button>epsilon</button> <a href="/e">zeta</a></p><input id="t">');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
let app;
const hints = page => page.evaluate(() => {
  const found = [];
  const walk = root => {
    for (const el of root.querySelectorAll('*')) {
      if (/vimiumHintMarker/i.test(el.className && el.className.baseVal === undefined ? String(el.className) : '')) found.push((el.textContent || '').trim());
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return found.filter(Boolean);
});
try {
  app = await launch('p3-vimium');
  const installed = await install(app, ID);
  result.steps.install = {error: installed.error || null, name: installed.entry && installed.entry.name, ms: installed.ms};
  if (installed.error) throw Error('install failed: ' + installed.error);
  const manifest = (await installedManifest(app, ID)).manifest;
  result.steps.shimInManifest = (manifest.content_scripts || []).map(script => (script.js || [])[0]);
  const partition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
  // Vimium's content script asks its service worker for the key mappings as soon as it loads: wait until the worker runs, and keep its console.
  await app.main(({session}, p) => { globalThis.__p3Sw = []; session.fromPartition(p).serviceWorkers.on('console-message', (_e, d) => globalThis.__p3Sw.push(String(d.message).slice(0, 300))); }, partition);
  for (let i = 0; i < 60; i++) {
    const running = await app.main(({session}, p) => Object.values(session.fromPartition(p).serviceWorkers.getAllRunning()).map(w => w.scope), partition);
    if (running.some(scope => scope.includes(ID))) { result.steps.workerRunningAfterSeconds = i / 2; break; }
    await sleep(500);
  }
  await sleep(2000);
  await app.act({type: 'tab.new', url: base});
  const page = await app.waitWeb(url => url.startsWith(base), 'fixture page');
  await sleep(3000);
  result.steps.pageErrors = [];
  const watch = p => { p.on('console', message => { if (message.type() === 'error') result.steps.pageErrors.push(message.text().slice(0, 300)); }); p.on('pageerror', error => result.steps.pageErrors.push(String(error).slice(0, 300))); };
  watch(page);
  // Vimium's content script may still be starting when the machine is busy: try the hint key a few times.
  const press = async () => {
    let found = [];
    for (let attempt = 0; attempt < 4 && !found.length; attempt++) {
      await page.bringToFront().catch(() => {}); await page.click('h1').catch(() => {}); await page.keyboard.press('Escape').catch(() => {});
      await page.keyboard.press('f'); await sleep(1800); found = await hints(page); await page.keyboard.press('Escape').catch(() => {});
    }
    return found;
  };
  result.steps.defaultHints = await press();
  // An extension page (a hidden window of the same profile session) writes Vimium's setting into storage.sync, as its options page does.
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 600, height: 400, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__p3VimiumPage = w; w.loadURL(args.url);
  }, {partition, url: `chrome-extension://${ID}/pages/options.html`});
  await sleep(4000);
  const written = await app.main(async ({webContents}, id) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(`chrome-extension://${id}/`) && !w.isDestroyed());
    if (!wc) return {error: 'options page not found'};
    return wc.executeJavaScript(`(async () => {
      const before = await chrome.storage.sync.get(null);
      await chrome.storage.sync.set({linkHintCharacters: 'xyzw', settingsVersion: chrome.runtime.getManifest().version}); // Vimium 2.x format: plain values
      const after = await chrome.storage.sync.get(null);
      const local = await chrome.storage.local.get(null);
      return {syncKeysBefore: Object.keys(before).length, hintCharacters: after.linkHintCharacters, localKeys: Object.keys(local).filter(k => k.startsWith('__acira')), quota: chrome.storage.sync.QUOTA_BYTES};
    })()`).catch(error => ({error: String(error)}));
  }, ID);
  result.steps.written = written;
  await sleep(2000);
  result.steps.hintsAfterWrite = await press();
  const letters = [...new Set(result.steps.hintsAfterWrite.join('').toUpperCase())];
  result.steps.hintLettersAfterWrite = letters.join('');
  result.steps.reachedContentScript = letters.length > 0 && letters.every(letter => 'XYZW'.includes(letter));
  // A fresh content script reads the same sync area when the page loads (no event needed).
  await page.reload().catch(() => {});
  await sleep(4000);
  result.steps.hintsAfterReload = await press();
  const reloaded = [...new Set(result.steps.hintsAfterReload.join('').toUpperCase())];
  result.steps.reachedOnReload = reloaded.length > 0 && reloaded.every(letter => 'XYZW'.includes(letter));
  result.steps.defaultLettersLookDefault = result.steps.defaultHints.length > 0 && !result.steps.defaultHints.join('').toUpperCase().split('').every(letter => 'XYZW'.includes(letter));
  result.steps.workerConsole = await app.main(() => globalThis.__p3Sw || []).catch(() => []);
  result.mainAlive = await app.main(() => true).then(() => true, () => false);
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2000);
  console.error(result.error);
} finally {
  try { await app?.main(() => { try { globalThis.__p3VimiumPage?.destroy(); } catch {} }); } catch {}
  try { await app?.close(); } catch {}
  server.close();
}
result.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
process.exitCode = result.error ? 1 : 0;
