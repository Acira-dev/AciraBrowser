'use strict';
// Per-profile settings (docs/launch/PROFILES.md): a profile may keep its own appearance and search engine; anything it
// hasn't set follows the global setting. Windows are sent their profile's view; searches use the tab's own profile.
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createInitialState, reduceBrowser, restoreSnapshot, settingsFor, snapshotForProfile } = require('../desktop/runtime.cjs');
const { validateAction } = require('../desktop/validation.cjs');

const sharedLook = (s) => { const { colorPreset, accentColor, browserTint } = s.settings; return { colorPreset, accentColor, browserTint }; };
const BURGUNDY = { colorPreset: 'Burgundy', accentColor: '#4d1821', browserTint: '#4d1821' };
const OCEAN = { colorPreset: 'Ocean Blue', accentColor: '#266a98', browserTint: '#99c9e8' };
/** Two profiles; Work is on "This profile" (the Applies to row: its appearance and look are its own), Personal follows the shared settings. */
function workOwnsItsLook() {
  let s = twoProfiles();
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: 'dark', look: sharedLook(s) } });
  return s;
}
const asWork = (s) => ({ ...s, activeBrowserProfileId: 'profile-work' });
const finishOf = (s, id) => settingsFor(s, id).colorPreset;

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
  assert.deepEqual(s.browserProfiles.find((p) => p.id === 'profile-work').settings, { appearance: 'dark', searchEngine: 'duckduckgo', look: sharedLook(s) }, 'taking its own appearance also takes the colours it shows (13.6)');
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
  assert.deepEqual(restored.browserProfiles.find((p) => p.id === 'profile-work').settings, { appearance: 'dark', look: sharedLook(restored) });
  assert.doesNotThrow(() => validateAction({ type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: 'system', searchEngine: null } }, s));
  for (const patch of [{ appearance: 'blue' }, { searchEngine: 'altavista' }, { glassOpacity: 70 }, {}])
    assert.throws(() => validateAction({ type: 'browser.profile.settings', id: 'profile-work', patch }, s), JSON.stringify(patch));
  assert.throws(() => validateAction({ type: 'browser.profile.settings', id: 'nobody', patch: { appearance: 'dark' } }, s));
  const priv = twoProfiles();
  priv.browserProfiles.push({ id: 'private-1', name: 'Private', color: '#000000', partition: 'private-1', private: true });
  assert.equal(reduceBrowser(priv, { type: 'browser.profile.settings', id: 'private-1', patch: { appearance: 'dark' } }), priv);
});


// ---- 13.6: "Applies to: This profile" covers the Finish and the custom window colours too ------------------------------

test('a Finish chosen in a profile on "This profile" stays with that profile (the reported case)', () => {
  let s = workOwnsItsLook();
  const before = finishOf(s, 'profile-personal');
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: BURGUNDY });
  assert.equal(finishOf(s, 'profile-work'), 'Burgundy');
  assert.equal(finishOf(s, 'profile-personal'), before, 'the other profile keeps the shared Finish');
  assert.equal(s.settings.colorPreset, before, 'the setting for all profiles is untouched');
  assert.equal(s.settings.browserTint, createInitialState().settings.browserTint);
  assert.equal(settingsFor(s, 'profile-work').accentColor, '#4d1821');
});

test('without "This profile" a Finish is still the setting for all profiles, and a profile that owns its look is left alone', () => {
  let s = workOwnsItsLook();
  s = reduceBrowser(s, { type: 'settings.update', patch: OCEAN }); // the window is Personal's: it follows the shared look
  assert.equal(s.settings.colorPreset, 'Ocean Blue');
  assert.equal(finishOf(s, 'profile-personal'), 'Ocean Blue');
  assert.notEqual(finishOf(s, 'profile-work'), 'Ocean Blue', 'a shared change does not reach a profile that owns its look');
  assert.deepEqual(s.browserProfiles[1].settings.look, sharedLook(workOwnsItsLook()));
});

