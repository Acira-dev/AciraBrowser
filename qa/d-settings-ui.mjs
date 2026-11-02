// Stream D: the native-core Settings panels work through the real UI (shortcut recording, search engines, downloads, permissions).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-settings-ui'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x'); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
await app.main(({BaseWindow}) => { const win=BaseWindow.getAllWindows()[0]; win.setBounds({x:60,y:40,width:1240,height:860}); win.showInactive(); });
const section = async name => { await app.ui.locator('.bs-sidebar nav button', {hasText: name}).first().click(); await sleep(500); };
const key = (k, modifiers) => app.main(({webContents}, [k, modifiers]) => { const ui = webContents.getAllWebContents().find(w => w.getURL().startsWith('acira-browser-ui://') && !w.getURL().includes('overlay')); ui.focus(); ui.sendInputEvent({type: 'keyDown', keyCode: k, modifiers}); ui.sendInputEvent({type: 'keyUp', keyCode: k, modifiers}); }, [k, modifiers]);
try {
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(500);
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1200);
  // Shortcuts: record, conflict + replace, clear, reset.
  await section('Shortcuts');
  const row = id => app.ui.locator(`[data-setting="shortcut-${id}"]`);
  await row('pin-tab').locator('.sk-keys').click();
  await key('c', ['control']); await poll(() => row('pin-tab').locator('.sk-note').textContent().catch(() => ''), t => /reserved/i.test(t), 'reserved feedback shown'); report.push('reserved combination explained in the row');
  await key('w', ['control']); await poll(() => row('pin-tab').locator('.sk-note').textContent(), text => /Close tab/.test(text), 'conflict names Close tab'); await row('pin-tab').getByRole('button', {name: 'Replace', exact: true}).waitFor({timeout: 5000}); report.push('conflict names the other command and offers Replace');
  await row('pin-tab').getByRole('button', {name: 'Replace', exact: true}).click();
  await poll(async () => (await row('pin-tab').locator('.sk-keys').textContent()).replace(/\s/g,''), t => t === 'CtrlW', 'binding updated'); report.push('Replace reassigns the key');
  await poll(async () => (await app.ui.evaluate(() => window.acira.native({type: 'shortcuts.list'}))).shortcuts.commands.find(command => command.id === 'close-tab').bindings.join(','), t => /Ctrl\+F4/.test(t) && !/Ctrl\+W\b/.test(t), 'old owner keeps its other key'); report.push('previous owner keeps its other binding');
  await row('pin-tab').locator('.sk-reset').click(); await poll(async () => (await row('pin-tab').locator('.sk-keys').textContent()).replace(/\s/g,''), t => t === 'Notset', 'reset'); report.push('Reset returns the command to its default (unbound)');
  await app.ui.getByRole('button', {name: 'Reset all'}).click(); await poll(async () => (await app.ui.evaluate(() => window.acira.native({type: 'shortcuts.list'}))).shortcuts.commands.find(command => command.id === 'close-tab').bindings.join(','), t => /Ctrl\+W/.test(t), 'reset all'); report.push('Reset all restores every default');
  // Search engines: add + validation + remove + bang.
  await section('Search');
  await app.ui.getByLabel('Engine name').fill('Wiki'); await app.ui.getByLabel('Shortcut keyword').fill('!wk'); await app.ui.getByLabel(/Search address/).fill('http://insecure.test/?q=%s'); await app.ui.getByRole('button', {name: 'Add', exact: true}).click();
  await app.ui.locator('.nc-message[data-bad]').waitFor(); report.push('insecure template rejected with a readable message');
  await app.ui.getByLabel(/Search address/).fill('https://en.wikipedia.org/w/index.php?search=%s'); await app.ui.getByRole('button', {name: 'Add', exact: true}).click();
  await poll(async () => (await app.state()).settings.searchProviders?.engines.some(e => e.keyword === 'wk'), Boolean, 'engine saved');
  await app.act({type: 'tab.navigate', url: '!wk ada lovelace', tabId: (await app.state()).tabs.find(t => t.url === base + '/').id}); assert.match((await app.state()).tabs.find(t => t.url.includes('wikipedia')).url, /search=ada%20lovelace/); report.push('added engine works through !w');
  await app.ui.getByRole('button', {name: /^More engines/}).click();
  await app.ui.getByRole('button', {name: 'Remove Wiki', exact: true}).click(); await poll(async () => (await app.state()).settings.searchProviders?.engines.length, n => n === 20, 'engine removed'); report.push('engine removed');
  // Downloads panel.
  await section('Downloads'); const sw = app.ui.locator('[data-setting="downloads-ask"] [role="switch"]'); assert.equal(await sw.getAttribute('aria-checked'), 'false'); await sw.click();
  await poll(async () => (await app.ui.evaluate(() => window.acira.native({type: 'downloads.preferences'}))).downloads.preferences.askWhere, Boolean, 'ask-where saved'); report.push('downloads switch saves the preference');
  // Site permissions: grant via stubbed prompt, then revoke from Settings.
  await app.main(({dialog}) => { dialog.showMessageBox = async () => ({response: 1}); });
  await app.act({type: 'tab.new', url: base + '/perm'}); const page = await app.waitWeb(base + '/perm'); await sleep(400); assert.equal(await page.evaluate(() => Notification.requestPermission()), 'granted');
  await app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url === 'acira://settings').id}); await sleep(400); await section('Privacy');
  await app.ui.getByRole('button', {name: /Reset Notifications for/}).waitFor({timeout: 5000}); report.push('saved permission is listed');
  await app.ui.getByRole('button', {name: /Reset Notifications for/}).click(); await app.ui.getByText('No saved choices').waitFor({timeout: 5000}); report.push('permission reset from Settings');
  // Spelling (a group of Languages since R3-74).
  await section('Languages'); await app.ui.locator('[data-setting="spellcheck-enabled"] [role="switch"]').click();
  await poll(async () => (await app.ui.evaluate(() => window.acira.native({type: 'spellcheck.status'}))).spellcheck.current.enabled, v => v === false, 'spelling off'); report.push('spelling switch reaches the native session');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
