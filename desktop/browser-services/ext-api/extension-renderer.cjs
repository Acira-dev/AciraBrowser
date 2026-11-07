'use strict';
// chrome.extension for extension pages and service workers (P3): the three members the engine stubbed, now with Chromium's argument checks,
// promise / callback forms and availability (getViews does not exist in a service worker). The rest (getBackgroundPage, getURL,
// inIncognitoContext, lastError, ...) stays what the engine and Chromium provide.
//   isAllowedFileSchemeAccess  false: Acira loads extensions without file access and has no per-extension switch for it
//   isAllowedIncognitoAccess   false in an ordinary profile; true inside a private session that runs the extension (Settings › Extensions › Allow in private tabs).
//                              Tor windows and secured workspaces run no extension at all
//   getViews                   an extension page lists itself when no filter is given; other pages and the worker are not reachable from a
//                              page (a stub: [] with a filter)
function extensionRenderer(acira) {
  return {
    extension: {
      factory: base => {
        if (!base || typeof base !== 'object') return base;
        const built = acira.build('extension', {
          functions: {
            isAllowedFileSchemeAccess: () => Promise.resolve(false),
            isAllowedIncognitoAccess: () => Promise.resolve(acira.incognito === true),
            getViews: fetchProperties => {
              const filtered = !!fetchProperties && (fetchProperties.type !== undefined || fetchProperties.windowId !== undefined || fetchProperties.tabId !== undefined);
              return !filtered && typeof window !== 'undefined' ? [window] : [];
            }
          }
        });
        const overrides = {};
        for (const name of ['isAllowedFileSchemeAccess', 'isAllowedIncognitoAccess']) if (typeof built[name] === 'function') overrides[name] = built[name];
        // In a service worker Chromium has no extension.getViews; the engine's stub must not show.
        if (typeof built.getViews === 'function') overrides.getViews = built.getViews; else if (acira.isWorker) overrides.getViews = undefined;
        if (acira.incognito === true) overrides.inIncognitoContext = true;
        return acira.extend(base, overrides);
      }
    }
  };
}

module.exports = {namespaces: ['extension'], renderer: extensionRenderer};
