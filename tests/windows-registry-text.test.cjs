'use strict';
// Windows only in real life, run here on any computer: reg.exe prints its text in the console's OEM code page when piped and Node reads it as UTF-8, so a
// non-ASCII letter in the user's folder (C:\Users\José) arrives as U+FFFD, "?" or a look-alike ASCII letter. Two readers depended on that text being exact:
// the default-browser registration check (accounts/default-browser.cjs commandMatches) and the native-messaging host lookup (native-messaging.cjs findHost).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { sameAsGarbled, repairPath, garbledSource, hasNonAscii } = require('../desktop/windows-registry-text.cjs');
const { commandMatches } = require('../desktop/accounts/default-browser.cjs');
const { findHost } = require('../desktop/browser-services/native-messaging.cjs');

/** What `reg query` piped through a code page hands Node, in the three ways a letter can come out. */
const garble = (text, how) => [...text].map(ch => ch.codePointAt(0) < 128 ? ch : how === 'fffd' ? '\uFFFD' : how === 'question' ? '?' : (ch.normalize('NFD')[0] || 'x').replace(/[^\x00-\x7f]/, 'x')).join('');

const NAMES = ['José', 'Müller', 'محمد', '李雷', 'Łukasz Żółć', 'Zoë'];
const exeOf = name => `C:\\Users\\${name}\\AppData\\Local\\Programs\\Acira Browser\\AciraBrowser.exe`;

test('the default-browser check accepts its own program whatever way reg.exe garbled the user name', () => {
  for (const name of NAMES) for (const how of ['fffd', 'question', 'best']) {
    const executable = exeOf(name), registered = `"${garble(executable, how)}" "%1"`;
    assert.equal(commandMatches(registered, executable), true, `${name} / ${how}: ${registered}`);
  }
});

test('the default-browser check still says no to another program, another folder or a longer path', () => {
  const executable = exeOf('José');
  const wrong = [
    '"C:\\Users\\Jos\uFFFD\\AppData\\Local\\Programs\\Other Browser\\AciraBrowser.exe" "%1"',
    '"C:\\Users\\Jos\uFFFD\\AppData\\Local\\Programs\\Acira Browser\\Other.exe" "%1"',
    '"C:\\Users\\Jos\uFFFD\\x\\AppData\\Local\\Programs\\Acira Browser\\AciraBrowser.exe" "%1"',
    '"D:\\Users\\Jos\uFFFD\\AppData\\Local\\Programs\\Acira Browser\\AciraBrowser.exe" "%1"',
    '"C:\\Users\\Jos\uFFFD\\AppData\\Local\\Programs\\Acira Browser\\AciraBrowser.exe"',
    '"C:\\Users\\\\AppData\\Local\\Programs\\Acira Browser\\AciraBrowser.exe" "%1"',
  ];
  for (const command of wrong) assert.equal(commandMatches(command, executable), false, command);
  // an ASCII program path is compared exactly, as before
  assert.equal(commandMatches('"C:\\Users\\Jo\\A.exe" "%1"', 'C:\\Users\\Jo\\A.exe'), true);
  assert.equal(commandMatches('"C:\\Users\\Jx\\A.exe" "%1"', 'C:\\Users\\Jo\\A.exe'), false);
  assert.equal(commandMatches('"C:\\Users\\J\uFFFD\\A.exe" "%1"', 'C:\\Users\\Jo\\A.exe'), false, 'garbage is never accepted for an ASCII path');
});

test('sameAsGarbled: ASCII parts and path shape must agree, only the non-ASCII letters are loose', () => {
  assert.equal(sameAsGarbled('C:\\Users\\Jos\uFFFD\\a', 'C:\\Users\\José\\a'), true);
  assert.equal(sameAsGarbled('c:\\users\\jos?\\a', 'C:\\Users\\José\\A'), true, 'letter case is not compared');
  assert.equal(sameAsGarbled('C:\\Users\\Jos\uFFFD\\b', 'C:\\Users\\José\\a'), false);
  assert.equal(sameAsGarbled('C:\\Users\\Jos\uFFFD\\sub\\a', 'C:\\Users\\José\\a'), false, 'a letter never stands for a separator');
  assert.equal(sameAsGarbled('C:\\Users\\Jos\\a', 'C:\\Users\\José\\a'), false, 'a letter is never nothing');
  assert.equal(sameAsGarbled(null, 'x'), false);
  assert.equal(hasNonAscii('abc'), false);
  assert.ok(garbledSource('a.b').includes('\\.'), 'ASCII is escaped, not interpreted');
});

