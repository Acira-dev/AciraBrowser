'use strict';
// 13.8 exit-cleanup, the structural fix. Acira's OWN scheduled downloads (filter lists, threat lists, the site allow-list) used to leave on the first ordinary profile's session, so each was a tracked
// request of that profile's pipeline (the count the exit cleanup waits on and the release check reads after the profile's last window is closed): the laptop's kept profiles showed the two failing
// runs (a 13.8 candidate, 13.7) were a threat-list download still in flight on a profile with no page left. They now leave on a network context of their own (browser-services/background-network.cjs: an
// in-memory session with no cache, given the profile's route before each download, like the update check), never on a profile's session. content-blocking.cjs runs here as it does in the app, under a
// stand-in for Electron; nothing starts a real Electron or a real request.
const Module = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');

// ---- Electron as the main process has it, reduced to what these modules touch
const netRequests = [];
let nextId = 100;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'background-network-'));
const stub = {
  app: {getPath: () => tmp, isPackaged: false, on() {}, whenReady: () => new Promise(() => {}), getVersion: () => '0'},
  webContents: {fromId() {}}, dialog: {}, BaseWindow: {}, ipcMain: {handle() {}, on() {}}, session: {}, protocol: {},
  /** The default downloader's transport (public-list-download.cjs): a request that stays open, on the session it was given. Like Electron it is counted by that session's webRequest, if it has one. */
  net: {request(options) {
    const request = new EventEmitter();
    Object.assign(request, {options, aborted: 0, setHeader() {}, end() {}, abort() { this.aborted++; }, followRedirect() {}});
    netRequests.push(request);
    inFlight(options.session, options.url);
    return request;
  }},
};
const real = Module._load;
Module._load = function (request) { return request === 'electron' ? stub : real.apply(this, arguments); };
const {createContentBlocking} = require('../desktop/content-blocking.cjs');
const {BrowserDatabase} = require('../desktop/database.cjs');
const {createBackgroundNetwork, NOT_CONFIRMED, NOT_READY} = require('../desktop/browser-services/background-network.cjs');
const work = require('../desktop/browser-services/background-work.cjs');
const {SOURCES: THREAT_SOURCES} = require('../desktop/browser-services/threat-lists.cjs');

/** What Electron tells a session's webRequest listeners when a request leaves on it. A session with no listener (the background session) tells nobody. */
function inFlight(session, url) { if (session && session.handlers && session.handlers.onBeforeRequest) session.handlers.onBeforeRequest({id: ++nextId, url, method: 'GET', resourceType: 'other'}, () => {}); }
function fakeSession(name, {pipelineSide = true} = {}) {
  const handlers = {};
  const base = {name, handlers, isPersistent: () => true, webRequest: pipelineSide ? new Proxy({}, {get: (_, key) => (filter, listener) => { handlers[key] = listener === undefined ? filter : listener; }}) : undefined};
  return new Proxy(base, {get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined /* a session is not a promise */ : typeof key === 'string' ? new Proxy(function () {}, {get: () => () => {}, apply: () => undefined}) : undefined)});
}

function blocking(backgroundNetwork) {
  const database = new BrowserDatabase(path.join(fs.mkdtempSync(path.join(tmp, 'db-')), 'browser.sqlite'));
  return createContentBlocking({ipcMain: stub.ipcMain, dialog: stub.dialog, database, getOwner: () => null, getProfiles: () => [], getNetworkPreferences: () => null,
    privacyPlusDirectory: tmp, filtersPath: path.resolve(__dirname, '..', 'resources', 'filters'), cachePath: path.join(tmp, 'filter-cache-' + Math.random().toString(36).slice(2)), ...(backgroundNetwork ? {backgroundNetwork} : {})});
}

