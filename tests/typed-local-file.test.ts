import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { typedLocalFile, typedLocalPath } from '../src/runtime/localPath';
import { resolveNavigation } from '../src/runtime/navigation';

// 13.5 (hunt-f 11): C:\Users\me\file.pdf typed or pasted into the address bar (Explorer's "Copy as path" adds quotes) was searched on the web, and
// \\server\share\x.txt became the plain-http address http://server/share/x.txt. A path that names an existing file now opens like a dropped file, a
// network share path is refused, and everything else stays with the address bar as before.
const files = (...list: string[]) => (path: string) => list.includes(path);
const win = (...list: string[]) => ({ platform: 'win32', isFile: files(...list) });
const mac = (...list: string[]) => ({ platform: 'darwin', isFile: files(...list) });

test('on 13.4 the address bar searched these (why the paths are told to main first)', () => {
  for (const text of ['C:\\Users\\me\\Documents\\file.pdf', 'C:/Users/me/file.html', '"C:\\Users\\me\\salary 2026.xlsx"', '/Users/me/x.pdf']) {
    const target = resolveNavigation(text);
    assert.match(target.url, /^https:\/\/www\.google\.com\/search\?/, text);
  }
  assert.match(resolveNavigation('\\\\server.corp.local\\share\\x.txt').url, /^http:\/\/server\.corp\.local\/share\/x\.txt/);
});

test('a typed path is recognised: drive letter, network share, absolute path, with or without Explorer\u2019s quotes', () => {
  assert.deepEqual(typedLocalPath('C:\\Users\\me\\a.pdf'), { kind: 'drive', path: 'C:\\Users\\me\\a.pdf' });
  assert.deepEqual(typedLocalPath('  "D:\\My Files\\salary 2026.xlsx"  '), { kind: 'drive', path: 'D:\\My Files\\salary 2026.xlsx' });
  assert.deepEqual(typedLocalPath('c:/temp/a.html'), { kind: 'drive', path: 'c:/temp/a.html' });
  assert.deepEqual(typedLocalPath('\\\\server\\share\\a.html'), { kind: 'unc', path: '\\\\server\\share\\a.html' });
  assert.deepEqual(typedLocalPath('/Users/me/my file.pdf'), { kind: 'posix', path: '/Users/me/my file.pdf' });
  for (const text of ['', ' ', 'C:', 'C:\\', 'D:', 'example.com', 'https://example.com/a', 'file:///C:/a.pdf', 'site:example.com', 'c:foo', '\\\\', '\\\\server', '//cdn.example.com/x.js', '/', 'C:\\a\u0000b', 'x'.repeat(5000), 'weather in C:\\ drive', '"C:\\a.pdf', 'a "C:\\a.pdf"'])
    assert.equal(typedLocalPath(text), null, JSON.stringify(text.slice(0, 40)));
  for (const junk of [undefined, null, 7, {}, []]) assert.equal(typedLocalPath(junk), null);
});

test('Windows: a drive path that is a file that exists opens, quoted or not, with either slash', () => {
  const have = win('C:\\Users\\me\\Documents\\salary 2026.xlsx', 'C:/temp/a.html');
  assert.deepEqual(typedLocalFile('"C:\\Users\\me\\Documents\\salary 2026.xlsx"', have), { action: 'open', file: 'C:\\Users\\me\\Documents\\salary 2026.xlsx' });
  assert.deepEqual(typedLocalFile('C:\\Users\\me\\Documents\\salary 2026.xlsx', have), { action: 'open', file: 'C:\\Users\\me\\Documents\\salary 2026.xlsx' });
  assert.deepEqual(typedLocalFile('C:/temp/a.html', have), { action: 'open', file: 'C:/temp/a.html' });
});

test('Windows: a path that is not a file, or a search that starts with a path, is left to the address bar', () => {
  const have = win('C:\\Users\\me\\a.pdf');
  for (const text of ['C:\\Users\\me\\missing.pdf', 'C:\\Windows\\System32\\foo.dll missing', 'C:\\Users\\me\\Documents', 'C:\\Users\\me\\a.pdf is this safe', 'hello', 'example.com', '/Users/me/a.pdf'])
    assert.deepEqual(typedLocalFile(text, have), { action: 'none' }, text);
  assert.deepEqual(typedLocalFile('C:\\Users\\me\\a.pdf', { platform: 'win32', isFile: () => { throw new Error('EPERM'); } }), { action: 'none' }, 'a file check that fails is not a file');
});

test('Windows: a network share path is refused, never opened, looked up or sent to a host', () => {
  let looked = 0;
  const options = { platform: 'win32', isFile: () => { looked++; return true; } };
  for (const text of ['\\\\server\\share\\a.html', '"\\\\server.corp.local\\share\\x.txt"', '\\\\192.168.1.5\\c$\\a.pdf']) assert.deepEqual(typedLocalFile(text, options), { action: 'refuse' }, text);
  assert.equal(looked, 0, 'the disk (and the network) is not asked about a share');
});

test('Mac and Linux: an absolute path to a file opens; backslash and drive paths are only text there', () => {
  const have = mac('/Users/me/my file.pdf');
  assert.deepEqual(typedLocalFile('/Users/me/my file.pdf', have), { action: 'open', file: '/Users/me/my file.pdf' });
  assert.deepEqual(typedLocalFile('/Users/me/missing.pdf', have), { action: 'none' });
  assert.deepEqual(typedLocalFile('C:\\Users\\me\\a.pdf', { platform: 'darwin', isFile: () => true }), { action: 'none' });
  assert.deepEqual(typedLocalFile('\\\\server\\share\\a.html', { platform: 'linux', isFile: () => true }), { action: 'none' });
});

test('the address bar asks main first, and main answers with the file opener the drop already uses', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(app, /if \(!typedLocalPath\(text\)\) \{ navigateTo\(input, tabId, typed\); return; \}/);
  assert.match(app, /runtime\.service\(\{ type: 'typed-file\.open', text \}\)/);
  // Enter on the first suggestion row arrives as the search URL plus the typed text: the typed text is what is asked about, only when the row is that search.
  assert.match(app, /const text = typed !== undefined && resolveNavigation\(typed, [^;]*\)\.url === input \? typed : input;/);
  assert.match(main, /case 'typed-file\.open':\{shape\(\['text'\]\);if\(privateMode\|\|torMode/);
  assert.match(main, /typedLocalFile\(request\.text,\{platform:process\.platform/);
  assert.match(main, /openDroppedFile\(pathToFileURL\(verdict\.file\)\.href\)/);
  assert.ok(!/[^\x00-\x7f]/.test(main.slice(main.indexOf("case 'typed-file.open'"), main.indexOf("case 'imports.discover'"))), 'main.cjs stays ASCII (one non-ASCII letter doubles the script\u2019s memory)');
});
