// Stream D: memory saver Settings rows work through the real UI. Freezing, sleeping and waking are in d-sleep-raw.mjs
// (Playwright keeps every page visible and captured, so a hidden tab cannot sleep under it).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-sleep'; await fs.rm(root, {recursive: true, force: true});
const report = [];
const app = await startApp({root});
try {
  assert.deepEqual({enabled: true, idleMinutes: 15, neverSleep: [], ...(await app.state()).settings.memorySaver}, {enabled: true, idleMinutes: 15, neverSleep: []}); report.push('memory saver defaults: on, 15 minutes, no exceptions');
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1200); await app.ui.locator('.bs-sidebar nav button', {hasText: 'Tabs'}).first().click(); await sleep(500);
  const row = id => app.ui.locator(`[data-setting="${id}"]`), saver = async () => (await app.state()).settings.memorySaver;
  await row('memory-saver-enabled').getByRole('switch').click(); await poll(async () => (await saver())?.enabled, v => v === false, 'switched off');
  await poll(() => row('memory-saver-sites').getByRole('textbox', {name: 'Add a site'}).isDisabled(), Boolean, 'rows dim while off', 5000);
  await row('memory-saver-enabled').getByRole('switch').click(); await poll(async () => (await saver())?.enabled, v => v === true, 'switched on');
  await row('memory-saver-after').getByRole('button').first().click(); await app.ui.getByRole('option', {name: '30 minutes'}).dispatchEvent('click'); await poll(async () => (await saver())?.idleMinutes, v => v === 30, 'sleep after 30');
  // The site list is an add field (several sites at once, separated by commas or new lines) and an x on every row.
  const sites = row('memory-saver-sites'); await sites.getByRole('textbox', {name: 'Add a site'}).fill('LocalHost:1234/path, https://*.Docs.test/x, not a host!'); await sites.getByRole('button', {name: 'Add', exact: true}).click();
  await poll(async () => (await saver())?.neverSleep, v => v?.join() === 'localhost,docs.test', 'sites normalised'); report.push('Settings rows save on/off, minutes and never-sleep sites (hosts normalised, junk dropped)');
  await sites.getByRole('button', {name: 'Remove docs.test', exact: true}).click(); await poll(async () => (await saver())?.neverSleep, v => v?.join() === 'localhost', 'a site is removed with the x on its row'); report.push('a never-sleep site is removed with the x on its row');
  const refused = await app.act({type: 'settings.update', patch: {memorySaver: {enabled: true, idleMinutes: 0, neverSleep: []}}}).then(() => false, () => true);
  assert.ok(refused || (await saver()).idleMinutes === 30, 'an invalid minutes value is refused'); report.push('an invalid minutes value is refused');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} finally { await app.close(); }
