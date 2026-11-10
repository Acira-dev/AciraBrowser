import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { bulkCloseTargets } from '../src/runtime/profileActions';
import { favoriteTabsInList, favoriteTabsOnlyInTile, listedTabs, tabListed } from '../src/runtime/favoriteTabs';
import { workspaceCounts, workspaceIdOf } from '../src/runtime/workspaces';
import { tabNumbers } from '../src/runtime/tabNumbers';
import { listedInSidebar, tileFolded } from '../src/ui/sidebarApps';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Item 33 (founder, 7 Nov): "some people want to see the favorite's tab in the list too, some want the favorite only above, so it should be an option."
// Settings › Tabs › Sidebar › Favorites › "Favorites' tabs in the tab list": on (the default, beta.11) the tab is an ordinary row; off, a tab opened from or
// linked to a favorite lives only in its tile. One pure rule (runtime/favoriteTabsRule.ts), read by the list, the counts, the keys and Close other tabs.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
function linked(settings: Record<string, unknown> = { verticalTabs: true }): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  const tabs = ['a', 'b', 'fav'].map(id => makeTab(id, '', `https://${id}.test/`, profile));
  return run({ ...state, tabs, activeTabId: 'a' }, { type: 'tab.favorite', id: 'fav', favoriteId: 'app-fav' }, { type: 'settings.update', patch: settings as never });
}

test('the default is the beta.11 behaviour: every tab shows in the list, linked or not, and nothing is saved until the option is changed', () => {
  const state = linked();
  assert.equal(state.settings.favoriteTabsInList, undefined);
  assert.equal(favoriteTabsInList(state.settings), true);
  assert.equal(favoriteTabsOnlyInTile(state.settings), false);
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', 'fav']);
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 3);
});

test('off: a linked tab lives only in its tile; the keys, the counts and Close other tabs follow the list on screen', () => {
  const state = linked({ verticalTabs: true, favoriteTabsInList: false });
  assert.equal(favoriteTabsOnlyInTile(state.settings), true);
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b'], 'Ctrl+9 is the last tab of the list');
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 2, 'the workspace title and menu count what the list shows');
  assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }), ['b'], 'a tab that is not in the list you look at stays, like a pinned one');
  assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.right', id: 'a' }), ['b']);
  assert.ok(tabListed({}, state.settings) && !tabListed({ favoriteId: 'app-fav' }, state.settings));
  assert.deepEqual([...tabNumbers(state)].map(([id, figure]) => id + figure), ['a1', 'b2'], 'the tab numbers held with Ctrl/Cmd skip it too');
  assert.deepEqual([...tabNumbers(linked())].map(([id, figure]) => id + figure), ['a1', 'b2', 'fav3']);
});

// 13.5: "Delete workspace" asks once when the Space has pages open and goes at once when it holds only new tabs (WorkspaceMenu.tsx, `pages`). A page that
// lives only in its tile is a page that closes with the Space, so it must count there; the displayed count (`tabs`) still follows the list.
test('off: a page that lives only in its tile still counts as an open page of its Space (Delete workspace must ask), while the shown count follows the list', () => {
  let state = linked({ verticalTabs: true, favoriteTabsInList: false });
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const work = state.activeWorkspaceId;
  state = run(state, { type: 'tab.select', id: 'fav', here: true });
  assert.equal(state.activeWorkspaceId, work);
  assert.deepEqual(listedTabs(state).map(tab => tab.id).filter(id => id === 'fav'), [], 'it is not in the list');
  const counts = workspaceCounts(state)[work];
  assert.equal(counts.tabs, 1, 'the shown count: only the new tab is listed');
  assert.equal(counts.pages, 1, 'but the favorite\'s page is open there: deleting the Space would close it');
  let only = run(linked({ verticalTabs: true, favoriteTabsInList: false }), { type: 'workspace.create', name: 'Only' }, { type: 'tab.select', id: 'fav', here: true });
  const blank = only.tabs.find(tab => tab.url === 'acira://new' && workspaceIdOf(only, tab) === only.activeWorkspaceId)!;
  only = run(only, { type: 'tab.close', id: blank.id });
  assert.deepEqual(only.tabs.filter(tab => workspaceIdOf(only, tab) === only.activeWorkspaceId).map(tab => tab.id), ['fav'], 'the favorite\'s tab is all that is left in the Space');
  assert.deepEqual(workspaceCounts(only)[only.activeWorkspaceId], { tabs: 0, pages: 1 }, 'no listed tab, but one open page: never read as an empty Space');
});

test('off, with tabs along the top: there are no tiles, so every tab shows and every number works', () => {
  const state = linked({ verticalTabs: false, favoriteTabsInList: false });
  assert.equal(favoriteTabsOnlyInTile(state.settings), false);
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', 'fav']);
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 3);
  assert.ok(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }).includes('fav'));
});

