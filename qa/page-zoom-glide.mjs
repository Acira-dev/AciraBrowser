// Plus, minus and Reset glide a website's step like a pinch and then land the real zoom (desktop/page-zoom-glide.cjs): on the real app with synthetic input.
//  - plus plays many page-scale frames between 1 and the step (not a cut), then lands the real zoom once at scale 1 with the debugger let go;
//  - the level (tab.zoom, saved memory, the zoom factor main reports) is the target at once, a burst steps from the target, not from the stale real zoom;
//  - minus lays out first and shrinks; Reset glides home; a wheel step, Reduce Motion, a debugger already attached and a page that is gone are the old cut;
//  - a pinch still magnifies afterwards, a zoom step clears it; closing or navigating mid-glide leaves no page scale and no debugger behind;
//  - an Acira page keeps its level and has no transform or held layout left after a step.
// The test window is hidden, so a steady capture of every view stands in for the display's vsync (as in qa/page-zoom-rendering.mjs).
// Run: node qa/page-zoom-glide.mjs        (the profile is a disposable folder under .qa-profiles)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
const root = path.resolve('.qa-profiles/page-zoom-glide-' + Date.now()), mod = process.platform === 'darwin' ? 'meta' : 'control';
let app, fx, failed = false, pumping = true;
const pump = async () => { while (pumping) { await app.main(({webContents}) => Promise.all(webContents.getAllWebContents().map(w => w.capturePage().catch(() => null)))).catch(() => null); await sleep(40); } };
const check = async (name, fn) => {
  try { const detail = await fn(); console.log('PASS ' + name + (detail ? ' ' + detail : '')); }
  catch (error) { failed = true; console.log('FAIL ' + name + '\n  ' + String(error.message || error).split('\n').slice(0, 4).join('\n  ')); }
};
const active = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
const real = url => app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(u)); return {zoom: Math.round(wc.getZoomFactor() * 1000) / 1000, attached: wc.debugger.isAttached()}; }, url);
const UI = 'acira-browser-ui://ui/index.html';
const key = (url, keyCode) => app.main(({webContents}, [u, k, m]) => { const w = webContents.getAllWebContents().find(w => u.startsWith('http') ? w.getURL().startsWith(u) : w.getURL() === u); w.focus(); for (const type of ['keyDown', 'keyUp']) w.sendInputEvent({type, keyCode: k, modifiers: [m]}); }, [url, keyCode, mod]);
// every animation frame of the page: its visual scale and layout width
const watch = page => page.evaluate(() => { window.__frames = []; const t0 = performance.now(); const tick = () => { window.__frames.push([Math.round(performance.now() - t0), +visualViewport.scale.toFixed(3), innerWidth]); if (performance.now() - t0 < 2600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
try {
  fx = await httpFixture((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Glide fixture</title><style>body{margin:0;font:20px sans-serif}.c{display:inline-block;width:180px;height:90px;margin:6px;background:#369}</style><h1>A website</h1>' + '<div class=c></div>'.repeat(400) + '<div style="height:3000px"></div>'); });
  await fs.mkdir(root, {recursive: true});
  app = await startApp({root, skipSetup: true});
  const userData = await app.main(({app: a}) => a.getPath('userData'));
  if (!path.resolve(userData).startsWith(path.resolve('.qa-profiles'))) throw new Error('ABORT: not a disposable profile: ' + userData);
  void pump();
  await app.act({type: 'settings.update', patch: {askBeforeClosing: false, reducedMotion: false, animationSpeed: 'premium'}});
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].setSize(1280, 820));
  const url = `http://127.0.0.1:${fx.port}/`;
  await app.act({type: 'tab.new', url}); const page = await app.waitWeb(url); await page.locator('h1').waitFor(); await sleep(800);
  const cdp = await app.context.newCDPSession(page);

  await check('plus glides the page scale from 1 to the step, lands the real zoom once at scale 1, and lets the debugger go', async () => {
    await watch(page); await key(url, '='); await sleep(1100);
    const frames = await page.evaluate(() => window.__frames), scales = new Set(frames.map(f => f[1]));
    const grown = [...scales].filter(s => s > 1.005 && s < 1.095);
    assert.ok(grown.length >= 5, 'many frames between 1 and 1.1, not a cut: ' + [...scales].join(','));
    const widths = new Set(frames.map(f => f[2])); assert.equal(widths.size, 2, 'the layout changed once: ' + [...widths]);
    const landing = frames.findIndex((f, i) => i && f[2] !== frames[i - 1][2]); assert.equal(frames[landing][1], 1, 'the new layout and scale 1 are in the same frame: ' + JSON.stringify(frames.slice(landing - 1, landing + 1)));
    const r = await real(url); assert.deepEqual(r, {zoom: 1.1, attached: false}); assert.equal((await active()).zoom, 110);
    return `${grown.length} frames`;
  });
  await check('the level is the target at once; a burst steps from the target, not from the real zoom', async () => {
    await key(url, '='); await sleep(50); assert.equal((await active()).zoom, 125, 'the level at 50 ms'); assert.equal((await real(url)).zoom, 1.1, 'the real zoom has not landed');
    await key(url, '='); await sleep(40); await key(url, '='); await sleep(1100);
    assert.equal((await active()).zoom, 175); assert.deepEqual(await real(url), {zoom: 1.75, attached: false}); assert.equal(await page.evaluate(() => visualViewport.scale), 1);
  });
  await check('minus and Reset glide down; Reset lands on 100% at scale 1', async () => {
    await key(url, '-'); await sleep(900); assert.equal((await real(url)).zoom, 1.5);
    await watch(page); await key(url, '0'); await sleep(900);
    const frames = await page.evaluate(() => window.__frames); assert.ok(new Set(frames.map(f => f[1])).size >= 5, 'Reset glided');
    assert.deepEqual(await real(url), {zoom: 1, attached: false}); assert.equal((await active()).zoom, 100); assert.equal(await page.evaluate(() => visualViewport.scale), 1);
  });
  await check('a pinch still magnifies after a glide, and the next zoom step clears it', async () => {
    await key(url, '='); await sleep(900);
    await Promise.race([cdp.send('Input.synthesizePinchGesture', {x: 200, y: 200, scaleFactor: 1.4, relativeSpeed: 600, gestureSourceType: 'mouse'}), sleep(6000)]);
    await poll(() => page.evaluate(() => visualViewport.scale), s => s > 1.2, 'the pinch magnified');
    await key(url, '='); await sleep(900); assert.equal(await page.evaluate(() => visualViewport.scale), 1); assert.equal((await real(url)).zoom, 1.25);
    await key(url, '0'); await sleep(900);
  });
  await check('Reduce Motion is the old cut: the zoom is set at once, nothing attaches', async () => {
    await app.act({type: 'settings.update', patch: {reducedMotion: true}}); await sleep(500);
    await app.main(() => { globalThis.__attach = 0; }); await app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(u)); const a = wc.debugger.attach.bind(wc.debugger); wc.debugger.attach = (...x) => { globalThis.__attach++; return a(...x); }; }, url);
    await key(url, '='); await sleep(150); assert.deepEqual(await real(url), {zoom: 1.1, attached: false}); assert.equal(await app.main(() => globalThis.__attach), 0);
    await key(url, '0'); await sleep(200); await app.act({type: 'settings.update', patch: {reducedMotion: false}}); await sleep(500);
  });
  await check('a debugger already attached (DevTools, an extension) is the old cut, never an error', async () => {
    await app.main(({webContents}, u) => { webContents.getAllWebContents().find(w => w.getURL().startsWith(u)).debugger.attach('1.3'); }, url);
    await key(url, '='); await sleep(300); assert.equal((await active()).zoom, 110); assert.equal((await real(url)).zoom, 1.1);
    await app.main(({webContents}, u) => { webContents.getAllWebContents().find(w => w.getURL().startsWith(u)).debugger.detach(); }, url); await key(url, '0'); await sleep(900);
  });
  await check('navigating mid-glide leaves no page scale and no debugger behind', async () => {
    await key(url, '='); await sleep(60); await app.main(({webContents}, [u, to]) => { webContents.getAllWebContents().find(w => w.getURL().startsWith(u)).loadURL(to); }, [url, url + 'second']);
    const second = await app.waitWeb(url + 'second'); await sleep(1200);
    assert.equal(await second.evaluate(() => visualViewport.scale), 1); assert.equal((await real(url + 'second')).attached, false);
    await key(url + 'second', '0'); await sleep(900);
  });
  await check('an Acira page: a step lands at its level with no transform, animation or held layout left', async () => {
    await app.act({type: 'tab.new', url: 'acira://settings'}); const tab = await poll(active, t => t.url === 'acira://settings', 'settings opened'); await sleep(900);
    await key(UI, '='); await poll(async () => (await active()).zoom, z => z === 110, 'zoom 110'); await sleep(900);
    const d = await app.ui.evaluate(() => { const pane = document.querySelector('.page-content > .page-pane'); return {computed: getComputedStyle(pane.querySelector('.page-zoom-content')).zoom, transform: getComputedStyle(pane).transform, animations: pane.getAnimations().length}; });
    assert.deepEqual(d, {computed: '1.1', transform: 'none', animations: 0}); await key(UI, '0'); await sleep(500); void tab;
  });
} catch (error) { failed = true; console.log('FAIL setup\n  ' + String(error.stack || error).split('\n').slice(0, 6).join('\n  ')); }
finally { pumping = false; try { await app?.close(); } catch {} try { await fx?.close(); } catch {} await fs.rm(root, {recursive: true, force: true}).catch(() => {}); }
process.exit(failed ? 1 : 0);