/** A background network on stand-ins: every download is recorded with the session it was given and stays open. */
function background({allowed = () => true, route} = {}) {
  const session = fakeSession('background', {pipelineSide: false});
  const log = {routes: 0, downloads: [], fetches: []};
  const network = createBackgroundNetwork({
    session: () => session, allowed,
    route: route || (async () => { log.routes++; }),
    request: (url, given) => { log.downloads.push({url, session: given.name, routesBefore: log.routes}); inFlight(given, url); return new Promise(() => {}); },
    fetchText: (url, given) => { log.fetches.push({url, session: given.name, routesBefore: log.routes}); inFlight(given, url); return new Promise(() => {}); },
  });
  return {network, session, log};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('the background network: a download goes out on the background session after the route was followed, never on the profile session that asked; the allow-list likewise', async () => {
  const b = background(), profile = fakeSession('profile-A');
  void b.network.download('https://lists.example/a.txt', profile, {timeoutMs: 1});
  void b.network.fetchText('https://reports.example/allowlist.json', profile);
  await settle();
  assert.deepEqual(b.log.downloads.map(item => [item.url, item.session]), [['https://lists.example/a.txt', 'background']]);
  assert.deepEqual(b.log.fetches.map(item => [item.url, item.session]), [['https://reports.example/allowlist.json', 'background']]);
  assert.ok([...b.log.downloads, ...b.log.fetches].every(item => item.routesBefore >= 1), 'each after its route');
  assert.equal(b.log.routes, 1, 'the route is followed before the downloads (the two that started together share the one change; a later download asks again)');
});

test('a route that is not confirmed, or a network the cleanup has not opened (or is closing), sends nothing and says why', async () => {
  const unconfirmed = background({route: async () => { throw Object.assign(new Error('x'), {code: 'ERR_UPDATE_ROUTE'}); }});
  await assert.rejects(unconfirmed.network.download('https://lists.example/a.txt', fakeSession('p')), error => error.message === NOT_CONFIRMED && error.code === 'ERR_BACKGROUND_NETWORK');
  assert.deepEqual([unconfirmed.log.downloads.length, unconfirmed.log.fetches.length], [0, 0]);
  const closed = background({allowed: () => false});
  await assert.rejects(closed.network.download('https://lists.example/a.txt', fakeSession('p')), error => error.message === NOT_READY);
  await assert.rejects(closed.network.fetchText('https://reports.example/allowlist.json', fakeSession('p')), error => error.message === NOT_READY);
  assert.deepEqual([closed.log.routes, closed.log.downloads.length, closed.log.fetches.length], [0, 0, 0], 'not even the route is followed');
  const broken = background({route: async () => { throw new Error('disk'); }});
  await assert.rejects(broken.network.download('https://lists.example/a.txt', fakeSession('p')), /disk/, 'any other failure is passed on as it is');
});

test('content-blocking with the background network: the filter lists, the threat lists and the allow-list download on the background session only; the profile session is never used (before: every one of them was)', async () => {
  // before: no background network, the lists leave on the profile session
  netRequests.length = 0;
  const before = blocking(null), oldProfile = fakeSession('profile-old');
  before.attach(oldProfile, 'A', false);
  void before.filterLists.refresh(oldProfile).catch(() => {});
  await settle(); await settle();
  assert.ok(netRequests.length > 0, 'the filter sources were asked for');
  assert.deepEqual([...new Set(netRequests.map(request => request.options.session.name))], ['profile-old'], 'before: on the profile\'s own session');

  // now
  netRequests.length = 0;
  const b = background(), profile = fakeSession('profile-A');
  const after = blocking({download: b.network.download, downloadText: b.network.downloadText, fetchText: b.network.fetchText});
  after.attach(profile, 'A', false);
  void after.filterLists.refresh(profile).catch(() => {});
  void after.threats.lists.refresh(profile).catch(() => {});
  void after.threats.allowlist.refresh(profile).catch(() => {});
  await settle(); await settle();
  assert.ok(b.log.downloads.length >= 4, 'the filter sources and the first threat list were asked for: ' + b.log.downloads.length);
  assert.deepEqual([...new Set(b.log.downloads.map(item => item.session))], ['background']);
  assert.deepEqual([...new Set(b.log.fetches.map(item => item.session))], ['background'], 'the allow-list too');
  assert.ok(b.log.fetches.length >= 1);
  assert.equal(netRequests.length, 0, 'nothing reached the default transport on any session');
  assert.ok(b.log.downloads.every(item => item.routesBefore >= 1), 'each after the route');
});

test('closing every profile window leaves no tracked request on the profile\'s pipeline while a list download runs (before: the download was one)', async () => {
  // before: the pipeline content-blocking attached to the profile's session counts the download
  netRequests.length = 0;
  const before = blocking(null), oldProfile = fakeSession('profile-old');
  const oldPipeline = before.attach(oldProfile, 'A', false);
  void before.threats.lists.refresh(oldProfile).catch(() => {});
  await settle(); await settle();
  assert.equal(oldPipeline.hasActiveRequests(), true, 'before: a list download in flight is a tracked request of the profile, with no page left');
  assert.equal(oldPipeline.trackedRequests()[0].webContentsId, 'none');

  const b = background(), profile = fakeSession('profile-A');
  const after = blocking({download: b.network.download, downloadText: b.network.downloadText, fetchText: b.network.fetchText});
  const pipeline = after.attach(profile, 'A', false);
  void after.threats.lists.refresh(profile).catch(() => {});
  void after.filterLists.refresh(profile).catch(() => {});
  await settle(); await settle();
  assert.ok(b.log.downloads.length >= 2, 'the downloads are running');
  assert.equal(pipeline.hasActiveRequests(), false, 'the profile\'s pipeline counts nothing');
  assert.deepEqual(pipeline.trackedRequests(), []);
});

test('the stop at the quit still reaches a download on the background session (background-work.cjs): in flight it is aborted, afterwards nothing starts', async () => {
  const w = work.createBackgroundWork({lifecycle: null});
  work.setShared(w);
  try {
    netRequests.length = 0;
    const session = fakeSession('background', {pipelineSide: false});
    const network = createBackgroundNetwork({session: () => session, route: async () => {}});   // the real downloader on the stand-in transport
    const pending = network.download('https://lists.example/a.txt', fakeSession('profile-A'), {timeoutMs: 60_000});
    await settle();
    assert.equal(netRequests.length, 1);
    assert.equal(netRequests[0].options.session.name, 'background');
    w.interrupt();
    await assert.rejects(pending, error => error.closing === true);
    assert.equal(netRequests[0].aborted, 1);
    await assert.rejects(network.download('https://lists.example/b.txt', fakeSession('profile-A')), error => error.closing === true);
    assert.equal(netRequests.length, 1, 'no second request');
  } finally { work.setShared(null); }
});

test('main.cjs: the context is an in-memory session with no cache, follows the profile\'s route like the update check (which is left as it was), opens only when the cleanup lets the network out, and content-blocking is given it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /function backgroundNetwork\(\)\{if\(backgroundNetworkInstance\)return backgroundNetworkInstance;const \{session\}=require\('electron'\),target=session\.fromPartition\('acira-background',\{cache:false\}\)/);
  assert.match(main, /createUpdateRoute\(\{session:target,getSharedState:\(\)=>sharedState,getLastProfileId:\(\)=>lastNormalController\?\.profileId,liveStatus:profile=>contentBlocking\.proxy\.status\(session\.fromPartition\(profile\.partition\)\),liveRoute:profile=>contentBlocking\.proxy\.nativeRoute\(session\.fromPartition\(profile\.partition\)\)/);
  assert.match(main, /allowed:\(\)=>nativeNetwork\.isReady\(\)&&!\(profileCleanup&&!profileCleanup\.uiNetworkAllowed\(\)\)/);
  assert.match(main, /backgroundNetwork:\{download:\(\.\.\.args\)=>backgroundNetwork\(\)\.download\(\.\.\.args\),downloadText:\(\.\.\.args\)=>backgroundNetwork\(\)\.downloadText\(\.\.\.args\),fetchText:\(\.\.\.args\)=>backgroundNetwork\(\)\.fetchText\(\.\.\.args\)\}/);
  assert.match(main, /function updateRoute\(\)\{const \{session\}=require\('electron'\),proxy=/, 'the update check\'s own route is as it was');
  const blocking = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'content-blocking.cjs'), 'utf8');
  assert.equal((blocking.match(/backgroundNetwork\?\{(?:download|fetchText):backgroundNetwork\.(?:download|downloadText|fetchText)\}:\{\}/g) || []).length, 3, 'the filter lists, the threat lists and the allow-list');
  assert.match(blocking, /allowlist:siteAllowlist,\.\.\.\(backgroundNetwork\?\{download:backgroundNetwork\.downloadText\}:\{\}\)/, 'the threat lists take the TEXT downloader, as downloadList answers');
  assert.match(blocking, /createFilterUpdates\(\{\.\.\.filterListOptions,\.\.\.\(backgroundNetwork\?\{download:backgroundNetwork\.download\}:\{\}\)/, 'the filter lists take the object downloader');
  assert.match(main, /downloadText:\(\.\.\.args\)=>backgroundNetwork\(\)\.downloadText\(\.\.\.args\)/);
});

test('the threat lists are WRITTEN through the background network (the real-app check on the release tip found they were not: the lists were given the downloader\'s {status, text} object where they validate a text), and the filter lists keep the object', async () => {
  const text = url => /Phishing\.Database/.test(url)
    ? Array.from({length: 50100}, (_, i) => `d${i}.example.test`).join('\n') + '\nphishdb.example.top\n'
    : `! Title: ${(THREAT_SOURCES.find(source => source.urls.includes(url)) || THREAT_SOURCES[0]).title}\n! Updated: 2026-10-24T12:00:00Z\n! Expires: 12 hours (update frequency)\n${Array.from({length: 600}, (_, i) => `filler-${i}.example.test`).join('\n')}\nlisted.example.top\n`;
  const sessions = [];
  const session = fakeSession('background', {pipelineSide: false});
  const network = createBackgroundNetwork({session: () => session, route: async () => {}, request: async (url, given) => { sessions.push(given.name); return {status: 200, text: text(url), etag: '"e"', lastModified: undefined}; }, fetchText: async () => '{"schema":1,"hosts":[]}'});
  const cb = blocking({download: network.download, downloadText: network.downloadText, fetchText: network.fetchText});
  const profile = fakeSession('profile-A');
  cb.attach(profile, 'A', false);
  const status = await cb.threats.lists.refresh(profile);
  assert.equal(status.lastError, null, 'no list failed: ' + status.lastError);
  assert.deepEqual(status.lists.map(item => item.entries > 0), [true, true, true], 'every list has entries');
  for (const name of ['phishing.txt', 'malware.txt', 'phishing-db.txt']) assert.ok(fs.statSync(path.join(tmp, 'threat-lists', name)).size > 1000, name + ' is written');
  assert.deepEqual([...new Set(sessions)], ['background']);
  // the filter lists still take the object (status, text, validators)
  netRequests.length = 0;
  const reply = await network.download('https://lists.example/x.txt', profile, {});
  assert.deepEqual([reply.status, reply.etag], [200, '"e"']);
  assert.equal(await network.downloadText('https://lists.example/x.txt', profile, {etag: '"old"'}), text('https://lists.example/x.txt'), 'the text downloader answers the text, and asks without validators');
});

test('downloads that start together share ONE route change (the real-app check: eight filter sources each closed the connections of the others, eight net::ERR_ABORTED at the start); a later download asks again', async () => {
  let inRoute = 0, maxInRoute = 0, changes = 0;
  const route = async () => { changes++; inRoute++; maxInRoute = Math.max(maxInRoute, inRoute); await new Promise(resolve => setTimeout(resolve, 20)); inRoute--; };
  const b = background({route});
  const profile = fakeSession('profile-A');
  for (let i = 0; i < 8; i++) void b.network.download('https://lists.example/' + i + '.txt', profile, {});
  void b.network.fetchText('https://reports.example/allowlist.json', profile);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(changes, 1, 'one route change for nine downloads that started together');
  assert.equal(maxInRoute, 1);
  assert.equal(b.log.downloads.length, 8, 'and all of them went out after it');
  void b.network.download('https://lists.example/late.txt', profile, {});
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(changes, 2, 'a download that starts later asks again (update-route.cjs remembers the route and does nothing when it has not changed)');
  const failing = background({route: async () => { throw Object.assign(new Error('x'), {code: 'ERR_UPDATE_ROUTE'}); }});
  await Promise.allSettled([failing.network.download('https://a.example/', profile, {}), failing.network.download('https://b.example/', profile, {})]);
  await assert.rejects(failing.network.download('https://c.example/', profile, {}), error => error.message === NOT_CONFIRMED, 'a failed change is not remembered: the next download tries again');
});
