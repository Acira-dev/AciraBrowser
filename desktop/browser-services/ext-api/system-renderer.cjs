'use strict';
// chrome.system.display (P9), extension pages and workers: Chromium's schema over Acira's main side (system.cjs). The layout-changing
// members stay Chromium's default answer: they are ChromeOS-only in Chrome too.
module.exports = {
  namespaces: ['system.display'],
  renderer(acira) {
    return {
      'system.display': {
        factory: () => acira.build('system.display', {
          functions: {
            getInfo: flags => acira.call('system.display.getInfo')(flags),
            getDisplayLayout: () => acira.call('system.display.getDisplayLayout')()
          },
          events: {onDisplayChanged: acira.event('system.display.onDisplayChanged')}
        })
      }
    };
  }
};
