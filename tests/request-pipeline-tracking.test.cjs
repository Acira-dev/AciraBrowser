'use strict';
// 13.8 exit-cleanup diagnostics. The packaged exit-cleanup check read {"contents":[],"requests":[true],"workers":0} (13.7 1 of 6, a 13.8 candidate 2 of 5): the pipeline (request-pipeline.cjs) counts a request
// from onBeforeRequest to onCompleted / onErrorOccurred and nothing said WHICH request was still counted. The laptop's kept profiles then showed it was a live threat-list download. Every counted
// request now has a record (host only, type, method, the web contents it belongs to or none, age, last phase); the cleanup's failure, the profile-cleanup-shutdown record and the check's poll print
// it. Nothing is dropped from the count: Electron's proxying factory (shell/browser/net/proxying_url_loader_factory.cc) reports an end for every request it removes, so an open request is open.
// No Electron starts here.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {RequestPipeline} = require('../desktop/request-pipeline.cjs');
const {createExitCleanup} = require('../desktop/browser-services/exit-cleanup.cjs');
const {createProfileCleanupShutdown} = require('../desktop/profile-cleanup-shutdown.cjs');
const {BrowserDatabase} = require('../desktop/database.cjs');

/** A session whose webRequest listeners the test calls the way Electron does, and a clock and an owner table the test moves. */
function rig() {
  const handlers = {};
  const session = {isPersistent: () => true, webRequest: new Proxy({}, {get: (_, name) => (filter, listener) => { handlers[name] = listener === undefined ? filter : listener; }})};
  const clock = {t: 1_000_000}, owners = new Map();
  const pipeline = new RequestPipeline(session, {now: () => clock.t, ownerAlive: id => owners.get(id) !== false});
  const begin = (id, url, extra = {}) => handlers.onBeforeRequest({id, url, method: 'GET', resourceType: 'xhr', webContentsId: 5, ...extra}, () => {});
  return {pipeline, handlers, clock, owners, begin, session};
}

test('a counted request has a record: host only (never a path or a query), type, method, its web contents, age and last phase; the phases move it on; an end removes it', () => {
  const r = rig();
  r.begin(7, 'https://tracker.example/path/secret?token=abc#frag', {resourceType: 'script', method: 'POST'});
  assert.equal(r.pipeline.hasActiveRequests(), true);
  let [one] = r.pipeline.trackedRequests();
  assert.deepEqual({host: one.host, resourceType: one.resourceType, method: one.method, webContentsId: one.webContentsId, webContentsExists: one.webContentsExists, phase: one.phase, ageMs: one.ageMs}, {host: 'tracker.example', resourceType: 'script', method: 'POST', webContentsId: 5, webContentsExists: true, phase: 'before', ageMs: 0});
  assert.ok(!/secret|token|abc|frag|\/path/.test(JSON.stringify(r.pipeline.trackedRequests())), 'no path, query or fragment anywhere in the record');
  r.clock.t += 40;
  r.handlers.onBeforeSendHeaders({id: 7, url: 'https://tracker.example/path'}, () => {});
  [one] = r.pipeline.trackedRequests();
  assert.deepEqual([one.phase, one.phaseAgeMs, one.ageMs], ['sendHeaders', 0, 40]);
  r.clock.t += 60;
  r.handlers.onHeadersReceived({id: 7, url: 'https://tracker.example/path'}, () => {});
  r.clock.t += 100;
  [one] = r.pipeline.trackedRequests();
  assert.deepEqual([one.phase, one.phaseAgeMs, one.ageMs], ['headers', 100, 200]);
  r.begin(7, 'https://tracker.example/next?leg=2');   // a redirect's next leg keeps one record
  assert.equal(r.pipeline.trackedRequests().length, 1);
  r.handlers.onCompleted({id: 7, url: 'https://tracker.example/path'});
  assert.equal(r.pipeline.hasActiveRequests(), false);
  assert.deepEqual(r.pipeline.trackedRequests(), []);
  r.begin(8, 'wss://socket.example/live');
  r.handlers.onErrorOccurred({id: 8, url: 'wss://socket.example/live', error: 'net::ERR_ABORTED'});
  assert.deepEqual([r.pipeline.hasActiveRequests(), r.pipeline.trackedRequests().length], [false, 0]);
  r.begin(9, 'data:text/plain,hi');
  assert.deepEqual(r.pipeline.trackedRequests(), [], 'only http(s) and ws(s) are counted, as before');
});

