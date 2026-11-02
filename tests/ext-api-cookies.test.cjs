'use strict';
// chrome.cookies (ext-api/cookies*.cjs): the profile's one ordinary store, host permissions on every call, Chrome's shapes and errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const model = require('../desktop/browser-services/ext-api/cookies/model.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');
const {world, fakeSession, manifest, A, B} = require('./fixtures/ext-api-proxy/harness.cjs');

const all = {name: 'Cookie Jar', manifest: manifest(['cookies'], {host_permissions: ['<all_urls>']})};
const example = {name: 'Example Only', manifest: manifest(['cookies'], {host_permissions: ['https://*.example.com/*']})};
const noHosts = {name: 'No Hosts', manifest: manifest(['cookies'])};

/** An in-memory stand-in for session.cookies with Electron's shapes and (simplified) URL matching. */
function jar(initial = []) {
  const list = initial.map(cookie => ({hostOnly: false, path: '/', secure: false, httpOnly: false, session: true, sameSite: 'unspecified', ...cookie}));
  const emitter = new EventEmitter();
  const matches = (cookie, url) => {
    const host = url.hostname, domain = cookie.domain.replace(/^\./, '');
    const hostOk = cookie.hostOnly ? host === domain : host === domain || host.endsWith('.' + domain);
    return hostOk && url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === 'https:');
  };
  emitter.list = list;
  emitter.get = async filter => list.filter(cookie => (!filter.url || matches(cookie, new URL(filter.url))) && (filter.name === undefined || cookie.name === filter.name)).map(cookie => ({...cookie}));
  emitter.set = async details => {
    if (details.name === 'bad') throw new Error('Failed to set cookie with details');
    const url = new URL(details.url), domain = details.domain || url.hostname;
    const at = list.findIndex(c => c.name === details.name && c.domain === domain && c.path === (details.path || '/'));
    const cookie = {name: details.name, value: details.value, domain, hostOnly: !details.domain, path: details.path || '/', secure: !!details.secure, httpOnly: !!details.httpOnly, session: details.expirationDate === undefined, sameSite: details.sameSite || 'unspecified', ...(details.expirationDate === undefined ? {} : {expirationDate: details.expirationDate})};
    if (at >= 0) { emitter.emit('changed', {}, list[at], 'overwrite', true); list.splice(at, 1); }
    list.push(cookie); emitter.emit('changed', {}, cookie, 'explicit', false);
  };
  emitter.remove = async (urlText, name) => {
    const url = new URL(urlText);
    for (const cookie of [...list]) if (cookie.name === name && matches(cookie, url)) { list.splice(list.indexOf(cookie), 1); emitter.emit('changed', {}, cookie, 'explicit', true); }
  };
  return emitter;
}
const seed = () => jar([
  {name: 'sid', value: '1', domain: '.example.com', path: '/', secure: true, httpOnly: true},
  {name: 'sid', value: '2', domain: 'www.example.com', hostOnly: true, path: '/app', secure: true},
  {name: 'pref', value: 'dark', domain: '.example.com', path: '/', session: false, expirationDate: 2000000000},
  {name: 'other', value: 'x', domain: '.other.net', path: '/'}
]);
const setup = (extensions, extra = {}) => world({packages: ['cookies'], extensions, session: fakeSession({cookies: seed()}), ...extra});

test('getAll with a url: Chrome\'s cookie shape, longer paths first, filters, host permission', async () => {
  const w = setup({[A]: example});
  try {
    const list = await w.call(A, 'cookies.getAll', {url: 'https://www.example.com/app/x'});
    assert.deepEqual(list.map(c => [c.name, c.value, c.path]), [['sid', '2', '/app'], ['sid', '1', '/'], ['pref', 'dark', '/']], 'the cookies the request would send, longest path first');
    assert.deepEqual(list[0], {name: 'sid', value: '2', domain: 'www.example.com', hostOnly: true, path: '/app', secure: true, httpOnly: false, sameSite: 'unspecified', session: true, storeId: '0'});
    assert.equal(list[2].expirationDate, 2000000000);
    assert.equal(list[0].expirationDate, undefined, 'a session cookie has no expirationDate');
    assert.deepEqual((await w.call(A, 'cookies.getAll', {url: 'https://www.example.com/', name: 'pref'})).map(c => c.value), ['dark']);
    assert.deepEqual((await w.call(A, 'cookies.getAll', {url: 'https://www.example.com/', session: false})).map(c => c.name), ['pref']);
    assert.deepEqual((await w.call(A, 'cookies.getAll', {url: 'https://www.example.com/', domain: 'example.com', secure: true, path: '/'})).map(c => c.value), ['1']);
    await assert.rejects(w.call(A, 'cookies.getAll', {url: 'https://other.net/'}), {message: 'No host permissions for cookies at url: "https://other.net/".'});
    await assert.rejects(w.call(A, 'cookies.getAll', {url: 'not a url'}), {message: 'Invalid url: "not a url".'});
    await assert.rejects(w.call(A, 'cookies.getAll', {url: 'ftp://example.com/'}), /Invalid url/);
  } finally { w.dispose(); }
});

