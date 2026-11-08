'use strict';
// When the live folder asks its source for pull requests, and when it stops asking. One refresher per profile that has the folder.
//
// The policy (previews/beta12/live-prs/README.md, "Recommendation"):
//  - only while Acira is open AND a window of the profile is on screen (`visible()`); a timer that fires with no window showing waits
//    for the next time one does;
//  - on creation, on coming back after more than two minutes away, every five minutes while visible, on "Refresh now", and a few
//    seconds after a github.com pull request page of this profile finishes loading;
//  - a source that fails backs off 5, 10, 20, then 60 minutes (a network that is down: 1, 2, 5, 10), and never earlier than the
//    `retryAfterMs` GitHub asked for; every success starts the ladder over;
//  - signed out: it stops. It starts again when the person signs in (`noteSignedIn`), or asks ("Check again").
// Clock and timers are injected, so the tests run it in fake time.
const { mergeRows } = require('./model.cjs');

const MIN = 60 * 1000;
const POLICY = Object.freeze({
  interval: 5 * MIN,
  away: 2 * MIN,
  pageDebounce: 5 * 1000,
  pageGap: 30 * 1000,
  manualGap: 10 * 1000,
  ladder: [5 * MIN, 10 * MIN, 20 * MIN, 60 * MIN],
  offlineLadder: [1 * MIN, 2 * MIN, 5 * MIN, 10 * MIN],
});

/**
 * @param {{source:{fetch:(request:{relations:string[],recent:boolean,now:number})=>Promise<any>}, wanted:()=>{relations:string[],recent:boolean}, now?:()=>number, setTimer?:Function, clearTimer?:Function, visible?:()=>boolean, onChange?:()=>void, policy?:Partial<typeof POLICY>}} options
 */
function createRefresher({ source, wanted, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, visible = () => true, onChange = () => {}, policy = {} }) {
  const rule = { ...POLICY, ...policy };
  const state = { phase: 'idle', loading: false, rows: [], more: false, updatedAt: 0, lastRunAt: 0, error: null, failures: 0, nextAt: 0 };
  let started = false, inFlight = false, again = false, waiting = false, timer = null, pageTimer = null, generation = 0;

  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const schedule = (ms) => { cancel(); state.nextAt = now() + ms; timer = setTimer(onTimer, ms); timer?.unref?.(); };
  function onTimer() {
    timer = null;
    if (!started) return;
    if (!visible()) { waiting = true; return; }
    void run();
  }
  const backingOff = () => state.phase === 'error' && now() < state.nextAt;

  async function run() {
    if (!started) return;
    if (inFlight) { again = true; return; }
    inFlight = true; waiting = false; cancel();
    const mine = generation;
    state.loading = true;
    onChange();
    let answer;
    try { answer = await source.fetch({ ...wanted(), now: now() }); } catch { answer = { ok: false, reason: 'error' }; }
    inFlight = false; state.loading = false;
    if (mine !== generation || !started) return;
    state.lastRunAt = now();
    if (answer?.ok) {
      Object.assign(state, { phase: 'ok', rows: mergeRows([Array.isArray(answer.rows) ? answer.rows : []]), more: !!answer.more, updatedAt: now(), error: null, failures: 0 });
      schedule(rule.interval);
    } else if (answer?.reason === 'signed-out') {
      Object.assign(state, { phase: 'signed-out', rows: [], more: false, error: null, failures: 0, nextAt: 0 });
    } else {
      state.failures += 1;
      state.error = ['offline', 'rate-limited', 'unreadable'].includes(answer?.reason) ? answer.reason : 'error';
      state.phase = 'error';
      const ladder = state.error === 'offline' ? rule.offlineLadder : rule.ladder;
      schedule(Math.max(ladder[Math.min(state.failures - 1, ladder.length - 1)], Number(answer?.retryAfterMs) || 0));
    }
    onChange();
    if (again) { again = false; if (state.phase !== 'signed-out' && !backingOff()) void run(); }
  }

  return {
    policy: rule,
    snapshot: () => ({ ...state, rows: [...state.rows] }),
    /** The folder was added or the window opened: first load now (or when a window shows). */
    start() {
      if (started) return;
      started = true; generation += 1;
      if (visible()) void run(); else waiting = true;
    },
    stop() { started = false; generation += 1; cancel(); if (pageTimer !== null) clearTimer(pageTimer); pageTimer = null; inFlight = false; again = false; },
    /** A window of the profile came on screen or was focused. */
    noteVisible() {
      if (!started || inFlight || state.phase === 'signed-out' || backingOff()) return;
      if (waiting || state.phase === 'idle' || (state.lastRunAt && now() - state.lastRunAt >= rule.away)) void run();
      else if (timer === null) schedule(Math.max(1000, state.nextAt - now()));
    },
    /** A pull request page of this profile finished loading: refresh in a few seconds, unless one just ran. */
    notePageLoaded() {
      if (!started || state.phase === 'signed-out' || backingOff()) return;
      if (pageTimer !== null) clearTimer(pageTimer);
      pageTimer = setTimer(() => { pageTimer = null; if (started && visible() && !backingOff() && !inFlight && now() - state.lastRunAt >= rule.pageGap) void run(); }, rule.pageDebounce);
      pageTimer?.unref?.();
    },
    /** The github.com sign-in cookie appeared in the profile. */
    noteSignedIn() { if (started && state.phase === 'signed-out' && !inFlight) void run(); },
    /** "Refresh now" / "Check again" / a filter change that needs more than the rows held. Returns what it did. */
    refreshNow({ force = false } = {}) {
      if (!started) return 'stopped';
      if (inFlight) { again = true; return 'running'; }
      if (backingOff() && state.error === 'rate-limited') return 'wait';
      if (!force && state.phase === 'ok' && now() - state.lastRunAt < rule.manualGap) return 'recent';
      void run();
      return 'started';
    },
  };
}

module.exports = { createRefresher, POLICY };
