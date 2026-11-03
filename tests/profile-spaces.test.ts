import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot, settingsFor, snapshotForProfile } from '../src/runtime/core';
import { profileDownloads } from '../src/ui/downloadActivity';
import { groupColorOf, groupsToWorkspaces, spacesChangedToast, workspacesToGroups } from '../src/runtime/profileSpaces';
import { LOCKED_URL, normalizeWorkspaces, scopeToWorkspace, switchSpoken, windowWorkspaces, workspaceIdOf, workspacesFor } from '../src/runtime/workspaces';
import type { BrowserAction, BrowserSnapshot, TabSession } from '../src/runtime/types';

// Groundwork for "Profiles as spaces" (plan-profile-spaces v3): code written for a window that may hold several profiles, which
// gives today's answers while every window holds one.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const shown = (state: BrowserSnapshot) => scopeToWorkspace(state).tabs.map(tab => tab.id);

/** Alex's tabs a, b, c (a on screen) and a second profile, Client, with no tabs in this window. */
function twoProfiles(): { state: BrowserSnapshot; alex: string; client: string } {
  const initial = createInitialState(), alex = initial.activeBrowserProfileId;
  let state = run({ ...initial, tabs: ['a', 'b', 'c'].map(id => makeTab(id, '', `https://${id}.test/`, alex)), activeTabId: 'a' }, { type: 'browser.profile.create', name: 'Client' });
  const client = state.browserProfiles.find(profile => profile.name === 'Client')!.id;
  state = run(state, { type: 'ui.update', patch: {} });
  return { state, alex, client };
}
/** The same window holding two of Client's tabs as well, the way a window of profiles as spaces does. */
function mixed() {
  const { state, alex, client } = twoProfiles();
  const tabs = [...state.tabs, makeTab('x', '', 'https://x.test/', client), { ...makeTab('y', '', 'https://y.test/', client), audible: true }];
  return { state: run({ ...state, tabs, tabGroups: [...state.tabGroups, { id: 'group-client', name: 'Client work', color: 'blue', collapsed: false, browserProfileId: client }] }, { type: 'ui.update', patch: {} }), alex, client };
}

test('a window of one profile with one workspace is still shown as it is (the same object)', () => {
  const { state } = twoProfiles();
  assert.equal(scopeToWorkspace(state), state);
});

test('a window holding another profile\'s tabs shows only the open profile\'s workspace', () => {
  const { state, client } = mixed();
  assert.deepEqual(shown(state), ['a', 'b', 'c'], 'Client\'s tabs are not in Alex\'s workspace');
  const scoped = scopeToWorkspace(state);
  assert.ok(!scoped.tabGroups.some(group => group.browserProfileId === client), 'nor are its tab groups');
  assert.ok(!(scoped.otherWorkspaceTabs ?? []).some(tab => tab.browserProfileId === client), 'tab search never lists another profile\'s tabs');
  assert.deepEqual(scoped.audibleWorkspaces, [workspacesFor(state, client)[0].id], 'Client playing is marked on Client\'s space');
});

test('a new tab opened beside another tab takes that tab\'s profile; with no opener, the profile on screen', () => {
  const { state, alex, client } = mixed();
  const beside = run(state, { type: 'tab.new', url: 'https://opened.test/', afterId: 'x', background: true });
  assert.equal(beside.tabs[beside.tabs.findIndex(tab => tab.id === 'x') + 1].browserProfileId, client, 'opened beside Client\'s tab: Client\'s');
  const plain = run(state, { type: 'tab.new', url: 'https://typed.test/' });
  assert.equal(plain.tabs.at(-1)!.browserProfileId, alex, 'no opener: the profile on screen');
  const asked = run(state, { type: 'tab.new', url: 'https://asked.test/', afterId: 'x', browserProfileId: alex, background: true });
  assert.equal(asked.tabs[asked.tabs.findIndex(tab => tab.id === 'x') + 1].browserProfileId, alex, 'a named profile wins');
});

