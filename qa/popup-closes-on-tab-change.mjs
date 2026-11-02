// A popup action that changes the active tab (New workspace → Create, a menu row that opens a page) must leave no popup on screen.
// Regression: the commit that followed the tab change published the popup again with no id and the layout echo resurrected it, so
// the New workspace form stayed open after Create and after Enter. Disposable profile, hidden window.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
const root = '.qa-profiles/popup-closes-on-tab-change-' + Date.now(); await fs.mkdir(root, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x'); });
const app = await startApp({root}), report = [];
try {
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/a`}); await sleep(1200);
  const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout()), overlay = () => app.context.pages().find(p => p.url().includes('view=overlay'));
  const settled = async kind => { await poll(layout, l => l.overlay?.kind === kind, kind + ' layout'); await overlay().locator('.popup-content-' + kind).first().waitFor({state: 'attached'}); await sleep(500); };
  for (const how of ['Create button', 'Enter']) {
    await app.ui.getByRole('button', {name: 'Switch profile'}).first().click(); await settled('profile');
    await overlay().getByRole('menuitem', {name: /^New workspace/}).click(); await settled('workspace-edit');
    await overlay().locator('input').first().fill('Fixture ' + how);
    if (how === 'Enter') await overlay().keyboard.press('Enter'); else await overlay().getByRole('button', {name: 'Create'}).click();
    await poll(layout, l => !l.overlay, 'The form closes after ' + how, 4000);
    await sleep(700); assert.equal((await layout()).overlay, undefined, 'and stays closed (' + how + ')');
    report.push('New workspace form closes and stays closed after ' + how);
  }
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
