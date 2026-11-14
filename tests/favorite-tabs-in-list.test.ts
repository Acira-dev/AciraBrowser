import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { bulkCloseTargets } from '../src/runtime/profileActions';
import { favoriteTabsInList, favoriteTabsOnlyInTile, listedTabs, rowTabs, tabListed } from '../src/runtime/favoriteTabs';
import { workspaceCounts, workspaceIdOf } from '../src/runtime/workspaces';
import { tabNumbers } from '../src/runtime/tabNumbers';
import { listedInSidebar } from '../src/ui/sidebarApps';
import { nextInCycle, nextTabOrder } from '../src/ui/tabMru';
import { favoriteStaysHome, navigateFromRow } from '../src/ui/pageActions';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Item 33 (reported 7 Nov): "some people want to see the favorite's tab in the list too, some want the favorite only above, so it should be an option."
// Settings › Tabs › Sidebar › Favorites › "Favorites' tabs in the tab list": off (the default since 13.9, decided 14 Nov) a tab opened from or linked to a favorite lives only in
// its tile; on (beta.11's way, for everyone who chose it) the tab is an ordinary row as well. One pure rule (runtime/favoriteTabsRule.ts), read by the list, the
// counts, the keys and Close other tabs. A tile-only tab is still a tab: it counts and the keys reach it (after the rows).
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
function linked(settings: Record<string, unknown> = { verticalTabs: true }): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  const tabs = ['a', 'b', 'fav'].map(id => makeTab(id, '', `https://${id}.test/`, profile));
  return run({ ...state, tabs, activeTabId: 'a' }, { type: 'tab.favorite', id: 'fav', favoriteId: 'app-fav' }, { type: 'settings.update', patch: settings as never });
}

test('13.9: the default is tiles only: an open Favorite has no row, yet it still counts as a tab and the keys reach it; nothing is saved until the option is changed', () => {
  const state = linked();
  assert.equal(state.settings.favoriteTabsInList, undefined, 'nothing is saved for the default');
  assert.equal(favoriteTabsInList(state.settings), false, 'a setting nobody touched reads Off');
  assert.equal(favoriteTabsOnlyInTile(state.settings), true);
  assert.deepEqual(rowTabs(state).map(tab => tab.id), ['a', 'b'], 'the list on screen has no row for it');
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', 'fav'], 'the keys walk the rows, then the tile-only tabs: Ctrl+9 is the last of them, Next tab does not skip it');
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 3, 'it is an open tab, so it counts');
});

test('everyone who turned the option On keeps it: only an explicit true lists the tab', () => {
  const state = linked({ verticalTabs: true, favoriteTabsInList: true });
  assert.equal(favoriteTabsInList(state.settings), true);
  assert.equal(favoriteTabsOnlyInTile(state.settings), false);
  assert.deepEqual(rowTabs(state).map(tab => tab.id), ['a', 'b', 'fav']);
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', 'fav']);
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 3);
  assert.ok(tabListed({ favoriteId: 'app-fav' }, state.settings));
});

// 13.9: "an open Favorite still counts as a tab. A workspace whose only open page is a Favorite says '1 tab', never '0 tabs'."
test('a Space whose only tab is a tile-only Favorite counts 1 tab, never 0 (the workspace title and menu), and its page is open', () => {
  const state0 = createInitialState(), profile = state0.activeBrowserProfileId, fav = makeTab('fav', '', 'https://fav.test/', profile);
  const state = run({ ...state0, tabs: [fav], activeTabId: 'fav' }, { type: 'tab.favorite', id: 'fav', favoriteId: 'app-fav' }, { type: 'settings.update', patch: { verticalTabs: true } });
  assert.equal(favoriteTabsOnlyInTile(state.settings), true);
  assert.deepEqual(workspaceCounts(state)[state.workspaces[0].id], { tabs: 1, pages: 1 });
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['fav'], 'Ctrl+1 and Ctrl+9 land on it');
  const sidebar = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /<WorkspaceTitle state=\{state\} count=\{profileTabs\.length\}\/>/, 'the title line under the workspace row counts every open tab, not only the rows');
  assert.doesNotMatch(sidebar, /count=\{listedProfileTabs\.length\}/);
  assert.match(sidebar, /tabs=\{listedProfileTabs\} openCount=\{profileTabs\.length\}/, 'the New tab button counts every open tab of the profile');
  assert.match(sidebar, /newTabCountOpen", \{ count: openCount \?\? tabs\.length \}/);
});