test('the sidebar lists a hidden tab again only when there is no tile to show it: Favorites switched off, or its favorite gone', () => {
  const settings = { verticalTabs: true, favoriteTabsInList: false }, app = (id: string) => ({ id, url: `https://${id}.test/`, title: id });
  const tab = { favoriteId: 'app-1' };
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: false }, settings), false, 'its tile is on screen');
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: true }, settings), true, 'Favorites switched off');
  assert.equal(listedInSidebar(tab, { apps: [app('app-2')], hidden: false }, settings), true, 'its favorite is gone (the sidebar hands the tab back)');
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: false }, { verticalTabs: true }), true, 'on (the default): always listed');
  assert.equal(listedInSidebar({}, { apps: [], hidden: false }, settings), true, 'an ordinary tab is always listed');
});

// A 13.4 report (Windows): "Favorites' tabs in the tab list is turned off but still working for some tabs not all, especially these ones that become
// hidden", with "+3" in the picture. The sidebar listed a tab whose tile was folded behind "+N" while main's keys, counts and Close other tabs already left
// it out, so such a tab was a row nothing else agreed on. A favorite's tab is out of the list whether its tile is shown or folded; the grid opens itself
// when the page on screen is a folded tile's (the next test).
test('a favorite behind +N is out of the list like every other favorite, whether or not +N was opened', () => {
  const settings = { verticalTabs: true, favoriteTabsInList: false }, app = (id: string) => ({ id, url: `https://${id}.test/`, title: id });
  const many = Array.from({ length: 14 }, (_, i) => app('app-' + (i + 1)));
  for (const id of ['app-1', 'app-3', 'app-11', 'app-12', 'app-13', 'app-14']) assert.equal(listedInSidebar({ favoriteId: id }, { apps: many, hidden: false }, settings), false, `${id} is a favorite with a tile`);
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: false }, { verticalTabs: true }), true, 'with the option on every tab shows');
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: true }, settings), true, 'Favorites switched off: no tile at all, so the tab shows');
});

test('the list on screen is the list main reads: numbers, Ctrl+PageDown, the counts and Close other tabs agree for every favorite, folded or not', () => {
  const state0 = createInitialState(), profile = state0.activeBrowserProfileId, settings = { verticalTabs: true, favoriteTabsInList: false };
  const apps = Array.from({ length: 14 }, (_, i) => ({ id: 'app-' + (i + 1), url: `https://f${i + 1}.test/`, title: 'Fav ' + (i + 1) }));
  const plain = ['p1', 'p2'].map(id => makeTab(id, '', `https://${id}.test/`, profile));
  const favs = [1, 5, 12, 13, 14].map(n => makeTab('t' + n, '', `https://f${n}.test/`, profile));
  let state = run({ ...state0, tabs: [...plain, ...favs], activeTabId: 'p1' }, ...favs.map((tab, i) => ({ type: 'tab.favorite', id: tab.id, favoriteId: 'app-' + [1, 5, 12, 13, 14][i] }) as BrowserAction), { type: 'settings.update', patch: settings as never });
  for (const hidden of [false]) {
    const sidebar = state.tabs.filter(tab => listedInSidebar(tab, { apps, hidden }, state.settings)).map(tab => tab.id);
    assert.deepEqual(sidebar, ['p1', 'p2'], 'no favorite has a row');
    assert.deepEqual(listedTabs(state).map(tab => tab.id), sidebar, 'Ctrl+PageDown, Ctrl+1…8 and "Next tab" walk the same list');
    assert.deepEqual([...tabNumbers(state).keys()], sidebar, 'the figures shown with Ctrl held are on those rows');
    assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, sidebar.length, 'the Space title and the workspace menu count those rows');
    assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.others', id: 'p1' }), ['p2'], 'Close other tabs closes what the list shows');
  }
});

