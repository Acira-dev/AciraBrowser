'use strict';
// chrome.sidePanel (P9), extension pages and workers: Chromium's schema (Side, argument checks, promise and callback forms) over the main side.
// open() carries the page's user activation to the main process (Chrome checks the gesture in the browser process from the renderer's flag).
module.exports = {
  namespaces: ['sidePanel'],
  renderer(acira) {
    const call = name => acira.call(name);
    return {
      sidePanel: {
        factory: () => acira.build('sidePanel', {
          functions: {
            setOptions: options => call('sidePanel.setOptions')(options).then(() => undefined),
            getOptions: options => call('sidePanel.getOptions')(options),
            setPanelBehavior: behavior => call('sidePanel.setPanelBehavior')(behavior).then(() => undefined),
            getPanelBehavior: () => call('sidePanel.getPanelBehavior')(),
            getLayout: () => call('sidePanel.getLayout')(),
            open: options => {
              let gesture = false;
              try { gesture = !acira.isWorker && !!(navigator.userActivation && navigator.userActivation.isActive); } catch (e) { gesture = false; }
              return call('sidePanel.open')(options, gesture).then(() => undefined);
            },
            close: options => call('sidePanel.close')(options).then(() => undefined)
          },
          events: {onOpened: acira.event('sidePanel.onOpened'), onClosed: acira.event('sidePanel.onClosed')}
        })
      }
    };
  }
};