test('the tab on screen decides: picking Client\'s tab shows Client\'s tabs only', () => {
  const { state, client } = mixed();
  const there = run(state, { type: 'tab.select', id: 'x' });
  assert.equal(there.activeBrowserProfileId, client);
  assert.deepEqual(shown(there), ['x', 'y']);
});

// ---- Workspaces <-> tab groups (runtime/profileSpaces.ts) ------------------------------------------------------------------

/** One profile with Main (a, b, c in group Q4), Work (blue: pinned g, w1, w2, h1 in its own group Hiring; w1 on screen), Home (green: m)
 *  and a locked secured workspace, Bank. */
function workspaces(): BrowserSnapshot {
  const initial = createInitialState(), p = initial.activeBrowserProfileId;
  const tab = (id: string, workspaceId?: string, extra: Partial<TabSession> = {}): TabSession => ({ ...makeTab(id, '', `https://${id}.test/`, p), ...(workspaceId ? { workspaceId } : {}), ...extra });
  return run({
    ...initial,
    workspaces: [{ id: 'ws-main', name: '', browserProfileId: p }, { id: 'ws-work', name: 'Work', browserProfileId: p, color: '#0088ff' }, { id: 'ws-home', name: 'Home', browserProfileId: p, color: '#34c759' }, { id: 'ws-bank', name: 'Bank', browserProfileId: p, secured: true }],
    tabs: [tab('a'), tab('b'), tab('c', undefined, { group: 'Q4' }), tab('g', 'ws-work', { pinned: true }), tab('w1', 'ws-work'), tab('w2', 'ws-work'), tab('h1', 'ws-work', { group: 'Hiring' }), tab('m', 'ws-home')],
    tabGroups: [{ id: 'g-q4', name: 'Q4', color: 'red', collapsed: false, browserProfileId: p }, { id: 'g-hiring', name: 'Hiring', color: 'purple', collapsed: false, browserProfileId: p, workspaceId: 'ws-work' }],
    activeTabId: 'w1'
  }, { type: 'ui.update', patch: {} });
}
/** Where every tab is: its workspace, pin and group, in list order. */
const layout = (state: BrowserSnapshot) => state.tabs.map(tab => `${tab.id}:${workspaceIdOf(state, tab)}:${tab.pinned ? 'pin' : ''}:${tab.group}`);
/** The same, per workspace: what each workspace shows, in its order (tabs of different workspaces share one list, and how they
 *  interleave there is never seen). */
const byWorkspace = (state: BrowserSnapshot) => {
  const out: Record<string, string[]> = {};
  for (const tab of state.tabs) (out[workspaceIdOf(state, tab)] ??= []).push(`${tab.id}:${tab.pinned ? 'pin' : ''}:${tab.group}`);
  return out;
};
/** The conversions as a window runs them, with the "Switch between" choice set to match (every action then keeps it settled). */
const toGroups = (state: BrowserSnapshot) => { const next = structuredClone(state); next.settings.spaces = 'profiles'; const result = workspacesToGroups(next); return { state: run(next, { type: 'ui.update', patch: {} }), result }; };
const toWorkspaces = (state: BrowserSnapshot) => { const next = structuredClone(state); next.settings.spaces = 'workspaces'; groupsToWorkspaces(next); return run(next, { type: 'ui.update', patch: {} }); };
const group = (state: BrowserSnapshot, name: string) => state.tabGroups.find(item => item.name === name);

test('profiles as spaces: a profile\'s other workspaces become tab groups in its space, in their colours', () => {
  const before = workspaces(), { state, result } = toGroups(before);
  assert.equal(result.changed, true);
  assert.deepEqual(result.unlockedSecured, []);
  assert.ok(state.tabs.every(tab => workspaceIdOf(state, tab) === 'ws-main'), 'every tab is in the space now');
  assert.deepEqual(state.workspaces.filter(item => item.parked).map(item => item.id), ['ws-work', 'ws-home', 'ws-bank'], 'the workspaces are put away, not deleted');
  assert.deepEqual(shown(state), state.tabs.map(tab => tab.id), 'and the space shows all of them');
  assert.equal(group(state, 'Work')?.color, 'blue');
  assert.equal(group(state, 'Work')?.collapsed, false, 'the group holding the tab on screen is open');
  assert.equal(group(state, 'Home')?.color, 'green');
  assert.equal(group(state, 'Home')?.collapsed, true, 'the others arrive folded');
  assert.ok(group(state, 'Work · Hiring'), 'a workspace\'s own group is named after it');
  assert.equal(state.tabs.find(tab => tab.id === 'g')?.pinned, true, 'a pinned tab stays pinned');
  assert.equal(state.activeTabId, 'w1');
  assert.equal(state.activeWorkspaceId, 'ws-main');
  assert.deepEqual(state.tabs.filter(tab => !tab.pinned).map(tab => tab.id), ['a', 'b', 'c', 'w1', 'w2', 'h1', 'm'], 'the space\'s own tabs first, then each workspace\'s, in order');
});

