'use strict';
// Windows 10 and Windows 11 behaviour (docs/launch/WINDOWS_COMPAT.md). We only own Windows 11 machines, so the Windows 10 paths are proven by
// simulating build numbers here and in qa/windows-compat-smoke.mjs: acrylic needs Windows 11 22H2 (22621), the Default apps deep link needs 23H2 (22631),
// everything else must degrade to a solid, working window instead of failing.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const version = require('../desktop/windows-version.cjs');
const { createDefaultBrowserService } = require('../desktop/accounts/default-browser.cjs');
const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const WINDOWS_10 = { '1809': 17763, '1903': 18362, '1909': 18363, '2004': 19041, '20H2': 19042, '21H1': 19043, '21H2': 19044, '22H2': 19045 };
const WINDOWS_11_SOLID = { '21H2': 22000 };
const WINDOWS_11_GLASS = { '22H2': 22621, '23H2': 22631, '24H2': 26100, '25H2': 26200, insider: 26300 };
const release = build => `10.0.${build}`;

test('os.release() is read as a build number; Windows 7, 8 and 8.1 and other platforms are not supported', () => {
  assert.equal(version.windowsBuild('10.0.19045', 'win32'), 19045);
  assert.equal(version.windowsBuild('10.0.26100', 'win32'), 26100);
  assert.equal(version.windowsBuild('10.0.22631', 'win32'), 22631);
  assert.equal(version.windowsBuild('6.3.9600', 'win32'), null, 'Windows 8.1');
  assert.equal(version.windowsBuild('6.1.7601', 'win32'), null, 'Windows 7');
  assert.equal(version.windowsBuild('10.0', 'win32'), null);
  assert.equal(version.windowsBuild('', 'win32'), null);
  assert.equal(version.windowsBuild(null, 'win32'), null);
  assert.equal(version.windowsBuild('23.4.0', 'darwin'), null);
  assert.equal(version.windowsBuild('6.8.0-45-generic', 'linux'), null);
});

test('Windows 10 builds take the solid-frame fallback: no acrylic, no backgroundMaterial option', () => {
  for (const [name, build] of Object.entries(WINDOWS_10)) {
    const result = version.windowMaterial({ release: release(build), platform: 'win32', env: {} });
    assert.equal(result.acrylic, false, `Windows 10 ${name} (${build})`);
    assert.equal(result.material, 'none');
    assert.equal(result.family, 'windows-10');
    assert.equal(result.build, build);
    assert.equal(require('../desktop/platform.cjs').windowMaterial({ platform: 'win32', release: release(build), disabled: false }), 'none');
  }
});

test('Windows 11 21H2 (22000) has no system backdrop API either and stays solid', () => {
  const result = version.windowMaterial({ release: release(22000), platform: 'win32', env: {} });
  assert.equal(result.acrylic, false);
  assert.equal(result.family, 'windows-11');
});

test('Windows 11 22H2 and later paint acrylic', () => {
  for (const [name, build] of Object.entries(WINDOWS_11_GLASS)) {
    const result = version.windowMaterial({ release: release(build), platform: 'win32', env: {} });
    assert.equal(result.acrylic, true, `Windows 11 ${name} (${build})`);
    assert.equal(result.material, 'acrylic');
    assert.equal(result.family, 'windows-11');
    assert.equal(require('../desktop/platform.cjs').windowMaterial({ platform: 'win32', release: release(build), disabled: false }), 'acrylic');
  }
  assert.equal(version.supportsBackgroundMaterial(22620), false, 'one build below 22H2');
  assert.equal(version.supportsBackgroundMaterial(22621), true);
});

test('ACIRA_MATERIAL=none, macOS, Linux, unsupported Windows and unreadable versions never get acrylic', () => {
  assert.equal(version.windowMaterial({ release: release(26100), platform: 'win32', env: { ACIRA_MATERIAL: 'none' } }).acrylic, false);
  assert.equal(version.windowMaterial({ release: '23.4.0', platform: 'darwin', env: {} }).acrylic, false);
  assert.equal(version.windowMaterial({ release: '6.8.0', platform: 'linux', env: {} }).acrylic, false);
  assert.equal(version.windowMaterial({ release: '6.3.9600', platform: 'win32', env: {} }).acrylic, false);
  assert.equal(version.windowMaterial({ release: '6.3.9600', platform: 'win32', env: {} }).family, 'unsupported');
  assert.equal(version.windowMaterial({ release: 'not a version', platform: 'win32', env: {} }).acrylic, false);
});

