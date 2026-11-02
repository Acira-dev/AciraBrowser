'use strict';
// Test package (tests/extension-ext-api-loader.test.cjs): chrome.tabGroups built on Chromium's schema; written as a method shorthand on
// purpose (the loader must turn it into an expression).
module.exports = {
  namespaces: ['tabGroups'],
  renderer(acira) {
    return {
      tabGroups: {
        factory: base => acira.build('tabGroups', {
          functions: {get: acira.call('tabGroups.get')},
          events: {onCreated: acira.event('tabGroups.onCreated')},
          properties: {aciraBase: base === undefined ? 'none' : 'some'}
        })
      }
    };
  }
};
