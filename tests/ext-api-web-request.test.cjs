'use strict';
// P5 chrome.webRequest: the fan-out over Acira's one Electron webRequest hook (desktop/request-pipeline.cjs observers), Chrome's filters,
// host-permission and hiding rules, details per extraInfoSpec, event order, the blocking-permission rule, onAuthRequired answers, and the
// renderer side (per-context dispatch, Chromium's argument errors, extraHeaders trimming) in the real patched preload.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {RequestPipeline, observeRequests} = require('../desktop/request-pipeline.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const webRequest = require('../desktop/browser-services/ext-api/web-request.cjs');
const {compilePattern, urlParts} = require('../desktop/browser-services/ext-api/web-request/patterns.cjs');
const tabIds = require('../desktop/browser-services/ext-api/surfaces/tab-ids.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const OTHER = 'bcdefghijklmnopabcdefghijklmnopa';

function fakeSession() {
  const hooks = {};
  const webRequestApi = {};
  for (const name of ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred']) {
    webRequestApi[name] = (filter, listener) => { if (listener === undefined) listener = filter; if (listener) hooks[name] = listener; else delete hooks[name]; };
  }
  const extensions = new EventEmitter();
  const started = [];
  const session = {webRequest: webRequestApi, extensions, serviceWorkers: {startWorkerForScope: async scope => { started.push(scope); return session.worker; }}};
  return {session, hooks, started};
}
function fakeWorker() { const sent = []; return {sent, destroyed: false, send(channel, payload) { sent.push([channel, payload]); }, isDestroyed() { return this.destroyed; }}; }
function setup({manifests = {}} = {}) {
  const {session, hooks, started} = fakeSession();
  const pipeline = new RequestPipeline(session);
  const handlers = new Map();
  const extensions = {[ID]: {id: ID, manifest: {manifest_version: 3, permissions: ['webRequest'], host_permissions: ['<all_urls>']}},
    [OTHER]: {id: OTHER, manifest: {manifest_version: 3, permissions: ['webRequest'], host_permissions: ['https://only.example/*']}}};
  for (const [id, manifest] of Object.entries(manifests)) extensions[id] = {id, manifest};
  const tab = {id: 7, isDestroyed: () => false, getURL: () => 'https://page.example/'};
  const engineStore = {tabs: new Set([tab]), tabToWindow: new WeakMap([[tab, {id: 3}]])};
  const api = {session, handle: (name, fn) => handlers.set(name, fn), getExtension: id => extensions[id] || null, store: () => engineStore,
    permissions: null, log() {}};
  const installed = webRequest.install(api);
  const worker = fakeWorker();
  session.worker = worker;
  const event = (id = ID, sender = worker) => ({type: 'service-worker', sender, extension: extensions[id]});
  const add = (name, id, filter, spec = [], ext = ID, sender = worker) => handlers.get('webRequest.addListener')(event(ext, sender), name, id, filter, spec, 'w');
  return {session, hooks, started, pipeline, handlers, worker, add, event, tab, installed, extensions};
}
const request = (over = {}) => ({id: 41, url: 'https://site.example/app.js', method: 'GET', resourceType: 'script', timestamp: 1000,
  initiatorOrigin: 'https://page.example', referrer: 'https://page.example/', webContents: null, frame: null, ...over});
const run = (hooks, name, details, result = {}) => new Promise(resolve => hooks[name](details, value => resolve(value)));

test('match patterns follow Chrome: scheme wildcard, subdomains, ports, path + query', () => {
  const m = (pattern, url) => compilePattern(pattern)(urlParts(url));
  assert.equal(m('<all_urls>', 'wss://x.example/socket'), true);
  assert.equal(m('*://*.example.com/*', 'https://example.com/a'), true);
  assert.equal(m('*://*.example.com/*', 'https://a.b.example.com/a'), true);
  assert.equal(m('*://*.example.com/*', 'https://badexample.com/a'), false);
  assert.equal(m('*://*/*', 'ftp://x.example/a'), false, '* is http, https, ws, wss only');
  assert.equal(m('https://x.example/api/*', 'https://x.example/api/v1?q=1'), true);
  assert.equal(m('https://x.example/*?q=1', 'https://x.example/a?q=1'), true, 'the path glob sees the query');
  assert.equal(m('http://localhost:8080/*', 'http://localhost:8080/a'), true);
  assert.equal(m('http://localhost:8080/*', 'http://localhost:9090/a'), false);
  assert.equal(m('http://localhost/*', 'http://localhost:9090/a'), true, 'no port in the pattern = any port');
  for (const bad of ['https://x.example', 'x.example/*', 'https://*x.example/*', 'chrome://settings/*']) assert.equal(compilePattern(bad), null, bad);
});

test('no extension listening: the pipeline adds no Electron hooks and calls no observer', async () => {
  const {hooks, session} = setup();
  assert.deepEqual(Object.keys(hooks).sort(), ['onBeforeRequest', 'onBeforeSendHeaders', 'onCompleted', 'onErrorOccurred', 'onHeadersReceived'], 'only Acira\'s own hooks (its three decisions + lifetime tracking)');
  assert.equal(session[webRequest.HOST].active, false);
  assert.deepEqual(await run(hooks, 'onBeforeRequest', request()), {});
});

test('listeners get Chrome\'s details once per context, in Chrome\'s event order, through the one Electron hook', async () => {
  const {hooks, add, worker, session} = setup();
  const events = ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'];
  events.forEach((name, i) => add(name, 'w:' + i, {urls: ['<all_urls>']}, name === 'onBeforeSendHeaders' || name === 'onSendHeaders' ? ['requestHeaders'] : name === 'onErrorOccurred' || name === 'onBeforeRequest' ? [] : ['responseHeaders']));
  add('onBeforeRequest', 'w:9', {urls: ['https://site.example/*'], types: ['script']});
  assert.ok(hooks.onSendHeaders && hooks.onResponseStarted && hooks.onBeforeRedirect && hooks.onCompleted && hooks.onErrorOccurred, 'lazy hooks appear with listeners');
  const d = request();
  await run(hooks, 'onBeforeRequest', d);
  await run(hooks, 'onBeforeSendHeaders', {...d, requestHeaders: {Accept: '*/*', Cookie: 'a=1'}});
  hooks.onSendHeaders({...d, requestHeaders: {Accept: '*/*', Cookie: 'a=1'}});
  await run(hooks, 'onHeadersReceived', {...d, statusCode: 200, statusLine: 'HTTP/1.1 200 OK', responseHeaders: {'content-type': ['text/javascript'], 'set-cookie': ['x=1', 'y=2']}});
  hooks.onResponseStarted({...d, statusCode: 200, statusLine: 'HTTP/1.1 200 OK', fromCache: false, ip: '10.0.0.1', responseHeaders: {'content-type': ['text/javascript']}});
  hooks.onCompleted({...d, statusCode: 200, statusLine: 'HTTP/1.1 200 OK', fromCache: false, ip: '10.0.0.1', responseHeaders: {}});
  const payloads = worker.sent.map(([channel, p]) => { assert.equal(channel, webRequest.CHANNEL); return p; });
  assert.deepEqual(payloads.map(p => p.e), ['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onCompleted']);
  assert.deepEqual(payloads[0].ids, ['w:0', 'w:9'], 'one message for every matching listener of the context');
  assert.deepEqual(payloads[0].d, {requestId: '41', url: 'https://site.example/app.js', method: 'GET', frameId: -1, parentFrameId: -1, tabId: -1, type: 'script', initiator: 'https://page.example', timeStamp: 1000});
  assert.deepEqual(payloads[1].d.requestHeaders, [{name: 'Accept', value: '*/*'}, {name: 'Cookie', value: 'a=1'}]);
  assert.deepEqual(payloads[3].d.responseHeaders, [{name: 'content-type', value: 'text/javascript'}, {name: 'set-cookie', value: 'x=1'}, {name: 'set-cookie', value: 'y=2'}]);
  assert.equal(payloads[3].d.statusCode, 200);
  assert.equal(payloads[4].d.ip, '10.0.0.1');
  assert.equal(payloads[4].d.fromCache, false);
  assert.equal(session[webRequest.HOST].active, true);
});

test('Acira\'s blocker cancels: listeners still hear onBeforeRequest, then onErrorOccurred (as with Chrome\'s DNR)', async () => {
  const {hooks, add, worker, pipeline} = setup();
  pipeline.useBefore(details => (details.url.includes('ads') ? {cancel: true} : {}));
  add('onBeforeRequest', 'w:0', {urls: ['<all_urls>']});
  add('onErrorOccurred', 'w:1', {urls: ['<all_urls>']});
  assert.deepEqual(await run(hooks, 'onBeforeRequest', request({url: 'https://ads.example/x.js'})), {cancel: true}, 'Acira still decides');
  hooks.onErrorOccurred(request({url: 'https://ads.example/x.js', error: 'net::ERR_BLOCKED_BY_CLIENT', fromCache: false}));
  assert.deepEqual(worker.sent.map(([, p]) => [p.e, p.d.error]), [['onBeforeRequest', undefined], ['onErrorOccurred', 'net::ERR_BLOCKED_BY_CLIENT']]);
});

test('filters, host permissions, initiators, tabs and hidden requests', async () => {
  const {hooks, add, worker, tab, extensions} = setup();
  const other = fakeWorker();
  add('onBeforeRequest', 'w:0', {urls: ['<all_urls>'], tabId: 7, windowId: 3});
  add('onBeforeRequest', 'w:0', {urls: ['<all_urls>']}, [], OTHER, other);
  const frame = {frameTreeNodeId: 12, parent: null, url: 'https://page.example/'};
  await run(hooks, 'onBeforeRequest', request({webContents: tab, frame}));
  assert.equal(worker.sent.length, 1, 'tab and window filters match a request of tab 7 in window 3');
  assert.equal(worker.sent[0][1].d.tabId, 7);
  assert.equal(worker.sent[0][1].d.frameId, 0, 'a main frame is frame 0');
  assert.match(worker.sent[0][1].d.documentId, /^[0-9A-F]{32}$/);
  assert.equal(other.sent.length, 0, 'no host permission for site.example');
  await run(hooks, 'onBeforeRequest', request({url: 'https://only.example/a', initiatorOrigin: 'https://elsewhere.example'}));
  assert.equal(other.sent.length, 0, 'a subresource also needs host permission for its initiator');
  await run(hooks, 'onBeforeRequest', request({url: 'https://only.example/a', resourceType: 'subFrame', initiatorOrigin: 'https://elsewhere.example'}));
  assert.equal(other.sent.length, 1, 'navigations need host permission for the URL only');
  const before = worker.sent.length + other.sent.length;
  await run(hooks, 'onBeforeRequest', request({url: 'https://chromewebstore.google.com/detail/x', initiatorOrigin: undefined, webContents: tab}));
  await run(hooks, 'onBeforeRequest', request({url: 'https://filters.example/list.txt', initiatorOrigin: undefined}));
  await run(hooks, 'onBeforeRequest', request({url: `chrome-extension://${OTHER}/x.js`, initiatorOrigin: `chrome-extension://${OTHER}`}));
  await run(hooks, 'onBeforeRequest', request({url: 'file:///C:/x.txt', initiatorOrigin: undefined, webContents: tab}));
  assert.equal(worker.sent.length + other.sent.length, before + 1, 'Web Store, the browser\'s own downloads and file: are hidden; an extension sees its own resources only');
  assert.equal(other.sent.at(-1)[1].d.url, `chrome-extension://${OTHER}/x.js`);
  void extensions;
});

test('requests of an extension are seen only by that extension; a Tor-flagged session shows nothing', async () => {
  const {hooks, add, worker, session} = setup({manifests: {}});
  const other = fakeWorker();
  add('onBeforeRequest', 'w:0', {urls: ['<all_urls>']});
  add('onBeforeRequest', 'w:0', {urls: ['https://only.example/*']}, [], OTHER, other);
  await run(hooks, 'onBeforeRequest', request({url: 'https://only.example/api', initiatorOrigin: `chrome-extension://${OTHER}`}));
  assert.equal(worker.sent.length, 0);
  assert.equal(other.sent.length, 1);
  session.__aciraTor = true;
  await run(hooks, 'onBeforeRequest', request());
  assert.equal(worker.sent.length, 0);
});

test('blocking listeners: Chrome\'s refusal for MV3, allowed for MV2 webRequestBlocking and for onAuthRequired with webRequestAuthProvider', () => {
  const MV2 = 'cdefghijklmnopabcdefghijklmnopab', AUTH = 'defghijklmnopabcdefghijklmnopabc', NOHOST = 'efghijklmnopabcdefghijklmnopabcd';
  const {add} = setup({manifests: {[MV2]: {manifest_version: 2, permissions: ['webRequest', 'webRequestBlocking', '<all_urls>']},
    [AUTH]: {manifest_version: 3, permissions: ['webRequest', 'webRequestAuthProvider'], host_permissions: ['<all_urls>']},
    [NOHOST]: {manifest_version: 3, permissions: ['webRequest']}}});
  assert.throws(() => add('onBeforeRequest', 'w:0', {urls: ['<all_urls>']}, ['blocking']), {message: webRequest.MESSAGES.blocking});
  assert.doesNotThrow(() => add('onBeforeRequest', 'w:0', {urls: ['<all_urls>']}, ['blocking'], MV2));
  assert.doesNotThrow(() => add('onAuthRequired', 'w:0', {urls: ['<all_urls>']}, ['asyncBlocking'], AUTH));
  assert.throws(() => add('onBeforeSendHeaders', 'w:1', {urls: ['<all_urls>']}, ['blocking'], AUTH), {message: webRequest.MESSAGES.blocking});
  assert.throws(() => add('onCompleted', 'w:0', {urls: ['<all_urls>']}, [], NOHOST), {message: webRequest.MESSAGES.hosts});
  assert.throws(() => add('onCompleted', 'w:0', {urls: ['nope']}), {message: "'nope' is not a valid URL pattern."});
});

test('onAuthRequired: a blocking listener\'s credentials answer the challenge; no answer falls through to Acira', async () => {
  const AUTH = 'defghijklmnopabcdefghijklmnopabc';
  const {hooks, add, handlers, session, event, tab} = setup({manifests: {[AUTH]: {manifest_version: 3, permissions: ['webRequest', 'webRequestAuthProvider'], host_permissions: ['<all_urls>']}}});
  const authWorker = fakeWorker();
  add('onAuthRequired', 'w:0', {urls: ['<all_urls>']}, ['asyncBlocking'], AUTH, authWorker);
  await run(hooks, 'onHeadersReceived', request({url: 'https://secure.example/', resourceType: 'mainFrame', statusCode: 401, statusLine: 'HTTP/1.1 401 Unauthorized', initiatorOrigin: undefined, webContents: tab}));
  const host = session[webRequest.HOST];
  const answer = host.authRequired(null, {url: 'https://secure.example/'}, {isProxy: false, scheme: 'basic', host: 'secure.example', port: 443, realm: 'Members'});
  assert.ok(answer && typeof answer.then === 'function');
  const [, payload] = authWorker.sent.at(-1);
  assert.equal(payload.e, 'onAuthRequired');
  assert.equal(payload.d.requestId, '41', 'the same requestId as the request\'s other events');
  assert.deepEqual([payload.d.isProxy, payload.d.scheme, payload.d.realm, payload.d.challenger, payload.d.statusCode], [false, 'basic', 'Members', {host: 'secure.example', port: 443}, 401]);
  handlers.get('webRequest.authReply')(event(AUTH, authWorker), payload.b, 'w', {authCredentials: {username: 'u', password: 'p'}});
  assert.deepEqual(await answer, {authCredentials: {username: 'u', password: 'p'}});
  const second = host.authRequired(null, {url: 'https://secure.example/'}, {isProxy: false, scheme: 'basic', host: 'secure.example', port: 443});
  handlers.get('webRequest.authReply')(event(AUTH, authWorker), authWorker.sent.at(-1)[1].b, 'w', null);
  assert.equal(await second, null, 'no answer: Acira\'s own prompt');
});

test('a stopped worker is woken for a matching event (lazy listener)', async () => {
  const {hooks, add, worker, started} = setup();
  add('onCompleted', 'w:0', {urls: ['<all_urls>']});
  worker.destroyed = true;
  const fresh = fakeWorker();
  hooks.onCompleted(request({statusCode: 200, statusLine: 'HTTP/1.1 200 OK', fromCache: true}));
  // the fake startWorkerForScope answers session.worker
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [`chrome-extension://${ID}/`]);
  void fresh;
});

