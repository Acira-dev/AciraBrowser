import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyImportedFavorites, undoImportBatches } from '../src/ui/importedFavorites';
import { addSidebarApp, readSidebarApps } from '../src/ui/sidebarApps';

const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  window: new EventTarget(),
});
const favourite = { url: 'https://imported.example.test/', title: 'Imported favourite' };
const titles = (profile: string) => readSidebarApps(profile).apps.map(app => app.title);

test('import undo keeps sidebar favourites while native confirmation is pending', async () => {
  const profile = 'pending-import';
  applyImportedFavorites(profile, profile, [favourite]);
  let confirm!: (result: { undone: boolean }) => void;
  const pending = undoImportBatches([profile], () => new Promise(resolve => { confirm = resolve; }));
  assert.deepEqual(titles(profile), [favourite.title]);
  confirm({ undone: true });
  await pending;
  assert.deepEqual(titles(profile), []);
});

test('native refusal from a different or private profile preserves the ordinary sidebar and batch receipt', async () => {
  const profile = 'ordinary-import';
  applyImportedFavorites(profile, profile, [favourite]);
  const before = new Map(storage);
  await assert.rejects(undoImportBatches([profile], async () => { throw new Error('Import batch is not part of this profile.'); }), /not part of this profile/);
  assert.deepEqual(storage, before);
  assert.deepEqual(titles(profile), [favourite.title]);
  // A later valid undo still has the ownership receipt needed to remove its own favourite.
  await undoImportBatches([profile], async () => ({ undone: true }));
  assert.deepEqual(titles(profile), []);
});

test('an unconfirmed native response cannot remove imported favourites', async () => {
  const profile = 'unconfirmed-import';
  applyImportedFavorites(profile, profile, [favourite]);
  await assert.rejects(undoImportBatches([profile], async () => ({})), /could not be undone/);
  assert.deepEqual(titles(profile), [favourite.title]);
});

test('partial undo removes only confirmed batches and preserves pre-existing and other-profile favourites', async () => {
  const profile = 'partial-import', other = 'other-import';
  addSidebarApp(profile, false, { url: 'https://owned.example.test/', title: 'Already mine' });
  applyImportedFavorites(profile, 'partial-first', [{ url: 'https://first.example.test/', title: 'First import' }]);
  applyImportedFavorites(profile, 'partial-second', [favourite]);
  applyImportedFavorites(other, 'other-batch', [favourite]);
  const calls: string[] = [];
  await assert.rejects(undoImportBatches(['partial-first', 'partial-second'], async id => {
    calls.push(id);
    if (id === 'partial-second') throw new Error('Native undo failed');
    return { undone: true };
  }), /Native undo failed/);
  assert.deepEqual(calls, ['partial-first', 'partial-second']);
  assert.deepEqual(titles(profile), ['Already mine', favourite.title]);
  assert.deepEqual(titles(other), [favourite.title]);
  await undoImportBatches(['partial-second'], async () => ({ undone: true }));
  assert.deepEqual(titles(profile), ['Already mine']);
});

test('confirmed undo never removes a favourite that existed before the import', async () => {
  const profile = 'existing-import';
  addSidebarApp(profile, false, favourite);
  assert.equal(applyImportedFavorites(profile, profile, [favourite]), 0);
  await undoImportBatches([profile], async () => ({ undone: true }));
  assert.deepEqual(titles(profile), [favourite.title]);
});
