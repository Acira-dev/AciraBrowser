import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { coverView, personalCovers, showMyArtworks } from '../src/ui/artworkCollections';
import { artworkCatalog, readNewTabPreferences, updateNewTabPreferences } from '../src/ui/newTabPreferences';

// The workspace cover picker lists the person's own uploads as one more collection, "My artworks", and no longer appends them to the
// built-in paintings (where they used to land after the last painting, among the catalog).
const picker = fs.readFileSync(new URL('../src/components/WorkspaceCoverPicker.tsx', import.meta.url), 'utf8');
const asset = (id: string, name = id + '.png') => ({ id, name, width: 800, height: 600, bytes: 1000, url: 'acira-browser-ui://ui/personal-artwork/token/' + id });
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

test('"My artworks" is listed when there are uploads or the cover is one, and never in a private window', () => {
  assert.equal(showMyArtworks(0, 'met-436535', false), false, 'nothing uploaded: the entry is left out, as in Settings');
  assert.equal(showMyArtworks(2, 'met-436535', false), true);
  assert.equal(showMyArtworks(0, 'personal:' + A, false), true, 'a cover that is an upload keeps the entry (its picture is loading or was removed)');
  assert.equal(showMyArtworks(3, 'met-436535', true), false);
});

test('the picker shows the uploads while the cover is one or "My artworks" was picked, else the chosen collection', () => {
  assert.equal(coverView('built-in', 'met-436535', false, true), 'built-in');
  assert.equal(coverView('built-in', 'met-436535', true, true), 'personal', 'picked from the list');
  assert.equal(coverView('built-in', 'personal:' + A, false, true), 'personal', 'opened on an upload');
  assert.equal(coverView('nature', 'met-436535', false, true), 'nature');
  assert.equal(coverView('built-in', 'personal:' + A, true, false), 'built-in', 'the entry is gone (last upload removed): back to the collection');
});

test('uploads become covers in the form the preferences store, with their thumbnails\' own URLs', () => {
  const covers = personalCovers([asset(A, 'sea.png'), asset(B, 'hill.jpg')]);
  assert.deepEqual(covers.map(cover => cover.id), ['personal:' + A, 'personal:' + B]);
  assert.deepEqual(covers.map(cover => cover.name), ['sea.png', 'hill.jpg']);
  assert.ok(covers.every(cover => cover.src.startsWith('acira-browser-ui://ui/personal-artwork/')));
});

test('choosing an upload as the cover survives a restart (it is stored as the preference and read back)', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  (globalThis as { window?: unknown }).window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  const profile = 'profile-cover-test';
  updateNewTabPreferences(profile, { artwork: 'personal:' + A, collection: 'built-in', daily: false, perTab: false, hourly: false });
  // a fresh module state: the stored text alone decides
  const raw = store.get('acira-new-tab:' + profile)!;
  assert.equal(JSON.parse(raw).artwork, 'personal:' + A);
  assert.equal(readNewTabPreferences(profile).artwork, 'personal:' + A);
  assert.ok(!artworkCatalog.some(item => item.id === 'personal:' + A), 'and it is not a catalog painting');
});

test('the built-in grid lists only the catalog; uploads have their own list and entry', () => {
  assert.doesNotMatch(picker, /\.\.\.workspaceCovers,\.\.\.assets/, 'uploads are no longer appended to the built-in paintings');
  assert.match(picker, /const choices:CatalogArtwork\[\]=view==='personal'\?mine:workspaceCovers;/);
  assert.match(picker, /\.\.\.\(listed\?\[\{value:'personal' as const,label:t\('ntp\.personal'\)\}\]:\[\]\)/, 'one more entry in the collection list, named by the existing "My artworks" string');
  assert.match(picker, /value=\{view\} onChange=\{event=>choose\(event\.target\.value as CoverView\)\}/);
});

test('"My artworks" has its name in every language already', () => {
  for (const code of ['en', 'de', 'fr', 'es', 'it', 'pt-BR', 'ru', 'tr', 'ar', 'hi', 'ja', 'ko', 'zh-CN']) {
    const catalog = JSON.parse(fs.readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, string>;
    assert.ok(catalog['ntp.personal'], code + ' has ntp.personal');
  }
});
