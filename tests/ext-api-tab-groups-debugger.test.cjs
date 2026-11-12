'use strict';
// chrome.tabGroups and chrome.debugger exist for extensions that declare them, and answer plainly that Acira shows no tab groups and lets no
// extension debug a page. An AI assistant extension (1.0.106) reads chrome.tabGroups.Color and adds a chrome.debugger.onEvent listener while its scripts load; with
// neither namespace its service worker stopped there ("Cannot read properties of undefined (reading 'Color')", then "(reading 'onEvent')"), so
// its toolbar button never opened its side panel.
const test = require('node:test'), assert = require('node:assert/strict');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');

const packages = () => extApi.loadPackages({fresh: true});
const world = (permissions, options = {}) => extensionWorld({manifest_version: 3, name: 'Fixture', version: '1', permissions}, {packages: packages(), browser: {runtime: {id: ID}}, ...options});
const message = promise => promise.then(() => 'resolved', error => error.message);

test('both namespaces exist only for an extension that declares the permission, in its worker and its pages', () => {
  const none = world(['storage', 'tabs']);
  assert.equal(none.chrome.tabGroups, undefined);
  assert.equal(none.chrome.debugger, undefined);
  for (const worker of [true, false]) {
    const {chrome, browser} = world(['tabGroups', 'debugger', 'tabs'], {worker});
    assert.equal(typeof chrome.tabGroups, 'object', 'tabGroups, worker=' + worker);
    assert.equal(typeof chrome.debugger, 'object', 'debugger, worker=' + worker);
    assert.equal(browser.tabGroups, chrome.tabGroups);
    assert.equal(browser.debugger, chrome.debugger);
  }
  assert.equal(world(['tabGroups'], {}).chrome.debugger, undefined, 'one permission, one namespace');
  assert.equal(extensionWorld({manifest_version: 2, name: 'Old', version: '1', permissions: ['tabGroups']}, {packages: packages()}).chrome.tabGroups, undefined, 'tabGroups needs Manifest V3, as in Chromium');
});

test('chrome.tabGroups: Chromium\'s Color enum and TAB_GROUP_ID_NONE, no groups to read, changes refused, events that never fire', async () => {
  const {chrome} = world(['tabGroups']), g = chrome.tabGroups;
  assert.deepEqual(plain(g.Color), {GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green', PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange'});
  assert.equal(g.TAB_GROUP_ID_NONE, -1);
  assert.deepEqual(plain(await g.query({})), []);
  assert.deepEqual(plain(await new Promise(resolve => g.query({windowId: -2}, resolve))), [], 'callback form');
  assert.equal(await message(g.get(5)), 'No group with id: 5.');
  assert.equal(await message(g.update(5, {title: 'x'})), 'Acira does not let extensions change tab groups.');
  assert.equal(await message(g.move(5, {index: 0})), 'Acira does not let extensions change tab groups.');
  assert.throws(() => g.get('five'), /No matching signature|Error at parameter/, 'Chromium\'s argument checks');
  for (const name of ['onCreated', 'onUpdated', 'onMoved', 'onRemoved']) {
    const listener = () => {};
    g[name].addListener(listener);
    assert.equal(g[name].hasListener(listener), true, name);
  }
});

test('chrome.debugger: attach refused in plain words, nothing to attach to, Chrome\'s not-attached errors, events that never fire', async () => {
  const {chrome, calls} = world(['debugger']), d = chrome.debugger;
  assert.equal(await message(d.attach({tabId: 7}, '1.3')), 'Acira does not let extensions debug pages.');
  assert.deepEqual(plain(await d.getTargets()), []);
  assert.equal(await message(d.sendCommand({tabId: 7}, 'Page.captureScreenshot', {})), 'Debugger is not attached to the tab with id: 7.');
  assert.equal(await message(d.detach({tabId: 7})), 'Debugger is not attached to the tab with id: 7.');
  assert.equal(await message(d.detach({targetId: 'abc'})), 'Debugger is not attached to the target with id: abc.');
  assert.equal(await message(d.detach({extensionId: 'x'.repeat(32)})), `Debugger is not attached to the extension with id: ${'x'.repeat(32)}.`);
  // callback form sets chrome.runtime.lastError, as in Chrome
  const lastError = await new Promise(resolve => d.attach({tabId: 7}, '1.3', () => resolve(chrome.runtime.lastError && chrome.runtime.lastError.message)));
  assert.equal(lastError, 'Acira does not let extensions debug pages.');
  for (const name of ['onEvent', 'onDetach']) { const listener = () => {}; d[name].addListener(listener); assert.equal(d[name].hasListener(listener), true, name); }
  assert.equal(calls.filter(call => /debugger|tabGroups/.test(String(call.name))).length, 0, 'nothing is asked of the main process');
});

test('An AI assistant extension\'s load-time lines run: Color and TAB_GROUP_ID_NONE are read, debugger listeners are added', () => {
  const {chrome} = world(['sidePanel', 'tabGroups', 'debugger', 'tabs']);
  assert.doesNotThrow(() => {
    const colors = [chrome.tabGroups.Color.ORANGE, chrome.tabGroups.Color.BLUE];
    if (chrome.tabGroups.TAB_GROUP_ID_NONE !== -1 || colors.includes(undefined)) throw new Error('missing constant');
    chrome.debugger.onEvent.addListener(() => {});
    chrome.debugger.onDetach.addListener(() => {});
  });
});