test('removing the last listener removes the lazy Electron hooks again', () => {
  const {hooks, add, handlers, event, session} = setup();
  add('onSendHeaders', 'w:0', {urls: ['<all_urls>']});
  assert.ok(hooks.onSendHeaders);
  handlers.get('webRequest.removeListener')(event(), 'onSendHeaders', 'w:0', 'w');
  assert.equal(hooks.onSendHeaders, undefined);
  assert.ok(hooks.onCompleted, 'lifetime tracking keeps its own hook');
  assert.equal(session[webRequest.HOST].active, false);
});

test('observers registered before the pipeline exists are picked up by it', async () => {
  const {session, hooks} = fakeSession();
  const seen = [];
  const handle = observeRequests(session, {phases: ['before', 'sent'], notify: (phase, details) => seen.push([phase, details.id])});
  new RequestPipeline(session);
  await run(hooks, 'onBeforeRequest', request());
  hooks.onSendHeaders(request());
  assert.deepEqual(seen, [['before', 41], ['sent', 41]]);
  handle.dispose();
  assert.equal(hooks.onSendHeaders, undefined);
});

test('renderer: per-context dispatch by listener id, details trimmed per extraInfoSpec, Chromium\'s argument errors', async () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'web-request');
  const world = extensionWorld({manifest_version: 3, permissions: ['webRequest'], host_permissions: ['<all_urls>']}, {packages, worker: true});
  const {webRequest: wr} = world.chrome;
  const a = [], b = [];
  wr.onBeforeSendHeaders.addListener(d => a.push(d), {urls: ['<all_urls>']}, ['requestHeaders']);
  wr.onBeforeSendHeaders.addListener(d => b.push(d), {urls: ['<all_urls>']}, ['requestHeaders', 'extraHeaders']);
  const registered = world.calls.filter(c => c.name === 'webRequest.addListener').map(c => c.args);
  assert.deepEqual(plain(registered), [['onBeforeSendHeaders', 'w:0', {urls: ['<all_urls>']}, ['requestHeaders'], 'w'], ['onBeforeSendHeaders', 'w:1', {urls: ['<all_urls>']}, ['requestHeaders', 'extraHeaders'], 'w']]);
  world.emit('aciraWebRequest.event', {e: 'onBeforeSendHeaders', ids: ['w:0', 'w:1'], d: {requestId: '1', url: 'https://a.example/', requestHeaders: [{name: 'Accept', value: '*/*'}, {name: 'Cookie', value: 'a=1'}]}});
  assert.deepEqual(plain(a[0].requestHeaders), [{name: 'Accept', value: '*/*'}]);
  assert.deepEqual(plain(b[0].requestHeaders), [{name: 'Accept', value: '*/*'}, {name: 'Cookie', value: 'a=1'}]);
  a[0].url = 'changed';
  assert.equal(b[0].url, 'https://a.example/', 'every listener gets its own copy');
  world.emit('aciraWebRequest.event', {e: 'onBeforeSendHeaders', ids: ['w:1'], d: {requestId: '2', url: 'https://b.example/'}});
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
  assert.throws(() => wr.onCompleted.addListener(() => {}, {urls: ['<all_urls>']}, ['requestHeaders']), /Error in invocation of webRequest\.onCompleted\(webRequest\.RequestFilter filter, optional array extraInfoSpec\): Error at parameter 'extraInfoSpec'/);
  assert.throws(() => wr.onCompleted.addListener(() => {}, {urls: ['<all_urls>'], types: ['script', 'bogus']}), /Error at parameter 'filter'/);
  const listener = () => {};
  wr.onCompleted.addListener(listener, {urls: ['<all_urls>']});
  assert.equal(wr.onCompleted.hasListener(listener), true);
  wr.onCompleted.removeListener(listener);
  assert.equal(wr.onCompleted.hasListeners(), false);
  assert.equal(wr.MAX_HANDLER_BEHAVIOR_CHANGED_CALLS_PER_10_MINUTES, 20);
  assert.equal(wr.ResourceType.MAIN_FRAME, 'main_frame');
  assert.deepEqual(world.logged.log, [], 'nothing logged per event');
});

