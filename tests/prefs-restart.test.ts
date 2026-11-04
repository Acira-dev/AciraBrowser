import test from 'node:test';
import assert from 'node:assert/strict';

/** A restart: the page's storage stays, every module is loaded fresh (own caches, own memory). */
const store = new Map<string, string>();
const g = globalThis as any;
g.localStorage = {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; }, clear: () => store.clear()};
g.window = Object.assign(g.window ?? {}, {addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }});
let boot = 0;
const fresh = async (path: string) => import(`${path}?restart=${++boot}`);

test('new-tab artwork, modules, style and shortcuts survive a restart (per profile)', async () => {
  const first = await fresh('../src/ui/newTabPreferences.ts');
  const before = first.readNewTabPreferences('profile-work');
  first.updateNewTabPreferences('profile-work', {artStyle: before.artStyle === 'full' ? 'framed' : 'full', daily: !before.daily, modules: {...before.modules, recent: !before.modules.recent, artwork: false}});
  const wrote = first.readNewTabPreferences('profile-work');
  const second = await fresh('../src/ui/newTabPreferences.ts');
  const after = second.readNewTabPreferences('profile-work');
  assert.equal(after.artStyle, wrote.artStyle);
  assert.equal(after.daily, wrote.daily);
  assert.equal(after.modules.recent, wrote.modules.recent);
  assert.equal(after.modules.artwork, false);
  assert.equal(second.readNewTabPreferences('profile-other').modules.artwork, before.modules.artwork, 'another profile keeps its own');
});

test('toolbar buttons (shown, hidden, order) survive a restart (per profile)', async () => {
  const first = await fresh('../src/ui/toolbarPrefs.ts');
  const items = first.defaultToolbarItems;
  const flipped = items.map((item: any, index: number) => index === 0 ? {...item, visible: !item.visible} : item);
  first.setToolbarItems(flipped, 'profile-work');
  await fresh('../src/ui/toolbarPrefs.ts');
  const raw = store.get('acira-toolbar-items:profile-work') ?? [...store.entries()].find(([k]) => k.includes('toolbar') && k.endsWith(':profile-work'))?.[1];
  assert.ok(raw, 'stored under the page storage');
  // The list carries a mark that it was saved in the order the toolbar draws (toolbarPrefs.ts ORDERED).
  assert.deepEqual(JSON.parse(raw!).filter((i: any) => i.id !== 'ordered').map((i: any) => [i.id, i.visible]), flipped.map((i: any) => [i.id, i.visible]));
});

test('R3-68: the old Hide until needed flag is read once (it becomes Seamless) and the first-run tip is remembered per profile', async () => {
  store.set('acira-autohide-toolbar', '1');
  const first = await fresh('../src/ui/chromePrefs.ts');
  assert.equal(first.consumeLegacyAutoHide(), true);
  assert.equal(store.has('acira-autohide-toolbar'), false, 'reading it clears it, however many windows start');
  assert.equal(first.consumeLegacyAutoHide(), false);
  assert.equal(first.seamlessTipSeen('profile-work'), false);
  first.rememberSeamlessTip('profile-work');
  const second = await fresh('../src/ui/chromePrefs.ts');
  assert.equal(second.seamlessTipSeen('profile-work'), true, 'survives a restart');
  assert.equal(second.seamlessTipSeen('profile-other'), false, 'another profile still gets its tip');
});
