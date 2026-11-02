'use strict';
// The ext-api package registry (desktop/browser-services/ext-api/index.cjs): packages are found by file name, one owner per namespace,
// the main side registers handlers on the engine's router, the renderer side builds namespaces that extensions see on chrome and browser,
// and a package that owns a namespace replaces Acira's older shim for it without that file being edited.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const fixture = name => path.join(__dirname, 'fixtures', 'ext-api', name);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('packages are found by file name; one owner per namespace; namespaces must be Chromium\'s', () => {
  const packages = extApi.loadPackages({dir: fixture('ok'), fresh: true});
  assert.deepEqual(packages.map(p => [p.name, p.namespaces, !!p.install, !!p.renderer]), [['demo', ['tabGroups'], true, true], ['store', ['storage'], false, true]]);
  assert.throws(() => extApi.loadPackages({dir: fixture('clash'), fresh: true}), /namespace 'tabGroups' is claimed by both 'one' and 'two'/);
  assert.throws(() => extApi.loadPackages({dir: fixture('unknown'), fresh: true}), /'tabGroup' is not a namespace Chromium exposes/);
  assert.doesNotThrow(() => extApi.loadPackages({fresh: true}), 'the real folder loads');
});

test('a renderer written as a method shorthand becomes an expression', () => {
  assert.equal(extApi.asExpression({renderer(acira) { return acira; }}.renderer), 'function renderer(acira) { return acira; }');
  assert.equal(extApi.asExpression(acira => acira), 'acira => acira');
  assert.equal(extApi.asExpression(function named(acira) { return acira; }), 'function named(acira) { return acira; }');
});

