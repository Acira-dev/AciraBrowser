// Chrono Download Manager's popup "OPEN MANAGER" on the real app (found by P7). Chrono opens its manager in one of two ways, chosen by its option
// "Open downloads manager as standalone window" (default ON):
//   ON  -> chrome.windows.create({url: <its ui/index.html>, type: 'popup', focused: true})            (windows: P2's)
//   OFF -> windows.getCurrent(cb), tabs.query({url}), chrome.tabs.create({active: true, url: <its ui/index.html>})   (tabs: P1)
// This script presses the button in both settings and reports which one opens the page. Web Store install into an isolated profile.
//   cd C:\ae\p1w && ACIRA_EXT_MATRIX_RUN=p1m node qa/extension-api-probe/tabs-chrono-open-manager.mjs      (short path: MAX_PATH)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, install, sleep} from '../extension-matrix/lib.mjs';
import {withSlot} from '../native-slot.mjs';

const ID = 'mciiogijehkdemklbdcbfkefimifhecn';
const checks = [];
const check = (name, ok, detail) => { checks.push({name, ok: !!ok, detail}); console.log((ok ? 'PASS ' : 'INFO ') + name + (ok ? '' : '  ' + String(JSON.stringify(detail)).slice(0, 400))); };
const until = async (read, ms, every = 400) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };
const server = await new Promise(resolve => { const s = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Chrono fixture</title><body><h1>page</h1>'); }); s.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
let app;
try {
  await withSlot('p1-chrono-open-manager', async () => {
    app = await launch('p' + (Date.now() % 100000).toString(36), {env: {}});
    const installed = await install(app, ID);
    check('Chrono installs from the Web Store', !installed.error && installed.entry, installed);
    if (installed.error) return;
    await app.ext({type: 'pin', extensionId: ID, pinned: true}).catch(() => {});
    await app.act({type: 'tab.new', url: base + '/page'});   // the toolbar shows extension buttons on a web page
    await until(async () => (await app.state()).tabs.some(t => t.url.startsWith(base) && !t.loading), 20000);
    await sleep(1500);
    const partition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
    await app.main(({app: electronApp, session}, p) => { const target = session.fromPartition(p); electronApp.on('browser-window-created', (_e, window) => { if (window.webContents?.session !== target || globalThis.__extHelper === window) return; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.show = () => {}; window.showInactive = () => {}; window.focus = () => {}; }); }, partition);
    const pages = () => app.context.pages().filter(page => { try { return page.url().startsWith(`chrome-extension://${ID}/`); } catch { return false; } });
    const manager = () => pages().find(page => page.url().includes('/ui/index.html'));
    const openPopupAndPress = async () => {
      await app.ui.locator('.native-extension-actions:visible browser-action-list button.action').first().click({timeout: 15000});
      const popup = await until(() => pages().find(page => page.url().includes('/pop/')), 15000, 300);
      if (!popup) return null;
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(3000);
      await popup.getByText(/open manager/i).first().click({timeout: 8000});
      return popup;
    };

    // ON (the default): windows.create with an extension page
    const popupOn = await openPopupAndPress();
    check('the popup opened and OPEN MANAGER was pressed (standalone-window mode, the default)', !!popupOn, 'no popup');
    const openedOn = await until(manager, 8000);
    console.log(openedOn ? 'standalone-window mode: the manager opened' : 'standalone-window mode: nothing opened (windows.create path)');
    checks.push({name: 'standalone-window mode (windows.create) opens the manager', ok: !!openedOn, info: true});
    await sleep(1500);

    // OFF: tabs.create with an extension page. The option lives on Chrono's options page.
    await app.main(({BrowserWindow, session}, args) => {
      const w = new BrowserWindow({show: false, width: 900, height: 700, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
      globalThis.__extHelper = w; w.loadURL(args.url);
    }, {partition, url: `chrome-extension://${ID}/ui/options.html`});
    const options = await until(() => pages().find(page => page.url().includes('/ui/options.html')), 15000, 300);
    check('Chrono\'s options page opens', !!options, pages().map(p => p.url()));
    if (!options) return;
    await sleep(2500);
    const toggled = await options.evaluate(() => {
      const row = [...document.querySelectorAll('label, div, li, td')].find(el => /standalone window/i.test(el.textContent || '') && el.querySelector('input[type=checkbox]') && (el.textContent || '').length < 160);
      const box = row && row.querySelector('input[type=checkbox]');
      if (!box) return {found: false};
      const before = box.checked; if (before) (box.closest('label') || box).click();
      return {found: true, before, after: box.checked};
    });
    console.log('toggle:', JSON.stringify(toggled));
    check('the "standalone window" option is switched off', toggled.found && toggled.after === false, toggled);
    await sleep(3500);   // Chrono saves the option to chrome.storage a moment after the click
    await app.main(() => { try { globalThis.__extHelper?.destroy(); } catch { /* gone */ } });
    await sleep(800);
    for (const page of pages().filter(page => page !== manager())) await page.close().catch(() => {});
    if (manager()) await manager().close().catch(() => {});
    await sleep(1000);

    await app.ext({type: 'reload', extensionId: ID}).catch(error => console.log('reload failed', String(error.message || error).slice(0, 120)));   // its worker reads the saved option again
    await sleep(4000);
    const popupOff = await openPopupAndPress();
    check('the popup opened and OPEN MANAGER was pressed (tab mode)', !!popupOff, 'no popup');
    const openedOff = await until(manager, 12000);
    check('tab mode (tabs.create with the extension page) opens the manager', !!openedOff, {pages: pages().map(p => p.url())});
    check('main process alive', await app.main(() => true).then(() => true, () => false));
  });
} catch (error) {
  check('run finished without an exception', false, String(error && error.stack || error).slice(0, 600));
} finally {
  try { await app?.close(); } catch { /* closing */ }
  server.close(); server.closeAllConnections?.();
}
const out = path.resolve('qa/artifacts/extension-api-probe', `tabs-chrono-${Date.now().toString(36)}.json`);
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify({checks}, null, 1));
console.log('wrote', out);
process.exitCode = checks.filter(c => !c.ok && !c.info).length ? 1 : 0;
