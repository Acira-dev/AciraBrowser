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
import { favoriteStaysHome, navigateFromRow } from '../src/ui/pageActions';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Item 33 (reported 7 Nov): "some people want to see the favorite's tab in the list too, some want the favorite only above, so it should be an option."
// Settings › Tabs › Sidebar › Favorites › "Favorites' tabs in the tab list": off (the default since Beta 14, H) a tab opened from or linked to a favorite lives only in
// its tile; on (beta.11's way, for everyone who chose it) the tab is an ordinary row as well. One pure rule (runtime/favoriteTabsRule.ts), read by the list, the
// counts, the keys and Close other tabs. A tile-only tab is still a tab: it counts and the keys reach it (after the rows).
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
function linked(settings: Record<string, unknown> = { verticalTabs: true }): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  const tabs = ['a', 'b', 'fav'].map(id => makeTab(id, '', `https://${id}.test/`, profile));
  return run({ ...state, tabs, activeTabId: 'a' }, { type: 'tab.favorite', id: 'fav', favoriteId: 'app-fav' }, { type: 'settings.update', patch: settings as never });
}

test('Beta 14 (H): the default is tiles only: an open Favorite has no row, yet it still counts as a tab and the keys reach it; nothing is saved until the option is changed', () => {
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

// Beta 14 (H): "an open Favorite still counts as a tab. A workspace whose only open page is a Favorite says '1 tab', never '0 tabs'."
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

test('13.7 and Beta 14: no "+N" tile and no collapse arrow; up to the chosen places every favorite is a tile, and past them the stack replaces the +N', () => {
  const source = read('../src/components/sidebar/AciraSidebar.tsx'), sizes = read('../src/runtime/sidebarSizes.ts'), apps = read('../src/ui/sidebarApps.ts'), css = read('../src/components/sidebar/sidebar.css');
  assert.doesNotMatch(source, /sb-app-more|showCountMoreFavorites|showFewerFavorites|foldedActive|tileFolded|FAVORITES_LIMIT|SIDEBAR_APPS_LIMIT|overflow=!more|setMore/, 'the sidebar has no +N fold');
  assert.doesNotMatch(sizes + apps, /FAVORITES_LIMIT|SIDEBAR_APPS_LIMIT|tileFolded/, 'no 13.6 limit constant and no fold helper');
  assert.doesNotMatch(css, /sb-app-more/, 'no style for the +N tile or the collapse arrow');
  assert.match(source, /const tiles=shown\.length\+\(overflow\?1:0\),cols=rail\?1:overflow\?stackColumns\(size\):favoriteColumns\(size,tiles\)/, 'the grid is as long as the places before the stack (the Shelf rail, Beta 14 K1: one column of every Favorite)');
  assert.match(source, /const places=rail\?Math\.max\(apps\.length,1\):placesBeforeStack\(chosenLimit,size\),tabOf=/, 'in the rail every Favorite is a tile: no stack');
  assert.match(source, /const list=shown\.map\(\(app,index\)=>tileFor\(app,index\)\);/, 'every Favorite before the stack is drawn');
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

// NO FAVORITE DOT (reported 17 Nov, very firm: "no dot at all", "genuine no dot"). Beta 14 (12 Nov) had brought back a faint dot under the icon of an open Favorite (3px, 7px above the tile's
// bottom edge, half strength, with the icon nudged up 2px); that is removed in every state and every mode (open, unloaded, sleeping, selected, hover, playing, Mini rail, Top tabs shelf).
test('no Favorite dot: the tile carries no data-dot, nothing draws an ::after on a Favorite tile, and its icon is not nudged', () => {
  const css = read('../src/components/sidebar/sidebar.css'), sidebar = read('../src/components/sidebar/AciraSidebar.tsx');
  assert.doesNotMatch(sidebar, /data-dot=/, 'the tile has no data-dot attribute (it was set for an open tab that is not the selected one)');
  assert.match(sidebar, /data-open=\{tab\?'':undefined\}/, 'data-open stays: the open state still drives the tile\'s other looks');
  assert.match(sidebar, /data-away=\{away\|\|undefined\}/, 'data-away stays for the rigs and the tile\'s title');
  assert.match(sidebar, /data-sleeping=\{tab\?\.sleeping&&favoriteTabsOnlyInTile\(state\.settings\)\?'':undefined\}/);
  // no stylesheet of the interface draws a pseudo-element on a Favorite tile (the tile, the stack, the rail and the shelf share .sb-app) or names a dot token for it
  for (const file of ['sidebar.css', 'miniRail.css', 'shelf.css', 'favorites-stack.css', 'folders.css']) {
    const sheet = read('../src/components/sidebar/' + file);
    assert.doesNotMatch(sheet, /\.sb-app(?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*::after/, file + ': nothing draws an ::after on a Favorite tile (the dot was one); the drag-and-drop bar is a ::before and only while a tile is dragged over');
    assert.doesNotMatch(sheet, /sb-fav-dot|\[data-dot\]/, file + ': no dot token or attribute');
  }
  assert.doesNotMatch(css, /\.sb-app\[data-app-id\]::after|\.sb-app\[data-dot\]|bottom:7px;width:3px|bottom:4px;width:3px/, 'neither the 7px dot of Beta 14 nor the 4px dot of 13.6');
  // the icon is not nudged for air above a dot: no rule moves a Favorite icon with `translate`, and the transition that served the nudge is gone (the peek card keeps its own)
  assert.doesNotMatch(css, /\.sb-app\[data-app-id\]>\.site-identity-icon[^{]*\{transition:translate/, 'the translate transition of the nudge is gone');
  assert.doesNotMatch(css, /translate:0 -2px/, 'the 2px nudge is gone');
  assert.match(css, /\.sb-app\[aria-current=page\]\{background:var\(--sb-current\);box-shadow:var\(--sb-current-shadow\)\}/, 'the selected tile rule is unchanged');
  assert.match(css, /\.sb-app\[aria-current=page\]:where\(:not\(\.sb-app-stack\)\),\.app\.style-acira \.acira-sidebar \.sb-apps>\.sb-glide\{background:color-mix\(in oklab,var\(--sb-site\) var\(--sb-site-tint\),var\(--sb-current\)\);box-shadow:var\(--ab-seat\)\}/, 'the site-colour tint and the gliding card are kept; the ring is the active border\'s');
  // the stack's motion and the dispersal drew the dot along with the tile: neither reads or paints a ::after any more
  const motion = read('../src/components/sidebar/favoritesStack.ts'), disperse = read('../src/components/sidebar/favoritesDisperse.ts');
  assert.doesNotMatch(motion, /dotOf|pseudoElement: '::after'/, 'the stack animates no dot');
  assert.doesNotMatch(disperse, /'::after'|dotAlpha/, 'the dispersal paints no dot');
});

// Beta 14, H: with no row to show it, a loading Favorite shows the dot-matrix loading animation in place of its icon on the tile (the address bar shows loading too).
// No speaker mark on the tile: the now-playing area shows sound.
test('Beta 14 (H): a loading Favorite shows the dot matrix in place of its icon after 300ms, the stack\'s plates never do, and the tile has no speaker mark', () => {
  const sidebar = read('../src/components/sidebar/AciraSidebar.tsx'), css = read('../src/components/sidebar/sidebar.css');
  assert.match(sidebar, /const loading=useLoadingSignal\(!still&&!!tab&&tabShowsLoading\(tab\)\);/);
  assert.match(sidebar, /if\(loading\)return <><span className="sb-app-loading" aria-hidden="true"><DotMatrix preset="loader" size=\{16\} reducedMotion=\{reduced\}\/><\/span>\{marker\}<\/>;/);
  assert.match(css, /\.sb-app-loading\{display:grid;place-items:center;width:20px;height:20px/);
  const tile = sidebar.slice(sidebar.indexOf('function AppIcon('), sidebar.indexOf("/** A private window's inline Add / Edit favorite."));
  assert.doesNotMatch(tile, /audible|tabSound|Volume|Speaker/, 'no speaker mark on the tile');
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
  // Beta 14.4: Favorites have their own group on the Sidebar page; this row closes it.
  const group = panel.indexOf('id="favorites">'), favorites = panel.indexOf('id="sidebar-apps"'), row = panel.indexOf('id="sidebar-apps-tabs"'), next = panel.indexOf('</SettingGroup>', row);
  assert.ok(group > 0 && group < favorites && favorites < row && row < next, 'in the Favorites group, under the Favorites row');
  assert.match(panel, /checked=\{favoriteTabsInList\(state\.settings\)\} disabled=\{shelf \|\| apps\.hidden\} onChange=\{\(next\) => dispatch\(\{ type: 'settings\.update', patch: \{ favoriteTabsInList: next \} \}\)\}/);
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
  assert.match(source, /const groups=sidebarGroups\(state,profileId,listed\);/, 'the groups are built from the listed tabs (Beta 14 AE: sidebarRows.ts sidebarGroups)');
  assert.match(read('../src/components/sidebar/sidebarRows.ts'), /members:state\.tabs\.filter\(tab=>listed\(tab\)&&groupForTab\(state,tab\)\?\.id===group\.id\)/);
  assert.match(source, /listedProfileTabs=profileTabs\.filter\(listed\)/);
  assert.match(source, /tabs=\{listedProfileTabs\} openCount=\{profileTabs\.length\} groups=\{groups\}/);
  // Ctrl+Tab "Next tab" is main's (desktop/tab-cycle.cjs, A11): the sidebar tells it which tabs the list leaves out, and main walks the rows and then those (src/runtime/tabCycle.ts cycleOrder).
  assert.match(source, /unlistedKey=state\.tabs\.filter\(tab=>!listed\(tab\)\)\.map\(tab=>tab\.id\)\.join\(' '\)/, 'Ctrl+Tab "Next tab" is told which tabs live only in their tile');
  assert.match(source, /type:'switcher-config',tabId:now\.activeTabId,mode:readCtrlTabMode\(\),show:readCtrlTabShow\(\),unlisted:/);
  assert.match(read('../src/runtime/tabCycle.ts'), /own = sidebar \? state\.tabs\.filter\(tab => tab\.browserProfileId === profile\) : state\.tabs;/, 'this profile only');
  assert.match(read('../src/runtime/tabCycle.ts'), /return sidebar \? \[\.\.\.order, \.\.\.own\.filter\(tab => unlisted\.has\(tab\.id\)\)\.map\(tab => tab\.id\)\] : order;/, 'the rows, then the tabs that live only in their tile');
  assert.match(source, /switcherKey\(event\.type,event as/);
});

// QA walk QW-5: the Shelf's quiet rows (an empty Bookmarks, Reading list, History or Downloads) had a fixed one-row height, so a line that wraps to three lines (Spanish, Italian, Russian) ran past its divider.
// They are a row high at least and grow with their text, whatever the language or the string.
test('the quiet rows grow with their text: min-height, never a fixed height, for the sidebar rows and the Bookmarks row', () => {
  const css = read('../src/components/sidebar/sidebar.css');
  for (const selector of ['.app.style-acira .acira-sidebar .sb-section-empty{', '.app.style-acira .acira-sidebar .sb-bookmarks-empty{']) {
    const rule = css.split('\n').find(line => line.startsWith(selector)) ?? '';
    assert.ok(rule, selector + ' exists');
    assert.match(rule, /min-height:var\(--sb-row\)/, selector + ': a row high at least');
    assert.doesNotMatch(rule, /[^-]height:var\(--sb-row\)/, selector + ': no fixed height (it clipped three-line text)');
    assert.match(rule, /padding:2px 6px/, selector + ': air above and below the text when the row grows');
    assert.match(rule, /line-height:14px/, selector + ': a line height of its own, so two lines still fit one row (28 + 4 = 32)');
  }
});
