// Page corners at rest: measure the magenta page's four corners on the real composite (screencapture -l of this window).
import {launch, sleep, httpFixture, place, solid, ghost, OUT} from './lib.mjs';
import {execFileSync} from 'node:child_process';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'co', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  const wid = (await app.win(w => w.getMediaSourceId())).split(':')[1];
  await place(app, {x: 20, y: 60, width: 1000, height: 640});
  for (const [view, tabs, scale] of [['full', 'top', 100], ['compact', 'top', 100], ['focus', 'top', 100], ['seamless', 'top', 100], ['full', 'sidebar', 100], ['focus', 'sidebar', 100], ['seamless', 'sidebar', 100], ['full', 'sidebar', 150], ['seamless', 'top', 150]]) {
    await app.act({type: 'settings.update', patch: {verticalTabs: tabs === 'sidebar', interfaceScale: scale}});
    await app.act({type: 'ui.update', patch: {view, workspaceOpen: tabs === 'sidebar', webWorkspaceOpen: tabs === 'sidebar'}}); await sleep(900);
    await solid(app); await sleep(800);
    const f = `${OUT}/co-${view}-${tabs}-${scale}.png`; execFileSync('screencapture', ['-x', '-o', '-l', wid, f]);
    await ghost(app);
    const layout = await app.ui.evaluate(() => window.acira.getBrowserLayout().then(l => ({r: l.pageRadius, p: l.pageBounds})));
    const out = execFileSync('python3', [new URL('./tools/corners.py', import.meta.url).pathname, f]).toString().trim();
    console.log(`${view} ${tabs} ${scale}`.padEnd(22), 'layout radius', layout.r, JSON.stringify(layout.p), '| measured', out);
  }
} finally { await app.close(); await fixture.close(); }
