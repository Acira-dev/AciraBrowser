'use strict';
// 13.8 exit-cleanup blocker hunt (the packaged Windows check "clear data when Acira closes" failed 2 of 5 runs on a 13.8 candidate, passed every run on 13.7).
// Acira's OWN scheduled downloads (filter lists 20 s after start, threat lists at 6 s and 30 s, the site allow-list) go out on the first ordinary profile's session, so for that profile each
// is a tracked request of its pipeline: the count the exit cleanup waits on (exit-cleanup.cjs waitForQuiescence) and the release check reads before the quit. On a fresh profile they all run in
// the first minute, some in parallel, with limits of 30 s (filters, allow-list) and 10 minutes (threat lists, each with a second address), so a slow line leaves a request open on the profile
// long after its pages are gone. Nothing stopped them at the quit: the cleanup's closeAllConnections() cut the one in flight and the lists' "try the next address, then the next list" loop sent
// the following requests into the cleanup's barrier, one after another. desktop/browser-services/background-work.cjs is the one switch (Chromium's BrowserProcessImpl::StartTearDown rule, and
// dl-keys' for the extension updater): the quit events stop what is in flight and nothing starts after them. No Electron starts here.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ElectronBlocker} = require('@ghostery/adblocker-electron');
const fs = require('node:fs');
const path = require('node:path');
const work = require('../desktop/browser-services/background-work.cjs');
const {downloadListIfChanged, downloadList} = require('../desktop/browser-services/public-list-download.cjs');
const {createThreatLists, SOURCES: THREAT_SOURCES} = require('../desktop/browser-services/threat-lists.cjs');
const {createFilterUpdates, SOURCES: FILTER_SOURCES} = require('../desktop/browser-services/filter-updates.cjs');
const siteAllowlist = require('../desktop/browser-services/site-allowlist.cjs');
const {RequestPipeline} = require('../desktop/request-pipeline.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/** What the app's quit events look like to the switch: a clock, whether any window is open, and the listener the switch registers. */
function lifecycle({windows = true} = {}) {
  const state = {t: 1_000_000, windows, listener: null, unsubscribed: 0};
  return {
    state,
    now: () => state.t,
    windowsOpen: () => state.windows,
    onQuit(fn) { state.listener = fn; return () => { state.unsubscribed++; state.listener = null; }; },
    quit() { state.listener && state.listener(); },
  };
}

// ---- the switch

test('the switch allows work until a quit event, then stops: allowed() is false and the signal is aborted, once', () => {
  const life = lifecycle(), w = work.createBackgroundWork({lifecycle: life});
  assert.equal(w.allowed(), true);
  const signal = w.signal();
  let aborts = 0;
  signal.addEventListener('abort', () => aborts++);
  assert.equal(signal.aborted, false);
  life.quit();
  assert.equal(w.allowed(), false);
  assert.equal(signal.aborted, true);
  life.quit();   // before-quit, then will-quit: the second one is a no-op
  assert.equal(aborts, 1);
  assert.equal(w.signal().aborted, true, 'a request started now would start aborted');
});

test('a quit that was called off (windows still open a minute later) lets the work go on with a fresh signal; a real quit (no window left) stays stopped', () => {
  const life = lifecycle(), w = work.createBackgroundWork({lifecycle: life});
  const first = w.signal();
  life.quit();
  life.state.t += work.QUIT_RESUME_MS - 1;
  assert.equal(w.allowed(), false, 'not yet a minute');
  life.state.t += 1;
  assert.equal(w.allowed(), true, 'a minute on, windows open: the quit was called off');
  assert.equal(first.aborted, true);
  assert.equal(w.signal().aborted, false);
  const real = lifecycle({windows: false}), v = work.createBackgroundWork({lifecycle: real});
  real.quit();
  real.state.t += 10 * work.QUIT_RESUME_MS;
  assert.equal(v.allowed(), false, 'no window left: the app is ending');
});

test('without the app (a unit test, a release script) the switch is open and never stops by itself; dispose unsubscribes', () => {
  const w = work.createBackgroundWork({lifecycle: null});
  assert.equal(w.allowed(), true);
  w.interrupt();
  assert.equal(w.allowed(), false);
  const life = lifecycle(), v = work.createBackgroundWork({lifecycle: life});
  v.dispose();
  assert.equal(life.state.unsubscribed, 1);
  assert.equal(work.shared().allowed(), true, 'the app-wide switch under node: no Electron, no quit events');
});

// ---- the downloader (public-list-download.cjs)

/** An Electron ClientRequest on stand-ins: the test answers it. */
function fakeNet() {
  const requests = [];
  return {
    requests,
    request(options) {
      const req = new EventEmitter();
      Object.assign(req, {options, headers: {}, aborted: 0, ended: false, setHeader(name, value) { this.headers[name] = value; }, end() { this.ended = true; }, abort() { this.aborted++; }, followRedirect() {}});
      requests.push(req);
      return req;
    },
  };
}
const answer = (req, status, body = '', headers = {}) => {
  const response = new EventEmitter();
  response.statusCode = status;
  response.headers = headers;
  req.emit('response', response);
  if (body) response.emit('data', Buffer.from(body));
  response.emit('end');
};

test('downloader: a download in flight when the quit begins is aborted at once and rejects as "closing" (before: it stayed a tracked request until its own 30 s limit)', async () => {
  const w = work.createBackgroundWork({lifecycle: null}), net = fakeNet();
  const promise = downloadListIfChanged('https://lists.example/a.txt', {name: 'session'}, {work: w, net, timeoutMs: 60_000});
  assert.equal(net.requests.length, 1);
  w.interrupt();
  await assert.rejects(promise, error => error.closing === true && /closing/.test(error.message));
  assert.equal(net.requests[0].aborted, 1, 'the request itself is aborted, so the pipeline sees it end');
});

test('downloader: nothing starts once the quit has begun (no request is made at all)', async () => {
  const w = work.createBackgroundWork({lifecycle: null}), net = fakeNet();
  w.interrupt();
  await assert.rejects(downloadListIfChanged('https://lists.example/a.txt', {name: 'session'}, {work: w, net}), error => error.closing === true);
  assert.equal(net.requests.length, 0);
  await assert.rejects(downloadList('https://lists.example/a.txt', {name: 'session'}, {work: w, net}), error => error.closing === true);
  assert.equal(net.requests.length, 0);
});

test('downloader: an ordinary download is unchanged (200 and 304), and a finished request is not aborted by a later quit', async () => {
  const w = work.createBackgroundWork({lifecycle: null}), net = fakeNet();
  const ok = downloadListIfChanged('https://lists.example/a.txt', {name: 'session'}, {work: w, net, etag: '"x"'});
  assert.equal(net.requests[0].headers['If-None-Match'], '"x"');
  answer(net.requests[0], 200, 'hello', {etag: '"y"'});
  assert.deepEqual(await ok, {status: 200, text: 'hello', etag: '"y"', lastModified: undefined});
  const notModified = downloadListIfChanged('https://lists.example/b.txt', {name: 'session'}, {work: w, net, etag: '"x"'});
  answer(net.requests[1], 304);
  assert.equal((await notModified).status, 304);
  w.interrupt();
  assert.deepEqual(net.requests.map(req => req.aborted), [0, 0], 'finished requests are left alone');
});

// ---- the callers: no second address, no next list

test('threat lists: a stopped download ends the whole pass: no second address, no next list, nothing recorded as a failure (before: 5 more requests into the cleanup\'s barrier)', async () => {
  const files = new Map(), io = {files, readFileSync: p => { if (!files.has(p)) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'}); return files.get(p); }, writeFileSync: (p, d) => files.set(p, String(d)), renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }, mkdirSync() {}};
  const calls = [];
  const lists = createThreatLists({cachePath: '/c', io, download: async url => { calls.push(url); throw work.closing(); }});
  await lists.refresh({name: 'session'});
  assert.equal(calls.length, 1, 'the first address of the first list, and nothing after it');
  assert.equal(lists.status().lastError, null, 'a stop is not an error the person should see');
  const before = createThreatLists({cachePath: '/c', io, download: async url => { calls.push(url); throw new Error('offline'); }});
  calls.length = 0;
  await before.refresh({name: 'session'});
  assert.equal(calls.length, THREAT_SOURCES.reduce((n, source) => n + source.urls.length, 0), 'an ordinary failure still tries every address of every list');
  assert.match(before.status().lastError, /offline/);
});

test('filter lists: a stopped download is not tried on the mirror, and the scheduled check asks the switch before it starts', async () => {
  const text = source => `! Title: ${source.title}\n` + '! reviewed fixture padding\n'.repeat(55) + '||old.example^\n';
  const folder = path.join(root, '.qa-profiles', 'services-unit', 'quit-' + process.pid + '-' + Date.now());
  const baseline = path.join(folder, 'baseline');
  fs.mkdirSync(baseline, {recursive: true});
  for (const source of FILTER_SOURCES) fs.writeFileSync(path.join(baseline, source.id), text(source));
  const calls = [];
  const w = work.createBackgroundWork({lifecycle: null});
  const mirrored = FILTER_SOURCES.find(source => source.mirrors && source.mirrors.length);
  assert.ok(mirrored, 'a filter source with a mirror exists, or this check says nothing');
  const options = {filtersPath: baseline, cachePath: path.join(folder, 'cache'), work: w, engineFactory: t => ElectronBlocker.parse(t, {loadNetworkFilters: true, loadCosmeticFilters: true}), download: async url => { calls.push(url); throw work.closing(); }};
  const service = createFilterUpdates(options);
  await assert.rejects(service.refresh({isPersistent: () => true}), error => error.closing === true);
  assert.equal(calls.filter(url => url === mirrored.url).length, 1);
  assert.ok(!mirrored.mirrors.some(url => calls.includes(url)), 'its mirror is never asked');
  // the schedule: once the switch is stopped a due check does not start a request
  const timers = [];
  const quiet = createFilterUpdates({...options, download: async url => { calls.push('quiet:' + url); return text(FILTER_SOURCES[0]); }, setTimer: fn => { timers.push(fn); return {unref() {}}; }});
  w.interrupt();
  const asked = [];
  const stop = quiet.startAutomatic(() => { asked.push('session'); return {isPersistent: () => true}; }, {first: 1, every: 1000, retry: 500, random: () => 0.5});
  await timers.shift()();
  assert.equal(calls.some(url => String(url).startsWith('quiet:')), false, 'the quit has begun: no check');
  assert.equal(timers.length, 1, 'and the next look is scheduled (a quit that was called off goes on)');
  stop();
  fs.rmSync(folder, {recursive: true, force: true});
});

test('the allow-list: the fetch in flight carries the switch\'s signal and ends with the quit, nothing starts after it, and neither is recorded as a failure', async () => {
  const w = work.createBackgroundWork({lifecycle: null});
  work.setShared(w);
  try {
    const io = {readFileSync() { throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'}); }, writeFileSync() {}, renameSync() {}, mkdirSync() {}};
    const make = () => siteAllowlist.createSiteAllowlist({cachePath: '/c', endpoint: 'https://reports.example/allowlist.json', io});
    let signal = null, calls = 0;
    const session = {fetch: (url, init) => new Promise((_, reject) => { calls++; signal = init.signal; init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true}); })};
    const first = make();
    const pending = first.refresh(session);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(signal.aborted, false);
    w.interrupt();
    assert.equal(signal.aborted, true, 'the request in flight is aborted with the quit (before: only its own 30 s timeout)');
    assert.equal((await pending).lastError, null, 'the abort is the stop, not a failure');
    const second = make();
    assert.equal((await second.refresh(session)).lastError, null);
    assert.equal(calls, 1, 'no request is made after the quit began');
  } finally { work.setShared(null); }
});

// ---- the pipeline sees the download end when it is aborted

test('a download aborted at the quit leaves the profile\'s pipeline idle at once (a request that is still counted is what the exit cleanup waits on)', async () => {
  const handlers = {};
  const session = {isPersistent: () => true, webRequest: new Proxy({}, {get: (_, name) => (_filter, listener) => { handlers[name] = listener === undefined ? _filter : listener; }})};
  const pipeline = new RequestPipeline(session);
  const w = work.createBackgroundWork({lifecycle: null}), net = fakeNet();
  const url = 'https://lists.example/a.txt';
  const promise = downloadListIfChanged(url, session, {work: w, net, timeoutMs: 60_000});
  handlers.onBeforeRequest({id: 41, url}, () => {});   // what Electron says as the request leaves
  assert.equal(pipeline.hasActiveRequests(), true, 'in flight: counted, as it should be');
  w.interrupt();
  await assert.rejects(promise, error => error.closing === true);
  assert.equal(net.requests[0].aborted, 1);
  handlers.onErrorOccurred({id: 41, url, error: 'net::ERR_ABORTED'});   // the abort ends the request
  assert.equal(pipeline.hasActiveRequests(), false);
});

// ---- wiring

test('wiring: the schedule asks for the switch before anything is scheduled, every download path consults it, and the quit events are the ones the cleanup starts from', () => {
  const blocking = read('desktop/content-blocking.cjs');
  assert.match(blocking, /refreshScheduled=true;[^]{0,400}require\('\.\/browser-services\/background-work\.cjs'\)\.shared\(\);[^]{0,1500}setupGate\.after/);
  const downloader = read('desktop/browser-services/public-list-download.cjs');
  assert.match(downloader, /work\.allowed\(\)\)return Promise\.reject/);
  assert.match(downloader, /signal\.addEventListener\('abort',stop,\{once:true\}\)/);
  assert.match(read('desktop/browser-services/site-allowlist.cjs'), /AbortSignal\.any\(\[AbortSignal\.timeout\(30000\), work\.signal\(\)\]\)/);
  assert.match(read('desktop/browser-services/filter-updates.cjs'), /else if\(!work\.allowed\(\)\)delay=retry/);
  const source = read('desktop/browser-services/background-work.cjs');
  assert.match(source, /\[app, 'before-quit'\], \[app, 'will-quit'\]/, 'before-quit comes first: before any window closes and before will-quit starts the profile cleanup');
  assert.match(source, /before-quit-for-update/);
  assert.match(read('desktop/main.cjs'), /app\.on\('will-quit',createPrivateShutdown\(/, 'the cleanup starts at will-quit, after before-quit');
});
