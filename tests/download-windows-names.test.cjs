'use strict';
// A file made under a Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with or without an extension) opens the device instead: the download fails or is
// written nowhere. Chromium's own names put an underscore in front. The Windows rule is run here on any computer by naming the platform.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { nextFreePath, deviceSafe } = require('../desktop/download-preferences.cjs');
const { safeName, chooseDestination } = require('../desktop/browser-services/ext-api/downloads/destination.cjs');

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-names-'));

test('on Windows a download named like a device gets an underscore in front, whatever its extension or letter case', () => {
  const dir = folder();
  try {
    for (const [asked, saved] of [['aux.pdf', '_aux.pdf'], ['CON', '_CON'], ['nul.tar.gz', '_nul.tar.gz'], ['Com1.txt', '_Com1.txt'], ['LPT9', '_LPT9'], ['prn.js', '_prn.js'], ['clock$.txt', '_clock$.txt'], ['con.', '_con'], ['AUX ', '_AUX']]) {
      assert.equal(path.basename(nextFreePath(dir, asked, () => false, 'win32')), saved, asked);
    }
    // names that only start like one, or have it later, are ordinary
    for (const name of ['auxiliary.pdf', 'console.log', 'my.aux', 'com10.txt', 'lpt0.txt', 'nullable.txt', 'report (1).pdf', 'icon.png']) {
      assert.equal(path.basename(nextFreePath(dir, name, () => false, 'win32')), name, name);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// On a real Windows computer the existence probe of "aux.pdf" itself reaches the device, so this check of the other systems' rule is for the other systems.
test('other systems keep the name: aux.pdf is an ordinary file there', { skip: process.platform === 'win32' && 'a device name cannot be probed on Windows itself' }, () => {
  const dir = folder();
  try {
    for (const platform of ['darwin', 'linux']) assert.equal(path.basename(nextFreePath(dir, 'aux.pdf', () => false, platform)), 'aux.pdf');
    assert.equal(deviceSafe('nul', 'darwin'), 'nul');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the numbered copies of a device-named download are ordinary names', () => {
  const dir = folder();
  try {
    fs.writeFileSync(path.join(dir, '_aux.pdf'), '');
    assert.equal(path.basename(nextFreePath(dir, 'aux.pdf', () => false, 'win32')), '_aux (1).pdf');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an extension\'s chrome.downloads filename gets the same treatment, in every part of its path', async () => {
  assert.equal(safeName('nul.txt', 'win32'), '_nul.txt');
  assert.equal(safeName('nul.txt', 'darwin'), 'nul.txt');
  const dir = folder();
  try {
    const run = filename => chooseDestination({ item: { getFilename: () => 'x.bin' }, owner: null, dialog: null, preferences: null, app: { getPath: () => dir }, testDir: dir, request: { filename } });
    const result = await run('out/aux.pdf');
    // on this computer the Windows rule applies only when this computer is Windows; the platform-aware name is what the call uses
    assert.equal(path.basename(result.filePath), process.platform === 'win32' ? '_aux.pdf' : 'aux.pdf');
    assert.equal(path.dirname(result.filePath), path.join(dir, 'out'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Windows without long-path support cannot create a file whose full path is 260 characters or more (MAX_PATH, end mark included). A name inside the file system's 255 bytes
// can still be too long in a deep folder: the download failed at once. Chrome shortens such a name; so does Acira, on Windows only.
test('on Windows a long name is cut to fit MAX_PATH with the folder, " (9999)" and ".crdownload"; other systems keep the 255-byte rule', () => {
  const { windowsNameUnits } = require('../desktop/download-preferences.cjs');
  const root = folder();
  try {
    // the deepest folder keeps the whole path near 190 characters whatever the temp folder is (the rule never goes below 24 characters of name)
    for (const depth of [0, 40, Math.max(1, Math.min(120, 190 - root.length))]) {
      const dir = path.join(root, depth ? 'd'.repeat(depth) : '.');
      for (const long of ['a'.repeat(400) + '.pdf', '日本語'.repeat(120) + '.tar.gz', '😀'.repeat(150) + '.txt']) {
        const win = nextFreePath(dir, long, () => false, 'win32');
        assert.ok(win.length + ' (9999)'.length + '.crdownload'.length <= 259, `${depth}: ${win.length}`);
        assert.equal(path.extname(win), path.extname(long), 'the extension is kept');
        assert.ok(!path.basename(win).includes('\uFFFD') && !/[\uD800-\uDBFF]$/.test(path.basename(win, path.extname(win))), 'cut between characters, not inside one');
        fs.writeFileSync(win, 'x');
        const again = nextFreePath(dir, long, () => false, 'win32');
        assert.notEqual(again, win);
        assert.ok(again.length + '.crdownload'.length <= 259, 'the numbered copy fits too');
        const other = nextFreePath(dir, long, () => false, 'linux');
        assert.ok(Buffer.byteLength(path.basename(other)) <= 255 - '.crdownload'.length, 'on other systems only the 255-byte rule applies (the name may be a numbered copy of the one Windows cut)');
      }
    }
    assert.equal(windowsNameUnits(root, 'darwin'), Infinity);
    assert.equal(windowsNameUnits('C:\\x'.padEnd(300, 'y'), 'win32'), 24, 'a very deep folder still leaves a usable name');
    assert.equal(windowsNameUnits('C:\\Users\\Khaled\\Downloads', 'win32'), 259 - 'C:\\Users\\Khaled\\Downloads'.length - 1 - 7 - 11);
    // short names are untouched, deep folder or not
    assert.equal(path.basename(nextFreePath(path.join(root, 'd'.repeat(120)), 'report.pdf', () => false, 'win32')), 'report.pdf');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// chrome.downloads.download (an extension's download) takes its own route to a path: it must hold on a drive or share root, and the long-name rules.
test('an extension download into a drive root or a share root is inside that folder (the root already ends with a separator)', () => {
  const { insideFolder } = require('../desktop/browser-services/ext-api/downloads/destination.cjs');
  assert.equal(path.win32.resolve('D:\\'), 'D:\\', 'a drive root keeps its trailing separator');
  assert.equal(insideFolder(path.win32.resolve('D:\\', 'a.txt'), path.win32.resolve('D:\\'), path.win32), true);
  assert.equal(insideFolder(path.win32.resolve('D:\\', 'sub', 'a.txt'), 'D:\\', path.win32), true);
  assert.equal(insideFolder('\\\\nas\\downloads\\a.txt', path.win32.resolve('\\\\nas\\downloads'), path.win32), true);
  assert.equal(insideFolder('E:\\a.txt', 'D:\\', path.win32), false, 'another drive is outside');
  assert.equal(insideFolder('D:\\Downloads2\\a.txt', 'D:\\Downloads', path.win32), false, 'a folder that only starts with the same letters is outside');
  assert.equal(insideFolder('D:\\Downloads', 'D:\\Downloads', path.win32), true);
  assert.equal(insideFolder('/a.txt', '/', path.posix), true, 'the root of a Unix file system too');
  assert.equal(insideFolder('/tmp/x/a.txt', '/tmp/x', path.posix), true);
  assert.equal(insideFolder('/tmp/xy/a.txt', '/tmp/x', path.posix), false);
});

test('an extension download with a long name is cut to fit: 255 bytes everywhere, MAX_PATH on Windows', async () => {
  const { chooseDestination } = require('../desktop/browser-services/ext-api/downloads/destination.cjs');
  const root = folder();
  try {
    const dir = path.join(root, 'd'.repeat(60));
    const run = (platform, filename) => chooseDestination({ item: { getFilename: () => 'x.bin' }, owner: null, dialog: null, preferences: null, app: { getPath: () => dir }, testDir: dir, request: { filename }, platform });
    const long = 'a'.repeat(300) + '.txt';
    const win = (await run('win32', long)).filePath;
    assert.ok(win.length + ' (9999)'.length + '.crdownload'.length <= 259, `Windows path ${win.length}`);
    assert.equal(path.extname(win), '.txt');
    const other = (await run('linux', long)).filePath;
    assert.ok(Buffer.byteLength(path.basename(other)) <= 255 - ' (9999)'.length - '.crdownload'.length, 'the 255-byte rule applies on every system');
    assert.ok(path.basename(other).length > path.basename(win).length, 'only Windows has the shorter path limit');
    // a short name and a name inside a sub folder are untouched
    assert.equal(path.basename((await run('win32', 'out/report.pdf')).filePath), 'report.pdf');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
