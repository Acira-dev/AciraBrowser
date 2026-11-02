// Seamless top reveal: native buttons shown at the caption position with no overlap with toolbar controls; hidden again with no hit region.
import {launch, sleep, poll, httpFixture, place} from './lib.mjs';
const fixture = await httpFixture((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Magenta</title><body style="margin:0;background:#ff00ff;height:100vh">'); });
const app = await launch({name: 'rv', settings: {onboardingComplete: true, reducedMotion: false, appearance: 'light', verticalTabs: false}});
try {
  const url = 'http://127.0.0.1:' + fixture.port + '/';
  await app.act({type: 'tab.navigate', url}); await app.waitWeb(url); await sleep(800);
  await app.ui.evaluate(() => document.activeElement?.blur()); await app.main(({webContents}) => { for (const w of webContents.getAllWebContents()) if (w.getURL().startsWith('http://127.0.0.1')) w.focus(); });
  const tab = (await app.state()).activeTabId;
  const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .5;
  let bad = 0;
  for (const [width, height] of [[1200, 700], [900, 600]]) for (const scale of [80, 100, 150]) for (const tabs of ['top', 'sidebar']) for (const appearance of ['light', 'dark']) {
    await place(app, {x: 20, y: 60, width, height});
    await app.act({type: 'settings.update', patch: {appearance, interfaceScale: scale, verticalTabs: tabs === 'sidebar'}});
    await app.act({type: 'ui.update', patch: {view: 'seamless', workspaceOpen: false, webWorkspaceOpen: false}}); await sleep(900);
    const hidden = await app.buttons();
    await app.cmd({type: 'edge', tabId: tab, pin: {zone: 'top', on: true}});
    await poll(() => app.ui.locator('.browser-shell').getAttribute('data-seamless'), s => s === 'shown', 'revealed', 8000).catch(e => console.log('NOT REVEALED', width, scale, tabs, appearance));
    await sleep(900);
    const shown = await app.buttons();
    const ui = await app.ui.evaluate(async () => { const l = await window.acira.getBrowserLayout(); const box = n => { const r = n.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }; return {cap: l.captionHeight, controls: [...document.querySelectorAll('.browser-shell button,.browser-shell input,.ed-rail button')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).opacity !== '0').map(n => ({name: n.getAttribute('aria-label') || n.textContent?.trim(), ...box(n)}))}; });
    const k = scale / 100, issues = [];
    if (!hidden.every(b => b.hidden && !b.receivesHit)) issues.push('hidden state leaves a live native button');
    for (const b of shown) { if (b.hidden || !b.receivesHit) issues.push('revealed button not hittable'); for (const c of ui.controls) if (overlap(b, {x: c.x * k, y: c.y * k, width: c.width * k, height: c.height * k})) issues.push('overlaps ' + c.name); }
    const want = Math.max(4, Math.round((Math.round(ui.cap * k) - 14) / 2));
    if (shown[0].x !== 12 || shown[0].y !== want) issues.push(`position ${shown[0].x},${shown[0].y} want 12,${want}`);
    await app.cmd({type: 'edge', tabId: tab, pin: {zone: 'top', on: false}}); await sleep(900);
    const after = await app.buttons();
    if (!after.every(b => b.hidden && !b.receivesHit)) issues.push('after un-pin, buttons are not hidden');
    if (issues.length) { bad++; console.log('ISSUE', JSON.stringify({width, scale, tabs, appearance, issues: [...new Set(issues)]})); }
  }
  console.log('done, combos with issues:', bad, 'errors', JSON.stringify(app.errors));
} finally { await app.close(); await fixture.close(); }
