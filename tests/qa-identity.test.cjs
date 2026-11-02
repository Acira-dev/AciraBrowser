'use strict';
// QA installers must never share a registry-visible name with the real Acira: a QA install, update or uninstall on a PC that also has the
// real one rewrote or removed its uninstall entry, browser registration, URL associations and Start-menu shortcut (27-28 Oct). QA builds
// (`node scripts/release.mjs --qa-identity`) carry their own identity everywhere, and every installer rig refuses a real-identity setup.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const { createConfig, QA_IDENTITY } = require('../packaging/signing-config.cjs');
// the real installer's GUID: electron-builder derives it from the app id (seen on the PC as the uninstall key name)
const REAL_GUID = 'd22525d0-18d8-53f4-9ae4-17967a9ba3f1';

test('the QA build config differs from the real one in every field Windows can see', () => {
  const real = createConfig({}), qa = createConfig({ ACIRA_BUILD_IDENTITY: 'qa' });
  assert.equal(real.appId, 'computer.acira.browser');
  assert.notEqual(qa.appId, real.appId, 'app id (installer GUID, mutex, taskbar grouping)');
  assert.equal(real.executableName,'AciraBrowser');assert.equal(qa.executableName,'AciraBrowserQA','NSIS finds and terminates apps by executable name; QA must never match the real browser');
  assert.notEqual(qa.productName, real.productName, 'product name (uninstall display name, file properties)');
  assert.notEqual(qa.nsis.shortcutName, real.nsis.shortcutName, 'Start-menu shortcut');
  assert.ok(qa.nsis.guid && qa.nsis.guid !== REAL_GUID && !real.nsis.guid, 'uninstall entry key / Software\\{GUID}');
  assert.equal(qa.nsis.guid, QA_IDENTITY.guid);
  assert.notEqual(qa.nsis.include, real.nsis.include, 'its own registry names (acira-installer-qa.nsh)');
  assert.equal(qa.extraMetadata.aciraIdentity, 'qa');
  assert.notEqual(qa.extraMetadata.name, real.extraMetadata.name || require('../package.json').name, 'default install folder %LOCALAPPDATA%\\Programs\\<name>');
  assert.equal(real.nsis.artifactName, 'AciraBrowserSetup.${ext}'); assert.equal(real.win.artifactName, 'AciraBrowser-portable.${ext}');
  assert.equal(qa.nsis.artifactName, 'AciraBrowserQASetup.${ext}'); assert.equal(qa.win.artifactName, 'AciraBrowserQA-portable.${ext}');
  assert.equal(real.extraMetadata.aciraIdentity, undefined);
  // a signed QA build keeps its QA names
  const signedQa = createConfig({ ACIRA_BUILD_IDENTITY: 'qa', ACIRA_SIGN_COMMAND: 'x', ACIRA_PUBLISHER_NAME: 'y' });
  assert.equal(signedQa.nsis.artifactName, 'AciraBrowserQASetup.${ext}'); assert.equal(signedQa.win.artifactName, 'AciraBrowserQA-portable.${ext}');
});

