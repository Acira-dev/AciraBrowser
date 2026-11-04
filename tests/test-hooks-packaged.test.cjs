'use strict';
// Test hooks must not work in a real packaged Acira on the person's own profile, and must keep working in a development checkout, the QA
// twin and on an isolated test profile (the release rigs drive the packaged app that way: ACIRA_BROWSER_TEST_DATA plus a debugging port).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { HOOK_ENV, TEST_PROFILE_ENV, DEBUG_SWITCHES, MOCK_KEYCHAIN, sameOrInside, isolatedTestProfile, hooksAllowed, lockDown, checkJudged } = require('../desktop/test-hooks.cjs');

const appData = path.join(os.tmpdir(), 'acira-hooks-appdata');
const realProfile = path.join(appData, 'AciraBrowser');
const fakeApp = (isPackaged, switches = DEBUG_SWITCHES) => {
  const on = new Set(switches), removed = [], added = [];
  return { isPackaged, removed, added, getPath: name => { assert.equal(name, 'appData'); return appData; }, commandLine: { hasSwitch: name => on.has(name), removeSwitch: name => { on.delete(name); removed.push(name); }, appendSwitch: name => { on.add(name); added.push(name); } } };
};
const identity = { qa: false, dataFolder: 'AciraBrowser' };
const hooked = () => Object.fromEntries(HOOK_ENV.map(name => [name, '1']));
const quiet = body => { const warn = console.warn; console.warn = () => {}; try { return body(); } finally { console.warn = warn; } };

test('a real packaged run on the person\'s own profile drops every hook and the debugging switches', () => {
  const app = fakeApp(true), env = { ...hooked(), PATH: 'x', ACIRA_STARTUP_TRACE: '/tmp/t.json' };
  const removed = quiet(() => lockDown({ app, identity, env }));
  for (const name of HOOK_ENV) assert.equal(name in env, false, name);
  assert.equal(env.PATH, 'x'); assert.equal(env.ACIRA_STARTUP_TRACE, '/tmp/t.json', 'timing files stay available');
  assert.deepEqual([...app.removed].sort(), [...DEBUG_SWITCHES].sort());
  assert.deepEqual([...removed.env].sort(), [...HOOK_ENV].sort());
});

test('the update feed, dev UI, hidden run and debugging port are among the dropped hooks', () => {
  for (const name of ['ACIRA_DEV', 'ACIRA_UPDATE_TEST', 'ACIRA_UPDATE_FEED', 'ACIRA_UPDATE_TEST_VERSION', 'ACIRA_UPDATE_STUB', 'ACIRA_PREVIEW_RECORD', 'ACIRA_BROWSER_TEST_HIDDEN', 'ACIRA_TEST_QUIET_NETWORK', 'ACIRA_SPELLCHECK_DICTIONARY_URL']) assert.ok(HOOK_ENV.includes(name), name);
  for (const name of ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins']) assert.ok(DEBUG_SWITCHES.includes(name), name);
  assert.equal(HOOK_ENV.includes('ACIRA_BROWSER_TEST_DATA'), false); assert.equal(HOOK_ENV.includes('ACIRA_BROWSER_TEST_DOWNLOAD_DIR'), false);
});

test('a development checkout, the QA twin and an isolated test profile keep every hook (the release rigs need them)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-rig-')), testData = path.join(root, 'profile');
  try {
    for (const [packaged, qa, data] of [[false, false, undefined], [true, true, undefined], [true, false, testData]]) {
      const app = fakeApp(packaged), env = { ...hooked(), ...(data ? { ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(data, 'downloads') } : {}) };
      const removed = lockDown({ app, identity: { ...identity, qa }, env, platform: 'win32' });
      for (const name of HOOK_ENV) assert.equal(env[name], '1', name);
      // The packaged build makes the test profile and uses it by its real path (the temp folder is a link on Mac), downloads inside it.
      if (data) { assert.equal(env.ACIRA_BROWSER_TEST_DATA, fs.realpathSync(data)); assert.equal(env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR, path.join(fs.realpathSync(data), 'downloads')); }
      assert.deepEqual(app.removed, []); assert.deepEqual(removed, { env: [], switches: [], added: [] });
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a "test profile" that is the person\'s own profile, or inside it, or a relative path, is not isolated', () => {
  const platform = process.platform;
  assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: realProfile }, realProfile, platform), false);
  assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: realProfile + path.sep }, realProfile, platform), false);
  assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(realProfile, 'Partitions') }, realProfile, platform), false);
  assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(realProfile, '..', 'AciraBrowser') }, realProfile, platform), false);
  assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: 'relative/profile' }, realProfile, platform), false);
  assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: '' }, realProfile, platform), false);
  assert.equal(isolatedTestProfile({}, realProfile, platform), false);
  // Mac and Windows file systems ignore case: AciraBROWSER is the same folder there.
  assert.equal(sameOrInside(realProfile.replace('AciraBrowser', 'ACIRABROWSER'), realProfile, 'darwin'), true);
  assert.equal(sameOrInside(realProfile.replace('AciraBrowser', 'ACIRABROWSER'), realProfile, 'win32'), true);
  assert.equal(sameOrInside(realProfile + 'QA', realProfile, platform), false, 'a sibling folder whose name starts the same is another folder');
  const app = fakeApp(true), env = { ...hooked(), ACIRA_BROWSER_TEST_DATA: realProfile };
  quiet(() => lockDown({ app, identity, env }));
  for (const name of HOOK_ENV) assert.equal(name in env, false, name);
  assert.equal('ACIRA_BROWSER_TEST_DATA' in env, false, 'the person\'s own profile is not a test profile, so the variable goes too');
  assert.deepEqual([...app.removed].sort(), [...DEBUG_SWITCHES].sort());
  assert.equal(hooksAllowed({ isPackaged: true, qa: false, env: {}, realProfile }), false);
});

