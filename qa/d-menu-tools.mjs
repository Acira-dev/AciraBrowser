// Stream D: main menu "More tools" (clarity audit C05/C03): Print, Save page, Copy page address, Developer tools and Clear browsing data sit in the More tools panel
// with the rarer rows. Save page as… carries no key hint (Ctrl+S stays the sidebar toggle). Copy runs and closes the panel; acira:// pages disable the page tools.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-menu-tools'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>`); });
const app = await startApp({root}), report = [];
try {
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/page`}); await app.waitWeb(`http://127.0.0.1:${fx.port}/page`); await sleep(600);
  const overlay = () => app.context.pages().find(p => p.url().includes('view=overlay'));
  const open = async kind => { const tab = (await app.state()).activeTabId; await app.cmd({type: 'ui', tabId: tab, action: 'open', kind}); await poll(async () => { const o = overlay(); return o ? o.locator('.sheet-popup[data-formation-ready]:not([inert]) .menu-row').count() : 0; }, n => n > 2, kind + ' rows', 10000); await sleep(300); return overlay(); };
  const rows = o => o.evaluate(() => [...document.querySelectorAll('.browser-popup .menu-row')].map(x => ({text: ([...x.querySelectorAll('span')].map(n => n.textContent.trim()).find(Boolean) || ''), hint: (x.querySelector('kbd')?.textContent || '').trim(), disabled: x.disabled})));
  let o = await open('menu'); let list = await rows(o);
  const names = list.map(r => r.text); assert.ok(names.includes('More tools'), 'More tools row in the menu'); assert.equal(names.indexOf('More tools') - names.indexOf('Downloads'), 1, 'right after Downloads'); report.push('the main menu has "More tools" right after Downloads');
  await o.getByRole('button', {name: /More tools/}).click();
  await poll(async () => (await rows(overlay())).some(r => r.text === 'Clear browsing data…'), Boolean, 'More tools panel', 8000); await sleep(300); o = overlay(); list = await rows(o);
  assert.deepEqual(list.map(r => r.text), ['All open tabs', 'Search and commands', 'Print…', 'Save page as…', 'Copy page address', 'Developer tools', 'Clear browsing data…', 'Focus', 'Seamless', 'Extensions', 'VPN']);
  assert.equal(list.find(r => r.text === 'Save page as…').hint, '', 'Save page as… shows no Ctrl+S'); assert.ok(list.filter(r => ['Print…', 'Save page as…', 'Copy page address', 'Developer tools', 'Clear browsing data…'].includes(r.text)).every(r => !r.disabled), 'all tools work on a web page'); report.push('the More tools panel lists the page tools with the rarer rows; Save page as… shows no key');
  await o.getByRole('button', {name: /Copy page address/}).click();
  const toast = await poll(async () => (await app.state()).toast, t => t && t.text === 'Link copied', 'copy toast', 8000); assert.ok(toast); report.push('Copy page address copies and says so');
  await poll(async () => { const p = overlay(); return !p || (await p.locator('.sheet-popup').count()) === 0; }, Boolean, 'panel closed after the command', 8000); report.push('running a tool closes the panel');
  // An Acira page has no page to print, save, copy or inspect; Clear browsing data still works.
  await app.act({type: 'tab.new'}); await sleep(900); o = await open('more-tools'); list = await rows(o);
  const state = Object.fromEntries(list.map(r => [r.text, r.disabled])); assert.deepEqual([state['Print…'], state['Save page as…'], state['Copy page address'], state['Developer tools'], state['Clear browsing data…']], [true, true, true, true, false]); report.push('on an Acira page the page tools are disabled and Clear browsing data is not');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
