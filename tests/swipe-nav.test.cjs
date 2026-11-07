'use strict';
// The two-finger swipe between pages (desktop/swipe-nav.cjs): the threshold and the held list, the overscroll rule (a swipe the page can still
// use is the page's), the macOS setting, and the arrow's views. No trackpad is needed: the tracker takes the phases the native monitor reads
// from NSEvent, the controller takes fake views, and the page's scroll snapshot is plain data.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const swipe = require('../desktop/swipe-nav.cjs');
const {createSwipeTracker, createSwipeNav, pageCanScroll, swipeEnabled, decodeSample, phaseName, swipePlacement, historyRows, rowAddress, COMMIT, ENGAGE, HOLD_MS, ROW_STEP, FACTS_MS, COAST_MS} = swipe;

// A clock the tests turn by hand, so a hold of 450 ms takes none.
function clock() {
  let time = 1000, next = 1; const timers = new Map();
  return {
    now: () => time,
    after: (fn, ms) => { const id = next++; timers.set(id, {fn, at: time + ms}); return id; },
    clear: id => timers.delete(id),
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      time = end;
    },
    get pending() { return timers.size; },
  };
}

// A trackpad: its samples as the native monitor reports them (decoded), for one swipe.
const BEGAN = 1, CHANGED = 4, ENDED = 8, CANCELLED = 16;
const sample = (phase, dx = 0, dy = 0, extra = {}) => ({phase, momentum: 'none', dx, dy, x: 300, y: 300, natural: true, ...extra});
const coast = (momentum, dx = 0, dy = 0) => ({phase: 'none', momentum, dx, dy, x: 300, y: 300, natural: true});

/** A tracker with the defaults a page at its edge gives: the setting on, somewhere to go, a page that lets the swipe through, three earlier pages. */
function rig(overrides = {}) {
  const time = clock(), effects = [];
  const o = {verdict: 'go', canGo: true, rows: 3, enabled: true, begin: true, ...overrides};
  const tracker = createSwipeTracker({
    now: time.now, after: time.after, clear: time.clear, emit: e => effects.push(e),
    enabled: () => (typeof o.enabled === 'function' ? o.enabled() : o.enabled),
    begin: () => o.begin,
    canGo: direction => (typeof o.canGo === 'function' ? o.canGo(direction) : o.canGo),
    verdict: direction => (typeof o.verdict === 'function' ? o.verdict(direction) : o.verdict),
    rows: () => o.rows,
  });
  const types = () => effects.map(e => e.type);
  const last = type => [...effects].reverse().find(e => e.type === type);
  return {time, effects, tracker, types, last, o, feed: s => tracker.feed(s)};
}
// Fingers down, moving right by `total` points in steps of 20 (Back), or left (Forward, a negative total).
function swipeBy(r, total, {dy = 0} = {}) {
  r.feed(sample('began'));
  const steps = Math.ceil(Math.abs(total) / 20), each = total / steps;
  for (let i = 0; i < steps; i++) r.feed(sample('changed', each, dy ? dy / steps : 0));
}

test('the phases and the sample come across as the native monitor sends them', () => {
  assert.deepEqual([1, 2, 4, 8, 16, 32, 0].map(phaseName), ['began', 'stationary', 'changed', 'ended', 'cancelled', 'mayBegin', 'none']);
  assert.deepEqual(decodeSample(4, 0, 12.5, -3, 400, 250, 1), {phase: 'changed', momentum: 'none', dx: 12.5, dy: -3, x: 400, y: 250, natural: true});
  assert.equal(decodeSample(0, 4, 1, 1, 0, 0, 0).natural, false);
  assert.equal(decodeSample(0, 4, 1, 1, 0, 0, 0).momentum, 'changed');
});

// ---------------------------------------------------------------------------------------------------------------- the threshold
test('a swipe to the right shows the arrow, fills it with distance and goes Back when let go past the threshold', () => {
  const r = rig();
  swipeBy(r, COMMIT / 2);
  assert.deepEqual(r.types().slice(0, 2), ['start', 'progress']);
  assert.equal(r.last('start').direction, 'back');
  assert.ok(Math.abs(r.last('progress').progress - .5) < 1e-9, 'half the distance, half full');
  assert.equal(r.types().includes('armed'), false, 'not past the threshold yet');
  swipeBy(r, COMMIT);   // a second swipe restarts: began again
  assert.equal(r.last('progress').progress, 1);
  assert.deepEqual(r.last('armed'), {type: 'armed', on: true});
  r.feed(sample('ended'));
  assert.deepEqual(r.effects.at(-1), {type: 'commit', direction: 'back', steps: 1});
});

test('the arrow does not move until the fingers have moved ENGAGE points, and only a clearly sideways swipe counts', () => {
  const r = rig();
  r.feed(sample('began')); r.feed(sample('changed', ENGAGE - 1, 0));
  assert.deepEqual(r.effects, []);
  r.feed(sample('changed', 2, 0));
  assert.equal(r.types()[0], 'start');
  const diagonal = rig();
  diagonal.feed(sample('began')); diagonal.feed(sample('changed', 12, 11));
  assert.deepEqual(diagonal.effects, [], '12 across and 11 down is not sideways');
});

