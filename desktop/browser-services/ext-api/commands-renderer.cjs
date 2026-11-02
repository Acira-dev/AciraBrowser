'use strict';
// chrome.commands in extension pages and service workers (work package P8). The function below is copied into the preload as text:
// it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['commands'],
  renderer(acira) {
    return {
      commands: {
        factory: () => acira.build('commands', {
          functions: {getAll: acira.call('commands.getAll')},
          events: {onCommand: acira.event('commands.onCommand')}
        })
      }
    };
  }
};
