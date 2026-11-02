'use strict';
// chrome.permissions (WP4, ext-api/permissions*.cjs): Chromium's semantics and error strings over Acira's permission table.
// Main side: the real package on a fake router with the real table. Renderer side: the real patched preload in a vm (fixtures/ext-api/world.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {createPermissionTable} = require('../desktop/browser-services/extension-permission-table.cjs');
const {parsePattern, normalize, needsPrompt} = require('../desktop/browser-services/ext-api/permissions/unpack.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const manifest = {
  manifest_version: 3, name: 'Optional demo', version: '1.2.3',
  permissions: ['storage', 'tabs'], host_permissions: ['https://required.example/*'],
  optional_permissions: ['history', 'bookmarks', 'alarms', 'notAPermission'], optional_host_permissions: ['https://*.example.com/*', '*://*.shop.test/*'],
  content_scripts: [{matches: ['https://script.example/*'], js: ['cs.js']}]
};
const extension = {id: ID, manifest};
const frame = {type: 'frame', extension};

function setup({prompt = async () => true, userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-perm-api-')), ext = extension} = {}) {
  const handlers = new Map(), sent = [], prompts = [];
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  const permissions = createPermissionTable({userData, storeKey: 'p1', getExtension: id => (id === ID ? ext : null)});
  // The table's request() is WP0's prompt; the test supplies the user's answer the way installExtensionApis does with promptPermissions.
  permissions.request = async (target, request) => {
    prompts.push(plain(request));
    if (permissions.contains(target, request)) return true;
    if (!(await prompt(request))) return false;
    permissions.grant(target, request);
    return permissions.contains(target, request);
  };
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'permissions');
  const installed = extApi.installPackages({session: {}, runtime: {ctx: {router}}, router, userData, storeKey: 'p1', getExtension: id => (id === ID ? ext : null),
    emit: () => {}, permissions, log() {}}, {packages, log() {}});
  const call = (name, ...args) => handlers.get(name).callback({...frame, extension: ext}, ...args);
  return {call, sent, prompts, permissions, installed, userData, handlers};
}
const error = message => ({__acira_error: message});

test('the package claims chrome.permissions and ships both halves', () => {
  const pkg = extApi.loadPackages({fresh: true}).find(p => p.name === 'permissions');
  assert.deepEqual(pkg.namespaces, ['permissions']);
  assert.equal(typeof pkg.install, 'function');
  assert.equal(typeof pkg.renderer, 'function');
});

test('URLPattern::Parse and GetAsString as Chromium: normal forms and the exact error strings', () => {
  assert.equal(normalize('https://*.Example.com/*'), 'https://*.example.com/*');
  assert.equal(normalize('*://*/*'), '*://*/*');
  assert.equal(normalize('http://localhost:8080/a*'), 'http://localhost:8080/a*');
  assert.equal(normalize('<all_urls>'), '<all_urls>');
  assert.equal(normalize('file://*'), 'file:///*');
  const why = text => parsePattern(text).error;
  assert.equal(why('example.com'), 'Missing scheme separator.');
  assert.equal(why('chrome-extension://abc/*'), 'Invalid scheme.');
  assert.equal(why('https:example.com/*'), 'Wrong scheme type.');
  assert.equal(why('https:///*'), 'Host can not be empty.');
  assert.equal(why('https://example.com'), 'Empty path.');
  assert.equal(why('https://example.com:abc/*'), 'Invalid port.');
  assert.equal(why('*://example.com:80/*'), 'Invalid port.', 'a "*" scheme has no default port');
  assert.equal(why('https://*.*.com/*'), 'Invalid host wildcard.');
  assert.equal(why('https://exa mple.com/*'), 'Invalid host.');
  assert.equal(why('https://*./*'), 'Host can not be empty.');
});

test('install warnings: only permissions Chromium warns about (and every host) need the prompt', () => {
  assert.equal(needsPrompt({permissions: ['storage', 'alarms'], origins: []}), false);
  assert.equal(needsPrompt({permissions: ['storage', 'history'], origins: []}), true);
  assert.equal(needsPrompt({permissions: [], origins: ['https://a.example/*']}), true);
  assert.equal(needsPrompt({permissions: ['somethingNew'], origins: []}), true, 'unknown names are confirmed');
});