test('a swipe to the left is Forward, and it is the same distance', () => {
  const r = rig();
  swipeBy(r, -COMMIT);
  assert.equal(r.last('start').direction, 'forward');
  assert.equal(r.last('progress').progress, 1);
  r.feed(sample('ended'));
  assert.deepEqual(r.effects.at(-1), {type: 'commit', direction: 'forward', steps: 1});
});

test('let go short of the threshold, and with no coast, nothing happens: the arrow goes back out', () => {
  const r = rig();
  swipeBy(r, 60);
  r.feed(sample('ended'));
  assert.equal(r.types().includes('commit'), false);
  r.time.advance(COAST_MS + 1);
  assert.equal(r.types().at(-1), 'cancel');
  assert.equal(r.tracker.state, 'off');
});

test('a flick that lifts short is carried over the threshold by its coast, and one that dies away is not', () => {
  const flick = rig();
  swipeBy(flick, 60);
  flick.feed(sample('ended'));
  flick.feed(coast('began', 25)); flick.feed(coast('changed', 20));
  assert.deepEqual(flick.effects.at(-1), {type: 'commit', direction: 'back', steps: 1});
  flick.feed(coast('changed', 30)); flick.feed(coast('ended'));
  assert.equal(flick.effects.filter(e => e.type === 'commit').length, 1, 'the rest of the coast does nothing');

  const fades = rig();
  swipeBy(fades, 60);
  fades.feed(sample('ended'));
  fades.feed(coast('began', 6)); fades.feed(coast('changed', 4)); fades.feed(coast('ended'));
  assert.equal(fades.types().includes('commit'), false);
  assert.equal(fades.types().at(-1), 'cancel');
});

test('the OS cancelling the gesture, or the fingers turning back, lets the swipe go', () => {
  const cancelled = rig();
  swipeBy(cancelled, 60);
  cancelled.feed(sample('cancelled'));
  assert.equal(cancelled.types().at(-1), 'cancel');
  const turned = rig();
  swipeBy(turned, 60);
  turned.feed(sample('changed', -90, 0));
  assert.equal(turned.types().at(-1), 'cancel', 'pulled back past where it started');
});

test('more up-and-down than sideways is not a swipe, before and after it starts', () => {
  const vertical = rig();
  vertical.feed(sample('began')); vertical.feed(sample('changed', 3, 30));
  assert.deepEqual(vertical.effects, []);
  vertical.feed(sample('changed', 200, 0));
  assert.deepEqual(vertical.effects, [], 'once it is the page\'s scroll it stays so until the fingers lift');
  const drifts = rig();
  swipeBy(drifts, 40);
  drifts.feed(sample('changed', 0, 90));
  assert.equal(drifts.types().at(-1), 'cancel');
});

test('a gesture that began before the window was watched, or after a commit, never starts one', () => {
  const r = rig();
  r.feed(sample('changed', 80, 0)); r.feed(sample('changed', 80, 0));
  assert.deepEqual(r.effects, [], 'no began: a stray changed is left alone');
  swipeBy(r, COMMIT); r.feed(sample('ended'));
  const count = r.effects.length;
  r.feed(coast('began', 40)); r.feed(coast('changed', 40)); r.feed(coast('ended'));
  assert.equal(r.effects.length, count, 'the coast of a spent swipe is ignored');
});

// ------------------------------------------------------------------------------------------------------------------- nowhere to go
test('with nowhere to go in that direction nothing is shown', () => {
  const r = rig({canGo: direction => direction === 'forward'});
  swipeBy(r, 150);                       // Back: no earlier page
  assert.deepEqual(r.effects, []);
  const f = rig({canGo: direction => direction === 'back'});
  swipeBy(f, -150);                      // Forward: no later page
  assert.deepEqual(f.effects, []);
});

// ------------------------------------------------------------------------------------------------------------------- the setting
test('Swipe between pages is the macOS setting: off is nothing, and only a Mac asks', () => {
  assert.equal(swipeEnabled('darwin', {isSwipeTrackingFromScrollEventsEnabled: () => true}), true);
  assert.equal(swipeEnabled('darwin', {isSwipeTrackingFromScrollEventsEnabled: () => false}), false);
  assert.equal(swipeEnabled('darwin', {isSwipeTrackingFromScrollEventsEnabled: () => 1}), false, 'only a real true');
  assert.equal(swipeEnabled('darwin', {isSwipeTrackingFromScrollEventsEnabled: () => { throw new Error('no'); }}), false);
  assert.equal(swipeEnabled('darwin', {}), false);
  assert.equal(swipeEnabled('darwin', undefined), false);
  for (const platform of ['win32', 'linux']) assert.equal(swipeEnabled(platform, {isSwipeTrackingFromScrollEventsEnabled: () => true}), false);
});