test('the installer script writes and removes only the names of its own identity', () => {
  const nsh = read('packaging', 'acira-installer.nsh'), qaNsh = read('packaging', 'acira-installer-qa.nsh');
  assert.match(qaNsh, /^!define ACIRA_QA\s*$/m); assert.match(qaNsh, /^!include "acira-installer\.nsh"\s*$/m);
  const block = nsh.slice(nsh.indexOf('!ifdef ACIRA_QA'), nsh.indexOf('!endif', nsh.indexOf('!ifdef ACIRA_QA')) + 6);
  const [qaPart, realPart] = block.split('!else');
  const names = part => Object.fromEntries([...part.matchAll(/!define (AC_\w+) "([^"]+)"/g)].map(m => [m[1], m[2]]));
  const q = names(qaPart), r = names(realPart);
  assert.deepEqual(Object.keys(q).sort(), ['AC_APP_EXE', 'AC_DATA_DIR', 'AC_PROGID', 'AC_REG_APP', 'AC_REG_KEY']);
  assert.deepEqual(Object.keys(r).sort(), Object.keys(q).sort());
  for (const key of Object.keys(q)) assert.notEqual(q[key], r[key], key);
  assert.equal(r.AC_REG_KEY, 'Software\\AciraBrowser'); assert.equal(r.AC_PROGID, 'AciraBrowser.Url'); assert.equal(r.AC_REG_APP, 'Acira Browser');
  // outside the define block no registry write or delete names an identity literally
  const rest = nsh.replace(block, '');
  for (const line of rest.split(/\r?\n/).filter(l => /^\s*(WriteRegStr|DeleteRegKey|DeleteRegValue|ReadRegStr|RMDir)\b/.test(l) && !/UNINSTALL_REGISTRY_KEY/.test(l))) {
    assert.doesNotMatch(line, /AciraBrowser(?!\.exe)|"Acira Browser"/, `identity literal in: ${line.trim()}`);
  }
});

test('a QA app never opens the real profile, never registers as the real Acira and never updates itself', () => {
  const identity = read('desktop', 'build-identity.cjs');
  assert.match(identity, /dataFolder: qa \? 'AciraBrowserQA' : 'AciraBrowser'/);
  assert.match(identity, /appUserModelId: qa \? 'computer\.acira\.browser\.qa' : 'computer\.acira\.browser'/);
  assert.match(identity, /registeredApplication: qa \? 'Acira Browser QA' : 'Acira Browser'/);
  const main = read('desktop', 'main.cjs');
  assert.match(main, /app\.setAppUserModelId\(buildIdentity\.appUserModelId\)/);
  assert.match(main, /path\.join\(app\.getPath\('appData'\),buildIdentity\.dataFolder\)/);
  assert.doesNotMatch(main, /setAppUserModelId\('computer\.acira\.browser'\)/);
  assert.match(read('desktop', 'accounts', 'default-browser.cjs'), /REGISTERED_APPLICATION = require\("\.\.\/build-identity\.cjs"\)\.registeredApplication/);
  assert.match(read('desktop', 'browser-services', 'app-updater.cjs'), /qaBuild&&!env\.ACIRA_UPDATE_TEST\?'Updates are off in QA builds\.'/);
  // the branded remover deletes the data folder of the build installed there, read before the files are removed
  const remover = read('packaging', 'installer', 'AciraUninstall.cs');
  assert.match(remover, /== "Acira Browser QA"\) return "AciraBrowserQA";/);
  assert.match(remover, /dataName = DataFolder\(dir\);/);
});

test('release.mjs builds the QA identity on --qa-identity and never publishes it', () => {
  const release = read('scripts', 'release.mjs');
  assert.match(release, /const qaIdentity = flag\('--qa-identity'\);/);
  assert.match(release, /if \(publish && qaIdentity\) fail\(/);
  assert.match(release, /ACIRA_BUILD_IDENTITY: qaIdentity \? 'qa' : ''/);
});

test('every installer rig refuses a real-identity setup and checks the registry outside the QA identity before and after', () => {
  const guard = read('qa', 'installer-identity.ps1');
  assert.ok(guard.includes(`$script:AciraQaGuid = '${QA_IDENTITY.guid}'`), 'the guard knows the QA GUID');
  assert.match(guard, /\$env:ACIRA_QA_REAL_IDENTITY -eq '1'/);
  for (const area of ['CurrentVersion\\Uninstall', 'Clients\\StartMenuInternet', "PSChildName -like 'Acira*'", 'UrlAssociations', 'RegisteredApplications', "GetFolderPath('StartMenu')"]) assert.ok(guard.includes(area), area);
  for (const rig of [['qa', 'r3-packaged.ps1'], ['qa', 'coord-packaged.ps1'], ['qa', 'installer-e2e', 'run-setup.ps1']]) {
    const source = read(...rig), name = rig.join('/');
    assert.match(source, /installer-identity\.ps1/, `${name} loads the guard`);
    assert.match(source, /Assert-AciraQaInstaller \$\w+/, `${name} refuses a real-identity installer`);
    assert.match(source, /Get-AciraRegistrySnapshot/, `${name} snapshots before`);
    assert.match(source, /Assert-AciraRealIdentityUnchanged/, `${name} checks after`);
    // the checks themselves use the identity's names, never the real ones literally
    assert.doesNotMatch(source, /'HKCU:\\Software\\AciraBrowser'|Classes\\AciraBrowser\.Url|-Name 'Acira Browser'|'Software\\AciraBrowser\\Capabilities'|'Acira Browser\.lnk'/, `${name} checks a real-identity name`);
  }
  // any rig in qa/ that starts a setup or an uninstaller goes through the guard
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'artifacts' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
  for (const file of walk(path.join(root, 'qa')).filter(f => /\.(ps1|mjs|cjs)$/.test(f))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/Start-Process[^\n]*(\$installerPath|\$setupPath|\$uninstallers)/.test(source)) assert.match(source, /installer-identity\.ps1/, `${path.relative(root, file)} runs an installer without the identity guard`);
  }
});
