import test from 'node:test';
import assert from 'node:assert/strict';

// The profile button could be moved in Customize toolbar but was always drawn first (CSS order:-1 on the actions row). The row
// now draws the saved order. The default list starts with the profile button, so a toolbar nobody customised looks as before,
// and a list saved before this change keeps the look it had: its profile button moves to the front once, when it is read.
// Review (round 2): the "saved in order" mark was a key of its own, written before the list, so another window could read the
// mark with the old list between the two writes (a beta.9 list then drew the profile button last), and a list an older build
// rewrote kept the mark. The mark is now an entry in the list: one write, and older builds drop it.

const store = new Map<string, string>(), writes: string[] = [];
let onWrite: ((key: string) => void) | null = null;
const g = globalThis as any;
g.localStorage = {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); store.set(k, String(v)); onWrite?.(k); }, removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; }, clear: () => store.clear()};
g.window = Object.assign(g.window ?? {}, {addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }});
let boot = 0;
/** A restart: the page's storage stays, the module (and its caches) is loaded fresh. */
const fresh = async () => import(`../src/ui/toolbarPrefs.ts?restart=${++boot}`);
async function readAfterRestart(profile: string) {
  const mod = await fresh();
  return {mod, items: mod.readToolbarItems(profile) as {id: string; visible: boolean}[]};
}
const ids = (items: {id: string}[]) => items.map(item => item.id);

test('a toolbar nobody customised looks as before: the profile button leads, the Focus button sits last, beside the menu', async () => {
  const {defaultToolbarItems} = await fresh();
  assert.equal(defaultToolbarItems[0].id, 'profile');
  assert.equal(defaultToolbarItems.at(-1)!.id, 'focus');
  assert.deepEqual(defaultToolbarItems.filter((item: {visible: boolean}) => item.visible).map((item: {id: string}) => item.id), ['profile', 'extensions', 'focus']);
});

test('a list saved before this change keeps its look: the profile button first, the rest in their saved order', async () => {
  store.clear();
  // beta.10 and earlier saved the default list with the profile button last (and drew it first).
  store.set('acira-toolbar-items:profile-old', JSON.stringify([{id: 'extensions', visible: true}, {id: 'downloads', visible: true}, {id: 'focus', visible: true}, {id: 'profile', visible: true}]));
  const {items} = await readAfterRestart('profile-old');
  assert.deepEqual(ids(items).slice(0, 3), ['profile', 'extensions', 'downloads']);
  assert.equal(ids(items).indexOf('focus') > ids(items).indexOf('downloads'), true);
});

test('a profile button moved in Customize toolbar stays where it was put, after a restart too', async () => {
  store.clear(); writes.length = 0;
  const {mod} = await readAfterRestart('profile-work');
  const start = mod.normalizeToolbarItems(undefined);
  // Move it to the far right (after Focus): the row's last optional button, next to the Acira menu.
  const moved = mod.moveToolbarItem(start, 'profile', start.length);
  mod.setToolbarItems(moved, 'profile-work');
  assert.deepEqual(writes, ['acira-toolbar-items:profile-work'], 'one write: the list carries its own mark');
  assert.deepEqual([...store.keys()], ['acira-toolbar-items:profile-work']);
  assert.ok(JSON.parse(store.get('acira-toolbar-items:profile-work')!).some((entry: {id: string}) => entry.id === 'ordered'));
  const after = await readAfterRestart('profile-work');
  assert.equal(ids(after.items).at(-1), 'profile');
  assert.equal(ids(after.items).at(-2), 'focus');
  // In the middle as well.
  const middle = mod.moveToolbarItem(start, 'profile', 1);
  mod.setToolbarItems(middle, 'profile-work');
  assert.deepEqual(ids((await readAfterRestart('profile-work')).items).slice(0, 2), ['extensions', 'profile']);
  // Reset brings back the default list (profile first) and forgets the mark with it.
  mod.resetToolbarItems('profile-work');
  assert.equal(store.size, 0);
  assert.equal(ids((await readAfterRestart('profile-work')).items)[0], 'profile');
});

test('another profile keeps its own list and its own mark', async () => {
  store.clear();
  const {mod} = await readAfterRestart('profile-a');
  mod.setToolbarItems(mod.moveToolbarItem(mod.normalizeToolbarItems(undefined), 'profile', 20), 'profile-a');
  store.set('acira-toolbar-items:profile-b', JSON.stringify([{id: 'focus', visible: true}, {id: 'profile', visible: true}]));
  assert.equal(ids((await readAfterRestart('profile-a')).items).at(-1), 'profile');
  assert.equal(ids((await readAfterRestart('profile-b')).items)[0], 'profile', 'an older list in another profile still keeps its look');
});

test('another window never sees a half-saved list: the first save after the upgrade keeps the profile button first throughout', async () => {
  store.clear();
  // A beta.9 default list (profile last in the list, drawn first), open in two windows.
  const beta9 = [{id: 'extensions', visible: true}, {id: 'downloads', visible: false}, {id: 'focus', visible: true}, {id: 'profile', visible: true}];
  store.set('acira-toolbar-items:profile-up', JSON.stringify(beta9));
  const here = await fresh(), other = await fresh();
  assert.equal(ids(other.readToolbarItems('profile-up'))[0], 'profile');
  // This window shows Downloads (Customize toolbar saves the list as it is drawn); the other window reads on every storage write.
  const seen: string[][] = [];
  onWrite = () => { seen.push(ids(other.readToolbarItems('profile-up')).filter(id => ['profile', 'extensions', 'downloads', 'focus'].includes(id))); };
  try { here.setToolbarItems(here.readToolbarItems('profile-up').map((item: {id: string; visible: boolean}) => item.id === 'downloads' ? {...item, visible: true} : item), 'profile-up'); } finally { onWrite = null; }
  assert.ok(seen.length >= 1);
  for (const order of seen) assert.equal(order[0], 'profile', `the other window read ${order.join(',')} during the save`);
  assert.deepEqual(seen.at(-1), ['profile', 'extensions', 'downloads', 'focus']);
});

test('a list an older build writes back loses the mark, so its profile button is drawn first again', async () => {
  store.clear();
  const {mod} = await readAfterRestart('profile-down');
  mod.setToolbarItems(mod.moveToolbarItem(mod.normalizeToolbarItems(undefined), 'profile', 20), 'profile-down');
  const saved = JSON.parse(store.get('acira-toolbar-items:profile-down')!);
  // beta.10 and earlier keep only the ids they know (normalizeToolbarItems) and write that list back on their next save.
  const older = mod.normalizeToolbarItems(saved);
  assert.ok(!older.some((item: {id: string}) => item.id === 'ordered'), 'an older build drops the mark');
  store.set('acira-toolbar-items:profile-down', JSON.stringify(older));
  assert.equal(ids((await readAfterRestart('profile-down')).items)[0], 'profile');
});

test('profileFirst moves only the profile button', async () => {
  const {profileFirst} = await fresh();
  const list = [{id: 'extensions', visible: true}, {id: 'profile', visible: false}, {id: 'focus', visible: true}];
  assert.deepEqual(profileFirst(list), [{id: 'profile', visible: false}, {id: 'extensions', visible: true}, {id: 'focus', visible: true}]);
  assert.deepEqual(profileFirst([{id: 'profile', visible: true}, {id: 'focus', visible: true}]).map((item: {id: string}) => item.id), ['profile', 'focus']);
  assert.deepEqual(profileFirst([{id: 'focus', visible: true}]).map((item: {id: string}) => item.id), ['focus']);
});
