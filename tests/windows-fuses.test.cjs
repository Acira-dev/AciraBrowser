'use strict';
// Windows builds used to ship Electron's default fuses (ELECTRON_RUN_AS_NODE and NODE_OPTIONS usable by anything that starts the exe,
// cookies unencrypted on disk) while Mac flipped them. packaging/fuses.cjs is the one list: Mac ships SHIPPED, Windows ships WINDOWS
// (SHIPPED minus the asar checks and the --inspect fuse, for the reasons written there). These tests pin the sets, that both Windows build
// paths burn and read them back, and that the read-back really reads a program's wire (on a copy of this machine's Electron).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { SHIPPED, WINDOWS, ENUM, forPlatform, readFuses, fuseProblems, burnFuses } = require('../packaging/fuses.cjs');
const { createConfig } = require('../packaging/signing-config.cjs');
const { FUSES: MAC } = require('../packaging/macos/widevine.cjs');
const { FuseV1Options } = require('@electron/fuses');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the Mac set is exactly the one the Mac packager burns, and every name maps to a real fuse', () => {
  for (const [name, key] of Object.entries(ENUM)) assert.equal(typeof FuseV1Options[key], 'number', `${name} -> ${key}`);
  assert.deepEqual(Object.keys(SHIPPED).sort(), Object.keys(ENUM).sort());
  assert.deepEqual(Object.keys(MAC).map(Number).sort(), Object.values(ENUM).map(key => FuseV1Options[key]).sort(), 'the Mac packager sets the same fuses');
  for (const [name, key] of Object.entries(ENUM)) assert.equal(MAC[FuseV1Options[key]], SHIPPED[name], `Mac packager and fuses.cjs disagree on ${name}`);
  assert.equal(forPlatform('darwin'), SHIPPED);
});

test('Windows ships RunAsNode and NODE_OPTIONS off and cookie encryption on; it differs from Mac only in the three fuses fuses.cjs explains', () => {
  assert.equal(WINDOWS.runAsNode, false); assert.equal(WINDOWS.enableNodeOptionsEnvironmentVariable, false); assert.equal(WINDOWS.enableCookieEncryption, true);
  assert.deepEqual(Object.keys(WINDOWS).filter(name => WINDOWS[name] !== SHIPPED[name]).sort(), ['enableEmbeddedAsarIntegrityValidation', 'enableNodeCliInspectArguments', 'onlyLoadAppFromAsar']);
  assert.equal(forPlatform('win32'), WINDOWS);
});

test('both Windows build paths burn the Windows set and read it back from the built program', () => {
  assert.deepEqual(createConfig({}).electronFuses, WINDOWS, 'scripts/release.mjs (electron-builder)');
  assert.deepEqual(createConfig({ ACIRA_BUILD_IDENTITY: 'qa' }).electronFuses, WINDOWS, 'the QA twin too');
  const pack = read('scripts/release-package.mjs');
  const burn = pack.indexOf("burnFuses(path.join(output,'AciraBrowser.exe'),WINDOWS_FUSES)");
  assert.ok(burn > pack.indexOf('applyWindowsResources(path.join(output'), 'npm run build:windows burns the fuses after the resource editor');
  assert.ok(burn < pack.indexOf("'FILES-SHA256.json'"), 'and before the payload is hashed, so the installer carries that program');
  assert.match(pack, /'packaging\/fuses\.cjs'/, 'fuses.cjs is a recorded packaging input');
  assert.match(pack, /windowsResources,electronFuses,packagingInputs/, 'the burned set is in ACIRA-PROVENANCE.json');
  assert.match(read('qa/release-package-launch.mjs'), /fuseProblems\(executable,WINDOWS_FUSES\)/, 'native qualification reads them back from the packaged exe');
  assert.match(read('scripts/release.mjs'), /fuseProblems\(exe, WINDOWS\)/, 'the electron-builder path reads them back from win-unpacked');
});

// A copy of this machine's Electron program (the fuse wire is in Electron.exe on Windows, in the framework binary on Mac). A clone
// on APFS, a plain copy elsewhere; never the installed runtime itself.
function electronProgram() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  const file = process.platform === 'win32' ? path.join(dist, 'electron.exe') : process.platform === 'darwin' ? path.join(dist, 'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework') : path.join(dist, 'electron');
  return fs.existsSync(file) ? file : null;
}
test('the read-back reads a real program: Electron\'s defaults fail the check, the burned Windows and Mac sets pass it', { skip: !electronProgram() && 'no Electron runtime' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-fuses-')), copy = path.join(dir, process.platform === 'win32' ? 'AciraBrowser.exe' : 'program');
  try {
    fs.copyFileSync(electronProgram(), copy, fs.constants.COPYFILE_FICLONE);
    const before = await readFuses(copy);
    for (const name of Object.keys(ENUM)) assert.equal(typeof before[name], 'boolean', name);
    const wrong = await fuseProblems(copy, WINDOWS);
    assert.ok(wrong.some(p => p.fuse === 'runAsNode' && p.actual === true), 'a stock program has RunAsNode on: ' + JSON.stringify(wrong));
    assert.deepEqual(await burnFuses(copy, WINDOWS), WINDOWS);
    assert.deepEqual(await fuseProblems(copy, WINDOWS), []);
    assert.deepEqual(await burnFuses(copy, SHIPPED), SHIPPED);
    assert.deepEqual((await fuseProblems(copy, WINDOWS)).map(p => p.fuse).sort(), ['enableEmbeddedAsarIntegrityValidation', 'enableNodeCliInspectArguments', 'onlyLoadAppFromAsar']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Windows qualification checks that sign-ins survive the cookie encryption fuse, with stock Electron writing first', () => {
  // Nothing automated used to prove it: the cookie rigs run on stock, unfused Electron. qa/release-package-launch.mjs (run by build:windows on the
  // Windows laptop) now has stock Electron write a cookie as beta.9 did, the fused program read it and write its own, and a relaunch read both.
  const launch = read('qa/release-package-launch.mjs'), helper = read('qa/release-fused-cookies.mjs'), host = read('qa/release-fused-cookie-host.cjs');
  assert.match(launch, /import \{checkFusedCookies\} from '\.\/release-fused-cookies\.mjs';/);
  const call = launch.indexOf('report.fusedCookies=await checkFusedCookies({launch:()=>_electron.launch({executablePath:executable,');
  assert.ok(call > 0 && call < launch.indexOf("report.status='PASS'"), 'the check runs on the packaged program before the rig passes');
  assert.ok(helper.indexOf('spawn(stockElectron') > 0 && helper.indexOf('spawn(stockElectron') < helper.indexOf('await launch()'), 'stock Electron writes first: the other way round it would drop rows it cannot decrypt');
  for (const check of ["'the fused program reads a cookie stock Electron wrote: '", "is still there after a relaunch", "'the fused program writes cookies encrypted'", "'the stock cookie was a plain row'"]) assert.ok(helper.includes(check), check);
  assert.match(host, /session\.fromPartition\(partition\)/); assert.match(host, /flushStore\(\)/);
  const fuses = read('packaging/fuses.cjs');
  assert.match(fuses, /`npm run build:windows` makes[\s\S]*resources\\app folder/, 'only the build:windows package is a resources\\app folder');
  assert.match(fuses, /scripts\/release\.mjs through electron-builder, does ship an app\.asar/);
});
