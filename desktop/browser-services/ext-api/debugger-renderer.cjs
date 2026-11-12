'use strict';
// chrome.debugger for an extension that declares "debugger", in its pages and service worker. Acira does not let extensions debug pages, but
// the namespace has to exist: an AI assistant extension adds its chrome.debugger.onEvent listener while its scripts load, and without the namespace its service
// worker stopped at that line, so its toolbar button did nothing. Chromium's schema gives the events and the argument checks; the answers:
//   attach       refused
//   getTargets   [] (nothing an extension can attach to)
//   detach / sendCommand   Chrome's "Debugger is not attached to the tab with id: N." (or extension / target)
//   events       never fire
module.exports = {
  namespaces: ['debugger'],
  renderer(acira) {
    const notAttached = target => {
      const t = target && typeof target === 'object' ? target : {};
      const [kind, id] = t.tabId !== undefined ? ['tab', t.tabId] : t.extensionId !== undefined ? ['extension', t.extensionId] : ['target', t.targetId];
      return Promise.reject(new Error(`Debugger is not attached to the ${kind} with id: ${id}.`));
    };
    return {
      debugger: {
        factory: () => acira.build('debugger', {
          functions: {
            attach: () => Promise.reject(new Error('Acira does not let extensions debug pages.')),
            detach: target => notAttached(target),
            sendCommand: target => notAttached(target),
            getTargets: () => Promise.resolve([])
          }
        })
      }
    };
  }
};
