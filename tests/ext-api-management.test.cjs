'use strict';
// chrome.management (WP4, ext-api/management*.cjs): getAll / get / getSelf / setEnabled / uninstall / uninstallSelf with Chromium's errors.
// Main side: the real package on a fake router, a fake extension manager (the bridge) and a fake session. Renderer side: the real patched
// preload in a vm (fixtures/ext-api/world.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const bridge = require('../desktop/browser-services/ext-api/management/bridge.cjs');
const {createPermissionTable} = require('../desktop/browser-services/extension-permission-table.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const OTHER = 'bcdefghijklmnopabcdefghijklmnopa';
const DISABLED = 'cdefghijklmnopabcdefghijklmnopab';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const callerManifest = {manifest_version: 3, name: 'Caller', version: '2.0', permissions: ['management', 'storage'], host_permissions: ['https://a.example/*'],
  icons: {48: 'i48.png', 16: '/i16.png'}, options_ui: {page: 'options.html'}, homepage_url: 'https://caller.example/'};
const plainManifest = {manifest_version: 3, name: 'Plain', version: '1'};

/** A folder with a switched-off extension: localized name and description, version_name, host permissions. */
function disabledFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-mgmt-'));
  fs.mkdirSync(path.join(folder, '_locales', 'en'), {recursive: true});
  fs.writeFileSync(path.join(folder, '_locales', 'en', 'messages.json'), JSON.stringify({appName: {message: 'Sleeping tool'}, appDesc: {message: 'Does nothing until woken.'}}));
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({manifest_version: 3, name: '__MSG_appName__', description: '__MSG_appDesc__', default_locale: 'en',
    version: '3.1', version_name: '3.1 beta', permissions: ['tabs', 'storage'], host_permissions: ['https://z.example/*', '*://*.y.test/*'], theme: undefined}));
  return folder;
}

function setup({answer = 1, withHooks = true, commandError = null, callerSource = 'Chrome Web Store', callerManifestOverride} = {}) {
  const handlers = new Map(), shown = [], commands = [], logs = [];
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent() {}, broadcastEvent() {}};
  const folder = disabledFolder();
  const caller = {id: ID, name: 'Caller', version: '2.0', manifest: callerManifestOverride || callerManifest, path: '/nowhere/caller'};
  const other = {id: OTHER, name: 'Other', version: '1', manifest: plainManifest, path: '/nowhere/other'};
  const loaded = [caller, other];
  const extensions = new Map(loaded.map(e => [e.id, e]));
  const session = {extensions: {getAllExtensions: () => [...extensions.values()], getExtension: id => extensions.get(id) || null, on() {}}};
  const entries = [
    {id: ID, path: caller.path, name: 'Caller', version: '2.0', source: callerSource, enabled: true},
    {id: OTHER, path: other.path, name: 'Other', version: '1', source: 'Local folder', enabled: true},
    {id: DISABLED, path: folder, name: '__MSG_appName__', version: '3.1', source: 'Chrome Web Store', enabled: false}
  ];
  const hooks = {profileId: 'p1', entries: () => entries, command: async request => {
    commands.push(request);
    if (commandError) return {error: commandError};
    return {extensions: []};
  }};
  if (withHooks) bridge.attach(session, hooks);
  const permissions = createPermissionTable({userData: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-mgmt-perm-')), storeKey: 'p1', getExtension: id => extensions.get(id) || null});
  const dialog = {showMessageBox: async (...args) => { shown.push(args); return {response: answer, checkboxChecked: false}; }};
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'management');
  extApi.installPackages({session, runtime: {ctx: {router}}, router, userData: os.tmpdir(), storeKey: 'p1', getExtension: id => extensions.get(id) || null, emit() {}, dialog,
    getWindow: () => ({id: 1}), t: (id, params) => (params ? `${id} ${JSON.stringify(params)}` : id), permissions, log: (...args) => logs.push(args.join(' '))}, {packages, log() {}});
  const call = (as, name, ...args) => handlers.get(name).callback({type: 'service-worker', extension: as}, ...args);
  return {call, caller, other, shown, commands, logs, folder, dialog};
}
const error = message => ({__acira_error: message});

test('the package claims chrome.management and ships both halves', () => {
  const pkg = extApi.loadPackages({fresh: true}).find(p => p.name === 'management');
  assert.deepEqual(pkg.namespaces, ['management']);
  assert.equal(typeof pkg.install, 'function');
  assert.equal(typeof pkg.renderer, 'function');
});

