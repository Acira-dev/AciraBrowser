'use strict';
// Usage facts on a default profile: phishing protection and tab sleep are real on/off values, never "unknown" (gap fix, 27 Oct).
// Both read the same settings the switches show: privacy-plus `phishingLists` (+ a ready Safe Browsing key) and `settings.memorySaver`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const usage = require('../desktop/browser-services/usage-facts.cjs');
const { createPrivacyPlus } = require('../desktop/browser-services/privacy-plus.cjs');
const { createSafeBrowsing } = require('../desktop/browser-services/safe-browsing.cjs');
const { memorySaverChoice } = require('../desktop/tab-sleep.cjs');

test('a default profile reports both facts as booleans: on', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-facts-'));
  const privacy = createPrivacyPlus({ directory }).get();
  const google = createSafeBrowsing({ directory, env: {}, fetch: async () => { throw new Error('no network in tests'); }, setTimer: () => 0 }).status();
  assert.equal(google.state, 'off-no-key', 'a default profile has no Safe Browsing key');
  const phishing = usage.phishingProtectionOf(privacy, google), sleep = usage.tabSleepOf(undefined);
  assert.equal(typeof phishing, 'boolean'); assert.equal(typeof sleep, 'boolean');
  assert.equal(phishing, true, 'the open threat lists are on by default');
  assert.equal(sleep, memorySaverChoice(undefined).enabled, 'the same default tab-sleep.cjs runs with');
  const out = usage.sanitize({ phishingProtection: phishing, tabSleep: sleep });
  assert.equal(out.phishingProtection, 'on'); assert.equal(out.tabSleep, 'on');
});

test('the facts follow the switches', () => {
  assert.equal(usage.tabSleepOf({ enabled: false, idleMinutes: 15, neverSleep: [] }), false);
  assert.equal(usage.tabSleepOf({ enabled: true }), true);
  assert.equal(usage.tabSleepOf({ idleMinutes: 30 }), true, 'a saved choice without enabled keeps the default');
  assert.equal(usage.tabSleepOf('junk'), true);
  assert.equal(usage.phishingProtectionOf({ phishingLists: false }, { state: 'off-no-key' }), false);
  assert.equal(usage.phishingProtectionOf({ phishingLists: false }, { state: 'ready' }), true, 'Google Safe Browsing alone still protects');
  assert.equal(usage.phishingProtectionOf({ phishingLists: true }, undefined), true);
  assert.equal(usage.phishingProtectionOf(undefined, undefined), undefined, 'unknown only when neither status could be read');
  assert.equal(usage.sanitize({ phishingProtection: undefined }).phishingProtection, 'unknown');
});

test('main builds the facts with these readers, not the old shapes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /facts\.tabSleep=usage\.tabSleepOf\(settings\.memorySaver\)/);
  assert.match(main, /facts\.phishingProtection=usage\.phishingProtectionOf\(lists,google\)/);
  assert.match(main, /lists=contentBlocking\.antiTracking\.get\(\)/);
  assert.doesNotMatch(main, /sb\?\.enabled|sb\?\.active/, 'Safe Browsing status has no enabled/active field');
});
