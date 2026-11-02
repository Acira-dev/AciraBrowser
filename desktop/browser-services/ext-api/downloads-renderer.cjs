'use strict';
// chrome.downloads, extension side (package P7). Built on Chromium 152's schema: every member exists, arguments are checked with
// Chromium's errors, and the behaviour is answered by the main process (ext-api/downloads.cjs). This function is copied into the
// preload as text: it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['downloads'],
  renderer(acira) {
    const call = acira.call;
    return {
      downloads: {
        factory: () => acira.build('downloads', {
          functions: {
            download: call('downloads.download'),
            search: call('downloads.search'),
            pause: call('downloads.pause'),
            resume: call('downloads.resume'),
            cancel: call('downloads.cancel'),
            open: call('downloads.open'),
            erase: call('downloads.erase'),
            removeFile: call('downloads.removeFile'),
            setUiOptions: call('downloads.setUiOptions'),
            // show / showDefaultFolder have no callback and no promise in Chromium: they answer undefined; a failure only reaches the console.
            show: id => { call('downloads.show')(id).catch(() => {}); },
            showDefaultFolder: () => { call('downloads.showDefaultFolder')().catch(() => {}); }
          },
          events: {
            onCreated: acira.event('downloads.onCreated'),
            onChanged: acira.event('downloads.onChanged'),
            onErased: acira.event('downloads.onErased')
          }
        })
      }
    };
  }
};
