'use strict';
// Extension side of chrome.browsingData (this function is copied into the preload as text: it may use only `acira` and the page's globals).
// Chromium answers a data type it cannot remove with a console warning and carries on; the main side hands such warnings back and they are written to the extension's console here.
module.exports = {
  namespaces: ['browsingData'],
  renderer(acira) {
    const names = ['remove', 'removeAppcache', 'removeCache', 'removeCacheStorage', 'removeCookies', 'removeDownloads', 'removeFileSystems', 'removeFormData', 'removeHistory', 'removeIndexedDB', 'removeLocalStorage', 'removePluginData', 'removePasswords', 'removeServiceWorkers', 'removeWebSQL'];
    const functions = {settings: () => acira.call('browsingData.settings')()};
    for (const name of names) {
      functions[name] = (...args) => acira.call('browsingData.' + name)(...args).then(answer => {
        if (answer && Array.isArray(answer.__acira_warnings)) for (const text of answer.__acira_warnings) { try { console.warn(text); } catch (e) { /* no console */ } }
      });
    }
    return {browsingData: {factory: () => acira.build('browsingData', {functions})}};
  }
};
