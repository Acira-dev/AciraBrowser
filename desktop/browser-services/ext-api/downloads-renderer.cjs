'use strict';
// chrome.downloads, extension side (package P7). Built on Chromium 152's schema: every member exists, arguments are checked with
// Chromium's errors, and the behaviour is answered by the main process (ext-api/downloads.cjs). This function is copied into the
// preload as text: it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['downloads'],
  renderer(acira) {
    const call = acira.call;
    // onDeterminingFilename: each listener is called with (item, suggest). It answers by calling suggest() once, now or later (a listener that does
    // it later returns true, as in Chrome); one that neither calls it nor returns true is counted as having suggested nothing. When every
    // listener of THIS page or worker has answered, their suggestions go to the main process in one reply (the last one that named a file wins here too).
    const determining = new Set();
    const complain = error => { try { console.error('Error in event handler: ' + (error && error.stack || error)); } catch (e) { /* no console */ } };
    const determined = acira.event('downloads.onDeterminingFilename', {add: listener => { determining.add(listener); }, remove: listener => { determining.delete(listener); }});
    Object.defineProperty(determined, 'dispatch', {configurable: true, value(payload) {
      const key = payload && payload.k, item = payload && payload.item;
      if (typeof key !== 'string' || !item) return;
      const listeners = [...determining], suggestions = [];
      let waiting = listeners.length, sent = false;
      const reply = () => {
        if (sent) return;
        sent = true;
        const merged = {};
        for (const suggestion of suggestions) { if (suggestion.filename) merged.filename = suggestion.filename; if (suggestion.conflictAction) merged.conflictAction = suggestion.conflictAction; }
        call('downloads.determineFilename')(key, merged).catch(error => { try { console.error('Unchecked runtime.lastError: ' + (error && error.message || error)); } catch (e) { /* no console */ } });
      };
      if (!waiting) { reply(); return; }
      for (const listener of listeners) {
        let done = false;
        const suggest = suggestion => {
          if (done) return;
          done = true;
          if (suggestion && typeof suggestion === 'object') suggestions.push({filename: suggestion.filename, conflictAction: suggestion.conflictAction});
          if (--waiting === 0) reply();
        };
        let result;
        try { result = Reflect.apply(listener, globalThis, [JSON.parse(JSON.stringify(item)), suggest]); } catch (error) { complain(error); suggest(); continue; }
        if (result !== true) suggest();
      }
    }});
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
            onErased: acira.event('downloads.onErased'),
            onDeterminingFilename: determined
          }
        })
      }
    };
  }
};
