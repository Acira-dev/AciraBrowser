import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BookmarkNode, BrowserSnapshot } from '../src/runtime/types';
import { barBookmarks } from '../src/features/libraryModel';

// An extension's bookmark writes go into Acira's own store as one `bookmark.replace` (desktop/main.cjs stores.updateBookmarks). The reducer
// is the real one, so what the sidebar, the bookmarks bar and the bookmarks page read is checked here, not guessed.
const require = createRequire(import.meta.url);
const model = require('../desktop/browser-services/extension-bookmarks.cjs');
const { diffEvents } = model;

const base = createInitialState();
const profile = base.activeBrowserProfileId;
const node = (id: string, parentId: string | null, title: string, position: number, url?: string, extra: Partial<BookmarkNode> = {}): BookmarkNode =>
  ({ id, browserProfileId: profile, parentId, title, position, createdAt: 1, ...(url ? { url } : {}), ...extra });
function fixture(): BrowserSnapshot {
  const s = createInitialState();
  s.browserProfiles = [...s.browserProfiles, { ...s.browserProfiles[0], id: 'other-profile', name: 'Other' } as any, { ...s.browserProfiles[0], id: 'private-1', name: 'Private', private: true } as any];
  s.bookmarkNodes = [
    node('star', null, 'Starred', 0, 'https://star.example/'), node('work', null, 'Work', 1), node('w1', 'work', 'Docs', 0, 'https://docs.example/'),
    node('onion', null, 'Onion', 2, 'http://x.onion/', { tor: true }),
    { id: 'o1', browserProfileId: 'other-profile', parentId: null, title: 'Elsewhere', url: 'https://else.example/', position: 0, createdAt: 1 }
  ];
  return reduceBrowser(s, { type: 'toast', text: 'sync' } as any);
}
/** What stores.updateBookmarks does, on a snapshot. */
function write(s: BrowserSnapshot, run: (nodes: BookmarkNode[]) => any) {
  const mine = s.bookmarkNodes.filter(b => b.browserProfileId === profile);
  const out = run(structuredClone(mine));
  if (out.error) return { s, out };
  return { s: reduceBrowser(s, { type: 'bookmark.replace', profileId: profile, nodes: out.nodes } as any), out };
}
const ctx = { profileId: profile };
const mineOf = (s: BrowserSnapshot) => s.bookmarkNodes.filter(b => b.browserProfileId === profile);
const kids = (s: BrowserSnapshot, parent: string | null) => mineOf(s).filter(b => (b.parentId ?? null) === parent).sort((a, b) => a.position - b.position).map(b => b.title);

test('a page an extension adds to the bar shows on the bookmarks bar at once, after the starred ones', () => {
  const before = fixture();
  const { s, out } = write(before, nodes => model.create(nodes, { parentId: '1', title: 'From Floccus', url: 'https://floccus.example/' }, ctx));
  assert.deepEqual(barBookmarks(s.bookmarkNodes, profile).map(b => b.title), ['Starred', 'Onion', 'From Floccus'], 'the person\'s own bar, Tor page included, then the new page');
  assert.ok(s.bookmarks.includes('https://floccus.example/'), 'the star is filled for that page');
  assert.equal(out.result.parentId, '1');
  assert.equal(s.bookmarkNodes.some(b => b.title === 'Bookmarks bar'), false, 'no folder made for a page on the bar');
});

test('a folder and its pages made through the API appear in the sidebar tree like any folder, the reducer keeps positions 0..n-1', () => {
  let s = fixture(); let id = '';
  ({ s } = write(s, nodes => { const out = model.create(nodes, { parentId: '2', title: 'Recipes' }, ctx); id = out.result.id; return out; }));
  for (const [i, title] of ['Soup', 'Bread', 'Cake'].entries()) ({ s } = write(s, nodes => model.create(nodes, { parentId: id, title, url: `https://${title}.example/` }, ctx)));
  assert.deepEqual(kids(s, id), ['Soup', 'Bread', 'Cake']);
  assert.deepEqual(kids(s, null), ['Starred', 'Work', 'Onion', 'Recipes'], 'a top-level folder, where the sidebar lists the person\'s folders');
  ({ s } = write(s, nodes => model.move(nodes, mineOf(s).find(b => b.title === 'Cake')!.id, { index: 0 }, ctx)));
  assert.deepEqual(kids(s, id), ['Cake', 'Soup', 'Bread']);
  for (const parent of [null, id, 'work']) assert.deepEqual(mineOf(s).filter(b => (b.parentId ?? null) === parent).map(b => b.position).sort((a, b) => a - b), mineOf(s).filter(b => (b.parentId ?? null) === parent).map((_, i) => i));
});

