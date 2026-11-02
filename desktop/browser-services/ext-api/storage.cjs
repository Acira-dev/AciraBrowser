'use strict';
// chrome.storage, main side (P3): the relay that gives MV3 service workers storage.onChanged.
//
// Measured in the real app (qa/p3-runtime-live.mjs): Chromium's storage.onChanged reaches extension pages (every area) but never an
// extension's service worker in Electron, so a worker's listener stayed silent. An extension page that hears a change forwards it here
// ('storage.forward', only pages of extensions that have a service worker) and the worker, which subscribes to 'storage.relay' while it has
// listeners, receives it. With several pages open the same change arrives once per page: a change that another page forwarded a moment
// ago is dropped. A change reaches a worker only while some page of that extension is open (a content script's write, or the worker's own,
// is only heard by pages): documented in docs/launch/EXTENSION_API_COVERAGE.md.
const WINDOW_MS = 250;

module.exports = {
  namespaces: ['storage'],
  install(api) {
    const recent = new Map(); // extension id -> [{key, who, at}]
    api.handle('storage.forward', (event, area, changes) => {
      const id = event.extension && event.extension.id;
      if (!id || typeof area !== 'string' || !changes || typeof changes !== 'object' || Array.isArray(changes)) return;
      if (!api.listening('storage.relay').includes(id)) return;
      const now = Date.now(), who = event.sender && (event.sender.id !== undefined ? event.sender.id : event.sender.processId);
      let key;
      try { key = area + '|' + JSON.stringify(changes); } catch { return; }
      const seen = (recent.get(id) || []).filter(entry => now - entry.at < WINDOW_MS);
      const duplicate = seen.some(entry => entry.key === key && entry.who !== who);
      seen.push({key, who, at: now});
      recent.set(id, seen);
      if (!duplicate) api.emit(id, 'storage.relay', changes, area);
    });
    return {forget(id) { recent.delete(id); }};
  }
};
