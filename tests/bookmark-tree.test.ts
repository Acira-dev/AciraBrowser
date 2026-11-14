import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BookmarkNode, BrowserAction, BrowserSnapshot } from '../src/runtime/types';
import { barBookmarks, dayOf, isSearchResultUrl, pageKey, suggestHistory } from '../src/features/libraryModel';

const profile = createInitialState().activeBrowserProfileId;
const node = (id: string, title: string, parentId: string | null, position: number, url?: string): BookmarkNode => ({ id, browserProfileId: profile, parentId, title, position, createdAt: 1, ...(url ? { url } : {}) });
function fixture(): BrowserSnapshot {
  const s = createInitialState();
  s.bookmarkNodes = [
    node('bar', 'Bookmarks bar', null, 0), node('a', 'Alpha', 'bar', 0, 'https://a.example/'), node('b', 'Beta', 'bar', 1, 'https://b.example/'), node('c', 'Gamma', 'bar', 2, 'https://c.example/'),
    node('design', 'Design', 'bar', 3), node('d', 'Delta', 'design', 0, 'https://d.example/'),
    node('other', 'Other', null, 1), node('loose', 'Loose', null, 2, 'https://loose.example/'),
  ];
  return reduceBrowser(s, { type: 'toast', text: 'sync' } as BrowserAction);
}
const kids = (s: BrowserSnapshot, parent: string | null) => s.bookmarkNodes.filter(n => n.parentId === parent).sort((a, b) => a.position - b.position).map(n => n.id);

test('rename trims, keeps the url, and ignores an empty name', () => {
  let s = reduceBrowser(fixture(), { type: 'bookmark.rename', id: 'a', title: '  Alpha prime  ' });
  assert.equal(s.bookmarkNodes.find(n => n.id === 'a')!.title, 'Alpha prime');
  assert.equal(s.bookmarkNodes.find(n => n.id === 'a')!.url, 'https://a.example/');
  s = reduceBrowser(s, { type: 'bookmark.rename', id: 'a', title: '   ' });
  assert.equal(s.bookmarkNodes.find(n => n.id === 'a')!.title, 'Alpha prime');
});

test('move reorders inside a folder and keeps sibling positions 0..n-1', () => {
  const s = reduceBrowser(fixture(), { type: 'bookmark.move', id: 'c', parentId: 'bar', index: 0 });
  assert.deepEqual(kids(s, 'bar'), ['c', 'a', 'b', 'design']);
  assert.deepEqual(s.bookmarkNodes.filter(n => n.parentId === 'bar').map(n => n.position).sort(), [0, 1, 2, 3]);
  const later = reduceBrowser(s, { type: 'bookmark.move', id: 'c', parentId: 'bar', index: 99 });
  assert.deepEqual(kids(later, 'bar'), ['a', 'b', 'design', 'c'], 'an index past the end lands last');
});

test('move into another folder and out to the top level; the bar follows tree order', () => {
  let s = reduceBrowser(fixture(), { type: 'bookmark.move', id: 'a', parentId: 'design', index: 1 });
  assert.deepEqual(kids(s, 'design'), ['d', 'a']);
  assert.deepEqual(kids(s, 'bar'), ['b', 'c', 'design']);
  s = reduceBrowser(s, { type: 'bookmark.move', id: 'a', parentId: null, index: 0 });
  assert.deepEqual(kids(s, null), ['a', 'bar', 'other', 'loose']);
  assert.deepEqual(s.bookmarks, s.bookmarkNodes.filter(n => n.url).map(n => n.url), 'the url list is derived in tree order');
  assert.equal(s.bookmarks[0], 'https://a.example/');
});

test('a folder cannot move into itself or its own descendants, nor into a bookmark', () => {
  const start = fixture();
  for (const [id, parentId] of [['bar', 'bar'], ['bar', 'design'], ['design', 'design'], ['b', 'a'], ['b', 'missing']] as const) {
    const s = reduceBrowser(start, { type: 'bookmark.move', id, parentId, index: 0 });
    assert.deepEqual(s.bookmarkNodes.map(n => [n.id, n.parentId, n.position]), start.bookmarkNodes.map(n => [n.id, n.parentId, n.position]), `${id} → ${parentId} changes nothing`);
  }
});