function fakeRuntime() {
  const handlers = new Map(), sent = [];
  handlers.set('tabs.query', {callback: () => [{id: 1}], extensionContext: true});
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  const session = {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  return {runtime: {ctx: {router}}, router, handlers, sent, session};
}

test('main side: handlers on the engine router, errors become answers, wrap keeps the original, forget reaches the package', async () => {
  const {runtime, handlers, sent, session} = fakeRuntime();
  const apis = installExtensionApis(runtime, {session, userData: os.tmpdir(), extApiDir: fixture('ok')});
  assert.deepEqual(apis.packages.packages, ['demo']);
  const event = {type: 'service-worker', extension: {id: ID, manifest: {permissions: ['tabGroups']}}};
  assert.deepEqual(await handlers.get('tabGroups.get').callback(event, 3), {id: 3, collapsed: false, color: 'blue', title: 'Demo', windowId: 1});
  assert.deepEqual(await handlers.get('tabGroups.get').callback(event, 404), {__acira_error: 'No group with id: 404.'}, 'a throw is an answer, not a router error');
  assert.deepEqual(handlers.get('tabs.query').callback(event, {}).map(t => t.id), [99, 1], 'wrap() keeps the engine handler callable');
  assert.equal(await handlers.get('demo.ping').callback(event), 'pong');
  assert.deepEqual(sent, [[ID, 'tabGroups.onCreated', {id: 7}]]);
  apis.forget(ID);
  assert.deepEqual(require(path.join(fixture('ok'), 'demo.cjs')).forgotten, [ID]);
});

test('renderer side: the package namespace is built on Chromium\'s schema, answers from the main process, on chrome and browser', async () => {
  const packages = extApi.loadPackages({dir: fixture('ok'), fresh: true});
  const browser = {runtime: {id: ID}};
  const world = extensionWorld({manifest_version: 3, permissions: ['tabGroups', 'storage']}, {packages, browser, native: {storage: {local: {get() {}}}},
    answer: (name, args) => (name === 'tabGroups.get' ? (args[0] === 404 ? {__acira_error: 'No group with id: 404.'} : {id: args[0], title: 'Demo'}) : undefined)});
  const {chrome} = world;
  assert.equal(typeof chrome.tabGroups.query, 'function', 'every Chromium member exists');
  assert.equal(chrome.tabGroups.TAB_GROUP_ID_NONE, -1, 'constants come from the schema');
  assert.equal(chrome.tabGroups.Color.BLUE, 'blue');
  assert.equal(chrome.tabGroups.aciraBase, 'none', 'the factory got what was there before (nothing)');
  assert.deepEqual(plain(await chrome.tabGroups.get(3)), {id: 3, title: 'Demo'});
  await assert.rejects(chrome.tabGroups.get(404), {message: 'No group with id: 404.'});
  assert.throws(() => chrome.tabGroups.get('3'), {name: 'TypeError', message: 'Error in invocation of tabGroups.get(integer groupId, optional function callback): No matching signature.'});
  await assert.rejects(chrome.tabGroups.query({}), {message: 'Access to extension API denied.'}, 'members the package leaves out answer like Chromium');
  const error = await new Promise(resolve => chrome.tabGroups.get(404, () => resolve(chrome.runtime.lastError && chrome.runtime.lastError.message)));
  assert.equal(error, 'No group with id: 404.');
  const created = [];
  chrome.tabGroups.onCreated.addListener(group => created.push(group.id));
  world.emit('tabGroups.onCreated', {id: 12});
  assert.deepEqual(created, [12]);
  assert.equal(world.browser.tabGroups, chrome.tabGroups, 'browser gets the same object');
  // The storage package owns chrome.storage: its factory got today's object (the engine's plus Acira's older fixes) and extends it.
  assert.equal(chrome.storage.aciraOwned, true);
  assert.equal(typeof chrome.storage.local.get, 'function');
  assert.notEqual(chrome.storage.managed, chrome.storage.local, 'the older storage.managed fix ran first, so the base is today\'s object');
  assert.deepEqual(world.calls.filter(c => c.channel === 'crx-msg').map(c => c.name), ['tabGroups.get', 'tabGroups.get', 'tabGroups.get']);
});

test('gating: a namespace exists only with Chromium\'s permission or manifest key, from Acira\'s table (incl. "unknown" permissions)', () => {
  const packages = extApi.loadPackages({dir: fixture('ok'), fresh: true});
  const bare = extensionWorld({manifest_version: 3, permissions: []}, {packages, native: {storage: {local: {get() {}}}}});
  assert.equal(bare.chrome.tabGroups, undefined, 'no tabGroups permission: no chrome.tabGroups (package namespace)');
  assert.equal(bare.chrome.storage, undefined, 'no storage permission: the engine\'s storage object is removed too');
  for (const ns of ['contextMenus', 'notifications', 'downloads', 'cookies', 'privacy', 'topSites', 'webNavigation', 'webRequest', 'commands'])
    assert.equal(bare.chrome[ns], undefined, `${ns} needs its permission or manifest key, as in Chromium`);
  for (const ns of ['runtime', 'tabs', 'windows', 'permissions', 'extension']) assert.equal(typeof bare.chrome[ns], 'object', `${ns} needs nothing`);
  const full = extensionWorld({manifest_version: 3, permissions: ['contextMenus', 'notifications', 'downloads'], commands: {}}, {packages});
  for (const ns of ['contextMenus', 'notifications', 'downloads', 'commands']) assert.equal(typeof full.chrome[ns], 'object', `${ns} with its permission`);
  // MV3-only permission in an MV2 manifest: tabGroups needs manifest_version 3.
  const mv2 = extensionWorld({manifest_version: 2, permissions: ['tabGroups']}, {packages});
  assert.equal(mv2.chrome.tabGroups, undefined);
});

test('members are bound by their own feature: built namespaces leave out what this extension may not use', () => {
  const runtimePackage = {name: 'rt', namespaces: ['runtime'], renderer: acira => ({runtime: {factory: () => acira.build('runtime', {})}})};
  const without = extensionWorld({manifest_version: 3, permissions: []}, {packages: [runtimePackage]});
  assert.equal(without.chrome.runtime.connectNative, undefined, 'runtime.connectNative needs nativeMessaging');
  assert.equal(without.chrome.runtime.getBackgroundPage, undefined, 'not in service workers');
  assert.equal(typeof without.chrome.runtime.sendMessage, 'function');
  const page = extensionWorld({manifest_version: 3, permissions: ['nativeMessaging']}, {packages: [runtimePackage], worker: false});
  assert.equal(typeof page.chrome.runtime.connectNative, 'function');
  assert.equal(typeof page.chrome.runtime.getBackgroundPage, 'function', 'extension pages have it');
});

test('a granted optional permission reaches running pages at once; a removed one goes', () => {
  const packages = extApi.loadPackages({dir: fixture('ok'), fresh: true});
  const browser = {runtime: {id: ID}};
  const world = extensionWorld({manifest_version: 3, permissions: [], optional_permissions: ['tabGroups', 'contextMenus']}, {packages, browser});
  assert.equal(world.chrome.tabGroups, undefined);
  assert.equal(world.chrome.contextMenus, undefined);
  assert.ok(world.calls.some(c => c.channel === 'crx-add-listener' && c.args[1] === 'acira.permissions.changed'), 'listens for changes');
  world.emit('acira.permissions.changed', {permissions: ['tabGroups', 'contextMenus'], origins: []});
  assert.equal(typeof world.chrome.tabGroups.get, 'function', 'package namespace added');
  assert.equal(typeof world.chrome.contextMenus.create, 'function', 'engine namespace added');
  assert.equal(world.browser.tabGroups, world.chrome.tabGroups);
  world.emit('acira.permissions.changed', {permissions: [], origins: []});
  assert.equal(world.chrome.tabGroups, undefined);
  assert.equal(world.chrome.contextMenus, undefined);
  assert.equal(world.browser.tabGroups, undefined);
  // Baked grants (the preload written after a grant): available from the start.
  const later = extensionWorld({manifest_version: 3, permissions: [], optional_permissions: ['tabGroups']}, {packages, grants: {[ID]: {permissions: ['tabGroups'], origins: []}}});
  assert.equal(typeof later.chrome.tabGroups.get, 'function');
  const notOptional = extensionWorld({manifest_version: 3, permissions: []}, {packages, grants: {[ID]: {permissions: ['tabGroups'], origins: []}}});
  assert.equal(notOptional.chrome.tabGroups, undefined, 'a grant counts only for a permission the manifest lists as optional');
});

test('main side: a call to a namespace the extension may not use is denied before the package runs', async () => {
  const {runtime, handlers, session} = fakeRuntime();
  installExtensionApis(runtime, {session, userData: os.tmpdir(), extApiDir: fixture('ok')});
  const denied = await handlers.get('tabGroups.get').callback({type: 'frame', extension: {id: ID, manifest: {manifest_version: 3, permissions: []}}}, 3);
  assert.deepEqual(denied, {__acira_error: 'Access to extension API denied.'});
  assert.equal(await handlers.get('demo.ping').callback({type: 'frame', extension: {id: ID, manifest: {}}}), 'pong', 'Acira-internal names are not checked');
});

test('essential engine members get Chromium\'s argument checks; accepted calls reach the engine unchanged', async () => {
  const world = extensionWorld({manifest_version: 3, permissions: ['tabs', 'contextMenus', 'notifications', 'cookies', 'nativeMessaging'], host_permissions: ['<all_urls>'], action: {}},
    {answer: name => (name === 'tabs.query' ? [{id: 1}] : name === 'windows.getCurrent' ? {id: 2} : undefined)});
  const {chrome} = world;
  assert.deepEqual(plain(await chrome.tabs.query({active: true, currentWindow: true})), [{id: 1}]);
  assert.throws(() => chrome.tabs.query({active: true, foo: 1}), {name: 'TypeError',
    message: 'Error in invocation of tabs.query(object queryInfo, optional function callback): Error at parameter \'queryInfo\': Unexpected property: \'foo\'.'});
  assert.throws(() => chrome.tabs.get('3'), {message: 'Error in invocation of tabs.get(integer tabId, optional function callback): No matching signature.'});
  assert.throws(() => chrome.tabs.query({}, () => {}, 'extra'), {message: /No matching signature/});
  const win = await new Promise(resolve => chrome.windows.getCurrent({populate: true}, resolve));
  assert.deepEqual(plain(win), {id: 2});
  assert.doesNotThrow(() => chrome.contextMenus.create({id: 'x', title: 'Hello', contexts: ['page', 'selection']}));
  assert.throws(() => chrome.contextMenus.create({id: 'x', title: 'Hello', contexts: ['nowhere']}), {message: /Error at parameter 'createProperties': Error at property 'contexts': Error at index 0: Value must be one of/});
  assert.doesNotThrow(() => chrome.notifications.create('n1', {type: 'basic', iconUrl: 'i.png', title: 't', message: 'm'}));
  assert.doesNotThrow(() => chrome.notifications.create({type: 'basic', iconUrl: 'i.png', title: 't', message: 'm'}), 'optional first parameter skipped');
  assert.doesNotThrow(() => chrome.action.setBadgeText({text: '3'}));
  assert.throws(() => chrome.action.setBadgeText('3'), {message: /action.setBadgeText/});
  assert.doesNotThrow(() => chrome.cookies.getAll({domain: 'example.com'}));
  // Calls with the same arguments as before the guard reach the engine (the IPC log shows them).
  const names = world.calls.filter(c => c.channel === 'crx-msg').map(c => c.name);
  assert.ok(names.includes('tabs.query') && names.includes('windows.getCurrent') && names.includes('contextMenus.create'));
  assert.equal(names.filter(n => n === 'tabs.query').length, 1, 'the rejected query never reached the main process');
});

test('the preload\'s slim schema checks every function exactly like the full surface', () => {
  const {createBindings, surface} = require('../desktop/browser-services/extension-api-signature.cjs');
  const vm = require('node:vm');
  const lookup = vm.runInNewContext(extApi.schemaSource());
  const full = createBindings(name => surface().namespaces[name]), slim = createBindings(lookup);
  const list = value => (Array.isArray(value) ? value : Object.values(value || {}));
  let compared = 0;
  for (const [name, ns] of Object.entries(surface().namespaces)) {
    for (const fn of Object.entries(ns.functions || {})) {
      assert.equal(slim.signatureOf(name, fn[0])?.text, full.signatureOf(name, fn[0])?.text, `${name}.${fn[0]}`); compared++;
      // The same values pass and fail: an empty object and a wrong-typed first argument.
      for (const probe of [[{}], [12345], ['x']]) {
        const outcome = b => { try { b.parseArguments(name, fn[0], probe); return 'ok'; } catch (e) { return e.message; } };
        assert.equal(outcome(slim), outcome(full), `${name}.${fn[0]}(${JSON.stringify(probe)})`);
      }
    }
    for (const [typeName, type] of Object.entries(ns.types || {})) for (const fn of list(type.functions)) {
      const ref = `${name}.${typeName}`, slimType = slim.lookupType(ref);
      assert.ok(slimType && list(slimType.functions).some(f => f.name === fn.name), `${ref}.${fn.name} kept`);
      assert.equal(slim.signatureFor(list(slimType.functions).find(f => f.name === fn.name)).text, full.signatureFor(fn).text); compared++;
    }
  }
  assert.ok(compared > 340, `${compared} signatures compared`);
});

test('typed objects: a package builds storage.sync on StorageArea; the older storage.managed shim is checked too', async () => {
  const pkg = {name: 'st', namespaces: ['storage'], renderer: acira => ({storage: {factory: base => acira.build('storage', {
    objects: {sync: {functions: {get: keys => Promise.resolve({keys})}}}, properties: {local: base.local}})}})};
  const world = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages: [pkg], native: {storage: {local: {get() {}}}}});
  const {chrome} = world;
  assert.deepEqual(plain(await chrome.storage.sync.get('a')), {keys: 'a'});
  assert.equal(chrome.storage.sync.QUOTA_BYTES, 102400, 'StorageArea constants from the schema');
  assert.throws(() => chrome.storage.sync.get(1), {message: 'Error in invocation of storage.get(optional [string|array|object] keys, optional function callback): No matching signature.'});
  // (the real folder's storage package, P3, now owns storage: managed answers like Chrome's, which needs the manifest's managed_schema)
  const shim = extensionWorld({manifest_version: 3, permissions: ['storage'], storage: {managed_schema: 'schema.json'}}, {native: {storage: {local: {get() {}}}}});
  assert.throws(() => shim.chrome.storage.managed.get(1), {message: /Error in invocation of storage\.get\(/});
  assert.deepEqual(plain(await shim.chrome.storage.managed.get(['a'])), {});
});

