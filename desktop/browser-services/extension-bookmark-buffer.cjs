'use strict';
// A burst of chrome.bookmarks writes, one store change. Floccus (or any sync extension) creates thousands of bookmarks one call at a time,
// each awaited, and every call used to be its own change of Acira's store: the whole state copied, saved, shared with every window and sent
// to the interface each time, which made a first sync of a few thousand bookmarks minutes long (the cost grew with the size of the library).
// Now a write is applied to the buffer's own working copy of the profile's bookmarks at once and answered at once (and its chrome.bookmarks
// events are sent at once, in order, exactly as before), and the store gets the result as ONE `bookmark.replace` a moment later: 40 ms after the
// last write of a burst, and never more than 250 ms after the first. Everything that reads the bookmarks for an extension (getTree, get, search,
// the next write) reads the buffer first, so an extension always sees its own writes.
// What keeps the buffer honest:
//  - flushAll() is called before any action that reads or changes bookmarks (main.cjs dispatch: the person's own bookmark actions, imports,
//    undo, profile changes), before an import runs and when Acira quits, so nothing the person does is ever applied to a stale list and no
//    write waits across a quit;
//  - the events of a write are told to the hub as "already told" (adopt) before the store changes, so the store change is not told a second time.
const registry = new Set();
const FAILED_RETRY_MS = 500, FAILED_RETRIES = 20;

function createBookmarkBuffer({ read, ready = () => true, commit, adopt = () => {}, deliver = () => {}, delay = 40, maxWait = 250,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {}, trace = process.env.ACIRA_BOOKMARK_TRACE === '1' } = {}) {
  let pending = null, timer = null, since = 0, failures = 0;
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  function schedule(wait) {
    stop();
    timer = setTimer(() => { timer = null; flush(); }, wait);
    timer?.unref?.();
  }
  /** Makes the buffered list the profile's bookmarks now. False when there is nothing, or when no window can take it yet (it is tried again). */
  function flush() {
    if (pending === null) return false;
    stop();
    if (!ready()) {
      if (++failures > FAILED_RETRIES) { log('bookmark writes dropped: no window took them'); pending = null; since = 0; failures = 0; return false; }
      schedule(FAILED_RETRY_MS); return false;
    }
    const nodes = pending;
    pending = null; since = 0;   // cleared first: the store change below runs main's dispatch, which asks every buffer to flush
    const started = trace ? now() : 0;
    try { adopt(nodes); commit(nodes); failures = 0; if (trace) log(`bookmark buffer: ${nodes.length} bookmarks stored in ${now() - started} ms`); return true; }
    catch (error) { pending = nodes; since = now(); log('bookmark writes could not be applied:', error?.message || error); if (++failures > FAILED_RETRIES) { pending = null; since = 0; failures = 0; } else schedule(FAILED_RETRY_MS); return false; }
  }
  const buffer = {
    /** The profile's bookmarks as an extension must see them now: the buffered list, else the store's. */
    nodes: () => pending !== null ? pending : read(),
    hasPending: () => pending !== null,
    /**
     * compute(nodes, {owned}) is one of extension-bookmarks.cjs's writes. On success the buffered list becomes its result, the store follows
     * soon, and its events are sent now. Answers what compute answered.
     */
    apply(compute) {
      if (pending === null && !ready()) throw new Error('Acira has no open window for this profile, so its bookmarks cannot change now.');
      const owned = pending !== null, out = compute(owned ? pending : read(), { owned });
      if (!out || out.error) return out;
      if (out.nodes && !out.unchanged) {
        pending = out.nodes;
        const t = now();
        if (!since) since = t;
        schedule(Math.max(0, Math.min(delay, since + maxWait - t)));
      }
      for (const event of out.events || []) { try { deliver(event.name, ...event.args); } catch { /* an extension's listener never breaks a write */ } }
      return out;
    },
    flush,
    dispose() { stop(); registry.delete(buffer); pending = null; }
  };
  registry.add(buffer);
  return buffer;
}

/** Every buffer of every profile: main.cjs calls this before anything that reads or changes bookmarks, and when quitting. Never throws. */
function flushAll() { for (const buffer of [...registry]) { try { buffer.flush(); } catch { /* ignore */ } } }
const reset = () => { for (const buffer of [...registry]) buffer.dispose(); registry.clear(); };

module.exports = { createBookmarkBuffer, flushAll, reset };
