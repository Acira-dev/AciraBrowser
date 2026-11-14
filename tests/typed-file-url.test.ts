import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { typedFileUrl, typedLocalFile, typedLocalPath } from '../src/runtime/localPath';
import { resolveNavigation } from '../src/runtime/navigation';
import { createInitialState, reduceBrowser } from '../src/runtime/core';

// 13.9 (an acceptance pass): typing file:///path/to/file.pdf into the address bar, the New Tab page's own field or the toolbar's, and pressing Enter left the tab where it was
// (resolveNavigation refuses every scheme but http and https and the address bar showed "Acira opens only http and https addresses"), while Open a file opened the same file. Now a typed file:
// address is checked like a dropped file (a local regular file of an allowed kind, never a network share or credentials) and the tab it was typed in goes to it, as Chrome does.
// What stays: a web page cannot navigate to a file (resolveNavigation, tab.navigate and the page's own navigations are unchanged), a typed PATH still opens a tab of its own (13.5).
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r/g, '');
const files = (...list: string[]) => (path: string) => list.includes(path);
const mac = (...list: string[]) => ({ platform: 'darwin', isFile: files(...list) });
const win = (...list: string[]) => ({ platform: 'win32', isFile: files(...list) });

test('before: the address bar refused a typed file address (why main is asked first now)', () => {
  const target = resolveNavigation('file:///Users/me/a.pdf');
  assert.equal(target.error, 'Acira opens only http and https addresses.');
  assert.equal(target.url, 'acira://new');
  // the reducer's own navigation is still refused: a typed file address never reaches tab.navigate
  let s = createInitialState();
  const id = s.tabs[0].id, before = s.tabs[0].url;
  s = reduceBrowser(s, { type: 'tab.navigate', url: 'file:///Users/me/a.pdf', tabId: id });
  assert.equal(s.tabs.find(t => t.id === id)!.url, before, 'the web-page path and tab.navigate stay refused');
});

test('a typed file address is the local path it names: Mac and Linux paths, Windows drive paths, localhost, percent-encoding, a quoted-free text', () => {
  assert.deepEqual(typedFileUrl('file:///Users/me/a.pdf'), { kind: 'posix', path: '/Users/me/a.pdf', url: true });
  assert.deepEqual(typedFileUrl('  FILE:///Users/me/my%20file.pdf  '), { kind: 'posix', path: '/Users/me/my file.pdf', url: true });
  assert.deepEqual(typedFileUrl('file://localhost/Users/me/a.pdf'), { kind: 'posix', path: '/Users/me/a.pdf', url: true });
  assert.deepEqual(typedFileUrl('file:///C:/Users/me/a.pdf'), { kind: 'drive', path: 'C:/Users/me/a.pdf', url: true });
  assert.deepEqual(typedFileUrl('file:///c:/temp/a%23b.html'), { kind: 'drive', path: 'c:/temp/a#b.html', url: true });
  assert.deepEqual(typedFileUrl('file:///Users/me/a.pdf#page=2'), { kind: 'posix', path: '/Users/me/a.pdf', url: true }, 'a fragment is not part of the path');
  assert.deepEqual(typedFileUrl('file://server.corp/share/x.txt'), { kind: 'unc', path: '\\\\server.corp\\share\\x.txt', url: true }, 'the host of another machine is a network share');
});

test('what is not a typed file address: other schemes, file: without the slashes, credentials, a bare root, broken escapes, control characters, junk', () => {
  for (const text of ['', ' ', 'https://example.com/a', 'file:/Users/me/a.pdf', 'file:Users/me/a.pdf', 'file:///', 'file://localhost', 'file:///%ZZ', 'file://me:pw@localhost/a.pdf', 'file://me@localhost/a.pdf', 'file:///a\u0000b', '/Users/me/a.pdf', 'C:\\a.pdf', 'example.com', 'x'.repeat(5000)])
    assert.equal(typedFileUrl(text), null, JSON.stringify(text.slice(0, 40)));
  for (const junk of [undefined, null, 7, {}, []]) assert.equal(typedFileUrl(junk), null);
  // typedLocalPath (13.5, typed paths) is unchanged: a file: address is not one of its paths
  assert.equal(typedLocalPath('file:///C:/a.pdf'), null);
  assert.deepEqual(typedLocalPath('/Users/me/a.pdf'), { kind: 'posix', path: '/Users/me/a.pdf' });
});

