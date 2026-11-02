// Real-extension proof of chrome.system.display (P9): Tab Resize (Chrome Web Store, installed into an isolated profile) builds its monitor
// picker from system.display.getInfo; before, its layouts failed with "System display API is not available."
// The popup page is opened in a hidden window of the rig in the extension's own session (like the toolbar popup).
// Usage: node qa/p9/tabresize-live.mjs   (after the build; takes a native slot; needs the network for the Web Store install)
import {withApp, install, partitionOf, until, sleep, writeResult} from './lib.mjs';

const TAB_RESIZE = 'bkpenclhmiealbebdopglffmfdiilejc';
const results = {checks: {}};
const check = (name, ok, detail) => { results.checks[name] = {ok: !!ok, detail}; console.log((ok ? 'PASS ' : 'FAIL ') + name, JSON.stringify(detail).slice(0, 500)); };

try {
  await withApp('tabresize', async app => {
    const installed = await install(app, TAB_RESIZE);
    check('Tab Resize installs from the Web Store', !installed.error, {ms: installed.ms, error: installed.error, permissions: installed.entry && installed.entry.permissions});
    if (installed.error) throw Error('install failed: ' + installed.error);
    const partition = await partitionOf(app);
    const electronDisplays = await app.main(({screen}) => screen.getAllDisplays().map(d => ({id: d.id, w: d.workArea.width, h: d.workArea.height})));
    const popupUrl = `chrome-extension://${TAB_RESIZE}/index.html`, previous = new Set(app.context.pages());
    await app.main(({BrowserWindow, session}, args) => {
      const w = new BrowserWindow({show: false, width: 800, height: 600, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
      globalThis.__popup = w; w.webContents.on('console-message', (e, level, message) => { (globalThis.__popupLog ||= []).push(String(message).slice(0, 200)); }); w.loadURL(args.url);
    }, {partition, url: popupUrl});
    const popup = await until(async () => app.context.pages().find(p => { try { return !previous.has(p) && p.url() === popupUrl; } catch { return false; } }), 15000, 300);
    check('the popup page opens', !!popup, {});
    if (!popup) throw Error('no popup page');
    await sleep(1500);
    const direct = await popup.evaluate(async () => { const list = await chrome.system.display.getInfo(); return {count: list.length, primary: list[0] && list[0].isPrimary, workArea: list[0] && list[0].workArea, enabled: list[0] && list[0].isEnabled}; });
    check('system.display.getInfo answers from the page', direct.count === electronDisplays.length && direct.primary === true && direct.enabled === true && direct.workArea.width === electronDisplays.find(d => true).w, {direct, electronDisplays});
    const entries = await until(async () => { const n = await popup.evaluate(() => document.querySelectorAll('#display-setting-layer .display-entry').length); return n || null; }, 8000, 400);
    check('Tab Resize draws one monitor entry per display', entries === electronDisplays.length, {entries, displays: electronDisplays.length});
    const layouts = await popup.evaluate(() => document.querySelectorAll('.layout-entry, [data-layout], .layout').length);
    results.layoutElements = layouts;
    const log = await app.main(() => globalThis.__popupLog || []);
    check('no "System display API is not available" in the popup', !log.some(line => /System display API/.test(line)), log.slice(0, 5));
    const shot = await app.main(async () => { const image = await globalThis.__popup.webContents.capturePage(); return image.isEmpty() ? null : image.toPNG().toString('base64'); });
    if (shot) { const fs = await import('node:fs/promises'); await fs.mkdir('qa/artifacts/p9', {recursive: true}); await fs.writeFile('qa/artifacts/p9/tab-resize-popup.png', Buffer.from(shot, 'base64')); }
    await app.main(() => { try { globalThis.__popup.destroy(); } catch {} });
  });
} catch (error) {
  console.log('ERROR', error && error.stack || error); results.error = String(error && error.message || error);
} finally {
  const failed = Object.entries(results.checks).filter(([, c]) => !c.ok).map(([n]) => n);
  results.failed = failed;
  console.log(failed.length || results.error ? `DONE with ${failed.length} failing: ${failed.join('; ')}` : 'DONE all pass');
  await writeResult('tabresize-live', results);
  process.exit(0);
}
