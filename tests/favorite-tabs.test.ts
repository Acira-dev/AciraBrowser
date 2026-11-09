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

// 13.4 (reported on 13.3: open Gmail from Favorites in Space 1, click the same favorite in Space 2 and Acira jumped back to Space 1): a
// favorite acts like a global tab. Its tile never changes the Space you are in; the favorite's one tab comes to that Space, the same tab
// (same id, so the same page, history and scroll; nothing reloads, no copy). It is what 2 Nov did (tab.select `here`, bringTabHere) and what
// 6 Nov's "the tab stays in the list" rework dropped by accident. A plain select (tab search, Ctrl+Tab) still opens a tab's own Space.
function inTwoSpaces() {
  let state = open(base());
  const own = owners(state)[0].id, main = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const work = state.activeWorkspaceId;
  assert.notEqual(work, main);
  assert.ok(!scopeToWorkspace(state).tabs.some(tab => tab.id === own), 'it is in Main, not shown in Work');
  return { state, own, main, work };
}
const spaceOf = (state: BrowserSnapshot, id: string) => workspaceIdOf(state, state.tabs.find(tab => tab.id === id)!);

test('the tile from another Space brings the favorite\'s one tab into the Space you are in: the Space never changes, nothing reloads, no copy', () => {
  let { state, own, main, work } = inTwoSpaces();
  const before = structuredClone(state.tabs.find(tab => tab.id === own)!), count = state.tabs.length, toast = state.toast;
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeTabId, own);
  assert.equal(state.activeWorkspaceId, work, 'Work stays open');
  assert.equal(spaceOf(state, own), work, 'the tab is Work\'s now');
  assert.ok(scopeToWorkspace(state).tabs.some(tab => tab.id === own), 'Work\'s list shows it');
  assert.ok(!state.tabs.some(tab => tab.id !== own && tab.favoriteId === 'app-yt'));
  assert.equal(owners(state).length, 1);
  assert.equal(state.tabs.length, count, 'no copy, no new tab');
  const after = state.tabs.find(tab => tab.id === own)!;
  for (const key of ['id', 'url', 'title', 'history', 'historyIndex', 'favoriteId', 'contentKind', 'browserProfileId'] as const) assert.deepEqual(after[key], before[key], key + ' is untouched (the same page, so main keeps its webContents)');
  assert.deepEqual(state.toast, toast, 'no toast of its own: the look is the same');
  // And back: from Main the same tile brings it home again.
  state = run(state, { type: 'workspace.select', id: main });
  assert.ok(!scopeToWorkspace(state).tabs.some(tab => tab.id === own), 'Main\'s list no longer holds it');
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeWorkspaceId, main);
  assert.equal(spaceOf(state, own), main);
  assert.equal(owners(state).length, 1);
});

test('the same when a click races the snapshot (tab.new for the favorite), and a plain select (tab search, Ctrl+Tab) still opens the tab\'s own Space', () => {
  let { state, own, main, work } = inTwoSpaces();
  const count = state.tabs.length;
  state = open(state);
  assert.equal(state.activeTabId, own);
  assert.equal(state.activeWorkspaceId, work, 'a racing click does not switch Space either');
  assert.equal(spaceOf(state, own), work);
  assert.equal(owners(state).length, 1);
  assert.equal(state.tabs.length, count, 'no second copy');
  // Tab search lands on any tab in its own Space, as before.
  state = run(state, { type: 'workspace.select', id: main });
  state = run(state, { type: 'workspace.select', id: work });
  state = run(state, { type: 'tab.select', id: 'a' });
  assert.equal(state.activeWorkspaceId, main, 'a plain select opens that tab\'s Space');
  assert.equal(spaceOf(state, own), work, 'and moves nothing');
});

test('a secured Space never takes a favorite\'s tab in (its pages live in their own session): the click opens the tab\'s own Space, as selecting any tab does', () => {
  let state = open(base());
  const own = owners(state)[0].id, main = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.create', name: 'Health' });
  const health = state.activeWorkspaceId;
  state = run(state, { type: 'workspace.secured-set', id: health, secured: true });
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeTabId, own);
  assert.equal(state.activeWorkspaceId, main, 'it stayed in Main and Main opened');
  assert.equal(spaceOf(state, own), main);
  assert.equal(state.tabs.find(tab => tab.id === own)!.privacy, undefined, 'never turned into a secured tab');
});

