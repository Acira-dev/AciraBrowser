'use strict';
// chrome.history.onVisited / onVisitRemoved (ext-api/history.cjs): the one hook is noteHistory(list), which main.cjs calls with the shared
// browsing-history list whenever it changes (publishShared). The first call only learns the list; later calls report what is new or gone.
// Visits of private windows are never in that list (they are not recorded), so nothing private can reach an extension from here.
let known = null;          // Map visit id -> {url, profile}
let lastList = null;
const listeners = new Set();

const profileOf = visit => visit.browserProfileId || visit.profileId || '';

function noteHistory(list) {
  if (!Array.isArray(list) || list === lastList) return;
  lastList = list;
  const next = new Map();
  for (const visit of list) if (visit && typeof visit.id === 'string') next.set(visit.id, {url: visit.url, profile: profileOf(visit)});
  const before = known;
  known = next;
  if (!before || !listeners.size) return;
  const added = list.filter(visit => visit && typeof visit.id === 'string' && !before.has(visit.id));
  const removed = [...before].filter(([id]) => !next.has(id));
  if (added.length) {
    const counts = new Map();
    for (const visit of list) { const key = profileOf(visit) + '\n' + visit.url; counts.set(key, (counts.get(key) || 0) + 1); }
    for (const visit of added) emit({type: 'visited', profileId: profileOf(visit), item: {id: visit.id, url: visit.url, title: visit.title || '', lastVisitTime: Date.parse(visit.time) || Date.now(), visitCount: counts.get(profileOf(visit) + '\n' + visit.url) || 1, typedCount: 0}});
  }
  if (removed.length) {
    const remaining = new Set();
    for (const entry of next.values()) remaining.add(entry.profile + '\n' + entry.url);
    const byProfile = new Map();
    for (const [, entry] of removed) {
      if (remaining.has(entry.profile + '\n' + entry.url)) continue;   // another visit of the same address is still there: the page is still in history
      if (!byProfile.has(entry.profile)) byProfile.set(entry.profile, new Set());
      byProfile.get(entry.profile).add(entry.url);
    }
    for (const [profileId, urls] of byProfile) {
      const stillHas = [...next.values()].some(entry => entry.profile === profileId);
      emit({type: 'removed', profileId, removed: stillHas ? {allHistory: false, urls: [...urls]} : {allHistory: true}});
    }
  }
}

function emit(event) { for (const listener of [...listeners]) { try { listener(event); } catch { /* one extension never stops the others */ } } }

module.exports = {
  noteHistory,
  /** Listen for {type: 'visited', profileId, item} and {type: 'removed', profileId, removed}. Returns an unsubscribe function. */
  on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  emit,
  reset() { known = null; lastList = null; }
};
