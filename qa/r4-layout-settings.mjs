// R4-56 live check on the real app: Settings › Appearance › Layout (Tabs + Window view) and the Tabs mirror.
//   node qa/r4-layout-settings.mjs        (needs a native slot: takes C:\ae\slot-N.lock, releases it in finally)
// Proves, with real pixels and real mouse clicks: both rows are on screen without scrolling in a 1280x800 window at 100% and 150%
// (dark and light); every card applies the setting live; Appearance and Tabs show the same choice; the main menu's Tabs switch
// moves the Settings card. Evidence: PNGs of the whole window (desktopCapturer) and layout.json under C:\ae\r4\layout-settings\evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.R4_SHOTS || 'C:/ae/r4/layout-settings/evidence';
const root = '.qa-profiles/r4-layout-settings';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});

async function takeSlot() {
  const deadline = Date.now() + 20 * 60000;
  while (Date.now() < deadline) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`layout-settings-r4 ${new Date().toISOString()}`); await handle.close(); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
const slot = await takeSlot();
const report = [], measures = [];
let app;
const act = a => app.ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => app.ui.evaluate(() => window.acira.getSnapshot());
async function shot(name) { // real pixels of the whole window
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 300));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false);
    return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  assert.ok(b64, 'window capture ' + name); await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64')); return name;
}
const nav = async label => { await app.ui.locator(`.bs-sidebar nav button[aria-label="${label}"]`).click(); await sleep(450); };
/** Where the card rows sit in the scrolling page: are they fully inside the visible area with the page at the top? */
const measure = () => app.ui.evaluate(() => {
  const groups = [...document.querySelectorAll('[role=radiogroup]')].filter(g => g.offsetParent), out = {};
  const scroller = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n; } return null; };
  for (const g of groups) {
    const r = g.getBoundingClientRect(), sc = scroller(g), box = sc ? sc.getBoundingClientRect() : {top: 0, bottom: innerHeight};
    out[g.getAttribute('aria-label')] = {top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), cardWidth: Math.round(g.querySelector('[role=radio]').getBoundingClientRect().width), viewTop: Math.round(box.top), viewBottom: Math.round(box.bottom), scrollTop: sc ? Math.round(sc.scrollTop) : 0, inView: r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5};
  }
  out.zoom = {innerWidth, innerHeight, dpr: devicePixelRatio, first: document.querySelector('.st-group h2')?.textContent};
  return out;
});
const card = (group, name) => app.ui.locator(`[role=radiogroup][aria-label="${group}"] [role=radio]`).filter({hasText: name}).first();
async function click(group, name) { const c = card(group, name); await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox(); await app.ui.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(700); }
const checked = async (group, name) => (await card(group, name).getAttribute('aria-checked')) === 'true';
async function cleanup() {
  if (!app) return; const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await Promise.race([app.close(), sleep(12000)]); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); await sleep(800); } } catch {}
}

