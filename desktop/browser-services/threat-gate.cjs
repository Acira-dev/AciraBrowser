'use strict';
const { t } = require('./tx.cjs');
// The request-time half of the phishing and malware lists (threat-lists.cjs): what happens when an address is listed.
//   top-level navigation  -> cancelled; Acira's warning page (NavigationError, kind "threat") explains it. "Continue anyway (unsafe)" is behind a
//                            disclosure and is remembered per listed entry (a listed host, or one listed page on a shared host), per browsing profile, until Acira quits.
//   anything else (images, scripts, frames, XHR) -> cancelled quietly. A page that pulls in a listed address just loses that piece.
// Private windows get the same protection; their "continue" choice lives only as long as the window's profile does.
/** Read when a warning is shown, so the words follow the current language. */
const WORDS = Object.freeze({
  get phishing() { return Object.freeze({ title: t('threat.blocked.title'), cause: t('threat.phishing.cause'), detail: t('threat.phishing.detail') }); },
  get malware() { return Object.freeze({ title: t('threat.blocked.title'), cause: t('threat.malware.cause'), detail: t('threat.malware.detail') }); }
});
function createThreatGate({ lists, now = Date.now, lookalike = () => null }) {
  const allowed = new Set(), recent = new Map(), stats = { warned: 0, blocked: 0 };
  const siteKey = (profileId, host) => String(profileId || '') + '|' + String(host || '').toLowerCase();
  /** The pipeline step. `profileId` is the browsing profile the request belongs to. */
  function check(details, wc, profileId) {
    if (!/^https?:/i.test(details.url || '')) return {};
    const hit = lists.lookup(details.url) || (details.resourceType === 'mainFrame' ? lookalike(details.url) : null); if (!hit) return {};
    if (details.resourceType === 'mainFrame') {
      if (allowed.has(siteKey(profileId, hit.key || hit.host))) return {};
      stats.warned++; if (wc) { recent.set(wc.id, { profileId, url: details.url, kind: hit.kind, list: hit.list, host: hit.host, key: hit.key || hit.host, words: hit.words, at: now() }); if (recent.size > 200) recent.delete(recent.keys().next().value); }
      return { cancel: true };
    }
    stats.blocked++; return { cancel: true };
  }
  // The warning page asks about the tab's failed navigation. The address the tab shows can differ from the blocked one when a redirect led there, so a block
  // counts for its tab if it is the same address or recent (two minutes); the page only asks while its own error is "blocked by client".
  const fresh = (found, address) => found && (found.url === address || now() - found.at <= 2 * 60 * 1000);
  /** What the warning page shows for a tab. */
  function status(wcId, address) {
    const found = recent.get(wcId); if (!fresh(found, address)) return null;
    const words = found.words || WORDS[found.kind] || WORDS.phishing;
    return { kind: found.kind, list: found.list, host: found.host, title: words.title, cause: words.cause, detail: words.detail };
  }
  /** "Continue anyway": only for a site this gate blocked in that tab, then that site passes for the rest of the session. */
  function allow(wcId, address, profileId) {
    const found = recent.get(wcId); if (!fresh(found, address)) return false;
    allowed.add(siteKey(profileId, found.key)); recent.delete(wcId); return true;
  }
  function forgetProfile(profileId) {
    const prefix = siteKey(profileId, '');
    for (const key of allowed) if (key.startsWith(prefix)) allowed.delete(key);
    for (const [id, warning] of recent) if (warning.profileId === profileId) recent.delete(id);
  }
  return { check, status, allow, forget: wcId => recent.delete(wcId), forgetProfile, stats: () => ({ ...stats }), isAllowed: (profileId, key) => allowed.has(siteKey(profileId, key)) };
}
module.exports = { createThreatGate, WORDS };
