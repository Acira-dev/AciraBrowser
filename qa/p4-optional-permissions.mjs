// chrome.permissions on the real app with a real, popular Web Store extension: SponsorBlock (6.1.x) declares optional_host_permissions
// ["*://*/*"] and asks for them from its own options page when "Support Invidious" is switched on (permissions.request -> scripting
// registration of its content script for those sites; switching off -> permissions.remove). Driven through its own UI (a click in its options
// page, user gesture through executeJavaScript, hidden window - the person's mouse and focus are never touched):
//   1. install through Acira's store path into an isolated profile (.qa-profiles/…), nothing signed in
//   2. switch the toggle on, answer the permission prompt with Cancel: request resolves false, nothing granted, the toggle snaps back
//   3. switch it on again, answer Allow: prompt text recorded, onAdded fires, getAll / contains show the sites, the content script is registered
//   4. close the app and start it again on the same profile: the grant is still there (contains, getAll, the persisted file, the toggle)
//   5. switch it off: permissions.remove, onRemoved fires, the sites are gone and stay gone in the file
//   node qa/p4-optional-permissions.mjs      (cwd = repo; one native slot; hard cap 9 minutes; app closed in finally)
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launchIsolated, installWithRetry as install, openExtensionPage, sleep} from './p4-live.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const ID = 'mnjggcdmjocbbbhaepdhchncahnbgone';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve('qa/artifacts/p4-optional-permissions', stamp);
await fs.mkdir(OUT, {recursive: true});
const profileName = 'p4o' + Date.now().toString(36).slice(-4);
const result = {extension: 'SponsorBlock', id: ID, steps: []};
const step = (name, value) => { result.steps.push({name, value}); console.log('STEP', name, value === undefined ? '' : JSON.stringify(value).slice(0, 600)); };
const deadline = Date.now() + 9 * 60_000;
const poll = async (read, label, ms = 20_000) => {
  const end = Math.min(deadline, Date.now() + ms);
  while (Date.now() < end) { const value = await read(); if (value) return value; await sleep(400); }
  throw new Error('timed out: ' + label);
};

/** The persisted grant file of the profile (Acira's permission table). */
async function grantsOnDisk(app) {
  const dir = path.join(app.root, 'extension-permissions');
  try {
    const files = await fs.readdir(dir);
    const out = {};
    for (const file of files) out[file] = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    return out;
  } catch { return {}; }
}
const sbGrant = grants => Object.values(grants).map(file => file.grants && file.grants[ID]).find(Boolean) || null;

async function openOptions(app, key) {
  const page = await openExtensionPage(app, ID, 'options/options.html', key);
  await poll(() => page.run(`document.readyState === 'complete' && !!document.getElementById('supportInvidious')`, false), 'options page ready', 30_000);
  // The options page asks confirm() for some toggles; a hidden window would block on the native box.
  await page.run(`(window.confirm = () => true, window.alert = () => {}, window.__events = [], chrome.permissions.onAdded.addListener(p => window.__events.push(['added', p])), chrome.permissions.onRemoved.addListener(p => window.__events.push(['removed', p])), true)`, false);
  return page;
}
const state = page => page.run(`(async () => ({checked: document.getElementById('supportInvidious').checked, all: await chrome.permissions.getAll(), events: window.__events, scripts: (await chrome.scripting.getRegisteredContentScripts()).map(s => ({id: s.id, matches: (s.matches || []).length, js: s.js}))}))()`, false);

