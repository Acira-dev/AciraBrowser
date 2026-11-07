import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { bulkCloseTargets } from '../src/runtime/profileActions';
import { favoriteTabOf, listedTabs } from '../src/runtime/favoriteTabs';
import { scopeToWorkspace, workspaceCounts, workspaceIdOf } from '../src/runtime/workspaces';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// A favorite is linked to one tab (reviewer, 2 Nov: "fav tabs aren't a tab … it's basically a bookmark"; founder, 6 Nov: "the tab must not
// disappear when it's added to Favorites"). The tab is an ordinary tab of the list, where it was; the tile reaches it. The reducer half:
// runtime/favoriteTabs.ts and its uses in core.ts.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const YT = 'https://www.youtube.com/';
function base(): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  return run({ ...state, tabs: ['a', 'b'].map(id => makeTab(id, '', `https://${id}.test/`, profile)), activeTabId: 'a' }, { type: 'ui.update', patch: {} });
}
const open = (state: BrowserSnapshot, favoriteId = 'app-yt', url = YT) => run(state, { type: 'tab.new', url, browserProfileId: state.activeBrowserProfileId, favoriteId });
const owners = (state: BrowserSnapshot, favoriteId = 'app-yt') => state.tabs.filter(tab => tab.favoriteId === favoriteId);

test('the first click opens the favorite in its own tab, on screen', () => {
  const state = open(base()), tab = owners(state)[0];
  assert.equal(owners(state).length, 1);
  assert.equal(tab.url, YT);
  assert.equal(state.activeTabId, tab.id);
  assert.equal(state.tabs.length, 3);
});

test('a later open of the same favorite returns to that tab: never a second copy (even if a click races the first)', () => {
  let state = open(base());
  const own = owners(state)[0].id;
  state = run(state, { type: 'tab.select', id: 'a' });
  state = open(state);
  assert.equal(owners(state).length, 1);
  assert.equal(state.activeTabId, own);
  assert.equal(state.tabs.length, 3);
  // Opening it again while it is on screen changes nothing.
  assert.equal(open(state).tabs.length, 3);
  // Another favorite gets its own tab.
  assert.equal(owners(open(state, 'app-mail', 'https://mail.example/'), 'app-mail').length, 1);
});

test('navigating inside the favorite stays in its tab, which stays the favorite\'s', () => {
  let state = open(base());
  const own = owners(state)[0].id;
  state = run(state, { type: 'tab.navigate', url: 'https://www.youtube.com/watch?v=42' });
  state = run(state, { type: 'browser.event', event: { type: 'state', tabId: own, url: 'https://www.youtube.com/watch?v=43', title: 'Video' } } as BrowserAction);
  assert.equal(state.tabs.length, 3);
  assert.equal(state.tabs.find(tab => tab.id === own)!.favoriteId, 'app-yt');
  assert.equal(state.tabs.find(tab => tab.id === own)!.url, 'https://www.youtube.com/watch?v=43');
  // The way back to the saved address is a navigation of the same tab (the tile's click on its own tab when away).
  state = run(state, { type: 'tab.navigate', url: YT, tabId: own });
  assert.equal(state.tabs.length, 3);
  assert.equal(state.tabs.find(tab => tab.id === own)!.url, YT);
});

test('closing the favorite\'s tab unloads it; the next open makes one tab again; Reopen closed tab never makes a second owner', () => {
  let state = open(base());
  const first = owners(state)[0].id;
  state = run(state, { type: 'tab.close', id: first });
  assert.equal(owners(state).length, 0, 'the page is gone');
  assert.equal(state.closedTabs[0].favoriteId, 'app-yt');
  // Reopen closed tab with no other owner: it is the favorite's again.
  const reopened = run(state, { type: 'tab.restore' });
  assert.deepEqual(owners(reopened).map(tab => tab.id), [first]);
  // Opened again from the tile first, then Reopen closed tab: the reopened one comes back as an ordinary tab.
  state = open(state);
  const second = owners(state)[0].id;
  state = run(state, { type: 'tab.restore' });
  assert.ok(state.tabs.some(tab => tab.id === first), 'the closed tab came back');
  assert.deepEqual(owners(state).map(tab => tab.id), [second]);
});

test('a duplicate of the favorite\'s tab is an ordinary tab', () => {
  let state = open(base());
  state = run(state, { type: 'tab.duplicate', id: owners(state)[0].id });
  assert.equal(state.tabs.length, 4);
  assert.equal(owners(state).length, 1);
});

