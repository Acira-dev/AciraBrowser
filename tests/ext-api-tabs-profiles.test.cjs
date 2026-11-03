'use strict';
// chrome.tabs in a window holding several profiles (profiles as spaces, plan-profile-spaces v3): an extension sees its own profile's tabs
// only, and one active tab per window. A window of one profile (every window today) is listed exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRig} = require('./fixtures/ext-api-tabs/rig.cjs');

/** The rig's extension belongs to profile 'p'; window one also holds profile 'q's tabs, and q's tab is on screen. */
function mixedWindow() {
  const rig = createRig();
  const one = rig.addWindow({focused: true});
  const a = rig.addTab(one, {url: 'https://a.example.com/', title: 'A'});
  const b = rig.addTab(one, {url: 'https://b.example.com/', title: 'B'});
  const q = rig.addTab(one, {url: 'https://client.example.com/', title: 'Client mail', browserProfileId: 'q', profileId: 'q', session: {partition: 'persist:acira-q'}});
  one.state.activeTabId = q.id;
  one.state.windowUi = {lastTabs: {'workspace-p': b.id, 'workspace-q': q.id}};
  return {rig, one, a, b, q};
}

test('an extension never lists another profile\'s tabs in a shared window', async () => {
  const {rig} = mixedWindow();
  const listed = JSON.parse(JSON.stringify(await rig.call('tabs.query', {})));
  assert.deepEqual(listed.map(tab => tab.title), ['A', 'B']);
  assert.ok(!JSON.stringify(listed).includes('client.example.com'));
});

test('while another profile is on screen, the extension\'s active tab is its profile\'s last shown tab there', async () => {
  const {rig} = mixedWindow();
  const active = JSON.parse(JSON.stringify(await rig.call('tabs.query', {active: true})));
  assert.deepEqual(active.map(tab => tab.title), ['B']);
});

test('with its own profile on screen, the tab on screen is the active one, as before', async () => {
  const {rig, one, a} = mixedWindow();
  one.state.activeTabId = a.id;
  const active = JSON.parse(JSON.stringify(await rig.call('tabs.query', {active: true})));
  assert.deepEqual(active.map(tab => tab.title), ['A']);
});