test('with the setting off the gesture is not even watched, and it is read afresh for each gesture', () => {
  let on = false;
  const r = rig({enabled: () => on});
  swipeBy(r, 150);
  assert.deepEqual(r.effects, []);
  on = true;                              // the person turns it on in System Settings: the next swipe works
  swipeBy(r, COMMIT); r.feed(sample('ended'));
  assert.equal(r.effects.at(-1).type, 'commit');
  on = false;
  const before = r.effects.length;
  swipeBy(r, COMMIT); r.feed(sample('ended'));
  assert.equal(r.effects.length, before, 'and off again');
});

test('a scroll that is not over a page begins nothing', () => {
  const r = rig({begin: false});
  swipeBy(r, 150);
  assert.deepEqual(r.effects, []);
});

// ------------------------------------------------------------------------------------------------------------ the overscroll rule
const root = (o = {}) => ({scrolls: true, left: 0, max: 0, rtl: false, behavior: 'auto', ...o});
const box = (o = {}) => ({scrolls: true, left: 0, max: 600, rtl: false, behavior: 'auto', ...o});

test('a page with nothing to scroll sideways lets the swipe through, both ways', () => {
  const facts = {prevented: false, chain: [root()]};
  assert.equal(pageCanScroll(facts, 'back'), false);
  assert.equal(pageCanScroll(facts, 'forward'), false);
  assert.equal(pageCanScroll({prevented: false, chain: []}, 'back'), false);
});

test('a page wider than the window keeps the swipe until it is at the edge in that direction', () => {
  const wide = left => ({prevented: false, chain: [root({max: 800, left})]});
  assert.equal(pageCanScroll(wide(0), 'back'), false, 'at the left edge: Back is the browser\'s');
  assert.equal(pageCanScroll(wide(0), 'forward'), true, 'but it can still scroll right');
  assert.equal(pageCanScroll(wide(300), 'back'), true, 'in the middle: both are the page\'s');
  assert.equal(pageCanScroll(wide(300), 'forward'), true);
  assert.equal(pageCanScroll(wide(800), 'forward'), false, 'at the right edge: Forward is the browser\'s');
  assert.equal(pageCanScroll(wide(799.5), 'forward'), false, 'a pixel of rounding is the edge');
  assert.equal(pageCanScroll(wide(800), 'back'), true);
});

test('a carousel, a map or a code block under the pointer keeps the swipe, a nested one at its edge passes it outward', () => {
  const carousel = left => ({prevented: false, chain: [box({left}), root()]});
  assert.equal(pageCanScroll(carousel(0), 'forward'), true, 'a carousel with more to the right');
  assert.equal(pageCanScroll(carousel(200), 'back'), true);
  assert.equal(pageCanScroll(carousel(0), 'back'), false, 'at its start, on a page that cannot scroll: the swipe goes on to the browser');
  assert.equal(pageCanScroll(carousel(600), 'forward'), false);
  // At the carousel's edge the wheel chains on to the page, and the page can still scroll that way.
  assert.equal(pageCanScroll({prevented: false, chain: [box({left: 0}), root({max: 900, left: 400})]}, 'back'), true);
  // Two carousels inside each other: the inner one at its edge, the outer one not.
  assert.equal(pageCanScroll({prevented: false, chain: [box({left: 0}), box({left: 120}), root()]}, 'back'), true);
});

test('an element with nothing to scroll, or that does not scroll sideways, is not in the way', () => {
  assert.equal(pageCanScroll({prevented: false, chain: [box({max: 0}), root()]}, 'back'), false, 'an overflow:auto box that fits');
  assert.equal(pageCanScroll({prevented: false, chain: [box({max: 1}), root()]}, 'back'), false, 'one pixel of overflow is rounding');
  assert.equal(pageCanScroll({prevented: false, chain: [box({scrolls: false, left: 50}), root()]}, 'back'), false);
  assert.equal(pageCanScroll({prevented: false, chain: [root({scrolls: false, max: 500, left: 250})]}, 'back'), false, 'overflow-x hidden on the page');
});

test('a page that cancelled the wheel, or asked for no overscroll chaining, keeps the swipe', () => {
  assert.equal(pageCanScroll({prevented: true, chain: [root()]}, 'back'), true, 'a map or a slider took the wheel');
  assert.equal(pageCanScroll({prevented: false, chain: [root({behavior: 'none'})]}, 'back'), false, 'overscroll-behavior on a page that cannot scroll is nothing');
  assert.equal(pageCanScroll({prevented: false, chain: [root({max: 400, left: 0, behavior: 'none'})]}, 'back'), true, 'none on a scrollable page: no swipe navigation, as in Chrome');
  assert.equal(pageCanScroll({prevented: false, chain: [root({max: 400, left: 0, behavior: 'contain'})]}, 'back'), true);
  assert.equal(pageCanScroll({prevented: false, chain: [box({left: 0, behavior: 'contain'}), root()]}, 'back'), true, 'a box that contains its scroll');
  assert.equal(pageCanScroll(null, 'back'), true, 'nothing known: the page keeps it');
  assert.equal(pageCanScroll(undefined, 'forward'), true);
});