test('getAll without a url: only cookies on hosts the extension has permission for (a cookie that is not secure is an http address)', async () => {
  const both = {name: 'Both Schemes', manifest: manifest(['cookies'], {host_permissions: ['*://*.example.com/*']})};
  const w = setup({[A]: example, [B]: all, ['c'.repeat(32)]: noHosts, ['d'.repeat(32)]: both});
  try {
    assert.deepEqual((await w.call(A, 'cookies.getAll', {})).map(c => c.domain).sort(), ['.example.com', 'www.example.com'], 'https-only permission: the plain-http pref cookie is not visible');
    assert.deepEqual((await w.call('d'.repeat(32), 'cookies.getAll', {})).map(c => c.domain).sort(), ['.example.com', '.example.com', 'www.example.com']);
    assert.equal((await w.call(B, 'cookies.getAll', {})).length, 4);
    assert.deepEqual(await w.call('c'.repeat(32), 'cookies.getAll', {}), []);
    assert.deepEqual((await w.call(B, 'cookies.getAll', {domain: 'other.net'})).map(c => c.name), ['other']);
  } finally { w.dispose(); }
});

test('get: the best match or null; the store id and partition key are honest', async () => {
  const w = setup({[A]: example});
  try {
    assert.equal((await w.call(A, 'cookies.get', {url: 'https://www.example.com/app/', name: 'sid'})).value, '2');
    assert.equal((await w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'sid'})).value, '1');
    assert.equal(await w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'nope'}), null);
    assert.equal((await w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'sid', storeId: '0'})).storeId, '0');
    await assert.rejects(w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'sid', storeId: '1'}), {message: 'Invalid cookie store id: "1".'});
    await assert.rejects(w.call(A, 'cookies.getAll', {storeId: 'private-1'}), {message: 'Invalid cookie store id: "private-1".'});
    assert.equal(await w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'sid', partitionKey: {topLevelSite: 'https://example.com'}}), null, 'partitioned cookies are not supported: nothing is found');
    assert.deepEqual(await w.call(A, 'cookies.getAll', {partitionKey: {}, url: 'https://www.example.com/'}), []);
  } finally { w.dispose(); }
});

test('set: host permission, the cookie that was set comes back, failures use Chrome\'s message', async () => {
  const w = setup({[A]: example});
  try {
    const cookie = await w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'n', value: 'v', secure: true, expirationDate: 2100000000, sameSite: 'lax'});
    assert.deepEqual([cookie.name, cookie.value, cookie.domain, cookie.hostOnly, cookie.secure, cookie.session, cookie.expirationDate, cookie.storeId], ['n', 'v', 'www.example.com', true, true, false, 2100000000, '0']);
    const domainCookie = await w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'd', value: '1', domain: 'example.com'});
    assert.deepEqual([domainCookie.domain, domainCookie.hostOnly], ['example.com', false]);
    await assert.rejects(w.call(A, 'cookies.set', {url: 'https://other.net/', name: 'n', value: 'v'}), {message: 'No host permissions for cookies at url: "https://other.net/".'});
    await assert.rejects(w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'bad', value: 'v'}), {message: 'Failed to parse or set cookie named "bad".'});
    await assert.rejects(w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'p', partitionKey: {topLevelSite: 'https://example.com'}}), {message: 'Failed to parse or set cookie named "p".'});
    await assert.rejects(w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'n', storeId: '7'}), /Invalid cookie store id/);
  } finally { w.dispose(); }
});

test('remove: Chrome\'s answer, the cookie is gone, other hosts are refused', async () => {
  const w = setup({[A]: example});
  try {
    assert.deepEqual(await w.call(A, 'cookies.remove', {url: 'https://www.example.com/', name: 'pref'}), {url: 'https://www.example.com/', name: 'pref', storeId: '0'});
    assert.equal(await w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'pref'}), null);
    assert.deepEqual(await w.call(A, 'cookies.remove', {url: 'https://www.example.com/', name: 'never-there'}), {url: 'https://www.example.com/', name: 'never-there', storeId: '0'}, 'removing nothing is not an error');
    await assert.rejects(w.call(A, 'cookies.remove', {url: 'https://other.net/', name: 'other'}), /No host permissions/);
    assert.equal(w.session.cookies.list.some(c => c.name === 'other'), true, 'the other site\'s cookie is untouched');
    assert.deepEqual(await w.call(A, 'cookies.remove', {url: 'https://www.example.com/', name: 'sid', partitionKey: {}}), {url: 'https://www.example.com/', name: 'sid', storeId: '0'});
    assert.equal(w.session.cookies.list.filter(c => c.name === 'sid').length, 2, 'a partitioned remove does not touch unpartitioned cookies');
  } finally { w.dispose(); }
});

