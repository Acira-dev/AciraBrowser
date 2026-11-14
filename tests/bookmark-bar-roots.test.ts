// 13.8: a bookmarks bar an earlier import brought in under its translated or Edge name becomes Acira's bookmarks bar when the
// window loads (src/runtime/bookmarkBarRoots.ts via restoreSnapshot), conservatively: recorded by Chromium's bar id, or by a known
// name only when the profile has no bar yet; a folder the person made is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, restoreSnapshot } from '../src/runtime/core';
import type { BookmarkNode } from '../src/runtime/types';
import { CHROMIUM_BAR_UUID, IMPORTED_BAR_NAMES, repairImportedBarRoots } from '../src/runtime/bookmarkBarRoots';
import { barBookmarks } from '../src/features/libraryModel';

const profile = createInitialState().activeBrowserProfileId;
const node = (id: string, title: string, parentId: string | null, position: number, extra: Partial<BookmarkNode> = {}): BookmarkNode => ({ id, browserProfileId: profile, parentId, title, position, createdAt: 1, ...extra });
const imported = (key: string) => ({ importBatchId: 'import-1', importKey: 'src0123:' + key });
const load = (nodes: BookmarkNode[]) => { const s = createInitialState(); s.bookmarkNodes = nodes; return restoreSnapshot(JSON.parse(JSON.stringify(s))).bookmarkNodes; };
const kids = (nodes: BookmarkNode[], parent: string) => nodes.filter(n => n.parentId === parent).sort((a, b) => a.position - b.position).map(n => n.id);

test('the known names: Chromium\'s bar in every language (both forms) and Edge\'s "Favorites bar"', () => {
  for (const name of ['Bookmarks bar', 'Bookmarks Bar', 'Favorites bar', 'Barre de favoris', 'Lesezeichenleiste', 'Barra de favoritos', 'Barra de marcadores', 'Barra dei preferiti', 'شريط الإشارات', 'ブックマーク バー', '书签栏', '書籤列', 'Панель закладок', 'Yer işaretleri çubuğu', 'Yer İşaretleri Çubuğu', 'बुकमार्क बार', '북마크바', 'Bookmarkbalk', 'Pasek zakładek'])
    assert.ok(IMPORTED_BAR_NAMES.includes(name), name);
  assert.equal(CHROMIUM_BAR_UUID, '0bc5d13f-2cba-5d74-951f-3f233fe6c908');
});

test('Edge, recorded: its bar becomes the bookmarks bar, and the bar shows its pages AND folders', () => {
  const nodes = load([node('fav', 'Favorites bar', null, 0, imported(CHROMIUM_BAR_UUID)), node('p', 'Inbox', 'fav', 0, { ...imported('e1'), url: 'https://inbox.example/' }), node('f', 'Projects', 'fav', 1, imported('e2')), node('q', 'Roadmap', 'f', 0, { ...imported('e3'), url: 'https://roadmap.example/' }), node('other', 'Other favorites', null, 1, imported('82b081ec-3dd3-529c-8475-ab6c344590dd'))]);
  assert.equal(nodes.find(n => n.id === 'fav')!.title, 'Bookmarks bar');
  assert.deepEqual(barBookmarks(nodes, profile).map(n => n.id), ['p', 'f']);
  assert.equal(nodes.find(n => n.id === 'other')!.title, 'Other favorites', 'the other root is left as it is');
});

test('recorded, and the profile already has a bar: the imported bar\'s items join it at its end, the empty folder goes', () => {
  const nodes = load([node('bar', 'Bookmarks bar', null, 0), node('own', 'Mine', 'bar', 0, { url: 'https://mine.example/' }), node('fav', 'Favorites bar', null, 1, imported(CHROMIUM_BAR_UUID)), node('p', 'Inbox', 'fav', 0, { ...imported('e1'), url: 'https://inbox.example/' }), node('f', 'Projects', 'fav', 1, imported('e2')), node('x', 'Kept', null, 2)]);
  assert.deepEqual(kids(nodes, 'bar'), ['own', 'p', 'f']);
  assert.ok(!nodes.some(n => n.id === 'fav'));
  assert.deepEqual(nodes.filter(n => !n.parentId).sort((a, b) => a.position - b.position).map(n => [n.id, n.position]), [['bar', 0], ['x', 1]], 'top-level places renumbered');
});

test('by name only (an import that did not record the id): only when the profile has no bar; the first by place wins', () => {
  const french = load([node('fr', 'Barre de favoris', null, 0, imported('1')), node('j', 'Journal', 'fr', 0, { ...imported('2'), url: 'https://journal.example/' }), node('de', 'Lesezeichenleiste', null, 1, imported('9'))]);
  assert.equal(french.find(n => n.id === 'fr')!.title, 'Bookmarks bar');
  assert.equal(french.find(n => n.id === 'de')!.title, 'Lesezeichenleiste', 'a second candidate is left as it is');
  const withBar = load([node('bar', 'Bookmarks bar', null, 0), node('fr', 'Barre de favoris', null, 1, imported('1')), node('j', 'Journal', 'fr', 0, { ...imported('2'), url: 'https://journal.example/' })]);
  assert.equal(withBar.find(n => n.id === 'fr')!.title, 'Barre de favoris', 'a profile with a bar: not merged by name');
  assert.equal(withBar.find(n => n.id === 'j')!.parentId, 'fr');
});

test('never the person\'s own folders: a "Favorites bar" they made, a nested one, a page with that name', () => {
  const before = [node('mine', 'Favorites bar', null, 0), node('top', 'Imported', null, 1, imported('z')), node('nested', 'Barre de favoris', 'top', 0, imported(CHROMIUM_BAR_UUID)), node('pg', 'Favorites bar', null, 2, { ...imported('y'), url: 'https://fav.example/' })];
  const out = repairImportedBarRoots(before);
  assert.equal(out.nodes, before, 'nothing to do: the same array');
  assert.deepEqual(out.changed, []);
});

test('once: a second load changes nothing; another profile is repaired on its own', () => {
  const other = (n: BookmarkNode) => ({ ...n, browserProfileId: 'profile-other' });
  const first = load([node('fav', 'Favorites bar', null, 0, imported(CHROMIUM_BAR_UUID)), other(node('fr', 'Barre de favoris', null, 0, imported('1'))), other(node('j', 'Journal', 'fr', 0, { ...imported('2'), url: 'https://journal.example/' }))]);
  assert.equal(first.find(n => n.id === 'fav')!.title, 'Bookmarks bar');
  assert.equal(first.find(n => n.id === 'fr')!.title, 'Bookmarks bar');
  const second = repairImportedBarRoots(first);
  assert.equal(second.nodes, first);
});
