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
          // The previous implementation of a member. A Manifest V3 page asks the engine for its promise form: the engine reports a failure there
          // ("Could not establish connection. Receiving end does not exist." when the tab has no listener, "No tab with id") as a rejection, while
          // chrome.runtime.lastError in this script never sees an engine failure (the engine sets it where this page does not read it, and logs
          // "Unchecked runtime.lastError"), so the callback form below resolved with undefined: YouTube Inline Fullscreen's popup asks
          // tabs.sendMessage whether its content script is there, took undefined for yes and never injected it. A Manifest V2 page has no
          // promise form, so it keeps the callback form and reads lastError.
          const promiseForm = () => { try { const manifest = acira.chrome() && acira.chrome().runtime && acira.chrome().runtime.getManifest && acira.chrome().runtime.getManifest(); return !!manifest && manifest.manifest_version >= 3; } catch (error) { return false; } };
          const previous = (name, args) => new Promise((resolve, reject) => {
            const original = base && base[name];
            if (typeof original !== 'function') { reject(new Error(acira.errors.accessDenied())); return; }
            if (promiseForm()) {
              try { const result = original.call(base, ...args); if (result && typeof result.then === 'function') result.then(resolve, reject); else resolve(result); }
              catch (error) { reject(error); }
              return;
            }
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
          functions.getZoomSettings = tabId => pageIdOf(tabId).then(page => previous('getZoomSettings', optional(page === null ? tabId : page)));
          functions.setZoomSettings = (tabId, settings) => pageIdOf(tabId).then(page => previous('setZoomSettings', [...optional(page === null ? tabId : page), settings]));
          // tabs.connect hands back its port at once, but the page behind the tab id is known only after one question to the main process: the port the extension holds waits for
          // the real one (messages posted meanwhile are kept in order), then passes messages and the disconnect on. An id with no page (or a failed connect) disconnects the port
          // with Chrome's own "Receiving end does not exist" error.
          if (base && typeof base.connect === 'function') functions.connect = (tabId, info) => {
            const onMessage = acira.bindings.createEvent('runtime.Port.onMessage'), onDisconnect = acira.bindings.createEvent('runtime.Port.onDisconnect');
            const waiting = [];
            let real = null, ended = false;
            const port = {
              name: (info && info.name) || '',
              postMessage(message) {
                if (ended) throw new Error('Attempting to use a disconnected port object');
                if (real) real.postMessage(message); else waiting.push(message);
              },
              disconnect() { if (ended) return; ended = true; waiting.length = 0; if (real) real.disconnect(); },
              onMessage, onDisconnect
            };
            const refuse = text => { if (ended) return; ended = true; waiting.length = 0; acira.withLastError(text, () => onDisconnect.dispatch(port)); };
            pageIdOf(tabId).then(page => {
              if (ended) return;
              try { real = base.connect(page === null ? tabId : page, ...optional(info)); } catch (error) { refuse(String(error && error.message || error)); return; }
              if (real && real.onMessage) real.onMessage.addListener(message => onMessage.dispatch(message, port));
              if (real && real.onDisconnect) real.onDisconnect.addListener(() => { if (ended) return; ended = true; onDisconnect.dispatch(port); });
              for (const message of waiting.splice(0)) real.postMessage(message);
            }, error => refuse(String(error && error.message || error)));
            return port;
          };
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