test('the keys: next, previous and the digits reach a tile-only Favorite from anywhere, and move-tab only moves rows', () => {
  const state = linked({ verticalTabs: true });
  const main = read('../desktop/main.cjs');
  assert.match(main, /case 'cycle-tab':\{[^}]*const here=listedTabs\(state\),i=here\.findIndex\(t=>t\.id===active\.id\)/, 'next tab walks listedTabs: the rows, then the tile-only tabs');
  assert.match(main, /case 'select-tab':\{const here=listedTabs\(state\)/);
  assert.match(main, /case 'move-tab':\{[^}]*const here=rowTabs\(state\),index=here\.findIndex/, 'only the rows on screen have a place to move to');
  // From the Favorite's own tab: next goes on to the first row (it is the last of the walk), previous to the last row.
  const here = listedTabs(state), at = here.findIndex(tab => tab.id === 'fav');
  assert.equal(at, 2);
  assert.equal(here[(at + 1) % here.length].id, 'a');
  assert.equal(here[(at - 1 + here.length) % here.length].id, 'b');
});

test('off: a linked tab lives only in its tile; Close other tabs leaves it alone, the keys and the counts include it', () => {
  const state = linked({ verticalTabs: true, favoriteTabsInList: false });
  assert.equal(favoriteTabsOnlyInTile(state.settings), true);
  assert.deepEqual(rowTabs(state).map(tab => tab.id), ['a', 'b'], 'the list on screen');
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', 'fav'], 'Ctrl+9 is the last tab, the Favorite\'s');
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 3, 'the workspace title and menu count every open tab');
  assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }), ['b'], 'a tab that is not in the list you look at stays, like a pinned one');
  assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.right', id: 'a' }), ['b']);
  assert.ok(tabListed({}, state.settings) && !tabListed({ favoriteId: 'app-fav' }, state.settings));
  assert.deepEqual([...tabNumbers(state)].map(([id, figure]) => id + figure), ['a1', 'b2', 'fav3'], 'the rows keep their numbers 1, 2; the Favorite\'s tab follows them (no row draws it)');
  assert.deepEqual([...tabNumbers(linked())].map(([id, figure]) => id + figure), ['a1', 'b2', 'fav3']);
});

// 13.5: "Delete workspace" asks once when the Space has pages open and goes at once when it holds only new tabs (WorkspaceMenu.tsx, `pages`). A page that
// lives only in its tile is a page that closes with the Space, so it must count there; the displayed count (`tabs`) still follows the list.
test('off: a page that lives only in its tile counts as an open tab and an open page of its Space (Delete workspace must ask)', () => {
  let state = linked({ verticalTabs: true, favoriteTabsInList: false });
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const work = state.activeWorkspaceId;
  state = run(state, { type: 'tab.select', id: 'fav', here: true });
  assert.equal(state.activeWorkspaceId, work);
  assert.deepEqual(rowTabs(state).map(tab => tab.id).filter(id => id === 'fav'), [], 'it is not in the list');
  const counts = workspaceCounts(state)[work];
  assert.equal(counts.tabs, 2, 'the shown count: the new tab and the Favorite\'s tab');
  assert.equal(counts.pages, 1, 'but the favorite\'s page is open there: deleting the Space would close it');
  let only = run(linked({ verticalTabs: true, favoriteTabsInList: false }), { type: 'workspace.create', name: 'Only' }, { type: 'tab.select', id: 'fav', here: true });
  const blank = only.tabs.find(tab => tab.url === 'acira://new' && workspaceIdOf(only, tab) === only.activeWorkspaceId)!;
  only = run(only, { type: 'tab.close', id: blank.id });
  assert.deepEqual(only.tabs.filter(tab => workspaceIdOf(only, tab) === only.activeWorkspaceId).map(tab => tab.id), ['fav'], 'the favorite\'s tab is all that is left in the Space');
  assert.deepEqual(workspaceCounts(only)[only.activeWorkspaceId], { tabs: 1, pages: 1 }, 'one open tab, one open page: "1 tab", never "0 tabs"');
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
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: false }, { verticalTabs: true }), false, 'nothing chosen: the default is tiles only');
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: false }, { verticalTabs: true, favoriteTabsInList: true }), true, 'On: always listed');
  assert.equal(listedInSidebar({}, { apps: [], hidden: false }, settings), true, 'an ordinary tab is always listed');
});