test('profiles as spaces: switching back gives every workspace back exactly as it was', () => {
  const before = workspaces(), back = toWorkspaces(toGroups(before).state);
  assert.deepEqual(layout(back), layout(before));
  assert.deepEqual(back.workspaces.map(item => [item.id, item.name, !!item.parked]), before.workspaces.map(item => [item.id, item.name, false]));
  assert.deepEqual(back.tabGroups.map(item => [item.name, item.workspaceId ?? '', item.color]).sort(), before.tabGroups.map(item => [item.name, item.workspaceId ?? '', item.color]).sort());
  assert.ok(!back.tabGroups.some(item => item.fromWorkspaceId) && !back.tabs.some(tab => tab.fromWorkspaceId), 'no mark is left');
  assert.equal(back.activeWorkspaceId, 'ws-work', 'the tab on screen opens its workspace');
});

test('profiles as spaces: what the person did meanwhile is kept when workspaces come back', () => {
  let { state } = toGroups(workspaces());
  const work = group(state, 'Work')!, hiring = group(state, 'Work · Hiring')!;
  state = run(state,
    { type: 'tab.group.assign', tabIds: ['w2'], groupId: null },   // dragged out of Work: stays in Main
    { type: 'tab.group.assign', tabIds: ['a'], groupId: work.id },  // dropped into Work: goes to Work
    { type: 'tab.group.update', id: hiring.id, patch: { name: 'Recruiting' } },
    { type: 'tab.group.update', id: work.id, patch: { name: 'Job' } });
  const back = toWorkspaces(state);
  const where = (id: string) => workspaceIdOf(back, back.tabs.find(tab => tab.id === id)!);
  assert.equal(where('w2'), 'ws-main');
  assert.equal(where('a'), 'ws-work');
  assert.equal(back.workspaces.find(item => item.id === 'ws-work')?.name, 'Job', 'the group\'s new name becomes the workspace\'s');
  assert.equal(group(back, 'Recruiting')?.workspaceId, 'ws-work', 'a renamed own group keeps its new name');
  assert.ok(!group(back, 'Job'), 'the group of loose tabs dissolves');
});

test('profiles as spaces: a group name already used in the space gets a number, and still comes back', () => {
  const before = run(workspaces(), { type: 'tab.group.create', tabId: 'b', name: 'Work' }), { state } = toGroups(before);
  assert.ok(group(state, 'Work 2')?.fromWorkspaceId === 'ws-work');
  assert.deepEqual(layout(toWorkspaces(state)), layout(before));
});

test('profiles as spaces: an unlocked secured workspace is left for the caller to lock; a locked one loses only its lock screen', () => {
  const unlocked = workspaces();
  unlocked.workspaces.find(item => item.id === 'ws-bank')!.unlocked = true;
  unlocked.tabs.push({ ...makeTab('vault', '', 'https://bank.test/', unlocked.activeBrowserProfileId), workspaceId: 'ws-bank', privacy: 'secured' });
  const left = workspacesToGroups(structuredClone(unlocked));
  assert.deepEqual(left.unlockedSecured, ['ws-bank']);
  const locked = workspaces();
  locked.tabs.push({ ...makeTab('lock', '', LOCKED_URL, locked.activeBrowserProfileId), workspaceId: 'ws-bank' });
  const { state } = toGroups(locked);
  assert.ok(!state.tabs.some(tab => tab.id === 'lock'));
  assert.equal(state.workspaces.find(item => item.id === 'ws-bank')?.parked, true);
});

