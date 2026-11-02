// Round 6, downloads lane: a download started in a private window shows in that window's button and popup only, and never in the normal window.
//   node qa/native-slot.mjs r6-dl-private -- node qa/r6-downloads-private.mjs [out-dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const out = path.resolve(process.argv[2] || 'qa/artifacts/r6-downloads-private'); await fs.mkdir(out, {recursive: true});
const root = '.qa-profiles/r6-downloads-private'; await fs.rm(root, {recursive: true, force: true});
const MB = 1024 * 1024;
const fx = await httpFixture((req, res) => {
  const total = 40 * MB, chunk = 64 * 1024; res.writeHead(200, {'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="private-notes.bin"', 'content-length': String(total)});
  let sent = 0; const timer = setInterval(() => { if (res.destroyed) return clearInterval(timer); res.write(Buffer.alloc(chunk, 5)); sent += chunk; if (sent >= total) { clearInterval(timer); res.end(); } }, 40); req.on('close', () => clearInterval(timer));
});
const base = `http://127.0.0.1:${fx.port}`, report = {checks: []};
const app = await startApp({root, env: {ACIRA_BROWSER_TEST_HIDDEN: '0', ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.resolve(root, 'saved')}});
const uiPages = () => app.context.pages().filter(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } });
try {
  await app.main(({BaseWindow, dialog}) => { dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); });
  await app.act({type: 'settings.update', patch: {askBeforeClosing: false}}); // otherwise closing the private window at the end waits for an answer
  await app.ui.evaluate(() => window.acira.openWindow('private'));
  const priv = await poll(() => uiPages().find(p => p !== app.ui), Boolean, 'private ui page', 20000);
  await poll(() => priv.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'private window.acira', 20000);
  const pact = a => priv.evaluate(a => window.acira.dispatch(a), a), pstate = () => priv.evaluate(() => window.acira.getSnapshot());
  await pact({type: 'settings.update', patch: {verticalTabs: true, appearance: 'dark'}}); await pact({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(900);
  await pact({type: 'tab.new', background: true, url: base + '/f'});
  const live = await poll(async () => (await pstate()).downloads.find(d => d.status === 'Downloading' && d.receivedBytes > 2 * MB), Boolean, 'private download live', 25000);
  report.checks.push({privateDownload: {name: live.name, profile: live.browserProfileId, private: live.private}});
  await sleep(1500);
  report.checks.push({privateButtonCanvases: await priv.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas').length), normalButtonCanvases: await app.ui.evaluate(() => document.querySelectorAll('.sb-foot-icons canvas').length)});
  await priv.locator('.sb-foot-icons .sb-foot-icon').nth(1).click();
  const overlays = () => app.context.pages().filter(p => p.url().includes('view=overlay'));
  const panelPage = await poll(async () => { for (const p of overlays()) if (await p.evaluate(() => !!document.querySelector('.popup-content-downloads .download-panel')).catch(() => false)) return p; }, Boolean, 'private popup', 8000);
  await sleep(1000);
  report.checks.push({popupRows: await panelPage.evaluate(() => [...document.querySelectorAll('.dl-panel-item')].map(row => ({name: row.querySelector('.lib-name')?.textContent, live: row.hasAttribute('data-live'), canvases: row.querySelectorAll('canvas').length})))});
  const id = await app.main(({BaseWindow}) => { const all = BaseWindow.getAllWindows(); return all[all.length - 1].id; });
  const png = await app.main(async ({BaseWindow, desktopCapturer, screen}, windowId) => {
    const w = BaseWindow.fromId(windowId), b = w.getBounds(), f = screen.getDisplayMatching(b).scaleFactor;
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    return sources.find(s => s.id === w.getMediaSourceId()).thumbnail.toPNG().toString('base64');
  }, id);
  await fs.writeFile(path.join(out, 'private-window-popup.png'), Buffer.from(png, 'base64'));
  // The normal window knows nothing about it.
  const normal = await app.state(), personal = normal.downloads.filter(d => d.browserProfileId === normal.activeBrowserProfileId);
  report.checks.push({normalWindowDownloads: personal.length, privateOnlyInOwnProfile: normal.downloads.every(d => d.browserProfileId !== live.browserProfileId) || normal.activeBrowserProfileId === live.browserProfileId});
  const listed = (await app.svc({type: 'downloads.list'})).downloads; report.checks.push({engineRows: listed.map(d => ({name: d.name, private: d.private, profile: d.browserProfileId, status: d.status}))});
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
} finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 1)).catch(() => {}); await app.close(); await fx.close(); }