// A 13.4 report (Windows): "Favorites' tabs in the tab list is turned off but still working for some tabs not all, especially these ones that become
// hidden", with "+3" in the picture. The sidebar listed a tab whose tile was folded behind "+N" while main's keys, counts and Close other tabs already left
// it out, so such a tab was a row nothing else agreed on. A favorite's tab is out of the list for every favorite. 13.7: there is no "+N" any more, every
// favorite has its tile in the grid (a 13.6 report: "all the favorite tabs I add would show right there"), and this still holds for any number of favorites.
test('every favorite, however many there are, is out of the list like every other favorite', () => {
  const settings = { verticalTabs: true, favoriteTabsInList: false }, app = (id: string) => ({ id, url: `https://${id}.test/`, title: id });
  const many = Array.from({ length: 14 }, (_, i) => app('app-' + (i + 1)));
  for (const id of ['app-1', 'app-3', 'app-11', 'app-12', 'app-13', 'app-14']) assert.equal(listedInSidebar({ favoriteId: id }, { apps: many, hidden: false }, settings), false, `${id} is a favorite with a tile`);
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: false }, { verticalTabs: true, favoriteTabsInList: true }), true, 'with the option on every tab shows');
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: true }, settings), true, 'Favorites switched off: no tile at all, so the tab shows');
});

test('main reads the rows the sidebar draws, then every Favorite\'s tab: numbers, Ctrl+PageDown, the counts and Close other tabs agree for every favorite', () => {
  const state0 = createInitialState(), profile = state0.activeBrowserProfileId, settings = { verticalTabs: true, favoriteTabsInList: false };
  const apps = Array.from({ length: 14 }, (_, i) => ({ id: 'app-' + (i + 1), url: `https://f${i + 1}.test/`, title: 'Fav ' + (i + 1) }));
  const plain = ['p1', 'p2'].map(id => makeTab(id, '', `https://${id}.test/`, profile));
  const favs = [1, 5, 12, 13, 14].map(n => makeTab('t' + n, '', `https://f${n}.test/`, profile));
  let state = run({ ...state0, tabs: [...plain, ...favs], activeTabId: 'p1' }, ...favs.map((tab, i) => ({ type: 'tab.favorite', id: tab.id, favoriteId: 'app-' + [1, 5, 12, 13, 14][i] }) as BrowserAction), { type: 'settings.update', patch: settings as never });
  for (const hidden of [false]) {
    const sidebar = state.tabs.filter(tab => listedInSidebar(tab, { apps, hidden }, state.settings)).map(tab => tab.id);
    assert.deepEqual(sidebar, ['p1', 'p2'], 'no favorite has a row');
    assert.deepEqual(rowTabs(state).map(tab => tab.id), sidebar, 'main\'s list of rows is the one the sidebar draws');
    assert.deepEqual(listedTabs(state).map(tab => tab.id), [...sidebar, 't1', 't5', 't12', 't13', 't14'], 'Ctrl+PageDown, Ctrl+1…9 and "Next tab" walk the rows, then every Favorite\'s tab');
    assert.deepEqual([...tabNumbers(state)].slice(0, sidebar.length).map(([id, figure]) => id + figure), ['p11', 'p22'], 'the figures shown with Ctrl held on the rows are 1 and 2, as before');
    assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, state.tabs.length, 'the Space title and the workspace menu count every open tab');
    assert.deepEqual(bulkCloseTargets(state, { type: 'tab.close.others', id: 'p1' }), ['p2'], 'Close other tabs closes what the list shows');
  }
});

