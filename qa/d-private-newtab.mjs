// Stream D: a private or Tor tab's New tab page never shows anything derived from the normal profile's history (P06): no frequent-site tiles, no recent links,
// no address suggestions from history. The same page in an ordinary tab does show them (the control).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-private-newtab'; await fs.rm(root, {recursive: true, force: true});
const MARK = 'zzmarkerhistory', app = await startApp({root}), report = [];
try {
  for (let at = 0; at < 3; at++) await app.act({type: 'history.restore', visits: Array.from({length: 40}, (_, i) => ({id: `seed-${at}-${i}`, title: `${MARK} page ${i}`, url: `https://${MARK}${i % 8}.example/p${i}`, time: String(1000000 - at * 100 - i).padStart(8, '0'), profileId: ''}))});
  const page = async (privacy) => {
    await app.act({type: 'tab.new', ...(privacy ? {privacy} : {})}); await sleep(1500);
    return app.ui.evaluate(() => { const page = document.querySelector('.newtab, .new-tab-page, [data-newtab], .workspace-newtab') || document.body; return {text: page.innerText, links: [...document.querySelectorAll('a[href], button')].map(n => (n.getAttribute('href') || '') + ' ' + n.textContent).join('\n')}; });
  };
  const ordinary = await page(); assert.match(ordinary.text + ordinary.links, new RegExp(MARK, 'i'), 'control: an ordinary New tab page shows history tiles'); report.push('control: the ordinary New tab page shows history tiles');
  for (const privacy of ['private', 'tor']) { const shown = await page(privacy); assert.doesNotMatch(shown.text + shown.links, new RegExp(MARK, 'i'), `${privacy} tab shows no history-derived tile`); report.push(`a ${privacy} tab's New tab page shows nothing from history`); }
  // the address field's suggestions in a private tab never use the normal history either
  await app.act({type: 'tab.new', privacy: 'private'}); await sleep(1200);
  const input = app.ui.locator('.address-bar input').first(); await input.click(); await input.fill(MARK); await sleep(900);
  const suggestions = await app.ui.evaluate(() => document.body.innerText + [...document.querySelectorAll('[role=option],[role=listbox] *')].map(n => n.textContent).join(' '));
  const overlayText = await (app.context.pages().find(p => p.url().includes('view=overlay'))?.evaluate(() => document.body.innerText) ?? '');
  assert.doesNotMatch(suggestions.replace(MARK + '\n', '') + overlayText, new RegExp(MARK + ' page', 'i'), 'no history suggestion in a private tab'); report.push('address suggestions in a private tab use no history');
} finally { await app.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
