// Per-window view choice vs the shared default across two windows, and a new window's starting view.
import {launch, sleep, poll} from './lib.mjs';
const app = await launch({name: 'v2', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light'}});
const st = async p => p.evaluate(() => window.acira.getSnapshot().then(s => ({own: s.windowUi.view ?? null, def: s.settings.windowView ?? null, layout: document.querySelector('.browser-shell')?.dataset.layout, seamless: document.querySelector('.browser-shell')?.dataset.seamless ?? null})));
const openWin = async () => { const old = new Set(app.context.pages()); await app.ui.evaluate(() => window.acira.openWindow('normal')); const p = await poll(async () => { for (const q of app.context.pages()) { if (old.has(q)) continue; try { if (await q.evaluate(() => Boolean(window.acira && document.querySelector('.browser-shell')))) return q; } catch {} } }, Boolean, 'win'); await sleep(1200); return p; };
const row = async tag => console.log(tag.padEnd(46), 'W1', JSON.stringify(await st(app.ui)), 'W2', JSON.stringify(await st(w2)));
let w2;
try {
  await sleep(800);
  w2 = await openWin(); await row('window 2 opened (default full)');
  await w2.evaluate(() => window.acira.dispatch({type: 'ui.update', patch: {view: 'seamless'}})); await sleep(900); await row('W2 own view = seamless');
  await app.act({type: 'settings.update', patch: {windowView: 'compact'}}); await sleep(900); await row('default -> compact (set from W1)');
  await app.act({type: 'ui.update', patch: {view: 'focus'}}); await sleep(900); await row('W1 own view = focus');
  await w2.evaluate(() => window.acira.dispatch({type: 'ui.update', patch: {view: 'seamless'}})); await sleep(900); await row('W2 toggles seamless again (own==seamless)');
  await app.act({type: 'settings.update', patch: {windowView: 'full'}}); await sleep(900); await row('default -> full');
  const w3 = await openWin(); console.log('window 3 starts as', JSON.stringify(await st(w3)));
  await app.act({type: 'settings.update', patch: {windowView: 'seamless'}}); await sleep(900); console.log('default seamless: W1', JSON.stringify(await st(app.ui)), 'W3', JSON.stringify(await st(w3)));
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); }
