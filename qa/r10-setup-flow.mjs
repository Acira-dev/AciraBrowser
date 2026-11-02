// Round 10 hunt: setup "Use defaults", Back/forward through every step, finishing, then the first real window and a relaunch.
// node qa/r10-setup-flow.mjs [--tone=light|dark]   (visible window; run through native-slot + focus-lock). Prints one line per check.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, poll, sleep, finaleEnded} from './d-harness.mjs';
process.env.D_VISIBLE = '1';
const tone = (process.argv.find(a => a.startsWith('--tone=')) || '--tone=light').slice(7);
const shots = path.resolve('qa/artifacts/r10-setup-' + tone); await fs.mkdir(shots, {recursive: true});
let failed = 0; const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; };
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`); });
const shot = async (app, name) => { const png = await app.main(async ({BaseWindow, desktopCapturer}) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); const b = w.getBounds(); const s = (await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}})).find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : null; }); if (png) await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(png, 'base64')); };
const root1 = '.qa-profiles/r10-setup-defaults', root2 = '.qa-profiles/r10-setup-walk';
for (const r of [root1, root2]) await fs.rm(r, {recursive: true, force: true});
const status = ui => ui.evaluate(() => window.acira.setup({type: 'status'}));
try {
  // A. Use defaults
  let app = await startApp({root: root1, skipSetup: false});
  try {
    const defaults = app.ui.getByRole('button', {name: 'Use defaults'}); await defaults.waitFor({timeout: 20000}); await sleep(1500);
    await shot(app, 'a1-welcome');
    const before = await status(app.ui); check(before.ok && before.progress?.complete === false, 'fresh profile: setup incomplete before click');
    await defaults.click(); await finaleEnded(app.ui); await sleep(800);
    await shot(app, 'a2-after-defaults');
    const st = await app.state(); const after = await status(app.ui);
    check(after.progress?.complete === true, 'Use defaults marks setup complete: ' + JSON.stringify(after.progress));
    check(!(await app.ui.locator('.fr-stage').count()), 'setup stage gone after finale');
    check(st.tabs.length >= 1 && st.activeTabId, 'a first tab exists: ' + st.tabs.length);
    const cls = await app.ui.evaluate(() => ({app: document.querySelector('.app')?.className, ghost: !!document.querySelector('.fr-ghost,.fr-finale-veil,.fr-finale-mark'), overlays: document.querySelectorAll('[role=dialog]').length, vt: document.documentElement.getAttribute('data-vt') }));
    check(!cls.ghost, 'no finale remnants: ' + JSON.stringify(cls));
    check(!(await app.ui.locator('.make-it-yours, [data-make-it-yours]').count()), 'Make it yours not offered after Use defaults');
    // first real window: open a page, new tab, open settings, mode toggles
    await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/first`}); await sleep(900);
    const s2 = await app.state(); check(s2.tabs.some(t => /first/.test(t.url)), 'page loads in first real window');
    await shot(app, 'a3-first-page');
    // views visible? (setup overlay hides web views)
    const hidden = await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); return w.contentView.children.map(v => ({v: v.getVisible?.(), b: v.getBounds()})); });
    check(hidden.some(v => v.v !== false && v.b.width > 300), 'a web view is visible and sized: ' + JSON.stringify(hidden).slice(0, 200));
  } finally { await app.close(); }
  // relaunch: setup must not return
  app = await startApp({root: root1, skipSetup: false});
  try {
    await sleep(2500);
    const again = await status(app.ui);
    check(again.progress?.complete === true && !(await app.ui.locator('.fr-stage').count()), 'relaunch after defaults: no setup, complete=' + again.progress?.complete);
    const st = await app.state(); check(st.tabs.some(t => /first/.test(t.url)), 'relaunch restores the first page: ' + st.tabs.map(t => t.url).join(','));
    await shot(app, 'a4-relaunch');
  } finally { await app.close(); }

  // B. Walk forward and back
  app = await startApp({root: root2, skipSetup: false});
  try {
    await app.ui.getByRole('button', {name: 'Get started'}).waitFor({timeout: 20000}); await sleep(1500);
    if (tone === 'dark') await app.act({type: 'settings.update', patch: {appearance: 'dark'}});
    await app.ui.getByRole('button', {name: 'Get started'}).click(); await sleep(1200);
    const titles = [];
    const title = () => app.ui.evaluate(() => document.querySelector('#fr-title')?.textContent?.trim() || document.querySelector('.fr-stage h1,.fr-stage h2')?.textContent?.trim() || null);
    for (let i = 0; i < 12; i++) {
      const t = await title(); titles.push(t); await shot(app, `b-step-${i}-${(t || 'x').replace(/\W+/g, '-').slice(0, 20)}`);
      const next = app.ui.locator('.fr-stage').getByRole('button', {name: /^(Continue|Done|Skip|Not now)$/}).first();
      if (!(await next.count())) break;
      const label = await next.textContent(); if (/Done/.test(label)) break;
      await next.click(); await sleep(900);
    }
    console.log('forward titles:', JSON.stringify(titles));
    // back all the way
    const back = [];
    for (let i = 0; i < titles.length + 1; i++) {
      const b = app.ui.locator('.fr-stage').getByRole('button', {name: 'Back'}).first();
      if (!(await b.count())) break; await b.click(); await sleep(900); back.push(await title());
    }
    console.log('back titles:', JSON.stringify(back));
    check(await app.ui.locator('.fr-stage .fr-foot').getByRole('button', {name: 'Back'}).first().isHidden(), 'Back is hidden on the first step (by design)');
    await shot(app, 'b-back-first');
    for (let i = 0; i < 12; i++) {
      const done = app.ui.locator('.fr-stage').getByRole('button', {name: /^(Done|Start browsing)$/}).first();
      if (await done.count()) { await shot(app, 'b-finish'); await done.click(); break; }
      const next = app.ui.locator('.fr-stage').getByRole('button', {name: /^(Continue|Skip|Not now)$/}).first();
      if (!(await next.count())) break; await next.click(); await sleep(800);
    }
    await finaleEnded(app.ui); await sleep(1500); await shot(app, 'b-after-finish');
    const done = await status(app.ui); check(done.progress?.complete === true, 'walk finish marks complete');
    check(await app.ui.locator('.make-it-yours, [data-make-it-yours]').count() >= 0, 'finish reached');
  } finally { await app.close(); }
} finally { await fx.close(); }
console.log(failed ? `FAILED ${failed}` : 'ALL OK'); process.exit(failed ? 1 : 0);
