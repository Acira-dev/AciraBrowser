'use strict';
// chrome://extensions from an extension (chrome.tabs.create / update): Acira's Extensions settings. PDF.js asks its worker for chrome://extensions/?id=<its id> so a person can switch
// on "Allow access to file URLs" (its viewer's link); Acira's counterpart is Settings > Extensions. Settings is one tab per profile; it opens on the Extensions section through the
// pending target the interface keeps (ui/settingsView.ts), which ext-api/tabs/settings-page.cjs writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRig} = require('./fixtures/ext-api-tabs/rig.cjs');
const {plain} = require('./fixtures/ext-api/world.cjs');
const settingsPage = require('../desktop/browser-services/ext-api/tabs/settings-page.cjs');

function scene() {
  const rig = createRig();
  const one = rig.addWindow({focused: true});
  const docs = rig.addTab(one, {url: 'https://docs.example.com/a', title: 'Docs A'});
  one.state.activeTabId = docs.id;
  const aimed = [], original = settingsPage.aimSettings;
  settingsPage.aimSettings = async args => { aimed.push(args); return true; };
  return {rig, one, docs, aimed, restore() { settingsPage.aimSettings = original; }};
}

test('chrome://extensions in every form Chrome has it is the Extensions page; nothing else is', () => {
  for (const address of ['chrome://extensions', 'chrome://extensions/', 'chrome://extensions/?id=oemmndcbldboiebfnladdacbdfmadadm', 'CHROME://EXTENSIONS/shortcuts', ' chrome://extensions#x ', 'chrome://extensions?id=a'])
    assert.equal(settingsPage.isExtensionsPage(address), true, address);
  for (const address of ['chrome://settings', 'chrome://extensionsx', 'chrome://newtab/', 'https://chrome://extensions/', 'chrome-extension://abc/extensions', 'extensions', '', null, undefined, 3])
    assert.equal(settingsPage.isExtensionsPage(address), false, String(address));
});

test('tabs.create: Settings opens in a new tab of the extension\'s window (not in the background when active), aimed at the Extensions section', async () => {
  const {rig, one, aimed, restore} = scene();
  try {
    const tab = plain(await rig.world.chrome.tabs.create({url: 'chrome://extensions/?id=oemmndcbldboiebfnladdacbdfmadadm', windowId: one.id}));
    const made = rig.dispatched.find(action => action.type === 'tab.new');
    assert.deepEqual([made.url, made.background, made.browserProfileId, typeof made.id], ['acira://settings', false, 'p', 'string']);
    assert.match(made.id, /^tab-[0-9a-f-]{36}$/, 'the id is chosen here so the target can be left for it');
    assert.deepEqual(aimed, [{nativeWindowId: one.id, tabId: made.id, section: 'Extensions'}]);
    assert.equal(one.state.activeTabId, made.id, 'active');
    assert.equal(tab.url, 'acira://settings', 'the extension is told the tab it opened');
    const background = plain(await rig.world.chrome.tabs.create({url: 'chrome://extensions', active: false}));
    assert.equal(rig.dispatched.filter(action => action.type === 'tab.new').length, 1, 'Settings is open already: no second tab');
    assert.equal(background.id, tab.id, 'the open Settings tab is the answer');
  } finally { restore(); }
});

test('tabs.create with Settings already open: it is selected (only when active) and aimed at the Extensions section; none is made', async () => {
  const {rig, one, docs, aimed, restore} = scene();
  try {
    const settings = rig.addTab(one, {url: 'acira://settings', title: 'Settings', page: false, contentKind: 'internal'});
    await rig.world.chrome.tabs.create({url: 'chrome://extensions/', active: false});
    assert.equal(rig.dispatched.some(action => action.type === 'tab.new'), false);
    assert.equal(one.state.activeTabId, docs.id, 'a background create leaves the active tab alone');
    assert.equal(aimed.at(-1).tabId, settings.id);
    await rig.world.chrome.tabs.create({url: 'chrome://extensions/'});
    assert.equal(one.state.activeTabId, settings.id);
    assert.deepEqual(aimed.map(call => call.section), ['Extensions', 'Extensions']);
  } finally { restore(); }
});

