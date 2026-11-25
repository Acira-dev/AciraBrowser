'use strict';
// Beta 14: "When Acira starts, load ahead". A small, smart, optional version of "preload all pages": a few tabs the person is likely to
// open next are loaded quietly after start-up, one at a time, while the app is idle. Off by default. Never in Private or Tor windows.
//
// This file is the rules and the scheduler, free of Electron so it can be tested with a fake clock; desktop/main.cjs owns the page work
// (it hands `load` in) and the facts about the machine (it hands `environment` in). What a loaded-ahead tab may and may not do (no sound,
// no prompts, no focus, no history visit) is enforced where pages are made: desktop/unseen-media-gate.cjs and main.cjs `entry.unseen`.

const MODES = ['off', 'pinned', 'recent'];
const RECENT_COUNT = 5;
/** The person must have been still this long (typing, scrolling, moving the pointer) before the next page starts to load. */
const IDLE_MS = 1500;
/** After one tab has loaded (or failed), this long before the next: one tab at a time, never a burst. */
const GAP_MS = 1500;
/** How often the scheduler looks again while a condition is not met. */
const POLL_MS = 700;
/** A tab that has not finished within this long counts as failed for scheduling (the next one may go; this one is left as it is). */
const LOAD_TIMEOUT_MS = 30000;
/** The machine facts (battery saver, memory, metered connection): main's probe keeps its answer this long. */
const ENV_TTL_MS = 20000;

const modeOf = value => MODES.includes(value) ? value : 'off';

/** Which tabs to load ahead, most likely first (empty for 'off').
 *  tabs: the window's tabs; activeTabId: the front tab (it loads on its own); workspaceId: the workspace that opens (workspaceOf(tab) says which one a tab is in);
 *  loaded: ids that already have a page. */
function candidates({ mode, tabs, activeTabId, workspaceId, workspaceOf = tab => tab.workspaceId || '', loaded = new Set(), pinnedOf = tab => !!tab.pinned }) {
  const chosen = modeOf(mode);
  if (chosen === 'off') return [];
  const eligible = tabs.filter(tab => tab
    && tab.id !== activeTabId && !loaded.has(tab.id)
    && tab.contentKind === 'web' && /^https?:\/\//i.test(tab.url || '')
    && !tab.privacy && !tab.error
    // the workspace that opens: nothing of another workspace is contacted
    && workspaceOf(tab) === (workspaceId || ''));
  const used = tab => Number.isFinite(tab.usedAt) ? tab.usedAt : 0;
  // most likely first: the one used last; a Favorite before a pinned tab before the rest on a tie; then the sidebar's own order
  const rank = tab => tab.favoriteId ? 0 : pinnedOf(tab) ? 1 : 2; // pinnedOf: a tab of a pinned folder counts as pinned (runtime/pinnedFolders.ts)
  const order = (a, b) => used(b) - used(a) || rank(a) - rank(b) || tabs.indexOf(a) - tabs.indexOf(b);
  if (chosen === 'pinned') return eligible.filter(tab => pinnedOf(tab) || tab.favoriteId).sort(order).map(tab => tab.id);
  // recent: the last few used (a tab never used since this was built has no time and is never "recent")
  return eligible.filter(tab => used(tab) > 0).sort(order).slice(0, RECENT_COUNT).map(tab => tab.id);
}

/** Why loading ahead must wait right now (null: it may go). `facts` are plain values main reads cheaply. */
function waitReason({ startedUp, frontLoaded, idleMs, videoPlaying, busy, paused }) {
  if (paused) return 'paused';
  if (!startedUp) return 'starting';
  if (!frontLoaded) return 'front-loading';
  if (videoPlaying) return 'playing';
  if (idleMs < IDLE_MS) return 'active';
  if (busy) return 'busy';
  return null;
}

/** The scheduler. Everything it needs comes in through `deps`:
 *   mode(): the setting; snapshot(): { tabs, activeTabId, workspaceId, loaded:Set }; facts(): { startedUp, frontLoaded, idleMs, videoPlaying }
 *   load(tabId): Promise<'loaded'|'failed'> (does the page work and resolves when it finished or failed)
 *   environment(): Promise<null | 'battery-saver' | 'memory' | 'metered'>   (the reason loading must stop, else null)
 *   now(), setTimer(fn, ms), clearTimer(handle): the clock (a fake one in tests); note(event): optional log of what happened
 * `stop(reason)` is final for the session ("does not resume by itself"); changing the setting to Off also stops it, and picking a mode again
 * (`start()`) begins afresh. */
function createLoadAhead(deps) {
  const { mode, snapshot, facts, load, environment, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, note = () => {} } = deps;
  let timer = null, busy = false, stopped = null, running = false, done = false, token = 0;
  const attempted = new Set();
  const again = ms => { if (!running || stopped) return; clearTimer(timer); timer = setTimer(tick, ms); };
  async function tick() {
    timer = null;
    if (!running || stopped) return;
    if (modeOf(mode()) === 'off') { running = false; note({ k: 'off' }); return; }
    const f = facts(), why = waitReason({ ...f, busy });
    if (why) { again(POLL_MS); return; }
    // the machine, asked before every load (main's probe keeps its answer for ENV_TTL_MS): once it says stop it stays stopped for the session
    let reason = null; try { reason = await environment(); } catch { reason = null; }
    if (reason) { stop(reason); return; }
    if (!running || stopped) return;
    const snap = snapshot(), next = candidates({ mode: mode(), tabs: snap.tabs, activeTabId: snap.activeTabId, workspaceId: snap.workspaceId, workspaceOf: snap.workspaceOf, pinnedOf: snap.pinnedOf, loaded: new Set([...snap.loaded, ...attempted]) })[0];
    if (!next) { done = true; running = false; note({ k: 'done', attempted: [...attempted] }); return; }
    attempted.add(next); busy = true; const mine = ++token; note({ k: 'load', tab: next });
    let result = 'failed';
    let guard = null; const timeout = new Promise(resolve => { guard = setTimer(() => resolve('timeout'), LOAD_TIMEOUT_MS); });
    try { result = await Promise.race([load(next), timeout]); } catch { result = 'failed'; } finally { clearTimer(guard); }
    if (mine === token) busy = false;
    note({ k: result, tab: next });
    again(GAP_MS);
  }
  function stop(reason) { stopped = stopped || reason; running = false; clearTimer(timer); timer = null; note({ k: 'stop', reason }); }
  return {
    /** Begin (or begin again after a change of the setting). */
    start() { if (running || stopped) return; if (modeOf(mode()) === 'off') return; running = true; done = false; again(POLL_MS); },
    stop,
    state: () => ({ running, stopped, done, busy, attempted: [...attempted] }),
    /** The setting changed. Off ends it; any other value never starts it (it is "when Acira starts"), and a run in progress goes on with the new list. */
    changed() { if (modeOf(mode()) === 'off') { running = false; clearTimer(timer); timer = null; } },
  };
}

module.exports = { MODES, RECENT_COUNT, IDLE_MS, GAP_MS, POLL_MS, LOAD_TIMEOUT_MS, ENV_TTL_MS, modeOf, candidates, waitReason, createLoadAhead };