test('custom colours: set, reset and the shared ones never show through a profile that owns its look', () => {
  let s = workOwnsItsLook();
  s = reduceBrowser(s, { type: 'settings.update', patch: { sidebarColor: '#112233' } }); // shared (Personal's window)
  assert.equal(settingsFor(s, 'profile-personal').sidebarColor, '#112233');
  assert.equal(settingsFor(s, 'profile-work').sidebarColor, undefined, 'Work owns its look: no sidebar colour of its own, so none');
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: { toolbarColor: '#445566', tabColor: '#778899', surfaceColor: '#aabbcc', sidebarColor: '#ddeeff' } });
  const work = settingsFor(s, 'profile-work');
  assert.deepEqual([work.toolbarColor, work.tabColor, work.surfaceColor, work.sidebarColor], ['#445566', '#778899', '#aabbcc', '#ddeeff']);
  assert.equal(settingsFor(s, 'profile-personal').toolbarColor, undefined);
  assert.equal(s.settings.sidebarColor, '#112233', 'the shared sidebar colour is not Work\'s');
  // Reset on a colour: the settings page writes undefined
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: { toolbarColor: undefined } });
  assert.equal(settingsFor(s, 'profile-work').toolbarColor, undefined);
  assert.equal(settingsFor(s, 'profile-work').tabColor, '#778899', 'only that colour was reset');
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: { sidebarColor: 'not a colour' } });
  assert.equal(settingsFor(s, 'profile-work').sidebarColor, undefined, 'a bad value clears the colour, never stored');
});

test('one patch is split: the colours go to the profile, everything else stays shared; Reset appearance works on the profile', () => {
  let s = workOwnsItsLook();
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: { ...BURGUNDY, sidebarColor: '#112233', interfaceScale: 125, siteColor: 'rich' } });
  assert.equal(s.settings.interfaceScale, 125);
  assert.equal(s.settings.siteColor, 'rich');
  assert.equal(s.settings.sidebarColor, undefined);
  assert.equal(finishOf(s, 'profile-work'), 'Burgundy');
  const reset = { colorPreset: 'Porcelain', accentColor: '#1769c2', browserTint: '#f8fbff', sidebarColor: undefined, interfaceScale: 100 };
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: reset });
  assert.deepEqual(sharedLook(asWork(s)), sharedLook(s));
  assert.equal(settingsFor(s, 'profile-work').sidebarColor, undefined);
  assert.equal(s.settings.interfaceScale, 100);
});

test('Light / Dark / Auto from the Appearance popup (a settings.update) goes to the profile that owns it', () => {
  let s = workOwnsItsLook();
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: { appearance: 'light' } });
  assert.equal(settingsFor(s, 'profile-work').appearance, 'light');
  assert.equal(s.settings.appearance, createInitialState().settings.appearance, 'the shared appearance did not move');
  s = reduceBrowser(s, { type: 'settings.update', patch: { appearance: 'light' } }); // Personal's window
  assert.equal(s.settings.appearance, 'light');
});

test('All profiles: dropping the profile\'s appearance drops its look, and the profile shows the shared colours again', () => {
  let s = workOwnsItsLook();
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: BURGUNDY });
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: null, look: null } });
  assert.equal('settings' in s.browserProfiles[1], false);
  assert.equal(finishOf(s, 'profile-work'), createInitialState().settings.colorPreset);
  // a patch that drops only the appearance still takes the look with it (the two are one switch)
  s = workOwnsItsLook();
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: null } });
  assert.equal('settings' in s.browserProfiles[1], false);
  // and after All profiles a Finish is shared again
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: OCEAN });
  assert.equal(finishOf(s, 'profile-personal'), 'Ocean Blue');
});

test('taking its own appearance starts from the colours the profile shows now (setup, the Applies to row, an older store)', () => {
  let s = twoProfiles();
  s = reduceBrowser(s, { type: 'settings.update', patch: { ...OCEAN, tabColor: '#123456' } });
  // the short setup writes only the appearance: the profile still shows what it showed, and now owns it
  s = reduceBrowser(s, { type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: 'light' } });
  const own = s.browserProfiles[1].settings.look;
  assert.deepEqual(own, { ...OCEAN, tabColor: '#123456' });
  s = reduceBrowser(s, { type: 'settings.update', patch: BURGUNDY });
  assert.equal(finishOf(s, 'profile-work'), 'Ocean Blue', 'a later shared change leaves it alone');
  assert.equal(settingsFor(s, 'profile-work').tabColor, '#123456');
});

test('migration: a store saved with only Applies to: This profile gets that profile\'s look from what it showed; nothing moves on screen', () => {
  let s = twoProfiles();
  s = reduceBrowser(s, { type: 'settings.update', patch: { ...BURGUNDY, sidebarColor: '#112233' } });
  const saved = JSON.parse(JSON.stringify(s));
  saved.browserProfiles[1].settings = { appearance: 'dark' }; // how 13.5 and earlier stored it
  const shownBefore = settingsFor(saved, 'profile-work'); // 13.5: appearance dark, the shared colours
  const restored = restoreSnapshot(saved);
  const after = settingsFor(restored, 'profile-work');
  for (const key of ['appearance', 'colorPreset', 'accentColor', 'browserTint', 'sidebarColor', 'toolbarColor', 'tabColor', 'surfaceColor']) assert.equal(after[key], shownBefore[key], key);
  assert.deepEqual(restored.browserProfiles[1].settings.look, { ...BURGUNDY, sidebarColor: '#112233' });
  assert.equal(restored.browserProfiles[0].settings, undefined, 'a profile on All profiles gets nothing');
  // the second launch changes nothing, and a shared change after the update no longer moves the profile
  assert.deepEqual(restoreSnapshot(JSON.parse(JSON.stringify(restored))).browserProfiles, restored.browserProfiles);
  const moved = reduceBrowser(restored, { type: 'settings.update', patch: OCEAN });
  assert.equal(finishOf(moved, 'profile-work'), 'Burgundy');
  assert.equal(finishOf(moved, 'profile-personal'), 'Ocean Blue');
});

