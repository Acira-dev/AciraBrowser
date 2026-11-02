import {launch, sleep, httpFixture, startProbe, stopProbe} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>M</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'p12', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light'}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  await app.act({type: 'ui.update', patch: {view: 'seamless'}}); await sleep(1200);
  await app.ui.evaluate(() => {
    window.__log = []; let n = 0;
    const q = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return Math.round(r.top * 10) / 10 + '+' + Math.round(r.height * 10) / 10; };
    const sample = tag => window.__log.push(`${Date.now()} ${tag} toolbar=${q('.acira-persistent-toolbar')} tabrow=${q('.acira-tab-row')} pageArea=${q('.page-area')} layout=${document.querySelector('.browser-shell')?.dataset.layout} seamless=${document.querySelector('.browser-shell')?.dataset.seamless ?? '-'}`);
    const loop = () => { sample('raf'); if (++n < 40) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    new MutationObserver(() => sample('mut')).observe(document.querySelector('.browser-shell'), {attributes: true, childList: true, subtree: true});
  });
  await startProbe(app);
  await app.act({type: 'ui.update', patch: {view: 'compact'}}); await sleep(900);
  const mainLog = await stopProbe(app), uiLog = await app.ui.evaluate(() => window.__log);
  const t0 = mainLog[0].t;
  const all = [...mainLog.map(e => [e.t, `MAIN ${e.k} ${JSON.stringify(e.b ?? e.page)}`]), ...uiLog.slice(0, 80).map(s => [Number(s.split(' ')[0]), 'UI   ' + s.split(' ').slice(1).join(' ')])].sort((a, b) => a[0] - b[0]);
  let last = ''; for (const [t, s] of all) { const key = s.replace(/^UI +(raf|mut) /, ''); if (s.startsWith('UI') && key === last) continue; last = s.startsWith('UI') ? key : last; console.log(t - t0, s); }
} finally { await app.close(); await fixture.close(); }
