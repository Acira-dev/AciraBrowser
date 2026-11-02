'use strict';
// chrome.history, extension side (package P7): today's object (search / getVisits and the older answers) with real onVisited / onVisitRemoved.
// Copied into the preload as text: it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['history'],
  renderer(acira) {
    return {
      history: {
        factory: base => acira.extend(base, {
          onVisited: acira.event('history.onVisited'),
          onVisitRemoved: acira.event('history.onVisitRemoved')
        })
      }
    };
  }
};