test('13.7: the favorites grid shows every favorite: no "+N" tile, no collapse arrow, no fold state, no limit constant', () => {
  const source = read('../src/components/sidebar/AciraSidebar.tsx'), sizes = read('../src/runtime/sidebarSizes.ts'), apps = read('../src/ui/sidebarApps.ts'), css = read('../src/components/sidebar/sidebar.css');
  assert.doesNotMatch(source, /sb-app-more|showCountMoreFavorites|showFewerFavorites|foldedActive|tileFolded|FAVORITES_LIMIT|SIDEBAR_APPS_LIMIT|overflow=!more|setMore/, 'the sidebar has no fold');
  assert.doesNotMatch(sizes + apps, /FAVORITES_LIMIT|SIDEBAR_APPS_LIMIT|tileFolded/, 'no limit and no fold helper');
  assert.doesNotMatch(css, /sb-app-more/, 'no style for the +N tile or the collapse arrow');
  assert.match(source, /const tiles=apps\.length,cols=favoriteColumns\(size,tiles\)/, 'the grid is as long as the favorites');
  assert.match(source, /const tiles=apps\.map\(\(app,index\)=>\{/, 'every favorite is drawn');
});

// A 13.6 report (Windows): "I am on YouTube, which is in my bookmarks, but in the left bar it's highlighting Google Calendar." A Bookmarks row navigated the tab on
// screen, and that was the Google Calendar favorite's tab: it stayed linked to its favorite (so its tile kept the ring, on Calendar's own icon) while the page was
// YouTube. A saved-page row now opens another site's page in a new tab beside a favorite's tab; the favorite's tab stays on its site.
test('a favorite\'s tab stays on its site: a saved page of another site opens in a new tab, a page of the same site opens in place', () => {
  const calendar = { favoriteId: 'app-cal', url: 'https://calendar.google.com/calendar/u/0/r' };
  assert.equal(favoriteStaysHome(calendar, 'https://www.youtube.com/'), true, 'YouTube from the Calendar favorite\'s tab');
  assert.equal(favoriteStaysHome(calendar, 'https://calendar.google.com/calendar/u/0/r/month'), false, 'the same site opens in place');
  assert.equal(favoriteStaysHome({ ...calendar, url: 'https://www.youtube.com/watch?v=1' }, 'https://youtube.com/'), false, 'www is the same site');
  assert.equal(favoriteStaysHome({ url: 'https://calendar.google.com/' }, 'https://www.youtube.com/'), false, 'an ordinary tab navigates as it always did');
  assert.equal(favoriteStaysHome(undefined, 'https://www.youtube.com/'), false);
  const state0 = createInitialState(), profile = state0.activeBrowserProfileId;
  const tab = makeTab('cal', '', calendar.url, profile), other = makeTab('p', '', 'https://example.test/', profile);
  const state = run({ ...state0, tabs: [other, tab], activeTabId: 'cal' }, { type: 'tab.favorite', id: 'cal', favoriteId: 'app-cal' } as BrowserAction);
  const sent: BrowserAction[] = [];
  navigateFromRow(state, action => sent.push(action))('https://www.youtube.com/');
  navigateFromRow({ ...state, activeTabId: 'p' }, action => sent.push(action))('https://www.youtube.com/');
  navigateFromRow(state, action => sent.push(action))('https://calendar.google.com/calendar/u/0/r/week');
  assert.deepEqual(sent, [
    { type: 'tab.new', url: 'https://www.youtube.com/' },
    { type: 'tab.navigate', url: 'https://www.youtube.com/' },
    { type: 'tab.navigate', url: 'https://calendar.google.com/calendar/u/0/r/week' },
  ]);
  const source = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.equal((source.match(/openPage\(event,url,dispatch,navigateFromRow\(state,dispatch\)\)/g) || []).length, 3, 'the Bookmarks, History and Reading list rows');
  assert.doesNotMatch(source, /openPage\(event,url,dispatch,next=>dispatch\(\{type:'tab\.navigate',url:next\}\)\)/, 'no sidebar row navigates a favorite\'s tab away');
});

test('the option is saved with the window and comes back after a restart; an old save without it means Off (tiles only), a saved On stays On', () => {
  let state = linked({ verticalTabs: true, favoriteTabsInList: false });
  state = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state))));
  assert.equal(state.settings.favoriteTabsInList, false);
  assert.deepEqual(rowTabs(state).map(tab => tab.id), ['a', 'b']);
  const old = persistedSnapshot(linked());
  delete old.settings.favoriteTabsInList;
  assert.equal(favoriteTabsInList(restoreSnapshot(JSON.parse(JSON.stringify(old))).settings), false);
  const chosen = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(linked({ verticalTabs: true, favoriteTabsInList: true })))));
  assert.equal(chosen.settings.favoriteTabsInList, true, 'someone who turned it On on purpose keeps it');
  assert.equal(favoriteTabsInList(chosen.settings), true);
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
  assert.match(panel, /checked=\{favoriteTabsInList\(state\.settings\)\} onChange=\{\(next\) => dispatch\(\{ type: 'settings\.update', patch: \{ favoriteTabsInList: next \} \}\)\}/);
  assert.match(panel, /favoriteTabsInList: to\.settings\.favoriteTabsInList/, 'Reset sidebar layout writes it from the shared reset list');
  assert.match(readFileSync(new URL('../src/features/settings/changed.ts', import.meta.url), 'utf8'), /favoriteTabsInList: false,/, 'and the list puts back the default, Off');
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
  assert.match(source, /tabs=\{listedProfileTabs\} openCount=\{profileTabs\.length\} groups=\{groups\}/);
  assert.match(source, /own=vertical\?state\.tabs\.filter\(tab=>tab\.browserProfileId===profile\):state\.tabs,target=nextInCycle\(nextTabOrder\(own,state\.tabGroups,state\.activeTabId,vertical,listed\),/, 'Ctrl+Tab "Next tab" walks the rows, then the tile-only tabs (ui/tabMru.ts nextTabOrder)');
  assert.match(source, /switcherKey\(event\.type,.*?,state,dispatch,listed\)/);
});

