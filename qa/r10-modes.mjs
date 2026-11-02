// Round 10 hunt: moving between window modes (full, compact, seamless) in every order, with a split open and with a popup open.
// Invariant: each mode lays the page and paints the toolbar the same wherever you came from; nothing from the old mode stays.
// node qa/r10-modes.mjs [--tone=light|dark] [--scale=1.5]   (visible window; run through native-slot + focus-lock)
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
process.env.D_VISIBLE = '1';
const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const tone = arg('tone', 'light'), scale = arg('scale', '1');
const shots = path.resolve(`qa/artifacts/r10-modes-${tone}-${scale}`); await fs.mkdir(shots, {recursive: true});
let failed = 0; const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; };
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><body style="margin:0;background:#fafafa"><h1>${req.url}</h1>`); });
const root = '.qa-profiles/r10-modes'; await fs.rm(root, {recursive: true, force: true});
const app = await startApp({root, args: scale === '1' ? [] : ['--force-device-scale-factor=' + scale]});
const capture = async name => { const b64 = await app.main(async ({BaseWindow, desktopCapturer}) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); const b = w.getBounds(); const s = (await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}})).find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : null; }); if (b64) await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(b64, 'base64')); return b64; };
const views = () => app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); return {win: w.getContentBounds(), active: w.isFocused(), views: w.contentView.children.map(v => ({url: v.webContents?.getURL?.().slice(0, 40), vis: v.getVisible?.(), b: v.getBounds()})).filter(v => v.vis !== false)}; });
const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
const popups = async () => { const o = overlay(); return o ? o.locator('.sheet-popup').count().catch(() => -1) : 0; };
const settle = async () => { await sleep(900); };
const setView = async v => { await app.act({type: 'ui.update', patch: {view: v}}); await settle(); };
const pageBounds = async () => (await views()).views.filter(v => /127\.0\.0\.1/.test(v.url || '')).map(v => JSON.stringify(v.b)).sort().join('|');
const chromeInfo = () => app.ui.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return {shell: document.querySelector('.browser-root, .browser-shell')?.className, view: document.documentElement.dataset.windowView, edge: document.documentElement.dataset.edgeFloat ?? null, toolbar: r('.acira-persistent-toolbar'), tabrow: r('.acira-tab-row'), rail: r('.ed-rail')}; });
try {
  if (tone === 'dark') await app.act({type: 'settings.update', patch: {appearance: 'dark'}});
  const base = `http://127.0.0.1:${fx.port}`;
  for (const p of ['/a', '/b', '/c']) { await app.act({type: 'tab.new', url: base + p}); await sleep(500); }
  await sleep(900);
  let s = await app.state();
  const ids = s.tabs.filter(t => /127/.test(t.url)).map(t => t.id);
  await setView('full');
  const first = {};
  for (const withSplit of [false, true]) {
    if (withSplit) { await app.act({type: 'split.open', tabIds: ids.slice(0, 2), layout: 'columns'}); await sleep(700); }
    const modes = ['full', 'compact', 'seamless'];
    const baseline = {};
    // baseline: from full into each mode
    for (const m of ['full', 'compact', 'seamless', 'full']) {
      await setView(m);
      const key = m + (withSplit ? '+split' : '');
      const pb = await pageBounds(), ci = await chromeInfo(), st = await app.state();
      if (m === 'full' && baseline.full !== undefined) check(pb === baseline.full, `${key}: back to full lays the page as at first`);
      baseline[m] ??= pb;
      check((st.windowUi.view ?? st.settings.windowView) === m, `${key}: state view is ${m}`);
      await capture(`${key}-baseline`);
    }
    // every ordered pair, with and without a popup open on the way
    for (const a of modes) for (const b of modes) {
      if (a === b) continue;
      for (const withPopup of [false, true]) {
        await setView(a);
        if (withPopup) { const act = (await app.state()).activeTabId; await app.cmd({type: 'ui', tabId: act, action: 'open', kind: 'tab-context', targetTabId: act}); await sleep(700); }
        const popBefore = await popups();
        await setView(b);
        const tag = `${a}->${b}${withSplit ? '+split' : ''}${withPopup ? '+popup' : ''}`;
        const pb = await pageBounds(), act2 = await popups();
        check(pb === baseline[b], `${tag}: page laid as in ${b} (${pb === baseline[b] ? 'same' : pb + ' vs ' + baseline[b]})`);
        if (withPopup) check(popBefore > 0 && act2 === 0, `${tag}: the menu was open (${popBefore}) and closes with the switch (${act2})`);
        const v = await views(); check(v.active, `${tag}: window stays active`);
        if (!(a + b).includes('seamless') || withPopup || withSplit) await capture(tag.replace(/[+>]/g, '_'));
        // close any popup and clear for the next pair
        const o = overlay(); if (o && (await popups())) { await o.keyboard.press('Escape').catch(() => {}); await sleep(500); }
      }
    }
    if (withSplit) { await app.act({type: 'split.close'}); await sleep(500); }
  }
  // popup reopens correctly after all that
  await setView('full'); const act = (await app.state()).activeTabId; await app.cmd({type: 'ui', tabId: act, action: 'open', kind: 'tab-context', targetTabId: act}); await sleep(800);
  check(await popups() > 0, 'a popup still opens after the mode round trip'); await capture('final-popup');
  console.log('final chrome', JSON.stringify(await chromeInfo()));
} finally { await app.close(); await fx.close(); }
console.log(failed ? `FAILED ${failed}` : 'ALL OK'); process.exit(failed ? 1 : 0);