test('profiles as spaces: the marks survive every action and a restart', () => {
  const { state } = toGroups(workspaces());
  const saved = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(run(state, { type: 'tab.select', id: 'b' })))));
  assert.deepEqual(saved.workspaces.filter(item => item.parked).map(item => item.id), ['ws-work', 'ws-home', 'ws-bank']);
  assert.equal(group(saved, 'Work')?.fromWorkspaceId, 'ws-work');
  assert.equal(group(saved, 'Work · Hiring')?.fromGroup, 'Hiring');
  assert.equal(saved.tabs.find(tab => tab.id === 'g')?.fromWorkspaceId, 'ws-work');
  assert.deepEqual(layout(toWorkspaces(saved)).sort(), layout(workspaces()).sort());
});

test('workspaces as today: nothing is put away, so switching back changes nothing', () => {
  const state = workspaces(), copy = structuredClone(state);
  assert.equal(groupsToWorkspaces(copy), false);
  assert.deepEqual(copy, state);
  assert.equal(groupColorOf(undefined), 'none');
  assert.equal(groupColorOf('#CB30E0'), 'purple');
});

test('profiles as spaces, property: any layout of workspaces, pins and groups comes back exactly, with every tab once', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  for (let round = 0; round < 200; round++) {
    const initial = createInitialState(), p = initial.activeBrowserProfileId, count = 2 + Math.floor(random() * 4);
    const spaces = Array.from({ length: count }, (_, index) => ({ id: `ws-${index}`, name: index ? `Space ${index}` : '', browserProfileId: p, ...(random() < 0.6 ? { color: pick(['#0088ff', '#34c759', '#ff383c', '#cb30e0']) } : {}) }));
    const groups = spaces.flatMap(space => random() < 0.6 ? [{ id: `g-${space.id}`, name: pick(['Q4', 'Hiring', 'Space 1', 'Reading']), color: 'grey' as const, collapsed: random() < 0.3, browserProfileId: p, ...(space.id === 'ws-0' ? {} : { workspaceId: space.id }) }] : []);
    const tabs = Array.from({ length: 3 + Math.floor(random() * 10) }, (_, index) => {
      const space = pick(spaces), own = groups.find(item => (item.workspaceId ?? 'ws-0') === space.id), roll = random();
      return { ...makeTab(`t${index}`, '', `https://t${index}.test/`, p), ...(space.id === 'ws-0' ? {} : { workspaceId: space.id }), ...(roll < 0.2 ? { pinned: true } : roll < 0.6 && own ? { group: own.name } : {}) };
    });
    const before = run({ ...initial, workspaces: spaces, tabs, tabGroups: groups, activeTabId: pick(tabs).id }, { type: 'ui.update', patch: {} });
    const { state } = toGroups(before);
    assert.ok(state.tabs.every(tab => workspaceIdOf(state, tab) === 'ws-0'), `round ${round}: all in the space`);
    assert.deepEqual(state.tabs.map(tab => tab.id).sort(), before.tabs.map(tab => tab.id).sort(), `round ${round}: every tab once`);
    const back = toWorkspaces(state);
    assert.deepEqual(byWorkspace(back), byWorkspace(before), `round ${round}: back exactly`);
    assert.equal(back.activeTabId, before.activeTabId);
  }
});

// ---- The "Switch between" choice, as the reducer keeps it (settleSpaces with every action) --------------------------------

test('choosing profiles as spaces turns the workspaces into groups at once, and choosing workspaces again brings them back', () => {
  const before = workspaces();
  const spaces = run(before, { type: 'settings.update', patch: { spaces: 'profiles' } });
  assert.deepEqual(spaces.workspaces.filter(item => item.parked).map(item => item.id), ['ws-work', 'ws-home', 'ws-bank']);
  assert.ok(group(spaces, 'Work') && group(spaces, 'Home'));
  assert.equal(spaces.activeTabId, 'w1', 'the tab on screen stays on screen');
  const back = run(spaces, { type: 'settings.update', patch: { spaces: 'workspaces' } });
  assert.deepEqual(byWorkspace(back), byWorkspace(before));
  assert.equal(back.activeWorkspaceId, 'ws-work');
});

