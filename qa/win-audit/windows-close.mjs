// Closing windows on purpose vs at quit; closing the last window quits and keeps it for the next start; Close Acira? prompt when tabs are open.
import {launch, sleep, poll, httpFixture} from './lib.mjs';
import {startApp} from '../d-harness.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
const fixture = await httpFixture((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Page ' + q.url + '</title>' + q.url); });
const base = 'http://127.0.0.1:' + fixture.port;
const root = path.resolve('.qa-profiles/life2'); await fs.rm(root, {recursive: true, force: true});
const entry = {root, skipSetup: false, main: path.resolve('qa/mac-window-controls-entry.cjs'), env: {ACIRA_QA_MAIN: path.resolve('desktop/main.cjs'), ACIRA_TEST_QUIET_NETWORK: '1'}};
const wins = app => app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => ({b: [w.getBounds().x, w.getBounds().y, w.getBounds().width, w.getBounds().height].join(','), title: w.getTitle()})));
const tabsOf = async app => { const out = []; for (const p of app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html')) { try { out.push(await p.evaluate(() => window.acira.getSnapshot().then(s => s.windowId.split(':').pop() + ':' + s.tabs.map(t => t.url.replace(/^http:\/\/127.0.0.1:\d+/, '')).join('|')))); } catch {} } return out; };
let app = await launch({name: 'life2', settings: {onboardingComplete: true, reducedMotion: true, askBeforeClosing: false}});
try {
  await app.act({type: 'tab.navigate', url: base + '/A'}); await app.waitWeb(base + '/A');
  const open = async (url) => { const old = new Set(app.context.pages()); await app.ui.evaluate(() => window.acira.openWindow('normal')); const p = await poll(async () => { for (const q of app.context.pages()) { if (old.has(q)) continue; try { if (await q.evaluate(() => Boolean(window.acira && document.querySelector('.browser-shell')))) return q; } catch {} } }, Boolean, 'win'); await p.evaluate(u => window.acira.dispatch({type: 'tab.navigate', url: u}), base + url); await sleep(1000); return p; };
  const pB = await open('/B'), pC = await open('/C');
  console.log('3 windows:', JSON.stringify(await wins(app)), JSON.stringify(await tabsOf(app)));
  // close window B on purpose (the one whose page is /B): find the BaseWindow whose ui page reports it
  const idB = await pB.evaluate(() => window.acira.getSnapshot().then(s => s.windowId));
  const closeWindowOf = async (page) => { const title = 'Acira'; const bounds = await page.evaluate(() => ({w: innerWidth, h: innerHeight})); return bounds; };
  await app.main(({BaseWindow}) => { const ws = BaseWindow.getAllWindows(); ws.find(w => w.getBounds().x === 44 && w.getBounds().y === 84).close(); }); await sleep(1500);
  console.log('after closing B:', JSON.stringify(await tabsOf(app)));
  await app.close(); await sleep(1500);
  app = await startApp(entry); await sleep(2500);
  console.log('relaunch 1 (B was closed on purpose, A and C open at quit):', JSON.stringify(await tabsOf(app)));
  const pid = app.app.process().pid; const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await app.main(({BaseWindow}) => { BaseWindow.getAllWindows()[0].close(); }); await sleep(1500);
  console.log('closed one of two: alive', alive(), JSON.stringify(await tabsOf(app)));
  await app.main(({BaseWindow}) => { BaseWindow.getAllWindows()[0].close(); }).catch(() => {}); await sleep(2500);
  console.log('closed the last: alive', alive());
  app = await startApp(entry); await sleep(2500);
  console.log('relaunch 2 (after the last window closed):', JSON.stringify(await tabsOf(app)), JSON.stringify(await wins(app)));
} finally { try { await app.close(); } catch {} await fixture.close(); }