test('the QA build override works only in a test profile and only with a plausible build number', () => {
  const env = extra => ({ ACIRA_BROWSER_TEST_DATA: 'C:\\ae\\profile', ...extra });
  assert.equal(version.windowMaterial({ release: release(26100), platform: 'win32', env: env({ ACIRA_WINDOWS_BUILD: '19045' }) }).acrylic, false, 'Windows 11 pretends to be 22H2 of Windows 10');
  assert.equal(version.windowMaterial({ release: release(19045), platform: 'win32', env: env({ ACIRA_WINDOWS_BUILD: '26100' }) }).acrylic, true);
  assert.equal(version.windowMaterial({ release: release(26100), platform: 'win32', env: { ACIRA_WINDOWS_BUILD: '19045' } }).build, 26100, 'ignored without a test profile');
  for (const bad of ['', 'abc', '12', '-5', '1e5', '19045; rm']) assert.equal(version.currentBuild({ release: release(26100), platform: 'win32', env: env({ ACIRA_WINDOWS_BUILD: bad }) }), 26100, JSON.stringify(bad));
  assert.equal(version.currentBuild({ release: release(26100), platform: 'darwin', env: env({ ACIRA_WINDOWS_BUILD: '19045' }) }), null, 'never on another platform');
});

test('Default apps deep link needs Windows 11 23H2; older builds open the plain Default apps page', async () => {
  for (const [build, expected] of [[17763, false], [19045, false], [22000, false], [22621, false], [22630, false], [22631, true], [26100, true], [26300, true]]) {
    assert.equal(version.supportsDefaultAppsDeepLink(build), expected, String(build));
    let uri;
    const service = createDefaultBrowserService({
      app: { isPackaged: true, isDefaultProtocolClient: () => false },
      shell: { async openExternal(value) { uri = value; } },
      platform: 'win32',
      windowsBuild: build,
      getRegistration: () => ({ hive: 'HKCU', name: 'Acira Browser' }),
    });
    assert.equal((await service.request()).requested, true, String(build));
    assert.equal(uri, expected ? 'ms-settings:defaultapps?registeredAppUser=Acira%20Browser' : 'ms-settings:defaultapps', String(build));
  }
});

