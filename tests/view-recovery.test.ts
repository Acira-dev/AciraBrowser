import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RELOADS, MAX_RETRIES, RELOAD_WINDOW_MS, RETRY_WINDOW_MS, planRecovery, readReloads, type RecoveryLog } from '../src/ui/viewRecovery';

// The interface's error boundary (src/main.tsx): what it does each time a view cannot draw itself. Before 13.3 every failure was a reload (a blank view for
// ~200 ms: the white flash and the lag the third-profile tester saw), and the third failure within a minute left the error screen up for good.
const empty = (): RecoveryLog => ({ retries: [], reloads: [] });
const run = (times: number[], log = empty()) => times.map(now => { const plan = planRecovery(log, now); log = plan.log; return plan.step; });

test('a first failure is tried again in place, with no reload', () => {
  assert.deepEqual(run([1000]), ['retry']);
});

test('two failures in a row are retried in place, the third reloads, and the reloads stop after two a minute', () => {
  assert.deepEqual(run([0, 100, 200]), ['retry', 'retry', 'reload']);
  // a reload loses the in-memory retry count, not the reload count: the caller keeps the reloads in session storage
  let log: RecoveryLog = { retries: [], reloads: [200] };
  assert.deepEqual(run([5000, 5100, 5200], log), ['retry', 'retry', 'reload']);
  log = { retries: [], reloads: [200, 5200] };
  assert.deepEqual(run([9000, 9100, 9200], log), ['retry', 'retry', 'stay'], 'the third reload within a minute is refused: the error screen stays');
});

test('the error screen stays only while the reload budget is spent', () => {
  const spent: RecoveryLog = { retries: [], reloads: [1000, 2000] };
  assert.deepEqual(run([3000, 3100, 3200, 3300], spent), ['retry', 'retry', 'stay', 'stay']);
  // a minute after the first reload there is room again
  assert.deepEqual(run([1000 + RELOAD_WINDOW_MS + 1, 1000 + RELOAD_WINDOW_MS + 2, 1000 + RELOAD_WINDOW_MS + 3], spent), ['retry', 'retry', 'reload']);
});

test('failures far apart are each retried in place (a profile switch that crashes once every few seconds never reloads)', () => {
  const times = Array.from({ length: 12 }, (_, i) => i * (RETRY_WINDOW_MS / MAX_RETRIES + 100));
  const steps = run(times);
  assert.ok(steps.every(step => step === 'retry'), steps.join(','));
});

test('the log is returned, never changed in place', () => {
  const log = empty();
  planRecovery(log, 10);
  assert.deepEqual(log, empty());
  assert.equal(MAX_RELOADS, 2);
});

test('reload times come back from storage, and anything unreadable counts as none', () => {
  assert.deepEqual(readReloads('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(readReloads(null), []);
  assert.deepEqual(readReloads('not json'), []);
  assert.deepEqual(readReloads('{"a":1}'), []);
  assert.deepEqual(readReloads('[1,"x",null,4]'), [1, 4]);
});
