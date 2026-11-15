'use strict';
// 13.10 (Discord, "still kinda slow, responsive"): a rest at the edge that is going to reveal says so PRIME_LEAD ms before the wait runs out (`prime`), so the interface takes the page's picture
// while the dwell runs. A pointer going through the zone never primes; neither does an unfocused window nobody's pointer is on; the poller tells the interface on change only.
const test = require('node:test'), assert = require('node:assert/strict');
const { createEdgeController, watchChromeEdges, EDGE, DWELL, DWELL_PUSH, ENGAGED_DWELL, ENGAGED_PUSH, PRIME_LEAD, PRIME_SPEED } = require('../desktop/edge-reveal.cjs');

const win = { x: 100, y: 50, width: 1200, height: 800 };
const base = { focused: true, suspended: false, view: 'seamless', vertical: true, docked: false, edges: { top: true, side: true }, holds: { top: false, side: false }, size: { topHeight: 72, sideWidth: 240 }, bounds: win };
const at = (x, y) => ({ x: win.x + x, y: win.y + y });

/** A controller on a fake clock; `go(path, ms)` samples every 16 ms and returns what the last sample said. */
function rig(extra = {}) {
  const clock = { t: 10000 }, c = createEdgeController({ now: () => clock.t });
  const log = [];
  const go = (path, ms, more = {}) => {
    let last;
    for (let e = 0; e < ms; e += 16) { clock.t += 16; last = c.sample({ ...base, ...extra, ...more, point: typeof path === 'function' ? path(e) : path }); log.push({ t: clock.t, side: last.side, prime: last.prime.side, top: last.top, primeTop: last.prime.top }); }
    return last;
  };
  return { c, go, clock, log };
}

test('resting in the side zone primes from the first sample, and stops priming when the sidebar shows', () => {
  const r = rig();
  r.go(at(600, 400), 64);
  const arrival = r.go(at(6, 400), 16);
  assert.equal(arrival.prime.side, false, 'the arrival sample itself is a fast move: not yet a rest');
  const first = r.go(at(6, 400), 16);
  assert.equal(first.prime.side, true, 'the next one is: the wait (90 ms) is inside PRIME_LEAD (140 ms), primed at once');
  const mid = r.go(at(6, 400), 16);
  assert.equal(mid.prime.side, true);
  const shown = r.go(at(6, 400), 64);
  assert.equal(shown.side, true);
  assert.equal(shown.prime.side, false, 'shown: nothing left to prepare');
});

test('a pointer going through the zone fast never primes (it does not rest, it is a pass)', () => {
  const r = rig();
  r.go(at(600, 400), 64);
  // 3 px/ms toward the edge and on, out of the zone in two samples
  let primed = false;
  for (let x = 40; x > -40; x -= 48) { const s = r.go(at(x, 400), 16); primed ||= s.prime.side; }
  assert.equal(primed, false);
  assert.ok(PRIME_SPEED > 0 && PRIME_SPEED < 1.5);
});

test('sliding along the edge (a scroll, a pass to somewhere else) does not prime', () => {
  const r = rig();
  r.go(at(600, 400), 64);
  let primed = false;
  for (let y = 100; y < 700; y += 24) { const s = r.go(at(5, y), 16); primed ||= s.prime.side; }   // 1.5 px/ms along the edge
  assert.equal(primed, false);
});

test('pressed against the very edge it primes even at speed (nothing a page draws is there: that is the person asking)', () => {
  const r = rig();
  r.go(at(600, 400), 64);
  const s = r.go(at(0, 400), 16, {});
  assert.equal(s.prime.side, true);
});

test('over a control (engaged) the long wait primes only PRIME_LEAD ms before it ends', () => {
  const r = rig();
  r.go(at(600, 400), 64);
  r.go(at(8, 400), 16, { engaged: true });
  const early = r.go(at(8, 400), 400, { engaged: true });
  assert.equal(early.prime.side, false, 'long before the wait ends: nothing taken yet, the control may be about to be used');
  assert.equal(early.side, false);
  const late = r.go(at(8, 400), ENGAGED_DWELL.side - PRIME_LEAD - 400 + 16, { engaged: true });
  assert.equal(late.prime.side, true);
  assert.equal(late.side, false);
  const done = r.go(at(8, 400), PRIME_LEAD + 32, { engaged: true });
  assert.equal(done.side, true);
  assert.equal(done.prime.side, false);
});