test('profiles as spaces: the switcher lists one space per profile, and picking one switches the profile in this window', () => {
  const { state, alex, client } = mixed();
  const spaces = run(state, { type: 'settings.update', patch: { spaces: 'profiles' } });
  assert.deepEqual(windowWorkspaces(spaces).map(item => item.browserProfileId), [alex, client]);
  const there = run(spaces, { type: 'workspace.select', id: workspacesFor(spaces, client)[0].id });
  assert.equal(there.activeBrowserProfileId, client);
  assert.ok(['x', 'y'].includes(there.activeTabId));
  assert.deepEqual(shown(there), ['x', 'y']);
  const home = run(there, { type: 'workspace.select', id: workspacesFor(spaces, alex)[0].id });
  assert.equal(home.activeTabId, 'a', 'back to the tab Alex\'s space showed last');
  assert.deepEqual(shown(home), ['a', 'b', 'c']);
});

test('profiles as spaces: a profile with no tab in this window opens on a new tab of its own', () => {
  const { state, client } = twoProfiles();
  const spaces = run(state, { type: 'settings.update', patch: { spaces: 'profiles' } });
  const there = run(spaces, { type: 'workspace.select', id: workspacesFor(spaces, client)[0].id });
  const tab = there.tabs.find(item => item.id === there.activeTabId)!;
  assert.equal(tab.browserProfileId, client);
  assert.equal(tab.url, 'acira://new');
  assert.equal(there.activeBrowserProfileId, client);
});

test('profiles as spaces: workspaces can\'t be made or edited, and a private window lists no spaces', () => {
  const { state } = mixed();
  const spaces = run(state, { type: 'settings.update', patch: { spaces: 'profiles' } });
  assert.equal(run(spaces, { type: 'workspace.create', name: 'Work' }), spaces, 'ignored');
  const privateWindow = { ...spaces, browserProfiles: [...spaces.browserProfiles, { id: 'private-1', name: 'Private', color: '#62666d', partition: 'acira-private-1', private: true }], activeBrowserProfileId: 'private-1' };
  assert.deepEqual(windowWorkspaces(privateWindow), []);
});

test('profiles as spaces: a tab restored into a put-away workspace joins its group', () => {
  const spaces = run(workspaces(), { type: 'settings.update', patch: { spaces: 'profiles' } });
  const after = run(spaces, { type: 'tab.new', url: 'https://restored.test/', background: true, workspaceId: 'ws-home' });
  const restored = after.tabs.find(tab => tab.url === 'https://restored.test/')!;
  assert.equal(restored.group, 'Home');
  assert.equal(workspaceIdOf(after, restored), 'ws-main', 'in the space, not in the hidden workspace');
  assert.equal(after.tabGroups.filter(item => item.fromWorkspaceId === 'ws-home').length, 1, 'no second Home group');
  const back = run(after, { type: 'settings.update', patch: { spaces: 'workspaces' } });
  assert.equal(workspaceIdOf(back, back.tabs.find(tab => tab.url === 'https://restored.test/')!), 'ws-home');
});

test('profiles as spaces: workspaces an import adds (Arc Spaces) become groups as soon as the window settles', () => {
  const spaces = run(workspaces(), { type: 'settings.update', patch: { spaces: 'profiles' } });
  const p = spaces.activeBrowserProfileId, next = structuredClone(spaces);
  next.workspaces.push({ id: 'ws-arc', name: 'Research', browserProfileId: p, color: '#ff8d28' });
  next.tabs.push({ ...makeTab('arc1', '', 'https://arc1.test/', p), workspaceId: 'ws-arc' }, { ...makeTab('arc2', '', 'https://arc2.test/', p), workspaceId: 'ws-arc', pinned: true });
  normalizeWorkspaces(next);
  assert.equal(next.workspaces.find(item => item.id === 'ws-arc')?.parked, true);
  assert.equal(next.tabs.find(tab => tab.id === 'arc1')?.group, 'Research');
  assert.equal(group(next, 'Research')?.color, 'orange');
  assert.ok(next.tabs.filter(tab => tab.id.startsWith('arc')).every(tab => workspaceIdOf(next, tab) === 'ws-main'));
});