test('an open request is open: one of a page that is gone, of a page that lives, or of no page stays counted however long it takes, and the record says which it is', () => {
  const r = rig();
  r.begin(1, 'https://closed-page.example/beacon', {webContentsId: 5});
  r.begin(2, 'https://live-page.example/stream', {webContentsId: 6});
  r.begin(3, 'https://lists.example/phishing.txt', {webContentsId: undefined, resourceType: 'other'});
  r.begin(4, 'https://lists.example/malware.txt', {webContentsId: 0, resourceType: 'other'});
  r.owners.set(5, false);   // that page closed
  r.clock.t += 24 * 3_600_000;
  assert.equal(r.pipeline.hasActiveRequests(), true);
  assert.equal(r.pipeline.trackedRequests().length, 4, 'nothing is dropped from the count, a day on');
  const byHost = host => r.pipeline.trackedRequests().filter(item => item.host === host);
  assert.deepEqual([byHost('closed-page.example')[0].webContentsId, byHost('closed-page.example')[0].webContentsExists], [5, false], 'named as the request of a page that is gone');
  assert.deepEqual([byHost('live-page.example')[0].webContentsId, byHost('live-page.example')[0].webContentsExists], [6, true]);
  assert.deepEqual(byHost('lists.example').map(item => [item.webContentsId, item.webContentsExists]), [['none', null], ['none', null]], 'a download no page started (net.request, session.fetch)');
  for (const id of [1, 2, 3, 4]) r.handlers.onCompleted({id});
  assert.equal(r.pipeline.hasActiveRequests(), false);
  assert.equal(r.pipeline.droppedRequests, undefined, 'there is no sweep that forgets a request');
});

test('the records are shared by every pipeline of a session, like the count, and tracking off (an id that is not a safe integer) clears both', () => {
  const r = rig();
  r.begin(1, 'https://a.example/');
  const second = new RequestPipeline(r.session, {now: () => r.clock.t});
  assert.equal(second.trackedRequests().length, 1);
  assert.equal(second.hasActiveRequests(), true);
  r.handlers.onBeforeRequest({id: 'not-an-integer', url: 'https://a.example/', webContentsId: 5}, () => {});
  assert.equal(r.pipeline.hasActiveRequests(), null, 'unknown never means idle');
  assert.deepEqual(r.pipeline.trackedRequests(), []);
});

// ---- the exit cleanup and its record

const ROOT = path.resolve(__dirname, '..');
function cleanupRig() {
  const world = rig();
  const folder = path.join(ROOT, '.qa-profiles', 'services-unit');
  fs.mkdirSync(folder, {recursive: true});
  const database = new BrowserDatabase(path.join(fs.mkdtempSync(path.join(folder, 'tracked-')), 'browser.sqlite'));
  const profiles = [{id: 'A', partition: 'persist:A'}];
  const session = Object.assign(world.session, {
    cookies: Object.assign(new EventEmitter(), {get: async () => []}),
    serviceWorkers: Object.assign(new EventEmitter(), {getAllRunning: () => ({})}),
    closeAllConnections: async () => {},
    clearData: async () => {},
  });
  const service = createExitCleanup({database, getProfiles: () => profiles, getSession: () => session, getPipeline: () => world.pipeline, hasLivePages: () => false,
    cookieRestore: {flush: async () => {}, clear() {}, completeClear: async () => {}}, permissions: {list: () => [], reset() {}}, commitRecords: () => ({counts: {history: 0}}),
    dialog: {showMessageBox: async () => ({response: 1})}, getWindow() {}, getProtectedOrigins: () => ({complete: true, origins: []})});
  return {...world, service, database};
}

