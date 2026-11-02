'use strict';
// chrome.history events, main process (package P7). search / getVisits stay with Acira's read-only history answers (extension-store-apis.cjs);
// this package adds what extensions such as Vimium wait for: history.onVisited and history.onVisitRemoved, for this profile's own visits only.
// history.addUrl / deleteUrl / deleteRange / deleteAll (writes) are not built yet.
const hook = require('./history/host.cjs');

module.exports = {
  namespaces: ['history'],
  install(api) {
    const profileId = api.storeKey;
    const off = hook.on(event => {
      if (event.profileId !== profileId) return;
      if (event.type === 'visited') { if (api.listening('history.onVisited').length) api.broadcast('history.onVisited', event.item); }
      else if (event.type === 'removed') { if (api.listening('history.onVisitRemoved').length) api.broadcast('history.onVisitRemoved', event.removed); }
    });
    return {dispose: off};
  }
};
