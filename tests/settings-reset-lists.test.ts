import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, reduceBrowser } from '../src/runtime/core';
import { appearanceLookChanged, appearanceResetPatch, sidebarLayoutChanged, SIDEBAR_RESET, type AppearanceLook, type SidebarLayoutNow } from '../src/features/settings/changed';
import { defaultAppearancePalette, palettePreference } from '../src/runtime/appearancePalettes';
import { LOCALES } from '../src/i18n/locales';

const require = createRequire(import.meta.url);

// Settings › Appearance › Reset appearance, and Settings › Tabs › Sidebar › Reset sidebar layout: a Reset only shows (or is enabled) when something differs from its
// default, so the check has to look at everything the Reset puts back. Site color (beta.13) was put back by the button but ignored by the check, so changing only it never
// showed the row. These tests walk the keys the buttons write: a setting added to a reset without being added to its check fails here.

const stock: AppearanceLook = { ...palettePreference(defaultAppearancePalette), interfaceScale: 100, systemTheme: false, reducedMotion: false, animationSpeed: 'premium', reducedTransparency: false, siteColor: 'soft' };
const apply = (look: AppearanceLook, patch: Partial<AppearanceLook>): AppearanceLook => ({ ...look, ...patch });

test('a stock look has nothing to reset, and an old profile without Site color counts as Soft', () => {
  assert.equal(appearanceLookChanged(stock), false);
  const { siteColor: _omitted, ...old } = stock;
  assert.equal(appearanceLookChanged(old), false);
});

test('changing only Site color shows Reset appearance, and Reset puts it back to Soft', () => {
  for (const siteColor of ['off', 'rich'] as const) {
    const look = apply(stock, { siteColor });
    assert.equal(appearanceLookChanged(look), true, `Site color ${siteColor}`);
    const patch = appearanceResetPatch(look);
    assert.equal(patch.siteColor, 'soft');
    assert.equal(appearanceLookChanged(apply(look, patch as AppearanceLook)), false, 'nothing is left to reset');
  }
});

test('the Reset button\u2019s patch passes the settings validator and the reducer puts Site color back to Soft', () => {
  const { validateAction } = require('../desktop/validation.cjs');
  let state = createInitialState();
  assert.equal(state.settings.siteColor, 'soft', 'Soft is the default');
  assert.equal(appearanceLookChanged(state.settings), false, 'a new profile has nothing to reset');
  for (const siteColor of ['off', 'rich'] as const) {
    state = reduceBrowser(state, { type: 'settings.update', patch: { siteColor } } as any);
    assert.equal(state.settings.siteColor, siteColor);
    assert.equal(appearanceLookChanged(state.settings), true, 'only Site color differs, and the row shows');
    const action = { type: 'settings.update', patch: appearanceResetPatch(state.settings) };
    assert.doesNotThrow(() => validateAction(action, state), 'the main process accepts what the button sends');
    state = reduceBrowser(state, action as any);
    assert.equal(state.settings.siteColor, 'soft');
    assert.equal(appearanceLookChanged(state.settings), false, 'the row goes away again');
  }
  // Everything at once: Reset brings a profile with every Appearance setting changed back to the stock look.
  state = reduceBrowser(state, { type: 'settings.update', patch: { colorPreset: 'Silver', accentColor: '#3d6e9c', browserTint: '#f7f7f7', interfaceScale: 125, reducedMotion: true, animationSpeed: 'fast', reducedTransparency: true, siteColor: 'rich', glassOpacity: 40, surfaceColor: '#112233' } } as any);
  assert.equal(appearanceLookChanged(state.settings), true);
  state = reduceBrowser(state, { type: 'settings.update', patch: appearanceResetPatch(state.settings) } as any);
  assert.equal(appearanceLookChanged(state.settings), false, JSON.stringify(state.settings).slice(0, 300));
  assert.equal(state.settings.siteColor, 'soft');
});

// One way to differ from the default for every key the button writes (the colour fields only count while custom window colors are on, so they come with a glass opacity).
const DIFFERENT: Record<string, AppearanceLook> = {
  colorPreset: { colorPreset: 'Silver' },
  accentColor: { accentColor: '#123456' },
  browserTint: { browserTint: '#654321' },
  interfaceScale: { interfaceScale: 125 },
  systemTheme: { systemTheme: true },
  reducedMotion: { reducedMotion: true },
  animationSpeed: { animationSpeed: 'fast' },
  reducedTransparency: { reducedTransparency: true },
  siteColor: { siteColor: 'rich' },
  glassOpacity: { glassOpacity: 40 },
  surfaceColor: { glassOpacity: 64, surfaceColor: '#abcdef' },
  sidebarColor: { glassOpacity: 64, sidebarColor: '#abcdef' },
  toolbarColor: { glassOpacity: 64, toolbarColor: '#abcdef' },
  tabColor: { glassOpacity: 64, tabColor: '#abcdef' },
};