test('another profile\'s tab never moves into this profile\'s Space (profiles as Spaces): selecting it opens its own profile, as before', () => {
  let { state, own, work } = inTwoSpaces();
  state = run(state, { type: 'browser.profile.create', name: 'Other' });
  const other = state.browserProfiles.find(profile => profile.name === 'Other')!.id;
  state = run(state, { type: 'tab.new', url: YT, browserProfileId: other, favoriteId: 'app-yt' });
  const theirs = owners(state).find(tab => tab.browserProfileId === other)!.id, space = spaceOf(state, theirs);
  assert.notEqual(theirs, own);
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeTabId, own);
  assert.equal(spaceOf(state, theirs), space, 'the other profile\'s tab did not move');
  state = run(state, { type: 'workspace.select', id: work }, { type: 'tab.select', id: theirs, here: true });
  assert.equal(state.activeTabId, theirs);
  assert.equal(state.tabs.find(tab => tab.id === theirs)!.browserProfileId, other);
  assert.equal(spaceOf(state, theirs), space, 'a tab of another profile stays in its own Space');
});

test('a pinned favorite tab stays pinned in the Space it comes to; a grouped one leaves its old group, the group stays', () => {
  let { state, own, main, work } = inTwoSpaces();
  state = run(state, { type: 'workspace.select', id: main });
  state = run(state, { type: 'tab.pin', id: own }, { type: 'tab.group.create', tabId: 'a', name: 'G' }, { type: 'workspace.select', id: work });
  assert.equal(state.tabs.find(tab => tab.id === own)!.pinned, true);
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeWorkspaceId, work);
  assert.equal(spaceOf(state, own), work);
  assert.equal(state.tabs.find(tab => tab.id === own)!.pinned, true, 'still pinned');
  assert.ok(state.tabGroups.some(group => group.name === 'G'), 'Main\'s group is still there');
  assert.equal(state.tabs.find(tab => tab.id === 'a')!.group, 'G');
  assert.equal(owners(state).length, 1);
});

test('a group left without tabs keeps its record when the favorite\'s tab comes to another Space, exactly as after closing its last tab or Move to workspace (the list draws only groups that hold tabs)', () => {
  const build = () => {
    const made = inTwoSpaces();
    return { ...made, state: run(made.state, { type: 'workspace.select', id: made.main }, { type: 'tab.group.create', tabId: made.own, name: 'Videos' }, { type: 'workspace.select', id: made.work }) };
  };
  const groups = (state: BrowserSnapshot) => state.tabGroups.map(group => group.name);
  const brought = build(), closed = build(), moved = build();
  brought.state = run(brought.state, { type: 'tab.select', id: brought.own, here: true });
  closed.state = run(closed.state, { type: 'tab.close', id: closed.own });
  moved.state = run(moved.state, { type: 'workspace.move-tabs', tabIds: [moved.own], workspaceId: moved.work });
  assert.deepEqual(groups(brought.state), ['Videos']);
  assert.deepEqual(groups(brought.state), groups(closed.state), 'the same record as when the last tab is closed');
  assert.deepEqual(groups(brought.state), groups(moved.state), 'and as when the last tab moves with Move to workspace');
  assert.equal(brought.state.tabs.find(tab => tab.id === brought.own)!.group, '', 'the tab is in no group in its new Space');
  const left = (state: BrowserSnapshot, main: string) => state.tabs.filter(tab => tab.group === 'Videos' && workspaceIdOf(state, tab) === main);
  assert.equal(left(brought.state, brought.main).length, 0, 'so nothing is listed under it in the Space it left');
});

test('closing the favorite\'s tab in the Space it came to leaves the favorite there: the next click opens one new tab in the Space you are in', () => {
  let { state, own, work } = inTwoSpaces();
  state = run(state, { type: 'tab.select', id: own, here: true });
  state = run(state, { type: 'tab.close', id: own });
  assert.equal(state.activeWorkspaceId, work, 'closing stays in Work');
  assert.equal(owners(state).length, 0);
  state = open(state);
  assert.equal(owners(state).length, 1);
  assert.equal(state.activeWorkspaceId, work);
  assert.equal(spaceOf(state, owners(state)[0].id), work);
});