test('getAll: every installed extension including a switched-off one, ExtensionInfo as Chromium builds it; needs the management permission', async () => {
  const t = setup();
  const all = await t.call(t.caller, 'management.getAll');
  assert.deepEqual(all.map(i => [i.id, i.enabled]), [[ID, true], [OTHER, true], [DISABLED, false]]);
  const self = all[0];
  assert.deepEqual(self, {id: ID, name: 'Caller', shortName: 'Caller', description: '', version: '2.0', versionName: '', mayDisable: true, enabled: true, isApp: false,
    type: 'extension', homepageUrl: 'https://caller.example/', offlineEnabled: false, optionsUrl: `chrome-extension://${ID}/options.html`,
    permissions: ['management', 'storage'], hostPermissions: ['https://a.example/*'], installType: 'normal', updateUrl: 'https://clients2.google.com/service/update2/crx',
    icons: [{size: 16, url: `chrome-extension://${ID}/i16.png`}, {size: 48, url: `chrome-extension://${ID}/i48.png`}]});
  const off = all[2];
  assert.equal(off.name, 'Sleeping tool', '__MSG_ placeholders are resolved from the default locale');
  assert.equal(off.description, 'Does nothing until woken.');
  assert.deepEqual([off.version, off.versionName, off.enabled, off.disabledReason, off.mayEnable], ['3.1', '3.1 beta', false, 'unknown', true]);
  assert.deepEqual(off.permissions, ['storage', 'tabs'], 'sorted by name, as the C++ std::set');
  assert.deepEqual(off.hostPermissions, ['https://z.example/*', '*://*.y.test/*']);
  assert.equal(off.homepageUrl, `https://chromewebstore.google.com/detail/${DISABLED}`);
  assert.equal(all[1].installType, 'development');
  assert.equal('updateUrl' in all[1], false, 'no update URL for a local folder');
  assert.deepEqual(await t.call(t.other, 'management.getAll'), error('Access to extension API denied.'), 'no management permission');
});

test('get: by id, with Chromium\'s not-found message; getSelf works without the permission', async () => {
  const t = setup();
  assert.equal((await t.call(t.caller, 'management.get', OTHER)).name, 'Other');
  assert.deepEqual(await t.call(t.caller, 'management.get', 'x'.repeat(32)), error(`Failed to find extension with id ${'x'.repeat(32)}.`));
  assert.deepEqual(await t.call(t.other, 'management.get', ID), error('Access to extension API denied.'));
  const self = await t.call(t.other, 'management.getSelf');
  assert.deepEqual([self.id, self.name, self.enabled, self.permissions, self.installType], [OTHER, 'Other', true, [], 'development']);
});

test('getSelf for an extension the manager does not know (loaded by hand) still answers', async () => {
  const t = setup({withHooks: false});
  const self = await t.call(t.other, 'management.getSelf');
  assert.equal(self.id, OTHER);
  assert.deepEqual((await t.call(t.caller, 'management.getAll')).map(i => i.id), [ID, OTHER]);
});

test('setEnabled: asks the manager, does nothing when already in that state, Chromium\'s errors otherwise', async () => {
  const t = setup();
  assert.equal(await t.call(t.caller, 'management.setEnabled', OTHER, true), undefined, 'already enabled');
  assert.deepEqual(t.commands, []);
  assert.equal(await t.call(t.caller, 'management.setEnabled', OTHER, false), undefined);
  assert.equal(await t.call(t.caller, 'management.setEnabled', DISABLED, true), undefined);
  assert.deepEqual(t.commands, [{type: 'disable', extensionId: OTHER}, {type: 'enable', extensionId: DISABLED}]);
  assert.deepEqual(await t.call(t.caller, 'management.setEnabled', 'x'.repeat(32), true), error(`Failed to find extension with id ${'x'.repeat(32)}.`));
  assert.deepEqual(await t.call(t.other, 'management.setEnabled', ID, false), error('Access to extension API denied.'));
  const failing = setup({commandError: 'Another extension change is being reviewed.'});
  assert.deepEqual(await failing.call(failing.caller, 'management.setEnabled', OTHER, false), error('Another extension change is being reviewed.'));
  const unmanaged = setup({withHooks: false});
  assert.deepEqual(await unmanaged.call(unmanaged.caller, 'management.setEnabled', OTHER, false), error(`Extension ${OTHER} cannot be modified by user.`));
});