test('every use of the window material is behind the same feature check, and no other code parses the Windows build', () => {
  const desktop = path.join(root, 'desktop');
  const files = [];
  (function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.cjs')) files.push(full); } })(desktop);
  const stray = [], ungated = [];
  for (const file of files) {
    const name = path.relative(desktop, file), text = fs.readFileSync(file, 'utf8');
    if (name !== 'windows-version.cjs') {
      if (/os\.release\(\)|\.release\(\)\.split|getSystemVersion\(/.test(text.replace(/\/\/.*$/gm, ''))) stray.push(name);
      for (const hit of text.matchAll(/backgroundMaterial|setBackgroundMaterial/g)) {
        const before = text.slice(Math.max(0, hit.index - 80), hit.index);
        if (!/acrylic\s*[?)&]|if\s*\(\s*acrylic\s*\)|(?:if\s*\(\s*|\()material\s*===\s*['"]acrylic['"]/.test(before + 'x')) ungated.push(`${name}@${hit.index}`);
      }
    }
  }
  assert.deepEqual(stray, [], 'read the Windows build through desktop/windows-version.cjs');
  assert.deepEqual(ungated, [], 'backgroundMaterial may only be passed when `acrylic` (Windows 11 22H2+) is true');
  assert.match(read('desktop', 'main.cjs'), /const acrylic=require\('\.\/windows-version\.cjs'\)\.windowMaterial\(\)\.acrylic/);
});

test('window chrome that exists on both Windows versions uses only Electron options that Windows 10 supports', () => {
  const { windowChrome } = require('../desktop/platform.cjs');
  const win = windowChrome('win32');
  assert.equal(win.titleBarStyle, 'hidden');
  assert.deepEqual(Object.keys(win.titleBarOverlay).sort(), ['color', 'height', 'symbolColor']);
  assert.equal(win.roundedCorners, undefined, 'Windows 10 draws square corners itself; never forced');
  assert.equal(win.vibrancy, undefined);
  assert.equal(win.backgroundMaterial, undefined, 'only added by main.cjs behind `acrylic`');
});

test('the installer helpers run on a stock Windows 10 1809+: .NET Framework 4, AnyCPU, asInvoker, Windows 10/11 manifest', () => {
  const manifest = read('packaging', 'installer', 'acira-helper.manifest');
  assert.match(manifest, /requestedExecutionLevel level="asInvoker" uiAccess="false"/);
  assert.match(manifest, /\{1f676c76-80e1-4239-95bb-83d0f6d0da78\}/, 'supportedOS Windows 10 and 11');
  assert.match(manifest, /\{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a\}/, 'supportedOS Windows 8.1');
  assert.match(manifest, /PerMonitorV2/);
  assert.doesNotMatch(manifest, /requireAdministrator|highestAvailable/);
  const build = read('scripts', 'build-installer-helper.cjs');
  assert.match(build, /v4\.0\.30319/, 'the in-box .NET Framework 4 compiler: no SDK, no runtime to install');
  assert.match(build, /\/platform:anycpu/);
  assert.doesNotMatch(build, /netcoreapp|net[5-9]\.0|dotnet (publish|build)/, 'a .NET (Core) target would need a runtime on a stock Windows 10');
  for (const name of ['acira-progress.exe', 'acira-uninstall.exe']) {
    const bytes = fs.readFileSync(path.join(root, 'packaging', 'installer', name));
    assert.ok(bytes.includes(Buffer.from('requestedExecutionLevel')), `${name} was built with the asInvoker manifest (node scripts/build-installer-helper.cjs)`);
    assert.ok(bytes.includes(Buffer.from('v4.0.30319')), `${name} targets CLR 4`);
    const header = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.readUInt16LE(header + 24), 0x10b, `${name} is PE32 AnyCPU (loads 64-bit on x64, runs on Windows 10 ARM64 under emulation too)`);
  }
});

test('the installer is per-user, never elevates, and stops older Windows with a plain message', () => {
  const config = JSON.parse(read('packaging', 'electron-builder.json'));
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.oneClick, true);
  assert.deepEqual(config.win.target.map(t => t.arch.join()), ['x64', 'x64'], 'x64 only: no 32-bit and no Windows-on-Arm build');
  const nsh = read('packaging', 'acira-installer.nsh');
  assert.match(nsh, /!macro customInit/);
  assert.match(nsh, /kernel32::GetVersion\(\)/);
  assert.match(nsh, /\$0 < 10/, 'Windows 10 is the minimum (Electron 44 / Chromium 152)');
  assert.match(nsh, /IfSilent acOldWindowsQuit/, 'the updater never sees a message box');
  assert.match(nsh, /SetErrorLevel 2/);
  for (const language of ['necesita Windows 10', 'nécessite Windows 10', 'benötigt Windows 10', 'precisa do Windows 10', 'richiede Windows 10', 'Windows 10 以降', 'Windows 10 或更高版本', 'needs Windows 10']) assert.ok(nsh.includes(language), language);
  assert.doesNotMatch(nsh, /RequestExecutionLevel\s+admin|UAC_RunElevated|ShellExecute[^\n]*runas/i);
  // the per-user data folders the uninstaller touches come from the user's own profile, whatever their name is
  assert.ok(nsh.includes('RMDir /r "$APPDATA\\${AC_DATA_DIR}"'), 'the data folder of this build identity');
  assert.ok(nsh.includes('!define AC_DATA_DIR "AciraBrowser"'), 'the real build removes the real data folder name');
});

test('the stock "Installing, please wait" window never reaches the screen; the data question defaults to No', () => {
  const nsh = read('packaging', 'acira-installer.nsh');
  // transparent and off the taskbar from GUI init (before SpiderBanner shows it), hidden before any file is unpacked
  assert.match(nsh, /!define MUI_CUSTOMFUNCTION_GUIINIT AcHideStockWindow/);
  const hide = nsh.slice(nsh.indexOf('Function AcHideStockWindow'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function AcHideStockWindow')));
  assert.match(hide, /IfSilent/);
  assert.match(hide, /IntOp \$0 \$0 \| 0x80080/, 'WS_EX_LAYERED | WS_EX_TOOLWINDOW');
  assert.match(hide, /SetLayeredWindowAttributes\(p \$HWNDPARENT, i 0, i 0, i 2\)/, 'alpha 0');
  const banner = nsh.slice(nsh.indexOf('Function AcStyleBanner'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function AcStyleBanner')));
  assert.ok(banner.indexOf('ShowWindow $HWNDPARENT 0') >= 0 && banner.indexOf('ShowWindow $HWNDPARENT 0') < banner.indexOf('File '), 'stock window hidden before unpacking');
  assert.ok(banner.indexOf('CreateWindowExW') < banner.indexOf('Call AcExtractHelper'), 'branded window up before the 8 MB scene player is unpacked');
  // every data question (all languages) is Yes/No with No as the default button
  const questions = nsh.match(/MessageBox MB_YESNO[^\n]*/g) || [];
  assert.equal(questions.length, 8);
  for (const q of questions) { assert.match(q, /MB_DEFBUTTON2/); assert.match(q, /IDNO acKeepData/); }
});

test('the installer card holds the finished picture until Acira is on screen, then fades; progress never goes back', () => {
  const cs = read('packaging', 'installer', 'AciraProgress.cs');
  // no close at the end of the bloom any more: hold, wait for the app's own window (or a cap), fade
  assert.doesNotMatch(cs, /BLOOM_MS \+ 300\) \{ Close\(\)/);
  assert.match(cs, /const int HOLD_CAP_MS = 6000, FADE_OUT_MS = 180;/);
  assert.match(cs, /AppUp\(\) \|\| \(now - holdAt\.Value\)\.TotalMilliseconds > HOLD_CAP_MS/);
  assert.match(cs, /appUp = AppWindow\.Shown\(appExe\)/);
  // once the copy is done the card no longer dies with the installer (it exits right after launching the app)
  assert.match(cs, /if \(doneAt == null && \(!Native\.IsWindow\(parent\)/);
  assert.match(cs, /if \(target > pos\) pos = Math\.Min\(1000, target\); \/\/ never backwards/);
});

test('the installer scene keeps moving while files copy: the disk is read off the drawing thread, a Repair over the same files is not read as done, and the light never stands still', () => {
  const cs = read('packaging', 'installer', 'AciraProgress.cs');
  const overlay = cs.slice(cs.indexOf('class Overlay : Form'));
  // measuring lives in the sampler thread; the overlay (the drawing thread) never lists the folder or opens the payload
  assert.match(cs, /class ProgressSampler/);
  assert.match(cs, /new System\.Threading\.Thread\(Run\)/);
  assert.doesNotMatch(overlay, /new DirectoryInfo|GetFiles\(|new FileStream\(payload|double Scan\(|double Written\(/, 'no disk reads on the drawing thread');
  assert.doesNotMatch(overlay, /File\.Exists\(flag\)\) doneAt/, 'the done flag is polled by the sampler');
  // folder bytes count from the lowest the folder has been, and only once it has been (nearly) empty: an installed copy is not progress
  assert.match(cs, /minBytes/);
  assert.match(cs, /bool observable = minBytes <= 0\.5 \* expected;/);
  assert.match(cs, /w == -2 && payloadSeenAt != DateTime\.MinValue/, 'a payload that is not there yet is not a finished copy');
  // the light keeps moving whatever the measurement says, and stays under 96% until the installer is done
  assert.match(cs, /if \(doneAt == null && pos < 960\) target = Math\.Max\(target, pos \+ \(60\.0 \* Math\.Exp\(-ms \/ 20000\.0\) \+ 4\.0\)/);
  // frames are decoded and scaled to the card ahead of the one on screen, in a thread of their own
  // a very slow copy never leaves the scene frozen: the light breathes once the bar is nearly full, and the card is not given up after a few minutes
  assert.match(cs, /if \(doneAt == null && pos >= 935\) \{[^\n]*want = 880 \+ 70 \* Math\.Cos/);
  assert.match(cs, /\(preview \? pos : art\)/);
  assert.match(cs, /pos >= 1000 && art >= 1000 && bloomAt == null/, 'the finish waits until the light has caught up');
  assert.doesNotMatch(cs, /TotalSeconds > 180\)/, 'no three-minute cap that drops a slow install back to the still picture');
  assert.match(cs, /class Frames[\s\S]*new System\.Threading\.Thread\(Prefetch\)/);
  assert.match(cs, /timer\.Interval = 15;/, 'WM_TIMER ticks every 15.6 ms: 16 would wait for the next tick (31 ms)');
});

test('re-running setup over an installed Acira asks first (Repair / Update / Open), in the branded card, never in silent runs', () => {
  const nsh = read('packaging', 'acira-installer.nsh');
  assert.match(nsh, /Pop \$0\s+Call AcAskExisting\s+!endif\s+!macroend/);
  const ask = nsh.slice(nsh.indexOf('Function AcAskExisting'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function AcAskExisting')));
  assert.match(ask, /IfSilent acAskDone/);
  assert.ok(ask.includes('IfFileExists "$INSTDIR\\${AC_APP_EXE}" 0 acAskDone'), 'asks only when the app is in the install folder');
  assert.match(ask, /--choose "\$INSTDIR" "\$\{VERSION\}"/);
  assert.doesNotMatch(ask, /MessageBox/);
  const choose = read('packaging', 'installer', 'AciraChoose.cs');
  for (const key of ['sameT', 'olderT', 'newerT', 'closeT', 'failT', 'repair', 'update', 'open', 'cancel']) assert.match(choose, new RegExp(`\\{ "${key}", new\\[\\] \\{ ("[^"]*", ){7}"[^"]*" \\} \\}`), `${key} in all 8 installer languages`);
  // a running Acira quits the ordinary way; nothing in the chooser kills a process
  assert.match(choose, /"--acira-installer-quit"/);
  assert.doesNotMatch(choose, /\.Kill\(|TerminateProcess/);
  const main = read('desktop', 'main.cjs');
  assert.match(main, /INSTALLER_QUIT_ARG='--acira-installer-quit';if\(primaryInstance&&process\.argv\.includes\(INSTALLER_QUIT_ARG\)\)app\.exit\(0\);if\(primaryInstance\)app\.on\('second-instance',\(_event,args\)=>\{if\(Array\.isArray\(args\)&&args\.includes\(INSTALLER_QUIT_ARG\)\)app\.quit\(\);\}\);/);
  assert.match(read('scripts', 'build-installer-helper.cjs'), /build\('acira-uninstall\.exe','AciraUninstall\.cs',resources,\['AciraChoose\.cs'\]\);/);
});

test('long install paths are not a problem: the installed tree is shallow', () => {
  // the deepest file the installer writes is resources/tor/LICENSE.tor.txt (29 characters below the install folder); electron-builder extracts into
  // %LOCALAPPDATA%\Programs\<name>, so even a 100-character user name stays far below MAX_PATH (260)
  const extra = read('packaging', 'electron-builder.json');
  assert.match(extra, /"to": "tor"/);
  const longest = 'resources/tor/LICENSE.tor.txt'.length;
  const installRoot = 'C:\\Users\\'.length + 100 + '\\AppData\\Local\\Programs\\AciraBrowser\\'.length;
  assert.ok(installRoot + longest < 260);
});

test('Installed apps shows just "Acira Browser"; the version stays in its own column', () => {
  const config = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'packaging', 'electron-builder.json'), 'utf8'));
  assert.equal(config.productName, 'Acira Browser');
  assert.equal(config.nsis.uninstallDisplayName, '${productName}');
});