test('restart: the favorite\'s tab comes back in the Space it was brought to, still its tab', () => {
  let { state, own, work } = inTwoSpaces();
  state = run(state, { type: 'tab.select', id: own, here: true });
  const back = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(state))));
  assert.equal(owners(back).length, 1);
  assert.equal(owners(back)[0].id, own);
  assert.equal(workspaceIdOf(back, owners(back)[0]), work);
  assert.equal(back.activeWorkspaceId, work);
});

test('the favorite\'s tab was the only tab of its Space: that Space is still there, and opens with a new tab', () => {
  let state = open(run(createInitialState(), { type: 'ui.update', patch: {} }));
  state = run(state, { type: 'tab.close', id: state.tabs.find(tab => !tab.favoriteId)!.id });
  const own = owners(state)[0].id, main = state.activeWorkspaceId;
  assert.deepEqual(state.tabs.map(tab => tab.id), [own], 'Main holds only the favorite\'s tab');
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const work = state.activeWorkspaceId;
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeWorkspaceId, work);
  state = run(state, { type: 'workspace.select', id: main });
  assert.equal(state.activeWorkspaceId, main);
  assert.ok(scopeToWorkspace(state).tabs.length >= 1, 'Main opened on a tab of its own');
  assert.ok(!scopeToWorkspace(state).tabs.some(tab => tab.id === own));
  assert.equal(owners(state).length, 1);
});

test('a favorite\'s tab in a split brings the whole split along, and the Space still does not change', () => {
  let { state, own, main, work } = inTwoSpaces();
  state = run(state, { type: 'workspace.select', id: main });
  state = run(state, { type: 'split.open', tabIds: [own, 'a'] }, { type: 'workspace.select', id: work });
  assert.ok(state.windowUi.splitGroups?.some(group => group.tabIds.includes(own)), 'the split is saved');
  state = run(state, { type: 'tab.select', id: own, here: true });
  assert.equal(state.activeWorkspaceId, work);
  assert.equal(spaceOf(state, own), work);
  assert.equal(spaceOf(state, 'a'), work, 'the pane beside it came too: a split lives in one Space');
  assert.equal(owners(state).length, 1);
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
  for (const ok of [{ type: 'tab.new', url: YT, favoriteId: 'app-mh2x1abc' }, { type: 'tab.select', id: 'tab-1' }, { type: 'tab.select', id: 'tab-1', here: true }, { type: 'tab.favorite', id: 'tab-1', favoriteId: 'app-1' }, { type: 'tab.favorite', id: 'tab-1', favoriteId: null }])
    assert.deepEqual(validateAction(ok, snapshot), ok);
  for (const bad of [{ type: 'tab.select', id: 'tab-1', here: 'yes' }, { type: 'tab.favorite', id: 'tab-1', favoriteId: 'a b' }, { type: 'tab.favorite', id: 'tab-1' }, { type: 'tab.favorite', id: 'tab-2', favoriteId: 'x' }, { type: 'tab.new', favoriteId: 7 }])
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
  assert.match(main, /case 'cycle-tab':\{[^}]*const here=listedTabs\(state\),i=here\.findIndex\(t=>t\.id===active\.id\);if\(!here\.length\|\|i<0&&!active\.favoriteId\)break;/);
  assert.match(main, /id:\(i<0\?\(command\.direction>0\?here\[0\]:here\.at\(-1\)\):here\[\(i\+command\.direction\+here\.length\)%here\.length\]\)\.id/);
  assert.match(main, /case 'select-tab':\{const here=listedTabs\(state\),target=command\.index<0\?here\.at\(-1\):here\[command\.index\]/);
  assert.match(main, /case 'move-tab':\{const here=listedTabs\(state\),index=here\.findIndex\(t=>t\.id===active\.id\),neighbor=index<0\?undefined:/);
  assert.match(readFileSync(new URL('../src/runtime/core.ts', import.meta.url), 'utf8'), /export \{ listedTabs \} from '\.\/favoriteTabs';/, 'main reads it from the runtime bundle');
});