test('what main does with it: a file that exists opens, a network share is refused on Windows, everything else is the address bar\u2019s (its error), per platform', () => {
  assert.deepEqual(typedLocalFile('file:///Users/me/a.pdf', mac('/Users/me/a.pdf')), { action: 'open', file: '/Users/me/a.pdf' });
  assert.deepEqual(typedLocalFile('file:///Users/me/my%20file.pdf', mac('/Users/me/my file.pdf')), { action: 'open', file: '/Users/me/my file.pdf' });
  assert.deepEqual(typedLocalFile('file:///C:/Users/me/a.pdf', win('C:/Users/me/a.pdf')), { action: 'open', file: 'C:/Users/me/a.pdf' });
  assert.deepEqual(typedLocalFile('file://server/share/x.txt', win()), { action: 'refuse' });
  assert.deepEqual(typedLocalFile('file://server/share/x.txt', mac()), { action: 'none' }, 'on a Mac a network host is just not a file');
  assert.deepEqual(typedLocalFile('file:///Users/me/missing.pdf', mac()), { action: 'none' }, 'a missing file or a folder');
  assert.deepEqual(typedLocalFile('file:///C:/Users/me/a.pdf', mac('C:/Users/me/a.pdf')), { action: 'none' }, 'a drive path is not a path on a Mac');
  assert.deepEqual(typedLocalFile('file:///Users/me/a.pdf', win('/Users/me/a.pdf')), { action: 'none' }, 'nor a posix path on Windows');
  assert.deepEqual(typedLocalFile('file:///Users/me/a.pdf', { platform: 'darwin', isFile: () => { throw new Error('denied'); } }), { action: 'none' });
  // typed paths: as before
  assert.deepEqual(typedLocalFile('/Users/me/a.pdf', mac('/Users/me/a.pdf')), { action: 'open', file: '/Users/me/a.pdf' });
});

test('tab.open-file with a tab: that tab goes to the file as a navigation does (history, title, loading), the New Tab page is replaced, no tab is added', () => {
  let s = createInitialState();
  const first = s.tabs[0].id;
  assert.equal(s.tabs[0].url, 'acira://new');
  s = reduceBrowser(s, { type: 'tab.open-file', url: 'file:///Users/me/notes.pdf', title: 'notes.pdf', tabId: first });
  assert.equal(s.tabs.length, 1, 'no new tab');
  const tab = s.tabs.find(t => t.id === first)!;
  assert.deepEqual([tab.url, tab.contentKind, tab.title, tab.loading, tab.error, tab.requestedUrl], ['file:///Users/me/notes.pdf', 'web', 'notes.pdf', true, null, 'file:///Users/me/notes.pdf']);
  assert.deepEqual(tab.history, ['acira://new', 'file:///Users/me/notes.pdf']);
  assert.equal(tab.historyIndex, 1);
  assert.deepEqual([tab.canGoBack, tab.canGoForward], [false, false], 'a page that was not a website: the website\u2019s own history starts here, as after any navigation from the New Tab page');
  assert.equal(s.activeTabId, first);
  // a website tab: its history keeps what came before; typing the same address again is not a second entry
  let t = createInitialState();
  const id = t.tabs[0].id;
  t = reduceBrowser(t, { type: 'tab.navigate', url: 'https://example.com/', tabId: id });
  t = reduceBrowser(t, { type: 'tab.open-file', url: 'file:///Users/me/a.pdf', title: 'a.pdf', tabId: id });
  assert.deepEqual(t.tabs[0].history.slice(-2), ['https://example.com/', 'file:///Users/me/a.pdf']);
  const n = t.tabs[0].history.length;
  t = reduceBrowser(t, { type: 'tab.open-file', url: 'file:///Users/me/a.pdf', title: 'a.pdf', tabId: id });
  assert.equal(t.tabs[0].history.length, n, 'the same address again changes no history');
  assert.equal(t.tabs[0].loading, true, 'but it loads again');
});