// ---- Leak audit, group a: what the person is looking at names the profile on screen ------------------------------------------

test('profiles as spaces: bookmarks, settings and downloads follow the profile on screen as the space changes', () => {
  const { state, alex, client } = mixed();
  const records: BrowserSnapshot = {
    ...state,
    browserProfiles: state.browserProfiles.map(profile => profile.id === client ? { ...profile, settings: { appearance: 'dark', searchEngine: 'duckduckgo' } } : profile),
    bookmarkNodes: [{ id: 'bf', browserProfileId: alex, parentId: null, title: 'Mine', url: 'https://mine.test/', position: 0, createdAt: 1 }, { id: 'bc', browserProfileId: client, parentId: null, title: 'Client', url: 'https://client.test/', position: 0, createdAt: 1 }],
    downloads: [{ id: 'df', browserProfileId: alex, name: 'mine.pdf', size: '1 KB', status: 'Ready' }, { id: 'dc', browserProfileId: client, name: 'client.pdf', size: '1 KB', status: 'Ready' }],
    settings: { ...state.settings, appearance: 'light', spaces: 'profiles' }
  };
  const there = run(records, { type: 'tab.select', id: 'x' });
  assert.equal(there.activeBrowserProfileId, client);
  assert.equal(there.tabs.find(tab => tab.id === there.activeTabId)?.browserProfileId, client, 'the two sources pages read agree');
  assert.deepEqual(there.bookmarks, ['https://client.test/'], 'the star and the bookmarks bar: Client\'s bookmarks only');
  assert.equal(settingsFor(there).appearance, 'dark', 'Client\'s own appearance');
  assert.equal(snapshotForProfile(there).settings.searchEngine, 'duckduckgo', 'and its own search engine on what the interface gets');
  assert.deepEqual(profileDownloads(there, there.activeBrowserProfileId).map(item => item.id), ['dc'], 'the downloads list: Client\'s only');
  const home = run(there, { type: 'tab.select', id: 'a' });
  assert.deepEqual(home.bookmarks, ['https://mine.test/']);
  assert.equal(settingsFor(home).appearance, 'light', 'Alex follows the setting for all profiles');
  assert.deepEqual(profileDownloads(home, home.activeBrowserProfileId).map(item => item.id), ['df']);
});

test('profiles as spaces: Reopen closed tab in one space reopens that space\'s own closed tab, never another profile\'s', () => {
  const { state, alex, client } = mixed();
  let s = run({ ...state, settings: { ...state.settings, spaces: 'profiles' } }, { type: 'tab.close', id: 'b' });
  s = run(s, { type: 'tab.select', id: 'x' });
  const nothing = run(s, { type: 'tab.restore' });
  assert.ok(!nothing.tabs.some(tab => tab.id === 'b'), 'Alex\'s closed tab stays closed from Client\'s space');
  assert.equal(nothing.activeBrowserProfileId, client, 'and the window stays in Client\'s space');
  s = run(s, { type: 'tab.close', id: 'y' }, { type: 'tab.select', id: 'x' }, { type: 'tab.restore' });
  assert.ok(s.tabs.some(tab => tab.id === 'y'), 'Client\'s own closed tab comes back');
  assert.equal(s.activeBrowserProfileId, client);
  s = run(s, { type: 'tab.select', id: 'a' }, { type: 'tab.restore' });
  assert.ok(s.tabs.some(tab => tab.id === 'b') && s.activeBrowserProfileId === alex, 'and Alex\'s, from Alex\'s space');
});

