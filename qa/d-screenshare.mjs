// Stream D: screen sharing asks through the Acira picker (thumbnails, one choice), and Cancel shares nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-screenshare'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir('qa/artifacts', {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>share</title><button id=b style="position:fixed;left:10px;top:10px;width:120px;height:40px">share</button>'); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root, env: {ACIRA_TEST_APP_DIALOG: '1'}});
const visible = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().some(w => w.isVisible() && w.getBounds().width === 680));
const dialogPage = () => app.context.pages().find(p => { try { return p.url().includes('native-dialog.html'); } catch { return false; } });
try {
  await app.act({type: 'tab.new', url: base + '/'}); const page = await app.waitWeb(base + '/'); await sleep(800);
  const arm = () => page.evaluate(() => { window.__r = 'waiting'; document.getElementById('b').onclick = async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({video: true}); window.__r = 'granted:' + s.getVideoTracks().length; s.getTracks().forEach(t => t.stop()); } catch (e) { window.__r = 'denied:' + e.name; } }; });
  const click = () => app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === u); wc.focus(); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({type, x: 30, y: 25, button: 'left', clickCount: 1}); }, base + '/');
  const result = () => page.evaluate(() => window.__r);
  // Cancel: nothing is shared.
  await arm(); await click(); await poll(visible, Boolean, 'picker visible', 20000); const win = dialogPage();
  const count = await win.locator('.item').count(); assert.ok(count >= 1, 'at least one screen is offered'); assert.ok(await win.locator('.item img').count() >= 1, 'thumbnails shown'); assert.equal(await win.locator('.item[aria-checked=true]').count(), 1, 'one choice is always selected'); report.push(`picker offers ${count} screens/windows with thumbnails`);
  await win.screenshot({path: 'qa/artifacts/d-dialog-share.png'});
  await win.getByRole('button', {name: 'Cancel'}).click(); await poll(result, r => /^denied:/.test(r), 'cancel denies'); report.push('Cancel shares nothing');
  // Share: the chosen surface is captured.
  await arm(); await click(); await poll(visible, Boolean, 'picker visible again', 20000); const win2 = dialogPage();
  await win2.locator('.item').first().click(); await win2.getByRole('button', {name: 'Share'}).click();
  await poll(result, r => /^granted:1$/.test(r), 'share grants one video track', 20000); report.push('Share captures the selected surface');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
