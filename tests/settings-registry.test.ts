import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../src/features/settings/entries/core';
import { settingsSections, type SettingsContext } from '../src/features/settings/model';
import { searchSettings } from '../src/features/settings/search';

const context: SettingsContext = { customGlassColors: true, privateProfile: false, desktop: true, websiteOpen: true, appearanceChanged: true, toolbarChanged: true, newTabChanged: true };
const top = (query: string, ctx = context) => searchSettings(core, query, ctx).map((hit) => hit.entry.id);

test('registry entries are well formed and unique', () => {
  const ids = new Set<string>();
  for (const entry of core) {
    assert.ok(/^[a-z0-9]+(-[a-zA-Z0-9]+)*$/.test(entry.id), entry.id);
    assert.ok(!ids.has(entry.id), `duplicate ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.title.trim() && entry.description.trim(), entry.id);
    // Panels may add sections of their own; the core registry must use the built-in ones.
    assert.ok((settingsSections as readonly string[]).includes(entry.section), entry.id);
    assert.equal(entry.anchor, entry.anchor.trim());
  }
  assert.ok(core.length > 60);
});

test('individual controls rank first for the requirement examples', () => {
  assert.equal(top('opacity')[0], 'glass-opacity');
  assert.equal(top('transparency')[0], 'reduce-transparency');
  assert.deepEqual(top('artwork').slice(0, 2), ['newtab-artwork', 'newtab-art']);
  assert.equal(top('zoom')[0], 'page-zoom');
  // "Answer cookie banners with Reject" and "Hide cookie banners" are cookie controls too, so they may lead; the clear-on-exit controls must follow them.
  assert.deepEqual(top('cookies').slice(0, 4), ['filters-cookie-answer', 'filters-promotions', 'cleanup-categories', 'cleanup-keep-sites']);
  assert.equal(top('dns')[0], 'secure-dns');
  assert.equal(top('import')[0], 'import-browser');
  assert.equal(top('clear on exit')[0], 'cleanup-enabled');
  assert.equal(top('dark mode')[0], 'appearance-mode');
});

test('typing is incremental and tolerant of case and diacritics', () => {
  assert.equal(top('SECU')[0], 'secure-dns');
  assert.equal(top('PÅGE ZOOM')[0], 'page-zoom');
  assert.ok(top('reduce').includes('reduce-motion'));
  assert.deepEqual(top('   '), []);
  assert.deepEqual(top('zzzzqqq'), []);
});

test('unavailable controls are not offered', () => {
  assert.ok(!top('opacity', { ...context, customGlassColors: false }).includes('glass-opacity'));
  assert.ok(!top('clear on exit', { ...context, privateProfile: true }).includes('cleanup-enabled'));
});

test('a matched synonym is reported as context', () => {
  const hit = searchSettings(core, 'dark mode', context)[0];
  assert.equal(hit.entry.id, 'appearance-mode');
  assert.equal(hit.via, 'dark mode');
});
