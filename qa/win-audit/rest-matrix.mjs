// Rest-state matrix: view x appearance x tabs x window size x scale. Reports layout facts and obvious geometry faults; saves UI shots.
import {launch, sleep, httpFixture, place, OUT} from './lib.mjs';
import fs from 'node:fs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'rest', settings: {onboardingComplete: true, reducedMotion: true, appearance: 'light', verticalTabs: false}});
const results = [];
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  const sizes = process.env.SIZES ? JSON.parse(process.env.SIZES) : [[1200, 700], [900, 600]];
  for (const [width, height] of sizes) for (const appearance of ['light', 'dark']) for (const tabs of ['top', 'sidebar']) for (const scale of (process.env.SCALES ? JSON.parse(process.env.SCALES) : [100, 150])) for (const view of ['full', 'compact', 'focus', 'seamless']) {
    await place(app, {x: 20, y: 60, width, height});
    await app.act({type: 'settings.update', patch: {appearance, verticalTabs: tabs === 'sidebar', interfaceScale: scale}});
    await app.act({type: 'ui.update', patch: {view, workspaceOpen: tabs === 'sidebar', webWorkspaceOpen: tabs === 'sidebar'}});
    await sleep(500);
    const f = await app.ui.evaluate(async () => {
      const layout = await window.acira.getBrowserLayout(), vw = innerWidth, vh = innerHeight;
      const shell = document.querySelector('.browser-shell');
      const box = n => { const r = n.getBoundingClientRect(); return {x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10}; };
      const vis = [...document.querySelectorAll('.browser-shell button, .browser-shell input, .browser-shell [role=tab]')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).opacity !== '0');
      const clipped = vis.filter(n => { const r = n.getBoundingClientRect(); return r.right > vw + .5 || r.bottom > vh + .5 || r.left < -.5 || r.top < -.5; }).map(n => (n.getAttribute('aria-label') || n.textContent || n.className).trim().slice(0, 30));
      const scrollW = document.documentElement.scrollWidth, scrollH = document.documentElement.scrollHeight;
      return {layout: {cap: layout.captionHeight, page: layout.pageBounds, radius: layout.pageRadius, viewport: layout.viewport}, mode: shell?.dataset.layout, seamless: shell?.dataset.seamless, vw, vh, clipped, overflow: scrollW > vw || scrollH > vh ? [scrollW, scrollH] : null, tb: document.querySelector('.browser-toolbar') && box(document.querySelector('.browser-toolbar')), addr: document.querySelector('.address-bar') && box(document.querySelector('.address-bar'))};
    });
    const b = await app.buttons();
    const k = scale / 100, cap = f.layout.cap * k;
    const faults = [];
    if (f.clipped.length) faults.push('clipped:' + f.clipped.join('|'));
    if (f.overflow) faults.push('scroll-overflow:' + f.overflow);
    const wantY = Math.max(4, Math.round((cap - 14) / 2));
    if (f.seamless !== 'hidden') for (const x of b) { if (x.x !== 12 || x.y !== wantY) faults.push('traffic-light at ' + x.x + ',' + x.y + ' want 12,' + wantY); if (x.hidden || !x.receivesHit) faults.push('traffic-light hidden/unhittable'); if (x.y < 0 || x.y + x.height > cap + .5) faults.push('traffic-light outside caption ' + JSON.stringify([x.y, x.height, cap])); }
    const rec = {width, height, appearance, tabs, scale, view, mode: f.mode, seamless: f.seamless, page: f.layout.page, radius: f.layout.radius, cap: f.layout.cap, buttons: b.map(x => [x.x, x.y]).join(' '), faults};
    results.push(rec);
    if (faults.length) { rec.shot = await app.shot(`rest-${width}-${appearance}-${tabs}-${scale}-${view}`); }
    console.log(JSON.stringify(rec));
  }
  console.log('errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); fs.writeFileSync(OUT + '/rest.json', JSON.stringify(results)); }
