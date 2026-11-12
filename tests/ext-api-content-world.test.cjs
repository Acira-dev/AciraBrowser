'use strict';
// 13.7, GitHub issue #5 (Colorway: clicking its button did nothing). Colorway's worker answers chrome.action.onClicked with chrome.scripting.executeScript({files: ['webcomponents-bundle.js',
// 'inject.js']}). For an extension that holds only activeTab Acira runs such a script in an isolated world of its own, and that world had NO chrome object, so inject.js died on its first
// line (`const extensionId = chrome.runtime.id`) and nothing appeared. The world now gets chrome.runtime / storage / i18n (content/world.cjs) over a console channel, answered by a hidden
// page of the extension (content/relay.cjs). These tests cover the shim (run in a vm context as the page's isolated world would), the main-side bridge, the relay and the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {contentShim, createContentWorld, PREFIX, MAX_REQUEST} = require('../desktop/browser-services/ext-api/content/world.cjs');
const relay = require('../desktop/browser-services/ext-api/content/relay.cjs');

const ID = 'pkgejkfioihnchalojepdkefnpejomgn';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-cw-'));
const packageIn = (userData, files = {}) => {
  const folder = path.join(userData, 'extension-packages', 'hash', ID, 'v1');
  fs.mkdirSync(folder, {recursive: true});
  for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(folder, name)), {recursive: true}); fs.writeFileSync(path.join(folder, name), text); }
  return folder;
};

