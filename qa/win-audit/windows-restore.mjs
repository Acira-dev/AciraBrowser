// Windows lifecycle: open/focus/close, last window, quit and relaunch restore (bounds, view, tabs per window).
import {launch, sleep, poll, httpFixture} from './lib.mjs';
import {startApp} from '../d-harness.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
const fixture = await httpFixture((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Page ' + q.url + '</title><body style="margin:0;background:#ff00ff">' + q.url); });
const base = 'http://127.0.0.1:' + fixture.port;
const root = path.resolve('.qa-profiles/life'); await fs.rm(root, {recursive: true, force: true});
const wins = app => app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => ({title: w.getTitle(), b: w.getBounds(), vis: w.isVisible(), min: w.isMinimized(), fs: w.isFullScreen(), max: w.isMaximized(), focused: w.isFocused(), ui: w.contentView.children.map(v => v.webContents?.getURL()).filter(Boolean).map(u => u.slice(0, 50))})));
const uiPages = app => app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html');
const winIds = async app => { const out = []; for (const p of uiPages(app)) { try { out.push({p, id: await p.evaluate(() => window.acira.getSnapshot().then(s => s.windowId)), view: await p.evaluate(() => window.acira.getSnapshot().then(s => s.windowUi.view ?? s.settings.windowView))}); } catch {} } return out; };
let app = await launch({name: 'life', settings: {onboardingComplete: true, reducedMotion: true, askBeforeClosing: false}});
try {
  const log = (...a) => console.log(...a);
  await app.act({type: 'tab.navigate', url: base + '/one'}); await app.waitWeb(base + '/one');
  log('1 window', JSON.stringify((await wins(app)).map(w => w.b)));
  const old = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('normal'));
  const p2 = await poll(async () => { for (const p of app.context.pages()) { if (old.has(p)) continue; try { if (await p.evaluate(() => Boolean(window.acira && document.querySelector('.browser-shell')))) return p; } catch {} } }, Boolean, 'second window');
  await sleep(1500);
  log('2 windows', JSON.stringify((await wins(app)).map(w => ({t: w.title, b: w.b, vis: w.vis, focused: w.focused}))));
  await p2.evaluate(() => window.acira.dispatch({type: 'ui.update', patch: {view: 'compact'}}));
  await p2.evaluate(url => window.acira.dispatch({type: 'tab.navigate', url}), base + '/two'); await sleep(800);
  await app.main(({BaseWindow}) => { const ws = BaseWindow.getAllWindows(); ws[ws.length - 1].setBounds({x: 120, y: 140, width: 1000, height: 650}); }); await sleep(600);
  log('ids', JSON.stringify((await winIds(app)).map(w => [w.id, w.view])));
  log('before quit', JSON.stringify((await wins(app)).map(w => w.b)));
  await app.close();
  await sleep(1500);
  const again = await startApp({root, skipSetup: false, main: path.resolve('qa/mac-window-controls-entry.cjs'), env: {ACIRA_QA_MAIN: path.resolve('desktop/main.cjs'), ACIRA_TEST_QUIET_NETWORK: '1'}});
  await sleep(2500);
  log('after relaunch windows', JSON.stringify((await wins(again)).map(w => ({t: w.title, b: w.b, vis: w.vis}))));
  const ids = await winIds(again);
  log('after ids', JSON.stringify(ids.map(w => [w.id, w.view])));
  for (const {p, id} of ids) log(' tabs of', id, JSON.stringify(await p.evaluate(() => window.acira.getSnapshot().then(s => s.tabs.map(t => t.url)))));
  // close last window
  await again.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) w.close(); }); await sleep(1500);
  log('after closing all', JSON.stringify(await wins(again)));
  await again.main(({app}) => { app.emit('activate'); }); await sleep(2500);
  log('after activate', JSON.stringify((await wins(again)).map(w => ({t: w.title, b: w.b, vis: w.vis}))));
  for (const p of uiPages(again)) log(' tabs', JSON.stringify(await p.evaluate(() => window.acira.getSnapshot().then(s => s.tabs.map(t => t.url)))));
  await again.close();
} finally { try { await app.close(); } catch {} await fixture.close(); }