test('new folders land last, in the chosen folder, and nameless ones are refused', () => {
  let s = reduceBrowser(fixture(), { type: 'bookmark.folder', title: 'Trips', parentId: 'bar' });
  const trips = s.bookmarkNodes.find(n => n.title === 'Trips')!;
  assert.equal(trips.parentId, 'bar'); assert.equal(trips.url, undefined);
  assert.deepEqual(kids(s, 'bar').at(-1), trips.id);
  s = reduceBrowser(s, { type: 'bookmark.folder', title: '   ', parentId: null });
  assert.equal(s.bookmarkNodes.filter(n => !n.url).length, 4);
  s = reduceBrowser(s, { type: 'bookmark.folder', title: 'Under a page', parentId: 'a' });
  assert.equal(s.bookmarkNodes.some(n => n.title === 'Under a page'), false);
});

test('remove deletes a folder with everything inside it; clear keeps the folder', () => {
  const removed = reduceBrowser(fixture(), { type: 'bookmark.remove', id: 'design' });
  assert.deepEqual(removed.bookmarkNodes.map(n => n.id).sort(), ['a', 'b', 'bar', 'c', 'loose', 'other']);
  const cleared = reduceBrowser(fixture(), { type: 'bookmark.clear', id: 'bar' });
  assert.deepEqual(cleared.bookmarkNodes.map(n => n.id).sort(), ['bar', 'loose', 'other']);
  assert.deepEqual(cleared.bookmarks, ['https://loose.example/']);
  assert.equal(reduceBrowser(fixture(), { type: 'bookmark.clear', id: 'a' }).bookmarkNodes.length, 8, 'a bookmark is not cleared, only removed');
  assert.equal(reduceBrowser(fixture(), { type: 'bookmark.remove', id: 'a' }).bookmarkNodes.some(n => n.id === 'a'), false);
});

test('other profiles and private profiles are never touched', () => {
  const s = fixture();
  s.bookmarkNodes.push({ ...node('x', 'Elsewhere', null, 0, 'https://x.example/'), browserProfileId: 'someone-else' });
  const after = reduceBrowser(s, { type: 'bookmark.clear', id: 'bar' });
  assert.equal(after.bookmarkNodes.some(n => n.id === 'x'), true);
  assert.equal(reduceBrowser(s, { type: 'bookmark.remove', id: 'x' }).bookmarkNodes.some(n => n.id === 'x'), true, 'a node of another profile cannot be addressed');
});

test('days are labelled Today, Yesterday, then the date, and group by local day', () => {
  const now = new Date(2026, 9, 24, 15, 0);
  assert.equal(dayOf(new Date(2026, 9, 24, 1, 0).toISOString(), now).label, 'Today');
  assert.equal(dayOf(new Date(2026, 9, 23, 23, 59).toISOString(), now).label, 'Yesterday');
  assert.match(dayOf(new Date(2026, 9, 21, 12, 0).toISOString(), now).label, /October 21/);
  assert.equal(dayOf('not a date', now).label, 'Earlier');
  assert.equal(dayOf(new Date(2026, 9, 21, 8, 0).toISOString(), now).key, dayOf(new Date(2026, 9, 21, 22, 0).toISOString(), now).key);
});

