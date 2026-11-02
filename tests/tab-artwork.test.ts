import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// R3-31: "Another image" is per tab; hiding, a custom image and the collection stay profile-wide.
const storage = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, window: new EventTarget() });
const prefs = await import('../src/ui/newTabPreferences');
const art = await import('../src/ui/tabArtwork');

const profile = 'tab-art-profile';
const sign = (privateMode = false) => art.artworkSignature(profile, privateMode, prefs.readNewTabPreferences(profile, privateMode));
const paintings = prefs.artworkCatalog.filter((item) => item.src.startsWith('/artwork/catalog-v2/'));

test('a shuffle in one tab leaves every other tab and every profile preference alone', () => {
  const before = prefs.readNewTabPreferences(profile), writes = storage.size, signature = sign();
  const pick = art.shuffleTabArtwork('tab-A', profile, signature, null, before.artwork, () => 0.5);
  assert.notEqual(pick.artwork, before.artwork);
  assert.equal(art.tabArtworkPick('tab-A', signature)?.artwork, pick.artwork, 'the tab keeps its own picture');
  assert.equal(art.tabArtworkPick('tab-B', signature), null, 'another tab has no pick of its own');
  assert.equal(prefs.readNewTabPreferences(profile), before, 'the profile preferences object is the very same one');
  assert.equal(storage.size, writes, 'nothing is written to storage');
  assert.equal(before.daily || before.perTab || before.hourly, false);
});

test('a built-in shuffle is random within the collection and never lands on what is showing', () => {
  const signature = sign(), seen = new Set<string>();
  for (let step = 0; step < paintings.length; step++) {
    const current = paintings[step].id;
    const pick = art.shuffleTabArtwork('tab-R', profile, signature, null, current, () => step / paintings.length);
    assert.notEqual(pick.artwork, current);
    assert.ok(paintings.some((item) => item.id === pick.artwork), 'a painting of the collection');
    seen.add(pick.artwork);
  }
  assert.ok(seen.size > paintings.length / 2, 'the pick follows the random source, not a fixed next-in-catalog order');
  assert.equal(prefs.randomPainting('x', () => 0.999999).id, paintings[paintings.length - 1].id, 'the top of the random range stays in bounds');
  assert.equal(prefs.randomPainting('x', () => 0).id, paintings[0].id);
});

test('a remote shuffle gets a fresh seed for this tab and excludes only a picture of the same collection', () => {
  const signature = sign();
  const own = art.shuffleTabArtwork('tab-N', profile, signature, 'nature', 'nature:0123456789ab', undefined, () => 'seed-1');
  assert.deepEqual([own.seed, own.excludeId, own.artwork], ['seed-1', 'nature:0123456789ab', '']);
  const other = art.shuffleTabArtwork('tab-N', profile, signature, 'nature', 'space:0123456789ab', undefined, () => 'seed-2');
  assert.deepEqual([other.seed, other.excludeId], ['seed-2', ''], 'another collection\'s picture is not an exclusion');
  assert.equal(art.tabArtworkPick('tab-N', signature)?.seed, 'seed-2');
});

test('collection, custom image, interval or a new profile choice makes every pick stale', () => {
  const first = sign();
  art.shuffleTabArtwork('tab-S1', profile, first, null, 'x');
  art.shuffleTabArtwork('tab-S2', profile, first, null, 'x');
  art.shuffleTabArtwork('tab-other-profile', 'someone-else', art.artworkSignature('someone-else', false, prefs.readNewTabPreferences('someone-else')), null, 'x');
  for (const patch of [{ collection: 'nature' as const }, { artwork: paintings[4].id }, { daily: true }, { perTab: true, daily: false }, { hourly: true, perTab: false }]) {
    const next = prefs.updateNewTabPreferences(profile, patch);
    const changed = art.artworkSignature(profile, false, next);
    assert.notEqual(changed, first, JSON.stringify(patch));
    assert.equal(art.tabArtworkPick('tab-S1', changed), null, 'a pick made under the old choices is ignored: ' + JSON.stringify(patch));
    art.dropStaleTabArtwork(profile, changed);
    assert.equal(art.tabArtworkPick('tab-S2', first), null, 'and removed: ' + JSON.stringify(patch));
    art.shuffleTabArtwork('tab-S1', profile, first, null, 'x'); art.shuffleTabArtwork('tab-S2', profile, first, null, 'x');
  }
  prefs.updateNewTabPreferences(profile, { collection: 'built-in', artwork: prefs.defaultArtwork, daily: false, perTab: false, hourly: false });
  const other = art.artworkSignature('someone-else', false, prefs.readNewTabPreferences('someone-else'));
  assert.ok(art.tabArtworkPick('tab-other-profile', other), 'another profile\'s pick survives');
});

test('hiding the image is a profile preference: it hides every tab and survives a tab-local pick', () => {
  const p = 'tab-art-hide', before = prefs.readNewTabPreferences(p), signature = art.artworkSignature(p, false, before);
  art.shuffleTabArtwork('tab-H', p, signature, null, 'x');
  prefs.hideWorkspaceArtwork(p);
  const hidden = prefs.readNewTabPreferences(p);
  assert.equal(hidden.modules.artwork, false, 'one profile switch, read by every new tab');
  assert.equal(art.artworkSignature(p, false, hidden), signature, 'hiding does not make the tab-local pick stale; showing the image again restores it');
});

test('private tabs keep their pick in memory only and never in storage', () => {
  const writes = storage.size, signature = sign(true);
  art.shuffleTabArtwork('tab-P', profile, signature, null, 'x');
  assert.equal(storage.size, writes);
  assert.notEqual(signature, sign(false), 'a private pick is never read back by a normal tab');
});

test('the memory of picks is bounded and closing a tab forgets its pick', () => {
  const signature = sign();
  for (let index = 0; index < 100; index++) art.shuffleTabArtwork('bound-' + index, profile, signature, null, 'x');
  assert.equal(art.tabArtworkPick('bound-0', signature), null, 'the oldest pick fell out');
  assert.ok(art.tabArtworkPick('bound-99', signature));
  art.forgetTabArtwork('bound-99');
  assert.equal(art.tabArtworkPick('bound-99', signature), null);
});

test('the page shuffles through the tab store, not through profile preferences', () => {
  const page = fs.readFileSync('src/features/newtab/NewTabPage.tsx', 'utf8');
  const change = page.split('\n').find((line) => line.includes('const change = '));
  assert.ok(change && change.includes('shuffleTabArtwork(tab.id'), 'Another image calls the per-tab store');
  assert.doesNotMatch(change!, /setPrefs|collectionSeed|daily: false/, 'and writes no profile preference');
});