test('right-to-left pages count their scroll offsets from the right', () => {
  const rtl = left => ({prevented: false, chain: [root({max: 800, left, rtl: true})]});
  assert.equal(pageCanScroll(rtl(0), 'forward'), false, 'scrollLeft 0 is the right edge');
  assert.equal(pageCanScroll(rtl(0), 'back'), true, 'and there is page to the left');
  assert.equal(pageCanScroll(rtl(-800), 'back'), false, 'the far left');
  assert.equal(pageCanScroll(rtl(-400), 'back'), true);
});

test('the tracker lets the page keep a swipe it still needs, and waits for the page to be heard', () => {
  const blocked = rig({verdict: 'blocked'});
  swipeBy(blocked, 150);
  assert.deepEqual(blocked.effects, []);
  // The page's snapshot comes a moment after the first movement.
  let verdict = 'wait';
  const r = rig({verdict: () => verdict});
  r.feed(sample('began')); r.feed(sample('changed', 15, 0));
  assert.deepEqual(r.effects, [], 'waiting for the page');
  r.time.advance(FACTS_MS - 20);
  verdict = 'go'; r.tracker.factsChanged();
  assert.deepEqual(r.types().slice(0, 2), ['start', 'progress']);
  assert.equal(r.last('progress').progress, .15, 'the movement while it waited counts');
  // Never heard from (a frame that is not the page's, a page that never saw the wheel): left to the page.
  const mute = rig({verdict: 'wait'});
  mute.feed(sample('began')); mute.feed(sample('changed', 30, 0));
  mute.time.advance(FACTS_MS + 1);
  mute.feed(sample('changed', 120, 0));
  assert.deepEqual(mute.effects, []);
  // A page that takes the wheel after the arrow is up ends it.
  const late = rig({verdict: () => verdict});
  verdict = 'go';
  swipeBy(late, 50);
  verdict = 'blocked'; late.tracker.factsChanged();
  assert.equal(late.types().at(-1), 'cancel');
});

// ------------------------------------------------------------------------------------------------------------------ the held list
test('held past the threshold, with the fingers still, the list of earlier pages opens; letting go then takes the row', () => {
  const r = rig({rows: 4});
  swipeBy(r, COMMIT + 20);
  assert.equal(r.types().includes('list'), false, 'not before the hold');
  r.time.advance(HOLD_MS - 10);
  assert.equal(r.types().includes('list'), false);
  r.time.advance(20);
  assert.deepEqual(r.last('list'), {type: 'list', open: true, count: 4});
  r.feed(sample('changed', 0, ROW_STEP * 1.2));    // fingers down: the second row
  assert.deepEqual(r.last('select'), {type: 'select', index: 1});
  r.feed(sample('changed', 0, ROW_STEP * 1.2));
  assert.deepEqual(r.last('select'), {type: 'select', index: 2});
  r.feed(sample('changed', 0, -ROW_STEP * 1.2));   // and back up
  assert.deepEqual(r.last('select'), {type: 'select', index: 1});
  r.feed(sample('ended'));
  assert.deepEqual(r.effects.at(-1), {type: 'commit', direction: 'back', steps: 2});
});

test('letting go on the list\'s first row is one page back, and the selection stays on the rows there are', () => {
  const r = rig({rows: 3});
  swipeBy(r, COMMIT); r.time.advance(HOLD_MS + 1);
  r.feed(sample('ended'));
  assert.deepEqual(r.effects.at(-1), {type: 'commit', direction: 'back', steps: 1});
  const far = rig({rows: 3});
  swipeBy(far, COMMIT); far.time.advance(HOLD_MS + 1);
  for (let i = 0; i < 8; i++) far.feed(sample('changed', 0, ROW_STEP));
  far.feed(sample('changed', 0, -ROW_STEP * 20));
  assert.equal(far.tracker.snapshot.selected, 0, 'never above the first row');
  for (let i = 0; i < 12; i++) far.feed(sample('changed', 0, ROW_STEP));
  assert.equal(far.tracker.snapshot.selected, 2, 'never below the last');
});

test('with the fingers up and down the other way round (natural scrolling off), down is still down the list', () => {
  const r = rig({rows: 4});
  r.feed(sample('began', 0, 0, {natural: false}));
  for (let i = 0; i < 6; i++) r.feed(sample('changed', 20, 0, {natural: false}));
  r.time.advance(HOLD_MS + 1);
  r.feed(sample('changed', 0, -ROW_STEP * 1.2, {natural: false}));
  assert.equal(r.tracker.snapshot.selected, 1);
});

test('the list needs at least two earlier pages, a finger that is still moving does not hold, and the arrow going back down closes it', () => {
  const one = rig({rows: 1});
  swipeBy(one, COMMIT); one.time.advance(HOLD_MS * 3);
  assert.equal(one.types().includes('list'), false, 'one earlier page is just Back');
  const moving = rig({rows: 3});
  swipeBy(moving, COMMIT);
  for (let i = 0; i < 10; i++) { moving.time.advance(100); moving.feed(sample('changed', 6, 0)); }
  assert.equal(moving.types().includes('list'), false, 'a second of slow movement is not a hold');
  moving.time.advance(HOLD_MS + 1);
  assert.equal(moving.types().includes('list'), true);
  const rest = rig({rows: 3});
  swipeBy(rest, COMMIT);
  for (let i = 0; i < 6; i++) { rest.time.advance(100); rest.feed(sample('changed', .5, .5)); }   // a finger at rest still twitches
  assert.equal(rest.types().includes('list'), true, 'a resting finger\'s twitches do not restart the hold');
  rest.feed(sample('changed', -60, 0));                // the fingers go back toward where they began
  assert.deepEqual(rest.effects.slice(-2), [{type: 'list', open: false}, {type: 'armed', on: false}]);
  rest.feed(sample('ended'));
  assert.equal(rest.types().includes('commit'), false, 'closed, and letting go does nothing');
});

