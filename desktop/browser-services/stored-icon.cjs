'use strict';
// A site visited before shows its stored icon the moment its page commits (Chrome's behaviour), so a revisit never starts with a globe and a heavy page (Twitch: its main thread is busy for
// seconds, the engine reports the page's icon only when it is free again) does not leave the tab bare meanwhile. The page's own icon replaces it as soon as the engine announces it.
// Pure: the store is passed in. Nothing is fetched here; only an icon the tab itself already fetched and kept (favicon-store) is used.
/** The data URL of the icon kept for this page's site, or '' when there is none or the tab must not use one (a private tab, a Tor window, an icon already showing, a page that is not http(s)). */
function storedIconAtCommit({ store, profileId, url, currentFavicon = '', privateTab = false, tor = false } = {}) {
  if (privateTab || tor || currentFavicon) return '';
  if (!store || typeof store.get !== 'function' || typeof profileId !== 'string' || !profileId) return '';
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
  let host = null;
  try { host = store.hostOf(url); } catch { host = null; }
  return host ? String(store.get(profileId, host) || '') : '';
}
module.exports = { storedIconAtCommit };
