'use strict';
// How downloadStorePackage (extension-packages.cjs) treats a slow store download. A fixed 10 minute timer from the start of the request stopped any
// download that took longer, so HubSpot Sales (58 MB) could not be installed below about 0.8 Mbit/s. Now a download may take as long as it keeps moving:
// the first 10 minutes are free as in 13.6 (nothing 13.6 installed may fail on 13.7), after that every 60 seconds must bring at least 32 KB per second;
// the 30 second stall guard and the 128 MB bound stay.
// Electron's net.request is replaced by a stand-in the test drives chunk by chunk under mocked time (setTimeout only), so a 10 minute download takes milliseconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');

const ID = 'a'.repeat(32), MiB = 1024 * 1024;

/** Puts a stand-in for electron's net into the module cache; returns what the download did. */
function fakeNet() {
  const state = {requests: [], aborted: 0, response: null, request: null};
  const net = {
    request(options) {
      const request = new EventEmitter();
      request.followRedirect = () => {};
      request.abort = () => { state.aborted++; };
      request.end = () => setImmediate(() => { const response = new EventEmitter(); response.statusCode = 200; response.headers = {}; state.response = response; request.emit('response', response); });
      state.request = request; state.requests.push(options);
      return request;
    }
  };
  const key = require.resolve('electron');
  require.cache[key] = {id: key, filename: key, loaded: true, exports: {net, app: {}}};
  return state;
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const load = () => { const file = require.resolve('../desktop/browser-services/extension-packages.cjs'); delete require.cache[file]; return require(file); };

/** Starts a download and waits for the response; returns {done, state}. done settles to {error} or {value}. */
async function start() {
  const state = fakeNet(), {downloadStorePackage} = load();
  const done = downloadStorePackage(ID, require('node:path').join(require('node:os').tmpdir(), 'acira-never-written'), null).then(value => ({value}), error => ({error}));
  await settle();
  assert.ok(state.response, 'the response arrived');
  return {done, state};
}

test('a steady slow download is not cut off: 58 MiB at 0.74 Mbit/s (1 MiB every 11 s, 638 s in all) reaches the package check', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  let finished = false; done.then(() => { finished = true; });
  for (let i = 0; i < 58 && !finished; i++) {
    state.response.emit('data', Buffer.alloc(MiB, 1));
    t.mock.timers.tick(11000); await settle();
  }
  assert.equal(finished, false, 'still downloading after 638 s of steady data: ' + JSON.stringify((await Promise.race([done, null]))?.error?.message));
  state.response.emit('end'); await settle();
  const result = await done;
  assert.ok(result.error, 'garbage is not a CRX');
  assert.doesNotMatch(result.error.message, /timed out|too slow|stalled/, 'it failed at the package check, not on time: ' + result.error.message);
});

test('a download that sends nothing for 30 seconds is stopped (the stall guard stays)', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  state.response.emit('data', Buffer.alloc(1024, 1));
  t.mock.timers.tick(29999); await settle();
  state.response.emit('data', Buffer.alloc(1024, 1));
  t.mock.timers.tick(29999); await settle();
  t.mock.timers.tick(2); await settle();
  const result = await done;
  assert.match(result.error.message, /stalled: no data for 30 seconds/);
  assert.equal(state.aborted, 1);
});

test('a drip (a few bytes every 20 s, never a stall) is still stopped, and within an hour', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  let finished = false; done.then(() => { finished = true; });
  for (let seconds = 0; seconds < 3600 && !finished; seconds += 20) { state.response.emit('data', Buffer.alloc(16, 1)); t.mock.timers.tick(20000); await settle(); }
  assert.equal(finished, true, 'a drip of 0.8 byte per second must not hold the install for ever');
  assert.ok((await done).error);
});

test('more than 128 MiB is stopped', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  for (let i = 0; i < 129; i++) { state.response.emit('data', Buffer.alloc(MiB, 1)); if (state.aborted) break; }
  const result = await done;
  assert.match(result.error.message, /exceeds 128 MB/);
});

test('a non-200 answer fails at once', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const state = fakeNet(), {downloadStorePackage} = load();
  const done = downloadStorePackage(ID, require('node:path').join(require('node:os').tmpdir(), 'acira-never-written'), null).then(value => ({value}), error => ({error}));
  await settle();
  const response = new EventEmitter(); response.statusCode = 404; state.request.emit('response', response);
  assert.match((await done).error.message, /HTTP404/);
});

test('time before the first byte does not count against the pace: a slow start (45 s) and then 100 KB per second is fine', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const state = fakeNet(), {downloadStorePackage} = load();
  const done = downloadStorePackage(ID, require('node:path').join(require('node:os').tmpdir(), 'acira-never-written'), null).then(value => ({value}), error => ({error}));
  await settle();
  t.mock.timers.tick(29000); await settle();   // the response comes after 29 s (the stall guard allows 30)
  const response = new EventEmitter(); response.statusCode = 200; response.headers = {}; state.request.emit('response', response);
  for (let second = 0; second < 300; second++) { response.emit('data', Buffer.alloc(100 * 1024, 1)); t.mock.timers.tick(1000); await settle(); }
  response.emit('end'); await settle();
  const result = await done;
  assert.doesNotMatch(result.error.message, /timed out|too slow|stalled/, result.error.message);
});

// Nothing 13.6 installed may fail on 13.7: 13.6 let any download finish inside 10 minutes, however slow, so the pace is only asked of a download still
// running after those 10 minutes (the first pace check at 60 s failed these two on 991e8cde5).
test('a small package on a slow link installs, as on 13.6: 1.5 MiB at 20 KB per second (77 s) reaches the package check', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  let finished = false; done.then(() => { finished = true; });
  for (let second = 0; second < 77 && !finished; second++) { state.response.emit('data', Buffer.alloc(20 * 1024, 1)); t.mock.timers.tick(1000); await settle(); }
  assert.equal(finished, false, 'still downloading after 77 s at 20 KB/s: ' + JSON.stringify((await Promise.race([done, null]))?.error?.message));
  state.response.emit('end'); await settle();
  const result = await done;
  assert.ok(result.error, 'garbage is not a CRX');
  assert.doesNotMatch(result.error.message, /timed out|too slow|stalled/, 'it failed at the package check, not on time: ' + result.error.message);
});

test('whatever 13.6 finished inside its 10 minutes still finishes: 9 MiB at 16 KB per second (576 s)', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  let finished = false; done.then(() => { finished = true; });
  for (let second = 0; second < 576 && !finished; second++) { state.response.emit('data', Buffer.alloc(16 * 1024, 1)); t.mock.timers.tick(1000); await settle(); }
  assert.equal(finished, false, 'still downloading after 576 s: ' + JSON.stringify((await Promise.race([done, null]))?.error?.message));
  state.response.emit('end'); await settle();
  const result = await done;
  assert.doesNotMatch(result.error.message, /timed out|too slow|stalled/, result.error.message);
});

test('a download still below the floor after the free 10 minutes is stopped within the next minute (10 KB per second)', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {done, state} = await start();
  let finished = false, at = 0; done.then(() => { finished = true; });
  for (let second = 0; second < 900 && !finished; second++) { state.response.emit('data', Buffer.alloc(10 * 1024, 1)); t.mock.timers.tick(1000); await settle(); at = second + 1; }
  assert.equal(finished, true, 'a download under 32 KB/s past 10 minutes must stop');
  assert.ok(at > 600 && at <= 661, 'stopped after the free 10 minutes and within the minute after: ' + at + ' s');
  assert.match((await done).error.message, /too slow/);
  assert.equal(state.aborted, 1);
});
