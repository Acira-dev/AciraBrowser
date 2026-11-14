// 13.8: the bookmarks bar showed only loose pages, never the person's folders (a Windows user, tabs on top, bar shown;
// barBookmarks kept nodes with a url only). The bar is Chromium's bookmark bar folder as Acira keeps it: the top-level pages and the
// "Bookmarks bar" folder's children, pages AND folders, in order; a folder's button opens its contents as a menu (BookmarkMenu's
// FolderContents, through the bookmark-context popup and a `node:open.<id>` ref), nested folders opening in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import type { BookmarkNode, BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// The components import stylesheets; Node has no CSS loader, so a .css import loads empty.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= globalThis;
(globalThis as { innerWidth?: number }).innerWidth ??= 1280;
const { barBookmarks, barDropLocation, barPlace, DROP_BETWEEN_PIXELS } = await import('../src/features/libraryModel');
const { FOLDER_MENU_REF, bookmarkTarget, drillPath, folderChildren, folderMenuRef, folderPages, openAllActions, OPEN_ALL_LIMIT } = await import('../src/ui/bookmarkMenu');
const { BookmarkMenu } = await import('../src/components/sidebar/BookmarkMenu');
const { BookmarksBar } = await import('../src/components/BookmarksBar');
const { validateLayout } = createRequire(import.meta.url)('../desktop/validation.cjs');

const profile = createInitialState().activeBrowserProfileId;
const node = (id: string, title: string, parentId: string | null, position: number, url?: string, extra: Partial<BookmarkNode> = {}): BookmarkNode =>
  ({ id, browserProfileId: profile, parentId, title, position, createdAt: 1, ...(url ? { url } : {}), ...extra });
/** A Chrome import: "Bookmarks bar" holding pages and folders (one nested, one empty), a starred page above and below it, Chrome's
 *  "Other bookmarks" and a folder made at the top level, and another profile's bar. */
function fixture(): BrowserSnapshot {
  const s = createInitialState();
  s.bookmarkNodes = [
    node('starred', 'Starred', null, 0, 'https://starred.example/'),
    node('bar', 'Bookmarks bar', null, 1),
    node('news', 'News', 'bar', 0, 'https://news.example/'),
    node('work', 'Work', 'bar', 1), node('w1', 'Board', 'work', 0, 'https://board.example/'), node('deep', 'Deep', 'work', 1), node('d1', 'Deep page', 'deep', 0, 'https://deep.example/'),
    node('mail', 'Mail', 'bar', 2, 'https://mail.example/'),
    node('empty', 'Empty', 'bar', 3),
    node('onion', 'News', 'bar', 4, 'https://news.example/', { tor: true }),
    node('other', 'Other bookmarks', null, 2), node('o1', 'Elsewhere', 'other', 0, 'https://elsewhere.example/'),
    node('mine', 'My folder', null, 3), node('m1', 'Mine', 'mine', 0, 'https://mine.example/'),
    node('later', 'Later', null, 4, 'https://later.example/'),
    { ...node('x', 'Bookmarks bar', null, 0), browserProfileId: 'someone-else' }, { ...node('x1', 'Theirs', 'x', 0), browserProfileId: 'someone-else' },
  ];
  return reduceBrowser(s, { type: 'toast', text: 'sync' } as BrowserAction);
}

test('the bar lists the Bookmarks bar folder\'s pages AND folders in order, between the starred pages above and below it', () => {
  const s = fixture();
  assert.deepEqual(barBookmarks(s.bookmarkNodes, profile).map(item => item.id), ['starred', 'news', 'work', 'mail', 'empty', 'onion', 'later']);
  assert.deepEqual(barBookmarks(s.bookmarkNodes, profile).filter(item => !item.url).map(item => item.title), ['Work', 'Empty'], 'the folders the user could not see');
  assert.ok(!barBookmarks(s.bookmarkNodes, profile).some(item => ['w1', 'deep', 'd1'].includes(item.id)), 'a folder\'s own contents stay in its menu, not on the bar');
  assert.ok(!barBookmarks(s.bookmarkNodes, profile).some(item => ['other', 'o1', 'mine', 'm1'].includes(item.id)), 'other top-level folders are Chromium\'s Other bookmarks, off the bar');
  assert.deepEqual(barBookmarks(s.bookmarkNodes, 'someone-else').map(item => item.id), ['x1'], 'each profile its own bar; an empty folder still shows');
});