test('setEnabled on itself answers first and acts a moment later (its pages and worker go away)', async () => {
  const t = setup();
  assert.equal(await t.call(t.caller, 'management.setEnabled', ID, false), undefined);
  assert.deepEqual(t.commands, [], 'not yet');
  await wait(120);
  assert.deepEqual(t.commands, [{type: 'disable', extensionId: ID}]);
});

test('uninstall of another extension is always confirmed; Cancel is the default; declining is Chromium\'s "canceled by user" error', async () => {
  const declined = setup({answer: 0});
  assert.deepEqual(await declined.call(declined.caller, 'management.uninstall', OTHER), error(`Extension ${OTHER} uninstall canceled by user.`));
  assert.deepEqual(declined.commands, []);
  const [parent, options] = declined.shown[0];
  assert.deepEqual(parent, {id: 1});
  assert.deepEqual([options.type, options.buttons, options.defaultId, options.cancelId], ['warning', ['dialog.cancel', 'ext.remove'], 0, 0]);
  assert.equal(options.message, 'ext.removeMessage {"name":"Other"}');
  assert.equal(options.detail, 'ext.removeByDetail {"caller":"Caller"}\n\next.removeDataDetail', 'and that its data goes with it');
  const accepted = setup({answer: 1});
  assert.equal(await accepted.call(accepted.caller, 'management.uninstall', OTHER), undefined);
  assert.deepEqual(accepted.commands, [{type: 'remove', extensionId: OTHER}]);
  assert.deepEqual(await accepted.call(accepted.caller, 'management.uninstall', 'x'.repeat(32)), error(`Failed to find extension with id ${'x'.repeat(32)}.`));
  assert.deepEqual(await accepted.call(accepted.other, 'management.uninstall', ID), error('Access to extension API denied.'));
});

test('uninstallSelf: no dialog unless showConfirmDialog; removal happens after the answer; declining keeps the extension', async () => {
  const quiet = setup();
  assert.equal(await quiet.call(quiet.caller, 'management.uninstallSelf', null), undefined);
  assert.equal(quiet.shown.length, 0, 'no confirmation asked for');
  assert.deepEqual(quiet.commands, []);
  await wait(120);
  assert.deepEqual(quiet.commands, [{type: 'remove', extensionId: ID}]);

  const asked = setup({answer: 1});
  assert.equal(await asked.call(asked.other, 'management.uninstallSelf', {showConfirmDialog: true}), undefined);
  assert.equal(asked.shown.length, 1);
  assert.equal(asked.shown[0][1].detail, 'ext.removeSelfDetail\n\next.removeDataDetail');
  await wait(120);
  assert.deepEqual(asked.commands, [{type: 'remove', extensionId: OTHER}]);

  const refused = setup({answer: 0});
  assert.deepEqual(await refused.call(refused.other, 'management.uninstallSelf', {showConfirmDialog: true}), error(`Extension ${OTHER} uninstall canceled by user.`));
  await wait(120);
  assert.deepEqual(refused.commands, []);

  const unmanaged = setup({withHooks: false});
  assert.deepEqual(await unmanaged.call(unmanaged.caller, 'management.uninstallSelf', null), error(`Extension ${ID} cannot be modified by user.`));
});

// ---------------------------------------------------------------------------------------------------- renderer

function world(manifest, options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'management');
  return extensionWorld(manifest, {packages, ...options});
}
const bare = {manifest_version: 3, name: 'Bare', version: '1'};

test('renderer: without the management permission only getSelf, uninstallSelf and getPermissionWarningsByManifest exist', () => {
  const {chrome} = world(bare, {native: {management: {getPermissionWarningsByManifest: async text => ['warn ' + text]}}});
  assert.deepEqual(Object.keys(chrome.management).filter(key => typeof chrome.management[key] === 'function').sort(), ['getPermissionWarningsByManifest', 'getSelf', 'uninstallSelf']);
  assert.equal(chrome.management.ExtensionType.EXTENSION, 'extension', 'the enums are bound for everyone');
  for (const name of ['getAll', 'get', 'setEnabled', 'uninstall', 'onEnabled']) assert.equal(chrome.management[name], undefined, name);
  assert.equal('getAll' in chrome.management, false);
  assert.equal(typeof chrome.management.getSelf, 'function');
});

