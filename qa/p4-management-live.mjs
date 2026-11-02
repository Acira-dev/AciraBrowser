// chrome.management on the real app (ext-api/management*.cjs): a store extension is installed into an isolated profile through Acira's own
// install path, a tiny unpacked "driver" extension with the management permission lists / disables / re-enables / uninstalls it from its own page
// (hidden window, user gesture through executeJavaScript), and a second extension removes itself with uninstallSelf. Every confirmation dialog the
// app asks is answered like a person clicking the second button and recorded, so the text can be checked.
//   node qa/p4-management-live.mjs [storeSlug]      (cwd = repo; one native slot, one app; hard cap 8 minutes)
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated, installWithRetry as install, openExtensionPage, sleep} from './p4-live.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const STORE = {darkreader: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', sponsorblock: 'mnjggcdmjocbbbhaepdhchncahnbgone', ryd: 'gebbhagfogifgggkldgodflihgfeippi'};
const slug = process.argv[2] || 'darkreader';
const storeId = STORE[slug];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve('qa/artifacts/p4-management-live', stamp);
await fs.mkdir(OUT, {recursive: true});
const log = [];
const note = (...args) => { const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '); log.push(line); console.log(line); };
const deadline = Date.now() + 8 * 60_000;
const guard = () => { if (Date.now() > deadline) throw new Error('8 minute cap reached'); };

/** An unpacked extension folder: one page, the given permissions. Written outside the repo (short path). */
async function writeExtension(name, permissions) {
  const dir = path.resolve('C:/ae/p4', 'ext-' + name + '-' + stamp.slice(-8, -1));
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({manifest_version: 3, name: `P4 ${name}`, version: '1.0', description: 'P4 live check helper', permissions,
    options_ui: {page: 'page.html', open_in_tab: true}, action: {default_title: name}}, null, 2));
  await fs.writeFile(path.join(dir, 'page.html'), '<!doctype html><meta charset=utf-8><title>P4 helper</title><p>helper page</p>');
  return dir;
}
async function loadUnpacked(app, dir) {
  await app.main(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); }, dir);
  const result = await app.ext({type: 'load'});
  const entry = (result.extensions || []).find(e => e.name && e.name.startsWith('P4 ') && e.status === 'loaded' && path.basename(dir).includes(e.name.slice(3)));
  if (!entry) throw new Error('helper did not load: ' + JSON.stringify(result).slice(0, 300));
  return entry.id;
}
const listed = async (app, id) => (await app.ext({type: 'list'})).extensions.find(e => e.id === id);