test('profiles as spaces: a closed tab\'s Undo never reopens another space\'s tabs, nor jumps to it (QA #8)', () => {
  const { state, alex, client } = mixed();
  let s = run({ ...state, settings: { ...state.settings, spaces: 'profiles' } }, { type: 'tab.close', id: 'a' });
  const undo = s.toast?.action?.command;
  assert.equal(undo?.type, 'tab.restore.batch', 'Alex\'s "Tab closed · Undo"');
  s = run(s, { type: 'tab.select', id: 'x' });
  const there = run(s, undo!);
  assert.equal(there, s, 'from Client\'s space the Undo does nothing');
  assert.ok(!there.tabs.some(tab => tab.id === 'a') && there.activeBrowserProfileId === client);
  const home = run(s, { type: 'tab.select', id: 'b' }, undo!);
  assert.ok(home.tabs.some(tab => tab.id === 'a') && home.activeBrowserProfileId === alex, 'in Alex\'s own space it reopens the tab');
});

test('profiles as spaces: a tab dropped on another profile\'s space stays, and the toast offers to open it there (QA #10)', () => {
  const { state, alex, client } = mixed();
  const s = run({ ...state, settings: { ...state.settings, spaces: 'profiles' } }, { type: 'ui.update', patch: {} });
  const spaces = windowWorkspaces(s), clientSpace = spaces.find(item => item.browserProfileId === client)!, own = spaces.find(item => item.browserProfileId === alex)!;
  const dropped = run(s, { type: 'workspace.move-tabs', tabIds: ['a'], workspaceId: clientSpace.id });
  assert.ok(dropped.tabs.find(tab => tab.id === 'a')?.browserProfileId === alex && workspaceIdOf(dropped, dropped.tabs.find(tab => tab.id === 'a')!) === own.id, 'the tab stays in Alex\'s space');
  assert.equal(dropped.toast?.i18n?.id, 'workspaces.tabsStayInProfile');
  assert.equal(dropped.toast?.text, 'Tabs stay in their own profile.');
  assert.equal(dropped.toast?.tone, 'info');
  assert.deepEqual(dropped.toast?.action, { label: 'Open in Client', labelId: 'workspaces.openInProfile', labelParams: { name: 'Client' }, command: { type: 'tab.new', url: 'https://a.test/', browserProfileId: client } });
  const opened = run(dropped, dropped.toast!.action!.command);
  assert.ok(opened.tabs.some(tab => tab.browserProfileId === client && tab.url === 'https://a.test/') && opened.activeBrowserProfileId === client, 'Open in Client: the address, in Client\'s space');
  // A private page is never opened in another profile: the toast still says why, with no action.
  const hidden = run({ ...s, tabs: s.tabs.map(tab => tab.id === 'a' ? { ...tab, privacy: 'private' as const } : tab) }, { type: 'workspace.move-tabs', tabIds: ['a'], workspaceId: clientSpace.id });
  assert.equal(hidden.toast?.i18n?.id, 'workspaces.tabsStayInProfile');
  assert.equal(hidden.toast?.action, undefined);
  assert.equal(run(s, { type: 'workspace.move-tabs', tabIds: ['a'], workspaceId: own.id }), s, 'dropped on its own space: nothing');
});

test('profiles as spaces: the toast after the switch names whose workspaces became tab groups; turned off, windows are back', () => {
  const { state, alex, client } = mixed();
  const named = (s: BrowserSnapshot, id: string) => s.browserProfiles.find(profile => profile.id === id)!.name;
  assert.deepEqual(spacesChangedToast(state, 'profiles'), { id: 'profiles.spacesOnPlain' }, 'no profile had other workspaces');
  const work = { ...state.workspaces.find(item => item.browserProfileId === alex)!, id: 'ws-work', name: 'Work' };
  const clientWork = { ...work, id: 'ws-client-work', browserProfileId: client };
  const clientFirst = { ...work, id: 'ws-client', name: '', browserProfileId: client };
  assert.deepEqual(spacesChangedToast({ ...state, workspaces: [...state.workspaces, work] }, 'profiles'), { id: 'profiles.spacesOn', params: { name: named(state, alex) } });
  const both = { ...state, workspaces: [...state.workspaces, clientFirst, clientWork, work] };
  assert.deepEqual(spacesChangedToast(both, 'profiles').params, { name: named(state, alex) }, 'the profile on screen first');
  assert.deepEqual(spacesChangedToast({ ...state, workspaces: [...state.workspaces, clientFirst, clientWork] }, 'profiles').params, { name: 'Client' });
  assert.deepEqual(spacesChangedToast({ ...state, workspaces: [...state.workspaces, { ...work, secured: true }] }, 'profiles'), { id: 'profiles.spacesOnPlain' }, 'a secured workspace is put away, not made a group');
  assert.deepEqual(spacesChangedToast(state, 'workspaces'), { id: 'profiles.spacesOff' });
});

