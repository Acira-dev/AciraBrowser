// Private and Tor windows: chrome colours and marks in each view and appearance (UI-layer shots + native composite via screencapture -l).
import {launch, sleep, poll, httpFixture, OUT} from './lib.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
const kind = process.argv[2] || 'private';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Plain</title><body style="margin:0;background:#fff;font:20px sans-serif">fixture page</body>'); });
const app = await launch({name: 'pv-' + kind, settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
try {
  const old = new Set(app.context.pages());
  await app.ui.evaluate(k => window.acira.openWindow(k), kind);
  const p2 = await poll(async () => { for (const p of app.context.pages()) { if (old.has(p)) continue; try { if (await p.evaluate(() => Boolean(window.acira && document.querySelector('.browser-shell')))) return p; } catch {} } }, Boolean, 'new window');
  await sleep(1500);
  // ghost + place the new window; find it by its ui page
  const info = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => ({id: w.getMediaSourceId(), title: w.getTitle(), b: w.getBounds(), vis: w.isVisible(), op: w.getOpacity()})));
  console.log('windows', JSON.stringify(info));
  const snap = await p2.evaluate(() => window.acira.getSnapshot().then(s => ({windowId: s.windowId, tabs: s.tabs.map(t => ({url: t.url, privacy: t.privacy})), view: s.windowUi.view ?? s.settings.windowView, appearance: s.settings.appearance})));
  console.log('snapshot', JSON.stringify(snap));
  const privWin = info.find(w => /Private|Tor/i.test(w.title)) || info[0];
  const wid = privWin.id.split(':')[1];
  await app.main(({BaseWindow}, t) => { const w = BaseWindow.getAllWindows().find(w => w.getTitle() === t); w.setOpacity(1); w.setBounds({x: 40, y: 80, width: 1200, height: 700}); w.showInactive(); }, privWin.title);
  await sleep(800);
  for (const appearance of ['light', 'dark']) for (const view of ['full', 'compact', 'seamless']) {
    await p2.evaluate(a => { window.acira.dispatch({type: 'settings.update', patch: {appearance: a}}); }, appearance);
    await p2.evaluate(v => window.acira.dispatch({type: 'ui.update', patch: {view: v}}), view);
    await sleep(1200);
    const file = `${OUT}/pv-${kind}-${appearance}-${view}.png`;
    execFileSync('screencapture', ['-x', '-o', '-l', wid, file]);
    console.log('shot', file);
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