const slot = await takeSlot('p4-management-live');
let app;
const pages = [];
const result = {slug, storeId, steps: []};
const step = (name, value) => { result.steps.push({name, value}); note('STEP', name, value === undefined ? '' : value); };
try {
  app = await launchIsolated('p4m' + Date.now().toString(36).slice(-4));
  const installed = await install(app, storeId);
  assert.ok(!installed.error, 'store install: ' + installed.error);
  step('store extension installed', {name: installed.entry.name, version: installed.entry.version});
  const driverDir = await writeExtension('driver', ['management']);
  const driverId = await loadUnpacked(app, driverDir);
  const plainDir = await writeExtension('plain', []);
  const plainId = await loadUnpacked(app, plainDir);
  step('helpers loaded', {driverId, plainId});
  const driver = await openExtensionPage(app, driverId, 'page.html', 'driver'); pages.push(driver);
  const plain = await openExtensionPage(app, plainId, 'page.html', 'plain'); pages.push(plain);
  guard();

  // 1. getAll sees everything installed, getSelf needs no permission, a page without the permission has only the self members.
  const all = await driver.run(`chrome.management.getAll()`, false);
  assert.ok([storeId, driverId, plainId].every(id => all.some(i => i.id === id)), 'getAll lists the three extensions');
  const target = all.find(i => i.id === storeId);
  step('getAll', {count: all.length, target: {name: target.name, version: target.version, enabled: target.enabled, installType: target.installType, permissions: target.permissions.slice(0, 5), hostPermissions: target.hostPermissions.slice(0, 3), optionsUrl: target.optionsUrl, homepageUrl: target.homepageUrl, icons: (target.icons || []).length}});
  const self = await plain.run(`chrome.management.getSelf()`, false);
  assert.equal(self.id, plainId);
  const members = await plain.run(`Object.keys(chrome.management).filter(k => typeof chrome.management[k] === 'function').sort()`, false);
  assert.deepEqual(members, ['getPermissionWarningsByManifest', 'getSelf', 'uninstallSelf']);
  step('without the management permission', members);
  const denied = await plain.run(`typeof chrome.management.getAll`, false);
  assert.equal(denied, 'undefined');
  const missing = await driver.run(`chrome.management.get('${'a'.repeat(32)}').then(() => 'resolved', e => e.message)`, false);
  assert.equal(missing, `Failed to find extension with id ${'a'.repeat(32)}.`);

  // 2. setEnabled(false) switches the store extension off in Acira's manager; getAll still lists it, with Chromium's disabled fields.
  await driver.run(`chrome.management.setEnabled('${storeId}', false)`, false);
  await sleep(1500);
  let mine = await listed(app, storeId);
  assert.ok(mine && mine.enabled === false && mine.status === 'disabled', 'manager shows it disabled: ' + JSON.stringify(mine && {enabled: mine.enabled, status: mine.status}));
  const off = (await driver.run(`chrome.management.getAll()`, false)).find(i => i.id === storeId);
  assert.ok(off && off.enabled === false && off.disabledReason === 'unknown' && off.mayEnable === true, 'getAll lists the disabled extension');
  assert.equal(off.name, target.name, 'same name when switched off (read from its folder)');
  step('setEnabled(false)', {managerStatus: mine.status, getAllEnabled: off.enabled, disabledReason: off.disabledReason});

  // 3. setEnabled(true) loads it again.
  await driver.run(`chrome.management.setEnabled('${storeId}', true)`, false);
  await sleep(2500);
  mine = await listed(app, storeId);
  assert.ok(mine && mine.enabled === true && mine.status === 'loaded', 'manager shows it loaded again: ' + JSON.stringify(mine && {enabled: mine.enabled, status: mine.status, error: mine.error}));
  step('setEnabled(true)', {managerStatus: mine.status});

  // 4. uninstall of another extension: needs a gesture in a page, asks in Acira's dialog, then removes it.
  const noGesture = await driver.run(`chrome.management.uninstall('${storeId}').then(() => 'resolved', e => e.message)`, false);
  assert.equal(noGesture, 'chrome.management.uninstall requires a user gesture.');
  await app.answer(0);
  const refused = await driver.run(`chrome.management.uninstall('${storeId}').then(() => 'resolved', e => e.message)`, true);
  assert.equal(refused, `Extension ${storeId} uninstall canceled by user.`);
  assert.ok(await listed(app, storeId), 'still installed after Cancel');
  await app.answer(undefined);
  await driver.run(`chrome.management.uninstall('${storeId}')`, true);
  await sleep(1500);
  assert.equal(await listed(app, storeId), undefined, 'removed after Remove');
  const asked = (await app.asked()).filter(q => /remov/i.test(q.message || q.title || ''));
  assert.ok(asked.length >= 2, 'the confirmation was asked: ' + JSON.stringify(asked));
  step('uninstall', {asked: asked.map(q => ({title: q.title, message: q.message, detail: q.detail, buttons: q.buttons}))});

  // 5. uninstallSelf: no dialog by default; with showConfirmDialog it asks, and Cancel keeps the extension.
  await app.answer(0);
  const before = (await app.asked()).length;
  const kept = await plain.run(`chrome.management.uninstallSelf({showConfirmDialog: true}).then(() => 'resolved', e => e.message)`, true);
  assert.equal(kept, `Extension ${plainId} uninstall canceled by user.`);
  assert.equal((await app.asked()).length, before + 1);
  assert.ok(await listed(app, plainId), 'still installed after Cancel');
  await app.answer(undefined);
  await plain.run(`chrome.management.uninstallSelf()`, false);
  await sleep(1500);
  assert.equal(await listed(app, plainId), undefined, 'uninstallSelf without a dialog removed the helper');
  assert.equal((await app.asked()).length, before + 1, 'and asked nothing');
  step('uninstallSelf', {dialogOnlyWhenAsked: true});
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error && error.stack || error).slice(0, 1500);
  note('FAILED', result.error);
} finally {
  for (const p of pages) try { await p.close(); } catch {}
  try { result.asked = await app?.asked(); } catch {}
  try { await app?.close(); } catch {}
  await releaseSlot(slot);
}
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
note(result.ok ? 'PASS' : 'FAIL', 'wrote', OUT);
process.exitCode = result.ok ? 0 : 1;