test('the list\'s view is only made as the hold nears, not for every swipe that crosses the threshold', () => {
  const r = rig({rows: 3});
  swipeBy(r, COMMIT);
  assert.equal(r.types().includes('warm'), false);
  r.time.advance(HOLD_MS - swipe.WARM_MS + 1);
  assert.equal(r.types().includes('warm'), true);
  assert.equal(r.types().includes('list'), false, 'warm is before the list');
  const quick = rig({rows: 3});
  swipeBy(quick, COMMIT); quick.time.advance(100); quick.feed(sample('ended'));
  assert.equal(quick.types().includes('warm'), false);
});

test('the list is capped at six rows', () => {
  const r = rig({rows: 40});
  swipeBy(r, COMMIT); r.time.advance(HOLD_MS + 1);
  assert.equal(r.last('list').count, 6);
});

// ---------------------------------------------------------------------------------------------------------------------- the pieces
test('history rows are the nearest earlier (or later) websites, nearest first, and stop where the history is not a website', () => {
  const entries = [
    {url: 'https://a.test/', title: 'A'}, {url: 'https://b.test/page', title: 'B'}, {url: 'https://www.c.test/x?y=1', title: 'C'},
    {url: 'https://d.test/', title: 'D'}, {url: 'https://e.test/', title: 'E'},
  ];
  const back = historyRows(entries, 3, 'back');
  assert.deepEqual(back.map(r => [r.index, r.steps, r.title]), [[2, 1, 'C'], [1, 2, 'B'], [0, 3, 'A']]);
  assert.equal(back[0].address, 'c.test/x?y=1');
  assert.deepEqual(historyRows(entries, 3, 'forward').map(r => r.title), ['E']);
  assert.deepEqual(historyRows(entries, 0, 'back'), []);
  assert.equal(historyRows(entries, 9, 'back'), null);
  assert.equal(historyRows(null, 0, 'back'), null);
  const mixed = [{url: 'https://a.test/'}, {url: 'chrome-error://chromewebdata/'}, {url: 'https://c.test/'}, {url: 'https://d.test/'}];
  assert.deepEqual(historyRows(mixed, 3, 'back').map(r => r.index), [2], 'it stops at an entry that is not a page');
  assert.equal(historyRows(Array.from({length: 30}, (_, i) => ({url: `https://s.test/${i}`})), 29, 'back').length, 6);
  assert.equal(rowAddress('https://www.example.com/'), 'example.com');
  assert.equal(rowAddress('https://example.com/docs/start'), 'example.com/docs/start');
});

test('the arrow is a fixed strip at the page\'s own edge, the list sits beside the arrow\'s resting place inside the page', () => {
  const page = {x: 240, y: 70, width: 1000, height: 700};
  const left = swipePlacement({page, side: 'left', rows: 3, scale: 1});
  assert.equal(left.chip.x, 240, 'the strip starts at the page\'s left edge, which is what clips the arrow sliding in');
  assert.equal(left.chip.width, swipe.STRIP);
  assert.equal(left.chip.y + left.chip.height / 2, 70 + 350, 'centred on the page');
  const right = swipePlacement({page, side: 'right', rows: 3, scale: 1});
  assert.equal(right.chip.x + right.chip.width, 240 + 1000, 'and at the right edge for Forward');
  const rowsHeight = 3 * swipe.ROW + 8;
  assert.equal(left.list.height, rowsHeight + 2 * swipe.SHADOW);
  assert.ok(left.list.x >= 240 && left.list.x + left.list.width <= 240 + 1000);
  assert.ok(right.list.x >= 240 && right.list.x + right.list.width <= 240 + 1000);
  assert.ok(right.list.x > left.list.x, 'mirrored');
  const scaled = swipePlacement({page, side: 'left', rows: 3, scale: 1.25});
  assert.equal(scaled.chip.width, Math.round(swipe.STRIP * 1.25), 'the interface scale scales the views');
  // A short window keeps the list on the page.
  const short = swipePlacement({page: {x: 0, y: 70, width: 900, height: 200}, side: 'left', rows: 6, scale: 1});
  assert.ok(short.list.y >= 70 - swipe.SHADOW + 8 - 1 && short.list.y + short.list.height <= 270 + swipe.SHADOW + 1 + 1 + 400, 'does not run off the top');
  // A narrow window shrinks the list rather than leaving the page.
  const narrow = swipePlacement({page: {x: 0, y: 0, width: 360, height: 500}, side: 'left', rows: 2, scale: 1});
  assert.ok(narrow.list.x + narrow.list.width <= 360 + 1);
});

