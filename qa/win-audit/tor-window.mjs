// Tor window: chrome colours and marks while connecting and once connected, in each view/appearance. Real Tor engine, no Google.
import {launch, sleep, poll, OUT} from './lib.mjs';
import {execFileSync} from 'node:child_process';
const app = await launch({name: 'tor1', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
const shot = (wid, name) => { const f = `${OUT}/${name}.png`; execFileSync('screencapture', ['-x', '-o', '-l', wid, f]); return f; };
try {
  const old = new Set(app.context.pages());
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const p2 = await poll(async () => { for (const p of app.context.pages()) { if (old.has(p)) continue; try { if (await p.evaluate(() => Boolean(window.acira && document.querySelector('.browser-shell')))) return p; } catch {} } }, Boolean, 'tor window', 30000);
  const info = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => ({id: w.getMediaSourceId(), title: w.getTitle()})));
  const win = info.find(w => /Tor/i.test(w.title)); console.log('window', JSON.stringify(win));
  const wid = win.id.split(':')[1];
  await app.main(({BaseWindow}, t) => { const w = BaseWindow.getAllWindows().find(w => w.getTitle() === t); w.setOpacity(1); w.setBounds({x: 40, y: 80, width: 1200, height: 700}); w.showInactive(); }, win.title);
  const status = () => p2.evaluate(() => window.acira.native({type: 'tor.status'}).then(r => r.tor && {state: r.tor.state, progress: r.tor.progress, phase: r.tor.phase, error: r.tor.error?.code}));
  const t0 = Date.now(); let last = '', n = 0;
  console.log('status', JSON.stringify(await status()));
  shot(wid, 'tor-connecting-0');
  while (Date.now() - t0 < 100000) {
    const s = await status(), key = JSON.stringify(s);
    if (key !== last) { console.log(Math.round((Date.now() - t0) / 1000) + 's', key); last = key; if (s?.state === 'connecting' && n < 3 && s.progress > 10 * (n + 1)) shot(wid, `tor-connecting-${++n}`); }
    if (s?.state === 'ready' || s?.state === 'error') break;
    await sleep(700);
  }
  await sleep(2500);
  for (const appearance of ['light', 'dark']) for (const view of ['full', 'compact', 'seamless']) {
    await p2.evaluate(a => window.acira.dispatch({type: 'settings.update', patch: {appearance: a}}), appearance);
    await p2.evaluate(v => window.acira.dispatch({type: 'ui.update', patch: {view: v}}), view);
    await sleep(1400); shot(wid, `tor-ready-${appearance}-${view}`);
  }
  console.log('final', JSON.stringify(await status()), 'errors', JSON.stringify(app.errors));
} finally { await app.close(); }