test('getAll: required + granted optional, content-script hosts included, Chromium-known names only', async () => {
  const t = setup();
  assert.deepEqual(await t.call('permissions.getAll'), {permissions: ['storage', 'tabs'], origins: ['https://required.example/*', 'https://script.example/*']});
  assert.equal(await t.call('permissions.request', {permissions: ['history'], origins: ['https://www.example.com/*']}), true);
  assert.deepEqual(await t.call('permissions.getAll'), {permissions: ['storage', 'tabs', 'history'],
    origins: ['https://required.example/*', 'https://www.example.com/*', 'https://script.example/*']});
});

test('contains: required true, optional only once granted, unlisted false, errors as Chromium', async () => {
  const t = setup();
  assert.equal(await t.call('permissions.contains', {}), true, 'the empty set is contained');
  assert.equal(await t.call('permissions.contains', {permissions: ['storage', 'tabs']}), true);
  assert.equal(await t.call('permissions.contains', {permissions: ['history']}), false);
  assert.equal(await t.call('permissions.contains', {permissions: ['downloads']}), false, 'not in the manifest: never held');
  assert.equal(await t.call('permissions.contains', {origins: ['https://required.example/page/*']}), true, 'inside a required pattern');
  assert.equal(await t.call('permissions.contains', {origins: ['https://script.example/*']}), true, 'content-script hosts are always held');
  assert.equal(await t.call('permissions.contains', {origins: ['https://www.example.com/*']}), false);
  assert.equal(await t.call('permissions.contains', {origins: ['file:///*']}), false, 'no file access');
  assert.deepEqual(await t.call('permissions.contains', {permissions: ['nope']}), error("'nope' is not a recognized permission."));
  assert.deepEqual(await t.call('permissions.contains', {origins: ['example.com']}), error('Invalid value for origin pattern example.com: Missing scheme separator.'));
  await t.call('permissions.request', {origins: ['https://*.example.com/*']});
  assert.equal(await t.call('permissions.contains', {origins: ['https://www.example.com/a/*']}), true, 'a subset of a granted pattern');
  assert.equal(await t.call('permissions.contains', {origins: ['https://example.org/*']}), false);
});

test('request: manifest-only, already-held resolves true without asking, a "no" grants nothing, a "yes" grants and announces onAdded', async () => {
  const answers = [false, true];
  const t = setup({prompt: async () => answers.shift()});
  assert.deepEqual(await t.call('permissions.request', {permissions: ['downloads']}), error('Only permissions specified in the manifest may be requested.'));
  assert.deepEqual(await t.call('permissions.request', {origins: ['https://evil.example/*']}), error('Only permissions specified in the manifest may be requested.'));
  assert.deepEqual(await t.call('permissions.request', {permissions: ['nope']}), error("'nope' is not a recognized permission."));
  assert.deepEqual(await t.call('permissions.request', {origins: ['file:///*']}), error("Extension must have file access enabled to request 'file:///*'."));
  assert.equal(await t.call('permissions.request', {permissions: ['tabs'], origins: ['https://required.example/*']}), true, 'required ones are held');
  assert.equal(t.prompts.length, 0, 'nothing to ask yet');
  assert.equal(await t.call('permissions.request', {permissions: ['history']}), false, 'the user said no');
  assert.equal(await t.call('permissions.contains', {permissions: ['history']}), false);
  assert.deepEqual(t.sent, [], 'no onAdded for a refusal');
  assert.equal(await t.call('permissions.request', {permissions: ['history', 'tabs'], origins: ['https://www.example.com/*']}), true);
  assert.deepEqual(t.prompts, [{permissions: ['history'], origins: []}, {permissions: ['history'], origins: ['https://www.example.com/*']}],
    'only what is new is asked (tabs is already held)');
  assert.deepEqual(t.sent, [[ID, 'permissions.onAdded', {permissions: ['history'], origins: ['https://www.example.com/*']}]]);
  assert.equal(await t.call('permissions.request', {permissions: ['history']}), true, 'held now');
  assert.equal(t.prompts.length, 2, 'and not asked again');
});

test('request: a permission Chromium does not warn about is granted without a prompt', async () => {
  const t = setup({prompt: async () => { throw new Error('no prompt expected'); }});
  assert.equal(await t.call('permissions.request', {permissions: ['alarms']}), true);
  assert.equal(t.prompts.length, 0);
  assert.deepEqual(t.sent, [[ID, 'permissions.onAdded', {permissions: ['alarms'], origins: []}]]);
  assert.equal(await t.call('permissions.contains', {permissions: ['alarms']}), true);
});

