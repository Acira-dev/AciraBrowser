'use strict';
// Which installed identity this build carries. Release builds are the real Acira. QA candidates (node scripts/release.mjs --qa-identity)
// are "Acira Browser QA": every name Windows can see differs (app id, product, Start-menu shortcut, uninstall entry, browser registration,
// URL ProgID, default install folder, data folder, taskbar id), so a QA install, update or uninstall can never touch the real Acira on the
// same PC, and a QA app started by Explorer never opens the real profile. The packaged package.json carries `aciraIdentity: "qa"`
// (packaging/signing-config.cjs); a development run reads the repository's package.json, which has none.
let pkg = {};
try { pkg = require('../package.json'); } catch {}
const qa = pkg.aciraIdentity === 'qa';
const real = {
  qa,
  dataFolder: qa ? 'AciraBrowserQA' : 'AciraBrowser',
  appUserModelId: qa ? 'computer.acira.browser.qa' : 'computer.acira.browser',
  registeredApplication: qa ? 'Acira Browser QA' : 'Acira Browser',
  progId: qa ? 'AciraBrowserQA.Url' : 'AciraBrowser.Url',
};
// A TEST app (a hand-made copy of a branch for one person to try: packaged `aciraIdentity: "test"` with its own `productName`, scripts/make-test-app.mjs of the dev repo) has its own name, its own data folder and its own
// registrations, so it can sit next to the real Acira on one computer and never touch its profile; on a Mac it also uses Chromium's mock keychain (main.cjs), so it never asks for the person's Keychain.
const named = typeof pkg.productName === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,58}[A-Za-z0-9]$/.test(pkg.productName) && pkg.productName !== 'Acira Browser';
const test = pkg.aciraIdentity === 'test' && named;
module.exports = Object.freeze(test
  ? { ...real, qa: false, test: true, appName: pkg.productName, dataFolder: pkg.productName, appUserModelId: 'computer.acira.browser.test', registeredApplication: pkg.productName, progId: pkg.productName.replace(/[^A-Za-z0-9]/g, '') + '.Url' }
  : { ...real, test: false, appName: 'Acira Browser' });
