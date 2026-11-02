'use strict';
// Which installed identity this build carries. Release builds are the real Acira. QA candidates (node scripts/release.mjs --qa-identity)
// are "Acira Browser QA": every name Windows can see differs (app id, product, Start-menu shortcut, uninstall entry, browser registration,
// URL ProgID, default install folder, data folder, taskbar id), so a QA install, update or uninstall can never touch the real Acira on the
// same PC, and a QA app started by Explorer never opens the real profile. The packaged package.json carries `aciraIdentity: "qa"`
// (packaging/signing-config.cjs); a development run reads the repository's package.json, which has none.
let pkg = {};
try { pkg = require('../package.json'); } catch {}
const qa = pkg.aciraIdentity === 'qa';
module.exports = Object.freeze({
  qa,
  dataFolder: qa ? 'AciraBrowserQA' : 'AciraBrowser',
  appUserModelId: qa ? 'computer.acira.browser.qa' : 'computer.acira.browser',
  registeredApplication: qa ? 'Acira Browser QA' : 'Acira Browser',
  progId: qa ? 'AciraBrowserQA.Url' : 'AciraBrowser.Url',
});