test('history.delete removes exactly those visits (not every visit of the same page) and restore puts them back in order', () => {
  const s = fixture();
  const visit = (id: string, url: string, time: string) => ({ id, url, title: id, time, profileId: '', browserProfileId: profile });
  s.browsingHistory = [visit('v3', 'https://x.example/', '2026-10-24T10:00:00.000Z'), visit('v2', 'https://y.example/', '2026-10-23T10:00:00.000Z'), visit('v1', 'https://x.example/', '2026-10-22T10:00:00.000Z')];
  const gone = reduceBrowser(s, { type: 'history.delete', ids: ['v2', 'v1'] });
  assert.deepEqual(gone.browsingHistory.map(v => v.id), ['v3'], 'the other day of the same page stays');
  const back = reduceBrowser(gone, { type: 'history.restore', visits: s.browsingHistory.filter(v => v.id !== 'v3') });
  assert.deepEqual(back.browsingHistory.map(v => v.id), ['v3', 'v2', 'v1']);
  assert.deepEqual(reduceBrowser(back, { type: 'history.restore', visits: s.browsingHistory }).browsingHistory.map(v => v.id), ['v3', 'v2', 'v1'], 'restoring twice adds nothing');
  assert.equal(reduceBrowser(gone, { type: 'history.restore', visits: [{ ...visit('z', 'https://z.example/', '2026-10-21T10:00:00.000Z'), browserProfileId: 'someone-else' }] }).browsingHistory.length, 1, 'another profile cannot be written to');
});

test('bookmark.restore brings a removed folder back with its children and positions', () => {
  const before = fixture();
  const branch = before.bookmarkNodes.filter(n => ['design', 'd'].includes(n.id));
  const gone = reduceBrowser(before, { type: 'bookmark.remove', id: 'design' });
  assert.equal(gone.bookmarkNodes.some(n => n.id === 'd'), false);
  const back = reduceBrowser(gone, { type: 'bookmark.restore', nodes: branch });
  assert.deepEqual(kids(back, 'bar'), kids(before, 'bar'));
  assert.deepEqual(kids(back, 'design'), ['d']);
  assert.equal(reduceBrowser(back, { type: 'bookmark.restore', nodes: branch }).bookmarkNodes.length, before.bookmarkNodes.length, 'restoring twice adds nothing');
});

test('a bookmark can be sent to the bookmarks bar or Other bookmarks by name; the folder is made when missing', () => {
  const s = fixture();
  s.bookmarkNodes = s.bookmarkNodes.filter(n => n.id !== 'bar' && n.parentId !== 'bar' && n.id !== 'design' && n.id !== 'd');
  const toBar = reduceBrowser(s, { type: 'bookmark.move', id: 'loose', parentId: 'bookmarks-bar', index: 0 });
  const bar = toBar.bookmarkNodes.find(n => !n.url && n.title === 'Bookmarks bar')!;
  assert.equal(toBar.bookmarkNodes.find(n => n.id === 'loose')!.parentId, bar.id);
  assert.equal(toBar.bookmarkNodes.filter(n => n.title === 'Bookmarks bar').length, 1);
  const again = reduceBrowser(toBar, { type: 'bookmark.move', id: 'loose', parentId: 'other-bookmarks', index: 0 });
  assert.equal(again.bookmarkNodes.find(n => n.id === 'loose')!.parentId, again.bookmarkNodes.find(n => n.title === 'Other bookmarks' && !n.url)!.id);
  assert.equal(reduceBrowser(again, { type: 'bookmark.move', id: 'loose', parentId: 'other-bookmarks', index: 0 }).bookmarkNodes.filter(n => n.title === 'Other bookmarks').length, 1, 'one folder, not one per move');
});

test('the bar shows top-level pages and the bar folder\'s pages and folders, in tree order, and nothing from other folders', () => {
  const s = fixture();
  assert.deepEqual(barBookmarks(s.bookmarkNodes, profile).map(n => n.id), ['a', 'b', 'c', 'design', 'loose'], 'a folder in the bar folder is on the bar (13.8)');
  const moved = reduceBrowser(s, { type: 'bookmark.move', id: 'a', parentId: 'other', index: 0 });
  assert.deepEqual(barBookmarks(moved.bookmarkNodes, profile).map(n => n.id), ['b', 'c', 'design', 'loose']);
  assert.deepEqual(barBookmarks(moved.bookmarkNodes, 'someone-else'), []);
});

