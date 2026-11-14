'use strict';
// 13.8 exit-cleanup, the structural fix: Acira's OWN scheduled downloads (the filter lists, the threat lists, the site allow-list) have a network context of their own.
//
// They used to go out on the first ordinary profile's session (content-blocking.cjs ordinarySession). So for that profile each one was a tracked request of its pipeline
// (request-pipeline.cjs): the count the exit cleanup waits on and the release check reads after the profile's last window is closed. The laptop's kept profiles showed it: the
// two failing normal runs (a 13.8 candidate, and 13.7) were the only ones with no threat-lists/phishing.txt written, a live download still in flight on a profile with no page left.
// And Acira's own traffic had no business riding on a person's profile at all: its cookies, its cache, its cleanup and its private-data clearing are the person's.
//
// Chromium's way: browser-level services use a network context of their own, never the profile's (SystemNetworkContextManager, the safe-browsing network context; the same rule
// dl-keys applied to the extension updater's quit, and Acira already applies to the update check (update-route.cjs, session 'electron-updater') and to the new-tab pictures
// (artwork-remote.cjs, session 'acira-artwork')). Here, like the update check: an in-memory session with no HTTP cache ('acira-background', {cache: false}); before every
// download it is given the route the profile's pages run with (the person's proxy choice, or an extension's while one controls it, update-route.cjs createUpdateRoute); a route that
// is not confirmed sends nothing. Secure DNS is application-wide (app.configureHostResolver, secure-dns.cjs scope 'application'), so it applies as before. No webRequest pipeline,
// no preload scripts, no extensions, no cookies (the downloaders send none: credentials 'omit') and no certificate exceptions a person made for a site.
//
// The profile session a caller passes (filter-updates.cjs `refresh(session)`, threat-lists.cjs `maybeRefresh(session)`) stays what it was: the proof that an ordinary profile asked.
// Nothing is sent on it. The quit switch (background-work.cjs) applies to these downloads as before, and nothing is downloaded while the profile cleanup has not let the network
// out yet or while it runs at exit (`allowed`: the same rule as the interface's own network, main.cjs uiNetworkPipeline).

const NOT_CONFIRMED = 'The connection settings are not confirmed yet, so Acira did not download its filter and threat lists. It tries again later.';
const NOT_READY = 'The network is not open yet, so Acira did not download its filter and threat lists. It tries again later.';

/**
 * `session()` is the background session, `route()` follows the profile's route on it (rejects with code ERR_UPDATE_ROUTE when that is not confirmed), `allowed()` says whether
 * Acira's own network may be used now. `request` and `fetchText` are the downloaders (a test passes its own).
 */
function createBackgroundNetwork({ session, route, allowed = () => true, request = require('./public-list-download.cjs').downloadListIfChanged, fetchText = require('./site-allowlist.cjs').electronFetchText }) {
  // The first route change (update-route.cjs) is setProxy() and then closeAllConnections(), and `last` is only remembered when both are done. The filter lists start eight downloads at once, each asking
  // for the route: every one of them ran the change again and closed the connections of the others' requests (the real-app check on the release tip: eight net::ERR_ABORTED at the start, and the lists
  // took three times as long). Callers that ask while a route change is under way wait for that one.
  let routing = null;
  const follow = () => routing || (routing = Promise.resolve().then(route).finally(() => { routing = null; }));
  async function ready() {
    if (!allowed()) throw Object.assign(new Error(NOT_READY), { code: 'ERR_BACKGROUND_NETWORK' });
    try { await follow(); } catch (error) {
      if (error && error.code === 'ERR_UPDATE_ROUTE') throw Object.assign(new Error(NOT_CONFIRMED), { code: 'ERR_BACKGROUND_NETWORK' });
      throw error;
    }
    return session();
  }
  return {
    /** The downloader the filter lists take (`download(url, session, options)` answers {status, text, etag, lastModified}); the session argument is ignored: it is the profile that asked. */
    async download(url, _profileSession, options) { return request(url, await ready(), options); },
    /** The downloader the threat lists take: the TEXT of the address, as public-list-download.cjs `downloadList` answers (threat-lists.cjs validates what it is given as the list's text). The real-app check on the release tip
     *  found the threat lists were never written: they were given the {status, text, ...} object the filter lists take. */
    async downloadText(url, _profileSession, options) { const reply = await request(url, await ready(), { ...options, etag: undefined, lastModified: undefined }); return reply.text; },
    /** The allow-list's fetch (`fetchText(url, session)`), likewise. */
    async fetchText(url, _profileSession) { return fetchText(url, await ready()); },
    ready,
  };
}

module.exports = { createBackgroundNetwork, NOT_CONFIRMED, NOT_READY };