test('repairPath puts the real folder back at the start, and leaves everything else alone', () => {
  const home = 'C:\\Users\\José', roaming = home + '\\AppData\\Roaming';
  assert.equal(repairPath('C:\\Users\\Jos\uFFFD\\AppData\\Roaming\\Bitwarden\\host.json', [roaming, home]), roaming + '\\Bitwarden\\host.json', 'longest known folder first');
  assert.equal(repairPath('C:\\Users\\Jos?\\AppData\\Roaming\\x.json', [home]), home + '\\AppData\\Roaming\\x.json');
  assert.equal(repairPath('C:\\Users\\Jos\uFFFD', [home]), home, 'the folder itself');
  assert.equal(repairPath('C:\\Users\\Jos\uFFFDxyz\\a.json', [home]), 'C:\\Users\\Jos\uFFFDxyz\\a.json', 'a name much longer than the folder is a different folder');
  assert.equal(repairPath('C:\\Program Files\\Bitwarden\\host.json', [home]), 'C:\\Program Files\\Bitwarden\\host.json');
  assert.equal(repairPath('C:\\Users\\Joe\\x.json', ['C:\\Users\\Joe']), 'C:\\Users\\Joe\\x.json', 'ASCII roots are never needed');
  assert.equal(repairPath(null, [home]), null);
  assert.equal(repairPath('C:\\Users\\Jos\uFFFD\\x', undefined), 'C:\\Users\\Jos\uFFFD\\x');
});

test('a native-messaging manifest under a non-ASCII profile folder is found (reg.exe printed the path garbled)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-nm-José-')), home = root;
  try {
    const roaming = path.join(home, 'AppData', 'Roaming', 'Bitwarden'); fs.mkdirSync(roaming, { recursive: true });
    const exe = path.join(roaming, 'desktop_proxy.exe'); fs.writeFileSync(exe, '');
    const manifest = path.join(roaming, 'com.8bit.bitwarden.json');
    fs.writeFileSync(manifest, JSON.stringify({ name: 'com.8bit.bitwarden', description: 't', path: exe, type: 'stdio', allowed_origins: ['chrome-extension://abc/'] }));
    const garbled = garble(manifest, 'fffd'), asked = [];
    const query = async key => { asked.push(key); return key.startsWith('HKCU\\Software\\Google\\Chrome\\') ? garbled : null; };
    const found = await findHost('com.8bit.bitwarden', 'chrome-extension://abc/', null, { platform: 'win32', query, home, env: {} });
    assert.deepEqual(found, { exe }, 'the folder name was put back before the file was read');
    assert.ok(asked.includes('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.8bit.bitwarden'));
    // an ASCII manifest path is passed through untouched
    const plain = await findHost('com.8bit.bitwarden', 'chrome-extension://abc/', null, { platform: 'win32', query: async key => key.startsWith('HKCU\\Software\\Google\\Chrome\\') ? manifest : null, home, env: {} });
    assert.deepEqual(plain, { exe });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a host a 32-bit installer registered for the whole machine is found (Chrome reads the 32-bit registry view; a plain 64-bit query does not see Wow6432Node)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-nm-view-'));
  try {
    const exe = path.join(root, 'host.exe'); fs.writeFileSync(exe, '');
    const manifest = path.join(root, 'com.vendor.host.json');
    fs.writeFileSync(manifest, JSON.stringify({ name: 'com.vendor.host', description: 't', path: exe, type: 'stdio', allowed_origins: ['chrome-extension://abc/'] }));
    const asked = [];
    // Only the 32-bit view of HKLM has the key, as after a 32-bit installer ran on 64-bit Windows.
    const query = async (key, view) => { asked.push([key, view]); return key.startsWith('HKLM\\Software\\Google\\Chrome\\') && view === '32' ? manifest : null; };
    assert.deepEqual(await findHost('com.vendor.host', 'chrome-extension://abc/', null, { platform: 'win32', query, home: root, env: {} }), { exe });
    assert.ok(asked.some(([key, view]) => key.startsWith('HKLM\\') && view === '32'), 'HKLM is read in the 32-bit view');
    assert.ok(asked.some(([key, view]) => key.startsWith('HKLM\\') && view === undefined), 'and in the default view');
    assert.ok(asked.filter(([key]) => key.startsWith('HKCU\\')).every(([, view]) => view === undefined), 'HKCU is one view');
    // a host only the 64-bit view has still works
    const only64 = await findHost('com.vendor.host', 'chrome-extension://abc/', null, { platform: 'win32', query: async (key, view) => key.startsWith('HKLM\\Software\\Microsoft\\Edge\\') && view === undefined ? manifest : null, home: root, env: {} });
    assert.deepEqual(only64, { exe });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
