'use strict';
// chrome.runtime for extension pages and service workers (P3). Chromium's own runtime stays in place (messaging, ids, manifest, URLs,
// events); only the members Electron lacks are replaced, each with Chromium's argument checks, promise / callback forms and errors:
//   setUninstallURL      Chromium validates the URL (its own errors), then Acira keeps it and opens it when the user removes the extension
//   openOptionsPage      options_ui / options_page in a tab (an open one is brought forward); Chrome's error when there is none
//   requestUpdateCheck   Acira updates Web Store extensions only when the user asks (Extensions page): always {status: 'no_update'}
//   getContexts          Chromium's argument checks; native and Acira's lists merged without listing the background context twice
// onUpdateAvailable never fires for the same reason (documented in docs/launch/EXTENSION_API_COVERAGE.md).
function runtimeRenderer(acira) {
  const callNative = (target, name, args) => new Promise((resolve, reject) => {
    const lastError = () => { const chrome = acira.chrome(); return chrome && chrome.runtime && chrome.runtime.lastError; };
    try { target[name](...args, result => { const error = lastError(); if (error) reject(new Error(error.message)); else resolve(result); }); }
    catch (error) { reject(error); }
  });
  return {
    runtime: {
      factory: base => {
        if (!base || typeof base !== 'object') return base;
        const built = acira.build('runtime', {
          functions: {
            setUninstallURL: url => callNative(base, 'setUninstallURL', [url]).then(() => acira.call('runtime.setUninstallURL')(url)).then(() => undefined),
            openOptionsPage: () => acira.call('runtime.openOptionsPage')().then(() => undefined),
            requestUpdateCheck: () => Promise.resolve({status: 'no_update'}),
            getContexts: filter => {
              const ask = typeof base.getContexts === 'function' ? callNative(base, 'getContexts', [filter]) : Promise.resolve([]);
              return ask.then(list => {
                const seen = new Set(), out = [];
                for (const context of Array.isArray(list) ? list : []) {
                  // One background context per extension: the native entry and Acira's own describe the same worker.
                  const key = context && (context.contextType === 'BACKGROUND' ? 'BACKGROUND' : context.contextType + '|' + context.documentUrl);
                  if (!context || seen.has(key)) continue;
                  seen.add(key); out.push(context);
                }
                return out;
              });
            }
          }
        });
        const overrides = {};
        for (const name of ['setUninstallURL', 'openOptionsPage', 'requestUpdateCheck', 'getContexts']) if (typeof built[name] === 'function') overrides[name] = built[name];

        // sender.tab of a message or connection from a content script: Electron fills id but windowId 0 and index 0 (Vimium's K / J / t read them).
        // The tabs come from the main process (runtime.cjs: tabs.get's objects) into this table, kept current while a listener exists; a listener is
        // called by the native event itself, in the same turn, with the sender corrected from the table (same return value, same sendResponse).
        const tabs = new Map(), pages = new Map();   // pages: the page id Electron puts in sender.tab.id -> the tab id chrome.tabs gave the extension (they differ for a restored tab)
        const learnPages = map => { pages.clear(); for (const key of Object.keys(map && typeof map === 'object' ? map : {})) if (Number.isInteger(map[key])) pages.set(Number(key), map[key]); };
        let feeding = false;
        const feed = () => {
          if (feeding) return;
          feeding = true;
          try {
            acira.event('runtime.tabs').addListener(update => {
              if (!update || typeof update !== 'object') return;
              if (update.pages) learnPages(update.pages);
              for (const id of Array.isArray(update.removed) ? update.removed : []) tabs.delete(id);
              for (const tab of Array.isArray(update.tabs) ? update.tabs : []) if (tab && typeof tab.id === 'number') tabs.set(tab.id, tab);
            });
            acira.call('runtime.tabPages')().then(learnPages, () => undefined);
            acira.call('runtime.tabs')().then(list => { for (const tab of Array.isArray(list) ? list : []) if (tab && typeof tab.id === 'number' && !tabs.has(tab.id)) tabs.set(tab.id, tab); }, () => undefined);
          } catch (error) { feeding = false; }
        };
        const mend = sender => {
          const known = sender && sender.tab && typeof sender.tab.id === 'number' ? (tabs.get(sender.tab.id) || tabs.get(pages.get(sender.tab.id))) : null;
          if (!known) return sender;
          const copy = {};
          for (const key of Object.keys(sender)) copy[key] = sender[key];
          copy.tab = JSON.parse(JSON.stringify(known));
          return copy;
        };
        const mendPort = port => {
          try {
            const mended = port && port.sender ? mend(port.sender) : null;
            if (mended && mended !== port.sender) Object.defineProperty(port, 'sender', {value: mended, configurable: true, enumerable: true, writable: true});
          } catch (error) { /* a port that refuses keeps the engine's sender */ }
          return port;
        };
        // Acira's own storage messages (a content script telling the service worker what changed, ext-api/storage/sync-core.cjs) carry the key
        // __acira_storage: only Acira's listener (marked __acira) sees them, never the extension's own onMessage listeners.
        const ours = args => !!(args[0] && typeof args[0] === 'object' && args[0].__acira_storage);
        const watchSenders = (nativeEvent, mendArgs, hideOurs) => {
          if (!nativeEvent || typeof nativeEvent.addListener !== 'function') return nativeEvent;
          const wrapped = new Map();
          return {
            addListener(listener, ...rest) {
              if (typeof listener !== 'function' || wrapped.has(listener)) return;
              feed();
              const native = (...args) => (hideOurs && !listener.__acira && ours(args) ? undefined : listener(...mendArgs(args)));
              wrapped.set(listener, native);
              nativeEvent.addListener(native, ...rest);
            },
            removeListener(listener) { const native = wrapped.get(listener); if (native) { wrapped.delete(listener); nativeEvent.removeListener(native); } },
            hasListener(listener) { return wrapped.has(listener); },
            hasListeners() { return wrapped.size > 0; }
          };
        };
        // runtime.onInstalled: Electron never dispatches Chromium's own; the main process sends Chrome's details (runtime.cjs) to this event instead.
        overrides.onInstalled = acira.event('runtime.onInstalled');
        overrides.onStartup = acira.event('runtime.onStartup');   // once per profile start, also for a worker that starts lazily (Electron never sends Chromium's)
        const message = args => (args.length > 1 ? [args[0], mend(args[1]), ...args.slice(2)] : args);
        const connection = args => [mendPort(args[0]), ...args.slice(1)];
        for (const [name, mendArgs, hideOurs] of [['onMessage', message, true], ['onMessageExternal', message, false], ['onConnect', connection, false], ['onConnectExternal', connection, false]])
          if (base[name] && typeof base[name].addListener === 'function') overrides[name] = watchSenders(base[name], mendArgs, hideOurs);
        return acira.extend(base, overrides);
      }
    }
  };
}

module.exports = {namespaces: ['runtime'], renderer: runtimeRenderer};
