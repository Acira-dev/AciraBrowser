'use strict';
// acira-verify.exe: Acira's own Windows helper (packaging/installer/AciraVerify.cs, desktop/windows-helper.cjs). The Mac cannot compile or
// run it, so this checks the spawn protocol, what the C# answers against what the gate expects, the WinRT interface ids, C# 5 limits,
// and that both Windows build paths compile, sign and ship it.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { HELPER, helperPath, windowHandle, runHelper } = require('../desktop/windows-helper.cjs');
const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const source = read('packaging', 'installer', 'AciraVerify.cs');

function fakeExec(answer) {
  const calls = [];
  const exec = (file, args, options, callback) => {
    const call = { file, args, options, input: null, inputEncoding: null }; calls.push(call);
    setImmediate(() => typeof answer === 'function' ? answer(callback, call) : callback(null, answer));
    return { stdin: { on() {}, end(text, encoding) { call.input = text; call.inputEncoding = encoding; } } };
  };
  return { calls, exec };
}

test('the helper is the packaged app\'s resources/acira-verify.exe, or the build output in a checkout; never a PATH lookup', () => {
  assert.equal(HELPER, 'acira-verify.exe');
  assert.equal(helperPath({ packaged: true, resourcesPath: path.join('C:', 'Acira', 'resources') }), path.join('C:', 'Acira', 'resources', 'acira-verify.exe'));
  assert.equal(helperPath({ packaged: false, appPath: path.join('C:', 'src', 'acira') }), path.join('C:', 'src', 'acira', 'packaging', 'installer', 'acira-verify.exe'));
  assert.equal(helperPath({ packaged: true, resourcesPath: '' }), null);
  assert.equal(helperPath({ packaged: false, appPath: '' }), null, 'plain Node (tests): no app, no helper');
  for (const value of [helperPath({ packaged: true, resourcesPath: '/r' }), helperPath({ packaged: false, appPath: '/a' })]) assert.ok(path.isAbsolute(value));
});

test('a job: arguments as given, input on standard input in UTF-8, hidden, nothing added to the environment', async () => {
  const { calls, exec } = fakeExec('result:Verified\r\n');
  const env = { SystemRoot: 'C:\\Windows' };
  assert.deepEqual(await runHelper(['hello', '1234'], 'Öffne deine Tor-Elemente in Acira', { exec, helper: 'C:\\A\\resources\\acira-verify.exe', env, timeoutMs: 5000 }), { stdout: 'result:Verified' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'C:\\A\\resources\\acira-verify.exe');
  assert.deepEqual(calls[0].args, ['hello', '1234']);
  assert.equal(calls[0].input, 'Öffne deine Tor-Elemente in Acira'); assert.equal(calls[0].inputEncoding, 'utf8');
  assert.equal(calls[0].options.windowsHide, true); assert.equal(calls[0].options.timeout, 5000);
  assert.equal(calls[0].options.env, env, 'the environment is passed through untouched');
  assert.equal(calls[0].options.shell, undefined, 'no shell');
});

test('a helper that runs too long, cannot start, is missing or throws is never an answer', async () => {
  assert.deepEqual(await runHelper(['hello', '0'], 'm', { helper: 'x.exe', exec: fakeExec((cb) => cb(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), '')).exec }), { code: 'timeout', stdout: '' });
  assert.deepEqual(await runHelper(['hello', '0'], 'm', { helper: 'x.exe', exec: fakeExec((cb) => cb(Object.assign(new Error('spawn x.exe ENOENT'), { code: 'ENOENT', syscall: 'spawn x.exe' }), '')).exec }), { code: 'failed', stdout: '' });
  assert.deepEqual(await runHelper(['hello', '0'], 'm', { helper: 'x.exe', exec: fakeExec((cb) => cb(Object.assign(new Error('blocked'), { code: 'EACCES', syscall: 'spawn x.exe' }), '')).exec }), { code: 'failed', stdout: '' });
  assert.deepEqual(await runHelper(['hello', '0'], 'm', { helper: null, exec: () => assert.fail('nothing to start') }), { code: 'failed', stdout: '' });
  assert.deepEqual(await runHelper(['hello', '0'], 'm', { helper: 'x.exe', exec: () => { throw new Error('spawn failed'); } }), { code: 'failed', stdout: '' });
  // a helper that exited with an error code still reports what it wrote (icon: nothing; hello: "error")
  assert.deepEqual(await runHelper(['icon'], 'C:\\x.exe', { helper: 'x.exe', exec: fakeExec((cb) => cb(Object.assign(new Error('exit 1'), { code: 1 }), '')).exec }), { stdout: '' });
  // writing the input to a helper that already exited does not throw
  const closed = (file, args, options, callback) => { setImmediate(() => callback(null, 'error')); return { stdin: { on() {}, end() { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); } } }; };
  assert.deepEqual(await runHelper(['hello', '0'], 'm', { helper: 'x.exe', exec: closed }), { stdout: 'error' });
});

