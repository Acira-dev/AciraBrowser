'use strict';
// R4-61: the occasional "How do you like <feature>?" card. Pure state machine (no Electron, no clock of its own) so tests can drive it.
// The state lives in metrics.json next to the usage choice and is deleted with it when usage sharing is turned off.
// Rules (founder, 27 Oct): only a feature the person used at least 3 times; at least 2 days after usage sharing started and never in the
// first session; at most one ask every 7 days; a feature is never asked again once answered or dismissed twice; never within 10 minutes
// of launch (main), never while typing, in fullscreen, during video or setup, or in private/Tor windows (the card checks those); an
// untouched card hides itself after about 20 seconds. If usage sharing is off, nothing is asked at all.
// The message sent for an answer is exactly {schema:1, event:'rating', feature, stars, appVersion, platform, day} (handler.mjs validateRating).

const FEATURES = Object.freeze(['splitView', 'windowViews', 'workspaces', 'peek', 'sidebarTabs', 'rewind', 'tabSets', 'adBlocking', 'signBackIn', 'newTabArtwork']);
/** Which local use notes count toward which rating feature (usage-facts USES names plus a few rating-only notes). */
const SOURCES = Object.freeze({ splitView: 'splitView', seamlessReveals: 'windowViews', windowView: 'windowViews', workspaceSwitches: 'workspaces', peek: 'peek', sidebarTabs: 'sidebarTabs', rewind: 'rewind', tabSets: 'tabSets', protectionPanel: 'adBlocking', signBackIn: 'signBackIn', newTabArtwork: 'newTabArtwork' });
const RULES = Object.freeze({ minUses: 3, minDays: 2, gapDays: 7, maxDismissals: 2, quietMs: 10 * 60 * 1000, autoHideMs: 20000, cap: 1000 });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const days = (from, to) => (DAY.test(from) && DAY.test(to) ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) : -1);

/** A saved rating state, cleaned: unknown features and keys are dropped, counts are small integers. */
function clean(saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  const counts = {}, dismissed = {};
  for (const feature of FEATURES) {
    const n = Number(value.counts?.[feature]); if (Number.isFinite(n) && n > 0) counts[feature] = Math.min(Math.floor(n), RULES.cap);
    const d = Number(value.dismissed?.[feature]); if (Number.isFinite(d) && d > 0) dismissed[feature] = Math.min(Math.floor(d), RULES.maxDismissals);
  }
  return {
    since: DAY.test(value.since || '') ? value.since : '',
    sessions: Number.isFinite(Number(value.sessions)) && value.sessions > 0 ? Math.min(Math.floor(value.sessions), 100000) : 0,
    counts, dismissed,
    answered: Array.isArray(value.answered) ? FEATURES.filter((feature) => value.answered.includes(feature)) : [],
    lastAsk: DAY.test(value.lastAsk || '') ? value.lastAsk : '',
  };
}
/** One app launch while sharing is on. The first one also sets the start day. */
const startSession = (state, today) => ({ ...clean(state), since: clean(state).since || today, sessions: clean(state).sessions + 1 });
/** One use of something that counts toward a rating feature. Unknown notes change nothing. */
function countUse(state, note) {
  const current = clean(state), feature = SOURCES[note];
  if (!feature) return current;
  return { ...current, counts: { ...current.counts, [feature]: Math.min((current.counts[feature] || 0) + 1, RULES.cap) } };
}
/** Why no card can be shown now, or '' when one can. */
function blocker(state, { sharing, ask, today, launchedAt, now, quietMs = RULES.quietMs }) {
  const current = clean(state);
  if (!sharing) return 'sharing off';
  if (!ask) return 'asking off';
  if (!current.since || days(current.since, today) < RULES.minDays) return 'too new';
  if (current.sessions < 2) return 'first session';
  if (Number.isFinite(launchedAt) && Number.isFinite(now) && now - launchedAt < quietMs) return 'just launched';
  if (current.lastAsk && days(current.lastAsk, today) < RULES.gapDays) return 'asked recently';
  return '';
}
/** The feature to ask about now (the most-used eligible one), or null. */
function nextFeature(state, context) {
  if (blocker(state, context)) return null;
  const current = clean(state);
  const ready = FEATURES.filter((feature) => (current.counts[feature] || 0) >= RULES.minUses && !current.answered.includes(feature) && (current.dismissed[feature] || 0) < RULES.maxDismissals);
  ready.sort((a, b) => current.counts[b] - current.counts[a] || FEATURES.indexOf(a) - FEATURES.indexOf(b));
  return ready[0] || null;
}
/** The card appeared: the 7-day gap starts today, whatever the person does with it. */
const shown = (state, feature, today) => (FEATURES.includes(feature) ? { ...clean(state), lastAsk: today } : clean(state));
const answered = (state, feature) => { const current = clean(state); return FEATURES.includes(feature) && !current.answered.includes(feature) ? { ...current, answered: [...current.answered, feature] } : current; };
const dismissed = (state, feature) => { const current = clean(state); return FEATURES.includes(feature) ? { ...current, dismissed: { ...current.dismissed, [feature]: Math.min((current.dismissed[feature] || 0) + 1, RULES.maxDismissals) } } : current; };

/** The exact rating message, or null when anything is not a valid value. Nothing else can be added to it. */
function ratingMessage({ feature, stars, appVersion, platform, day }) {
  if (!FEATURES.includes(feature) || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  if (!['win32', 'darwin', 'linux'].includes(platform) || !DAY.test(String(day))) return null;
  return { schema: 1, event: 'rating', feature, stars, appVersion: String(appVersion), platform, day };
}

module.exports = { FEATURES, SOURCES, RULES, clean, startSession, countUse, blocker, nextFeature, shown, answered, dismissed, ratingMessage, days };