test('profiles as spaces: a space switch is said out loud like a workspace switch; with workspaces a change of profile stays quiet (QA final pass)', () => {
  // The switch note ("Client, 4 tabs", and its screen-reader line) skipped every change of profile, and with profiles as spaces every
  // space switch is one: Focus view showed nothing and screen readers heard nothing.
  const { state, alex, client } = mixed();
  const spaces = run({ ...state, settings: { ...state.settings, spaces: 'profiles' } }, { type: 'ui.update', patch: {} });
  const own = windowWorkspaces(spaces).find(item => item.browserProfileId === alex)!, theirs = windowWorkspaces(spaces).find(item => item.browserProfileId === client)!;
  const home = { id: own.id, profile: alex }, there = { id: theirs.id, profile: client };
  assert.equal(switchSpoken(spaces, home, there), true, 'Alex → Client');
  assert.equal(switchSpoken(spaces, there, home), true, 'and back');
  assert.equal(switchSpoken(spaces, home, home), false, 'no switch');
  assert.equal(switchSpoken(spaces, null, home), false, 'the first look');
  // Workspaces: Alex's two workspaces are said; another profile taking the window over is not, as before.
  const work = { ...own, id: 'ws-work', name: 'Work' }, workspaces = { ...state, workspaces: [...state.workspaces, work] };
  assert.equal(switchSpoken(workspaces, home, { id: work.id, profile: alex }), true, 'Main → Work');
  assert.equal(switchSpoken(workspaces, home, there), false, 'a change of profile');
  assert.equal(switchSpoken(state, home, { id: 'ws-elsewhere', profile: alex }), false, 'one workspace: nothing to say');
});

// ---- QA batch 2: a secured workspace and profiles as spaces ------------------------------------------------------------------

/** Mixed window (Alex's a, b, c; Client's x, y) where Alex also has a secured workspace "Bank", unlocked, holding a secured tab. */
function withBank() {
  const { state, alex, client } = mixed();
  const bank = { id: 'ws-bank', name: 'Bank', browserProfileId: alex, secured: true as const, unlocked: true as const };
  const vault = { ...makeTab('vault', '', 'https://bank.test/', alex), workspaceId: 'ws-bank', privacy: 'secured' as const };
  return { state: run({ ...state, workspaces: [...state.workspaces, bank], tabs: [...state.tabs, vault] }, { type: 'ui.update', patch: {} }), alex, client };
}

test('profiles as spaces: the lock main sends for a secured workspace is never dropped; locked, it is put away', () => {
  const { state } = withBank();
  const spaces = run({ ...state, settings: { ...state.settings, spaces: 'profiles' } }, { type: 'ui.update', patch: {} });
  const locked = run(spaces, { type: 'workspace.secured-lock', id: 'ws-bank' });
  assert.ok(!locked.tabs.some(tab => tab.id === 'vault'), 'the sealed page is gone from the window');
  const bank = locked.workspaces.find(item => item.id === 'ws-bank');
  assert.ok(bank && !bank.unlocked && bank.parked, 'locked, then put away');
});

test('profiles as spaces: a window left on a workspace that is not a space shows the profile on screen\'s space, never every tab', () => {
  const { state, alex } = withBank();
  const spaces = { ...state, settings: { ...state.settings, spaces: 'profiles' as const }, activeWorkspaceId: 'ws-bank' };
  const shownTabs = scopeToWorkspace(spaces).tabs;
  assert.ok(shownTabs.length > 0);
  assert.ok(shownTabs.every(tab => tab.browserProfileId === alex), 'no other profile\'s tab, title or address');
  assert.ok(!shownTabs.some(tab => tab.id === 'vault'), 'nor the secured page');
});
