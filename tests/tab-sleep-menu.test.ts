import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { groupSleepTabs, mayOfferSleep, sleepAction, sleepableTabs, workspaceSleepTabs } from '../src/runtime/tabSleepMenu';
import type { BrowserSnapshot, TabSession } from '../src/runtime/types';

// Beta.12 item 15: "Put to sleep" rows in the tab, group and workspace menus offer only tabs the Memory Saver could sleep.
const read = (file: string) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const tab = (id: string, over: Partial<TabSession> = {}) => ({ id, url: `https://${id}.test/`, title: id, contentKind: 'web', browserProfileId: 'p1', ...over }) as unknown as TabSession;
const scope = (over: Record<string, unknown> = {}) => ({ activeTabId: 'active', windowUi: {}, browserProfiles: [{ id: 'p1' }, { id: 'priv', private: true }], ...over }) as unknown as Pick<BrowserSnapshot, 'activeTabId' | 'windowUi' | 'browserProfiles'>;

test('a tab is offered Put to sleep unless the Memory Saver could never sleep it', () => {
  const state = scope();
  assert.equal(mayOfferSleep(state, tab('a')), true);
  assert.equal(mayOfferSleep(state, tab('active')), false, 'the window\'s active tab is never slept');
  assert.equal(mayOfferSleep(scope({ windowUi: { split: { tabIds: ['a', 'active'] } } }), tab('a')), false, 'a pane of the split on screen is on screen too');
  assert.equal(mayOfferSleep(state, tab('a', { pinned: true })), false, 'pinned tabs stay awake, as in the automatic sleep');
  assert.equal(mayOfferSleep(state, tab('a', { sleeping: true })), false, 'already asleep');
  assert.equal(mayOfferSleep(state, tab('a', { url: 'acira://settings', contentKind: 'internal' })), false, 'Acira\'s own pages have nothing to free');
  assert.equal(mayOfferSleep(state, tab('a', { url: 'file:///tmp/x.html' })), false);
  for (const privacy of ['private', 'tor', 'secured']) assert.equal(mayOfferSleep(state, tab('a', { privacy } as Partial<TabSession>)), false, privacy);
  assert.equal(mayOfferSleep(state, tab('a', { browserProfileId: 'priv' })), false, 'a private window keeps every tab awake');
  assert.equal(mayOfferSleep(state, tab('a', { error: 'net::ERR_FAILED' } as Partial<TabSession>)), false, 'a tab that failed to load has no page to free');
});

test('a group sleeps its members except the ones that cannot, a workspace every tab it holds in this window', () => {
  // As the interface sees it (runtime/workspaces.ts scopeToWorkspace): `tabs` are the open workspace's, the others' come as otherWorkspaceTabs.
  const open = [tab('active', { workspaceId: 'w1', group: 'Read' }), tab('a', { workspaceId: 'w1', group: 'Read' }), tab('b', { workspaceId: 'w1', group: 'Read', pinned: true }),
    tab('c', { workspaceId: 'w1' }), tab('f') /* no workspace: the profile's first */];
  const elsewhere = [tab('d', { workspaceId: 'w2' }), tab('e', { workspaceId: 'w2', sleeping: true }), tab('g', { workspaceId: 'w2', group: 'Later' })];
  const state = {
    ...scope(), workspaces: [{ id: 'w1', browserProfileId: 'p1' }, { id: 'w2', browserProfileId: 'p1' }],
    tabGroups: [{ id: 'g1', name: 'Read', color: 'blue', collapsed: false, browserProfileId: 'p1', workspaceId: 'w1' }],
    tabs: open, otherWorkspaceTabs: elsewhere,
  } as unknown as BrowserSnapshot;
  assert.deepEqual(groupSleepTabs(state, 'g1').map(item => item.id), ['a']);
  assert.deepEqual(workspaceSleepTabs(state, 'w1').map(item => item.id), ['a', 'c', 'f']);
  assert.deepEqual(workspaceSleepTabs(state, 'w2').map(item => item.id), ['d', 'g'], 'a workspace that is not open is found through otherWorkspaceTabs');
  assert.deepEqual(groupSleepTabs(state, 'nope'), []);
  const single = { ...state, otherWorkspaceTabs: undefined } as unknown as BrowserSnapshot;
  assert.deepEqual(workspaceSleepTabs(single, 'w1').map(item => item.id), ['a', 'c', 'f'], 'one workspace has no other tabs');
});

test('the action carries tab ids only, and nothing is sent for no tabs', () => {
  assert.deepEqual(sleepAction([tab('a'), tab('b')]), { type: 'tab.sleep', tabIds: ['a', 'b'] });
  assert.equal(sleepAction([]), null);
});

test('the three menus carry the row, each guarded by the same rule and each with its own English text', () => {
  const en = JSON.parse(read('src/i18n/en.json')) as Record<string, string>;
  assert.equal(en['tabsleep.menuTab'], 'Put to sleep');
  assert.equal(en['tabsleep.menuGroup'], 'Put group to sleep');
  assert.equal(en['tabsleep.menuWorkspace'], 'Put workspace to sleep');
  assert.ok(read('src/App.tsx').includes(`mayOfferSleep(state, context) && row(tr("tabsleep.menuTab"), Moon,`), 'the tab menu');
  assert.ok(read('src/components/TabGroupControls.tsx').includes(`groupSleepTabs(state,group.id)`) && read('src/components/TabGroupControls.tsx').includes(`t('tabsleep.menuGroup')`), 'the group menu');
  const workspace = read('src/features/workspaces/WorkspaceMenu.tsx');
  assert.ok(workspace.includes('workspaceSleepTabs(state, subject.id)') && workspace.includes(`t('tabsleep.menuWorkspace')`), 'the workspace menu');
  assert.ok(workspace.includes('subject && !spaces && !locked ?'), 'a locked workspace, or profiles as spaces, offers none');
});
