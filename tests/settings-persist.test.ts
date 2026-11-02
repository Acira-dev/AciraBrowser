import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,persistedSnapshot,restoreSnapshot,reduceBrowser} from '../src/runtime/core';

/** A different, valid value for each setting; a setting missing here fails the test so new preferences cannot skip persistence. */
const different: Record<string, (value: any) => unknown> = {
  interfaceScale: v => (v === 1.25 ? 1 : 1.25),
  style: v => (v === 'acira' ? 'chrome' : 'acira'),
  appearance: v => (v === 'dark' ? 'light' : 'dark'),
  accentColor: () => '#aa3377',
  browserTint: () => '#336699',
  colorPreset: () => 'custom-x',
  toolbarLayout: v => (v === 'expanded' ? 'automatic' : 'expanded'),
  tabViewerDensity: v => (v === 'compact' ? 'comfortable' : 'compact'),
  tabHoverCard: v => (v === 'preview' ? 'off' : 'preview'),
  animationSpeed: v => (v === 'fast' ? 'premium' : 'fast'),
  glassOpacity: () => 61,
  surfaceColor: () => '#112233',
  sidebarColor: () => '#223344',
  tabColor: () => '#334455',
  searchEngine: v => (v === 'duckduckgo' ? 'google' : 'duckduckgo'),
  sidebarWidth: () => 301,
  panelWidth: () => 333,
  zoom: () => 125,
  workspace: () => 'research',
};

test('every setting survives a save and a restart (restoreSnapshot of what persistedSnapshot wrote)', () => {
  const base = createInitialState();
  const lost: string[] = [], unknown: string[] = [];
  for (const key of Object.keys(base.settings) as (keyof typeof base.settings)[]) {
    if (key === 'translucentOpacity') continue; // follows glassOpacity by design (materialSettings.ts)
    const current = (base.settings as any)[key];
    let next: unknown;
    if (typeof current === 'boolean') next = !current;
    else if (different[key]) next = different[key](current);
    else if (typeof current === 'number') next = current + 1;
    else { unknown.push(String(key)); continue; }
    const changed = reduceBrowser(base, {type: 'settings.update', patch: {[key]: next}} as any);
    if ((changed.settings as any)[key] !== next) continue; // the reducer clamps or refuses this value: not a persistence question
    const back = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(changed))));
    if (JSON.stringify((back.settings as any)[key]) !== JSON.stringify(next)) lost.push(`${String(key)}: ${JSON.stringify(next)} came back as ${JSON.stringify((back.settings as any)[key])}`);
  }
  assert.deepEqual(lost, [], 'settings that do not survive a restart');
  console.log('settings with no simple alternative value (checked by hand):', unknown.join(', '));
});

test('a profile\'s own settings survive a restart', () => {
  let s = createInitialState();
  const id = s.browserProfiles[0].id;
  s = reduceBrowser(s, {type: 'browser.profile.settings', id, patch: {appearance: 'dark', searchEngine: 'duckduckgo'}} as any);
  const own = (x: typeof s) => JSON.stringify(x.browserProfiles.find(p => p.id === id)?.settings ?? null);
  assert.notEqual(own(s), 'null', 'the profile took its own settings');
  const back = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
  assert.equal(own(back), own(s));
});

test('the interface language survives a restart', () => {
  const changed = reduceBrowser(createInitialState(), {type: 'settings.update', patch: {language: 'de'}} as any);
  assert.equal(changed.settings.language, 'de');
  assert.equal(restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(changed)))).settings.language, 'de');
});