// --------------------------------------------------------------------------------------------------------------- the arrow's views
class FakeContents extends EventEmitter {
  constructor() { super(); this.ipc = new EventEmitter(); this.sent = []; this.destroyed = false; this.loaded = null; }
  loadFile(file, options) { this.loaded = {file, query: options && options.query}; setImmediate(() => this.ipc.emit('acira:swipe-nav', {}, 'ready')); return Promise.resolve(); }
  send(channel, message) { this.sent.push(JSON.parse(JSON.stringify(message))); }
  setZoomFactor() {} setWindowOpenHandler() {} isDestroyed() { return this.destroyed; } close() { this.destroyed = true; }
}
class FakeView { constructor(options) { this.options = options; this.webContents = new FakeContents(); this.bounds = null; this.visible = false; } setBounds(b) { this.bounds = b; } setVisible(v) { this.visible = v; } setBackgroundColor() {} }
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

function arrow(overrides = {}) {
  const time = clock(), views = [], children = [], navigated = [];
  const win = {isDestroyed: () => false, contentView: {addChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); children.push(v); }, removeChildView(v) { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1); }}};
  const tabs = {a: {contentKind: 'web'}, b: {contentKind: 'web'}};
  const h = {time, views, children, navigated, motion: 'premium', enabled: true, blocked: false, scale: 1, canGo: true, ...overrides};
  const bounds = {a: {x: 240, y: 70, width: 1000, height: 700}};
  h.nav = createSwipeNav({
    WebContentsView: function (options) { const v = new FakeView(options); views.push(v); return v; },
    getWindow: () => win, now: time.now, after: time.after, clear: time.clear,
    enabled: () => h.enabled, blocked: () => h.blocked,
    pageAt: (x, y) => { const b = bounds.a; return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height ? {tabId: 'a', bounds: b, contents: {}} : null; },
    pageOf: id => (id === 'a' ? {tabId: 'a', bounds: bounds.a, contents: {}} : null), cursor: overrides.cursor,
    canGo: () => h.canGo,
    history: (id, direction) => ({rows: historyRows([{url: 'https://a.test/', title: 'A'}, {url: 'https://b.test/', title: 'B'}, {url: 'https://c.test/', title: 'C'}, {url: 'https://d.test/', title: 'D'}], direction === 'back' ? 3 : 0, direction)}),
    navigate: (id, direction, row) => navigated.push({id, direction, row: row && row.index}),
    icons: () => ({'c.test': 'data:image/png;base64,AAAA'}),
    isDark: () => true, motion: () => h.motion, uiScale: () => h.scale,
  });
  h.feed = (phase, dx = 0, dy = 0, x = 400, y = 300) => h.nav.sample({phase, momentum: 'none', dx, dy, x, y, natural: true});
  h.facts = (payload = {}) => h.nav.facts('a', {toward: -1, prevented: false, chain: [{scrolls: true, left: 0, max: 0, rtl: false, behavior: 'auto'}], ...payload});
  h.messages = role => (views[role === 'list' ? 1 : 0]?.webContents.sent || []);
  return h;
}

test('an arrow is shown only when the page is at its edge and the setting is on, as two small views made like the tab card\'s', async () => {
  const h = arrow();
  h.feed('began'); h.facts();                       // the page's snapshot is heard first, as it is a frame behind
  for (let i = 0; i < 4; i++) h.feed('changed', 20);
  await flush();
  assert.equal(h.views.length, 1, 'one view for the arrow, none for the list yet');
  const chip = h.views[0];
  assert.deepEqual(chip.webContents.loaded.query, {role: 'chip'});
  assert.equal(chip.options.webPreferences.sandbox, true);
  assert.equal(chip.options.webPreferences.nodeIntegration, false);
  assert.equal(chip.options.webPreferences.contextIsolation, true);
  assert.equal(chip.visible, true);
  assert.deepEqual(chip.bounds, {x: 240, y: 420 - (swipe.CHIP + 2 * swipe.SHADOW) / 2, width: swipe.STRIP, height: swipe.CHIP + 2 * swipe.SHADOW}, 'at the left edge of the page, centred on it');
  assert.equal(h.children.at(-1), chip, 'above the page');
  const types = h.messages('chip').map(m => m.type);
  assert.equal(types[0], 'show');
  assert.equal(h.messages('chip')[0].side, 'left');
  assert.equal(h.messages('chip')[0].dark, true);
  assert.equal(h.messages('chip').filter(m => m.type === 'progress').at(-1).progress, .8);
});