test('namespaces survive Chromium\'s binding rebuild (pinned, still writable for proxies); web pages load only a few-line loader', () => {
  const world = extensionWorld({manifest_version: 3, permissions: ['contextMenus', 'tabs']}, {browser: {runtime: {id: ID}}});
  const {chrome} = world, tabs = chrome.tabs;
  for (const ns of ['tabs', 'contextMenus', 'runtime', 'windows']) {
    const d = Object.getOwnPropertyDescriptor(chrome, ns);
    assert.equal(d.configurable, false, `${ns} pinned`); assert.equal(d.writable, true, `${ns} writable (a Proxy over chrome may answer anything)`);
  }
  // What UpdateBindingsForContext does: redefine Electron's own namespaces, delete the ones Electron does not know. Both fail now.
  assert.throws(() => Object.defineProperty(chrome, 'tabs', {value: {native: true}, configurable: true}));
  assert.equal(Reflect.deleteProperty(chrome, 'contextMenus'), false);
  assert.equal(chrome.tabs, tabs);
  assert.equal(typeof chrome.tabs.create, 'function');
  assert.equal(Object.getOwnPropertyDescriptor(world.browser, 'tabs').configurable, false, 'browser too');
  // The frame preload: a web page stops at the first check; an extension page asks for the text once.
  const {frameLoader} = require('../desktop/browser-services/extension-runtime-patch.cjs');
  const vm = require('node:vm'), source = frameLoader('0123456789ab');
  assert.ok(Buffer.byteLength(source) < 1024, 'the loader stays tiny');
  const run = href => { const asked = []; vm.runInNewContext(source, {location: {href}, process: {}, console: {error() {}}, require: () => ({ipcRenderer: {sendSync: (...a) => { asked.push(a); return 'globalThis.loaded = true;'; }}})}); return asked; };
  assert.deepEqual(run('https://example.com/'), []);
  assert.deepEqual(run('chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'), [['acira:extension-preload', '0123456789ab']]);
});

