'use strict';
// The site colour's top-strip capture, kept a moment for Ambient mode: Ambient's cachedTop reuses a strip younger than TTL_MS instead of capturing again.
// Beta 14 speed pass (RAM): main kept every tab's last strip (a 430 KB bitmap at 2x) for the whole session, Ambient on or off and closed tabs included:
// 30 tabs held 12 MB of the main process. Now a strip is kept only while Ambient mode is on, and only for as long as it can be used; then it is dropped.
const TTL_MS = 600;
function createAmbientStripCache({enabled = () => true, now = () => Date.now(), setTimer = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; }} = {}) {
  const kept = new Map();
  return {
    /** A strip just captured for tab `id`: kept for TTL_MS while Ambient is on, never otherwise. */
    put(id, strip) {
      if (!strip || !enabled()) return;
      const hit = {at: now(), strip};
      kept.set(id, hit);
      setTimer(() => { if (kept.get(id) === hit) kept.delete(id); }, TTL_MS + 50);
    },
    /** Tab `id`'s strip if it is younger than TTL_MS, else null (the reader then captures its own). */
    recent(id) { const hit = kept.get(id); return hit && now() - hit.at < TTL_MS ? hit.strip : null; },
    size: () => kept.size
  };
}
module.exports = {createAmbientStripCache, TTL_MS};