test('Close other tabs, Close tabs to the right close the favorite\'s tab like any tab of the list (the favorite stays)', () => {
  let state = open(base());
  const own = owners(state)[0].id;
  state = run(state, { type: 'tab.select', id: 'a' });
  assert.ok(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }).includes(own));
  assert.ok(bulkCloseTargets(state, { type: 'tab.close.right', id: 'a' }).includes(own));
  assert.ok(!bulkCloseTargets(state, { type: 'tab.close.left', id: 'a' }).includes(own));
  assert.ok(bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }).includes('b'));
  // A pinned tab still stays, favorite or not.
  state = run(state, { type: 'tab.pin', id: own });
  assert.ok(!bulkCloseTargets(state, { type: 'tab.close.others', id: 'a' }).includes(own));
});

test('favorites are per profile: another profile\'s tab of the same favorite id is not this one\'s', () => {
  let state = open(base());
  state = run(state, { type: 'browser.profile.create', name: 'Work' });
  const work = state.browserProfiles.find(profile => profile.name === 'Work')!.id;
  assert.equal(favoriteTabOf(state.tabs, 'app-yt', work), undefined);
  state = run(state, { type: 'tab.new', url: YT, browserProfileId: work, favoriteId: 'app-yt' });
  assert.equal(owners(state).length, 2, 'one per profile');
  assert.equal(new Set(owners(state).map(tab => tab.browserProfileId)).size, 2);
});

test('the favorite\'s tab stays in its own workspace: its tile opens that workspace, never a copy', () => {
  let state = open(base());
  const own = owners(state)[0].id, main = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const work = state.activeWorkspaceId;
  assert.notEqual(work, main);
  assert.ok(!scopeToWorkspace(state).tabs.some(tab => tab.id === own), 'it is in Main, not shown in Work');
  state = run(state, { type: 'tab.select', id: own });
  assert.equal(state.activeTabId, own);
  assert.equal(state.activeWorkspaceId, main, 'Main opens: the tab did not move');
  assert.equal(workspaceIdOf(state, state.tabs.find(tab => tab.id === own)!), main);
  assert.equal(owners(state).length, 1);
  // tab.new for the favorite does the same (a click that raced the snapshot).
  state = run(state, { type: 'workspace.select', id: work });
  state = open(state);
  assert.equal(state.activeTabId, own);
  assert.equal(state.activeWorkspaceId, main);
  assert.equal(owners(state).length, 1);
  assert.equal(state.tabs.length, 4, 'a, b, the favorite\'s tab and Work\'s new tab: no second copy');
});

test('a secured workspace\'s tabs are never turned into plain ones: selecting a favorite\'s tab opens its own workspace', () => {
  let state = open(base());
  const own = owners(state)[0].id, main = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.create', name: 'Health' });
  const health = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.secured-set', id: health, secured: true });
  state = run(state, { type: 'tab.select', id: own });
  assert.equal(state.activeTabId, own);
  assert.equal(state.activeWorkspaceId, main, 'it stayed in Main and Main opened');
  assert.equal(state.tabs.find(tab => tab.id === own)!.privacy, undefined, 'never turned into a secured tab');
});

test('a tab dropped on Favorites (or Ctrl+Shift+D, or the tab menu) is linked to the favorite and stays where it is; null unlinks it', () => {
  let state = run(base(), { type: 'tab.group.create', tabId: 'b', name: 'G' });
  assert.ok(state.tabs.find(tab => tab.id === 'b')!.group);
  state = run(state, { type: 'tab.favorite', id: 'b', favoriteId: 'app-b' });
  assert.equal(state.tabs.find(tab => tab.id === 'b')!.favoriteId, 'app-b');
  assert.ok(state.tabs.find(tab => tab.id === 'b')!.group, 'it stays in its tab group');
  assert.deepEqual(state.tabs.map(tab => tab.id), ['a', 'b'], 'and keeps its place in the order');
  // Linking another tab moves the link to it.
  state = run(state, { type: 'tab.favorite', id: 'a', favoriteId: 'app-b' });
  assert.deepEqual(owners(state, 'app-b').map(tab => tab.id), ['a']);
  state = run(state, { type: 'tab.favorite', id: 'a', favoriteId: null });
  assert.equal(owners(state, 'app-b').length, 0);
  assert.equal(run(state, { type: 'tab.favorite', id: 'a', favoriteId: null }), state, 'nothing to hand back');
  assert.equal(run(state, { type: 'tab.favorite', id: 'a', favoriteId: 'bad id' }), state, 'an invalid id is refused');
});