test('exit cleanup: a request that is open (a page that is gone, a page that lives, or no page) fails it, the failure names each (host, type, page, age, phase), and the shutdown record carries them', async () => {
  const r = cleanupRig();
  try {
    await r.service.set('A', {enabled: true, categories: ['cookies'], keepOrigins: []});
    r.begin(21, 'https://open.example/stream?token=zzz', {resourceType: 'xhr'});
    r.begin(22, 'https://lists.example/phishing.txt', {webContentsId: undefined, resourceType: 'other'});
    r.begin(23, 'https://ghost.example/beacon?id=1', {webContentsId: 9, resourceType: 'ping'});
    r.owners.set(9, false);
    r.clock.t += 5_000;
    const failed = await r.service.runPending({phase: 'exit'});
    assert.equal(failed.completed, false, 'a request of a page that is gone is still a request: the cleanup waits for it, as it did');
    const entry = failed.profiles[0];
    assert.match(entry.error, /requests are still active/);
    assert.deepEqual(entry.tracked.map(item => [item.host, item.resourceType, item.webContentsId, item.webContentsExists, item.phase, item.ageMs]),
      [['open.example', 'xhr', 5, true, 'before', 5000], ['lists.example', 'other', 'none', null, 'before', 5000], ['ghost.example', 'ping', 9, false, 'before', 5000]]);
    assert.ok(!/token|zzz|stream|phishing\.txt|beacon|id=1/.test(JSON.stringify(failed)), 'host only');
    // the record main writes (preview-build.json, event profile-cleanup-shutdown)
    const states = [];
    const shutdown = createProfileCleanupShutdown({getCleanup: () => ({needsExit: () => true, finish: async () => failed}), shutdown: () => {}, quit: () => {}, onState: state => states.push(state)});
    shutdown({preventDefault() {}});
    await new Promise(resolve => setTimeout(resolve, 20));
    const record = states.find(state => state.phase === 'pending');
    assert.deepEqual(record.profiles[0].tracked.map(item => item.host), ['open.example', 'lists.example', 'ghost.example']);
    assert.equal(record.profiles[0].tracked[0].webContentsExists, true);
    assert.equal(record.profiles[0].tracked[1].webContentsId, 'none');
    assert.equal(record.profiles[0].tracked[2].webContentsExists, false);
    assert.equal(record.profiles[0].tracked[0].ageMs, 5000);
  } finally { r.database.close(); }
});

test('the shutdown record keeps its old shape when no request is named, and bounds what it carries (8 requests, host only)', async () => {
  const states = [];
  const requests = Array.from({length: 12}, (_, i) => ({host: 'h' + i + '.example', resourceType: 'xhr', method: 'GET', webContentsId: 'none', webContentsExists: null, ageMs: i, phase: 'before', phaseAgeMs: i, url: 'https://leak.example/path?q=1'}));
  const make = result => createProfileCleanupShutdown({getCleanup: () => ({needsExit: () => true, finish: async () => result}), shutdown: () => {}, quit: () => {}, onState: state => states.push(state)});
  make({completed: false, profiles: [{profileId: 'A', completed: false, error: 'busy', tracked: requests}]})({preventDefault() {}});
  await new Promise(resolve => setTimeout(resolve, 20));
  const record = states.find(state => state.phase === 'pending');
  assert.equal(record.profiles[0].tracked.length, 8);
  assert.ok(!JSON.stringify(record).includes('leak.example'), 'a url that slipped into an entry is not copied: only the named fields are');
  states.length = 0;
  make({completed: false, profiles: [{profileId: 'A', completed: false, error: 'busy'}]})({preventDefault() {}});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(Object.keys(states.find(state => state.phase === 'pending').profiles[0]).sort(), ['completed', 'error', 'profileId', 'results']);
});

test('wiring: content-blocking builds the pipeline with its defaults, and the release check\'s poll prints the tracked requests when it gives up', () => {
  const rigSource = fs.readFileSync(path.join(ROOT, 'qa', 'profile-cleanup-integrated.mjs'), 'utf8');
  assert.match(rigSource, /tracked:pipelines\.flatMap\(p=>typeof p\.trackedRequests==='function'\?p\.trackedRequests\(\):\[\]\)\};/);
  const blocking = fs.readFileSync(path.join(ROOT, 'desktop', 'content-blocking.cjs'), 'utf8');
  assert.match(blocking, /const pipeline=new RequestPipeline\(session\);/);
});
