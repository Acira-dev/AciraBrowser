// R3-12 evidence: the protection popup with the "Block pop-up ads on this site" switch, and the "Pop-up ad blocked." toast, in light and dark.
//   node qa/r3-popup-ads-capture.mjs   (cwd = worktree root). PNGs go to C:\ae\r3\privacy\evidence. Needs a visible window (the popup is a real overlay).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

async function withSlot(name, fn) {
  const until = Date.now() + 20 * 60 * 1000; let held = null;
  while (!held && Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, `${name} ${new Date().toISOString()}`); fs.closeSync(fd); held = file; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!held) await sleep(30000);
  }
  if (!held) throw new Error('No native slot became free in 20 minutes.');
  try { return await fn(); } finally { try { fs.unlinkSync(held); } catch {} }
}
const root = path.resolve('.qa-profiles/r3-popup-capture');
fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
const evidence = 'C:/ae/r3/privacy/evidence'; fs.mkdirSync(evidence, {recursive: true});
let PORT = 0;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><meta charset=utf-8><title>Test streaming page</title><body style="font:16px system-ui;padding:24px"><h2>Test streaming page</h2><button id=ad style="width:420px;height:44px;font-size:16px" onclick="window.open('http://popads.net:${PORT}/ad','_blank')">Play</button>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
PORT = server.address().port;
const ORIGIN = `http://streamtest.com:${PORT}`;

await withSlot('privacy-r3-popup-capture', async () => {
  const app = await startApp({root, args: ['--host-resolver-rules=MAP streamtest.com 127.0.0.1, MAP popads.net 127.0.0.1'], env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  try {
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 20, y: 20, width: 1280, height: 900}); win.show(); win.focus(); });
    const overlay = () => app.context.pages().find(page => page.url().includes('view=overlay'));
    const capture = async name => {
      const data = await app.main(async ({webContents}) => { const view = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); return (await view.capturePage()).toPNG().toString('base64'); });
      fs.writeFileSync(`${evidence}/${name}.png`, Buffer.from(data, 'base64'));
    };
    const layoutKind = () => app.ui.evaluate(() => window.acira.getBrowserLayout()).then(layout => layout?.overlay?.kind);
    const closeOverlay = async () => { const layout = await app.ui.evaluate(() => window.acira.getBrowserLayout()); if (layout?.overlay) await app.ui.evaluate(id => window.acira.closeOverlay(id), layout.overlay.id); await sleep(400); };
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true}});
    await app.act({type: 'tab.navigate', url: ORIGIN + '/'});
    await app.waitWeb(ORIGIN, 'page');
    await poll(async () => { const s = await app.state(); return s.tabs.find(tab => tab.id === s.activeTabId)?.loading; }, v => v === false, 'loaded', 20000);
    for (const theme of ['light', 'dark']) {
      await app.act({type: 'settings.update', patch: {appearance: theme}});
      await sleep(600);
      await app.ui.locator('[aria-label="Acira menu"]').filter({visible: true}).first().click();
      await poll(layoutKind, kind => kind === 'menu', 'menu', 15000);
      await poll(overlay, Boolean, 'menu overlay'); await sleep(500);
      await overlay().getByRole('button', {name: 'Ads and trackers', exact: true}).click();
      await poll(layoutKind, kind => kind === 'protection', 'protection popup', 15000);
      await poll(overlay, Boolean, 'overlay');
      await overlay().locator('.popup-content-protection').waitFor();
      await sleep(900);
      const rows = await overlay().evaluate(() => [...document.querySelectorAll('.popup-content-protection [role=switch]')].map(node => ({label: node.getAttribute('aria-label') || node.closest('label,div')?.innerText.trim().slice(0, 60), checked: node.getAttribute('aria-checked'), disabled: node.disabled, rect: (() => { const r = node.closest('.acira-menu-row,.setting-row,label,div').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })()})));
      console.log(theme, JSON.stringify(rows));
      await capture(`protection-popup-popups-${theme}`);
      await closeOverlay();
    }
    // the toast
    await app.act({type: 'settings.update', patch: {appearance: 'light'}}); await sleep(500);
    const rect = await app.main(({webContents}, origin) => webContents.getAllWebContents().find(w => w.getURL().startsWith(origin)).executeJavaScript('(()=>{const r=document.getElementById("ad").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()'), ORIGIN);
    await app.main(async ({webContents}, [origin, rect]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(origin)); wc.focus(); wc.sendInputEvent({type: 'mouseMove', x: rect.x, y: rect.y}); await new Promise(r => setTimeout(r, 150)); wc.sendInputEvent({type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1}); wc.sendInputEvent({type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1}); }, [ORIGIN, rect]);
    await poll(layoutKind, kind => kind === 'toast', 'toast', 8000);
    await sleep(700);
    await capture('toast-popup-ad-blocked-light');
    console.log('toast text', JSON.stringify((await app.state()).toast?.text));
  } finally {
    await app.close();
  }
});
server.close();
