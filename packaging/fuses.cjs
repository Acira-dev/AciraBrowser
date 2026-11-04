'use strict';
// The Electron fuses Acira ships. A fuse is a switch burned into the program file that no setting, environment variable or command
// line can flip back. Mac builds ship SHIPPED (packaging/macos/widevine.cjs FUSES; tests/windows-fuses.test.cjs keeps the two equal).
// Windows builds used to ship Electron's defaults, which leave ELECTRON_RUN_AS_NODE and NODE_OPTIONS working: anything that could
// start AciraBrowser.exe could run its own script inside it. They now ship WINDOWS, which is SHIPPED except three fuses, for now:
//   enableEmbeddedAsarIntegrityValidation, onlyLoadAppFromAsar: the package `npm run build:windows` makes (scripts/build-windows.mjs,
//     scripts/release-package.mjs) carries the app as a resources\app folder, not an app.asar. With these on, that program would refuse
//     to load it. The other Windows path, scripts/release.mjs through electron-builder, does ship an app.asar (packaging/electron-builder.json
//     "asar": true) and burns this same set (packaging/signing-config.cjs), so the two paths stay alike. Turning them on needs the
//     build:windows package to move to an asar first (and its qualification, installer payload check and differential updates with it).
//   enableNodeCliInspectArguments: the Windows qualification rigs that build-windows.mjs runs (qa/release-package-launch.mjs and the
//     others) drive the exact packaged program through Playwright, which attaches with --inspect. Turning it off needs those rigs to
//     drive a copy with only this fuse flipped back on, and the payload check to allow that one difference.
//   enableCookieEncryption is on, as on Mac: sign-ins are kept encrypted on disk with the Windows account key (DPAPI), the key that
//   desktop/browser-services/encryption-bootstrap.cjs commits before any website session. Cookies saved by an earlier build stay
//   readable (Chromium reads a plain row as before). Turning it off again later would lose the encrypted ones.
const SHIPPED = Object.freeze({
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  grantFileProtocolExtraPrivileges: true,
});
const WINDOWS = Object.freeze({ ...SHIPPED, enableEmbeddedAsarIntegrityValidation: false, onlyLoadAppFromAsar: false, enableNodeCliInspectArguments: true });
// electron-builder's name -> @electron/fuses option name
const ENUM = Object.freeze({
  runAsNode: 'RunAsNode',
  enableCookieEncryption: 'EnableCookieEncryption',
  enableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable',
  enableNodeCliInspectArguments: 'EnableNodeCliInspectArguments',
  enableEmbeddedAsarIntegrityValidation: 'EnableEmbeddedAsarIntegrityValidation',
  onlyLoadAppFromAsar: 'OnlyLoadAppFromAsar',
  loadBrowserProcessSpecificV8Snapshot: 'LoadBrowserProcessSpecificV8Snapshot',
  grantFileProtocolExtraPrivileges: 'GrantFileProtocolExtraPrivileges',
});
const forPlatform = platform => platform === 'win32' ? WINDOWS : SHIPPED;
/** The fuse wire burned into a program (an .exe, or a Mac .app bundle): {name: true|false} for every fuse in ENUM (null: not in this Electron). */
async function readFuses(program) {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const wire = await getCurrentFuseWire(program), out = {};
  for (const [name, key] of Object.entries(ENUM)) { const value = wire[FuseV1Options[key]]; out[name] = value === 49 ? true : value === 48 ? false : null; }
  return out;
}
/** Differences between a program's fuses and the set it must ship: [{fuse, expected, actual}], empty when the build is as intended. */
async function fuseProblems(program, expected) {
  const have = await readFuses(program);
  return Object.keys(expected).filter(name => have[name] !== expected[name]).map(fuse => ({ fuse, expected: expected[fuse], actual: have[fuse] }));
}
const describe = problems => problems.map(p => `${p.fuse} is ${p.actual === null ? 'missing' : p.actual ? 'on' : 'off'}, must be ${p.expected ? 'on' : 'off'}`).join('; ');
/** Burns `set` into the program and reads it back; throws when the program does not carry exactly that set afterwards. */
async function burnFuses(program, set) {
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const config = { version: FuseVersion.V1 };
  for (const [name, value] of Object.entries(set)) config[FuseV1Options[ENUM[name]]] = value;
  await flipFuses(program, config);
  const problems = await fuseProblems(program, set);
  if (problems.length) throw new Error('The Electron fuses did not take: ' + describe(problems));
  return readFuses(program);
}
module.exports = { SHIPPED, WINDOWS, ENUM, forPlatform, readFuses, fuseProblems, describe, burnFuses };
