'use strict';
// chrome.scripting in extension pages and service workers (work package P8, activeTab). The function below is copied into the preload as text:
// it may use only `acira` and the page's globals. An extension with the activeTab permission asks the main process first whether the person just used
// the extension on this tab (a toolbar click, its command or a menu item) and, if so, the code runs there; otherwise Chromium's own executeScript /
// insertCSS answer as before.
module.exports = {
  namespaces: ['scripting'],
  renderer(acira) {
    return {
      scripting: {
        factory: base => {
          const prepareScript = details => {
            const out = {target: details.target, world: details.world === 'MAIN' ? 'MAIN' : 'ISOLATED'};
            if (typeof details.func === 'function') out.source = '(' + details.func.toString() + ')(...' + JSON.stringify(details.args || []) + ')';
            else if (Array.isArray(details.files)) out.files = details.files.slice();
            return out;
          };
          const prepareCss = details => ({target: details.target, origin: details.origin, css: details.css, files: Array.isArray(details.files) ? details.files.slice() : undefined});
          // Chromium's own executeScript / insertCSS know a tab by its page id; an extension holds the id Acira gave the tab (tabs.query, tabs.onUpdated),
          // which they did not find ("No tab with id: 2000000000"): YouTube Inline Fullscreen's popup injects its script that way. Like tabs.sendMessage,
          // the page behind the id is looked up first (a tab that was asleep or moved to a new page has another page id than the id chrome.tabs gave, 2000000002
          // for a restored tab); an id Acira does not know goes on unchanged.
          const withPageId = details => {
            const tabId = details && typeof details === 'object' && details.target && typeof details.target === 'object' ? details.target.tabId : undefined;
            if (!Number.isInteger(tabId)) return Promise.resolve(details);
            return acira.call('acira.tabs.pageId')(tabId).then(page => (Number.isInteger(page) && page >= 0 ? Object.assign({}, details, {target: Object.assign({}, details.target, {tabId: page})}) : details), () => details);
          };
          // A package Acira unpacked has acira-storage-sync-shim.js first in every manifest content script (extension-shims.cjs): chrome.storage.sync does not
          // exist in a content-script world without it. A script put in a tab with executeScript({files}) runs in a world no manifest content script ever made
          // (the extension was installed after the page was opened, or its patterns do not match), so there it threw at its first
          // chrome.storage.sync.get and neither its shortcut nor its button worked. The shim goes first there too (it does nothing when already installed).
          const SHIM = 'acira-storage-sync-shim.js';
          const withShim = (name, details) => {
            if (name !== 'executeScript' || !details || typeof details !== 'object' || !Array.isArray(details.files) || details.world === 'MAIN' || details.files.includes(SHIM)) return details;
            try {
              const manifest = acira.chrome().runtime.getManifest();
              if ((manifest.content_scripts || []).some(entry => entry && Array.isArray(entry.js) && entry.js.includes(SHIM))) return Object.assign({}, details, {files: [SHIM].concat(details.files)});
            } catch (error) { /* no manifest to read: the files go as they are */ }
            return details;
          };
          const wrap = (name, handler, prepare) => function (given, callback) {
            const details = withShim(name, given);
            const native = () => (base && typeof base[name] === 'function' ? withPageId(details).then(mapped => base[name](mapped)) : Promise.reject(new Error('Cannot access contents of the page.')));
            const askMain = acira.has('activeTab') && !!details && typeof details === 'object' && !!details.target && Number.isInteger(details.target.tabId);
            const promise = askMain ? acira.call(handler)(prepare(details)).then(answer => (answer && answer.unavailable === true ? native() : answer)) : native();
            if (typeof callback === 'function') {
              promise.then(value => callback(value), error => acira.withLastError(String(error && error.message || error), () => callback()));
              return undefined;
            }
            return promise;
          };
          return acira.extend(base, {
            executeScript: wrap('executeScript', 'scripting.activeTab.executeScript', prepareScript),
            insertCSS: wrap('insertCSS', 'scripting.activeTab.insertCSS', prepareCss)
          });
        }
      }
    };
  }
};