test('letting go past the threshold navigates once and takes the arrow away; short of it, the arrow goes back out and nothing navigates', async () => {
  const h = arrow();
  h.feed('began'); h.facts();
  for (let i = 0; i < 6; i++) h.feed('changed', 20);
  await flush();
  h.feed('ended');
  assert.deepEqual(h.navigated, [{id: 'a', direction: 'back', row: null}]);
  assert.equal(h.messages('chip').at(-1).type, 'leave');
  assert.equal(h.messages('chip').at(-1).leave, 'commit');
  assert.equal(h.views[0].visible, true, 'it leaves with a short motion first');
  h.time.advance(300);
  assert.equal(h.views[0].visible, false);

  const g = arrow();
  g.feed('began'); g.facts();
  for (let i = 0; i < 3; i++) g.feed('changed', 20);
  await flush();
  g.feed('ended'); g.time.advance(COAST_MS + 1);
  assert.deepEqual(g.navigated, []);
  assert.equal(g.messages('chip').at(-1).leave, 'cancel');
});

test('Forward goes from the right edge, with the arrow on that side', async () => {
  const h = arrow();
  h.feed('began'); h.facts({toward: 1});
  for (let i = 0; i < 6; i++) h.feed('changed', -20);
  await flush();
  assert.equal(h.views[0].bounds.x + h.views[0].bounds.width, 1240);
  assert.equal(h.messages('chip')[0].side, 'right');
  h.feed('ended');
  assert.deepEqual(h.navigated, [{id: 'a', direction: 'forward', row: null}]);
});

test('with reduced motion the page is told, so the arrow does not slide; the exit is instant too', async () => {
  const h = arrow({motion: 'off'});
  h.feed('began'); h.facts();
  for (let i = 0; i < 6; i++) h.feed('changed', 20);
  await flush();
  assert.equal(h.messages('chip')[0].motion, 'off');
  h.feed('ended');
  assert.equal(h.views[0].visible, false, 'no exit motion to wait for');
  assert.equal(h.navigated.length, 1);
});

test('the setting off, no page under the pointer, a menu open, or a page that can still scroll: no view is ever made', async () => {
  const off = arrow({enabled: false});
  off.feed('began'); off.facts(); for (let i = 0; i < 6; i++) off.feed('changed', 20);
  await flush();
  assert.equal(off.views.length, 0);
  const away = arrow();
  away.feed('began', 0, 0, 100, 300); away.facts(); for (let i = 0; i < 6; i++) away.feed('changed', 20, 0, 100, 300);   // over the sidebar
  assert.equal(away.views.length, 0);
  const menu = arrow({blocked: true});
  menu.feed('began'); menu.facts(); for (let i = 0; i < 6; i++) menu.feed('changed', 20);
  assert.equal(menu.views.length, 0);
  const owned = arrow();
  owned.feed('began'); owned.facts({chain: [{scrolls: true, left: 100, max: 900, rtl: false, behavior: 'auto'}]});
  for (let i = 0; i < 6; i++) owned.feed('changed', 20);
  assert.equal(owned.views.length, 0, 'the page scrolls sideways: the swipe is its');
  const prevented = arrow();
  prevented.feed('began'); prevented.facts({prevented: true}); for (let i = 0; i < 6; i++) prevented.feed('changed', 20);
  assert.equal(prevented.views.length, 0);
  const nowhere = arrow({canGo: false});
  nowhere.feed('began'); nowhere.facts(); for (let i = 0; i < 6; i++) nowhere.feed('changed', 20);
  assert.equal(nowhere.views.length, 0);
});

test('a point the monitor reads wrongly falls back to where the pointer is', async () => {
  const h = arrow({cursor: () => ({x: 600, y: 300})});
  h.feed('began', 0, 0, -5000, -5000); h.facts();      // a point far outside every page
  for (let i = 0; i < 6; i++) h.feed('changed', 20, 0, -5000, -5000);
  await flush();
  assert.equal(h.views.length, 1, 'the arrow is shown for the page under the pointer');
  const none = arrow({cursor: () => ({x: 5, y: 5})});  // and the pointer is over the sidebar: not a page
  none.feed('began', 0, 0, -5000, -5000); none.facts(); for (let i = 0; i < 6; i++) none.feed('changed', 20, 0, -5000, -5000);
  assert.equal(none.views.length, 0);
});

test('a snapshot for the other direction, or an old one, is not the answer', () => {
  const h = arrow();
  h.feed('began'); h.facts({toward: 1});            // the page says it saw a swipe to the right
  for (let i = 0; i < 6; i++) h.feed('changed', 20);   // but this one is to the left (Back)
  assert.equal(h.views.length, 0, 'it waits for the snapshot of its own direction');
  const old = arrow();
  old.facts();
  old.time.advance(swipe.FACTS_FRESH_MS + 50);
  old.feed('began'); for (let i = 0; i < 6; i++) old.feed('changed', 20);
  assert.equal(old.views.length, 0);
  // A badly formed snapshot is ignored.
  const bad = arrow();
  bad.nav.facts('a', {toward: 0, chain: []}); bad.nav.facts('a', {toward: -1, chain: 'x'}); bad.nav.facts('a', null); bad.nav.facts('a', {toward: -1, chain: new Array(40).fill({})});
  bad.feed('began'); for (let i = 0; i < 6; i++) bad.feed('changed', 20);
  assert.equal(bad.views.length, 0);
});

