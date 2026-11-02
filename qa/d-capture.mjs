// Stream D: a tab using the camera, microphone or screen is marked, and Stop ends every stream. Uses Chromium's fake camera.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-capture'; await fs.rm(root, {recursive: true, force: true}); await fs.rm(root + '-screen', {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>call</title><button id=b style="position:fixed;left:10px;top:10px;width:120px;height:40px">share</button>'); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
let app = await startApp({root, args: ['--use-fake-device-for-media-stream'], env: {ACIRA_CAPTURE_DEBUG: '1'}});
const tab = async () => (await app.state()).tabs.find(t => t.url.startsWith(base));
const capturing = async () => ((await tab())?.capturing || []).join(',');
const gesture = () => app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(u)); wc.focus(); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({type, x: 30, y: 25, button: 'left', clickCount: 1}); }, base);
try {
  // Answer the native camera/microphone question with Allow (remembered for the site) and keep a record of it.
  await app.main(({dialog}) => { globalThis.__prompts = []; dialog.showMessageBox = async (...args) => { globalThis.__prompts.push(args.at(-1).message); return {response: 1}; }; });
  await app.act({type: 'tab.new', url: base + '/'}); let page = await app.waitWeb(base + '/'); await sleep(800);
  // 1. Camera + microphone: marked while the streams are live.
  assert.equal(await page.evaluate(() => navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(s => { window.s = s; return s.getTracks().length; })), 2);
  await poll(capturing, c => c === 'camera,microphone', 'camera and microphone marked', 15000); await poll(() => app.ui.locator('[data-capturing]').count(), n => n > 0, 'the tab shows the recording mark', 10000); report.push('camera and microphone use marks the tab, in state and in the tab list');
  // 2. Stop ends every stream and clears the mark; the page is told its tracks ended.
  await page.evaluate(() => { window.endedEvents = 0; window.s.getTracks().forEach(t => t.addEventListener('ended', () => window.endedEvents++)); });
  await app.cmd({type: 'stop-capture', tabId: (await tab()).id});
  await poll(capturing, c => c === '', 'mark cleared after Stop', 10000);
  assert.deepEqual(await page.evaluate(() => window.s.getTracks().map(t => t.readyState)), ['ended', 'ended']); assert.equal(await page.evaluate(() => window.endedEvents), 2); report.push('Stop ends the camera and microphone streams, tells the page, and clears the mark');
  // 3. The mark clears by itself when the page stops its own streams.
  await page.evaluate(() => navigator.mediaDevices.getUserMedia({audio: true}).then(s => { window.s = s; }));
  await poll(capturing, c => c === 'microphone', 'microphone marked', 15000);
  await page.evaluate(() => window.s.getTracks().forEach(t => t.stop()));
  await poll(capturing, c => c === '', 'mark clears when the page stops its stream', 25000); report.push('a page that stops its own stream clears the mark within a few seconds');
  // 4. Navigating away clears the mark at once.
  await page.evaluate(() => navigator.mediaDevices.getUserMedia({video: true}).then(s => { window.s = s; }));
  await poll(capturing, c => c === 'camera', 'camera marked', 15000);
  await app.act({type: 'tab.navigate', url: base + '/other', tabId: (await tab()).id}); await poll(capturing, c => c === '', 'mark cleared by navigation', 15000); report.push('navigating away clears the mark');
  // 5. Screen sharing through the Acira picker (a second launch, with the Acira dialog window on).
  await app.close(); app = await startApp({root: root + '-screen', args: ['--use-fake-device-for-media-stream'], env: {ACIRA_TEST_APP_DIALOG: '1', ACIRA_CAPTURE_DEBUG: '1'}});
  await app.act({type: 'tab.new', url: base + '/other'}); page = await app.waitWeb(base + '/other'); await sleep(800);
  await page.evaluate(() => { document.getElementById('b').onclick = async () => { window.d = await navigator.mediaDevices.getDisplayMedia({video: true}); }; });
  await gesture(); const dialogPage = await poll(() => app.context.pages().find(p => { try { return p.url().includes('native-dialog.html'); } catch { return false; } }), Boolean, 'picker', 20000);
  await dialogPage.locator('.item').first().click(); await dialogPage.getByRole('button', {name: 'Share'}).click();
  await poll(capturing, c => c === 'screen', 'screen marked', 20000); report.push('screen sharing marks the tab');
  await poll(() => page.evaluate(() => !!window.d), Boolean, 'the page holds the screen stream', 10000);
  await app.cmd({type: 'stop-capture', tabId: (await tab()).id}); await poll(capturing, c => c === '', 'screen mark cleared', 10000);
  assert.equal(await page.evaluate(() => window.d.getVideoTracks()[0].readyState), 'ended'); report.push('Stop ends the screen share');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} catch (error) {
  console.log('STATE', JSON.stringify((await app.state()).tabs.map(t => [t.url, t.capturing])), 'PROMPTS', JSON.stringify(await app.main(() => globalThis.__prompts)));
  console.log('LOGS', app.logs.join('').split('[capture]').slice(-4).join(' | ').slice(-600));
  throw error;
} finally { await app.close(); await fx.close(); }