test('the person\'s own profile given as a test profile is dropped: Acira stays on its real profile, and updates stay on', () => {
  // ACIRA_BROWSER_TEST_DATA can be set for good (launchctl setenv, the Windows user environment). lockDown used to keep it when it named the real
  // profile, and the updater then said "Updates are off while running with a test profile" on the person's own data.
  const { createAppUpdater } = require('../desktop/browser-services/app-updater.cjs'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-updates-'));
  try {
    for (const data of [realProfile, path.join(realProfile, 'Partitions'), 'relative/profile']) {
      const env = { ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(String(data), 'downloads'), PATH: 'x' };
      const removed = quiet(() => lockDown({ app: fakeApp(true, []), identity, env }));
      for (const name of TEST_PROFILE_ENV) assert.equal(name in env, false, `${name} (${data})`);
      assert.deepEqual(removed.env, TEST_PROFILE_ENV); assert.equal(env.PATH, 'x');
      const updater = createAppUpdater({ app: { isPackaged: true, getVersion: () => '0.1.0-beta.10', getPath: () => dir }, dir, platform: 'win32', env, uninstallerPresent: () => true, qaBuild: false, schedule: () => null, every: () => null });
      assert.doesNotMatch(String(updater.status().reason || ''), /test profile/, 'updates stay on');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a test profile on a packaged Mac build gets the mock keychain, so a copy of the person\'s profile cannot be read with the app\'s Keychain key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-copy-')), testData = path.join(root, 'copied-profile');
  try {
  const run = ({ packaged = true, qa = false, platform = 'darwin', data = testData, switches = [] }) => { const app = fakeApp(packaged, switches), env = { ...(data ? { ACIRA_BROWSER_TEST_DATA: data } : {}) }; const removed = quiet(() => lockDown({ app, identity: { ...identity, qa }, env, platform })); return { app, removed, env }; };
  const mac = run({});
  assert.deepEqual(mac.app.added, [MOCK_KEYCHAIN]); assert.deepEqual(mac.removed.added, [MOCK_KEYCHAIN]); assert.equal(mac.env.ACIRA_BROWSER_TEST_DATA, fs.realpathSync(testData), 'the test profile itself stays, by its real path');
  assert.deepEqual(run({ switches: [MOCK_KEYCHAIN] }).app.added, [], 'a rig that asks for it already is left alone');
  assert.deepEqual(run({ packaged: false }).app.added, [], 'a development checkout keeps its own choice');
  assert.deepEqual(run({ qa: true }).app.added, [], 'the QA twin has its own Keychain item, not the person\'s');
  assert.deepEqual(run({ platform: 'win32' }).app.added, [], 'Windows has no Keychain (its key sits in the profile, protected for the Windows user)');
  assert.deepEqual(run({ data: realProfile }).app.added, [], 'the person\'s own profile keeps the real Keychain');
  assert.deepEqual(run({ data: null }).app.added, [], 'no test profile: the hooks are gone, and so is any reason for it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8'), lock = main.indexOf("require('./test-hooks.cjs').lockDown(");
  for (const use of ['safeStorage', '.cookies', "setPath('userData'"]) { const at = main.indexOf(use); assert.ok(at < 0 || at > lock, use + ' comes after lockDown'); }
});

test('a folder that does not exist yet, reached through a link to the person\'s profile, is still inside it', { skip: process.platform === 'win32' && 'symlinks need rights on Windows' }, () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-new-'))), support = path.join(dir, 'Application Support'), real = path.join(support, 'AciraBrowser');
  try {
    fs.mkdirSync(real, { recursive: true }); fs.symlinkSync(support, path.join(dir, 'support-link')); fs.symlinkSync(real, path.join(dir, 'profile-link'));
    for (const folder of [path.join(dir, 'support-link', 'AciraBrowser', 'new-sub'), path.join(dir, 'profile-link', 'not-yet'), path.join(dir, 'profile-link', 'not-yet', 'deeper')])
      assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: folder }, real), false, folder);
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(dir, 'support-link', 'other', 'new') }, real), true, 'another new folder is a test profile');
    if (process.platform === 'darwin' && dir.startsWith('/private/')) assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(dir.slice('/private'.length), 'Application Support', 'AciraBrowser', 'not-yet') }, real), false, '/tmp is a link to /private/tmp');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the person\'s profile reached by another path is not a test profile: "..", an APFS firmlink', { skip: process.platform === 'win32' && 'symlinks need rights on Windows' }, () => {
  // Second review: path.resolve folds ".." as text before the system follows links, and realpath does not see through APFS firmlinks, so both passed
  // the gate and Acira then opened the person's own profile with every hook on. The gate now refuses "." and "..", and compares folder identity.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-alias-'))), support = path.join(dir, 'Application Support'), real = path.join(support, 'AciraBrowser');
  try {
    fs.mkdirSync(path.join(support, 'elsewhere'), { recursive: true }); fs.mkdirSync(real); fs.symlinkSync(path.join(support, 'elsewhere'), path.join(dir, 'l'));
    // As text dir/AciraBrowser, a folder that is not the profile; the system follows the link first: Application Support/AciraBrowser.
    const viaDots = path.join(dir, 'l') + path.sep + '..' + path.sep + 'AciraBrowser';
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: viaDots }, real), false, viaDots);
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(dir, 'other') + path.sep + '.' }, real), false, 'a "." is refused too');
    const firmlink = '/System/Volumes/Data' + real;
    if (process.platform === 'darwin' && fs.existsSync('/System/Volumes/Data' + dir)) {
      assert.notEqual(fs.realpathSync.native(firmlink), real, 'realpath keeps the firmlink path, so only identity tells');
      for (const folder of [firmlink, firmlink + '/not-yet']) assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: folder }, real), false, folder);
      fs.rmSync(real, { recursive: true }); assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: firmlink }, real), false, 'a profile not made yet, reached through the folder that will hold it');
    }
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(dir, 'other') }, real), true, 'a separate folder still counts');
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(support, 'AciraTest') }, real), true, 'and so does a sibling of the profile');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a packaged build uses the test profile by the very path it judged, and drops a dotted one', () => {
  // main.cjs sets userData from ACIRA_BROWSER_TEST_DATA; it used to get the raw string, which the system resolves its own way.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-settle-')), raw = path.join(dir, 'new-profile');
  try {
    const env = { ACIRA_BROWSER_TEST_DATA: raw, ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(raw, 'downloads') };
    quiet(() => lockDown({ app: fakeApp(true, []), identity, env, platform: 'win32' }));
    assert.ok(fs.statSync(raw).isDirectory(), 'made before anything uses it');
    assert.equal(env.ACIRA_BROWSER_TEST_DATA, fs.realpathSync.native(raw)); assert.equal(env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR, path.join(fs.realpathSync.native(raw), 'downloads'), 'downloads stay inside it');
    const dottedEnv = { ACIRA_BROWSER_TEST_DATA: path.join(dir, 'x') + path.sep + '..' + path.sep + 'y', ACIRA_DEV: '1' };
    quiet(() => lockDown({ app: fakeApp(true, []), identity, env: dottedEnv, platform: 'win32' })); assert.deepEqual(dottedEnv, {}, 'a dotted test profile drops every hook');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8'), /app\.setPath\('userData',process\.env\.ACIRA_BROWSER_TEST_DATA\|\|/, 'userData comes from the settled variable');
});

