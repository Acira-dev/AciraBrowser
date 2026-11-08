import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { bulkCloseTargets } from '../src/runtime/profileActions';
import { favoriteTabsInList, favoriteTabsOnlyInTile, listedTabs, tabListed } from '../src/runtime/favoriteTabs';
import { workspaceCounts } from '../src/runtime/workspaces';
import { tabNumbers } from '../src/runtime/tabNumbers';
import { listedInSidebar } from '../src/ui/sidebarApps';
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

test('off, with tabs along the top: there are no tiles, so every tab shows and every number works', () => {
  const state = linked({ verticalTabs: false, favoriteTabsInList: false });
  assert.equal(favoriteTabsOnlyInTile(state.settings), false);
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', 'fav']);
  assert.equal(workspaceCounts(state)[state.workspaces[0].id].tabs, 3);
  assert.ok(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }).includes('fav'));
});

test('the sidebar lists a hidden tab again whenever its tile is not there to show it: Favorites switched off, its favorite gone, its tile folded behind +N', () => {
  const settings = { verticalTabs: true, favoriteTabsInList: false }, app = (id: string) => ({ id, url: `https://${id}.test/`, title: id });
  const tab = { favoriteId: 'app-1' };
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: false }, settings), false, 'its tile is on screen');
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: true }, settings), true, 'Favorites switched off');
  assert.equal(listedInSidebar(tab, { apps: [app('app-2')], hidden: false }, settings), true, 'its favorite is gone (the sidebar hands the tab back)');
  const many = Array.from({ length: 14 }, (_, i) => app('app-' + (i + 1)));
  assert.equal(listedInSidebar({ favoriteId: 'app-3' }, { apps: many, hidden: false }, settings), false, 'a tile in the first eleven shows');
  assert.equal(listedInSidebar({ favoriteId: 'app-13' }, { apps: many, hidden: false }, settings), true, 'a tile folded behind +N');
  assert.equal(listedInSidebar({ favoriteId: 'app-12' }, { apps: many.slice(0, 12), hidden: false }, settings), false, 'twelve fit with no +N');
  assert.equal(listedInSidebar(tab, { apps: [app('app-1')], hidden: false }, { verticalTabs: true }), true, 'on (the default): always listed');
  assert.equal(listedInSidebar({}, { apps: [], hidden: false }, settings), true, 'an ordinary tab is always listed');
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
  assert.match(panel, /patch: \{ sidebarWidth: SIDEBAR_WIDTH\.initial, sidebarSide: 'left', favoriteTabsInList: true \}/, 'Reset sidebar layout turns it back on');
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
  assert.match(source, /const listed=\(tab:TabSession\)=>listedInSidebar\(tab,favorites,state\.settings\);/);
  assert.match(source, /members:state\.tabs\.filter\(tab=>listed\(tab\)&&groupForTab\(state,tab\)\?\.id===group\.id\)/);
  assert.match(source, /listedProfileTabs=profileTabs\.filter\(listed\)/);
  assert.match(source, /tabs=\{listedProfileTabs\} groups=\{groups\}/);
  assert.match(source, /state\.tabs\.filter\(tab=>tab\.browserProfileId===profile&&listed\(tab\)\)/, 'Ctrl+Tab "Next tab"');
  assert.match(source, /switcherKey\(event\.type,.*?,state,dispatch,listed\)/);
});
