'use strict';
// Acira's own version. app.getVersion() answers with Electron's version when the app runs from source, so anything that reports a version reads it here.
module.exports = { version: String(require('../../package.json').version) };