test('on the person\'s own profile a hand-passed --use-mock-keychain is dropped: it would make their saved sign-ins unreadable', () => {
  for (const platform of ['darwin', 'win32']) { const app = fakeApp(true, [MOCK_KEYCHAIN]), removed = quiet(() => lockDown({ app, identity, env: {}, platform })); assert.deepEqual(app.removed, [MOCK_KEYCHAIN], platform); assert.deepEqual(removed.switches, [MOCK_KEYCHAIN]); }
  const dev = fakeApp(false, [MOCK_KEYCHAIN]); lockDown({ app: dev, identity, env: {} }); assert.deepEqual(dev.removed, [], 'a development checkout keeps it');
});

test('a link to the person\'s own profile does not count as a separate test profile', { skip: process.platform === 'win32' && 'symlinks need rights on Windows' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-link-')), real = path.join(dir, 'AciraBrowser'), link = path.join(dir, 'looks-like-a-test-profile');
  try {
    fs.mkdirSync(real); fs.symlinkSync(real, link);
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: link }, real), false);
    assert.equal(isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: path.join(dir, 'other') }, real), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main.cjs locks down before it reads any hook, and trusts the dev server only while ACIRA_DEV is set', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const lock = main.indexOf("require('./test-hooks.cjs').lockDown(");
  assert.ok(lock > 0, 'main.cjs calls lockDown');
  assert.ok(lock < main.indexOf("require('./browser-services/spellcheck-dictionaries.cjs')"), 'before the dictionary downloads read their address');
  for (const name of HOOK_ENV) { const at = main.search(new RegExp(name + '(?![A-Z0-9_])')); assert.ok(at < 0 || at > lock, name + ' is read before lockDown'); }
  assert.match(main, /const devUI=url=>process\.env\.ACIRA_DEV==='1'&&\/\^http:\\\/\\\/127\\\.0\\\.0\\\.1:5194\\\//, 'the dev origin needs ACIRA_DEV');
  assert.equal((main.match(/127\\\.0\\\.0\\\.1:5194/g) || []).length, 1, 'no other check accepts the dev origin');
  assert.doesNotMatch(main, /startsWith\('http:\/\/127\.0\.0\.1:5194\/'\)/, 'the interface view cannot navigate to the dev server by itself');
  assert.match(main, /const trusted=e=>[^\n]*\|\|devUI\(e\.senderFrame\.url\)\)/);
});