test('restart: the favorite\'s tab comes back as its tab (saved with the window), and two saved owners become one', () => {
  let state = open(base());
  const own = owners(state)[0].id;
  const restored = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state))));
  assert.deepEqual(owners(restored).map(tab => tab.id), [own]);
  // A hand-edited or older save with two owners, and one with a junk id.
  const saved = JSON.parse(JSON.stringify(persistedSnapshot(state)));
  saved.tabs.push({ ...saved.tabs.find((tab: { id: string }) => tab.id === own), id: 'copy' });
  saved.tabs.find((tab: { id: string }) => tab.id === 'a').favoriteId = '<bad>';
  const fixed = restoreSnapshot(saved);
  assert.equal(owners(fixed).length, 1);
  assert.equal(fixed.tabs.find(tab => tab.id === 'a')!.favoriteId, undefined);
  // Opening it after the restart goes to that tab.
  const again = open(restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state)))));
  assert.equal(again.activeTabId, own);
  assert.equal(owners(again).length, 1);
});

test('the bridge takes the favorite fields from the interface and refuses anything else',()=>{
  const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs') as { validateAction: (action: unknown, snapshot: unknown) => unknown };
  const snapshot = { tabs: [{ id: 'tab-1', browserProfileId: 'p' }], browserProfiles: [{ id: 'p' }], workspaces: [] };
  for (const ok of [{ type: 'tab.new', url: YT, favoriteId: 'app-mh2x1abc' }, { type: 'tab.select', id: 'tab-1' }, { type: 'tab.favorite', id: 'tab-1', favoriteId: 'app-1' }, { type: 'tab.favorite', id: 'tab-1', favoriteId: null }])
    assert.deepEqual(validateAction(ok, snapshot), ok);
  for (const bad of [{ type: 'tab.favorite', id: 'tab-1', favoriteId: 'a b' }, { type: 'tab.favorite', id: 'tab-1' }, { type: 'tab.favorite', id: 'tab-2', favoriteId: 'x' }, { type: 'tab.new', favoriteId: 7 }, { type: 'tab.select', id: 'tab-1', here: true }])
    assert.throws(() => validateAction(bad, snapshot), JSON.stringify(bad));
  assert.match(readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), /'tab\.rename','tab\.favorite'\]\)actionNames\.add\(name\)/, 'the interface may send tab.favorite');
});

test('workspace tab counts include the favorite\'s tab, as the list does (the workspace menu)', () => {
  let state = open(base());
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const main = state.workspaces[0].id, work = state.activeWorkspaceId;
  assert.deepEqual(workspaceCounts(state)[main], { tabs: 3, pages: 3 }, 'a, b and the favorite\'s tab');
  assert.deepEqual(workspaceCounts(state)[work], { tabs: 1, pages: 0 }, 'only Work\'s new tab');
});

test('Ctrl+1…9 and Ctrl+PageDown/PageUp walk the list on screen: the favorite\'s tab is in it, in the sidebar and in the strip', () => {
  let state = open(base());
  const own = owners(state)[0].id;
  state = run(state, { type: 'settings.update', patch: { verticalTabs: true } });
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', own], 'Ctrl+9 (the last tab) is the favorite\'s, the last row of the list');
  state = run(state, { type: 'settings.update', patch: { verticalTabs: false } });
  assert.deepEqual(listedTabs(state).map(tab => tab.id), ['a', 'b', own], 'the strip lists it too');
  // Only the open workspace's tabs, as before.
  state = run(state, { type: 'settings.update', patch: { verticalTabs: true } }, { type: 'workspace.create', name: 'Work' });
  assert.equal(listedTabs(state).length, 1);
  // Main's keys use it.
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /case 'cycle-tab':\{[^}]*const here=listedTabs\(state\),i=here\.findIndex\(t=>t\.id===active\.id\);if\(!here\.length\|\|i<0\)break;/);
  assert.match(main, /id:here\[\(i\+command\.direction\+here\.length\)%here\.length\]\.id/);
  assert.match(main, /case 'select-tab':\{const here=listedTabs\(state\),target=command\.index<0\?here\.at\(-1\):here\[command\.index\]/);
  assert.match(main, /case 'move-tab':\{const here=listedTabs\(state\),index=here\.findIndex\(t=>t\.id===active\.id\),neighbor=index<0\?undefined:/);
  assert.match(readFileSync(new URL('../src/runtime/core.ts', import.meta.url), 'utf8'), /export \{ listedTabs \} from '\.\/favoriteTabs';/, 'main reads it from the runtime bundle');
});
