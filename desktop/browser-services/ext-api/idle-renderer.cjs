'use strict';
// chrome.idle (P9), extension pages and workers: Chromium's schema (IdleState, the 15 s minimum, promise and callback forms) over Acira's main side.
module.exports = {
  namespaces: ['idle'],
  renderer(acira) {
    return {
      idle: {
        factory: () => acira.build('idle', {
          functions: {
            queryState: seconds => acira.call('idle.queryState')(seconds),
            setDetectionInterval: seconds => acira.call('idle.setDetectionInterval')(seconds).then(() => undefined)
          },
          events: {onStateChanged: acira.event('idle.onStateChanged')}
        })
      }
    };
  }
};