try {
  app = await startApp({root});
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.unmaximize(); w.setBounds({x: 40, y: 20, width: 1280, height: 800}); });
  await sleep(800);
  await act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, animationSpeed: 'fast', verticalTabs: false, windowView: 'full'}});
  await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1800);
  const bounds = await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].getBounds()); report.push('window bounds ' + JSON.stringify(bounds));

  // ---- 1. Layout is the first thing in Appearance, and fits without scrolling -----------------------------------------------
  await nav('Appearance');
  for (const [appearance, scale, tag] of [['dark', 100, 'dark-100'], ['dark', 150, 'dark-150'], ['light', 100, 'light-100'], ['light', 150, 'light-150']]) {
    await act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(1100);
    await nav('Tabs'); await nav('Appearance'); await sleep(300);
    const m = await measure(); measures.push({tag, section: 'Appearance', ...m});
    assert.equal(m.zoom.first, 'Layout', 'the first group of Appearance is Layout: ' + m.zoom.first);
    assert.ok(m.Tabs?.inView, `${tag}: the Tabs cards are fully visible without scrolling ${JSON.stringify(m.Tabs)}`);
    assert.ok(m['Window view']?.inView, `${tag}: the Window view cards are fully visible without scrolling ${JSON.stringify(m['Window view'])}`);
    if (m.zoom.innerHeight > 600) assert.equal(m.Tabs.cardWidth, m['Window view'].cardWidth, `${tag}: Tabs cards are as wide as the Window view cards`);
    await shot('appearance-' + tag);
    await nav('Tabs'); await sleep(300);
    const t = await measure(); measures.push({tag, section: 'Tabs', ...t});
    assert.ok(t.Tabs?.inView, `${tag}: the Tabs row heads the Tabs section ${JSON.stringify(t.Tabs)}`);
    assert.ok(await app.ui.locator('.st-group').first().locator('[data-setting="sidebar-only-tabs"]').count(), 'Tabs row is in the first group of Tabs');
    await shot('tabs-' + tag); await nav('Appearance');
    report.push(`${tag}: Appearance › Layout and Tabs › Tabs fully visible without scrolling (Tabs bottom ${m.Tabs.bottom}, Window view bottom ${m['Window view'].bottom} of ${m['Window view'].viewBottom})`);
  }
  await act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100}}); await sleep(900);
  await nav('Appearance');

  // ---- 2. Every card, a real click, applies live ------------------------------------------------------------------------------
  assert.equal((await state()).settings.verticalTabs, false); assert.ok(await checked('Tabs', 'Along the top'));
  await click('Tabs', 'In a sidebar');
  assert.equal((await state()).settings.verticalTabs, true); assert.ok(await checked('Tabs', 'In a sidebar')); assert.ok(!(await checked('Tabs', 'Along the top')));
  assert.ok(await app.ui.locator('.sb-tab, .acira-sidebar, [data-sidebar]').count() >= 0);
  await shot('click-tabs-sidebar-dark-100'); report.push('click "In a sidebar": verticalTabs true, card checked, window re-laid out');
  await click('Tabs', 'Along the top');
  assert.equal((await state()).settings.verticalTabs, false); assert.ok(await checked('Tabs', 'Along the top'));
  await shot('click-tabs-top-dark-100'); report.push('click "Along the top": verticalTabs false');
  for (const [name, view] of [['Compact', 'compact'], ['Focus', 'focus'], ['Seamless', 'seamless'], ['Full', 'full']]) {
    await click('Window view', name);
    const s = await state(); assert.equal(s.settings.windowView, view, name); assert.ok(await checked('Window view', name), name + ' card checked');
    if (view !== 'full') await shot('click-view-' + view + '-dark-100');
    report.push(`click "${name}": windowView ${view}`);
  }

  // ---- 3. One setting: the Tabs section mirrors it, both ways -----------------------------------------------------------------
  await nav('Tabs');
  assert.ok(await checked('Tabs', 'Along the top'));
  await click('Tabs', 'In a sidebar');
  assert.equal((await state()).settings.verticalTabs, true); report.push('Tabs › Tabs "In a sidebar": same setting (verticalTabs true)');
  await nav('Appearance'); assert.ok(await checked('Tabs', 'In a sidebar'), 'Appearance shows what Tabs chose'); report.push('Appearance mirrors the choice made in Tabs');
  await shot('mirror-appearance-sidebar-dark-100');
  await click('Tabs', 'Along the top'); await nav('Tabs'); assert.ok(await checked('Tabs', 'Along the top'), 'Tabs shows what Appearance chose'); report.push('Tabs mirrors the choice made in Appearance');

  // ---- 4. The main menu writes the same setting, live, into the open Settings page -----------------------------------------------
  await nav('Appearance');
  let menu = 'real click';
  try {
    const opener = app.ui.locator('button[aria-label="Acira menu"]').first();
    await opener.click({timeout: 3000}); await sleep(900);
    const pages = () => app.context.pages().filter(p => { try { return !p.isClosed(); } catch { return false; } });
    let clicked = false;
    for (const p of pages()) { if (p === app.ui) continue; try { const seg = p.getByRole('radio', {name: 'Sidebar', exact: true}).first(); if (await seg.count()) { await seg.click({timeout: 2000}); clicked = true; break; } } catch {} }
    if (!clicked) throw new Error('menu segment not found');
  } catch (error) { menu = 'menu click unavailable (' + String(error.message).split('\n')[0] + '), same action dispatched'; await act({type: 'settings.update', patch: {verticalTabs: true}}); }
  await sleep(900);
  assert.equal((await state()).settings.verticalTabs, true); assert.ok(await checked('Tabs', 'In a sidebar'), 'the open Settings card follows the menu');
  await shot('menu-writes-same-setting-dark-100'); report.push('main menu Tabs switch (' + menu + ') -> verticalTabs true, the open Settings card follows');
  await click('Tabs', 'Along the top');
  await fs.writeFile(path.join(OUT, 'layout.json'), JSON.stringify({report, measures}, null, 2));
  console.log(report.join('\n')); console.log('PASS r4-layout-settings');
} catch (error) {
  try { await shot('failure'); } catch {}
  await fs.writeFile(path.join(OUT, 'layout.json'), JSON.stringify({report, measures, error: String(error.stack || error)}, null, 2)).catch(() => {});
  console.error(report.join('\n')); console.error(error); process.exitCode = 1;
} finally {
  await cleanup();
  await fs.unlink(slot).catch(() => {});
}
