// Reduced motion / animation speed Off: a view switch is one step, no view transition, page placed once.
import {launch, sleep, httpFixture, startProbe, stopProbe} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>M</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'rd', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light'}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => { document.activeElement?.blur(); window.__ms = []; new MutationObserver(() => window.__ms.push(document.documentElement.dataset.modeSwitch ?? null)).observe(document.documentElement, {attributes: true, attributeFilter: ['data-mode-switch']}); });
  await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  for (const [a, b] of [['seamless', 'compact'], ['seamless', 'compact']]) {
    await app.act({type: 'ui.update', patch: {view: a}}); await sleep(900);
    await app.ui.evaluate(() => { window.__ms = []; }); await startProbe(app);
    await app.act({type: 'ui.update', patch: {view: b}}); await sleep(900);
    const log = await stopProbe(app), ms = await app.ui.evaluate(() => window.__ms);
    const places = log.filter(e => e.k === 'view').map(e => JSON.stringify(e.b));
    if (process.env.DETAIL) for (const e of log) console.log('   ', e.t - log[0].t, e.k, JSON.stringify(e.b ?? e.page), e.radius ?? '');
    console.log(`${a}->${b}`.padEnd(20), 'mode-switch attr changes:', JSON.stringify(ms), '| distinct page placements:', new Set(places).size);
  }
} finally { await app.close(); await fixture.close(); }
