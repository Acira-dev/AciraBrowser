'use strict';
// chrome.history events, main process (package P7). search / getVisits stay with Acira's read-only history answers (extension-store-apis.cjs);
// this package adds what extensions such as Vimium wait for: history.onVisited and history.onVisitRemoved, for this profile's own visits only.
// 14.3 (D158): history.addUrl / deleteUrl / deleteRange / deleteAll change THIS profile's own history list, as Chromium's history_api.cc does (its errors and its [start, end) range);
// a private profile has no history, so there is nothing to change and nothing is read.
const hook = require('./history/host.cjs');

const INVALID_URL = 'Url is invalid.';   // history_api.cc kInvalidUrlError
const need = () => { const store = hook.store(); if (!store) throw new Error('Acira cannot change its history now.'); return store; };
/** history_api.cc ValidateUrl: GURL(url).is_valid() (an absolute address); returns the canonical address. */
function validUrl(text) {
  try { const url = new URL(String(text)); return url.href; } catch { throw new Error(INVALID_URL); }
}
const canonical = text => { try { return new URL(String(text)).href; } catch { return String(text); } };

module.exports = {
  namespaces: ['history'],
  install(api) {
    const profileId = api.storeKey, ownHistory = !String(profileId).startsWith('private-');
    const allow = event => { if (api.permissions && event && event.extension && !api.permissions.has(event.extension, 'history')) throw new Error("The 'history' API requires the 'history' permission."); };
    const removeWhere = async test => { const store = need(), ids = ownHistory ? store.records(profileId).filter(test).map(visit => visit.id) : []; if (ids.length) await store.remove(profileId, ids); };
    api.handle('history.deleteAll', async event => { allow(event); await removeWhere(() => true); });
    api.handle('history.deleteRange', async (event, range) => {
      allow(event);
      const start = Number(range && range.startTime), end = Number(range && range.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid arguments.');
      await removeWhere(visit => { const at = Date.parse(visit.time); return at >= start && at < end; });   // DeleteLocalAndRemoteHistoryBetween(begin, end): the end is not included
    });
    api.handle('history.deleteUrl', async (event, details) => {
      allow(event);
      const url = validUrl(details && details.url);
      await removeWhere(visit => canonical(visit.url) === url);
    });
    api.handle('history.addUrl', async (event, details) => {
      allow(event);
      const url = validUrl(details && details.url);
      // HistoryService::AddPage keeps what the browser itself would record: web pages. Anything else is not added (no error), as there.
      if (!ownHistory || !/^https?:$/.test(new URL(url).protocol)) return;
      await need().add(profileId, {url, title: ''});
    });
    const off = hook.on(event => {
      if (event.profileId !== profileId) return;
      if (event.type === 'visited') { if (api.listening('history.onVisited').length) api.broadcast('history.onVisited', event.item); }
      else if (event.type === 'removed') { if (api.listening('history.onVisitRemoved').length) api.broadcast('history.onVisitRemoved', event.removed); }
    });
    return {dispose: off};
  }
};
