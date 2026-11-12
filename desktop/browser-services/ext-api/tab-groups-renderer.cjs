'use strict';
// chrome.tabGroups for an extension that declares "tabGroups", in its pages and service worker. Acira does not show its tab groups to
// extensions yet, but the namespace has to exist: an AI assistant extension reads chrome.tabGroups.Color while its scripts load, and without the namespace its
// service worker and side panel stopped at that line, so its toolbar button did nothing. Chromium's schema gives the Color enum,
// TAB_GROUP_ID_NONE, the events and the argument checks; the answers say plainly that there is nothing to see or change:
//   query        [] (no groups)
//   get          "No group with id: N."
//   update/move  refused
//   events       never fire
module.exports = {
  namespaces: ['tabGroups'],
  renderer(acira) {
    const refuse = () => Promise.reject(new Error('Acira does not let extensions change tab groups.'));
    return {
      tabGroups: {
        factory: () => acira.build('tabGroups', {
          functions: {
            get: groupId => Promise.reject(new Error(`No group with id: ${groupId}.`)),
            query: () => Promise.resolve([]),
            update: refuse,
            move: refuse
          }
        })
      }
    };
  }
};