test('the favorites grid opens itself when the page on screen is the tab of a tile folded behind +N, and only then', () => {
  const app = (id: string) => ({ id, url: `https://${id}.test/`, title: id });
  const many = Array.from({ length: 14 }, (_, i) => app('app-' + (i + 1)));
  assert.equal(tileFolded(many, 'app-12'), true, 'Standard: eleven tiles and +3, so the twelfth is folded');
  assert.equal(tileFolded(many, 'app-11'), false, 'the eleventh shows');
  assert.equal(tileFolded(many, 'app-14'), true);
  assert.equal(tileFolded(many, 'app-8', 8), true, 'Narrow: seven tiles and +N');
  assert.equal(tileFolded(many, 'app-7', 8), false);
  assert.equal(tileFolded(many.slice(0, 12), 'app-12'), false, 'twelve fit with no +N');
  assert.equal(tileFolded(many.slice(0, 8), 'app-8', 8), false, 'eight fit at Narrow with no +N');
  assert.equal(tileFolded(many, 'app-99'), false, 'no such favorite: nothing is folded');
  assert.equal(tileFolded(many, ''), false);
  const source = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(source, /const foldedActive=favoriteTabsOnlyInTile\(state\.settings\)&&!!current\.favoriteId&&tileFolded\(apps,current\.favoriteId,FAVORITES_LIMIT\[size\]\)/, 'only with the option off, for a favorite\'s tab');
  assert.match(source, /useLayoutEffect\(\(\)=>\{if\(foldedActive\)setMore\(true\);\},\[foldedActive,current\.id\]\)/, 'it opens when the page on screen changes, and a collapse by hand stays');
  assert.doesNotMatch(source, /listedInSidebar\(tab,favorites,state\.settings,folded\)/, 'the sidebar no longer passes a fold limit to the list');
});

test('the option is saved with the window and comes back after a restart; an old save without it means on', () => {
  let state = linked({ verticalTabs: true, favoriteTabsInList: false });
  state = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state))));
  assert.equal(state.settings.favoriteTabsInList, false);
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b']);
  const old = persistedSnapshot(linked());
  delete old.settings.favoriteTabsInList;
  assert.equal(favoriteTabsInList(restoreSnapshot(JSON.parse(JSON.stringify(old))).settings), true);
});

test('the bridge accepts the option as a boolean and nothing else', () => {
  const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs') as { validateAction: (action: unknown, snapshot: unknown) => unknown };
  const snapshot = { tabs: [{ id: 'tab-1', browserProfileId: 'p' }], browserProfiles: [{ id: 'p' }], workspaces: [] };
  for (const value of [true, false]) assert.deepEqual(validateAction({ type: 'settings.update', patch: { favoriteTabsInList: value } }, snapshot), { type: 'settings.update', patch: { favoriteTabsInList: value } });
  for (const value of ['no', 0, null]) assert.throws(() => validateAction({ type: 'settings.update', patch: { favoriteTabsInList: value } }, snapshot), String(value));
});

test('the row sits under Favorites in Settings › Tabs › Sidebar, is found by search, resets with the sidebar layout, and has all thirteen languages', () => {
  const panel = read('../src/features/settings/panels/sidebar.tsx'), entries = read('../src/features/settings/entries/sidebar.ts');
  const favorites = panel.indexOf('id="sidebar-apps"'), row = panel.indexOf('id="sidebar-apps-tabs"'), next = panel.indexOf('id="sidebar-new-tabs-top"');
  assert.ok(favorites > 0 && favorites < row && row < next, 'right under the Favorites row');
  assert.match(panel, /checked=\{state\.settings\.favoriteTabsInList !== false\} onChange=\{\(next\) => dispatch\(\{ type: 'settings\.update', patch: \{ favoriteTabsInList: next \} \}\)\}/);
  assert.match(panel, /favoriteTabsInList: to\.settings\.favoriteTabsInList/, 'Reset sidebar layout writes it from the shared reset list');
  assert.match(readFileSync(new URL('../src/features/settings/changed.ts', import.meta.url), 'utf8'), /favoriteTabsInList: true,/, 'and the list turns it back on');
  assert.match(entries, /\{ id: 'sidebar-apps-tabs', title: t\("sidebar\.favoriteTabsInList"\)/);
  const en = JSON.parse(read('../src/i18n/en.json')) as Record<string, string>;
  assert.equal(en['sidebar.favoriteTabsInList'], 'Favorites’ tabs in the tab list');
  for (const locale of ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const catalog = JSON.parse(read(`../src/i18n/${locale}.json`)) as Record<string, string>;
    for (const id of ['sidebar.favoriteTabsInList', 'sidebar.favoriteTabsInListDetail']) assert.ok(catalog[id] && catalog[id] !== en[id], `${locale} ${id}`);
  }
});

test('the sidebar draws the list through listedInSidebar, its groups too, and Next tab walks the same list', () => {
  const source = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(source, /listed=\(tab:TabSession\)=>listedInSidebar\(tab,favorites,state\.settings\);/);
  assert.match(source, /members:state\.tabs\.filter\(tab=>listed\(tab\)&&groupForTab\(state,tab\)\?\.id===group\.id\)/);
  assert.match(source, /listedProfileTabs=profileTabs\.filter\(listed\)/);
  assert.match(source, /tabs=\{listedProfileTabs\} groups=\{groups\}/);
  assert.match(source, /state\.tabs\.filter\(tab=>tab\.browserProfileId===profile&&listed\(tab\)\)/, 'Ctrl+Tab "Next tab"');
  assert.match(source, /switcherKey\(event\.type,.*?,state,dispatch,listed\)/);
});
