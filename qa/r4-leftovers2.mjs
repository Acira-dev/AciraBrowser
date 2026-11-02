// R4 leftovers (round 4 "polish-leftovers"): live checks with real pointer input.
//   node qa/r4-leftovers2.mjs      (takes a native slot, releases it in finally; evidence in C:\ae\r4\leftovers2\evidence)
// 1. A tab's hover card (strip, compact strip, sidebar) never covers a toolbar control, appears after the intent delay and closes on the press.
// 2. A fresh profile's sidebar has no empty Favorites boxes; the drop zone floats in only while a tab is dragged and no row moves.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1';
const OUT = process.env.R4_SHOTS || 'C:/ae/r4/leftovers2/evidence';
const root = '.qa-profiles/r4-leftovers2';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});
async function takeSlot() {
  const deadline = Date.now() + 20 * 60000;
  while (Date.now() < deadline) {
    for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(file, 'wx'); await h.writeFile(`r4-leftovers2 ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await sleep(15000);
  }
  throw new Error('no native slot');
}
const slot = await takeSlot();
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>Page ${req.headers.host[0].toUpperCase()}</title><body style="font:16px sans-serif;padding:24px"><h1>${req.headers.host}</h1>`); });
const base = name => `http://${name}.localhost:${fx.port}/`;
let app; const report = [];
async function shot(name) {
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows()[0]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 250));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false); return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  assert.ok(b64, 'capture ' + name); await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
}
const uiMove = (x, y) => app.main(({webContents}, p) => { const ui = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://') && !wc.getURL().includes('overlay')); ui.sendInputEvent({type: 'mouseMove', x: p.x, y: p.y}); }, {x, y});
const uiButton = (type, x, y) => app.main(({webContents}, p) => { const ui = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://') && !wc.getURL().includes('overlay')); ui.sendInputEvent({type: p.type, x: p.x, y: p.y, button: 'left', clickCount: 1}); }, {type, x, y});
const cardBounds = () => app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; for (const child of win.contentView.children) { try { if (child.webContents.getURL().includes('tab-card.html') && child.getVisible()) return child.getBounds(); } catch {} } return null; });
const rect = r => ({l: r.x, t: r.y, r: r.x + r.width, b: r.y + r.height});
const hits = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
/** The first tab row that is not the open tab, its box, the toolbar's controls and the bottom of the whole top chrome (CSS px at 100% = DIPs). */
const probe = () => app.ui.evaluate(() => {
  const rows = [...document.querySelectorAll('.browser-tab[data-tab-id],.acira-compact-tab[data-tab-id],.sb-tab[data-tab-id]')].filter(n => n.getClientRects().length && !n.closest('[inert]') && n.getAttribute('aria-selected') !== 'true' && n.getAttribute('aria-current') !== 'true' && n.getAttribute('aria-current') !== 'page');
  const row = rows[1] || rows[0]; if (!row) return null;
  const box = row.getBoundingClientRect(), shell = document.querySelector('.browser-shell')?.getBoundingClientRect();
  const controls = [...document.querySelectorAll('.browser-toolbar button,.browser-toolbar input,.browser-toolbar [role=textbox]')].filter(n => n.getClientRects().length && !n.closest('[inert]') && !n.closest('.acira-compact-tabs,.compact-tab-strip') && !n.matches('[data-tab-id]') && !n.closest('[data-tab-id]')).map(n => { const q = n.getBoundingClientRect(); return {x: q.x, y: q.y, width: q.width, height: q.height, label: n.getAttribute('aria-label') || n.className || n.tagName}; });
  return {id: row.dataset.tabId, side: row.matches('.sb-tab'), box: {x: box.x, y: box.y, width: box.width, height: box.height}, shellBottom: shell?.bottom ?? 0, controls};
});
async function hoverScenario(label, patch, ui) {
  await app.act({type: 'settings.update', patch}); await app.act({type: 'ui.update', patch: ui}); await sleep(1100);
  const p = await probe(); assert.ok(p, label + ': a tab row to hover');
  const cx = Math.round(p.box.x + p.box.width / 2), cy = Math.round(p.box.y + p.box.height / 2);
  await uiMove(5, 5); await sleep(150);
  await uiMove(cx - 3, cy); await uiMove(cx, cy);
  await sleep(250); assert.equal(await cardBounds(), null, label + ': no card inside the 450 ms intent delay');
  const card = await poll(cardBounds, Boolean, label + ' card appears', 4000);
  const c = rect(card), tab = rect(p.box);
  // The card's view starts at the page area: under the toolbar for the strip, beside the tab for the sidebar. It never touches a toolbar control or its own tab.
  for (const control of p.controls) assert.ok(!hits(c, rect(control)), `${label}: the card covers toolbar control "${control.label}" (card ${JSON.stringify(card)}, control ${JSON.stringify(control)})`);
  assert.ok(!hits(c, tab), label + ': the card does not cover its own tab');
  if (!p.side) assert.ok(card.y >= p.shellBottom - 1, `${label}: card top ${card.y} is under the top chrome (${p.shellBottom})`);
  await shot('hover-' + label); report.push(`${label}: card y ${card.y}, chrome bottom ${Math.round(p.shellBottom)}, ${p.controls.length} toolbar controls checked`);
  await uiButton('mouseDown', cx, cy); await sleep(60);
  assert.equal(await cardBounds(), null, label + ': a press closes the card at once');
  await uiButton('mouseUp', cx, cy); await sleep(200); await uiMove(5, 5); await sleep(300);
}
try {
  app = await startApp({root});
  await app.act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, language: 'en', tabHoverCard: 'preview'}});
  for (const n of 'abcdefgh') { await app.act({type: 'tab.new', url: base(n)}); await app.waitWeb(base(n)); }
  await sleep(1200);
  // ---- 1. hover cards
  await hoverScenario('strip-full', {verticalTabs: false, windowView: 'full'}, {workspaceOpen: false, webWorkspaceOpen: false, view: null});
  await hoverScenario('strip-compact', {verticalTabs: false, windowView: 'compact'}, {workspaceOpen: false, webWorkspaceOpen: false, view: 'compact'});
  await hoverScenario('sidebar-full', {verticalTabs: true, windowView: 'full'}, {workspaceOpen: true, webWorkspaceOpen: true, view: null});
  // ---- 2. an empty Favorites area draws nothing; the drop zone floats in while a tab is dragged
  await app.act({type: 'settings.update', patch: {verticalTabs: true, windowView: 'full'}}); await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true, view: null}}); await sleep(900);
  const rest = await app.ui.evaluate(() => ({ghosts: document.querySelectorAll('.acira-sidebar .sb-app-ghost').length, float: !!document.querySelector('.acira-sidebar .sb-apps-float'), tiles: document.querySelectorAll('.acira-sidebar .sb-app').length, band: !!document.querySelector('.acira-sidebar .sb-caption'), firstRow: (() => { const r = document.querySelector('.acira-sidebar .sb-tab')?.getBoundingClientRect(); return r ? Math.round(r.top) : null; })()}));
  assert.deepEqual({ghosts: rest.ghosts, float: rest.float, tiles: rest.tiles, band: rest.band}, {ghosts: 0, float: false, tiles: 0, band: true}, 'sidebar at rest: no empty boxes');
  await shot('sidebar-empty-rest'); report.push(`sidebar at rest: no tiles, first tab row at y ${rest.firstRow}`);
  const row = await app.ui.evaluate(() => { const r = [...document.querySelectorAll('.acira-sidebar .sb-tab')].filter(n => n.getClientRects().length)[2]?.getBoundingClientRect(); return r ? {x: r.x + r.width / 2, y: r.y + r.height / 2} : null; });
  assert.ok(row, 'a sidebar tab to drag');
  await uiMove(row.x, row.y); await uiButton('mouseDown', row.x, row.y);
  for (let step = 1; step <= 8; step++) { await uiMove(row.x, row.y - (row.y - 20) * step / 8); await sleep(40); }
  await sleep(300);
  const during = await app.ui.evaluate(() => ({float: !!document.querySelector('.acira-sidebar .sb-apps-float'), dropping: !!document.querySelector('.acira-sidebar .sb-apps-ghost[data-dropping]'), firstRow: (() => { const r = document.querySelector('.acira-sidebar .sb-tab')?.getBoundingClientRect(); return r ? Math.round(r.top) : null; })()}));
  await shot('sidebar-drag-zone');
  await uiButton('mouseUp', row.x, 20); await sleep(500);
  assert.equal(during.float, true, 'the drop zone shows while a tab is dragged');
  assert.equal(during.firstRow, rest.firstRow, 'no row moves under the pointer');
  const after = await app.ui.evaluate(() => ({float: !!document.querySelector('.acira-sidebar .sb-apps-float'), tiles: document.querySelectorAll('.acira-sidebar .sb-app:not(.sb-app-ghost)').length}));
  report.push(`drag: zone ${during.float ? 'shown' : 'missing'}, dropping ${during.dropping}, first row ${rest.firstRow} -> ${during.firstRow}; after drop zone ${after.float ? 'still there' : 'gone'}, favorites ${after.tiles}`);
  console.log(JSON.stringify({status: 'PASS', report}, null, 1));
} catch (error) {
  console.log(JSON.stringify({status: 'FAIL', error: String(error?.stack || error).slice(0, 1800), report}, null, 1)); process.exitCode = 1;
} finally {
  if (app) { try { await Promise.race([app.close(), sleep(12000)]); } catch {} }
  await fx.close().catch(() => {}); await fs.unlink(slot).catch(() => {});
}