test('the Tor rule holds: a Tor bookmark is its own entry beside the ordinary one; a page saved twice shows once', () => {
  const s = fixture();
  const twice = reduceBrowser(s, { type: 'bookmark.restore', nodes: [node('again', 'News again', 'work', 9, 'https://news.example/')] } as BrowserAction);
  const list = barBookmarks(twice.bookmarkNodes, profile).map(item => item.id);
  assert.ok(list.includes('news') && list.includes('onion'), 'the ordinary and the Tor bookmark of one page both show');
  assert.equal(list.filter(id => id === 'again').length, 0);
});

test('a bookmark or folder moved into or out of the bar folder shows or goes at once; 150 items keep their order', () => {
  let s = fixture();
  s = reduceBrowser(s, { type: 'bookmark.move', id: 'mine', parentId: 'bar', index: 1 });
  assert.deepEqual(barBookmarks(s.bookmarkNodes, profile).map(item => item.id).slice(0, 4), ['starred', 'news', 'mine', 'work'], 'a folder moved onto the bar shows in its place');
  s = reduceBrowser(s, { type: 'bookmark.move', id: 'work', parentId: 'other', index: 0 });
  assert.ok(!barBookmarks(s.bookmarkNodes, profile).some(item => item.id === 'work'), 'moved out of the bar, it leaves the bar');
  const many = createInitialState();
  many.bookmarkNodes = [node('bar', 'Bookmarks bar', null, 0), ...Array.from({ length: 150 }, (_, index) => index % 3 ? node('p' + index, 'Page ' + index, 'bar', index, `https://p${index}.example/`) : node('f' + index, 'Folder ' + index, 'bar', index))];
  assert.deepEqual(barBookmarks(many.bookmarkNodes, profile).map(item => item.position), Array.from({ length: 150 }, (_, index) => index));
});

