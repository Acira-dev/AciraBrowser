'use strict';
// chrome.extension (main process half): the engine and Chromium answer the rest of the namespace (ext-api/extension-renderer.cjs builds it in the extension's own page and worker).
// One Acira-internal handler lives here: 'acira.file.read', which gives an extension page the bytes of a local file when its "Allow access to file URLs" switch is on and for no other
// extension (the reasons and the limits are in ext-api/extension/file-read.cjs; the page side is in extension-renderer.cjs). It has no namespace of Chromium's, so the engine does not
// gate it by permission: the extension's own switch is the gate.
const {readFileFor} = require('./extension/file-read.cjs');

module.exports = {
  namespaces: ['extension'],
  install(api) {
    api.handle('acira.file.read', (event, address, range) => readFileFor({ allowed: () => !!event.extension && api.fileAccessAllowed(event.extension.id), address, range }), { check: false });
    return {};
  }
};
