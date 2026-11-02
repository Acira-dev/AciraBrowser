'use strict';
// Per-profile settings (docs/launch/PROFILES.md): a profile may keep its own appearance and search engine; anything it
// hasn't set follows the global setting. Windows are sent their profile's view; searches use the tab's own profile.
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createInitialState, reduceBrowser, restoreSnapshot, settingsFor, snapshotForProfile } = require('../desktop/runtime.cjs');
const { validateAction } = require('../desktop/validation.cjs');

function twoProfiles() {
  const s = createInitialState();
  s.browserProfiles.push({ id: 'profile-work', name: 'Work', color: '#266a98', partition: 'persist:acira-profile-work' });
  return s;
}

test('native profile provider IDs must name a current provider; reset and legacy engine patches remain valid',()=>{
 const state=twoProfiles(),action=id=>({type:'browser.profile.settings',id:'profile-work',patch:{searchProviderId:id}});
 for(const id of ['google','wikipedia'])assert.equal(validateAction(action(id),state).patch.searchProviderId,id);
 for(const id of ['missing','a'.repeat(65),'../google',{}])assert.throws(()=>validateAction(action(id),state),/provider/);
 assert.equal(validateAction(action(null),state).patch.searchProviderId,null);
 state.settings.searchProviders={defaultId:'bing',engines:[{id:'bing',name:'Bing',keyword:'b',template:'https://bing.com/?q=%s'}]};assert.throws(()=>validateAction(action('google'),state),/missing/);assert.equal(validateAction(action('bing'),state).patch.searchProviderId,'bing');
});

test('a profile setting wins only when set, and null follows the global setting again', () => {
  let s = twoProfiles();
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: 'dark', searchEngine: 'duckduckgo' } });
  assert.deepEqual(s.browserProfiles.find((p) => p.id === 'profile-work').settings, { appearance: 'dark', searchEngine: 'duckduckgo' });
  assert.equal(settingsFor(s, 'profile-work').appearance, 'dark');
  assert.equal(settingsFor(s, 'profile-personal').appearance, s.settings.appearance, 'the other profile keeps the global setting');
  s = reduceBrowser(s, { type: 'settings.update', patch: { appearance: 'light' } });
  assert.equal(settingsFor(s, 'profile-personal').appearance, 'light');
  assert.equal(settingsFor(s, 'profile-work').appearance, 'dark', 'a global change leaves a profile’s own value alone');
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: null } });
  assert.equal(settingsFor(s, 'profile-work').appearance, 'light');
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { searchEngine: null } });
  assert.equal('settings' in s.browserProfiles.find((p) => p.id === 'profile-work'), false, 'nothing left: no settings object');
});

test('a window is sent its own profile’s view; custom engine lists default to the profile’s engine', () => {
  let s = twoProfiles();
  s.settings.searchProviders = { defaultId: 'google', engines: [{ id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s' }, { id: 'duckduckgo', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' }] };
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { searchEngine: 'duckduckgo' } });
  assert.equal(snapshotForProfile(s), s, 'no own settings in this window: the same snapshot, no copy');
  const work = snapshotForProfile({ ...s, activeBrowserProfileId: 'profile-work' });
  assert.equal(work.settings.searchEngine, 'duckduckgo');
  assert.equal(work.settings.searchProviders.defaultId, 'duckduckgo');
  assert.equal(s.settings.searchProviders.defaultId, 'google', 'the global list is untouched');
});

test('searches from a tab use that tab’s profile engine', () => {
  let s = twoProfiles();
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { searchEngine: 'duckduckgo' } });
  s = reduceBrowser(s, { type: 'tab.new', url: 'acira profiles', browserProfileId: 'profile-work' });
  const workTab = s.tabs.find((tab) => tab.id === s.activeTabId);
  assert.equal(workTab.browserProfileId, 'profile-work');
  assert.match(workTab.url, /^https:\/\/duckduckgo\.com\//);
  s = reduceBrowser(s, { type: 'tab.new', url: 'acira profiles', browserProfileId: 'profile-personal' });
  assert.doesNotMatch(s.tabs.find((tab) => tab.id === s.activeTabId).url, /duckduckgo/);
});

test('stored profile settings survive a restart, cleaned; private profiles and bad values are refused', () => {
  const s = twoProfiles();
  s.browserProfiles[1].settings = { appearance: 'dark', searchEngine: 'altavista', extra: 1 };
  const restored = restoreSnapshot(s);
  assert.deepEqual(restored.browserProfiles.find((p) => p.id === 'profile-work').settings, { appearance: 'dark' });
  assert.doesNotThrow(() => validateAction({ type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: 'system', searchEngine: null } }, s));
  for (const patch of [{ appearance: 'blue' }, { searchEngine: 'altavista' }, { glassOpacity: 70 }, {}])
    assert.throws(() => validateAction({ type: 'browser.profile.settings', id: 'profile-work', patch }, s), JSON.stringify(patch));
  assert.throws(() => validateAction({ type: 'browser.profile.settings', id: 'nobody', patch: { appearance: 'dark' } }, s));
  const priv = twoProfiles();
  priv.browserProfiles.push({ id: 'private-1', name: 'Private', color: '#000000', partition: 'private-1', private: true });
  assert.equal(reduceBrowser(priv, { type: 'browser.profile.settings', id: 'private-1', patch: { appearance: 'dark' } }), priv);
});