test('tab.open-file without a tab (a drop, Open a file, a typed PATH) still opens a tab of its own next to the current one; an unknown tab, a private tab and a non-file address do not navigate anything', () => {
  let s = createInitialState();
  const first = s.tabs[0].id;
  s = reduceBrowser(s, { type: 'tab.open-file', url: 'file:///Users/me/a.pdf', title: 'a.pdf' });
  assert.equal(s.tabs.length, 2);
  assert.equal(s.tabs[0].url, 'acira://new', 'the first tab stays');
  assert.equal(s.tabs.find(t => t.id === s.activeTabId)!.url, 'file:///Users/me/a.pdf');
  const before = createInitialState();
  const unknown = reduceBrowser(before, { type: 'tab.open-file', url: 'file:///Users/me/a.pdf', title: 'a.pdf', tabId: 'nobody' });
  assert.equal(unknown.tabs.length, 2, 'an unknown tab: a tab of its own, like a drop');
  const priv = createInitialState();
  priv.tabs[0] = { ...priv.tabs[0], privacy: 'private' } as typeof priv.tabs[0];
  const kept = reduceBrowser(priv, { type: 'tab.open-file', url: 'file:///Users/me/a.pdf', title: 'a.pdf', tabId: priv.tabs[0].id });
  assert.equal(kept.tabs[0].url, 'acira://new', 'a private tab is never navigated to a file by this');
  for (const url of ['https://example.com/', 'javascript:alert(1)', 'file://server/share/x.txt', 'data:text/html,x', 'acira://settings'])
    assert.equal(reduceBrowser(before, { type: 'tab.open-file', url, tabId: first }).tabs[0].url, 'acira://new', url);
});

test('the pieces: the address bar names the tab only for a typed file address, main checks the tab and the file, the renderer still cannot ask for a file tab', () => {
  const app = read('src/App.tsx'), main = read('desktop/main.cjs');
  assert.match(app, /import \{ typedFileUrl, typedLocalPath \} from '\.\/runtime\/localPath';/);
  assert.match(app, /const address = typedFileUrl\(text\);/);
  assert.match(app, /type: 'typed-file\.open', text, \.\.\.\(address \? \{ tabId \} : \{\}\)/, 'a typed path sends no tab: it opens a tab of its own');
  assert.match(main, /function openDroppedFile\(address,tabId\)\{/);
  assert.match(main, /\.\.\.\(typeof tabId==='string'&&state\.tabs\.some\(tab=>tab\.id===tabId&&!tab\.privacy\)\?\{tabId\}:\{\}\)/, 'main passes only a tab of this window that is not private');
  assert.match(main, /shape\(\['text','tabId'\]\);if\(request\.tabId!==undefined&&\(typeof request\.tabId!=='string'\|\|request\.tabId\.length>200\)\)throw new Error\('Invalid typed file request'\)/);
  // unchanged safety: a page's own navigation to a file is refused, the kinds list is the drop's, private and Tor windows open no file
  assert.match(main, /if\(!event\.initiator&&!wc\.getURL\(\)\.startsWith\('file:'\)\)\{openDroppedFile\(url\);return;\}/);
  assert.match(main, /case 'typed-file\.open':[^\n]*if\(privateMode\|\|torMode\|\|typeof request\.text!=='string'\)return \{typedFile:\{handled:false\}\}/);
  assert.ok(!/tab\.open-file/.test(read('desktop/validation.cjs')), 'the renderer still cannot ask for a file tab');
  assert.match(read('src/runtime/types.ts'), /\{type:'typed-file\.open';text:string;[^}]*tabId\?:string\}/);
});