test('the reducer leaves the extension\'s result as it is: the Chrome tree before and after replace is the same', () => {
  const s0 = fixture();
  const { s, out } = write(s0, nodes => model.create(nodes, { parentId: '2', title: 'Later', url: 'https://later.example/' }, ctx));
  assert.deepEqual(model.createView(mineOf(s)).tree(), model.createView(out.nodes).tree());
  const removed = write(s, nodes => model.remove(nodes, 'work', { recursive: true }));
  assert.deepEqual(model.createView(mineOf(removed.s)).tree(), model.createView(removed.out.nodes).tree());
});

test('another profile\'s bookmarks, a private profile and a Tor page are not touched', () => {
  const before = fixture();
  const { s } = write(before, nodes => model.remove(nodes, 'work', { recursive: true }));
  assert.deepEqual(s.bookmarkNodes.filter(b => b.browserProfileId === 'other-profile'), before.bookmarkNodes.filter(b => b.browserProfileId === 'other-profile'));
  assert.ok(s.bookmarkNodes.some(b => b.id === 'onion' && b.tor), 'the Tor page stays');
  assert.ok(!JSON.stringify(model.createView(mineOf(s)).tree()).includes('onion'));
  const refused = reduceBrowser(before, { type: 'bookmark.replace', profileId: 'private-1', nodes: [{ id: 'x', browserProfileId: 'private-1', parentId: null, title: 'x', url: 'https://x.example/', position: 0, createdAt: 1 }] } as any);
  assert.equal(refused.bookmarkNodes.some(b => b.id === 'x'), false, 'nothing is written for a private profile');
  assert.equal(reduceBrowser(before, { type: 'bookmark.replace', profileId: 'nobody', nodes: [] } as any).bookmarkNodes.length, before.bookmarkNodes.length, 'an unknown profile writes nothing');
});

test('the events for the person\'s own changes are the same ones: star, rename, move, delete, undo', () => {
  const s0 = fixture(), names = (a: BrowserSnapshot, b: BrowserSnapshot) => diffEvents(mineOf(a), mineOf(b)).map((e: any) => e.name.replace('bookmarks.', ''));
  const starred = reduceBrowser(s0, { type: 'bookmark.add', url: 'https://new.example/', title: 'New', parentId: null, index: 0 } as any);
  assert.deepEqual(names(s0, starred), ['onCreated']);
  const renamed = reduceBrowser(s0, { type: 'bookmark.rename', id: 'star', title: 'Starred 2' } as any);
  assert.deepEqual(diffEvents(mineOf(s0), mineOf(renamed)).map((e: any) => e.args), [['star', { title: 'Starred 2', url: 'https://star.example/' }]]);
  const moved = reduceBrowser(s0, { type: 'bookmark.move', id: 'star', parentId: 'work', index: 0 } as any);
  assert.deepEqual(names(s0, moved), ['onMoved']);
  const removed = reduceBrowser(s0, { type: 'bookmark.remove', id: 'work' } as any);
  assert.deepEqual(names(s0, removed), ['onRemoved']);
  const back = reduceBrowser(removed, { type: 'bookmark.restore', nodes: s0.bookmarkNodes.filter(b => b.id === 'work' || b.id === 'w1') } as any);
  assert.deepEqual(names(removed, back), ['onCreated', 'onCreated'], 'Undo brings the folder and its page back as two creations, parent first');
  const barToggle = reduceBrowser(s0, { type: 'bookmark.move', id: 'star', parentId: 'bookmarks-bar', index: 0 } as any);
  assert.deepEqual(names(s0, barToggle), [], 'moving a starred page into the bar folder is invisible to the tree an extension sees');
  const sorted = reduceBrowser(reduceBrowser(s0, { type: 'bookmark.add', url: 'https://b.example/', title: 'B', parentId: 'work', index: 1 } as any), { type: 'bookmark.add', url: 'https://a.example/', title: 'A', parentId: 'work', index: 2 } as any);
  assert.deepEqual(kids(sorted, 'work'), ['Docs', 'B', 'A']);
});
