// Settings > Appearance > Layout > Hide the toolbar (13.3): the setting, where it applies, where its row and search entry show, and that switching it is a layout switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createInitialState } from '../src/runtime/core';
import { hideToolbarOn } from '../src/runtime/windowView';
import { chromeLayoutChanged } from '../src/ui/chromeLayout';
import { isAvailable, type SettingsContext, type SettingsEntry } from '../src/features/settings/model';
import en from '../src/i18n/en.json';
const require = createRequire(import.meta.url);
const { validateAction } = require('../desktop/validation.cjs');

const on = { hideToolbar: true, verticalTabs: true, addressInSidebar: false };
test('it hides the toolbar only with tabs in a sidebar, outside Sidebar mode and outside Seamless', () => {
  for (const view of ['full', 'compact', 'focus'] as const) assert.equal(hideToolbarOn(on, view), true, view);
  assert.equal(hideToolbarOn(on, 'seamless'), false, 'Seamless hides the toolbar already');
  assert.equal(hideToolbarOn({ ...on, verticalTabs: false }, 'full'), false, 'along the top there is one header, Seamless covers it');
  assert.equal(hideToolbarOn({ ...on, addressInSidebar: true }, 'full'), false, 'Sidebar + address has no toolbar');
  assert.equal(hideToolbarOn({ ...on, hideToolbar: false }, 'full'), false);
  assert.equal(hideToolbarOn({ verticalTabs: true }, 'full'), false, 'off unless true');
  assert.equal(hideToolbarOn(null, 'full'), false);
});

test('the setting is optional, off by default, and the bridge takes a boolean only', () => {
  const state = createInitialState();
  assert.equal(state.settings.hideToolbar, undefined);
  assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { hideToolbar: true } }, state));
  assert.doesNotThrow(() => validateAction({ type: 'settings.update', patch: { hideToolbar: false } }, state));
  assert.throws(() => validateAction({ type: 'settings.update', patch: { hideToolbar: 'yes' } }, state));
});

test('turning it on or off is a layout switch (one page layout, not the header\'s own spring)', () => {
  const a = createInitialState(), b = { ...a, settings: { ...a.settings, hideToolbar: true } };
  assert.equal(chromeLayoutChanged(a, b), true);
  assert.equal(chromeLayoutChanged(b, a), true);
  assert.equal(chromeLayoutChanged(a, { ...a, settings: { ...a.settings, hideToolbar: false } }), false, 'unset and false are the same');
});

const entry = ((await import('../src/features/settings/entries/core')).default as SettingsEntry[]).find((item) => item.id === 'hide-toolbar');
const ctx = (patch: Partial<SettingsContext>): SettingsContext => ({ customGlassColors: false, privateProfile: false, desktop: true, websiteOpen: false, ...patch });
test('it has its own search entry in Appearance > Layout, found by the words people use, shown only where the row is', () => {
  assert.ok(entry, 'registered');
  assert.deepEqual([entry!.section, entry!.group], ['Appearance', 'Layout']);
  assert.equal(entry!.title, en['windowview.hideToolbar']);
  for (const word of ['hide toolbar', 'top bar', 'toolbar only']) assert.ok(entry!.aliases?.includes(word) || entry!.title.toLowerCase().includes(word), word);
  assert.equal(isAvailable(entry!, ctx({ hideToolbarRow: true })), true);
  assert.equal(isAvailable(entry!, ctx({})), false);
});

test('its words are in the catalog: the title and detail mirror the closed sidebar\'s "Rest the pointer at the left edge"', () => {
  assert.equal(en['windowview.hideToolbar'], 'Hide the toolbar');
  assert.equal(en['windowview.hideToolbarDetail'], 'Rest the pointer at the top edge to see it.');
  assert.match(en['windowview.hideToolbarNotice'], /^Toolbar hidden\. Rest the pointer at the top edge/);
});
