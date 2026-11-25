'use strict';
// 14.3 (smaller main, start-up): main runs a short LADDER of memory-reducing full collections after the background lists' heavy jobs, in the quiet that follows them.
//
// Why: the jobs run on worker threads (the engine build in filter-updates.cjs, the threat-list parses in threat-lists.cjs). A worker's heap reaches 120-170 MB (the engine build), and when the worker
// is gone V8 keeps about 160 MB of its pages committed in main (Electron 45 / V8 14: main 87 -> 248 MB at the build, in the packaged app 330 MB at the peak); they are handed back only by a later
// memory-reducing collection in main. V8's own memory reducer does run two of them (about 30-40 s after start), but they free only part of it when a threat-list worker ran before the engine build
// (178 of 248 MB stayed in a window-less Electron 45.2.1 test; in the packaged 14.2 line main stayed at 238-250 MB for minutes in 1 launch in 5). The memory is V8's, so a V8 collection is the right
// tool, but one collection is not enough and its moment matters (measured on that test, after the last worker ended: one collection at +2 s freed 40-46 of ~190 MB, at +4 s, +6 s, +10 s, +15 s and
// +20 s all of it, at +8 s all but 50 MB; two at +2 s and +4 s all of it). earlier work's first version ran ONE collection 5 s after the jobs and 2 of 4 launches still kept 145 and 233 MB.
//
// How: each heavy job calls request() when it ends (after its workers). The ladder runs at +4 s, +10 s and +20 s after the last request (STEPS_MS: each step 4, then 6, then 10 s after the one before;
// a new request starts it again), each collection once no website is loading (background-work.cjs settled) and nobody has touched the keyboard or the pointer for IDLE_S (powerMonitor's system idle
// time), so it never lands inside a load, a slide or a scroll; on a timer task of its own. While someone keeps working a step waits and looks again every RECHECK_MS, for at most GIVE_UP_MS. A
// collection that frees nothing (the usual case once the first has run) costs main 2-6 ms. The interface and the pages are other processes: they keep drawing. The collector is V8's own gc
// function, taken from a fresh context once V8's expose-gc flag is on (Electron 45.2.1 accepts it after start, measured); the app's own contexts never see it. It runs V8's memory-reducing full
// collection (flavor 'last-resort': the freed pages go back to the system); a plain full collection frees the objects but keeps the heap committed. Keep this file ASCII only.

/** The wait before each collection of the ladder: after the last request, then after the one before. */
const STEPS_MS = Object.freeze([4000, 6000, 10000]), QUIET_MS = STEPS_MS[0], IDLE_S = 3, RECHECK_MS = 2000, GIVE_UP_MS = 30 * 60 * 1000;
/** V8's full collection in reduce-memory mode (CollectAllAvailableGarbage): what it frees goes back to the system. */
const REDUCE = Object.freeze({ type: 'major', flavor: 'last-resort' });

let v8gc;   // undefined: not asked yet; null: not available here
/** V8's full collection, or null where it cannot be had. */
function v8Collector() {
  if (v8gc !== undefined) return v8gc;
  try {
    require('node:v8').setFlagsFromString('--expose-gc');
    const fn = require('node:vm').runInNewContext('gc');
    v8gc = typeof fn === 'function' ? fn : null;
  } catch { v8gc = null; }
  return v8gc;
}

/** Seconds since the last keyboard or pointer input anywhere (Electron's powerMonitor); Infinity outside Electron. */
function systemIdleSeconds() {
  try {
    const { powerMonitor } = require('electron');
    const value = powerMonitor && typeof powerMonitor.getSystemIdleTime === 'function' ? powerMonitor.getSystemIdleTime() : Infinity;
    return Number.isFinite(value) ? value : Infinity;
  } catch { return Infinity; }
}

function backgroundSettled() {
  try { const work = require('./background-work.cjs').shared(); return typeof work.settled === 'function' ? work.settled() : Promise.resolve(); } catch { return Promise.resolve(); }
}

function createHeapCollect({ collector = v8Collector, settle = backgroundSettled, idleSeconds = systemIdleSeconds, stepsMs = STEPS_MS, idleS = IDLE_S, recheckMs = RECHECK_MS,
  giveUpMs = GIVE_UP_MS, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = timer => clearTimeout(timer) } = {}) {
  let timer = null, since = null, running = false, count = 0, last = null, step = 0;   // since: when the current wait began (null: none); step: the next collection of the ladder
  const arm = ms => {
    if (timer) clearTimer(timer);
    timer = setTimer(fire, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  };
  const busy = () => idleSeconds() < idleS;
  async function fire() {
    timer = null;
    if (running) return;
    if (busy()) { if (since !== null && now() - since < giveUpMs) arm(recheckMs); else since = null; return; }
    running = true;
    try {
      await settle();
      if (timer) return;                     // another job ended meanwhile: its own quiet time decides
      if (busy()) { arm(recheckMs); return; } // someone came back while a page was loading
      const collect = collector();
      if (!collect) { since = null; return; }
      const start = now(); try { collect(REDUCE); } catch { collect(); } count++; last = { at: start, ms: now() - start }; since = null;
      if (++step < stepsMs.length) { since = now(); arm(stepsMs[step]); }
    } catch { since = null; /* a collection that cannot run never matters to the lists */ } finally { running = false; }
  }
  return {
    /** A heavy job ended (its workers are gone): the ladder starts, or starts again, from this moment. */
    request() { step = 0; if (since === null) since = now(); arm(stepsMs[0]); },
    /** How many collections ran, the last one's start and length (ms), and whether one is waiting. */
    status: () => ({ count, last, pending: !!timer }),
    stop() { if (timer) clearTimer(timer); timer = null; since = null; step = 0; },
  };
}

let shared = null;
/** The app's one collector (the list modules ask it by default). */
const sharedHeapCollect = () => shared || (shared = createHeapCollect());

module.exports = { createHeapCollect, sharedHeapCollect, v8Collector, STEPS_MS, QUIET_MS, IDLE_S, RECHECK_MS, GIVE_UP_MS, REDUCE };