test('event filters: acira.event takes Chromium\'s filter support from the schema and a matcher', () => {
  const pkg = {name: 'nav', namespaces: ['webNavigation'], renderer: acira => ({webNavigation: {factory: () => acira.build('webNavigation', {
    events: {onCompleted: acira.event('webNavigation.onCompleted', {matches: (filter, details) => filter.url.some(rule => details.url.includes(rule.hostContains))})}})}})};
  const world = extensionWorld({manifest_version: 3, permissions: ['webNavigation']}, {packages: [pkg]});
  const heard = [];
  world.chrome.webNavigation.onCompleted.addListener(details => heard.push(details.url), {url: [{hostContains: 'example'}]});
  world.emit('webNavigation.onCompleted', {url: 'https://example.com/'});
  world.emit('webNavigation.onCompleted', {url: 'https://other.org/'});
  assert.deepEqual(heard, ['https://example.com/']);
  assert.throws(() => world.chrome.webNavigation.onCompleted.addListener(() => {}, 'x'), {message: 'Invalid invocation'});
});

test('a package that throws while starting does not take the others down', () => {
  const broken = {name: 'broken', namespaces: ['tabGroups'], renderer: function () { throw new Error('boom'); }};
  const store = extApi.loadPackages({dir: fixture('ok'), fresh: true}).find(p => p.name === 'store');
  const world = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages: [broken, store], native: {storage: {local: {get() {}}}}});
  assert.equal(world.chrome.storage.aciraOwned, true);
  assert.ok(world.logged.error.some(line => /extension API package broken failed to start/.test(line)));
});

test('the preload carries the schema lazily and stays within budget', () => {
  const world = extensionWorld({manifest_version: 3, permissions: []});
  const size = Buffer.byteLength(world.text);
  assert.ok(size < 600 * 1024, `patched preload is ${Math.round(size / 1024)} KB`);
});
