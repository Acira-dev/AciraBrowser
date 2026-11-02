import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLocale } from '../src/i18n';
import { folderTitle, isOtherFolder } from '../src/ui/bookmarkFolderName';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BookmarkNode } from '../src/runtime/types';

// The special folders read "Bookmarks bar" and "Other bookmarks" in every language (an Arabic or German Bookmarks page showed them in
// English): they are stored, and found by core's placeFolder, under those English names. They are now shown translated; the data is not.
const folder = (id: string, title: string, parentId: string | null = null): BookmarkNode => ({ id, browserProfileId: 'profile-personal', parentId, title, position: 0, createdAt: 0 });

test('the two special folders are shown in the interface language; other folders as named', async () => {
  await setLocale('de');
  assert.equal(folderTitle(folder('a', 'Bookmarks bar')), 'Lesezeichenleiste');
  assert.equal(folderTitle(folder('b', 'Other bookmarks')), 'Weitere Lesezeichen');
  assert.equal(folderTitle(folder('c', 'bookmarks bar')), 'Lesezeichenleiste', 'an imported one in lower case too');
  assert.equal(folderTitle(folder('d', 'Reading')), 'Reading');
  assert.equal(folderTitle(folder('e', 'Bookmarks bar', 'a')), 'Bookmarks bar', 'a folder of that name inside another is just a folder');
  assert.equal(isOtherFolder(folder('f', 'Other bookmarks', 'a')), false);
  await setLocale('ar');
  assert.equal(folderTitle(folder('a', 'Bookmarks bar')), JSON.parse(readFileSync('src/i18n/ar.json', 'utf8'))['bm.bar']);
  await setLocale('en');
  assert.equal(folderTitle(folder('a', 'Bookmarks bar')), 'Bookmarks bar');
  assert.equal(folderTitle(folder('b', 'Other bookmarks')), 'Other bookmarks');
});

test('display only: the folders stay stored in English and bookmarks still find them by that name', async () => {
  await setLocale('de');
  let state = createInitialState();
  state = reduceBrowser(state, { type: 'bookmark.add', url: 'https://example.com/', title: 'Example', parentId: 'other-bookmarks' } as never);
  state = reduceBrowser(state, { type: 'bookmark.add', url: 'https://example.org/', title: 'Second', parentId: 'other-bookmarks' } as never);
  const others = state.bookmarkNodes.filter((node) => !node.url && node.title === 'Other bookmarks');
  assert.equal(others.length, 1, 'one stored "Other bookmarks" folder, found again by its English name');
  assert.equal(state.bookmarkNodes.filter((node) => node.parentId === others[0].id).length, 2);
  assert.equal(folderTitle(others[0]), 'Weitere Lesezeichen');
  await setLocale('en');
});

test('the Bookmarks page, the bookmark editor, the sidebar and the folder menu use the shown name, and keeping it is no rename', () => {
  const read = (file: string) => readFileSync(file, 'utf8');
  const manager = read('src/features/BookmarksManager.tsx');
  assert.match(manager, /names\.unshift\(folderTitle\(at\)\)/);
  assert.match(manager, /\(node\.url \? node\.title : folderTitle\(node\)\)/);
  assert.match(manager, /if \(next && next !== node\.title && next !== title\(node\)\) dispatch/);
  assert.match(read('src/features/BookmarkEditor.tsx'), /<span>\{folderTitle\(item\)\}<\/span>/);
  assert.match(read('src/components/sidebar/AciraSidebar.tsx'), /\{folderTitle\(node\)\|\|'Untitled folder'\}/);
  const menu = read('src/components/sidebar/BookmarkMenu.tsx');
  assert.match(menu, /initial=\{folderTitle\(node\)\}/);
  assert.match(menu, /if\(title!==folderTitle\(node\)\)dispatch\(\{type:'bookmark\.rename'/);
});
