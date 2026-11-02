// Stream D: popup details from M's report - M07 tab viewer edges, M08 command bar label, M35 group editor indents, M36 Esc, M37 close-group confirm,
// M38 submenu drill-in, M42 swatch check. One visible instance, closed in finally.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE = '1';
const root = '.qa-profiles/d-popup-bugs'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`); });
const app = await startApp({root}), report = [];
const overlay = () => app.context.pages().find(p => p.url().includes('view=overlay'));
const near = (a, b, why) => assert.ok(Math.abs(a - b) <= 0.6, `${why}: ${a} vs ${b}`);
// first text glyph x of a node (relative to the popup surface), skipping hidden nodes
const textX = (selector) => overlay().evaluate(selector => {
  const left = document.querySelector('.popup-sheet-material').getBoundingClientRect().left;
  return [...document.querySelectorAll(selector)].filter(n => n.getClientRects().length).map(n => {
    if (n.tagName === 'INPUT') return n.getBoundingClientRect().left + parseFloat(getComputedStyle(n).paddingLeft) - left;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) { if (!t.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(t); if (r.getBoundingClientRect().width) return r.getBoundingClientRect().left - left; } return null;
  }).filter(v => v !== null);
}, selector);
const open = async (tabId, kind, extra = {}) => { await app.cmd({type: 'ui', tabId, action: 'open', kind, ...extra}); await poll(async () => { const o = overlay(); return o ? o.locator('.sheet-popup[data-formation-ready]:not([inert])').count() : 0; }, n => n > 0, kind + ' open', 10000); await sleep(300); };
const popupGone = async () => { await poll(async () => { const o = overlay(); return o ? o.locator('.sheet-popup').count() : 0; }, n => n === 0, 'popup closed', 6000); await sleep(600); };
try {
  for (const p of ['/a', '/b', '/c', '/d']) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}${p}`}); await sleep(350); }
  await sleep(1200);
  const active = (await app.state()).activeTabId;
  // M07: header text, search text and row titles on one x; icons on one x; host column ends on one x whichever row has the cursor
  await open(active, 'tabs');
  const header = (await textX('.popup-content-tabs .popup-header'))[0], search = (await textX('.popup-content-tabs .popup-search input'))[0], titles = await textX('.popup-content-tabs .tab-result strong');
  near(header, search, 'tab viewer header and search text share an edge'); for (const x of titles) near(x, titles[0], 'tab viewer row titles share an edge'); /* A's tiles put the titles one icon further in than the header: header and search text on x=36+24, titles after the tile */
  const icons = await overlay().evaluate(() => { const left = document.querySelector('.popup-sheet-material').getBoundingClientRect().left; return [document.querySelector('.popup-content-tabs .popup-search > svg'), ...document.querySelectorAll('.popup-content-tabs .tab-result > :first-child')].filter(n => n && n.getClientRects().length).map(n => n.getBoundingClientRect().left - left); });
  for (const x of icons) assert.ok(Math.abs(x - icons[0]) <= 2.5, 'tab viewer icon edge: ' + x + ' vs ' + icons[0]); /* the tile is padded 2px inside the search glyph's edge */
  const hostEdges = await overlay().evaluate(() => [...document.querySelectorAll('.popup-content-tabs .tab-result small')].map(n => Math.round(n.getBoundingClientRect().right * 10) / 10));
  assert.ok(hostEdges.length >= 3); for (const x of hostEdges) near(x, hostEdges[0], 'host column'); report.push('M07 tab viewer: header and search text share an edge, row titles share one, icons one edge, hosts one right edge');
  await overlay().keyboard.press('Escape'); await popupGone();
  // M08: the section label counts the rows under it and sits on the text edge
  await open(active, 'palette');
  const label = await overlay().evaluate(() => { const sections = [...document.querySelectorAll('.popup-content-palette [role=group]')]; return sections.map(g => ({label: g.getAttribute('aria-label'), rows: g.querySelectorAll('.palette-row').length})); });
  const tabsSection = label.find(s => /^Open tabs/.test(s.label)); assert.ok(tabsSection, JSON.stringify(label)); assert.equal(tabsSection.label, `Open tabs · ${tabsSection.rows}`, 'count = rows');
  const [sectionX] = await textX('.popup-content-palette .palette-section'), [rowX] = await textX('.popup-content-palette .palette-row'); near(sectionX, rowX, 'palette label edge'); report.push('M08 command bar: "Open tabs · N" counts the rows listed, on the title edge');
  await overlay().keyboard.press('Escape'); await popupGone();
  // groups
  const tabs = (await app.state()).tabs.filter(t => /127\.0\.0\.1/.test(t.url));
  await app.act({type: 'tab.group.create', tabId: tabs[0].id, name: 'Work', color: 'blue'}); const group = (await app.state()).tabGroups[0];
  await app.act({type: 'tab.group.assign', tabIds: [tabs[1].id], groupId: group.id});
  await open(tabs[0].id, 'group-context', {targetTabId: tabs[0].id});
  const rowsX = await textX('.popup-content-group-context .group-menu-row'); assert.ok(rowsX.length >= 6); for (const x of rowsX) near(x, rowsX[0], 'group editor rows'); report.push('M35 group editor: rows with and without icons share one text edge');
  // The group editor (name and colour) is a form flyout (MenuFormFlyout) beside the menu, opened by the "Edit <group>" row.
  await overlay().getByRole('button', {name: 'Edit Work', exact: true}).click(); await overlay().locator('.menu-form-flyout .group-color-swatch').first().waitFor(); await sleep(400);
  // M42: the selected swatch's check sits inside its dot
  const inside = await overlay().evaluate(() => { const swatch = document.querySelector('.group-color-swatch[aria-pressed=true]'), dot = swatch?.querySelector('span')?.getBoundingClientRect(), check = swatch?.querySelector('.group-color-check')?.getBoundingClientRect(); return dot && check ? check.left >= dot.left - .5 && check.right <= dot.right + .5 && check.top >= dot.top - .5 && check.bottom <= dot.bottom + .5 : null; });
  assert.equal(inside, true, 'check inside the dot'); report.push('M42 swatch check sits inside the selected dot');
  // M36: Esc with nothing to revert closes the editor flyout (then the menu on the next Esc); a changed name is reverted first
  const name = overlay().locator('.menu-form-flyout input'); await name.focus(); await name.fill('Changed'); await overlay().keyboard.press('Escape'); await sleep(250);
  assert.equal(await name.inputValue(), 'Work', 'first Esc reverts the name'); assert.ok(await overlay().locator('.menu-form-flyout').count(), 'and keeps the editor open');
  await overlay().keyboard.press('Escape'); await poll(() => overlay().locator('.menu-form-flyout').count(), n => n === 0, 'Esc closes the editor flyout', 4000);
  assert.ok(await overlay().locator('.sheet-popup').count(), 'the menu stays open under it');
  await overlay().keyboard.press('Escape'); await popupGone(); report.push('M36 Esc reverts a changed name, then closes the editor, then the menu');
  await open(tabs[0].id, 'group-context', {targetTabId: tabs[0].id}); await overlay().getByRole('menuitem', {name: 'Rename'}).focus(); await overlay().keyboard.press('Escape'); await popupGone(); report.push('M36 Esc closes the editor from a row');
  // M37: close-group confirm
  await open(tabs[0].id, 'group-context', {targetTabId: tabs[0].id}); await overlay().getByRole('menuitem', {name: /Close group/}).click(); await sleep(500);
  const confirm = await overlay().evaluate(() => ({rows: [...document.querySelectorAll('.popup-content-group-context .group-menu-row')].map(b => ({text: b.textContent.trim(), danger: b.hasAttribute('data-danger'), color: getComputedStyle(b).color})), focus: document.activeElement?.textContent?.trim()}));
  assert.deepEqual(confirm.rows.map(r => r.text), ['Close 2 tabs', 'Cancel']); assert.equal(confirm.rows[0].danger, true); assert.notEqual(confirm.rows[0].color, confirm.rows[1].color, 'destructive reads differently'); assert.equal(confirm.focus, 'Cancel', 'focus starts on the safe action');
  report.push('M37 close-group confirm: sentence case, red destructive row, focus on Cancel');
  await overlay().keyboard.press('Escape'); await sleep(400); assert.ok(await overlay().getByRole('menuitem', {name: 'Rename'}).count(), 'Esc in the confirm goes back one level (Cancel)');
  await overlay().keyboard.press('Escape'); await popupGone();
  // M38: the group drill-in replaces the whole tab menu
  await open(tabs[2].id, 'tab-context', {targetTabId: tabs[2].id}); await overlay().getByRole('menuitem', {name: /Move to tab group/}).click(); await sleep(500);
  const visible = (await textX('.popup-content-tab-context .menu-row')).length, labels = await overlay().evaluate(() => [...document.querySelectorAll('.popup-content-tab-context .menu-row')].filter(n => n.getClientRects().length).map(n => n.textContent.trim()));
  assert.deepEqual(labels, ['Tab actions', 'Work', 'New tab group']); assert.equal(visible, 3);
  await overlay().getByRole('menuitem', {name: 'Tab actions'}).click(); await sleep(400); assert.ok((await overlay().evaluate(() => [...document.querySelectorAll('.popup-content-tab-context .menu-row')].filter(n => n.getClientRects().length).length)) > 8, 'Back returns the full menu'); report.push('M38 tab menu: "Move to tab group" replaces the whole list; Back returns it');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