test('every setting Reset appearance writes makes the row show on its own, and the Reset clears it', () => {
  const written = Object.keys(appearanceResetPatch({ ...stock, systemTheme: true, glassOpacity: 40 }));
  assert.deepEqual(written.filter((key) => !(key in DIFFERENT)), [], 'a key the Reset writes has no case here: add it to appearanceLookChanged too');
  for (const key of written) {
    const look = apply(stock, DIFFERENT[key]);
    assert.equal(appearanceLookChanged(look), true, `${key} alone`);
    assert.equal(appearanceLookChanged(apply(look, appearanceResetPatch(look) as AppearanceLook)), false, `${key} after Reset`);
  }
  // beta.12 and beta.13 additions to Appearance, by name
  for (const key of ['systemTheme', 'siteColor', 'animationSpeed']) assert.ok(written.includes(key), key);
});

test('custom window colors only count while they are switched on', () => {
  assert.equal(appearanceLookChanged(apply(stock, { surfaceColor: '#abcdef' })), false);
  assert.equal(appearanceLookChanged(apply(stock, { glassOpacity: 64 })), false);
  assert.equal(appearanceLookChanged(apply(stock, { glassOpacity: 64, tabColor: '#abcdef' })), true);
});

const rested: SidebarLayoutNow = {
  width: SIDEBAR_RESET.settings.sidebarWidth, side: SIDEBAR_RESET.settings.sidebarSide, appsHidden: SIDEBAR_RESET.appsHidden, appsPlace: SIDEBAR_RESET.appsPlace,
  favoriteTabsInList: SIDEBAR_RESET.settings.favoriteTabsInList, tabsInSidebar: SIDEBAR_RESET.settings.verticalTabs, newTabsTop: SIDEBAR_RESET.rail.newTabsTop, folders: SIDEBAR_RESET.rail.folders, open: SIDEBAR_RESET.shown,
};

test('Reset sidebar layout is off for the default layout and on for each setting it puts back', () => {
  assert.equal(sidebarLayoutChanged(rested), false);
  assert.equal(sidebarLayoutChanged({ ...rested, favoriteTabsInList: undefined, newTabsTop: undefined, folders: undefined }), false, 'unset means the default');
  const each: Record<string, Partial<SidebarLayoutNow>> = {
    'size Narrow (beta.13)': { width: 168 },
    'size Wide (beta.13)': { width: 312 },
    'side Right (beta.13)': { side: 'right' },
    'Favorites hidden': { appsHidden: true },
    'Favorites at the bottom (beta.13)': { appsPlace: 'bottom' },
    'Favorites’ tabs out of the list (beta.13)': { favoriteTabsInList: false },
    'tabs in the sidebar': { tabsInSidebar: true },
    'new tabs at the bottom': { newTabsTop: false },
    'tab groups above (beta.13)': { folders: 'above' },
    'tab groups below (beta.13)': { folders: 'below' },
    'sidebar hidden': { open: false },
  };
  for (const [name, change] of Object.entries(each)) assert.equal(sidebarLayoutChanged({ ...rested, ...change }), true, name);
});

test('every key in the sidebar reset list is read by its check', () => {
  const read = new Set(['sidebarWidth', 'sidebarSide', 'favoriteTabsInList', 'verticalTabs', 'tabs', 'newTabsTop', 'folders']);
  const written = [...Object.keys(SIDEBAR_RESET.settings), ...Object.keys(SIDEBAR_RESET.rail).filter((key) => key !== 'newTabsTopChosen')];
  assert.deepEqual(written.filter((key) => !read.has(key)), [], 'a key the sidebar Reset writes is not in sidebarLayoutChanged');
});

test('both panels use the shared check and reset list instead of their own copies', () => {
  const sidebar = fs.readFileSync('src/features/settings/panels/sidebar.tsx', 'utf8'), appearance = fs.readFileSync('src/features/BrowserSettings.tsx', 'utf8');
  assert.match(sidebar, /sidebarLayoutChanged\(/);
  assert.match(sidebar, /SIDEBAR_RESET/);
  assert.match(appearance, /appearanceLookChanged\(s\)/);
  assert.match(appearance, /appearanceResetPatch\(s\)/);
});

const catalog = (code: string) => JSON.parse(fs.readFileSync(`src/i18n/${code}.json`, 'utf8')) as Record<string, string>;

test('the Reset sentences say what the Reset does, in English', () => {
  const en = catalog('en');
  const sidebar = en['sidebar.resetLayoutDetail'];
  for (const part of ['on the left', 'Standard size', 'top strip', 'Favorites', 'tab list', 'new tabs', 'tab groups']) assert.ok(sidebar.includes(part), `sidebar reset text lacks "${part}": ${sidebar}`);
  assert.doesNotMatch(sidebar, /\bapps?\b|width/i, 'the old wording (apps, width) is gone');
  assert.match(en['sidebar.restoreSidebarVisibilityAppsWidth'], /side, size, Favorites, tab groups/);
  for (const id of ['browsersettings.resetAppearanceDetail', 'core.restoreTheDefaultFinishScale']) assert.ok(en[id].includes('site color'), id);
});

test('the changed Reset sentences exist in all twelve languages and none is left in English', () => {
  const en = catalog('en');
  for (const { code } of LOCALES.filter((locale) => locale.code !== 'en')) {
    const messages = catalog(code);
    for (const id of ['sidebar.resetLayoutDetail', 'sidebar.restoreSidebarVisibilityAppsWidth', 'browsersettings.resetAppearanceDetail', 'core.restoreTheDefaultFinishScale'])
      assert.ok(messages[id] && messages[id] !== en[id], `${code} ${id}`);
  }
});
