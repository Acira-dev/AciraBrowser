import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { addPart, profilesIn, takePart } from '../src/runtime/spaceWindows';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Profiles as spaces (plan-profile-spaces v3 §3): joining profile windows into one and separating them again, nothing lost.
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const settle = (state: BrowserSnapshot) => run(state, { type: 'ui.update', patch: {} });

/** Two windows as today: Alex's (tab-home, a, b in a split, c in group Q4) and Client's (tab-home, pinned mail, x in group Q4). */
function windows() {
  const initial = createInitialState(), alex = initial.activeBrowserProfileId;
  const withClient = run(initial, { type: 'browser.profile.create', name: 'Client' }), client = withClient.browserProfiles.find(profile => profile.name === 'Client')!.id;
  const tab = (id: string, profile: string, extra = {}) => ({ ...makeTab(id, '', `https://${profile === alex ? 'f' : 'c'}-${id}.test/`, profile), ...extra });
  const one = settle(run({ ...withClient, tabs: [tab('tab-home', alex), tab('a', alex), tab('b', alex), tab('c', alex, { group: 'Q4' })], tabGroups: [{ id: 'group-1-0', name: 'Q4', color: 'red', collapsed: false, browserProfileId: alex }], activeTabId: 'a' }, { type: 'split.open', tabIds: ['a', 'b'] }));
  const two = settle({ ...withClient, tabs: [tab('tab-home', client), tab('mail', client, { pinned: true }), tab('x', client, { group: 'Q4' })], tabGroups: [{ id: 'group-1-0', name: 'Q4', color: 'blue', collapsed: true, browserProfileId: client }], activeTabId: 'x' });
  return { one, two, alex, client };
}
/** What each profile holds in a window, by address: pin, group and split partners, so renamed ids still compare. */
function holdings(state: BrowserSnapshot) {
  const url = (id: string) => state.tabs.find(tab => tab.id === id)?.url;
  const out: Record<string, string[]> = {};
  for (const tab of state.tabs) {
    const split = state.windowUi.splitGroups?.find(group => group.tabIds.includes(tab.id));
    (out[tab.browserProfileId] ??= []).push(`${tab.url}|${tab.pinned ? 'pin' : ''}|${tab.group}|${split ? split.tabIds.map(url).join('+') : ''}`);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

test('joining: Client\'s window comes into Alex\'s with every tab, its pin, group and split; clashing ids are renamed', () => {
  const { one, two, alex, client } = windows();
  const part = takePart(structuredClone(two), client), joined = structuredClone(one), renamed = addPart(joined, part);
  const after = settle(joined);
  assert.equal(renamed.get('tab-home'), 'tab-home-2', 'every window starts with tab-home, so the arriving one is renamed');
  assert.deepEqual(holdings(after)[client], holdings(two)[client]);
  assert.deepEqual(holdings(after)[alex], holdings(one)[alex], 'Alex\'s own tabs are untouched');
  assert.equal(after.tabGroups.filter(group => group.name === 'Q4').length, 2, 'both profiles keep their own Q4');
  assert.equal(after.activeTabId, 'a', 'the tab on screen stays');
  assert.deepEqual(profilesIn(after), [alex, client]);
  assert.ok(after.tabs.filter(tab => tab.browserProfileId === client).every(tab => !tab.loading && !tab.audible), 'arriving tabs are as after a restart');
});

test('separating gives each profile its tabs back exactly, and leaves the window with the profile on screen', () => {
  const { one, two, alex, client } = windows();
  const joined = structuredClone(one);
  addPart(joined, takePart(structuredClone(two), client));
  const shared = settle(joined);
  const left = structuredClone(shared), part = takePart(left, client), back = structuredClone(two);
  back.tabs = []; back.tabGroups = []; back.closedTabs = []; back.windowUi = { ...back.windowUi, splitGroups: [], split: null, lastTabs: {} };
  addPart(back, part);
  assert.deepEqual(holdings(settle(left)), { [alex]: holdings(one)[alex] });
  assert.deepEqual(holdings(settle({ ...back, activeTabId: back.tabs[0].id }))[client], holdings(two)[client]);
});

test('taking the profile on screen leaves the window on its first remaining tab', () => {
  const { one, two, client } = windows();
  const joined = structuredClone(two);
  addPart(joined, takePart(structuredClone(one), one.activeBrowserProfileId));
  const window = settle(joined);
  takePart(window, client);
  assert.ok(window.tabs.length > 0 && window.tabs.some(tab => tab.id === window.activeTabId));
  assert.ok(window.tabs.every(tab => tab.browserProfileId !== client));
});
