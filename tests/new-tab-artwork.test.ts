import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// The preference module talks to window/localStorage only when asked to; give it a minimal window.
(globalThis as any).window = new EventTarget();
const require = createRequire(import.meta.url);
const { artworkImageInfo } = require('../desktop/artwork-image.cjs');
const prefs = await import('../src/ui/newTabPreferences');
const catalog = JSON.parse(fs.readFileSync('public/artwork/catalog-v2/catalog.json', 'utf8'));
const MiB = 1024 * 1024;

test('every built-in painting is a real, public-domain, bounded JPEG that matches its record', () => {
  const ids = new Set<string>();
  let total = 0;
  for (const item of catalog.paintings) {
    assert.ok(!ids.has(item.id), 'duplicate ' + item.id);
    ids.add(item.id);
    assert.equal(item.isPublicDomain, true, item.id);
    assert.match(item.rights, /CC0|Public Domain/i, item.id);
    assert.ok(item.provider && item.source && item.metadataURL && item.imageURL && item.artist && item.name && item.alt, 'provenance ' + item.id);
    assert.ok(/^https:\/\//.test(item.source) && /^https:\/\//.test(item.imageURL), item.id);
    const bytes = fs.readFileSync(path.join('public', item.src));
    const info = artworkImageInfo(bytes);
    assert.equal(info.mime, 'image/jpeg', item.id);
    assert.equal(info.width, item.width, item.id);
    assert.equal(info.height, item.height, item.id);
    assert.equal(bytes.length, item.bytes, item.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.id);
    assert.ok(Math.max(item.width, item.height) >= 2000 && Math.max(item.width, item.height) <= 2560, item.id);
    assert.match(item.objectPosition, /^\d{1,3}% \d{1,3}%$/, item.id);
    total += bytes.length;
  }
  assert.equal(total, catalog.totalBytes);
  assert.ok(total <= catalog.budgetBytes, 'catalog is within its budget');
  assert.ok(catalog.paintings.length >= 40, 'a real collection, not a starter set');
});

test('the picker catalog exposes every painting plus the offline illustrations', () => {
  const ids = prefs.artworkCatalog.map((item) => item.id);
  for (const item of catalog.paintings) assert.ok(ids.includes(item.id), item.id);
  assert.ok(ids.includes('dunes') && ids.includes('peaks'));
  assert.equal(prefs.defaultArtwork, catalog.paintings[0].id);
});

test('daily artwork is fixed for a local day and moves on at local midnight', () => {
  const profile = 'profile-personal';
  const at = (h: number, m = 0, s = 0, day = 24) => new Date(2026, 9, day, h, m, s);
  const first = prefs.dailyArtworkFor(profile, at(0, 0, 1));
  for (const [h, m, s] of [[0, 0, 1], [6, 30, 0], [12, 0, 0], [18, 45, 10], [23, 59, 59]]) assert.equal(prefs.dailyArtworkFor(profile, at(h, m, s)).id, first.id);
  assert.notEqual(prefs.dailyArtworkFor(profile, at(0, 0, 1, 25)).id, first.id, 'the next local day differs');
  assert.equal(prefs.selectedArtwork({ ...prefs.readNewTabPreferences(profile), daily: true }, profile, at(9)).id, first.id);
});

test('daily rotation visits every painting before repeating and avoids repeating neighbours', () => {
  const seen = new Set<string>();
  const count = prefs.artworkCatalog.filter((item) => item.src.startsWith('/artwork/catalog-v2/')).length;
  let previous = '';
  for (let day = 0; day < count; day++) {
    const item = prefs.dailyArtworkFor('profile-personal', new Date(2026, 0, 1 + day));
    assert.notEqual(item.id, previous);
    previous = item.id;
    seen.add(item.id);
  }
  assert.equal(seen.size, count);
});

test('a manual choice overrides the rotation and survives day changes', () => {
  const profile = 'manual-profile';
  const chosen = prefs.artworkCatalog[3].id;
  const value = { ...prefs.readNewTabPreferences(profile, true), daily: false, artwork: chosen };
  for (const day of [1, 2, 3, 9]) assert.equal(prefs.selectedArtwork(value, profile, new Date(2026, 9, day)).id, chosen);
});

test('hiding artwork persists the mode and Undo restores exactly that mode once', () => {
  const profile = 'undo-profile';
  prefs.updateNewTabPreferences(profile, { daily: true, artwork: prefs.artworkCatalog[2].id }, true);
  let notice: any;
  (globalThis as any).window.addEventListener('acira:artwork-hidden', (event: any) => { notice = event.detail; });
  prefs.hideWorkspaceArtwork(profile, true);
  assert.equal(prefs.readNewTabPreferences(profile, true).modules.artwork, false);
  assert.equal(prefs.readNewTabPreferences(profile, true).daily, true, 'rotation choice is untouched by hiding');
  assert.ok(notice, 'a notification is raised');
  assert.equal(prefs.undoWorkspaceArtwork(notice, 'someone-else'), false, 'another profile cannot undo');
  assert.equal(prefs.undoWorkspaceArtwork(notice, profile), true);
  const restored = prefs.readNewTabPreferences(profile, true);
  assert.equal(restored.modules.artwork, true);
  assert.equal(restored.daily, true);
  assert.equal(restored.artwork, prefs.artworkCatalog[2].id);
  assert.equal(prefs.undoWorkspaceArtwork(notice, profile), false, 'a stale Undo does nothing');
});

test('a later change makes the pending Undo stale instead of overwriting it', () => {
  const profile = 'stale-profile';
  let notice: any;
  (globalThis as any).window.addEventListener('acira:artwork-hidden', (event: any) => { if (event.detail.profile === profile) notice = event.detail; });
  prefs.hideWorkspaceArtwork(profile, true);
  prefs.updateNewTabPreferences(profile, { daily: true }, true);
  assert.equal(prefs.undoWorkspaceArtwork(notice, profile), false);
  assert.equal(prefs.readNewTabPreferences(profile, true).modules.artwork, false);
});

test('artwork style defaults to framed, migrates old preferences, and only accepts known styles', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, String(value)), removeItem: (key: string) => void store.delete(key) };
  try {
    assert.equal(prefs.readNewTabPreferences('fresh-profile').artStyle, 'framed');
    // A saved record from before the style existed becomes Framed.
    store.set('acira-new-tab:legacy-profile', JSON.stringify({ version: 'old', modules: { artwork: true, name: false, mark: false, search: true, shortcuts: false, saved: true, recent: true }, artwork: 'met-436535', daily: false, frequent: false, shortcuts: [] }));
    const legacy = prefs.readNewTabPreferences('legacy-profile');
    assert.equal(legacy.artStyle, 'framed');
    assert.equal(legacy.modules.artwork, true);
    store.set('acira-new-tab:full-profile', JSON.stringify({ ...legacy, artStyle: 'full' }));
    assert.equal(prefs.readNewTabPreferences('full-profile').artStyle, 'full');
    store.set('acira-new-tab:odd-profile', JSON.stringify({ ...legacy, artStyle: 'neon' }));
    assert.equal(prefs.readNewTabPreferences('odd-profile').artStyle, 'framed');
    const saved = prefs.updateNewTabPreferences('legacy-profile', { artStyle: 'full' });
    assert.equal(saved.artStyle, 'full');
    assert.equal(JSON.parse(store.get('acira-new-tab:legacy-profile')!).artStyle, 'full');
    assert.deepEqual(Object.keys(prefs.artStyles), ['framed', 'full']);
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test('Change steps to the next painting in catalog order, wraps, and treats anything else as the start', () => {
  const paintings = prefs.artworkCatalog.filter((item) => item.src.startsWith('/artwork/catalog-v2/'));
  assert.equal(prefs.nextPainting(paintings[0].id).id, paintings[1].id);
  assert.equal(prefs.nextPainting(paintings[paintings.length - 1].id).id, paintings[0].id, 'wraps to the first');
  for (const stranger of ['dunes', 'peaks', 'personal:00000000-0000-4000-8000-000000000000', 'nothing']) assert.equal(prefs.nextPainting(stranger).id, paintings[0].id, stranger);
  const seen = new Set<string>();
  let id = paintings[0].id;
  for (let index = 0; index < paintings.length; index++) { seen.add(id); id = prefs.nextPainting(id).id; }
  assert.equal(seen.size, paintings.length, 'every painting is reached once per cycle');
  assert.equal(id, paintings[0].id);
});

test('Change is a manual choice: it turns the rotation off and keeps every other preference', () => {
  const profile = 'change-profile';
  const before = prefs.updateNewTabPreferences(profile, { daily: true, frequent: true, artStyle: 'full', modules: { ...prefs.readNewTabPreferences(profile, true).modules, mark: true, name: true, shortcuts: true }, shortcuts: [{ id: 's1', title: 'Docs', url: 'https://example.org/', start: true, sidebar: false }] }, true);
  const shown = prefs.selectedArtwork(before, profile, new Date(2026, 9, 24));
  const after = prefs.updateNewTabPreferences(profile, { artwork: prefs.nextPainting(shown.id).id, daily: false }, true);
  assert.equal(after.daily, false);
  assert.equal(after.artwork, prefs.nextPainting(shown.id).id);
  assert.notEqual(prefs.selectedArtwork(after, profile, new Date(2026, 9, 24)).id, shown.id);
  for (const day of [25, 26, 31]) assert.equal(prefs.selectedArtwork(after, profile, new Date(2026, 9, day)).id, after.artwork, 'it survives the day changing');
  assert.deepEqual({ ...after, version: '', artwork: '', daily: false }, { ...before, version: '', artwork: '', daily: false }, 'nothing else moves');
});

test('no second copy of the paintings ships: the framed rendition is made on the device', () => {
  assert.equal(fs.existsSync('public/artwork/catalog-v2/thumbs'), false, 'no thumbs folder');
  assert.equal(fs.existsSync('scripts/make-artwork-thumbs.cjs'), false);
  assert.equal(JSON.stringify(catalog).includes('thumb'), false, 'the catalog records originals only');
  const sum = catalog.paintings.reduce((total: number, item: any) => total + item.bytes, 0);
  assert.equal(sum, catalog.totalBytes);
  for (const item of catalog.paintings) {
    assert.match(item.id, /^[a-z][a-z0-9-]{1,40}$/, 'the rendition route accepts this id: ' + item.id);
    const shown = prefs.artworkCatalog.find((candidate) => candidate.id === item.id)!;
    if (item.width > 1760) assert.equal(shown.thumb, `/artwork-r/${item.id}.jpg`, item.id);
    else assert.equal(shown.thumb, undefined, item.id);
    assert.equal(shown.src, item.src, 'the original is still the full-background source');
  }
});