test('the Acira window travels as its HWND in decimal ("0" for none)', () => {
  const win = (bytes, destroyed = false) => ({ isDestroyed: () => destroyed, getNativeWindowHandle: () => bytes });
  const x64 = Buffer.alloc(8); x64.writeBigUInt64LE(0x0003_04b2n);
  const x86 = Buffer.alloc(4); x86.writeUInt32LE(0x0001_0a2c);
  assert.equal(windowHandle(win(x64)), String(0x304b2));
  assert.equal(windowHandle(win(x86)), String(0x10a2c));
  const extended = Buffer.alloc(8); extended.writeBigUInt64LE(0xffff_ffff_8000_1234n);
  assert.equal(windowHandle(win(extended)), String(0x8000_1234), 'a sign-extended handle travels as its 32 bits');
  assert.equal(windowHandle(win(x64, true)), '0');
  assert.equal(windowHandle(null), '0');
  assert.equal(windowHandle({ isDestroyed: () => false, getNativeWindowHandle: () => { throw new Error('gone'); } }), '0');
  assert.match(windowHandle(win(x64)), /^\d+$/, 'a plain number: nothing the helper could read as a switch or a command');
});

// The WinRT type system's id for a parameterized interface: SHA-1 of a fixed namespace and the type's signature (a version 5 UUID).
function parameterizedIid(signature) {
  const hash = crypto.createHash('sha1').update(Buffer.concat([Buffer.from('11f47ad57b7342c0abae878b1e16adee', 'hex'), Buffer.from(signature, 'utf8')])).digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

test('the helper\'s WinRT interface ids are the Windows SDK\'s', () => {
  const operation = '{9fc2b0bb-e446-44e2-aa61-9cab8f636af2}'; // Windows.Foundation.IAsyncOperation`1
  assert.equal(parameterizedIid(`pinterface(${operation};b1)`), 'CDB5EFB3-5788-509D-9BE1-71CCB8A3362A', 'the algorithm against a published id (IAsyncOperation<bool>)');
  const ids = Object.fromEntries([...source.matchAll(/static readonly Guid (\w+) = new Guid\("([0-9A-F-]+)"\)/g)].map((m) => [m[1], m[2]]));
  assert.equal(ids.IID_ResultOperation, parameterizedIid(`pinterface(${operation};enum(Windows.Security.Credentials.UI.UserConsentVerificationResult;i4))`));
  assert.equal(ids.IID_AvailabilityOperation, parameterizedIid(`pinterface(${operation};enum(Windows.Security.Credentials.UI.UserConsentVerifierAvailability;i4))`));
  // windows.security.credentials.ui.h, userconsentverifierinterop.h, asyncinfo.h (also in mingw-w64's headers)
  assert.equal(ids.IID_IUserConsentVerifierStatics, 'AF4F3F91-564C-4DDC-B8B5-973447627C65');
  assert.equal(ids.IID_IUserConsentVerifierInterop, '39E050C3-4E74-441A-8DC0-B81104DF949C');
  assert.equal(ids.IID_IAsyncInfo, '00000036-0000-0000-C000-000000000046');
  assert.equal(ids.WINTRUST_ACTION_GENERIC_VERIFY_V2, '00AAC56B-CD44-11D0-8CC2-00C04FC295EE');
  // vtable slots: IUnknown 0-2, IInspectable 3-5, then the interface's own methods in header order
  assert.match(source, /const int SlotCheckAvailability = 6, SlotRequestVerification = 7;/);
  assert.match(source, /const int SlotRequestForWindow = 6;/);
  assert.match(source, /const int SlotStatus = 7, SlotCancel = 9;/);
  assert.match(source, /const int SlotGetResults = 8;/);
});

test('every answer the gate understands is one the helper writes, with the enum names in Windows\' order', () => {
  const gate = read('desktop', 'passwords', 'gate.cjs');
  const results = ['Verified', 'DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy', 'RetriesExhausted', 'Canceled'];
  const block = source.slice(source.indexOf('static string ResultName'), source.indexOf('/** "unavailable:NoApi"'));
  results.forEach((name, value) => assert.match(block, new RegExp(`case ${value}: return "${name}";`), name));
  const availability = source.slice(source.indexOf('static string AvailabilityName'), source.indexOf('static string ResultName'));
  ['Available', 'DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy'].forEach((name, value) => assert.match(availability, new RegExp(`case ${value}: return "${name}";`), name));
  for (const answer of ['result:Verified', 'result:Canceled', 'result:Failed', 'timeout']) assert.ok(gate.includes(`'${answer}'`), answer + ' is read by the gate');
  assert.match(source, /answer != ERROR_LOGON_FAILURE/, 'a wrong password is tried once: every try counts toward the Windows lockout');
  assert.match(source, /ulong\.TryParse\(args\[1\]/);
  for (const written of ['"unavailable:NoPassword"', '"result:Canceled"', '"result:Failed"', '"result:Verified"', '"timeout"', '"error"', '"unavailable:NoApi"', '"unavailable:" + AvailabilityName', '"result:" + ResultName']) assert.ok(source.includes(written), written + ' is written by the helper');
  for (const command of ['"hello"', '"password"', '"icon"', '"signature"']) assert.ok(source.includes(`command == ${command}`), command);
  assert.ok(read('desktop', 'browser-services', 'vpn-control.cjs').includes("status === 'valid'") && source.includes('"valid" : "invalid"'));
  assert.ok(source.indexOf('LimitMs = 85000') > 0 && /timeoutMs=90000/.test(gate), 'the helper closes a prompt left open before Acira stops waiting');
});

test('the helper keeps to C# 5 on the .NET Framework 4 compiler, and never writes or starts anything', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.doesNotMatch(code, /\$"/, 'no string interpolation (C# 6)');
  assert.doesNotMatch(code, /\?\.|\?\[/, 'no null-conditional operators (C# 6)');
  assert.doesNotMatch(code, /\bnameof\b|\bout var\b|\bis var\b|\bwhen\b|\basync\b|\bawait\b/, 'no C# 6/7 features, no async (needs a newer compiler or reference set)');
  assert.doesNotMatch(code, /\)\s*=>\s*[^{(]*;\s*$/m, 'no expression-bodied members (C# 6)');
  assert.doesNotMatch(code, /\{\s*get;\s*\}\s*=|\bWindows\.Foundation\b|\busing\s+Windows\./, 'no auto-property initialisers, no WinRT projection (needs SDK metadata)');
  assert.doesNotMatch(code, /Process\.Start|File\.(?:Write|Create|Append|Copy|Move|Delete)|Assembly\.Load|CSharpCodeProvider|CompileAssembly|Registry\./, 'starts, writes and compiles nothing');
  assert.match(source, /^\/\/ \[never compiled\]/, 'marked as never compiled until it is built on Windows');
  assert.match(source, /\[MTAThread\]/);
  assert.match(source, /SetApartmentState\(ApartmentState\.STA\)/, 'the password prompt runs on an STA thread');
  assert.match(source, /Console\.OpenStandardInput\(\)/, 'input arrives on standard input');
  assert.doesNotMatch(code, /GetEnvironmentVariable/, 'nothing from the environment');
  // the secret: unpacked into unmanaged memory, wiped and freed, never printed
  assert.match(source, /Win32\.Wipe\(password, PasswordChars \* 2\);\s*Marshal\.FreeHGlobal\(password\);/);
  assert.match(source, /Win32\.Wipe\(outBuffer, \(int\)outSize\);\s*Win32\.CoTaskMemFree\(outBuffer\);/);
  assert.doesNotMatch(source.slice(source.indexOf('static class Password'), source.indexOf('static class Signature')), /WriteLine/, 'the password check prints nothing itself');
  assert.match(source, /signedIn\.User\.Equals\(current\.User\)/, 'the account typed must be this Windows user (by SID)');
  // success is positive evidence, never "no error code"
  assert.match(source, /int error = Marshal\.GetLastWin32Error\(\);\s*return error != 0 \? error : -1;/, 'LogonUser failing without an error code is not a sign-in');
  assert.match(source, /int value = -1;\s*return Method<GetIntFn>\(typed, SlotGetResults\)\(typed, out value\) != 0 \? -1 : value;/, 'a Hello result counts only when GetResults said S_OK and wrote it');
  assert.match(source, /if \(answer == 0\) return "result:Verified";/);
  // one time limit for the whole Hello check, so it ends (and closes its prompt) before Acira stops waiting
  assert.equal(source.match(/AddMilliseconds\(LimitMs\)/g).length, 1);
  assert.match(source, /static int Wait\(IntPtr operation, Guid operationIid, DateTime end\)/);
  assert.match(source, /Wait\(check, IID_AvailabilityOperation, end\)[\s\S]*Wait\(operation, IID_ResultOperation, end\)/);
  assert.match(source, /CREDUIWIN_ENUMERATE_CURRENT_USER = 0x200/);
  assert.match(source, /info\.hwndParent = window;/, 'the password prompt is parented to the Acira window');
  assert.match(source, /RequestForWindowFn>\(interop, SlotRequestForWindow\)\(interop, window, text,/, 'Hello is parented to the Acira window');
});

test('both Windows build paths compile acira-verify.exe and ship it as resources/acira-verify.exe; release.mjs checks it is there and signed', () => {
  const build = read('scripts', 'build-installer-helper.cjs');
  assert.match(build, /if\(wanted\('acira-verify\.exe'\)\)build\('acira-verify\.exe','AciraVerify\.cs'\);/);
  assert.match(build, /'\/target:winexe'/, 'no console window');
  assert.match(build, /v4\.0\.30319\\\\csc\.exe/, 'the in-box .NET Framework 4 compiler');
  // npm run build:windows: the portable package (and the installer made from it)
  const pack = read('scripts', 'release-package.mjs');
  assert.match(pack, /withInstallerHelpers\(\{root,names:APP_HELPERS,sign:files=>signFiles\(files\)/, 'compiled and signed by the same step as the installer helpers');
  assert.match(pack, /fs\.writeFile\(path\.join\(output,'resources',helper\.name\),helper\.bytes\)/);
  assert.ok(pack.indexOf("path.join(output,'resources',helper.name)") < pack.indexOf("'FILES-SHA256.json'"), 'before the payload is hashed, so the installer carries it');
  assert.match(pack, /'packaging\/installer\/AciraVerify\.cs'/, 'a recorded packaging input');
  // node scripts/release.mjs: electron-builder copies the signed build output into resources
  const builder = JSON.parse(read('packaging', 'electron-builder.json'));
  assert.deepEqual(builder.extraResources.find((item) => item.to === 'acira-verify.exe'), { from: 'packaging/installer/acira-verify.exe', to: 'acira-verify.exe' });
  const release = read('scripts', 'release.mjs');
  assert.match(release, /withInstallerHelpers\(\{root, sign: helpers => \{\s*if \(mode !== 'none'\) signFiles\(helpers\);/);
  assert.match(release, /'win-unpacked', 'resources', 'acira-verify\.exe'/);
  assert.match(release, /signature\.verify !== 'Valid'/, 'a signed release fails when the helper is not');
  // the checkout never carries a compiled copy, and the public source export ships the C# only
  assert.match(read('.gitignore'), /^packaging\/installer\/acira-verify\.exe\r?$/m);
  // the helper runs where the other helpers run: same manifest (asInvoker, Windows 10/11)
  assert.match(build, /'\/win32manifest:'\+path\.join\(dir,'acira-helper\.manifest'\)/);
});

test('the app finds the helper where both build paths put it', () => {
  // process.resourcesPath is <install>\resources for the installed and the portable app alike
  const installed = 'C:\\Users\\me\\AppData\\Local\\Programs\\Acira Browser\\resources';
  assert.equal(helperPath({ packaged: true, resourcesPath: installed }), path.join(installed, 'acira-verify.exe'));
  const builder = JSON.parse(read('packaging', 'electron-builder.json'));
  assert.ok(builder.extraResources.some((item) => item.to === HELPER));
  assert.match(read('scripts', 'release-package.mjs'), /path\.join\(output,'resources',helper\.name\)/);
});

test('Acira\'s own updates (once Acira is signed) are checked by the helper with electron-updater\'s rule; a helper that cannot start does not block them', async () => {
  const { updateSignatureCheck } = require('../desktop/windows-helper.cjs');
  const subject = 'CN="Acira, Inc.", O="Acira, Inc.", L=Wilmington, S=Delaware, C=US';
  const check = (answer) => { const { calls, exec } = fakeExec(answer); return { calls, verify: updateSignatureCheck({ helper: 'C:\\A\\resources\\acira-verify.exe', exec }) }; };
  const signed = check(`valid\r\nAcira, Inc.\r\n${subject}\r\n`);
  assert.equal(await signed.verify(['Acira, Inc.'], 'C:\\Users\\me\\AppData\\Local\\acira-browser-updater\\pending\\AciraBrowserSetup.exe'), null, 'signed by Acira');
  assert.deepEqual(signed.calls[0].args, ['signature']); assert.equal(signed.calls[0].input, 'C:\\Users\\me\\AppData\\Local\\acira-browser-updater\\pending\\AciraBrowserSetup.exe');
  assert.equal(await check(`valid\r\nAcira, Inc.\r\n${subject}\r\n`).verify(['CN="Acira, Inc.", C=US'], 'x.exe'), null, 'a distinguished name matches in every part it gives');
  assert.match(await check(`valid\r\nAcira, Inc.\r\n${subject}\r\n`).verify(['CN="Acira, Inc.", C=GB'], 'x.exe'), /publisherNames/);
  assert.match(await check('valid\r\nSomeone Else\r\nCN=Someone Else, C=US\r\n').verify(['Acira, Inc.'], 'x.exe'), /signed by Someone Else/);
  assert.match(await check(`invalid\r\nAcira, Inc.\r\n${subject}\r\n`).verify(['Acira, Inc.'], 'x.exe'), /signature: invalid/, 'a broken or untrusted signature');
  assert.match(await check('').verify(['Acira, Inc.'], 'x.exe'), /signature: none/);
  // A helper that cannot start (missing, quarantined) must not stop the update that brings it back: the feed's SHA-512 still guards the file.
  const logged = [], { exec: blocked } = fakeExec((cb) => cb(Object.assign(new Error('spawn EPERM'), { code: 'EPERM', syscall: 'spawn x.exe' }), ''));
  assert.equal(await updateSignatureCheck({ helper: 'C:\\A\\resources\\acira-verify.exe', exec: blocked, log: (line) => logged.push(line) })(['Acira, Inc.'], 'x.exe'), null);
  assert.match(logged.join('\n'), /could not start; the update is checked by its SHA-512 only/);
  assert.equal(await updateSignatureCheck({ helper: null, log: () => {} })(['Acira, Inc.'], 'x.exe'), null, 'no helper file at all');
  // One that runs but does not answer in time is a no, as electron-updater's own check fails on a script that hangs.
  assert.match(await check((cb) => cb(Object.assign(new Error('timed out'), { killed: true }), '')).verify(['Acira, Inc.'], 'x.exe'), /signature: timeout/);
  assert.match(await check(`valid\r\n\r\n\r\n`).verify([''], 'x.exe'), /publisherNames/, 'an empty name matches nothing');
});

test('the real NsisUpdater of a signed Acira asks the helper, never cmd.exe and PowerShell, before it installs an update', async (t) => {
  const os = require('node:os'), childProcess = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-update-signature-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // app-update.yml as electron-builder writes it for a signed build (packaging/signing-config.cjs: verifyUpdateCodeSignature, publisherName)
  const config = path.join(root, 'app-update.yml');
  fs.writeFileSync(config, 'provider: generic\nurl: http://127.0.0.1:9/\nupdaterCacheDirName: acira-browser-updater\npublisherName:\n  - Acira, Inc.\n');
  const { NsisUpdater } = require('electron-updater/out/NsisUpdater');
  const nsis = new NsisUpdater(null, { version: '0.1.0-beta.10', name: 'Acira Browser', isPackaged: true, appUpdateConfigPath: config, userDataPath: root, baseCachePath: path.join(root, 'Caches'), whenReady: () => Promise.resolve(), quit() {}, relaunch() {}, onQuit() {} });
  nsis.logger = null; nsis._testOnlyOptions = { platform: 'win32' };
  const { createAppUpdater } = require('../desktop/browser-services/app-updater.cjs');
  const asked = [];
  const updateSignature = require('../desktop/windows-helper.cjs').updateSignatureCheck({ helper: 'C:\\A\\resources\\acira-verify.exe', exec: (file, args, options, callback) => { asked.push(args); setImmediate(() => callback(null, 'valid\r\nAcira, Inc.\r\nCN="Acira, Inc.", C=US\r\n')); return { stdin: { on() {}, end() {} } }; } });
  const updater = createAppUpdater({ app: { getVersion: () => '0.1.0-beta.10', isPackaged: true, getPath: () => root }, dir: root, platform: 'win32', env: {}, autoUpdater: nsis, uninstallerPresent: () => true, qaBuild: false, macAvailability: () => null, schedule: () => null, every: () => null, updateSignature });
  const started = [], original = { execFile: childProcess.execFile, exec: childProcess.exec, spawn: childProcess.spawn, execFileSync: childProcess.execFileSync };
  for (const name of Object.keys(original)) childProcess[name] = (...args) => { started.push([name, String(args[0])]); throw new Error('no child process may start'); };
  try {
    await updater.check().catch(() => null); // sets the updater up; the feed is not there
    assert.equal(nsis.verifyUpdateCodeSignature, updateSignature, 'Acira\'s check replaces electron-updater\'s PowerShell one');
    const setup = path.join(root, 'AciraBrowserSetup.exe'); fs.writeFileSync(setup, 'MZ');
    assert.equal(await nsis.verifySignature(setup), null, 'signed by Acira: the update may install');
    assert.deepEqual(asked, [['signature']]);
  } finally { Object.assign(childProcess, original); }
  assert.deepEqual(started, [], 'no cmd.exe, no powershell.exe');
  // Without a publisher (today's unsigned builds) electron-updater asks nothing at all.
  fs.writeFileSync(config, 'provider: generic\nurl: http://127.0.0.1:9/\nupdaterCacheDirName: acira-browser-updater\n');
  const unsigned = new NsisUpdater(null, { version: '0.1.0-beta.10', name: 'Acira Browser', isPackaged: true, appUpdateConfigPath: config, userDataPath: root, baseCachePath: path.join(root, 'Caches'), whenReady: () => Promise.resolve(), quit() {}, relaunch() {}, onQuit() {} });
  unsigned.verifyUpdateCodeSignature = updateSignature; asked.length = 0;
  assert.equal(await unsigned.verifySignature(path.join(root, 'AciraBrowserSetup.exe')), null); assert.deepEqual(asked, []);
});