test('stored looks are cleaned: a bad Finish or colour never reaches the theme, and a look without an appearance is not kept', () => {
  const s = twoProfiles();
  const save = (settings) => { const copy = JSON.parse(JSON.stringify(s)); copy.browserProfiles[1].settings = settings; return restoreSnapshot(copy).browserProfiles[1].settings; };
  assert.deepEqual(save({ appearance: 'dark', look: { ...OCEAN, sidebarColor: '#112233', toolbarColor: 'red' } }), { appearance: 'dark', look: { ...OCEAN, sidebarColor: '#112233' } });
  assert.deepEqual(save({ appearance: 'dark', look: { colorPreset: 'Ocean Blue', accentColor: 'blue', browserTint: '#99c9e8' } }), { appearance: 'dark', look: sharedLook(s) }, 'a look that is not whole is replaced by what the profile showed');
  assert.equal(save({ look: OCEAN }), undefined, 'a look without its appearance is not a profile\'s own');
  assert.deepEqual(save({ appearance: 'dark', look: [1, 2] }), { appearance: 'dark', look: sharedLook(s) });
});

test('private windows and private profiles keep following the shared settings', () => {
  let s = workOwnsItsLook();
  s.browserProfiles.push({ id: 'private-1', name: 'Private', color: '#000000', partition: 'private-1', private: true });
  assert.equal(finishOf(s, 'private-1'), s.settings.colorPreset);
  const priv = { ...s, activeBrowserProfileId: 'private-1' };
  const next = reduceBrowser(priv, { type: 'settings.update', patch: BURGUNDY });
  assert.equal(next.settings.colorPreset, 'Burgundy', 'a private window\'s Finish change is the shared one, as before');
  assert.equal(next.browserProfiles[1].settings.look.colorPreset, sharedLook(s).colorPreset, 'Work\'s own look is untouched');
});

test('each window is sent its own profile\'s colours; no own look: the same snapshot, no copy', () => {
  let s = workOwnsItsLook();
  s = reduceBrowser(asWork(s), { type: 'settings.update', patch: { ...BURGUNDY, tabColor: '#778899' } });
  assert.equal(snapshotForProfile(s), s);
  const work = snapshotForProfile(asWork(s));
  assert.equal(work.settings.colorPreset, 'Burgundy');
  assert.equal(work.settings.tabColor, '#778899');
  assert.equal(s.settings.tabColor, undefined);
  // the profile on screen changes (profiles as spaces): the next snapshot carries the other look
  const back = snapshotForProfile({ ...s, activeBrowserProfileId: 'profile-personal' });
  assert.equal(back.settings.colorPreset, s.settings.colorPreset);
  assert.equal(back.settings.tabColor, undefined);
});

test('the native boundary takes a whole look and refuses a broken one', () => {
  const s = workOwnsItsLook();
  const act = (look) => ({ type: 'browser.profile.settings', id: 'profile-work', patch: { look } });
  assert.doesNotThrow(() => validateAction(act({ ...OCEAN, sidebarColor: '#112233', toolbarColor: '#445566', tabColor: '#778899', surfaceColor: '#aabbcc' }), s));
  assert.doesNotThrow(() => validateAction(act(null), s));
  assert.doesNotThrow(() => validateAction({ type: 'browser.profile.settings', id: 'profile-work', patch: { appearance: 'dark', look: OCEAN } }, s));
  for (const bad of [{}, { ...OCEAN, accentColor: 'blue' }, { ...OCEAN, browserTint: '#fff' }, { ...OCEAN, colorPreset: '' }, { ...OCEAN, colorPreset: 'x'.repeat(161) }, { ...OCEAN, sidebarColor: 'red' }, { ...OCEAN, glassOpacity: 70 }, { ...OCEAN, extra: 1 }, [], 'Burgundy', 3])
    assert.throws(() => validateAction(act(bad), s), JSON.stringify(bad));
});