test('renderer: asyncBlocking onAuthRequired answers once per context; a namespace without permission is absent', async () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'web-request');
  const world = extensionWorld({manifest_version: 3, permissions: ['webRequest', 'webRequestAuthProvider'], host_permissions: ['<all_urls>']}, {packages, worker: true});
  world.chrome.webRequest.onAuthRequired.addListener((details, done) => setTimeout(() => done({authCredentials: {username: 'u', password: 'p'}}), 0), {urls: ['<all_urls>']}, ['asyncBlocking']);
  world.emit('aciraWebRequest.event', {e: 'onAuthRequired', ids: ['w:0'], d: {requestId: '9', url: 'https://a.example/'}, b: 'a1', k: 'w'});
  await new Promise(resolve => setTimeout(resolve, 5));
  const replies = world.calls.filter(c => c.name === 'webRequest.authReply').map(c => plain(c.args));
  assert.deepEqual(replies, [['a1', 'w', {authCredentials: {username: 'u', password: 'p'}}]]);
  const without = extensionWorld({manifest_version: 3, permissions: ['storage']}, {packages, worker: true});
  assert.equal(without.chrome.webRequest, undefined);
});

test('a request of a tab the extension knows by another id than its page (restored from sleep) carries the tab\'s id, and the tabId filter takes that id', async () => {
  const {session, hooks, add, worker, tab} = setup();
  tabIds.register(session, {ofPage: wc => (wc === tab ? 2000000002 : wc.id), pageOf: id => (id === 2000000002 ? 7 : null)});
  add('onBeforeRequest', 'w:0', {urls: ['<all_urls>'], tabId: 2000000002});
  add('onBeforeRequest', 'w:1', {urls: ['<all_urls>'], tabId: 7});
  const frame = {frameTreeNodeId: 12, parent: null, url: 'https://page.example/'};
  await run(hooks, 'onBeforeRequest', request({webContents: tab, frame}));
  assert.equal(worker.sent.length, 1, 'only the listener that named the extension\'s id hears it');
  assert.equal(worker.sent[0][1].d.tabId, 2000000002);
});
