'use strict';
// Live pull requests (item 31): when the folder asks, when it waits and when it stops. All in fake time.
const test = require('node:test'), assert = require('node:assert/strict');
const { createRefresher, POLICY } = require('../desktop/live-prs/refresh.cjs');
const { scriptedSource } = require('../desktop/live-prs/mock.cjs');
const { fakeClock } = require('./helpers/fake-clock.cjs');

const MIN = 60000;
const good = { ok: true, rows: [{ url: 'https://github.com/a/b/pull/1', title: 'One' }], more: false };
function make(answers, { visible = true } = {}) {
  const clock = fakeClock(), source = scriptedSource(answers), changes = [];
  const state = { visible };
  const refresher = createRefresher({ source, wanted: () => ({ relations: ['author', 'review'], recent: false }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, visible: () => state.visible, onChange: () => changes.push(refresher.snapshot().phase + (refresher.snapshot().loading ? '*' : '')) });
  return { clock, source, refresher, state, changes };
}

test('the policy numbers: five minutes, two minutes away, five seconds after a pull request page, backing off 5, 10, 20, 60', () => {
  assert.equal(POLICY.interval, 5 * MIN); assert.equal(POLICY.away, 2 * MIN); assert.equal(POLICY.pageDebounce, 5000);
  assert.deepEqual(POLICY.ladder, [5, 10, 20, 60].map((n) => n * MIN));
});

test('start loads at once (a window is showing), asks for what the filters want, and the next refresh is five minutes after', async () => {
  const { clock, source, refresher, changes } = make([good]);
  refresher.start(); await clock.flush();
  assert.equal(source.calls.length, 1); assert.deepEqual(source.calls[0].relations, ['author', 'review']); assert.equal(source.calls[0].recent, false);
  assert.equal(refresher.snapshot().phase, 'ok'); assert.deepEqual(changes, ['idle*', 'ok']);
  assert.deepEqual(clock.pending(), [5 * MIN]);
  await clock.advance(5 * MIN - 1); assert.equal(source.calls.length, 1);
  await clock.advance(1); assert.equal(source.calls.length, 2);
});

test('with no window showing nothing is asked, however long it takes; the first window to show asks once', async () => {
  const { clock, source, refresher, state } = make([good], { visible: false });
  refresher.start(); await clock.advance(60 * MIN);
  assert.equal(source.calls.length, 0, 'no request while hidden');
  state.visible = true; refresher.noteVisible(); await clock.flush();
  assert.equal(source.calls.length, 1);
});

test('a timer that falls due while hidden waits; coming back after more than two minutes asks, coming back sooner does not', async () => {
  const { clock, source, refresher, state } = make([good]);
  refresher.start(); await clock.flush();
  state.visible = false; await clock.advance(5 * MIN); assert.equal(source.calls.length, 1, 'due, but hidden');
  state.visible = true; refresher.noteVisible(); await clock.flush(); assert.equal(source.calls.length, 2);
  await clock.advance(MIN); refresher.noteVisible(); await clock.flush(); assert.equal(source.calls.length, 2, 'one minute away: no request');
  await clock.advance(2 * MIN); refresher.noteVisible(); await clock.flush(); assert.equal(source.calls.length, 3, 'three minutes: it asks');
});

test('opening a pull request page asks five seconds after it loads, but not twice in half a minute, and several loads count once', async () => {
  const { clock, source, refresher } = make([good]);
  refresher.start(); await clock.flush();
  await clock.advance(10000); refresher.notePageLoaded(); refresher.notePageLoaded(); await clock.advance(4999); assert.equal(source.calls.length, 1);
  await clock.advance(1); assert.equal(source.calls.length, 1, 'a run 15 seconds ago is too recent');
  await clock.advance(20000); refresher.notePageLoaded(); await clock.advance(5000); assert.equal(source.calls.length, 2);
  refresher.notePageLoaded(); refresher.notePageLoaded(); refresher.notePageLoaded(); await clock.advance(5000); assert.equal(source.calls.length, 2, 'the last run is under thirty seconds old');
});

test('a failing source backs off 5, 10, 20, then 60 minutes and keeps the 60; one success starts it over', async () => {
  const { clock, source, refresher } = make([{ ok: false, reason: 'unreadable' }, { ok: false, reason: 'error' }, { ok: false, reason: 'error' }, { ok: false, reason: 'error' }, { ok: false, reason: 'error' }, good, { ok: false, reason: 'error' }]);
  refresher.start(); await clock.flush();
  const waits = [];
  for (let i = 0; i < 5; i++) { waits.push(clock.pending()[0]); await clock.advance(clock.pending()[0]); }
  assert.deepEqual(waits, [5, 10, 20, 60, 60].map((n) => n * MIN));
  assert.equal(refresher.snapshot().phase, 'ok', 'the sixth answer was good'); assert.equal(refresher.snapshot().failures, 0);
  await clock.advance(5 * MIN); assert.equal(refresher.snapshot().phase, 'error'); assert.deepEqual(clock.pending(), [5 * MIN], 'the ladder began again');
});

test('whatever a source hands over is normalised before the folder holds it: bad rows are dropped', async () => {
  const { clock, refresher } = make([{ ok: true, rows: [{ url: 'https://evil.example/a/b/pull/1', title: 'x' }, null, { url: 'https://github.com/a/b/pull/2', title: '<b>Two</b>' }] }]);
  refresher.start(); await clock.flush();
  assert.deepEqual(refresher.snapshot().rows.map((row) => [row.id, row.title]), [['a/b#2', 'Two']]);
});

test('the old rows stay while it backs off, with the reason', async () => {
  const { clock, refresher } = make([good, { ok: false, reason: 'rate-limited', retryAfterMs: 1 * MIN }]);
  refresher.start(); await clock.flush(); await clock.advance(5 * MIN);
  const held = refresher.snapshot();
  assert.equal(held.phase, 'error'); assert.equal(held.error, 'rate-limited'); assert.equal(held.rows.length, 1); assert.equal(held.rows[0].id, 'a/b#1');
});

test('Retry-After longer than the ladder wins; shorter does not shorten it', async () => {
  const long = make([{ ok: false, reason: 'rate-limited', retryAfterMs: 45 * MIN }]);
  long.refresher.start(); await long.clock.flush(); assert.deepEqual(long.clock.pending(), [45 * MIN]);
  const short = make([{ ok: false, reason: 'rate-limited', retryAfterMs: 30000 }]);
  short.refresher.start(); await short.clock.flush(); assert.deepEqual(short.clock.pending(), [5 * MIN]);
});

test('no network backs off on its own, shorter ladder (1, 2, 5, 10 minutes)', async () => {
  const { clock, refresher } = make([{ ok: false, reason: 'offline' }]);
  refresher.start(); await clock.flush();
  const waits = [];
  for (let i = 0; i < 5; i++) { waits.push(clock.pending()[0]); await clock.advance(clock.pending()[0]); }
  assert.deepEqual(waits, [1, 2, 5, 10, 10].map((n) => n * MIN));
});

test('coming back, a page load and Refresh now leave a backing-off folder alone; Refresh now says why when GitHub asked for the wait', async () => {
  const { clock, source, refresher } = make([{ ok: false, reason: 'rate-limited', retryAfterMs: 10 * MIN }, good]);
  refresher.start(); await clock.flush();
  refresher.noteVisible(); refresher.notePageLoaded(); await clock.advance(10000); assert.equal(source.calls.length, 1);
  assert.equal(refresher.refreshNow(), 'wait'); assert.equal(source.calls.length, 1);
  await clock.advance(10 * MIN); assert.equal(source.calls.length, 2); assert.equal(refresher.snapshot().phase, 'ok');
});

test('signed out stops everything: no timer, no request when a window comes back or a page loads; signing in, or Check again, asks again', async () => {
  const { clock, source, refresher } = make([{ ok: false, reason: 'signed-out' }, good]);
  refresher.start(); await clock.flush();
  assert.equal(refresher.snapshot().phase, 'signed-out'); assert.deepEqual(clock.pending(), []); assert.deepEqual(refresher.snapshot().rows, []);
  await clock.advance(60 * MIN); refresher.noteVisible(); refresher.notePageLoaded(); await clock.advance(10000);
  assert.equal(source.calls.length, 1, 'quiet while signed out');
  refresher.noteSignedIn(); await clock.flush(); assert.equal(source.calls.length, 2); assert.equal(refresher.snapshot().phase, 'ok');
  const again = make([{ ok: false, reason: 'signed-out' }, good]);
  again.refresher.start(); await again.clock.flush();
  assert.equal(again.refresher.refreshNow(), 'started'); await again.clock.flush(); assert.equal(again.refresher.snapshot().phase, 'ok');
});

test('Refresh now: starts when idle, answers "recent" instead of asking twice within ten seconds, and "running" while a request is out', async () => {
  const { clock, source, refresher } = make([good]);
  assert.equal(refresher.refreshNow(), 'stopped');
  refresher.start(); await clock.flush();
  assert.equal(refresher.refreshNow(), 'recent'); assert.equal(source.calls.length, 1);
  await clock.advance(10000); assert.equal(refresher.refreshNow(), 'started'); await clock.flush(); assert.equal(source.calls.length, 2);
  assert.equal(refresher.refreshNow({ force: true }), 'started', 'a filter that needs more rows skips the ten seconds'); assert.equal(refresher.refreshNow({ force: true }), 'running');
  await clock.flush(); assert.equal(source.calls.length, 4, 'the one asked for while a request was out runs after it');
});

test('a source that throws is an error answer, and stopping drops an answer that arrives late', async () => {
  const thrower = { fetch: async () => { throw new Error('boom'); } };
  const clock = fakeClock();
  const refresher = createRefresher({ source: thrower, wanted: () => ({ relations: [], recent: false }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  refresher.start(); await clock.flush(); assert.equal(refresher.snapshot().phase, 'error');
  let release; const slow = { fetch: () => new Promise((resolve) => { release = () => resolve(good); }) };
  const late = createRefresher({ source: slow, wanted: () => ({ relations: [], recent: false }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  late.start(); await clock.flush(); late.stop(); release(); await clock.flush();
  assert.equal(late.snapshot().phase, 'idle', 'the answer after stop is dropped');
});

test('stop leaves no timer behind', async () => {
  const { clock, refresher } = make([good]);
  refresher.start(); await clock.flush(); refresher.notePageLoaded(); refresher.stop();
  assert.deepEqual(clock.pending(), []);
});
