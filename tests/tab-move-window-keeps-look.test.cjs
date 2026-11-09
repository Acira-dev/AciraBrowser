'use strict';
// Move to new window: the tab's own name, mute and pin go with it (they were lost: "Seven" arrived as "Page 7", unmuted and unpinned).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {handoverActions} = require('../desktop/tab-handover.cjs');
const {createInitialState, reduceBrowser} = require('../desktop/runtime.cjs');
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');

test('what the person set on the tab goes along; nothing else', () => {
  assert.deepEqual(handoverActions({customTitle: 'Seven', muted: true, pinned: true, title: 'Page 7', url: 'https://a.test/', group: 'Work'}),
    [{type: 'tab.rename', title: 'Seven'}, {type: 'tab.mute', muted: true}, {type: 'tab.pin'}]);
  assert.deepEqual(handoverActions({title: 'Page 7', muted: false, pinned: false, customTitle: '  '}), []);
  assert.deepEqual(handoverActions(null), []);
});

test('applied to the new window\'s first tab they give it the name, the mute and the pin', () => {
  let s = createInitialState();
  s = reduceBrowser(s, {type: 'tab.navigate', url: 'https://a.test/seven'});
  for (const step of handoverActions({customTitle: 'Seven', muted: true, pinned: true})) s = reduceBrowser(s, {...step, id: s.activeTabId});
  const tab = s.tabs.find(t => t.id === s.activeTabId);
  assert.equal(tab.customTitle, 'Seven'); assert.equal(tab.muted, true); assert.equal(tab.pinned, true);
});

test('main passes the tab\'s look to the new window and applies it after the first navigation', () => {
  const at = main.indexOf("if(action.type==='tab.move-window')"); assert.ok(at > 0);
  assert.ok(main.slice(at, at + 3500).includes('initialTab:privateMode?null:{customTitle:moving.customTitle,muted:moving.muted,pinned:moving.pinned}'));
  assert.ok(main.includes('initialTab:handedTab=null'));
  assert.ok(main.includes("require('./tab-handover.cjs').handoverActions(handedTab)"));
});