test('the bar draws a folder button (folder glyph, its name, a menu trigger) for every folder, beside the page buttons', () => {
  const s = fixture();
  const html = renderToStaticMarkup(createElement(BookmarksBar, { state: s, dispatch: () => {}, onNavigate: () => {}, onOverflow: () => {}, onContext: () => {}, onToolbarContext: () => {}, onFolder: () => {} }));
  // The bar lays itself out after a measure pass (a layout effect); a static render has only the measuring copy of every button.
  const titles = [...html.matchAll(/<button[^>]*data-measure-bookmark="true"[^>]*title="([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(titles, ['Starred', 'News', 'Work', 'Mail', 'Empty', 'News', 'Later']);
  assert.equal([...html.matchAll(/<button[^>]*class="bookmark-folder"[^>]*data-folder=""/g)].length, 2);
});

test('a drop on the bar follows Chromium: a page by its halves, a folder 5px at either edge before or after it, INTO it between', () => {
  const buttons = [{ lead: 0, width: 100, folder: false }, { lead: 104, width: 80, folder: true }, { lead: 188, width: 60, folder: false }];
  assert.equal(DROP_BETWEEN_PIXELS, 5);
  assert.deepEqual(barDropLocation(buttons, 20), { index: 0, on: false });
  assert.deepEqual(barDropLocation(buttons, 60), { index: 1, on: false });
  assert.deepEqual(barDropLocation(buttons, 102), { index: 1, on: false }, 'the gap before a folder is before it');
  assert.deepEqual(barDropLocation(buttons, 109), { index: 1, on: false });
  assert.deepEqual(barDropLocation(buttons, 110), { index: 1, on: true });
  assert.deepEqual(barDropLocation(buttons, 178), { index: 1, on: true });
  assert.deepEqual(barDropLocation(buttons, 180), { index: 2, on: false });
  assert.deepEqual(barDropLocation(buttons, 400), { index: 3, on: false }, 'past the last button, after it');
  assert.deepEqual(barDropLocation([], 10), { index: 0, on: false });
  // Right to left: buttons run from the right edge; each one's leading edge is its right side.
  const rtl = [{ lead: 1000, width: 100, folder: true }, { lead: 896, width: 80, folder: false }];
  assert.deepEqual(barDropLocation(rtl, 998, true), { index: 0, on: false });
  assert.deepEqual(barDropLocation(rtl, 950, true), { index: 0, on: true });
  assert.deepEqual(barDropLocation(rtl, 860, true), { index: 1, on: false });
  assert.deepEqual(barDropLocation(rtl, 850, true), { index: 2, on: false });
});

test('reordering on the bar: an item goes beside the entry it is dropped before; a folder never lands at the top level', () => {
  const s = fixture(), entries = barBookmarks(s.bookmarkNodes, profile);
  const at = (id: string) => entries.findIndex(item => item.id === id);
  const work = s.bookmarkNodes.find(item => item.id === 'work')!, mail = s.bookmarkNodes.find(item => item.id === 'mail')!;
  assert.deepEqual(barPlace(s.bookmarkNodes, profile, entries, at('news'), mail), { parentId: 'bar', index: 0 });
  assert.deepEqual(barPlace(s.bookmarkNodes, profile, entries, at('mail'), work), { parentId: 'bar', index: 1 }, 'counted without the moving one');
  assert.deepEqual(barPlace(s.bookmarkNodes, profile, entries, at('starred'), mail), { parentId: null, index: 0 }, 'a page may go to the top level');
  assert.deepEqual(barPlace(s.bookmarkNodes, profile, entries, at('starred'), work), { parentId: 'bar', index: 0 }, 'a folder before a starred page above the bar folder: the start of the bar folder');
  assert.deepEqual(barPlace(s.bookmarkNodes, profile, entries, at('later'), work), { parentId: 'bookmarks-bar', index: 99999 }, 'below it: the end of the bar folder');
  assert.deepEqual(barPlace(s.bookmarkNodes, profile, entries, entries.length, work), { parentId: 'bookmarks-bar', index: 99999 });
  const moved = reduceBrowser(s, { type: 'bookmark.move', id: 'work', ...barPlace(s.bookmarkNodes, profile, entries, at('starred'), work) });
  assert.ok(barBookmarks(moved.bookmarkNodes, profile).some(item => item.id === 'work'), 'the folder is still on the bar after the move');
});

test('a folder menu ref names the folder\'s contents, travels as a node id main accepts, and never names a bookmark', () => {
  const s = fixture();
  assert.equal(folderMenuRef('work'), 'node:open.work');
  assert.deepEqual(bookmarkTarget(folderMenuRef('work'), s.bookmarkNodes, profile), { kind: 'contents', node: s.bookmarkNodes.find(item => item.id === 'work') });
  assert.equal(bookmarkTarget(folderMenuRef('news'), s.bookmarkNodes, profile), null, 'a page has no contents');
  assert.equal(bookmarkTarget(folderMenuRef('x'), s.bookmarkNodes, profile), null, 'another profile\'s folder');
  assert.equal(bookmarkTarget(folderMenuRef('gone'), s.bookmarkNodes, profile), null);
  assert.equal(bookmarkTarget('node:work', s.bookmarkNodes, profile)?.kind, 'folder', 'the right-click menu of a folder is unchanged');
  const id = 'bookmark-' + crypto.randomUUID(), ref = folderMenuRef(id);
  const layout = { views: [], visible: true, overlay: { kind: 'bookmark-context', id: 3, bounds: { x: 10, y: 80, width: 260, height: 300 }, anchor: { x: 10, y: 50, width: 90, height: 28 }, origin: { x: 0, y: 0 }, contentHeight: 300, context: { node: ref.slice('node:'.length) } } };
  assert.equal(validateLayout(layout).overlay.context.node, 'open.' + id, 'main lets the ref through (word characters, dots and dashes)');
  assert.ok(FOLDER_MENU_REF.startsWith('node:'));
});

test('the contents menu lists pages and folders in order, opens nested folders in place, and follows moves while open', () => {
  let s = fixture();
  assert.deepEqual(folderChildren(s.bookmarkNodes, profile, 'work').map(item => item.id), ['w1', 'deep']);
  assert.deepEqual(folderChildren(s.bookmarkNodes, profile, 'empty'), []);
  assert.deepEqual(drillPath(s.bookmarkNodes, profile, 'work', ['deep']), ['deep']);
  assert.deepEqual(drillPath(s.bookmarkNodes, profile, 'work', ['w1']), [], 'a page is never a level');
  s = reduceBrowser(s, { type: 'bookmark.move', id: 'deep', parentId: 'other', index: 0 });
  assert.deepEqual(drillPath(s.bookmarkNodes, profile, 'work', ['deep']), [], 'a folder moved out while open takes the menu back to the level that held it');
  s = reduceBrowser(s, { type: 'bookmark.move', id: 'o1', parentId: 'work', index: 0 });
  assert.deepEqual(folderChildren(s.bookmarkNodes, profile, 'work').map(item => item.id), ['o1', 'w1'], 'moved in while open: listed at once');
  // 40 levels deep: every level opens in place.
  const deep = createInitialState();
  deep.bookmarkNodes = [node('bar', 'Bookmarks bar', null, 0), ...Array.from({ length: 40 }, (_, index) => node('l' + index, 'Level ' + index, index ? 'l' + (index - 1) : 'bar', 0))];
  assert.equal(drillPath(deep.bookmarkNodes, profile, 'l0', Array.from({ length: 39 }, (_, index) => 'l' + (index + 1))).length, 39);
});

test('the contents menu renders its rows: site icon and name for a page, folder glyph and chevron for a folder, "empty" for none', () => {
  const s = fixture(), row = () => null, render = (ref: string) => renderToStaticMarkup(createElement(BookmarkMenu, { state: s, dispatch: () => {}, target: ref, row, close: () => {}, navigate: () => {} }));
  const work = render(folderMenuRef('work'));
  assert.match(work, /class="bm-folder-menu" role="menu" aria-label="Work"/);
  assert.match(work, /<button type="button" class="menu-row" role="menuitem" data-bookmark-row="w1" title="Board">.*<span dir="auto">Board<\/span><\/button>/);
  assert.match(work, /<button type="button" class="menu-row menu-row-more" role="menuitem" aria-haspopup="menu" data-bookmark-folder="deep" title="Deep">.*<span dir="auto">Deep<\/span><svg/);
  assert.ok(work.indexOf('data-bookmark-row="w1"') < work.indexOf('data-bookmark-folder="deep"'), 'in their order');
  assert.ok(!work.includes('popup-back'), 'no back row at the folder itself');
  assert.match(render(folderMenuRef('empty')), /<button type="button" class="menu-row" role="menuitem" disabled=""><span>This folder is empty<\/span><\/button>/);
  const long = 'A'.repeat(300), named = { ...s, bookmarkNodes: [...s.bookmarkNodes, node('long', long, 'work', 5, 'https://long.example/')] };
  assert.match(renderToStaticMarkup(createElement(BookmarkMenu, { state: named, dispatch: () => {}, target: folderMenuRef('work'), row, close: () => {}, navigate: () => {} })), new RegExp(`title="${long}"`), 'a long name keeps its whole text in the tooltip (the row ends in an ellipsis)');
});

test('Open all (a middle or Ctrl/Cmd press on a folder): every page once, Tor pages in Tor tabs, at most 40, then a note', () => {
  const s = fixture(), bar = s.bookmarkNodes.find(item => item.id === 'bar')!;
  assert.deepEqual(folderPages(bar, s.bookmarkNodes).map(item => item.id), ['news', 'w1', 'd1', 'mail', 'onion']);
  const actions = openAllActions(bar, s.bookmarkNodes);
  assert.deepEqual(actions.at(-1), { type: 'tab.new', url: 'https://news.example/', background: true, privacy: 'tor' }, 'a Tor bookmark opens in a Tor tab');
  assert.ok(actions.slice(0, -1).every(action => action.type === 'tab.new' && !('privacy' in action)));
  const big = createInitialState();
  big.bookmarkNodes = [node('f', 'Big', null, 0), ...Array.from({ length: 45 }, (_, index) => node('p' + index, 'P' + index, 'f', index, `https://p${index}.example/`))];
  const many = openAllActions(big.bookmarkNodes[0], big.bookmarkNodes);
  assert.equal(many.filter(action => action.type === 'tab.new').length, OPEN_ALL_LIMIT);
  assert.equal(many.at(-1)?.type, 'toast');
});

test('found in the real app: a drop ignores the fading copy of a button that just left, and a folder menu is titled with the folder', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  // useListMotion leaves a data-motion-ghost copy (with the button's own attributes) while a removed button fades out.
  assert.match(read('src/components/BookmarksBar.tsx'), /querySelectorAll<HTMLElement>\(':scope > \[data-bookmark\]:not\(\[data-motion-ghost\]\)'\)/);
  // The popup header of a folder menu says the folder's name, not "Bookmark actions" (the right-click menu's title).
  const app = read('src/App.tsx');
  assert.equal(app.match(/contextId\.startsWith\(FOLDER_MENU_REF\) \? folderMenuHeading\(state, contextId\)/g)?.length, 2, 'the visible heading and the dialog\'s name');
  // Cheap CSS: the new rules end in a class (no tag, no *, no trailing :is()), so they never join the universal bucket.
  const css = read('src/styles/bookmarks-bar.css').split('\n').filter(line => /bookmark-folder|bm-folder-menu/.test(line) && line.includes('{'));
  assert.ok(css.length >= 4);
  for (const line of css) assert.match(line.slice(0, line.indexOf('{')).trim().split(/[\s>+~]+/).at(-1)!, /^\.[\w-]+(\[[^\]]+\])*(::before)?$/, line);
});