test('tabs.update: the tab itself becomes Settings (a navigation to acira://settings, the same tab id), aimed at the Extensions section', async () => {
  const {rig, one, docs, aimed, restore} = scene();
  try {
    const docsId = rig.wcOf ? rig.wcOf(one, docs).id : one.pages.get(docs.id).view.webContents.id;
    const tab = plain(await rig.world.chrome.tabs.update(docsId, {url: 'chrome://extensions/?id=abcdefghijklmnopabcdefghijklmnop'}));
    const navigation = rig.dispatched.find(action => action.type === 'tab.navigate');
    assert.deepEqual([navigation.url, navigation.tabId], ['acira://settings', docs.id]);
    assert.deepEqual(aimed, [{nativeWindowId: one.id, tabId: docs.id, section: 'Extensions'}]);
    assert.equal(tab.id, docsId);
  } finally { restore(); }
});

test('the pending target is the interface\'s own record: its key and shape are the ones ui/settingsView.ts reads', async () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'src/ui/settingsView.ts'), 'utf8');
  assert.match(view, /`acira-settings-target:\$\{encodeURIComponent\(destination\.windowId\)\}:\$\{encodeURIComponent\(destination\.tabId\)\}`/);
  assert.equal(settingsPage.targetKey('window a/1', 'tab-1'), 'acira-settings-target:window%20a%2F1:tab-1');
  // The record is written by the interface page itself, under ITS window identity (what settingsDestination uses), so run the code the page would run.
  const vm = require('node:vm'), writes = [];
  const pageWith = identity => ({executeJavaScript: async code => vm.runInNewContext(code, {window: {acira: {initialSnapshot: identity === undefined ? undefined : {windowId: identity}}}, localStorage: {setItem: (key, value) => writes.push([key, value])}, encodeURIComponent})});
  assert.equal(await settingsPage.aimSettings({nativeWindowId: 7, tabId: 'tab-9', section: 'Extensions', interfaceFor: id => (id === 7 ? pageWith('50668281-58b7:main') : null)}), true);
  assert.equal(writes[0][0], 'acira-settings-target:50668281-58b7%3Amain:tab-9', 'the interface identity <id>:main, percent-encoded, then the tab');
  const record = JSON.parse(writes[0][1]);
  assert.equal(record.section, 'Extensions');assert.ok(Math.abs(Date.now() - record.at) < 5000, 'stamped now: the interface drops one older than eight seconds');
  for (const bad of [{tabId: ''}, {tabId: undefined}]) assert.equal(await settingsPage.aimSettings({nativeWindowId: 7, section: 'Extensions', interfaceFor: () => pageWith('w'), ...bad}), false);
  assert.equal(await settingsPage.aimSettings({nativeWindowId: 7, tabId: 't', section: 'Extensions', interfaceFor: () => pageWith(undefined)}), false, 'a page with no identity yet');
  assert.equal(await settingsPage.aimSettings({nativeWindowId: 1, tabId: 't', section: 'Extensions', interfaceFor: () => null}), false, 'no interface page: Settings still opens, on its own section');
  assert.equal(await settingsPage.aimSettings({nativeWindowId: 1, tabId: 't', section: 'Extensions', interfaceFor: () => ({executeJavaScript: async () => { throw new Error('gone'); }})}), false);
  assert.equal(writes.length, 1);
  const found = settingsPage.existingSettingsTab([{url: 'https://a/', browserProfileId: 'p'}, {id: 's1', url: 'acira://settings', browserProfileId: 'q'}, {id: 's2', url: 'acira://settings', browserProfileId: 'p'}], 'p');
  assert.equal(found.id, 's2');assert.equal(settingsPage.existingSettingsTab([], 'p'), null);
});