test('request: a pattern inside an optional host pattern is granted as asked; scheme wildcards follow the manifest', async () => {
  const t = setup();
  assert.equal(await t.call('permissions.request', {origins: ['https://shop.test/*']}), true);
  assert.equal(await t.call('permissions.contains', {origins: ['https://shop.test/*']}), true);
  assert.equal(await t.call('permissions.contains', {origins: ['http://shop.test/*']}), false);
  assert.equal(await t.call('permissions.contains', {origins: ['https://other.test/*']}), false);
});

test('remove: optional permissions only; required and unlisted are errors; a missing one is silently fine; onRemoved announces the change', async () => {
  const t = setup();
  await t.call('permissions.request', {permissions: ['history'], origins: ['https://www.example.com/*']});
  t.sent.length = 0;
  assert.deepEqual(await t.call('permissions.remove', {permissions: ['tabs']}), error('You cannot remove required permissions.'));
  assert.deepEqual(await t.call('permissions.remove', {origins: ['https://required.example/*']}), error('You cannot remove required permissions.'));
  assert.deepEqual(await t.call('permissions.remove', {origins: ['https://script.example/*']}), error('You cannot remove required permissions.'));
  assert.deepEqual(await t.call('permissions.remove', {permissions: ['downloads']}), error('Only permissions specified in the manifest may be requested.'));
  assert.equal(await t.call('permissions.remove', {permissions: ['bookmarks']}), true, 'never held: still true');
  assert.deepEqual(t.sent, []);
  assert.equal(await t.call('permissions.remove', {permissions: ['history'], origins: ['https://www.example.com/*']}), true);
  assert.deepEqual(t.sent, [[ID, 'permissions.onRemoved', {permissions: ['history'], origins: ['https://www.example.com/*']}]]);
  assert.equal(await t.call('permissions.contains', {permissions: ['history']}), false);
  assert.equal(await t.call('permissions.contains', {origins: ['https://www.example.com/*']}), false);
});

test('grants survive a restart: a new table over the same profile folder still holds them; uninstalling forgets them', async () => {
  const first = setup();
  await first.call('permissions.request', {permissions: ['history', 'bookmarks'], origins: ['https://*.example.com/*']});
  const again = setup({userData: first.userData});
  assert.equal(await again.call('permissions.contains', {permissions: ['history', 'bookmarks']}), true);
  assert.equal(await again.call('permissions.contains', {origins: ['https://www.example.com/x']}), true);
  assert.deepEqual((await again.call('permissions.getAll')).permissions, ['storage', 'tabs', 'history', 'bookmarks']);
  again.permissions.forget(ID);
  assert.equal(setup({userData: first.userData}).permissions.granted(ID).permissions.length, 0, 'removed with the extension');
});

test('an MV2 extension: patterns in permissions are origins; MV3-only names are not its permissions', async () => {
  const mv2 = {id: ID, manifest: {manifest_version: 2, name: 'Old', version: '1', permissions: ['tabs', 'https://old.example/*'], optional_permissions: ['history', 'tabGroups', 'https://*.opt.example/*']}};
  const t = setup({ext: mv2});
  assert.deepEqual(await t.call('permissions.getAll'), {permissions: ['tabs'], origins: ['https://old.example/*']});
  assert.deepEqual(await t.call('permissions.request', {permissions: ['tabGroups']}), error('Only permissions specified in the manifest may be requested.'));
  assert.equal(await t.call('permissions.request', {origins: ['https://a.opt.example/*']}), true);
});

// ---------------------------------------------------------------------------------------------------- renderer

function world(options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'permissions');
  return extensionWorld(options.manifest || manifest, {packages, ...options});
}

test('renderer: chrome.permissions has every Chromium member, with Chromium\'s argument errors', () => {
  const {chrome} = world();
  for (const name of ['getAll', 'contains', 'request', 'remove', 'addHostAccessRequest', 'removeHostAccessRequest']) assert.equal(typeof chrome.permissions[name], 'function', name);
  for (const name of ['onAdded', 'onRemoved']) assert.equal(typeof chrome.permissions[name].addListener, 'function', name);
  assert.throws(() => chrome.permissions.contains(), /Error in invocation of permissions\.contains\(permissions\.Permissions permissions, optional function callback\)/);
  assert.throws(() => chrome.permissions.contains({foo: 1}), /Unexpected property: 'foo'/);
  assert.throws(() => chrome.permissions.request({permissions: 'tabs'}), /Error at parameter 'permissions': Error at property 'permissions': Invalid type: expected array, found string/);
  assert.equal(typeof chrome.permissions.getAll, 'function');
});

