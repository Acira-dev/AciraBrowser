'use strict';
// Test package (tests/extension-ext-api-loader.test.cjs): a renderer-only package that takes over chrome.storage and keeps the engine's
// object for everything it does not change (acira.extend).
module.exports = {
  namespaces: ['storage'],
  renderer: function (acira) {
    return {storage: {factory: base => acira.extend(base, {aciraOwned: true})}};
  }
};
