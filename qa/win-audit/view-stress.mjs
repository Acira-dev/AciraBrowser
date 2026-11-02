// Interrupted view switches and a resize in the middle of a morph: the settled state must equal a clean switch to the same view.
import {launch, sleep, httpFixture, place} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>M</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'st', settings: {onboardingComplete: true, reducedMotion: false, appearance: 'light', animationSpeed: 'fast', verticalTabs: false}});
const settle = async () => { await sleep(1800); return app.ui.evaluate(async () => { const l = await window.acira.getBrowserLayout(), r = document.documentElement, s = document.querySelector('.browser-shell'); return {page: l.pageBounds, radius: l.pageRadius, cap: l.captionHeight, modeSwitch: r.dataset.modeSwitch ?? null, layout: s?.dataset.layout, seamless: s?.dataset.seamless ?? null, pageLive: r.dataset.pageLive ?? null, animations: document.getAnimations().filter(a => a.playState === 'running').length}; }); };
const nativePage = () => app.win(w => w.contentView.children.filter(v => v.webContents && !v.webContents.getURL().startsWith('acira-browser-ui://')).map(v => v.getBounds()));
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  const views = ['full', 'compact', 'focus', 'seamless'];
  const clean = {};
  for (const v of views) { await app.act({type: 'ui.update', patch: {view: 'full'}}); await sleep(1200); await app.act({type: 'ui.update', patch: {view: v}}); clean[v] = {...(await settle()), native: await nativePage()}; }
  let bad = 0;
  const check = (tag, got, want) => { const norm = o => JSON.stringify({page: o.page, radius: o.radius, cap: o.cap, layout: o.layout, seamless: o.seamless, native: o.native}); const ok = norm(got) === norm(want) && !got.modeSwitch && !got.pageLive; if (!ok) { bad++; console.log('MISMATCH', tag, '\n got ', JSON.stringify({...got, animations: got.animations}), '\n want', JSON.stringify(want)); } else console.log('ok', tag, 'running animations after settle:', got.animations); };
  for (const delay of [0, 30, 80, 150, 300]) {
    await app.act({type: 'ui.update', patch: {view: 'full'}}); await sleep(1500);
    for (const v of ['compact', 'seamless', 'focus', 'full', 'compact', 'seamless']) { await app.act({type: 'ui.update', patch: {view: v}}); await sleep(delay); }
    const got = {...(await settle()), native: await nativePage()}; check(`rapid x6 gap ${delay}ms -> seamless`, got, clean.seamless);
  }
  for (const to of ['compact', 'full']) {
    await app.act({type: 'ui.update', patch: {view: 'seamless'}}); await sleep(1500);
    await app.act({type: 'ui.update', patch: {view: to}}); await sleep(120);
    await place(app, {x: 20, y: 60, width: 1000, height: 640}); await sleep(100); await place(app, {x: 20, y: 60, width: 1200, height: 700});
    const got = {...(await settle()), native: await nativePage()}; check(`resize mid-morph seamless->${to}`, got, clean[to]);
  }
  console.log('mismatches', bad, 'errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