test('search-result pages are recognised, ordinary pages are not', () => {
  for (const url of ['https://www.google.com/search?q=cats', 'https://www.google.co.uk/search?q=x&tbm=isch', 'https://duckduckgo.com/?q=privacy', 'https://www.bing.com/search?q=a', 'https://search.brave.com/search?q=a', 'https://www.youtube.com/results?search_query=a', 'https://github.com/search?q=acira', 'https://en.wikipedia.org/w/index.php?search=gogh', 'https://shop.example/search?query=shoes'])
    assert.equal(isSearchResultUrl(url), url.includes('wikipedia') ? false : true, url);
  assert.equal(isSearchResultUrl('https://custom.example/find?term=a', ['https://custom.example/find?term=%s']), true, 'a configured provider counts');
  for (const url of ['https://www.google.com/', 'https://github.com/acira-dev/browser', 'https://news.ycombinator.com/item?id=1', 'https://example.com/article/search-engines', 'https://docs.example.com/?q=1'])
    assert.equal(isSearchResultUrl(url), false, url);
});

test('suggestions: no search pages, no duplicates, saved pages excluded, real titles preferred', () => {
  const at = (n: number) => `2026-10-2${n}T10:00:00.000Z`;
  const history = [
    { url: 'https://www.google.com/search?q=acira', title: 'acira - Google Search', time: at(4) },
    { url: 'https://linear.app/acira/project/launch?utm_source=mail', title: 'Linear – Launch sprint', time: at(4) },
    { url: 'https://linear.app/acira/project/launch/', title: 'Linear – Launch sprint', time: at(3) },
    { url: 'https://linear.app/acira/project/launch#comments', title: 'https://linear.app/acira/project/launch', time: at(2) },
    { url: 'https://docs.example.com/guide', title: 'Guide', time: at(3) },
    { url: 'https://docs.example.com/guide/', title: 'Guide', time: at(2) },
    { url: 'https://saved.example/', title: 'Saved already', time: at(4) },
    { url: 'https://untitled.example/page', title: '', time: at(4) },
    { url: 'acira://settings', title: 'Settings', time: at(4) },
  ];
  const out = suggestHistory(history, ['https://saved.example']);
  assert.deepEqual(out.map(item => item.title), ['Linear – Launch sprint', 'Guide', 'untitled.example'], 'titled pages first, then by visits');
  assert.equal(out[0].visits, 3);
  assert.equal(new Set(out.map(item => pageKey(item.url))).size, out.length);
  assert.equal(suggestHistory(history, [], { limit: 1 }).length, 1);
});

test('add places a dropped link where it was dropped, and never duplicates a saved page', () => {
  let s = reduceBrowser(fixture(), { type: 'bookmark.add', url: 'https://new.example/read', title: '  Read me  ', parentId: 'bar', index: 1 });
  const added = s.bookmarkNodes.find(n => n.url === 'https://new.example/read')!;
  assert.equal(added.title, 'Read me');
  assert.deepEqual(kids(s, 'bar').slice(0, 3), ['a', added.id, 'b']);
  assert.deepEqual(kids(s, 'bar').map(id => s.bookmarkNodes.find(n => n.id === id)!.position), kids(s, 'bar').map((_, i) => i));
  s = reduceBrowser(s, { type: 'bookmark.add', url: 'https://c.example/', parentId: 'bar', index: 0 });
  assert.equal(s.bookmarkNodes.filter(n => n.url === 'https://c.example/').length, 1, 'an existing page moves instead of doubling');
  assert.equal(kids(s, 'bar')[0], 'c');
  s = reduceBrowser(s, { type: 'bookmark.add', url: 'https://in.example/', parentId: 'design', index: 99 });
  assert.equal(s.bookmarkNodes.find(n => n.url === 'https://in.example/')!.parentId, 'design');
});

test('add refuses what is not a web page or not a folder', () => {
  const before = fixture().bookmarkNodes.length;
  for (const action of [
    { type: 'bookmark.add', url: 'javascript:alert(1)', parentId: null, index: 0 },
    { type: 'bookmark.add', url: 'file:///c:/secret.txt', parentId: null, index: 0 },
    { type: 'bookmark.add', url: 'https://x.example/', parentId: 'a', index: 0 },
    { type: 'bookmark.add', url: 'https://x.example/', parentId: 'nope', index: 0 },
  ] as BrowserAction[]) assert.equal(reduceBrowser(fixture(), action).bookmarkNodes.length, before, JSON.stringify(action));
});
