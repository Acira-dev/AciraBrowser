import {launch, sleep, httpFixture, record, startProbe, stopProbe} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'm5', settings: {onboardingComplete: true, reducedMotion: false, appearance: 'light', animationSpeed: 'fast', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); }); await sleep(300);
  for (const [a, b] of [['seamless', 'compact'], ['compact', 'seamless'], ['seamless', 'full']]) {
    await app.act({type: 'ui.update', patch: {view: a}}); await sleep(1800);
    await startProbe(app);
    const t0 = Date.now();
    await app.act({type: 'ui.update', patch: {view: b}}); await sleep(1500);
    const log = await stopProbe(app);
    console.log(`--- ${a} -> ${b}`);
    for (const e of log) console.log(e.t - t0, e.k, e.k === 'layout' ? JSON.stringify({page: e.page, r: e.radius, cap: e.caption, motion: e.motion, v: e.views.map(v => v.b && [v.b.x, v.b.y, v.b.width, v.b.height].join(','))}) : JSON.stringify({b: e.b, vis: e.visible}));
  }
} finally { await app.close(); await fixture.close(); }