const slot = await takeSlot('p4-optional-permissions');
let app, page;
try {
  app = await launchIsolated(profileName);
  const installed = await install(app, ID);
  assert.ok(!installed.error, 'store install: ' + installed.error);
  step('installed', {name: installed.entry.name, version: installed.entry.version});
  page = await openOptions(app, 'opt1');
  const start = await state(page);
  assert.equal(start.checked, false);
  assert.deepEqual(start.all.permissions.sort(), ['scripting', 'storage', 'unlimitedStorage']);
  assert.ok(!start.all.origins.some(o => /invidious|yewtu/.test(o)), 'no Invidious sites yet');
  step('before', {permissions: start.all.permissions, origins: start.all.origins, scripts: start.scripts});

  // 2. Cancel.
  const baseline = (await app.asked()).length; // the install review is already in the list
  await app.answer(0);
  await page.run(`(document.getElementById('supportInvidious').click(), true)`, true);
  await poll(async () => (await app.asked()).length > baseline, 'the prompt was asked');
  await sleep(1500);
  const denied = await state(page);
  assert.deepEqual(denied.events, [], 'no onAdded after Cancel');
  assert.deepEqual(denied.all.origins, start.all.origins, 'nothing granted');
  assert.equal(denied.checked, false, 'SponsorBlock turns its own toggle back off when the request is refused');
  step('cancelled', {asked: (await app.asked()).length - baseline, checked: denied.checked, origins: denied.all.origins.length});

  // 3. Allow.
  await app.answer(undefined);
  await page.run(`(document.getElementById('supportInvidious').click(), true)`, true);
  const granted = await poll(async () => { const s = await state(page); return s.events.some(e => e[0] === 'added') ? s : null; }, 'onAdded after Allow');
  const added = granted.events.find(e => e[0] === 'added')[1];
  assert.ok(added.origins.length > 3 && added.permissions.length === 0, 'onAdded carries the new sites: ' + JSON.stringify(added).slice(0, 200));
  assert.ok(added.origins.every(o => granted.all.origins.includes(o)), 'getAll lists them');
  const contains = await page.run(`chrome.permissions.contains({origins: ${JSON.stringify(added.origins)}})`, false);
  assert.equal(contains, true);
  const registered = await poll(async () => (await state(page)).scripts.find(s => s.id === 'invidious'), 'SponsorBlock registered its content script for the new sites', 20_000);
  assert.ok(registered.matches > 3);
  const asked = await app.asked();
  const prompt = asked.at(-1);
  step('allowed', {onAdded: {permissions: added.permissions, origins: added.origins.length, first: added.origins.slice(0, 3)}, registeredScript: registered, prompt: {title: prompt.title, message: prompt.message, detail: String(prompt.detail || '').split('\n').slice(0, 6), buttons: prompt.buttons}});
  const disk1 = await grantsOnDisk(app);
  assert.deepEqual(sbGrant(disk1).origins.sort(), added.origins.slice().sort(), 'the grant is on disk');
  step('persisted file', {files: Object.keys(disk1), origins: sbGrant(disk1).origins.length});
  await page.close(); page = null;
  await app.close(); app = null;

  // 4. A real restart on the same profile.
  app = await launchIsolated(profileName, {fresh: false});
  const diskAfter = await grantsOnDisk(app);
  assert.deepEqual(sbGrant(diskAfter).origins.sort(), added.origins.slice().sort(), 'the grant file survived');
  page = await openOptions(app, 'opt2');
  const again = await state(page);
  assert.ok(added.origins.every(o => again.all.origins.includes(o)), 'getAll still lists the sites after the restart');
  assert.equal(await page.run(`chrome.permissions.contains({origins: ${JSON.stringify(added.origins)}})`, false), true, 'contains after the restart');
  assert.equal(again.checked, true, 'the toggle is still on (its own setting)');
  assert.equal((await app.asked()).length, 0, 'no prompt after the restart');
  step('after restart', {origins: again.all.origins.length, toggle: again.checked, scripts: again.scripts});

  // 5. Off.
  await page.run(`(document.getElementById('supportInvidious').click(), true)`, true);
  const off = await poll(async () => { const s = await state(page); return s.events.some(e => e[0] === 'removed') ? s : null; }, 'onRemoved after switching off');
  const removed = off.events.find(e => e[0] === 'removed')[1];
  assert.ok(removed.origins.length > 3 && removed.origins.every(o => added.origins.includes(o)));
  assert.equal(await page.run(`chrome.permissions.contains({origins: ${JSON.stringify(added.origins)}})`, false), false);
  assert.ok(!off.all.origins.some(o => added.origins.includes(o)), 'getAll no longer lists them');
  await sleep(500);
  assert.equal(sbGrant(await grantsOnDisk(app)), null, 'and the file no longer holds them');
  step('switched off', {onRemoved: {origins: removed.origins.length}, scripts: off.scripts.map(s => s.id)});
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error && error.stack || error).slice(0, 1800);
  console.log('FAILED', result.error);
} finally {
  try { await page?.close(); } catch {}
  try { result.asked = await app?.asked(); } catch {}
  try { await app?.close(); } catch {}
  await releaseSlot(slot);
}
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
console.log(result.ok ? 'PASS' : 'FAIL', 'wrote', OUT);
process.exitCode = result.ok ? 0 : 1;
