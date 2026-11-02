'use strict';
// chrome.tabs in extension pages and service workers (package P1). Chromium's schema decides the members, argument checks, errors,
// promise / callback forms and constants; the behaviour is the main process (ext-api/tabs.cjs) for what Acira owns, and what the engine or
// Electron already answers (messaging, zoom, history navigation) is handed on unchanged.
// NOTE: this function is copied into the preload as text: it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['tabs'],
  renderer(acira) {
    return {
      tabs: {
        factory(base) {
          const functions = {};
          for (const name of ['get', 'getCurrent', 'create', 'query', 'update', 'remove', 'reload', 'move', 'highlight', 'detectLanguage', 'captureVisibleTab', 'goBack', 'goForward', 'getZoom', 'setZoom']) {
            functions[name] = acira.call('tabs.' + name);
          }
          // The previous implementation of a member, called with a callback so that it reports through lastError in Manifest V2 pages as well.
          const previous = (name, args) => new Promise((resolve, reject) => {
            const original = base && base[name];
            if (typeof original !== 'function') { reject(new Error(acira.errors.accessDenied())); return; }
            let settled = false;
            const done = (...values) => {
              if (settled) return;
              settled = true;
              const failure = acira.chrome() && acira.chrome().runtime && acira.chrome().runtime.lastError;
              if (failure) reject(new Error(failure.message)); else resolve(values.length > 1 ? values : values[0]);
            };
            try { const result = original.call(base, ...args, done); if (result && typeof result.then === 'function') result.then(value => done(value), error => { if (!settled) { settled = true; reject(error); } }); }
            catch (error) { if (!settled) { settled = true; reject(error); } }
          });
          const optional = value => (value == null ? [] : [value]);
          // Electron addresses a page by its own id; the extension's tab id is the tab's (it stays when the tab gets a new page, or has none).
          const pageIdOf = tabId => (tabId == null ? Promise.resolve(null) : acira.call('acira.tabs.pageId')(tabId));
          functions.sendMessage = (tabId, message, options) => pageIdOf(tabId).then(page => {
            if (page === null && tabId != null) throw new Error('Could not establish connection. Receiving end does not exist.');
            return previous('sendMessage', [page === null ? tabId : page, message, ...optional(options)]);
          });
          functions.getZoomSettings = tabId => previous('getZoomSettings', optional(tabId));
          functions.setZoomSettings = (tabId, settings) => previous('setZoomSettings', [...optional(tabId), settings]);
          if (base && typeof base.connect === 'function') functions.connect = (tabId, info) => base.connect(tabId, ...optional(info));
          const events = {};
          for (const name of ['onCreated', 'onUpdated', 'onMoved', 'onActivated', 'onHighlighted', 'onDetached', 'onAttached', 'onRemoved', 'onZoomChange']) {
            events[name] = acira.event('tabs.' + name);
          }
          for (const name of ['onReplaced']) if (base && base[name]) events[name] = base[name];
          return acira.build('tabs', {functions, events});
        }
      }
    };
  }
};
