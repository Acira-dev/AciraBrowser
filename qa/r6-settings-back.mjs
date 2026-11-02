// R6 settings-ux, real app: (1) the Settings side menu's "Back to browser" is always on screen, never overlaps a nav row, and a real click
// returns to the browser, at short window heights, 100% and 150%, light and dark; (2) Appearance is a few screens, the Menu and Page zoom
// groups are closed rows that open (by click and by Settings search), and nothing clips.
//   node qa/native-slot.mjs r6-settings -- node qa/r6-settings-back.mjs
// Evidence: window PNGs (desktopCapturer) and measures.json under C:\ae\r6\settings-ux\evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.R6_SHOTS || 'C:/ae/r6/settings-ux/evidence';
const root = '.qa-profiles/r6-settings-back';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});
let app;
const act = a => app.ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => app.ui.evaluate(() => window.acira.getSnapshot());
async function shotOnce(name) {
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 300));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false);
    return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  if (!b64) return false; await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64')); return true;
}
async function shot(name) { for (let i = 0; i < 3; i++) { if (await shotOnce(name)) return; await sleep(600); } console.log('no capture for', name); }
const nav = async label => { await app.ui.locator(`.bs-sidebar nav button[aria-label="${label}"]`).click(); await sleep(500); };
const geometry = () => app.ui.evaluate(() => {
  const r = el => { const b = el.getBoundingClientRect(); return {top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right)}; };
  const back = document.querySelector('.bs-back'), nav = document.querySelector('.bs-sidebar nav'), navBox = nav.getBoundingClientRect();
  const br = back.getBoundingClientRect(), hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
  const rows = [...nav.querySelectorAll('button')].map(b => ({label: b.getAttribute('aria-label'), ...r(b)}));
  // a row is cut by the column's own edge (overflow), so what can touch Back is only what the column shows: rows clipped to the column's bottom
  const overlapsBack = rows.filter(row => Math.min(row.bottom, navBox.bottom) > br.top + 0.5 && row.top < br.bottom - 0.5 && row.top < navBox.bottom && row.bottom > navBox.top).map(row => row.label);
  return {innerHeight, back: r(back), backHeight: Math.round(br.height), nav: r(nav), navScrolls: nav.scrollHeight > nav.clientHeight + 1,
    backInView: br.top >= 0 && br.bottom <= innerHeight, hitIsBack: Boolean(hit && (hit === back || back.contains(hit))), overlapsBack,
    visibleRows: rows.filter(row => row.bottom > navBox.top && row.top < navBox.bottom).length, rows: rows.length};
});
const pageMeasure = () => app.ui.evaluate(() => {
  const main = document.querySelector('.bs-main');
  const folds = [...document.querySelectorAll('.st-fold-details')].map(d => ({title: d.querySelector('h2')?.textContent, open: d.open}));
  const headings = [...document.querySelectorAll('.bs-page .st-group > h2, .bs-page .st-fold h2')].map(h => h.textContent);
  return {viewport: main.clientHeight, content: main.scrollHeight, screens: +(main.scrollHeight / main.clientHeight).toFixed(2), folds, headings, innerWidth, dpr: devicePixelRatio};
});
async function cleanup() {
  if (!app) return; const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await Promise.race([app.close(), sleep(12000)]); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); await sleep(800); } } catch {}
}
const results = [];
try {
  app = await startApp({root});
  await act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100, animationSpeed: 'fast'}});
  await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1800);

  // ---- 1. Back to browser: geometry at every size/scale/theme; the rows scroll inside the column, the footer never does ----------------
  for (const [height, scale, appearance] of [[600, 100, 'light'], [800, 100, 'dark'], [600, 150, 'dark'], [800, 150, 'light'], [900, 125, 'light']]) {
    await app.main(({BaseWindow}, h) => { const w = BaseWindow.getAllWindows()[0]; w.unmaximize(); w.setBounds({x: 40, y: 20, width: 1280, height: h}); }, height);
    await act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(1300);
    await nav('Appearance');
    const g = await geometry(), tag = `back-h${height}-s${scale}-${appearance}`;
    results.push({tag, ...g}); console.log(tag, JSON.stringify(g));
    assert.ok(g.backInView, `${tag}: Back to browser is on screen ${JSON.stringify(g.back)} of ${g.innerHeight}`);
    assert.ok(g.hitIsBack, `${tag}: the point at the centre of Back to browser is Back to browser`);
    assert.equal(g.backHeight, 32, `${tag}: Back keeps its 32px height`);
    assert.deepEqual(g.overlapsBack, [], `${tag}: no nav row runs under Back to browser`);
    assert.ok(g.visibleRows >= 5 || g.innerHeight < 450, `${tag}: at least five rows are visible`);
    if (g.navScrolls) { // scrolled to the end, About is whole and above Back
      await app.ui.evaluate(() => { const n = document.querySelector('.bs-sidebar nav'); n.scrollTop = n.scrollHeight; }); await sleep(250);
      const end = await geometry(); results.push({tag: tag + '-end', ...end});
      assert.deepEqual(end.overlapsBack, [], `${tag}: scrolled to the end, About sits above Back`);
      const about = await app.ui.evaluate(() => { const b = [...document.querySelectorAll('.bs-sidebar nav button')].find(x => x.getAttribute('aria-label') === 'About').getBoundingClientRect(), k = document.querySelector('.bs-back').getBoundingClientRect(); return {aboutBottom: Math.round(b.bottom), backTop: Math.round(k.top)}; });
      assert.ok(about.aboutBottom <= about.backTop, `${tag}: About (${about.aboutBottom}) ends above Back (${about.backTop})`);
      assert.ok(end.nav.bottom <= end.back.top, `${tag}: the rows end (${end.nav.bottom}) above Back (${end.back.top})`);
    }
    await shot(tag);
  }

  // ---- 2. A real click on Back to browser leaves Settings for the tab we came from ------------------------------------------------------
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].setBounds({x: 40, y: 20, width: 1280, height: 600}));
  await act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100}}); await sleep(900);
  for (const mode of ['from-a-tab', 'again']) {
    const s0 = await state();
    for (const t of s0.tabs.filter(t => t.url === 'acira://settings')) await act({type: 'tab.close', id: t.id});
    await sleep(500);
    await act({type: 'tab.new', url: 'about:blank'}); await sleep(600);
    await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
    const before = await state(), cur = before.tabs.find(t => t.id === before.activeTabId);
    assert.equal(cur.url, 'acira://settings');
    const box = await app.ui.locator('.bs-back').boundingBox();
    await app.ui.mouse.click(box.x + box.width / 2, box.y + box.height - 3); await sleep(1000); // 3px above the bottom of the button: the edge of the hit area counts
    const after = await state(), now = after.tabs.find(t => t.id === after.activeTabId);
    console.log(mode, 'historyIndex', cur.historyIndex, 'tabs', before.tabs.length, '->', after.tabs.length, 'now on', now?.url);
    assert.notEqual(now?.url, 'acira://settings', `${mode}: Back to browser left Settings`);
    results.push({tag: 'click-' + mode, tabsBefore: before.tabs.length, tabsAfter: after.tabs.length, landed: now?.url});
  }
  await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);

  // ---- 3. Appearance: a few screens; the folds are closed rows that open (click and search); light/dark x 100/150 -----------------------------
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].setBounds({x: 40, y: 20, width: 1280, height: 800}));
  for (const [appearance, scale] of [['light', 100], ['dark', 100], ['light', 150], ['dark', 150]]) {
    await act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(1300);
    await nav('Tabs'); await nav('Appearance'); await sleep(500);
    const m = await pageMeasure(), tag = `appearance-${appearance}-${scale}`;
    results.push({tag, ...m}); console.log(tag, JSON.stringify({screens: m.screens, headings: m.headings, folds: m.folds}));
    assert.ok(m.folds.length >= 2 && m.folds.every(f => !f.open), `${tag}: the folds start closed`);
    assert.ok(m.content <= 3100, `${tag}: Appearance is ${m.content}px tall (${m.contentAllFoldsOpen}px with every group open)`);
    await shot(tag + '-top');
    await app.ui.evaluate(() => { document.querySelector('.bs-main').scrollTop = 1e6; }); await sleep(400); await shot(tag + '-end');
    await app.ui.evaluate(() => { document.querySelector('.bs-main').scrollTop = 0; }); await sleep(300);
  }
  await act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100}}); await sleep(1200);
  await nav('Appearance');
  const menuRow = app.ui.locator('.st-fold-details > summary', {hasText: 'Menu'}).first();
  await menuRow.scrollIntoViewIfNeeded(); await menuRow.click(); await sleep(700);
  assert.ok(await app.ui.evaluate(() => [...document.querySelectorAll('.st-fold-details')].find(d => d.querySelector('h2')?.textContent === 'Menu').open), 'clicking the Menu row opens it');
  await poll(() => app.ui.locator('[data-setting="menu-customize"]').isVisible(), Boolean, 'the menu customizer shows once opened', 4000);
  await shot('menu-open-light-100');
  await menuRow.click(); await sleep(600);
  assert.ok(!(await app.ui.locator('[data-setting="menu-customize"]').isVisible()), 'and it closes again');
  await app.ui.locator('.st-search-field input').fill('customize menu'); await sleep(500);
  await app.ui.keyboard.press('Enter'); await sleep(1500);
  assert.ok(await app.ui.locator('[data-setting="menu-customize"]').isVisible(), 'a Settings search for "customize menu" opens the closed Menu group and shows the row');
  await shot('search-opened-menu');
  await fs.writeFile(path.join(OUT, 'measures.json'), JSON.stringify(results, null, 2));
  console.log('R6 settings rig OK');
} finally { await cleanup(); }