test('renderer: with the permission every implemented member and the event objects are there', () => {
  const {chrome} = world({...bare, permissions: ['management']});
  for (const name of ['getAll', 'get', 'getSelf', 'setEnabled', 'uninstall', 'uninstallSelf']) assert.equal(typeof chrome.management[name], 'function', name);
  for (const name of ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled']) assert.equal(typeof chrome.management[name].addListener, 'function', name);
});

test('renderer: Chromium\'s argument errors, promises and callbacks, main-side errors as rejections', async () => {
  const w = world({...bare, permissions: ['management']}, {answer: (name, args) => {
    if (name === 'management.getAll') return [{id: ID}];
    if (name === 'management.get') return error(`Failed to find extension with id ${args[0]}.`);
    return undefined;
  }});
  const {chrome} = w;
  assert.throws(() => chrome.management.setEnabled('x'), /Error in invocation of management\.setEnabled\(string id, boolean enabled, optional function callback\)/);
  assert.throws(() => chrome.management.get(5), {message: 'Error in invocation of management.get(string id, optional function callback): No matching signature.'});
  assert.deepEqual(plain(await chrome.management.getAll()), [{id: ID}]);
  await assert.rejects(chrome.management.get('abc'), {message: 'Failed to find extension with id abc.'});
  const last = await new Promise(resolve => chrome.management.get('abc', (...args) => resolve({args, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message})));
  assert.deepEqual(last, {args: [], lastError: 'Failed to find extension with id abc.'});
});

test('renderer: getSelf needs no permission and returns what the main process built', async () => {
  const w = world(bare, {answer: name => (name === 'management.getSelf' ? {id: ID, name: 'Bare'} : undefined)});
  assert.deepEqual(plain(await w.chrome.management.getSelf()), {id: ID, name: 'Bare'});
});

test('renderer: a confirmation dialog needs a user gesture in a page; uninstallSelf without showConfirmDialog does not', async () => {
  const w = world({...bare, permissions: ['management']}, {worker: false, answer: () => undefined});
  const gestureError = {message: 'chrome.management.uninstall requires a user gesture.'};
  await assert.rejects(w.chrome.management.uninstall(OTHER), gestureError);
  await assert.rejects(w.chrome.management.uninstallSelf({showConfirmDialog: true}), gestureError);
  await assert.rejects(w.chrome.management.uninstall(ID, {showConfirmDialog: true}), gestureError);
  assert.equal(w.calls.filter(c => /uninstall/.test(c.name || '')).length, 0, 'nothing reached the main process');
  await w.chrome.management.uninstallSelf();
  await w.chrome.management.uninstall(ID);
  assert.deepEqual(plain(w.calls.filter(c => /uninstall/.test(c.name || '')).map(c => c.name)), ['management.uninstallSelf', 'management.uninstall']);
  w.setGesture(true);
  await w.chrome.management.uninstall(OTHER);
  await w.chrome.management.uninstallSelf({showConfirmDialog: true});
  assert.equal(w.calls.filter(c => /uninstall/.test(c.name || '')).length, 4);
});

test('renderer: a service worker is not gesture-checked (the dialog is the user\'s decision)', async () => {
  const w = world({...bare, permissions: ['management']}, {answer: () => undefined});
  await w.chrome.management.uninstall(OTHER);
  assert.equal(w.calls.filter(c => c.name === 'management.uninstall').length, 1);
});

test('renderer: granting the permission later makes the members appear without a restart', async () => {
  const w = world({...bare, optional_permissions: ['management']}, {answer: name => (name === 'management.getAll' ? [] : undefined)});
  assert.equal(w.chrome.management.getAll, undefined);
  w.emit('acira.permissions.changed', {permissions: ['management'], origins: []});
  assert.deepEqual(plain(await w.chrome.management.getAll()), []);
  w.emit('acira.permissions.changed', {permissions: [], origins: []});
  assert.equal(w.chrome.management.getAll, undefined);
});

test('renderer: the browser object gets the same namespace', () => {
  const w = world({...bare, permissions: ['management']}, {browser: {runtime: {id: ID}}});
  assert.equal(typeof w.browser.management.setEnabled, 'function');
});
