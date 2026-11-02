'use strict';
// Test package (tests/extension-ext-api-loader.test.cjs): main side of chrome.tabGroups.get / chrome.storage.
module.exports = {
  namespaces: ['tabGroups'],
  install(api) {
    const forgotten = [];
    api.handle('tabGroups.get', (event, groupId) => {
      if (groupId === 404) throw new Error(`No group with id: ${groupId}.`);
      return {id: groupId, collapsed: false, color: 'blue', title: 'Demo', windowId: 1};
    });
    api.wrap('tabs.query', original => (event, info) => [{id: 99, wrapped: true}, ...(original ? original(event, info) : [])]);
    api.handle('demo.ping', event => {
      api.emit(event.extension.id, 'tabGroups.onCreated', {id: 7});
      return 'pong';
    });
    return {forget(id) { forgotten.push(id); module.exports.forgotten = forgotten; }};
  }
};
