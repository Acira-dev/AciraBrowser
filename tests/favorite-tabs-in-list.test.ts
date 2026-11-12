import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { bulkCloseTargets } from '../src/runtime/profileActions';
import { favoriteTabsInList, favoriteTabsOnlyInTile, listedTabs, tabListed } from '../src/runtime/favoriteTabs';
import { workspaceCounts, workspaceIdOf } from '../src/runtime/workspaces';
import { tabNumbers } from '../src/runtime/tabNumbers';
import { listedInSidebar } from '../src/ui/sidebarApps';
import { favoriteStaysHome, navigateFromRow } from '../src/ui/pageActions';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Item 33 (reported 7 Nov): "some people want to see the favorite's tab in the list too, some want the favorite only above, so it should be an option."
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
// it out, so such a tab was a row nothing else agreed on. A favorite's tab is out of the list for every favorite. 13.7: there is no "+N" any more, every
// favorite has its tile in the grid (a 13.6 report: "all the favorite tabs I add would show right there"), and this still holds for any number of favorites.
test('every favorite, however many there are, is out of the list like every other favorite', () => {
  const settings = { verticalTabs: true, favoriteTabsInList: false }, app = (id: string) => ({ id, url: `https://${id}.test/`, title: id });
  const many = Array.from({ length: 14 }, (_, i) => app('app-' + (i + 1)));
  for (const id of ['app-1', 'app-3', 'app-11', 'app-12', 'app-13', 'app-14']) assert.equal(listedInSidebar({ favoriteId: id }, { apps: many, hidden: false }, settings), false, `${id} is a favorite with a tile`);
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: false }, { verticalTabs: true }), true, 'with the option on every tab shows');
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: true }, settings), true, 'Favorites switched off: no tile at all, so the tab shows');
});

test('the list on screen is the list main reads: numbers, Ctrl+PageDown, the counts and Close other tabs agree for every favorite', () => {
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

// Decided (11 Nov, 13.7): "Leave it as it is ... just remove the dot." The small dot under a favorite that has an open tab (and the darker "away" dot) is not drawn any more.
// Nothing else changes: the selected tile keeps its 2px site-colour ring and its gliding card, and every reader of data-open (the rigs, the tile/list agreement) still works.
test('13.7: no dot under an open favorite; the data-open / data-away / data-sleeping attributes stay and the selected tile keeps its ring', () => {
  const css = read('../src/components/sidebar/sidebar.css'), sidebar = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.doesNotMatch(css, /\.sb-app\[data-open\]::after|\.sb-app\[data-away\]::after|\.sb-app\[aria-current=page\]::after|\.sb-app\[data-sleeping\][^{]*::after/, 'no dot rule is left');
  assert.doesNotMatch(css, /3px dot/);
  assert.match(sidebar, /data-open=\{tab\?'':undefined\}/, 'data-open is still drawn on the tile (tile/list agreement, the rigs read it)');
  assert.match(sidebar, /data-away=\{away\|\|undefined\}/, 'and data-away');
  assert.match(sidebar, /data-sleeping=\{tab\?\.sleeping&&favoriteTabsOnlyInTile\(state\.settings\)\?'':undefined\}/, 'and data-sleeping');
  assert.match(css, /\.sb-app\[data-sleeping\]:not\(\[aria-current=page\]\):not\(:hover\):not\(:focus-visible\)>\*\{opacity:var\(--sb-sleeping-icon\)\}/, 'a sleeping tab still dims its tile icon');
  assert.match(css, /\.sb-app\[aria-current=page\]\{background:var\(--sb-current\);box-shadow:var\(--sb-current-shadow\)\}/, 'the 13.6 selected tile rule is unchanged');
  assert.match(css, /\.sb-app\[aria-current=page\],\.sb-apps>\.sb-glide\)\{background:color-mix\(in oklab,var\(--sb-site\) var\(--sb-site-tint\),var\(--sb-current\)\);box-shadow:inset 0 0 0 2px var\(--sb-site\)\}/, 'the 2px site-colour ring and the gliding card are unchanged');
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
