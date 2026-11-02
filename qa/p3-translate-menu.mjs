// P3 with a real Web Store extension: Google Translate creates its context-menu item in runtime.onInstalled. Electron never fired onInstalled, so the item
// never existed; now it must exist right after the install, and show up in Acira's page menu for a selection. Installs through Acira's own store path on an
// isolated profile. One app, one native slot, bounded waits, closed in finally.
// Usage (short path, see qa/p3-runtime-live.mjs notes):  ACIRA_EXT_MATRIX_RUN=p3t node qa/p3-translate-menu.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, install, sleep} from './extension-matrix/lib.mjs';
import {httpFixture, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const ID = 'aapbdbdomjkkjkaonfhkkikfgjllcleb';
const out = path.resolve('qa/artifacts/p3-runtime', `translate-menu-${Date.now()}.json`);
const result = {started: new Date().toISOString(), steps: {}};
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><title>P3 translate</title><h1>Selected words for translation</h1><p>Bonjour tout le monde</p>'); });
const base = `http://127.0.0.1:${fx.port}`;
let app;
try {
  await (process.env.ACIRA_SLOT_HELD ? (work => work()) : work => withSlot('p3-translate-menu', work))(async () => {
    app = await launch('p3-translate');
    await app.main(({session}, p) => { globalThis.__swLog = []; session.fromPartition(p).serviceWorkers.on('console-message', (_e, d) => globalThis.__swLog.push(String(d.message).slice(0, 200))); }, (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition);
    let installed;
    for (let attempt = 1; attempt <= 3; attempt++) { installed = await install(app, ID); if (!installed.error) break; result.steps['installAttempt' + attempt] = installed.error; await sleep(4000); }
    result.steps.install = {error: installed.error || null, name: installed.entry && installed.entry.name, version: installed.entry && installed.entry.version};
    if (installed.error) throw Error('install failed: ' + installed.error);
    const dump = () => app.main(() => {
      const bridge = (suffix => Object.values(process.mainModule.constructor._cache).find(m => m.filename.replace(/\\/g, '/').endsWith(suffix)).exports)('/ext-api/surfaces/bridge.cjs');
      return bridge.all('context-menus').map(e => { const store = e.controller.store; return store.extensions().map(id => [id, store.list(id).map(i => [i.id, i.title, (i.contexts || []).join('+')])]); });
    });
    // The worker starts lazily after the install; its onInstalled listener creates the menu.
    const items = await poll(async () => { const d = (await dump()).flat().filter(([id]) => id === ID); return d.length && d[0][1].length ? d[0][1] : null; }, Boolean, 'menu items of Google Translate', 45000).catch(() => null);
    result.steps.itemsRightAfterInstall = items;
    await app.act({type: 'tab.new', url: base + '/'});
    await app.waitWeb(base + '/');
    await sleep(1500);
    const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
    await app.main(({webContents}, url) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(url)); wc.emit('context-menu', {preventDefault() {}}, {x: 40, y: 40, pageURL: wc.getURL(), frameURL: '', editFlags: {}, mediaFlags: {}, selectionText: 'Selected words for translation'}); }, base + '/');
    const overlay = await poll(async () => { const l = await layout(); return l?.overlay?.kind === 'page-context' ? l.overlay : null; }, Boolean, 'page menu', 6000).catch(() => null);
    result.steps.pageMenuExtensionRows = overlay ? (overlay.context?.items || []).filter(i => i.id?.startsWith('ext:')).map(i => i.label) : null;
    result.steps.workerConsole = (await app.main(() => globalThis.__swLog || [])).filter(line => /contextMenus|lastError|nstalled|rror/i.test(line)).slice(0, 8);
    result.mainAlive = await app.main(() => true).then(() => true, () => false);
  });
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2500);
  console.error(result.error);
} finally {
  try { await app?.close(); } catch {}
  await fx.close();
}
result.pass = !result.error && Array.isArray(result.steps.itemsRightAfterInstall) && result.steps.itemsRightAfterInstall.length > 0 && Array.isArray(result.steps.pageMenuExtensionRows) && result.steps.pageMenuExtensionRows.length > 0;
result.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
process.exitCode = result.pass ? 0 : 1;