// ---- the shim, in a context with no chrome object, like the isolated world
function world(flags = {storage: true}, {messages = {}, token = 'tok', manifest = {name: 'Colorway', version: '1.1.4', manifest_version: 3}} = {}) {
  const lines = [];
  const sandbox = {console: {debug: line => lines.push(line)}, navigator: {language: 'ar'}, Promise, JSON, Object, Array, String, Number, Error};
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  const install = (tokenValue = token) => vm.runInContext('(' + contentShim.toString() + ')(' + [JSON.stringify(ID), JSON.stringify(manifest), JSON.stringify(messages), JSON.stringify(tokenValue), JSON.stringify(flags)].join(',') + ')', context);
  install();
  const run = code => vm.runInContext(code, context);
  const sent = () => lines.map(line => { assert.ok(line.startsWith(PREFIX + token + ':'), 'every line starts with the prefix and this world\'s secret'); return JSON.parse(line.slice((PREFIX + token + ':').length)); });
  return {lines, run, sent, install, sandbox};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('shim: the world gets chrome.runtime (id, getURL, getManifest), chrome.storage only with the storage permission, chrome.i18n and chrome.extension.getURL', () => {
  const w = world({storage: true}, {messages: {hello: {message: 'Hi $1 and $2'}}});
  assert.equal(w.run('chrome.runtime.id'), ID);
  assert.equal(w.run("chrome.runtime.getURL('index.html')"), 'chrome-extension://' + ID + '/index.html');
  assert.equal(w.run("chrome.runtime.getURL('/js/a.js')"), 'chrome-extension://' + ID + '/js/a.js', 'a leading slash is dropped, as Chrome');
  assert.equal(w.run("chrome.extension.getURL('x')"), 'chrome-extension://' + ID + '/x');
  assert.deepEqual(JSON.parse(w.run('JSON.stringify(chrome.runtime.getManifest())')), {name: 'Colorway', version: '1.1.4', manifest_version: 3});
  assert.equal(w.run('chrome.runtime.getManifest()') !== w.run('chrome.runtime.getManifest()'), true, 'a copy each time');
  assert.equal(w.run('typeof chrome.storage.sync.get + typeof chrome.storage.local.set + typeof chrome.storage.session.clear'), 'functionfunctionfunction');
  assert.equal(w.run("chrome.i18n.getMessage('hello', ['A', 'B'])"), 'Hi A and B');
  assert.equal(w.run("chrome.i18n.getMessage('missing')"), '');
  assert.equal(w.run('chrome.i18n.getUILanguage()'), 'ar');
  assert.equal(world({storage: false}).run('typeof chrome.storage'), 'undefined', 'no storage permission, no chrome.storage (Chrome: undefined)');
  assert.throws(() => w.run('chrome.runtime.connect()'), /not available/);
  assert.equal(w.run('typeof chrome.runtime.onMessage.addListener'), 'function', 'the events exist and stay silent');
  assert.equal(w.run('chrome.runtime.onMessage.hasListeners()'), false);
});

test('shim: installing twice with the same secret changes nothing, and an existing chrome object is not overwritten', () => {
  const w = world();
  w.run('chrome.marker = 1');
  w.install();
  assert.equal(w.run('chrome.marker'), 1);
  const lines = w.lines.length;
  w.run('chrome.runtime.sendMessage({a: 1})');
  assert.equal(w.lines.length, lines + 1);
  const other = world();
  other.run('delete self.__acira_cw; self.chrome = {runtime: {id: "theirs"}}');
  other.install();
  assert.equal(other.run('chrome.runtime.id'), 'theirs', 'an existing member stays');
  assert.equal(other.run('typeof chrome.storage'), 'object', 'a missing one is added');
});

test('shim: sendMessage asks through the console and the answer comes back as a promise or a callback with lastError', async () => {
  const w = world();
  const first = w.run("globalThis.p = chrome.runtime.sendMessage({action: 'screenshot'}); p");
  assert.deepEqual(w.sent(), [{n: 1, o: 'm', p: {args: [{action: 'screenshot'}]}}]);
  w.run("__acira_cw_reply(1, {value: {src: 'data:image/png;base64,AAA'}})");
  assert.deepEqual(JSON.parse(JSON.stringify(await first)), {src: 'data:image/png;base64,AAA'});
  // an own extension id first, then the message
  w.run('chrome.runtime.sendMessage("' + ID + '", {x: 2})');
  assert.deepEqual(w.sent()[1], {n: 2, o: 'm', p: {args: [{x: 2}]}});
  // another extension's id: Chrome's error, nothing asked
  const before = w.lines.length;
  await assert.rejects(w.run('chrome.runtime.sendMessage("ponmlkjihgfedcbaponmlkjihgfedcba", {x: 3})'), /Receiving end does not exist/);
  assert.equal(w.lines.length, before);
  // the callback form: lastError is set during the callback only
  w.run("globalThis.result = []; chrome.runtime.sendMessage({y: 1}, function (value) { result.push([value === undefined ? 'undefined' : 'value', chrome.runtime.lastError && chrome.runtime.lastError.message]); })");
  w.run("__acira_cw_reply(3, {error: 'No receiver'})");
  await settle();
  assert.deepEqual(JSON.parse(w.run('JSON.stringify(result)')), [['undefined', 'No receiver']]);
  assert.equal(w.run('chrome.runtime.lastError'), undefined, 'cleared after the callback');
  w.run("chrome.runtime.sendMessage({y: 2}, function (value) { result.push(['ok', value]); })");
  w.run("__acira_cw_reply(4, {value: 5})");
  await settle();
  assert.deepEqual(JSON.parse(w.run('JSON.stringify(result.slice(1))')), [['ok', 5]]);
  // an answer for a call nobody made is ignored
  w.run("__acira_cw_reply(99, {value: 1})");
});

test('shim: chrome.storage.<area>.get/set/remove/clear travel with the area, the method and the arguments, in both call forms', async () => {
  const w = world();
  const got = w.run("globalThis.g = chrome.storage.sync.get(['__colorway_options']); g");
  assert.deepEqual(w.sent()[0], {n: 1, o: 's', p: {area: 'sync', method: 'get', args: [['__colorway_options']]}});
  w.run("__acira_cw_reply(1, {value: {__colorway_options: '{}'}})");
  assert.deepEqual(JSON.parse(JSON.stringify(await got)), {__colorway_options: '{}'});
  w.run("chrome.storage.local.set({a: 1}, function () { globalThis.done = chrome.runtime.lastError === undefined; })");
  assert.deepEqual(w.sent()[1], {n: 2, o: 's', p: {area: 'local', method: 'set', args: [{a: 1}]}});
  w.run('__acira_cw_reply(2, {value: null})');
  await settle();
  assert.equal(w.run('done'), true);
  w.run("chrome.storage.session.remove('k'); chrome.storage.sync.clear()");
  assert.deepEqual(w.sent().slice(2).map(item => [item.p.area, item.p.method, item.p.args]), [['session', 'remove', ['k']], ['sync', 'clear', []]]);
});

// ---- the bridge in main
function fakePage(url = 'https://example.com/a', id = 7) {
  const wc = new EventEmitter();
  Object.assign(wc, {id, url, executed: [], mainFrame: {name: 'main'}, isDestroyed: () => false, getURL: () => wc.url,
    executeJavaScriptInIsolatedWorld: async (world, scripts) => { wc.executed.push([world, scripts[0].code]); return undefined; }});
  return wc;
}
function bridge(options = {}) {
  const userData = tmp(), folder = options.folder === undefined ? packageIn(userData, {'manifest.json': '{}'}) : options.folder;
  const extension = {id: ID, path: folder, manifest: {manifest_version: 3, name: 'Colorway', version: '1.1.4', permissions: ['activeTab', 'scripting', 'storage'], ...(options.manifest || {})}};
  const calls = [];
  const relays = {relayFor: (session, ext) => ({call: async (operation, payload) => { calls.push([operation, payload]); return options.answer ? options.answer(operation, payload) : {value: {echo: payload}}; }})};
  let granted = true;
  const activeTab = {has: (session, id, tabId, url) => granted && id === ID && tabId === 7};
  const world = createContentWorld({session: {}, userData, relays, activeTab, hasPermission: (ext, name) => (options.permissions || ['activeTab', 'scripting', 'storage']).includes(name)});
  const wc = fakePage();
  return {userData, folder, extension, calls, world, wc, revoke: () => { granted = false; }};
}
const tokenOf = code => /\("([0-9a-f]{36})"/.exec(code.replace(/[\s\S]*\}\)\(/, '(') )?.[1] || /"([0-9a-f]{36})"/.exec(code.slice(code.lastIndexOf(')(')))[1];
const say = (b, token, request) => b.wc.emit('console-message', {message: PREFIX + token + ':' + JSON.stringify(request), level: 'debug', frame: b.wc.mainFrame});

test('bridge: an Acira-unpacked package gets the shim and the two relay files; a folder the person loaded gets nothing and is not written to', () => {
  const b = bridge();
  const code = b.world.prepare(b.extension, b.wc, 1_234_567);
  assert.equal(typeof code, 'string');
  assert.match(code, /^\(function contentShim\(/);
  assert.ok(fs.existsSync(path.join(b.folder, relay.PAGE)) && fs.existsSync(path.join(b.folder, relay.SCRIPT)));
  assert.equal(fs.readFileSync(path.join(b.folder, relay.SCRIPT), 'utf8'), relay.SCRIPT_SOURCE);
  const again = b.world.prepare(b.extension, b.wc, 1_234_567);
  assert.equal(again, code, 'the same world on the same page: the same secret, the same text');
  assert.equal(b.wc.listenerCount('console-message'), 1, 'heard once');
  const loose = bridge({folder: tmp()});
  assert.equal(loose.world.prepare(loose.extension, loose.wc, 1), null);
  assert.deepEqual(fs.readdirSync(loose.folder), [], 'a folder outside <user data>/extension-packages is never written to');
  assert.equal(loose.wc.listenerCount('console-message'), 0);
  assert.equal(bridge({folder: ''}).world.prepare({id: ID, path: '', manifest: {}}, fakePage(), 1), null);
});

test('bridge: a call heard on the console is made by the relay and the answer goes back into the isolated world; the secret and the grant are checked', async () => {
  const b = bridge();
  const world = 1_234_567;
  const code = b.world.prepare(b.extension, b.wc, world);
  const token = /"([0-9a-f]{36})"/.exec(code)[1];
  say(b, token, {n: 1, o: 'm', p: {args: [{action: 'screenshot'}]}});
  await settle();
  assert.deepEqual(b.calls, [['message', {args: [{action: 'screenshot'}]}]]);
  assert.deepEqual(b.wc.executed.at(-1), [world, 'globalThis.__acira_cw_reply&&globalThis.__acira_cw_reply(1,{"value":{"echo":{"args":[{"action":"screenshot"}]}}})']);
  say(b, token, {n: 2, o: 's', p: {area: 'sync', method: 'get', args: [['k']]}});
  await settle();
  assert.deepEqual(b.calls[1], ['storage', {area: 'sync', method: 'get', args: [['k']]}]);
  // not the secret, no prefix, garbage, a subframe, too large: nothing happens
  const n = b.calls.length, executed = b.wc.executed.length;
  say(b, 'wrongsecret', {n: 3, o: 'm', p: {args: [1]}});
  b.wc.emit('console-message', {message: 'plain log', level: 'info', frame: b.wc.mainFrame});
  b.wc.emit('console-message', {message: PREFIX + token + ':{not json', level: 'debug', frame: b.wc.mainFrame});
  b.wc.emit('console-message', {message: PREFIX + token + ':' + JSON.stringify({n: 4, o: 'm', p: {args: [1]}}), level: 'debug', frame: {name: 'sub'}});
  b.wc.emit('console-message', {message: PREFIX + token + ':' + 'x'.repeat(MAX_REQUEST + 1), level: 'debug', frame: b.wc.mainFrame});
  b.wc.emit('console-message', {message: PREFIX + token + ':' + JSON.stringify({n: 'x', o: 'm', p: {args: [1]}}), level: 'debug', frame: b.wc.mainFrame});
  await settle();
  assert.equal(b.calls.length, n);
  assert.equal(b.wc.executed.length, executed);
  // the old three-argument form of the event is understood too
  b.wc.emit('console-message', {}, 1, PREFIX + token + ':' + JSON.stringify({n: 5, o: 'm', p: {args: ['old']}}), 0, '');
  await settle();
  assert.equal(b.calls.length, n + 1);
  // the grant ends (the tab moved to another origin): an error, nothing made
  b.revoke();
  say(b, token, {n: 6, o: 'm', p: {args: [1]}});
  await settle();
  assert.equal(b.calls.length, n + 1);
  assert.match(b.wc.executed.at(-1)[1], /__acira_cw_reply\(6,\{"error":"The extension no longer has access to this page\."\}\)/);
});

test('bridge: only the few operations are allowed; storage needs the permission; the relay\'s error and a too-large answer reach the page as errors', async () => {
  const b = bridge();
  const token = /"([0-9a-f]{36})"/.exec(b.world.prepare(b.extension, b.wc, 5))[1];
  const reply = async request => { say(b, token, request); await settle(); return b.wc.executed.at(-1)[1]; };
  assert.match(await reply({n: 1, o: 'x', p: {}}), /\(1,\{"error":"Unknown operation\."\}\)/);
  assert.match(await reply({n: 2, o: 'm', p: {args: [1, 2]}}), /\(2,\{"error":"Invalid message\."\}\)/);
  assert.match(await reply({n: 3, o: 's', p: {area: 'managed', method: 'get', args: []}}), /\(3,\{"error":"Invalid storage request\."\}\)/);
  assert.match(await reply({n: 4, o: 's', p: {area: 'local', method: 'getBytesInUse', args: []}}), /\(4,\{"error":"Invalid storage request\."\}\)/);
  assert.match(await reply({n: 5, o: 's', p: {area: 'local', method: 'get', args: [1, 2, 3]}}), /\(5,\{"error":"Invalid storage request\."\}\)/);
  assert.equal(b.calls.length, 0, 'none of them reached the extension');
  const noStorage = bridge({permissions: ['activeTab']});
  const t2 = /"([0-9a-f]{36})"/.exec(noStorage.world.prepare(noStorage.extension, noStorage.wc, 5))[1];
  say(noStorage, t2, {n: 1, o: 's', p: {area: 'local', method: 'get', args: []}});
  await settle();
  assert.match(noStorage.wc.executed.at(-1)[1], /\(1,\{"error":"The extension has no storage permission\."\}\)/);
  const failing = bridge({answer: () => ({error: 'Could not establish connection. Receiving end does not exist.'})});
  const t3 = /"([0-9a-f]{36})"/.exec(failing.world.prepare(failing.extension, failing.wc, 5))[1];
  say(failing, t3, {n: 1, o: 'm', p: {args: ['hi']}});
  await settle();
  assert.match(failing.wc.executed.at(-1)[1], /\(1,\{"error":"Could not establish connection\. Receiving end does not exist\."\}\)/);
  const huge = bridge({answer: () => ({value: 'x'.repeat(17 * 1024 * 1024)})});
  const t4 = /"([0-9a-f]{36})"/.exec(huge.world.prepare(huge.extension, huge.wc, 5))[1];
  say(huge, t4, {n: 1, o: 'm', p: {args: ['hi']}});
  await settle();
  assert.match(huge.wc.executed.at(-1)[1], /\(1,\{"error":"The answer is too large\."\}\)/);
});

// ---- the relay
test('relay files: written only into <user data>/extension-packages, again only when they differ', () => {
  const userData = tmp(), folder = packageIn(userData);
  assert.equal(relay.isAciraPackage(folder, userData), true);
  assert.equal(relay.isAciraPackage(path.join(userData, 'extension-packages'), userData), false, 'the packages folder itself');
  assert.equal(relay.isAciraPackage(path.join(userData, 'extension-packages', '..', 'x'), userData), false, 'a path that climbs out');
  assert.equal(relay.isAciraPackage(path.join(userData, 'elsewhere', ID), userData), false);
  assert.equal(relay.isAciraPackage(folder, ''), false);
  assert.equal(relay.ensureFiles(folder, userData), true);
  const written = fs.statSync(path.join(folder, relay.SCRIPT)).mtimeMs;
  fs.writeFileSync(path.join(folder, relay.PAGE), 'changed');
  assert.equal(relay.ensureFiles(folder, userData), true);
  assert.equal(fs.readFileSync(path.join(folder, relay.PAGE), 'utf8'), relay.PAGE_SOURCE, 'a different page is put right');
  assert.equal(fs.statSync(path.join(folder, relay.SCRIPT)).mtimeMs, written, 'an identical one is left alone');
  assert.equal(relay.ensureFiles(tmp(), userData), false);
  // the page itself is two lines and the script answers {value} / {error}
  assert.match(relay.PAGE_SOURCE, /acira-relay\.js/);
  assert.match(relay.SCRIPT_SOURCE, /chrome\.runtime\.sendMessage\.apply/);
  assert.match(relay.SCRIPT_SOURCE, /chrome\.storage\[payload\.area\]/);
});

function fakeElectron() {
  const views = [];
  class WebContentsView {
    constructor(options) {
      const wc = new EventEmitter();
      Object.assign(wc, {destroyed: false, loaded: [], ran: [], closed: false, isDestroyed: () => wc.destroyed, setAudioMuted() {}, setWindowOpenHandler(fn) { wc.openHandler = fn; },
        loadURL: async url => { if (WebContentsView.failLoad) throw new Error('ERR_FAILED'); wc.loaded.push(url); },
        executeJavaScript: async code => { wc.ran.push(code); return WebContentsView.answer ? WebContentsView.answer(code) : {value: 'ok'}; },
        close() { wc.closed = true; wc.destroyed = true; }});
      this.webContents = wc; this.options = options; views.push(this);
    }
  }
  WebContentsView.answer = null; WebContentsView.failLoad = false;
  return {electron: {WebContentsView}, views, WebContentsView};
}
function fakeTimers() {
  const timers = [];
  return {setTimer: (fn, ms) => { const timer = {fn, ms, cleared: false, unref() {}}; timers.push(timer); return timer; }, clearTimer: timer => { if (timer) timer.cleared = true; }, timers, fire: ms => { for (const timer of timers.filter(t => !t.cleared && t.ms === ms)) { timer.cleared = true; timer.fn(); } }};
}

test('relay: one hidden page per extension and profile, loaded from the extension\'s own origin, reused, closed when idle or when the extension goes', async () => {
  const {electron, views} = fakeElectron(), timers = fakeTimers(), session = {name: 's1'};
  const relays = relay.createRelays({electron, setTimer: timers.setTimer, clearTimer: timers.clearTimer});
  const extension = {id: ID};
  const page = relays.relayFor(session, extension);
  assert.deepEqual(await page.call('message', {args: [{action: 'screenshot'}]}), {value: 'ok'});
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].webContents.loaded, ['chrome-extension://' + ID + '/' + relay.PAGE]);
  assert.deepEqual(views[0].options.webPreferences, {session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false});
  assert.equal(views[0].webContents.ran[0], 'window.__acira_relay("message",{"args":[{"action":"screenshot"}]})');
  await relays.relayFor(session, extension).call('storage', {area: 'sync', method: 'get', args: [['k']]});
  assert.equal(views.length, 1, 'the page is reused');
  assert.equal(relays.count(), 1);
  // the page may not navigate or open windows
  assert.deepEqual(views[0].webContents.openHandler(), {action: 'deny'});
  let prevented = false; views[0].webContents.emit('will-navigate', {preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  // idle: closed; the next call opens a new one
  timers.fire(relay.IDLE_MS);
  assert.equal(views[0].webContents.closed, true);
  assert.equal(relays.count(), 0);
  await page.call('message', {args: [1]});
  assert.equal(views.length, 2);
  // another profile (another session) has its own
  await relays.relayFor({name: 's2'}, extension).call('message', {args: [1]});
  assert.equal(views.length, 3);
  // the extension is turned off / removed: its page goes
  relays.forget(session, ID);
  assert.equal(views[1].webContents.closed, true);
  assert.equal(views[2].webContents.closed, false);
  relays.closeAll();
  assert.equal(views[2].webContents.closed, true);
  assert.equal(relays.count(), 0);
});

test('relay: a page that cannot load, a destroyed one and a call that never answers end as errors, and the next call starts again', async () => {
  const {electron, views, WebContentsView} = fakeElectron(), timers = fakeTimers(), session = {};
  const relays = relay.createRelays({electron, setTimer: timers.setTimer, clearTimer: timers.clearTimer});
  const page = relays.relayFor(session, {id: ID});
  WebContentsView.failLoad = true;
  const failed = await page.call('message', {args: [1]});
  assert.match(failed.error, /ERR_FAILED/);
  assert.equal(relays.count(), 0, 'a failed page is not kept');
  WebContentsView.failLoad = false;
  assert.deepEqual(await page.call('message', {args: [1]}), {value: 'ok'});
  views.at(-1).webContents.destroyed = true;
  assert.deepEqual(await page.call('message', {args: [1]}), {value: 'ok'}, 'a destroyed page is replaced');
  WebContentsView.answer = () => new Promise(() => {});
  const stuck = page.call('message', {args: [1]});
  await settle();
  timers.fire(relay.CALL_MS);
  assert.match((await stuck).error, /did not answer/);
  WebContentsView.answer = () => 'not an object';
  assert.deepEqual(await page.call('message', {args: [1]}), {value: null});
});

// ---- the wiring in scripting.cjs: the isolated-world call carries the shim for an Acira package, not for a loose folder
test('scripting: after a click the extension\'s files run behind the shim in the isolated world (an Acira package), and as before for a folder the person loaded', async () => {
  const {host, manifestExtension, ID: FIXTURE_ID} = require('./fixtures/ext-api-p8/host.cjs');
  const activeTab = require('../desktop/browser-services/ext-api/surfaces/active-tab.cjs');
  const userData = tmp();
  const make = folder => {
    fs.writeFileSync(path.join(folder, 'inject.js'), 'chrome.runtime.id');
    const extension = manifestExtension(FIXTURE_ID, {manifest_version: 3, name: 'Colorway', version: '1', permissions: ['activeTab', 'scripting', 'storage'], action: {}, background: {service_worker: 'worker.js'}}, 'Colorway', {path: folder});
    const tabs = new Map(), store = Object.assign(new EventEmitter(), {tabs: new Set(), getTabById: id => tabs.get(id) || null});
    const h = host({packages: ['scripting'], extensions: [extension], store, userData});
    const wc = fakePage('https://example.com/a', 7);
    wc.mainFrame.framesInSubtree = [wc.mainFrame]; wc.mainFrame.url = 'https://example.com/a';
    tabs.set(7, wc);
    activeTab.grant(h.session, FIXTURE_ID, 7, 'https://example.com/a');
    return {h, wc, run: () => h.call('scripting.activeTab.executeScript', null, {target: {tabId: 7}, files: ['inject.js']})};
  };
  const own = make(packageIn(userData, {}));
  await own.run();
  const [world, code] = own.wc.executed.at(-1);
  assert.ok(world >= 1_100_000);
  assert.match(code, /^\(function contentShim\(/);
  assert.match(code, /\)\(\);?\n?chrome\.runtime\.id$|;\nchrome\.runtime\.id$/, 'the extension\'s own file follows the shim');
  assert.equal(own.wc.listenerCount('console-message'), 1);
  const loose = make(tmp());
  await loose.run();
  assert.equal(loose.wc.executed.at(-1)[1], 'chrome.runtime.id', 'a folder the person loaded: exactly the file, as before');
  own.h.dispose(); loose.h.dispose();
});
// A private window's extensions run with userData = <user data>/Partitions/acira-private-ext-window-<id>/acira-runtime while their folders stay the profile's
// (<user data>/extension-packages): the click-injected world got no shim there (Inspecta / Colorway in a private window: "Cannot read properties of undefined (reading 'local')").
test('a private window\'s runtime (its own userData under Partitions) still finds the profile\'s packages: the shim and the relay files are made there too', () => {
  const userData = tmp(), folder = packageIn(userData);
  const privateData = path.join(userData, 'Partitions', 'acira-private-ext-window-55904e18', 'acira-runtime');
  assert.equal(relay.isAciraPackage(folder, privateData), true);
  assert.equal(relay.isAciraPackage(folder, userData), true, 'the ordinary runtime as before');
  assert.equal(relay.isAciraPackage(path.join(privateData, 'extension-packages', 'x', ID), privateData), false, 'not the private runtime\'s own folders');
  assert.equal(relay.isAciraPackage(path.join(userData, 'elsewhere', ID), privateData), false);
  assert.equal(relay.isAciraPackage(path.join(tmp(), 'extension-packages', 'h', ID), privateData), false, 'another user data folder');
  assert.equal(relay.isAciraPackage(folder, path.join('Partitions', 'x')), false, 'a relative nothing');
  const extension = {id: ID, path: folder, manifest: {manifest_version: 3, name: 'Inspecta', version: '1', permissions: ['activeTab', 'storage']}};
  const world = createContentWorld({session: {}, userData: privateData, relays: {relayFor: () => ({call: async () => ({value: 1})})}, activeTab: {has: () => true}, hasPermission: () => true});
  assert.match(world.prepare(extension, fakePage(), 1_234_567), /^\(function contentShim\(/, 'a shim for the private session\'s page');
  assert.ok(fs.existsSync(path.join(folder, relay.PAGE)) && fs.existsSync(path.join(folder, relay.SCRIPT)));
});