test('switching tabs or a menu opening while the arrow is up ends the swipe without navigating', async () => {
  const h = arrow();
  h.feed('began'); h.facts(); for (let i = 0; i < 6; i++) h.feed('changed', 20);
  await flush();
  h.nav.onState({activeTabId: 'a'}, {activeTabId: 'b', tabs: [{id: 'a'}, {id: 'b'}]});
  assert.equal(h.messages('chip').at(-1).leave, 'cancel');
  h.feed('ended');
  assert.deepEqual(h.navigated, []);
  const m = arrow();
  m.feed('began'); m.facts(); for (let i = 0; i < 6; i++) m.feed('changed', 20);
  await flush();
  m.blocked = true; m.nav.relayout();
  assert.equal(m.messages('chip').at(-1).leave, 'cancel');
  m.blocked = false;
  const gone = arrow();
  gone.feed('began'); gone.facts(); for (let i = 0; i < 6; i++) gone.feed('changed', 20);
  await flush();
  gone.nav.onState({activeTabId: 'a'}, {activeTabId: 'a', tabs: [{id: 'z'}]});
  assert.equal(gone.messages('chip').at(-1).leave, 'cancel', 'the tab was closed under it');
});

test('held, the list opens beside the arrow with the earlier pages; letting go on a row goes to that row', async () => {
  const h = arrow();
  h.feed('began'); h.facts(); for (let i = 0; i < 7; i++) h.feed('changed', 20);
  await flush();
  h.time.advance(HOLD_MS + 5);
  await flush();
  assert.equal(h.views.length, 2, 'the list is its own view');
  const list = h.views[1];
  assert.deepEqual(list.webContents.loaded.query, {role: 'list'});
  const opened = h.messages('list').find(m => m.type === 'list');
  assert.ok(opened, 'the list was sent');
  assert.deepEqual(opened.rows.map(r => r.title), ['C', 'B', 'A']);
  assert.equal(opened.rows[0].icon, 'data:image/png;base64,AAAA', 'the saved icon of the site travels as an image');
  assert.equal(opened.rows[1].icon, '');
  assert.equal(opened.selected, 0);
  assert.equal(list.visible, true);
  assert.ok(list.bounds.x + swipe.SHADOW >= h.views[0].bounds.x + swipe.REST + swipe.CHIP, 'the list card starts beside the arrow\'s resting place, not over it');
  h.feed('changed', 0, ROW_STEP * 1.1);
  assert.deepEqual(h.messages('list').at(-1), {type: 'select', index: 1});
  h.feed('ended');
  assert.deepEqual(h.navigated, [{id: 'a', direction: 'back', row: 1}], 'goes to the second row: two pages back');
  assert.equal(h.messages('list').at(-1).type, 'leave');
});

test('the idle views are dropped and the interface scale rebuilds them', async () => {
  const h = arrow();
  h.feed('began'); h.facts(); for (let i = 0; i < 6; i++) h.feed('changed', 20);
  await flush(); h.feed('ended');
  h.time.advance(swipe.FACTS_MS + 100);
  assert.equal(h.views.length, 1, 'a swipe that is simply let go makes only the arrow, never the list');
  h.time.advance(70000);
  assert.equal(h.views[0].webContents.destroyed, true, 'a browser that is not swiped pays nothing after a minute');
  assert.equal(h.children.length, 0);
});

// ---------------------------------------------------------------------------------------------------------- Windows and Linux
test('Windows and Linux are untouched: the controller, the native monitor and the page snapshot are all Mac only', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.match(main, /const swipeNav=process\.platform==='darwin'\?\(\(\)=>\{/, 'main makes the controller on a Mac only');
  assert.match(main, /if\(swipeNav\)watchScroll\(/);
  assert.match(main, /if\(swipeNav\)pageBridge\.on\('acira:swipe-facts'/);
  const preload = fs.readFileSync(path.join(__dirname, '../desktop/page-input-preload.cjs'), 'utf8');
  assert.match(preload, /if\(process\.platform==='darwin'&&process\.isMainFrame\)\{\n let lastSent/, 'the page snapshot listener is added on a Mac only');
  const material = fs.readFileSync(path.join(__dirname, '../desktop/mac-material.cjs'), 'utf8');
  assert.match(material, /if\(process\.platform==='darwin'\)\{\n try\{bridge=require/, 'the native module is a Mac thing');
  assert.equal(swipeEnabled('win32', {isSwipeTrackingFromScrollEventsEnabled: () => true}), false);
  assert.equal(swipeEnabled('linux', {isSwipeTrackingFromScrollEventsEnabled: () => true}), false);
});

test('the native monitor only reads: it returns every event it is given', () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/native/mac-material.mm'), 'utf8');
  const start = source.indexOf('addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel'), end = source.indexOf('static void SwipeRemoveMonitorIfIdle');
  const monitor = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.equal((monitor.match(/return nil/g) || []).length, 0, 'a monitor that returned nil would swallow the scroll');
  assert.ok((monitor.match(/return event;/g) || []).length >= 2);
  assert.match(monitor, /hasPreciseScrollingDeltas/, 'only a trackpad or a Magic Mouse, never a wheel mouse');
});
