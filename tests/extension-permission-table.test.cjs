'use strict';
// Acira's extension permission table (desktop/browser-services/extension-permission-table.cjs): the manifest's permissions including the 39
// Electron calls "unknown", optional grants persisted per profile across a restart, containment of host patterns, change notifications.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createPermissionTable, declared, knownPermissions} = require('../desktop/browser-services/extension-permission-table.cjs');

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const manifest = {manifest_version: 3, permissions: ['bookmarks', 'contextMenus', 'storage', 'notAPermission'], host_permissions: ['https://a.example/*'],
  optional_permissions: ['history', 'downloads', 'tabGroups'], optional_host_permissions: ['https://*.example.com/*']};

test('declared: Chromium-known API permissions only (Electron\'s "unknown" ones included), MV2 host patterns go to origins', () => {
  assert.equal(Object.keys(knownPermissions()).length, 64);
  const d = declared(manifest);
  assert.deepEqual(d.permissions, ['bookmarks', 'contextMenus', 'storage']);
  assert.deepEqual(d.origins, ['https://a.example/*']);
  assert.deepEqual(d.optionalPermissions, ['history', 'downloads', 'tabGroups']);
  assert.deepEqual(declared({manifest_version: 2, permissions: ['tabs', '<all_urls>', 'tabGroups']}), {permissions: ['tabs'], origins: ['<all_urls>'], optionalPermissions: [], optionalOrigins: []}, 'tabGroups needs MV3');
});

test('grants are optional-only, persisted per profile, survive a restart, notify, and go on uninstall', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-perm-'));
  const getExtension = id => (id === ID ? {id: ID, manifest} : null);
  const table = createPermissionTable({userData, storeKey: 'p1', getExtension});
  const seen = [];
  table.onChange((id, change) => seen.push([id, change.added.permissions, change.removed.permissions, change.active.permissions.includes('history')]));
  assert.equal(table.has(ID, 'bookmarks'), true, 'an "unknown to Electron" permission from the manifest');
  assert.equal(table.has(ID, 'history'), false);
  assert.deepEqual(table.grant(ID, {permissions: ['history', 'tabs'], origins: ['https://www.example.com/*', 'https://evil.org/*']}),
    {permissions: ['history'], origins: ['https://www.example.com/*']}, 'only what the manifest lists as optional');
  assert.equal(table.has(ID, 'history'), true);
  assert.equal(table.contains(ID, {permissions: ['bookmarks', 'history'], origins: ['https://www.example.com/x/*']}), true);
  assert.equal(table.hasOrigin(ID, 'https://www.example.com/page'), true);
  assert.equal(table.hasOrigin(ID, 'https://evil.org/'), false);
  assert.deepEqual(table.grant(ID, {permissions: ['history']}), {permissions: [], origins: []}, 'nothing new');
  // Restart: a new table over the same folder.
  const again = createPermissionTable({userData, storeKey: 'p1', getExtension});
  assert.equal(again.has(ID, 'history'), true, 'grant survives a restart');
  assert.deepEqual(again.snapshot(), {[ID]: {permissions: ['history'], origins: ['https://www.example.com/*']}});
  assert.equal(createPermissionTable({userData, storeKey: 'p2', getExtension}).has(ID, 'history'), false, 'per profile');
  // The extension object itself works too (router events carry it).
  assert.equal(again.has({id: ID, manifest}, 'history'), true);
  assert.deepEqual(table.revoke(ID, {permissions: ['history', 'bookmarks']}), {permissions: ['history'], origins: []}, 'required ones are never removed');
  assert.equal(table.has(ID, 'bookmarks'), true);
  assert.deepEqual(seen, [[ID, ['history'], [], true], [ID, [], ['history'], false]]);
  table.forget(ID);
  assert.equal(createPermissionTable({userData, storeKey: 'p1', getExtension}).has(ID, 'history'), false);
  assert.deepEqual(createPermissionTable({userData, storeKey: 'p1', getExtension}).granted(ID), {permissions: [], origins: []});
  // A grant counts only while the manifest still lists it as optional (an update can drop it).
  table.grant(ID, {permissions: ['downloads']});
  const updated = createPermissionTable({userData, storeKey: 'p1', getExtension: () => ({id: ID, manifest: {...manifest, optional_permissions: []}})});
  assert.equal(updated.has(ID, 'downloads'), false);
  fs.rmSync(userData, {recursive: true, force: true});
});

test('permissions.request: the prompt lists what is asked in words; yes grants, persists and updates running pages; no changes nothing', async () => {
  const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');
  const {accessLines} = require('../desktop/browser-services/extension-manager.cjs');
  const t = (id, params) => (params ? `${id}(${Object.values(params).join(',')})` : id);
  assert.deepEqual(accessLines(t, {permissions: ['history', 'webNavigation', 'unknownThing'], origins: ['https://*.example.com/*', '*://*/*', '<all_urls>']}),
    ['• ext.perm.site(example.com)', '• ext.perm.allUrls', '• ext.perm.history', '• ext.perm.webNavigation', '• unknownThing']);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-perm-req-'));
  const extension = {id: ID, name: 'Fixture', manifest};
  const handlers = new Map(), sent = [], asked = [];
  let answer = false, refreshed = 0;
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); }, sendEvent: (...args) => sent.push(args)};
  const store = {requestPermissions: async (ext, request) => { asked.push(request); return answer; }};
  const session = {serviceWorkers: {getAllRunning: () => ({})}, extensions: {getExtension: id => (id === ID ? extension : null), on() {}}};
  const apis = installExtensionApis({ctx: {router, store}}, {session, userData, storeKey: 'p', refreshPreload: () => { refreshed++; return true; }, extApiDir: path.join(userData, 'none')});
  const call = (name, ...args) => handlers.get(name).callback({type: 'frame', extension}, ...args);
  assert.equal(await call('permissions.request', {permissions: ['history']}), false, 'the user said no');
  assert.equal(apis.permissions.has(ID, 'history'), false);
  assert.equal(await call('permissions.request', {permissions: ['bookmarks']}), true, 'already held: no prompt');
  assert.equal(asked.length, 1);
  answer = true;
  assert.equal(await call('permissions.request', {permissions: ['history'], origins: ['https://www.example.com/*']}), true);
  assert.deepEqual(call('permissions.getAll').permissions, ['bookmarks', 'contextMenus', 'storage', 'history']);
  assert.equal(call('permissions.contains', {origins: ['https://www.example.com/a/*']}), true);
  assert.deepEqual(sent.at(-1).slice(0, 2), [ID, 'acira.permissions.changed'], 'running pages and workers are told');
  assert.equal(refreshed, 1, 'the preload is rewritten for pages and workers that start later');
  assert.equal(createPermissionTable({userData, storeKey: 'p', getExtension: () => extension}).has(ID, 'history'), true, 'persisted');
  assert.equal(call('permissions.remove', {permissions: ['history']}), true);
  assert.equal(apis.permissions.has(ID, 'history'), false);
  fs.rmSync(userData, {recursive: true, force: true});
});