test('getAllCookieStores: the profile\'s one store, with its own tabs only', async () => {
  const session = fakeSession({cookies: seed()});
  const tab = (id, owner, extra = {}) => ({id, session: owner, isDestroyed: () => false, ...extra});
  const w = world({packages: ['cookies'], extensions: {[A]: example}, session, contents: [tab(3, session), tab(4, fakeSession()), tab(5, session, {isDestroyed: () => true}), tab(6, session, {__aciraTorLocked: true})]});
  try {
    assert.deepEqual(await w.call(A, 'cookies.getAllCookieStores'), [{id: '0', tabIds: [3]}]);
  } finally { w.dispose(); }
});

test('Tor: a Tor session answers nothing and is never listened to', async () => {
  const tor = fakeSession({tor: true, cookies: seed()});
  const w = world({packages: ['cookies'], extensions: {[A]: all}, session: tor});
  try {
    await assert.rejects(w.call(A, 'cookies.getAll', {}), {message: 'Access to extension API denied.'});
    await assert.rejects(w.call(A, 'cookies.get', {url: 'https://www.example.com/', name: 'sid'}), {message: 'Access to extension API denied.'});
    await assert.rejects(w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'x', value: 'y'}), {message: 'Access to extension API denied.'});
    await assert.rejects(w.call(A, 'cookies.remove', {url: 'https://www.example.com/', name: 'sid'}), {message: 'Access to extension API denied.'});
    assert.equal(tor.cookies.list.length, 4, 'untouched');
    assert.equal(tor.cookies.listenerCount('changed'), 0);
  } finally { w.dispose(); }
});

test('without the cookies permission nothing is answered', async () => {
  const w = setup({[A]: {name: 'x', manifest: manifest(['storage'], {host_permissions: ['<all_urls>']})}});
  try {
    await assert.rejects(w.call(A, 'cookies.getAll', {}), {message: 'Access to extension API denied.'});
  } finally { w.dispose(); }
});

test('onChanged: only extensions with host permission for the cookie hear it; causes use Chrome\'s names', async () => {
  const w = setup({[A]: example, [B]: {name: 'Other Net', manifest: manifest(['cookies'], {host_permissions: ['https://*.other.net/*']})}});
  try {
    w.listen(A, 'acira.cookies.onChanged'); w.listen(B, 'acira.cookies.onChanged');
    await w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'n', value: '1', secure: true});
    await w.call(A, 'cookies.set', {url: 'https://www.example.com/', name: 'n', value: '2', secure: true});
    await w.call(A, 'cookies.remove', {url: 'https://www.example.com/', name: 'n'});
    const events = w.sent.filter(s => s[1] === 'acira.cookies.onChanged');
    assert.ok(events.every(s => s[0] === A), 'B has no permission for example.com');
    assert.deepEqual(events.map(s => [s[2].removed, s[2].cookie.value, s[2].cause]), [[false, '1', 'explicit'], [true, '1', 'overwrite'], [false, '2', 'explicit'], [true, '2', 'explicit']]);
    assert.equal(events[0].at(2).cookie.storeId, '0');
    assert.equal(w.sent.some(s => s[1] === 'cookies.onChanged'), false, 'the engine\'s unfiltered broadcast name is not used');
    assert.deepEqual(['expired-overwrite', 'inserted', 'unknown-deletion', 'evicted', 'overwrite', 'expired'].map(model.cause), ['expired_overwrite', 'explicit', 'explicit', 'evicted', 'overwrite', 'expired']);
  } finally { w.dispose(); }
});

test('renderer: chrome.cookies has Chromium\'s shape and checks arguments', async () => {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'cookies');
  const world = extensionWorld({manifest_version: 3, permissions: ['cookies'], host_permissions: ['<all_urls>']}, {packages, answer: (name, args) => (name === 'cookies.get' ? {name: args[0].name} : name === 'cookies.getAllCookieStores' ? [{id: '0', tabIds: []}] : undefined)});
  const {chrome} = world;
  for (const member of ['get', 'getAll', 'set', 'remove', 'getAllCookieStores', 'getPartitionKey']) assert.equal(typeof chrome.cookies[member], 'function', member);
  assert.equal(chrome.cookies.OnChangedCause.EXPIRED_OVERWRITE, 'expired_overwrite');
  assert.deepEqual(plain(await chrome.cookies.get({url: 'https://a.example/', name: 'n'})), {name: 'n'});
  assert.deepEqual(plain(await chrome.cookies.getAllCookieStores()), [{id: '0', tabIds: []}]);
  assert.throws(() => chrome.cookies.get({name: 'n'}), {message: /^Error in invocation of cookies\.get\(cookies\.CookieDetails details, optional function callback\).*Missing required property 'url'/});
  const heard = [];
  chrome.cookies.onChanged.addListener(info => heard.push(info.cause));
  world.emit('acira.cookies.onChanged', {removed: false, cookie: {}, cause: 'explicit'});
  assert.deepEqual(heard, ['explicit']);
});
