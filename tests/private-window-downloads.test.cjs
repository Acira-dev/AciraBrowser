'use strict';
// A private window's downloads belong to that window alone: no other window receives them and no saved state holds them (docs/launch/PRIVATE_TABS.md).
// Only a private TAB's download carries `private: true`; a private WINDOW's has just its private-<uuid> profile id, so the rule has to read the id.
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {createInitialState, reduceBrowser, persistedSnapshot, restoreSnapshot, privateDownload} = require('../desktop/runtime.cjs');

const download = (id, over = {}) => ({type: 'download', id, tabId: 'tab', name: id + '.bin', size: '1 MB', status: 'Downloading', ...over});
const PRIVATE_PROFILE = 'private-473233e9-8c09-4ce6-9cd7-1132c739d06f';
const held = () => {
  let state = createInitialState();
  const normal = state.activeBrowserProfileId;
  state = reduceBrowser(state, {type: 'browser.event', event: download('ordinary', {browserProfileId: normal})});
  state = reduceBrowser(state, {type: 'browser.event', event: download('window-private', {browserProfileId: PRIVATE_PROFILE})});
  state = reduceBrowser(state, {type: 'browser.event', event: download('tab-private', {browserProfileId: 'private-tab-1', private: true})});
  return {state, normal};
};

test('a download is private by its flag or by a private profile id, and an ordinary one is not', () => {
  assert.equal(privateDownload({private: true}), true);
  assert.equal(privateDownload({browserProfileId: PRIVATE_PROFILE}), true, 'a private window\'s download has no flag, only the id');
  assert.equal(privateDownload({browserProfileId: 'private-secured-1'}), true);
  assert.equal(privateDownload({browserProfileId: 'profile-personal'}), false);
  assert.equal(privateDownload({}), false);
});

test('saved state holds the ordinary download and neither kind of private one', () => {
  const {state} = held();
  const saved = persistedSnapshot(state);
  assert.deepEqual(saved.downloads.map(d => d.id), ['ordinary']);
  assert.ok(!JSON.stringify(saved).includes(PRIVATE_PROFILE) && !JSON.stringify(saved).includes('window-private'));
});

test('a saved window that already holds a private window\'s download drops it on load', () => {
  const {state} = held();
  const file = JSON.parse(JSON.stringify(state)); // what an earlier build wrote
  assert.ok(file.downloads.some(d => d.id === 'window-private'));
  assert.deepEqual(restoreSnapshot(file).downloads.map(d => d.id), ['ordinary']);
});

test('a private window publishes nothing to the other windows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  const start = source.indexOf('function publishShared(){'), head = source.slice(start, start + 600);
  assert.ok(start > 0);
  assert.ok(head.indexOf('if(privateMode)return;') > 0 && head.indexOf('if(privateMode)return;') < head.indexOf('const downloads='), 'publishShared stops first thing in a private window, whichever handler called it (downloads.list and commit do not check)');
  assert.ok(head.includes('state.downloads.filter(d=>!privateDownload(d))'), 'what an ordinary window shares leaves out both kinds of private download');
});
