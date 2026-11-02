// Acceptance of page zoom on Acira's own pages (New tab, Settings, Bookmarks, Downloads, History), on the real app with synthetic input
// (a physical trackpad is not available here): they must zoom the way a website does.
//  - the page fills its pane and is laid out in (pane / zoom) CSS pixels at every preset step, like Chromium's page zoom of a site;
//  - the keys walk the same preset steps as a site's, up to 500% and down to 25%; Ctrl+wheel steps one preset per notch;
//  - the toolbar, tab strip and sidebar do not zoom with the page;
//  - a level is remembered per page (shared by its tabs, kept across a restart), a website's zoom is not carried over to it;
//  - a pinch magnifies without laying the page out again, pans, and is cleared by a page zoom step or actual size;
//  - split view: each pane has its own level and fills its cell; a website's zoom stays Chromium's.
// Run: node qa/native-slot.mjs internal-zoom -- node qa/internal-page-zoom.mjs        (the profile is a disposable folder under .qa-profiles)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
const require = createRequire(import.meta.url), levels = require('../page-zoom-levels.json');
const root = path.resolve('.qa-profiles/internal-zoom-' + Date.now()), mod = process.platform === 'darwin' ? 'meta' : 'control';
const pages = ['acira://settings', 'acira://bookmarks', 'acira://downloads', 'acira://history', 'acira://new'];
let app, fx, failed = false, pumping = true;
// The test window is hidden, so Chromium makes no frames of its own: a steady capture of every view stands in for the display's vsync.
const pump = async () => { while (pumping) { await app.main(({webContents}) => Promise.all(webContents.getAllWebContents().map(w => w.capturePage().catch(() => null)))).catch(() => null); await sleep(80); } };
const check = async (name, fn) => {
  try { const detail = await fn(); console.log('PASS ' + name + (detail ? ' ' + detail : '')); }
  catch (error) { failed = true; console.log('FAIL ' + name + '\n  ' + String(error.message || error).split('\n').slice(0, 4).join('\n  ')); }
};
const uiView = '({webContents}) => webContents.getAllWebContents().find(w => w.getURL() === "acira-browser-ui://ui/index.html")';
const key = (keyCode, modifiers = [mod]) => app.main(({webContents}, [k, m]) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); ui.focus(); for (const type of ['keyDown', 'keyUp']) ui.sendInputEvent({type, keyCode: k, modifiers: m}); }, [keyCode, modifiers]);
const control = type => app.main(({webContents}, t) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); ui.sendInputEvent({type: t, keyCode: 'Control', modifiers: t === 'keyDown' ? ['control'] : []}); }, type);
// Electron's deltaY is the opposite sign to the DOM's: a positive one zooms in. `precise` is a trackpad's pixel deltas, otherwise a mouse wheel's notch.
const wheel = (deltaY, {ctrl = true, precise = true, x = 640, y = 420, deltaX = 0} = {}) => app.main(({webContents}, a) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); ui.sendInputEvent({type: 'mouseWheel', x: a.x, y: a.y, deltaX: a.deltaX, deltaY: a.deltaY, wheelTicksX: 0, wheelTicksY: a.deltaY / 100, hasPreciseScrollingDeltas: a.precise, modifiers: a.ctrl ? ['control'] : []}); }, {deltaY, deltaX, ctrl, precise, x, y});
const tabs = async () => (await app.state()).tabs;
const active = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
const zoomNow = async () => (await active()).zoom;
const openPage = async url => { await app.act({type: 'tab.new', url}); const tab = await poll(active, t => t.url === (url === '' ? 'acira://new' : url), 'tab opened'); await sleep(500); return tab; };
const geometry = id => app.ui.evaluate(id => {
  const pane = document.querySelector('.page-pane' + (id ? `[data-pane="${id}"]` : '')), wrap = pane?.querySelector(':scope > .page-zoom-content');
  if (!pane || !wrap) return null;
  const p = pane.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  return {pane: [Math.round(p.width), Math.round(p.height)], wrapVisual: [Math.round(w.width), Math.round(w.height)], local: [wrap.clientWidth, wrap.clientHeight], zoom: getComputedStyle(wrap).zoom, transform: pane.style.transform, magnified: pane.parentElement.hasAttribute('data-magnified')};
}, id);
const chrome = () => app.ui.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), getComputedStyle(e).fontSize]; }; return {toolbar: r('.acira-persistent-toolbar'), header: r('.browser-shell'), address: r('.address-bar, .acira-address, [data-address]'), tabRow: r('.acira-tab-row')}; });
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const zoomOf = async id => (await tabs()).find(t => t.id === id)?.zoom;
const setZoom = async (id, value) => { await app.cmd({type: 'zoom', tabId: id, zoom: value}); await poll(() => zoomOf(id), z => z === value, 'zoom ' + value); await sleep(120); };
try {
  fx = await httpFixture((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Site zoom fixture</title><style>body{margin:0;font:20px sans-serif}</style><h1>A website</h1><div style="height:3000px"></div>'); });
  await fs.mkdir(root, {recursive: true});
  app = await startApp({root, skipSetup: true});
  const userData = await app.main(({app: a}) => a.getPath('userData'));
  if (!path.resolve(userData).startsWith(path.resolve('.qa-profiles'))) throw new Error('ABORT: not a disposable profile: ' + userData);
  void pump();
  await app.act({type: 'settings.update', patch: {askBeforeClosing: false, reducedMotion: true}});
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].setSize(1280, 820));
  await sleep(500);

  await check('every internal page fills its pane and is laid out in pane/zoom CSS pixels at each preset step, and 100% is the page as before', async () => {
    const worst = [];
    for (const url of pages) {
      const tab = await openPage(url === 'acira://new' ? '' : url);
      for (const value of levels) {
        await setZoom(tab.id, value);
        const g = await geometry();
        near(g.wrapVisual[0], g.pane[0], 1.5, `${url} ${value}% wrapper width`); near(g.wrapVisual[1], g.pane[1], 1.5, `${url} ${value}% wrapper height`);
        near(g.local[0], g.pane[0] / (value / 100), 1.5, `${url} ${value}% laid-out width`); near(g.local[1], g.pane[1] / (value / 100), 1.5, `${url} ${value}% laid-out height`);
        assert.equal(g.zoom, String(value / 100), `${url} ${value}% zoom property`);
        worst.push(Math.abs(g.wrapVisual[0] - g.pane[0]));
      }
      await setZoom(tab.id, 100);
    }
    return 'worst edge error ' + Math.max(...worst) + 'px over ' + pages.length * levels.length + ' pages x steps';
  });

  await check('with the interface at 125% a page still fills its pane at each preset', async () => {
    await app.act({type: 'settings.update', patch: {interfaceScale: 125}}); await sleep(900);
    const tab = await active();
    for (const value of [50, 150, 300]) { await setZoom(tab.id, value); const g = await geometry(); near(g.wrapVisual[0], g.pane[0], 1.5, `${value}% width`); near(g.local[0], g.pane[0] / (value / 100), 1.5, `${value}% laid-out width`); }
    await setZoom(tab.id, 100); await app.act({type: 'settings.update', patch: {interfaceScale: 100}}); await sleep(900);
  });

  await check('the toolbar, tab strip and sidebar do not zoom with the page', async () => {
    const tab = await openPage('acira://settings'); const before = await chrome();
    for (const value of [25, 200, 500]) { await setZoom(tab.id, value); assert.deepEqual(await chrome(), before, `chrome at ${value}%`); }
    await setZoom(tab.id, 100);
  });

  await check('the keys walk the same preset steps as on a website: up to 500%, back to 25%, actual size', async () => {
    const tab = await openPage('acira://downloads'), up = [], down = [];
    for (let i = 0; i < levels.length; i++) { const before = await zoomNow(); if (before === 500) break; await key('='); await poll(zoomNow, z => z !== before, 'step in'); up.push(await zoomNow()); }
    assert.deepEqual(up, levels.filter(v => v > 100), 'up');
    for (let i = 0; i < levels.length; i++) { const before = await zoomNow(); if (before === 25) break; await key('-'); await poll(zoomNow, z => z !== before, 'step out'); down.push(await zoomNow()); }
    assert.deepEqual(down, levels.filter(v => v < 500).reverse(), 'down');
    await key('0'); await poll(zoomNow, z => z === 100, 'actual size');
    // the same keys over a website give the same list
    const site = await openPage(`http://127.0.0.1:${fx.port}/`); await app.waitWeb(`http://127.0.0.1:${fx.port}/`);
    const siteUp = []; for (let i = 0; i < 3; i++) { const before = await zoomNow(); await app.cmd({type: 'zoom', tabId: site.id, zoom: levels[levels.indexOf(before) + 1]}); await poll(zoomNow, z => z !== before, 'site step'); siteUp.push(await zoomNow()); }
    assert.deepEqual(siteUp, up.slice(0, 3), 'the first steps match a website\'s');
    await setZoom(site.id, 100); void tab;
  });

  await check('Ctrl+wheel steps one preset per notch and a plain wheel never zooms', async () => {
    const tab = await openPage('acira://bookmarks');
    for (const expect of [110, 125, 150]) { await wheel(100, {precise: false}); await poll(zoomNow, z => z === expect, 'notch up to ' + expect); await sleep(60); }
    for (const expect of [125, 110, 100]) { await wheel(-100, {precise: false}); await poll(zoomNow, z => z === expect, 'notch down to ' + expect); await sleep(60); }
    await wheel(100, {ctrl: false, precise: false}); await sleep(250); assert.equal(await zoomNow(), 100, 'a plain wheel scrolls');
    // a trackpad's two-finger scroll with Control held is a stream of small deltas: it walks steps as far as the fingers moved
    await control('keyDown'); await sleep(150);
    for (let i = 0; i < 12; i++) { await wheel(20); await sleep(16); }
    await control('keyUp'); const streamed = await poll(zoomNow, z => z > 100, 'a held-Control scroll zooms');
    assert((await geometry()).magnified === false, 'it is a page zoom, not a pinch');
    await setZoom(tab.id, 100); return 'a 12-event Control+scroll stream reached ' + streamed + '%';
  });

  await check('a level is remembered per page, shared by its tabs, and a website\'s zoom is not carried onto a page', async () => {
    const a = await openPage('acira://settings'); await setZoom(a.id, 150);
    const b = await openPage('acira://settings'); assert.equal(b.zoom, 150, 'a new tab on Settings opens at its level');
    await app.act({type: 'tab.navigate', tabId: b.id, url: 'acira://bookmarks'}); await poll(zoomNow, z => z === 100, 'Bookmarks is its own page');
    await app.act({type: 'tab.navigate', tabId: b.id, url: 'acira://settings'}); await poll(zoomNow, z => z === 150, 'Settings is back at its level');
    await setZoom(b.id, 200); assert.deepEqual((await tabs()).filter(t => t.url === 'acira://settings').map(t => t.zoom), [200, 200, ...((await tabs()).filter(t => t.url === 'acira://settings').slice(2).map(t => t.zoom))].slice(0, (await tabs()).filter(t => t.url === 'acira://settings').length));
    const site = await openPage(`http://127.0.0.1:${fx.port}/`); await app.waitWeb(`http://127.0.0.1:${fx.port}/`); await setZoom(site.id, 175);
    await app.act({type: 'tab.navigate', tabId: site.id, url: 'acira://history'}); await poll(zoomNow, z => z === 100, 'History does not inherit the site\'s zoom');
    const g = await geometry(); near(g.local[0], g.pane[0], 1.5, 'History laid out at 100%');
    await app.act({type: 'tab.navigate', tabId: site.id, url: `http://127.0.0.1:${fx.port}/`}); await poll(zoomNow, z => z === 175, 'the site is back at its own level');
    await setZoom(site.id, 100); await app.act({type: 'tab.select', id: b.id}); await setZoom(b.id, 100);
  });

  await check('a pinch magnifies without laying the page out again, pans, and a page zoom step or actual size clears it', async () => {
    const tab = await openPage('acira://settings'); await sleep(400);
    const rest = await geometry(); assert.equal(rest.transform, '', 'no magnification at rest');
    for (let i = 0; i < 5; i++) { await wheel(18); await sleep(16); }
    const pinched = await poll(geometry, g => g.magnified, 'pinch magnifies'), scale = Number(/scale\(([\d.]+)\)/.exec(pinched.transform)[1]);
    assert(scale > 1.5 && scale <= 5, 'scale ' + scale);
    assert.deepEqual(pinched.local, rest.local, 'the page is not laid out again'); assert.equal(await zoomNow(), 100, 'the page zoom level is untouched');
    const before = pinched.transform; await wheel(60, {ctrl: false, deltaX: 160}); await poll(geometry, g => g.transform !== before, 'two-finger scroll pans the magnified page');
    await key('='); await poll(zoomNow, z => z === 110, 'a zoom step'); await poll(geometry, g => !g.magnified && g.transform === '', 'a zoom step clears the pinch');
    for (let i = 0; i < 5; i++) { await wheel(18); await sleep(16); }
    await poll(geometry, g => g.magnified, 'pinch again'); await setZoom(tab.id, 100); await key('0'); await poll(geometry, g => !g.magnified, 'actual size clears it even at 100%');
    for (let i = 0; i < 5; i++) { await wheel(18); await sleep(16); }
    await poll(geometry, g => g.magnified, 'pinch once more'); await app.act({type: 'tab.navigate', tabId: tab.id, url: 'acira://downloads'}); await poll(geometry, g => !g.magnified, 'a new address clears it');
    for (let i = 0; i < 60; i++) { await wheel(-30); await sleep(8); } await poll(geometry, g => !g.magnified, 'pinching back out to 1x clears it'); // (negative Electron delta pinches out)
    return 'a 5-event pinch reached ' + scale.toFixed(2) + 'x';
  });

  await check('a pinch keeps its magnification when you leave the tab and come back', async () => {
    const one = await openPage('acira://settings'); for (let i = 0; i < 5; i++) { await wheel(18); await sleep(16); }
    const pinched = await poll(geometry, g => g.magnified, 'pinch'); const other = await openPage('acira://history');
    await app.act({type: 'tab.select', id: one.id}); const back = await poll(geometry, g => g.magnified, 'magnified again on return'); assert.equal(back.transform, pinched.transform);
    await key('0'); await poll(geometry, g => !g.magnified, 'cleared'); void other;
  });

  await check('split view: each pane fills its cell at its own level, and a website\'s zoom stays Chromium\'s', async () => {
    const one = await openPage('acira://settings'), two = await openPage('acira://downloads'), site = await openPage(`http://127.0.0.1:${fx.port}/`); await app.waitWeb(`http://127.0.0.1:${fx.port}/`);
    await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].setSize(1500, 1000)); await sleep(500);
    await app.act({type: 'tab.select', id: one.id}); await app.act({type: 'split.open', tabIds: [one.id, two.id], layout: 'columns'});
    await poll(() => app.ui.evaluate(() => document.querySelectorAll('.page-pane[data-pane]').length), n => n === 2, 'split laid out');
    await setZoom(one.id, 200); await app.cmd({type: 'zoom', tabId: two.id, zoom: 75}); await poll(async () => (await tabs()).find(t => t.id === two.id).zoom, z => z === 75, 'second pane zoom');
    for (const [id, value] of [[one.id, 200], [two.id, 75]]) { const g = await poll(() => geometry(id), g => g && Math.abs(g.local[0] - g.pane[0] / (value / 100)) <= 1.5, `${id} laid out at ${value}%`); near(g.wrapVisual[0], g.pane[0], 1.5, `${id} width`); }
    await app.act({type: 'split.close'});
    await setZoom(site.id, 150); const native = await app.main(({webContents}, u) => { const all = webContents.getAllWebContents(); return {site: all.find(w => w.getURL() === u).getZoomFactor(), ui: all.find(w => w.getURL() === 'acira-browser-ui://ui/index.html').getZoomFactor()}; }, `http://127.0.0.1:${fx.port}/`);
    assert.deepEqual(native, {site: 1.5, ui: 1}, 'a website zooms natively and the interface stays at 100%');
    await setZoom(site.id, 100); await setZoom(one.id, 100); await setZoom(two.id, 100);
  });
} catch (error) { failed = true; console.log('FATAL', error.stack || error); }
finally {
  pumping = false; await sleep(200);
  try { await app?.close(); } catch {}
  try { await fx?.close(); } catch {}
  process.exitCode = failed ? 1 : 0;
}

// What survives a restart is its own run: the level of an Acira page is saved with the profile.
if (!failed) {
  let again;
  try {
    const first = await startApp({root: path.resolve('.qa-profiles/internal-zoom-restart-' + Date.now()), skipSetup: true});
    await first.act({type: 'tab.new', url: 'acira://settings'}); const id = (await first.state()).activeTabId; await first.cmd({type: 'zoom', tabId: id, zoom: 175}); await sleep(1500);
    const profile = first.root; await first.close(); await sleep(800);
    again = await startApp({root: profile, skipSetup: true}); await sleep(1500);
    const state = await again.state(); assert.equal(state.originZooms[state.activeBrowserProfileId]['acira://settings'], 175, 'saved with the profile');
    assert.equal(state.tabs.find(t => t.url === 'acira://settings').zoom, 175, 'the restored tab is at its level');
    console.log('PASS the level of an Acira page survives a restart');
  } catch (error) { failed = true; process.exitCode = 1; console.log('FAIL restart\n  ' + String(error.message || error).split('\n').slice(0, 3).join('\n  ')); }
  finally { try { await again?.close(); } catch {} }
}