test('the top zone primes the same way, and the sides are independent', () => {
  const r = rig();
  r.go(at(600, 400), 64);
  r.go(at(400, 3), 16);
  const s = r.go(at(400, 3), 16);
  assert.equal(s.prime.top, true);
  assert.equal(s.prime.side, false);
});

test('leaving the zone ends the prime; a window that is unfocused, suspended or has the edge off never primes', () => {
  const r = rig();
  r.go(at(6, 400), 32);
  assert.equal(r.go(at(600, 400), 16).prime.side, false);
  assert.equal(rig().go(at(6, 400), 64, { focused: false }).prime.side, false);
  assert.equal(rig().go(at(6, 400), 64, { suspended: true }).prime.side, false);
  assert.equal(rig().go(at(6, 400), 64, { edges: { top: true, side: false } }).prime.side, false);
});

test('after a hide the lockout holds the prime back too (a jittery pointer cannot make a capture loop)', () => {
  const r = rig();
  r.go(at(6, 400), 200);
  r.go(at(600, 400), 1200);
  assert.equal(r.go(at(6, 400), 16).prime.side, false, 'locked out for 250 ms after the hide');
});

test('PRIME_LEAD is longer than the two ordinary waits and shorter than the engaged ones', () => {
  assert.ok(PRIME_LEAD >= DWELL.side && PRIME_LEAD >= DWELL_PUSH.side);
  assert.ok(PRIME_LEAD < ENGAGED_PUSH.side + 1000 && PRIME_LEAD < ENGAGED_DWELL.side);
  assert.ok(EDGE.side > 0);
});

// ---- the poller tells the interface -------------------------------------------------------------------------------------------------
test('the poller emits chrome-edge-prime when a rest starts to prime and when it stops, and once per change', () => {
  const emitted = [];
  let timeout = null;
  const clock = { t: 5000 };
  const screen = { point: at(600, 400), getCursorScreenPoint() { return this.point; } };
  const w = { isDestroyed: () => false, isFocused: () => true, isMinimized: () => false, getContentBounds: () => ({ ...win }), on() {} };
  const item = { window: w, state: { settings: { verticalTabs: true } }, emit: event => emitted.push(event), size: () => ({ topHeight: 72, sideWidth: 240 }), holds: () => ({ top: false, side: false }), edges: () => ({ top: true, side: true }), docked: () => false, suspended: () => false };
  const app = { whenReady: () => Promise.resolve(), on() {} };
  watchChromeEdges({ app, windows: () => [item], screen, view: () => 'seamless', now: () => clock.t, schedule: fn => { timeout = fn; return { unref() {} }; }, cancel() {} });
  const run = ms => { for (let i = 0; i < ms / 16; i++) { clock.t += 16; const fn = timeout; timeout = null; fn(); } };
  return Promise.resolve().then(() => {
    timeout(); run(64);
    assert.deepEqual(emitted.filter(e => e.type === 'chrome-edge-prime'), [], 'nothing while the pointer is in the page');
    screen.point = at(6, 400); run(48);
    const primes = () => emitted.filter(e => e.type === 'chrome-edge-prime');
    assert.deepEqual(primes(), [{ type: 'chrome-edge-prime', prime: { top: false, side: true } }]);
    run(160);
    assert.equal(emitted.filter(e => e.type === 'chrome-edge').at(-1)?.side, true, 'the reveal came');
    assert.deepEqual(primes().at(-1), { type: 'chrome-edge-prime', prime: { top: false, side: false } }, 'and the prime is over');
    assert.equal(primes().length, 2, 'two events, not one per sample');
    screen.point = at(600, 400); run(1500);
    emitted.length = 0;
    // a rest that ends before the wait does: primed, then released
    screen.point = at(6, 400); run(32);
    assert.equal(emitted.filter(e => e.type === 'chrome-edge-prime').at(-1)?.prime.side, true);
    screen.point = at(600, 400); run(32);
    assert.equal(emitted.filter(e => e.type === 'chrome-edge-prime').at(-1)?.prime.side, false);
    assert.equal(emitted.filter(e => e.type === 'chrome-edge').length, 0, 'and nothing was revealed');
  });
});
