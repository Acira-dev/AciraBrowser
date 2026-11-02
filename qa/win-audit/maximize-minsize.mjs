// Minimum size, maximise (zoom) / restore, and maximised state kept across a relaunch.
import {launch, sleep, httpFixture} from './lib.mjs';
import {startApp} from '../d-harness.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve('.qa-profiles/mx'); await fs.rm(root, {recursive: true, force: true});
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const info = app => app.win(w => ({b: w.getBounds(), cs: w.getContentSize(), max: w.isMaximized(), fs: w.isFullScreen(), min: w.getMinimumSize(), page: w.contentView.children.filter(v => v.webContents && !v.webContents.getURL().startsWith('acira-browser-ui://')).map(v => v.getBounds())}));
let app = await launch({name: 'mx', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.win(w => w.setBounds({x: 20, y: 60, width: 500, height: 300})); await sleep(500);
  console.log('after setBounds 500x300:', JSON.stringify(await info(app)));
  await app.win(w => w.setBounds({x: 20, y: 60, width: 1100, height: 650})); await sleep(500);
  const before = await info(app);
  await app.win(w => w.maximize()); await sleep(1200);
  const mx = await info(app); console.log('maximized:', JSON.stringify(mx));
  const lay = await app.ui.evaluate(() => window.acira.getBrowserLayout().then(l => ({vp: l.viewport, page: l.pageBounds})));
  console.log(' layout after maximize:', JSON.stringify(lay), 'page fills content:', mx.page[0] && mx.page[0].x + mx.page[0].width === mx.cs[0] && mx.page[0].y + mx.page[0].height === mx.cs[1]);
  await app.win(w => w.unmaximize()); await sleep(1200);
  const un = await info(app); console.log('unmaximized:', JSON.stringify(un.b), 'equals before:', JSON.stringify(un.b) === JSON.stringify(before.b));
  await app.win(w => w.maximize()); await sleep(1000);
  await app.close(); await sleep(1500);
  app = await startApp({root, skipSetup: false, main: path.resolve('qa/mac-window-controls-entry.cjs'), env: {ACIRA_QA_MAIN: path.resolve('desktop/main.cjs'), ACIRA_TEST_QUIET_NETWORK: '1'}});
  await sleep(2500);
  const re = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => ({b: w.getBounds(), max: w.isMaximized()})));
  console.log('relaunch (was maximised):', JSON.stringify(re));
  console.log('window-state.json:', (await fs.readFile(path.join(root, 'window-state.json'), 'utf8')).slice(0, 300));
} finally { try { await app.close(); } catch {} await fixture.close(); }