test('renderer: the namespace exists for an extension with no permissions at all', async () => {
  const {chrome} = world({manifest: {manifest_version: 3, name: 'Bare', version: '1'}, answer: name => (name === 'permissions.getAll' ? {permissions: [], origins: []} : undefined)});
  assert.deepEqual(plain(await chrome.permissions.getAll()), {permissions: [], origins: []});
});

test('renderer: getAll / contains / remove are promises and callbacks; main-side errors become rejections and lastError', async () => {
  const w = world({answer: (name, args) => {
    if (name === 'permissions.getAll') return {permissions: ['storage'], origins: []};
    if (name === 'permissions.contains') return args[0].permissions && args[0].permissions[0] === 'tabs';
    if (name === 'permissions.remove') return error('You cannot remove required permissions.');
    return undefined;
  }});
  assert.deepEqual(plain(await w.chrome.permissions.getAll()), {permissions: ['storage'], origins: []});
  assert.equal(await w.chrome.permissions.contains({permissions: ['tabs']}), true);
  assert.equal(await w.chrome.permissions.contains({permissions: ['history']}), false);
  await assert.rejects(w.chrome.permissions.remove({permissions: ['tabs']}), {message: 'You cannot remove required permissions.'});
  const seen = await new Promise(resolve => w.chrome.permissions.remove({permissions: ['tabs']}, (...args) => resolve({args, lastError: w.chrome.runtime.lastError && w.chrome.runtime.lastError.message})));
  assert.deepEqual(seen, {args: [], lastError: 'You cannot remove required permissions.'});
});

test('renderer: request needs a user gesture in a page, before anything reaches the main process', async () => {
  const w = world({worker: false, answer: () => true});
  await assert.rejects(w.chrome.permissions.request({permissions: ['history']}), {message: 'This function must be called during a user gesture'});
  assert.equal(w.calls.filter(c => c.name === 'permissions.request').length, 0);
  const lastError = await new Promise(resolve => w.chrome.permissions.request({permissions: ['history']}, () => resolve(w.chrome.runtime.lastError && w.chrome.runtime.lastError.message)));
  assert.equal(lastError, 'This function must be called during a user gesture');
  w.setGesture(true);
  assert.equal(await w.chrome.permissions.request({permissions: ['history']}), true);
  assert.deepEqual(plain(w.calls.filter(c => c.name === 'permissions.request').map(c => c.args)), [[{permissions: ['history']}]]);
});

test('renderer: argument errors win over the gesture check (the bindings validate first); a worker is not gesture-checked', async () => {
  const page = world({worker: false});
  assert.throws(() => page.chrome.permissions.request({permissions: 7}), /Invalid type/);
  const worker = world({answer: () => true});
  assert.equal(await worker.chrome.permissions.request({permissions: ['history']}), true);
});

test('renderer: onAdded / onRemoved reach listeners with the changed set', () => {
  const w = world();
  const heard = [];
  w.chrome.permissions.onAdded.addListener(set => heard.push(['added', plain(set)]));
  w.chrome.permissions.onRemoved.addListener(set => heard.push(['removed', plain(set)]));
  w.emit('permissions.onAdded', {permissions: ['history'], origins: []});
  w.emit('permissions.onRemoved', {permissions: [], origins: ['https://a.example/*']});
  assert.deepEqual(heard, [['added', {permissions: ['history'], origins: []}], ['removed', {permissions: [], origins: ['https://a.example/*']}]]);
});

test('renderer: the browser object (polyfill users) gets the same namespace', () => {
  const browser = {runtime: {id: ID}};
  const w = world({browser});
  assert.equal(typeof w.browser.permissions.request, 'function');
});

// ---------------------------------------------------------------------------------------------------- ports

const {patternCovers} = require('../desktop/browser-services/extension-permission-table.cjs');

