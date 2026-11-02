// Round 6 zoom acceptance on the real app, synthetic input only (a physical trackpad is not available here):
//  - page zoom (keys, Ctrl+wheel) walks Chromium's preset steps and every text size scales together;
//  - a pinch is visual-viewport zoom: no reflow, zoom factor untouched, pannable, cleared by actual size;
//  both at 100% and 150% interface scale, after a cross-site navigation, and in split panes.
// Run: node qa/native-slot.mjs r6-zoom -- node qa/r6-zoom-pinch.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
const require = createRequire(import.meta.url), levels = require('../page-zoom-levels.json');
const root = path.resolve('.qa-profiles/r6-zoom-pinch-' + Date.now());
const sizes = [9, 11, 13, 14, 16, 18, 21, 24, 32, 48];
const html = title => `<title>${title}</title><style>body{margin:0;font-family:Georgia,serif}p{margin:0;white-space:nowrap;width:max-content}h1{font-size:max(1.2rem,3vw)}</style>
<h1>Text-heavy fixture ${title}</h1>${sizes.map(s => `<p class="t" style="font-size:${s}px">Sample text ${s}px, the quick brown fox</p>`).join('')}
<div style="height:3000px;width:3000px"></div>`;
// The test window is hidden, so Chromium makes no frames on its own: gestures then crawl and a zoom change is not applied for seconds.
// A steady capturePage of every website view stands in for the display's vsync.
let app, fx, failed = false, pumping = true;
const pump = async () => { while (pumping) { await app.main(({webContents}) => Promise.all(webContents.getAllWebContents().filter(w => /^https?:/.test(w.getURL())).map(w => w.capturePage().catch(() => null)))).catch(() => null); await sleep(60); } };
const cleanup = [];
const check = async (name, fn) => {
  try { const detail = await fn(); console.log('PASS ' + name + (detail ? ' ' + detail : '')); }
  catch (error) {
    failed = true; console.log('FAIL ' + name + '\n  ' + String(error.message || error).split('\n').slice(0, 3).join('\n  '));
    // a failed check must not leave a zoom behind for the next one
    try { for (const p of cleanup) await app.cmd({type: 'zoom', tabId: p.id, zoom: 100}); await sleep(300); } catch {}
  }
};
try {
  fx = await httpFixture((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html(q.url)); });
  app = await startApp({root, skipSetup: true});
  void pump();
  const open = async url => { await app.act({type: 'tab.new', url}); const id = (await app.state()).activeTabId, page = await app.waitWeb(url); await page.locator('h1').waitFor(); return {id, page, cdp: await app.context.newCDPSession(page)}; };
  const A = await open(`http://127.0.0.1:${fx.port}/a`); cleanup.push(A);
  const native = p => app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === u); return {factor: wc.getZoomFactor(), mode: wc.getZoomMode()}; }, p.page.url());
  const metrics = p => p.page.evaluate(() => ({dpr: devicePixelRatio, iw: innerWidth, visual: visualViewport.scale, pageLeft: visualViewport.pageLeft, vvw: visualViewport.width,
    text: [...document.querySelectorAll('.t')].map(el => el.getBoundingClientRect().width * devicePixelRatio)}));
  const base = await metrics(A);
  const keys = (p, keyCode) => app.main(({webContents}, [u, k]) => { const w = webContents.getAllWebContents().find(w => w.getURL() === u); w.focus(); for (const type of ['keyDown', 'keyUp']) w.sendInputEvent({type, keyCode: k, modifiers: [process.platform === 'darwin' ? 'meta' : 'control']}); }, [p.page.url(), keyCode]);
  // A device wheel notch (Electron's deltaY is the opposite sign to the DOM's): Chromium itself turns Ctrl+wheel into zoom steps.
  const notch = (p, ticks, ctrl = true) => app.main(({webContents}, [u, t, mods]) => { const w = webContents.getAllWebContents().find(w => w.getURL() === u); w.sendInputEvent({type: 'mouseWheel', x: 150, y: 120, deltaX: 0, deltaY: t * 100, wheelTicksX: 0, wheelTicksY: t, hasPreciseScrollingDeltas: false, modifiers: mods ? ['control'] : []}); }, [p.page.url(), ticks, ctrl]);
  // A touchpad pinch ('mouse' source: Chromium's touchpad path, which sends the page a Ctrl+wheel first, exactly what a trackpad does).
  const pinch = (p, scaleFactor) => Promise.race([p.cdp.send('Input.synthesizePinchGesture', {x: 150, y: 120, scaleFactor, relativeSpeed: 800, gestureSourceType: 'mouse'}), sleep(8000)]);
  const factorIs = (p, value, label) => poll(() => native(p), n => Math.abs(n.factor - value / 100) < .001, label);
  const reset = async p => { await app.cmd({type: 'zoom', tabId: p.id, zoom: 100}); await factorIs(p, 100, 'reset to actual size'); await poll(() => metrics(p), m => Math.abs(m.visual - 1) < .01, 'pinch cleared'); };
  const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

  await check('page zoom keys walk Chromium preset steps up to 500% and back to 25%', async () => {
    const seen = [];
    for (let i = 0; i < levels.length; i++) { const before = (await native(A)).factor; await keys(A, '='); const last = levels.at(-1); if (Math.round(before * 100) === last) break; await poll(() => native(A), n => Math.abs(n.factor - before) > .001, 'zoom in step'); seen.push(Math.round((await native(A)).factor * 100)); }
    assert.deepEqual(seen, levels.filter(v => v > 100), 'up');
    seen.length = 0;
    for (let i = 0; i < levels.length; i++) { const before = (await native(A)).factor; if (Math.round(before * 100) === 25) break; await keys(A, '-'); await poll(() => native(A), n => Math.abs(n.factor - before) > .001, 'zoom out step'); seen.push(Math.round((await native(A)).factor * 100)); }
    assert.deepEqual(seen, levels.filter(v => v < 500).reverse(), 'down');
    await reset(A);
  });

  await check('every text size scales together at each preset step (no size drifts from the others)', async () => {
    const worst = [];
    for (const value of levels) {
      await app.cmd({type: 'zoom', tabId: A.id, zoom: value}); await factorIs(A, value, 'step ' + value);
      const m = await poll(() => metrics(A), m => Math.abs(m.dpr / base.dpr - value / 100) < .01, 'rendered step ' + value);
      const ratios = m.text.map((w, i) => w / base.text[i] / (value / 100));
      worst.push(Math.max(...ratios.map(r => Math.abs(r - 1))));
      assert(worst.at(-1) < .012, `at ${value}% one size is off by ${(worst.at(-1) * 100).toFixed(2)}%: ${ratios.map(r => r.toFixed(3))}`);
    }
    await reset(A);
    return 'worst drift ' + (Math.max(...worst) * 100).toFixed(2) + '%';
  });

  for (const scale of [100, 150]) {
    await app.act({type: 'settings.update', patch: {interfaceScale: scale}}); await sleep(900);
    await check(`Ctrl+wheel steps one preset per notch at interface ${scale}%`, async () => {
      for (const expect of [110, 125, 150]) { await notch(A, 1); await factorIs(A, expect, 'notch up to ' + expect); await sleep(80); }
      for (const expect of [125, 110, 100]) { await notch(A, -1); await factorIs(A, expect, 'notch down to ' + expect); await sleep(80); }
      await app.cmd({type: 'zoom', tabId: A.id, zoom: 300}); await factorIs(A, 300, 'high zoom');
      await sleep(80); await notch(A, -1); await factorIs(A, 250, 'one notch at 300% is one step, not a jump');
      await notch(A, 0 + 1, false); await sleep(250); assert.equal(Math.round((await native(A)).factor * 100), 250, 'a plain wheel never zooms');
      await reset(A);
    });
    await check(`pinch magnifies without reflow, pans, and actual size clears it at interface ${scale}%`, async () => {
      const b = await metrics(A);
      await pinch(A, 1.5);
      const m = await poll(() => metrics(A), m => m.visual > 1.3, 'pinch magnified');
      assert(m.visual < 1.7, 'a 1.5x pinch is about 1.5x: ' + m.visual);
      near(m.iw, b.iw, 1, 'layout width must not change'); near(m.dpr, b.dpr, .001, 'device pixel ratio must not change');
      assert.equal(Math.round((await native(A)).factor * 100), 100, 'page zoom factor untouched');
      m.text.forEach((w, i) => near(w / b.text[i], 1, .005, 'text size ' + sizes[i]));
      const before = (await metrics(A)).pageLeft;
      await A.cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x: 300, y: 200, deltaX: 240, deltaY: 0, modifiers: 0});
      await poll(() => metrics(A), x => x.pageLeft > before + 20 && Math.abs(x.visual - m.visual) < .01, 'two-finger scroll pans the magnified page');
      await pinch(A, 1 / 1.25); await poll(() => metrics(A), x => x.visual < m.visual - .1, 'pinch out shrinks it back');
      await keys(A, '='); await factorIs(A, 110, 'page zoom step after a pinch'); await poll(() => metrics(A), x => Math.abs(x.visual - 1) < .01, 'a page zoom step clears the pinch');
      await reset(A);
    });
  }
  await app.act({type: 'settings.update', patch: {interfaceScale: 100}}); await sleep(600);

  await check('pinch still works after a cross-site navigation (new renderer)', async () => {
    await app.act({type: 'tab.navigate', tabId: A.id, url: `http://localhost:${fx.port}/b`});
    const page = await app.waitWeb(`http://localhost:${fx.port}/b`); await page.locator('h1').waitFor();
    A.page = page; A.cdp = await app.context.newCDPSession(page);
    await pinch(A, 1.5); await poll(() => metrics(A), m => m.visual > 1.3, 'pinch after navigation');
    await reset(A);
  });

  await check('split panes: pinch magnifies one pane, a notch zooms the pane under it, neither touches the other', async () => {
    const B = await open(`http://127.0.0.1:${fx.port}/split-b`);
    await app.main(({BaseWindow}) => BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === 'acira-browser-ui://ui/index.html')).setSize(1500, 1000));
    await app.act({type: 'tab.select', id: A.id}); await app.act({type: 'split.open', tabIds: [A.id, B.id], layout: 'columns'});
    await poll(() => app.ui.evaluate(() => window.acira.getBrowserLayout()), l => l.views.filter(v => v.bounds.width > 0).length >= 2, 'split laid out');
    const bm = await metrics(B);
    await pinch(A, 1.5); await poll(() => metrics(A), m => m.visual > 1.3, 'pane A magnified');
    near((await metrics(B)).visual, 1, .01, 'pane B not magnified');
    await notch(B, 1); await factorIs(B, 110, 'pane B steps');
    assert.equal(Math.round((await native(A)).factor * 100), 100, 'pane A page zoom untouched');
    const bAfter = await metrics(B); near(bAfter.dpr / bm.dpr, 1.1, .01, 'pane B really renders at 110%');
    await pinch(B, 1.4); await poll(() => metrics(B), m => m.visual > 1.25, 'pane B magnified after its own step');
    await app.act({type: 'split.close'}); await reset(A); await reset(B);
  });
} catch (error) { failed = true; console.log('FATAL', error.stack || error); }
finally {
  pumping = false; await sleep(200);
  try { await app?.close(); } catch {}
  try { await fx?.close(); } catch {}
  await fs.rm(root, {recursive: true, force: true}).catch(() => {});
  process.exitCode = failed ? 1 : 0;
}