// 13.9 (decided 14 Nov: Favorites' tabs in the list off by default): Ctrl+Tab's Next tab (the default mode) is a key like Ctrl+PageDown and Ctrl+1…9: it reaches a Favorite's tab.
test('Next tab (Ctrl+Tab) walks the rows and then every Favorite\'s tab, from any tab, both ways, wrapping; the strip along the top is as it was', () => {
  const state = linked({ verticalTabs: true });
  const listed = (tab: { favoriteId?: string }) => tabListed(tab, state.settings);
  const order = nextTabOrder(state.tabs, state.tabGroups, state.activeTabId, true, listed);
  assert.deepEqual(order, ['a', 'b', 'fav'], 'rows first, the tile-only tab last (the order of listedTabs)');
  assert.deepEqual(order, listedTabs(state).map(tab => tab.id), 'one order for Ctrl+Tab, Ctrl+PageDown and Ctrl+1…9');
  assert.equal(nextInCycle(order, 'b', 1), 'fav', 'forward from the last row reaches the Favorite');
  assert.equal(nextInCycle(order, 'fav', 1), 'a', 'forward from the Favorite wraps to the first row');
  assert.equal(nextInCycle(order, 'fav', -1), 'b', 'back from the Favorite goes to the last row');
  assert.equal(nextInCycle(order, 'a', -1), 'fav', 'back from the first row wraps to the Favorite');
  // two Favorites keep the window's tab order among themselves
  const two = run(linked({ verticalTabs: true }), { type: 'tab.new', url: 'https://c.test/' }, { type: 'tab.favorite', id: state.tabs[1].id, favoriteId: 'app-b' });
  const both = nextTabOrder(two.tabs, two.tabGroups, two.activeTabId, true, tab => tabListed(tab, two.settings));
  assert.deepEqual(both, listedTabs(two).map(tab => tab.id));
  assert.equal(both.slice(-2).join(), two.tabs.filter(tab => tab.favoriteId).map(tab => tab.id).join());
  // listed (On): nothing is held back. Tabs along the top list every tab, whatever the option says.
  const on = linked({ verticalTabs: true, favoriteTabsInList: true });
  assert.deepEqual(nextTabOrder(on.tabs, on.tabGroups, on.activeTabId, true, tab => tabListed(tab, on.settings)), ['a', 'b', 'fav']);
  const strip = linked({ verticalTabs: false });
  assert.deepEqual(nextTabOrder(strip.tabs, strip.tabGroups, strip.activeTabId, false, tab => tabListed(tab, strip.settings)), ['a', 'b', 'fav']);
});