// An ACIRA_ name counts as an environment variable wherever it appears, except as a plain quoted string ('ACIRA_NEWER_DATA', an error code) that is
// not an env['…'] index or an '…' in env test. That exception is only safe while no code looks a variable up by a name it computes, so the test
// also fails on a new dynamic env[name] lookup or an 'ACIRA_' prefix string.
const ENV_NAME = /ACIRA_[A-Z0-9_]*[A-Z0-9]/g;
test('Mac: the profile in the account\'s own home counts as the person\'s, even when appData was moved (CFFIXED_USER_HOME)', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-home-'))), home = path.join(root, 'home'), own = path.join(home, 'Library', 'Application Support', 'AciraBrowser');
  fs.mkdirSync(own, { recursive: true });
  try {
    // appData follows CFFIXED_USER_HOME (the fake app's appData stands for the moved one); the account's home is passed as the user database has it.
    const app = fakeApp(true, ['remote-debugging-port']), env = { ...hooked(), ACIRA_BROWSER_TEST_DATA: own };
    const removed = quiet(() => lockDown({ app, identity, env, platform: 'darwin', homedir: home }));
    assert.equal('ACIRA_BROWSER_TEST_DATA' in env, false, 'the person\'s own profile is not a test profile');
    for (const name of HOOK_ENV) assert.equal(name in env, false, name);
    assert.deepEqual(app.removed, ['remote-debugging-port']); assert.deepEqual(app.added, [], 'no mock keychain on the person\'s own profile');
    assert.ok(removed.env.includes('ACIRA_BROWSER_TEST_DATA'));
    // A real test folder elsewhere is still accepted with that home.
    const rig = path.join(root, 'rig'), rigEnv = { ACIRA_BROWSER_TEST_DATA: rig };
    lockDown({ app: fakeApp(true, []), identity, env: rigEnv, platform: 'darwin', homedir: home });
    assert.equal(rigEnv.ACIRA_BROWSER_TEST_DATA, rig);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a test profile folder that cannot be made stops Acira instead of opening the person\'s own profile', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-fail-'))), file = path.join(root, 'a-file');
  fs.writeFileSync(file, 'x');
  try {
    const codes = [], env = { ...hooked(), ACIRA_BROWSER_TEST_DATA: path.join(file, 'profile') };
    const removed = quiet(() => { const error = console.error; console.error = () => {}; try { return lockDown({ app: fakeApp(true, []), identity, env, platform: 'darwin', homedir: '', exit: code => codes.push(code) }); } finally { console.error = error; } });
    assert.deepEqual(codes, [1], 'it stops');
    assert.equal(removed.stopped, true);
    assert.equal(env.ACIRA_BROWSER_TEST_DATA, path.join(file, 'profile'), 'the test profile is not dropped, so nothing falls back to the person\'s own profile');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the test profile folder is checked again just before Acira locks it: a folder swapped for a link meanwhile stops Acira', { skip: process.platform === 'win32' && 'symlinks need rights on Windows' }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hooks-swap-'))), rig = path.join(root, 'rig'), other = path.join(root, 'other');
  fs.mkdirSync(other);
  try {
    const env = { ACIRA_BROWSER_TEST_DATA: rig };
    lockDown({ app: fakeApp(true, []), identity, env, platform: 'darwin', homedir: '' });
    const userData = { getPath: name => { assert.equal(name, 'userData'); return env.ACIRA_BROWSER_TEST_DATA; } }, codes = [];
    assert.equal(checkJudged(userData, code => codes.push(code)), true, 'unchanged folder: carries on');
    fs.rmSync(rig, { recursive: true }); fs.symlinkSync(other, rig);
    const ok = (() => { const error = console.error; console.error = () => {}; try { return checkJudged(userData, code => codes.push(code)); } finally { console.error = error; } })();
    assert.equal(ok, false); assert.deepEqual(codes, [1]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('main.cjs checks the judged test profile again before it takes the profile lock', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const check = main.indexOf("require('./test-hooks.cjs').checkJudged(app)"), setPath = main.indexOf("app.setPath('userData'"), lock = main.indexOf('app.requestSingleInstanceLock()');
  assert.ok(setPath > 0 && check > setPath && lock > check, 'after userData is set, before the lock');
});

function envNames(source) {
  const names = new Set();
  for (const m of source.matchAll(ENV_NAME)) {
    const quote = source[m.index - 1], after = source.slice(m.index + m[0].length);
    const plainString = ['\'', '"', '`'].includes(quote) && after[0] === quote && !/env\??\.?\[\s*$/.test(source.slice(Math.max(0, m.index - 12), m.index - 1)) && !/^\s*in\b/.test(after.slice(1));
    if (!plainString) names.add(m[0]);
  }
  return names;
}
test('the inventory reads environment variables, not every string that starts with ACIRA_', () => {
  for (const source of ['process.env.ACIRA_A', "env['ACIRA_B']", 'env?.["ACIRA_C"]', "'ACIRA_D' in process.env", 'const {ACIRA_E}=process.env', '"Verify($env:ACIRA_F)"', '{...env,ACIRA_G:message}', '`${process.env.ACIRA_H}`'])
    assert.equal(envNames(source).size, 1, source);
  for (const source of ["const NEWER='ACIRA_NEWER_DATA'", 'code:"ACIRA_RUNNING"', 'const MARKER=`ACIRA_QUERY_PLACEHOLDER_73C9`']) assert.equal(envNames(source).size, 0, source);
});

test('every ACIRA_ variable the shipped code reads is either dropped in real builds or listed as kept, with a reason', () => {
  const { KEPT_ENV } = require('../desktop/test-hooks.cjs');
  const desktop = path.join(__dirname, '..', 'desktop'), seen = new Set(), dynamic = [];
  // The only lookups by a computed name: lockDown going through HOOK_ENV, and Windows %VARIABLE% expansion of registry values.
  const knownDynamic = new Set(['test-hooks.cjs', path.join('accounts', 'default-browser.cjs')]);
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(c?js|mjs)$/.test(entry.name) && !['runtime.cjs', 'i18n.cjs'].includes(entry.name)) {
    const source = fs.readFileSync(file, 'utf8'), relative = path.relative(desktop, file);
    for (const name of envNames(source)) seen.add(name);
    if (!knownDynamic.has(relative) && (/env\??\.?\[\s*[^\s'"`\]]/.test(source) || /['"`]ACIRA_['"`]/.test(source))) dynamic.push(relative);
  } } };
  walk(desktop);
  assert.deepEqual(dynamic, [], 'these look an environment variable up by a computed name: list what they can read in desktop/test-hooks.cjs and here');
  for (const name of ['ACIRA_DEV', 'ACIRA_UPDATE_FEED', 'ACIRA_PASSWORDS_TEST_GATE', 'ACIRA_BROWSER_TEST_DATA']) assert.ok(seen.has(name), name + ' is found');
  for (const name of ['ACIRA_NEWER_DATA', 'ACIRA_DAMAGED_DATA', 'ACIRA_UPGRADE_FAILED', 'ACIRA_QUERY_PLACEHOLDER_73C9']) assert.equal(seen.has(name), false, name + ' is a string, not a variable');
  const unclassified = [...seen].filter(name => !HOOK_ENV.includes(name) && !Object.hasOwn(KEPT_ENV, name)).sort();
  assert.deepEqual(unclassified, [], 'classify these in desktop/test-hooks.cjs (HOOK_ENV or KEPT_ENV)');
  for (const [name, why] of Object.entries(KEPT_ENV)) { assert.ok(typeof why === 'string' && why.length > 10, name); assert.ok(seen.has(name), name + ' is listed as kept but nothing reads it'); }
  for (const name of HOOK_ENV) assert.equal(Object.hasOwn(KEPT_ENV, name), false, name + ' cannot be both');
});

test('every ACIRA_ variable the installers and the Windows uninstaller read is listed in TEST_HOOKS.md', () => {
  // These run as their own programs, so test-hooks.cjs cannot drop anything for them: each one is at least written down, with what it does.
  const root = path.join(__dirname, '..'), packaging = path.join(root, 'packaging'), seen = new Map();
  const programs = [
    ...fs.readdirSync(path.join(packaging, 'installer')).filter(name => name.endsWith('.cs')).map(name => path.join('installer', name)),
    'acira-installer.nsh',
    ...['installer-main.cjs', 'install-engine.cjs', 'installer-page.cjs', 'installer-preload.cjs', 'running-app.cjs', 'strings.cjs'].map(name => path.join('macos', name)),
  ];
  const reads = /GetEnvironmentVariable\("(ACIRA_[A-Z0-9_]+)"\)|ReadEnvStr\s+\$\w+\s+(ACIRA_[A-Z0-9_]+)|process\.env\.(ACIRA_[A-Z0-9_]+)/g;
  for (const file of programs) for (const m of fs.readFileSync(path.join(packaging, file), 'utf8').matchAll(reads)) seen.set(m[1] || m[2] || m[3], file);
  assert.ok(seen.has('ACIRA_UNINSTALL_SCALE') && seen.has('ACIRA_INSTALLER_TEST_MODE'), 'the scan finds the installer variables');
  const doc = fs.readFileSync(path.join(root, 'docs', 'launch', 'TEST_HOOKS.md'), 'utf8'), table = doc.slice(doc.indexOf('## Installers and the Windows uninstaller'));
  assert.ok(table.length < doc.length, 'TEST_HOOKS.md has the installer table');
  const missing = [...seen].filter(([name]) => !new RegExp('`' + name + '`').test(table)).map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(missing, [], 'add these to the installer table in docs/launch/TEST_HOOKS.md');
});