test('match-pattern ports as Chromium: a pattern without a port covers every port, one with a port only that port', () => {
  assert.equal(patternCovers('http://127.0.0.1/*', 'http://127.0.0.1:58227/*'), true);
  assert.equal(patternCovers('http://127.0.0.1/*', 'http://127.0.0.1:58227/'), true);
  assert.equal(patternCovers('*://*/*', 'https://localhost:8443/a'), true);
  assert.equal(patternCovers('http://*.example.com/*', 'http://www.example.com:81/x'), true);
  assert.equal(patternCovers('http://127.0.0.1:8080/*', 'http://127.0.0.1:8080/x'), true);
  assert.equal(patternCovers('http://127.0.0.1:8080/*', 'http://127.0.0.1:9090/x'), false);
  assert.equal(patternCovers('http://127.0.0.1:8080/*', 'http://127.0.0.1/*'), false, 'a port pattern does not cover "every port"');
  assert.equal(patternCovers('http://127.0.0.1:8080/*', 'http://127.0.0.1:*/*'), false);
  assert.equal(patternCovers('http://127.0.0.1:*/*', 'http://127.0.0.1:8080/*'), true);
  assert.equal(patternCovers('http://[::1]/*', 'http://[::1]:3000/'), true);
  assert.equal(patternCovers('http://[::1]:3000/*', 'http://[::1]:4000/'), false);
  assert.equal(patternCovers('http://127.0.0.1/*', 'https://127.0.0.1:58227/'), false, 'the scheme still has to match');
});

test('host access for a page URL: the granted pattern\'s port rule decides, a default port may be named explicitly', () => {
  const ext = {id: ID, manifest: {manifest_version: 3, name: 'Ports', version: '1', permissions: ['cookies'], optional_host_permissions: ['*://*/*']}};
  const t = setup({ext});
  t.permissions.grant(ext, {origins: ['http://127.0.0.1/*', 'https://secure.test:8443/*', 'http://plain.test:80/*']});
  const has = url => t.permissions.hasOrigin(ext, url);
  assert.equal(has('http://127.0.0.1:58227/'), true, 'any port');
  assert.equal(has('http://127.0.0.1/'), true);
  assert.equal(has('https://127.0.0.1/'), false);
  assert.equal(has('https://secure.test:8443/x'), true);
  assert.equal(has('https://secure.test:9443/x'), false, 'only the named port');
  assert.equal(has('https://secure.test/x'), false, 'the default port is not 8443');
  assert.equal(has('http://plain.test/x'), true, 'a URL without a port is on the scheme\'s default port, which the pattern names');
  assert.equal(has('http://plain.test:8080/x'), false);
});

test('Cookie-Editor\'s flow: host access granted for http://127.0.0.1/*, then its popup asks about the tab\'s own URL with a port', async () => {
  const ext = {id: ID, manifest: {manifest_version: 3, name: 'Cookie-Editor like', version: '1', permissions: ['cookies', 'activeTab'], optional_host_permissions: ['*://*/*']}};
  const t = setup({ext});
  assert.equal(await t.call('permissions.contains', {origins: ['http://127.0.0.1:58227/']}), false, 'not yet');
  assert.equal(await t.call('permissions.request', {origins: ['http://127.0.0.1/*']}), true);
  for (const origin of ['http://127.0.0.1:58227/', 'http://127.0.0.1:58227/*', 'http://127.0.0.1/*', 'http://127.0.0.1:1/some/path?q=1'])
    assert.equal(await t.call('permissions.contains', {origins: [origin]}), true, origin);
  assert.equal(await t.call('permissions.contains', {origins: ['http://localhost:58227/']}), false);
  assert.equal(await t.call('permissions.contains', {origins: ['https://127.0.0.1:58227/']}), false);
  assert.equal(await t.call('permissions.request', {origins: ['http://127.0.0.1:58227/*']}), true, 'already held: no prompt');
  assert.equal(t.prompts.length, 1);
  assert.deepEqual((await t.call('permissions.getAll')).origins, ['http://127.0.0.1/*']);
  // A port inside an optional pattern is requestable; granting it does not widen it to other ports.
  assert.equal(await t.call('permissions.request', {origins: ['http://localhost:3000/*']}), true);
  assert.equal(await t.call('permissions.contains', {origins: ['http://localhost:3000/*']}), true);
  assert.equal(await t.call('permissions.contains', {origins: ['http://localhost:4000/*']}), false);
});
