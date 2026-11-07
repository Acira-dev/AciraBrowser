import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { listedTabs } from '../src/runtime/favoriteTabs';
import { TAB_NUMBER_DIGITS, tabNumbers } from '../src/runtime/tabNumbers';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Tab numbers while Ctrl/Cmd is held label what Ctrl/Cmd+1…9 do (desktop/shortcuts.cjs → main's `select-tab`). The numbering must
// never disagree with the key, so the main half of these tests runs the real resolver.
const { resolveDefaultShortcut } = createRequire(import.meta.url)('../desktop/shortcuts.cjs') as { resolveDefaultShortcut(input: Record<string, unknown>, platform: string): { action: string; index?: number } | null };
const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
function withTabs(count: number, vertical = true): BrowserSnapshot {
  const state = createInitialState(), profile = state.activeBrowserProfileId;
  const tabs = Array.from({ length: count }, (_, i) => makeTab('t' + (i + 1), '', `https://t${i + 1}.test/`, profile));
  return { ...state, tabs, activeTabId: tabs[0]?.id ?? '', settings: { ...state.settings, verticalTabs: vertical } };
}
const labels = (numbers: Map<string, number>) => [...numbers].map(([id, digit]) => `${id}=${digit}`);

/** What a Ctrl (Windows, Linux) or Cmd (macOS) chord with this digit runs, taken from the real resolver, then main's `select-tab` expression. */
function chordTarget(state: BrowserSnapshot, digit: number, platform: 'darwin' | 'win32' | 'linux') {
  const mac = platform === 'darwin', command = resolveDefaultShortcut({ type: 'keyDown', key: String(digit), code: 'Digit' + digit, shift: false, alt: false, control: !mac, meta: mac }, platform);
  if (!command || command.action !== 'select-tab') return null;
  const here = listedTabs(state), index = command.index as number;
  return index < 0 ? here.at(-1) : here[index];
}

test('a few tabs: each shows its place, and the last tab does not repeat itself as 9', () => {
  assert.deepEqual(labels(tabNumbers(withTabs(3))), ['t1=1', 't2=2', 't3=3']);
  assert.deepEqual(labels(tabNumbers(withTabs(7))), ['t1=1', 't2=2', 't3=3', 't4=4', 't5=5', 't6=6', 't7=7']);
  assert.deepEqual(labels(tabNumbers(withTabs(1))), ['t1=1']);
  assert.equal(tabNumbers(withTabs(0)).size, 0);
});

test('nine tabs and more: 1–8 are the first eight, 9 is the LAST tab, the ones in between have no number', () => {
  assert.deepEqual(labels(tabNumbers(withTabs(8))), Array.from({ length: 8 }, (_, i) => `t${i + 1}=${i + 1}`));
  assert.equal(tabNumbers(withTabs(9)).get('t9'), 9, 'the ninth tab is also the last');
  const twelve = tabNumbers(withTabs(12));
  assert.equal(twelve.get('t8'), 8);
  assert.equal(twelve.get('t12'), 9, 'Ctrl+9 goes to the last tab, not the ninth');
  for (const id of ['t9', 't10', 't11']) assert.equal(twelve.has(id), false, `${id} has no key`);
  assert.equal(twelve.size, 9);
});

test('the numbers are exactly what the real Ctrl/Cmd+digit chord does, on every platform, for every tab count', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) for (let count = 0; count <= 14; count++) for (const vertical of [true, false]) {
    const state = withTabs(count, vertical), numbers = tabNumbers(state);
    for (const digit of TAB_NUMBER_DIGITS) {
      const target = chordTarget(state, digit, platform);
      if (target) assert.ok(numbers.get(target.id) !== undefined && numbers.get(target.id)! <= digit, `${platform}: digit ${digit} of ${count} reaches ${target.id}, which must carry a number`);
    }
    // And no tab shows a number whose chord goes somewhere else.
    for (const [id, digit] of numbers) assert.equal(chordTarget(state, digit, platform)?.id, id, `${platform}: ${id} shows ${digit} of ${count}`);
  }
});

test('Cmd is the macOS key, Ctrl+digit on a Mac is a workspace (so the labels are only ever for the tab chord)', () => {
  const state = withTabs(4);
  assert.equal(chordTarget(state, 2, 'darwin')?.id, 't2');
  const macCtrl = resolveDefaultShortcut({ type: 'keyDown', key: '2', code: 'Digit2', shift: false, alt: false, control: true, meta: false }, 'darwin');
  assert.equal(macCtrl?.action, 'switch-workspace');
});

test('favorites: a favorite\'s own tab stays in the list (sidebar and strip), so it is numbered by its place, exactly as the chord reaches it', () => {
  const base = withTabs(3);
  const favorite = run(base, { type: 'tab.new', url: 'https://www.youtube.com/', browserProfileId: base.activeBrowserProfileId, favoriteId: 'app-yt' });
  const own = favorite.tabs.find(tab => tab.favoriteId === 'app-yt')!.id;
  for (const verticalTabs of [true, false]) {
    const state = run(favorite, { type: 'settings.update', patch: { verticalTabs } }), numbers = tabNumbers(state);
    assert.deepEqual(listedTabs(state).map(tab => numbers.get(tab.id)), listedTabs(state).map((_, i) => i + 1), 'numbered by place');
    assert.equal(numbers.get(own), 4, 'the favorite\'s tab is listed last');
    assert.equal(chordTarget(state, 4, 'darwin')?.id, own, 'and Cmd+4 goes there');
  }
  const many = run(withTabs(11), { type: 'tab.new', url: 'https://www.youtube.com/', browserProfileId: base.activeBrowserProfileId, favoriteId: 'app-yt' }, { type: 'settings.update', patch: { verticalTabs: true } });
  const ownMany = many.tabs.find(tab => tab.favoriteId === 'app-yt')!.id;
  assert.equal(tabNumbers(many).get(ownMany), 9, 'the last listed tab is 9');
  assert.equal(tabNumbers(many).has('t11'), false);
});

test('pinned tabs and grouped tabs count by their place in the list; a tab in a collapsed group keeps its number', () => {
  let state = withTabs(6);
  state = run(state, { type: 'tab.group.create', tabId: 't3', name: 'Work' });
  const group = state.tabGroups[0].id;
  state = run(state, { type: 'tab.group.assign', tabIds: ['t4'], groupId: group });
  state = run(state, { type: 'tab.group.update', id: group, patch: { collapsed: true } });
  const numbers = tabNumbers(state), order = listedTabs(state).map(tab => tab.id);
  assert.deepEqual(order.map(id => numbers.get(id)), order.map((_, i) => i + 1), 'every tab, grouped or not, is numbered by its place in listedTabs');
  assert.ok(numbers.has('t3') && numbers.has('t4'), 'the collapsed group\'s tabs are still reached by the key');
  // Pinning moves the tab to the front of the list (the sidebar draws pinned tabs first): it is Ctrl+1.
  state = run(state, { type: 'tab.pin', id: 't6' });
  assert.equal(state.tabs.find(tab => tab.id === 't6')?.pinned, true);
  const after = tabNumbers(state);
  assert.equal(after.get('t6'), 1);
  assert.deepEqual(listedTabs(state).map(tab => after.get(tab.id)), listedTabs(state).map((_, i) => i + 1));
});

test('only the open workspace\'s tabs count, as the shortcut does', () => {
  let state = withTabs(4);
  state = run(state, { type: 'workspace.create', name: 'Work' });
  const here = listedTabs(state).map(tab => tab.id);
  assert.ok(here.length < 5 && !here.includes('t1'), 'the new workspace starts with its own tab');
  assert.deepEqual([...tabNumbers(state).keys()], here);
});

test('a key the person moved shows no number: only digits whose chord still runs select-tab are drawn', () => {
  const state = withTabs(5);
  assert.deepEqual(labels(tabNumbers(state, [1, 2, 3, 4, 5])), ['t1=1', 't2=2', 't3=3', 't4=4', 't5=5']);
  assert.deepEqual(labels(tabNumbers(state, [2, 4])), ['t2=2', 't4=4']);
  assert.equal(tabNumbers(state, []).size, 0);
  const twelve = withTabs(12);
  assert.equal(tabNumbers(twelve, [1, 2, 3, 4, 5, 6, 7, 8]).has('t12'), false, 'with Ctrl+9 moved the last tab is not "9"');
  assert.equal(tabNumbers(twelve, [9]).get('t12'), 9);
});

test('main\'s select-tab is still the expression the numbers copy, and main feeds the hold from every page', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /case 'select-tab':\{const here=listedTabs\(state\),target=command\.index<0\?here\.at\(-1\):here\[command\.index\]/, 'change runtime/tabNumbers.ts with it');
  assert.match(main, /function shortcut\(wc,event,input,menuCommand,origin=[^)]*\)\{\n if\(input&&!authActive&&!shortcutRegistry\?\.isRecording\(\)\)tabNumberHold\.note\(input\);/, 'every page and the interface report their keys to the hold');
  assert.match(main, /mainWindow\.on\('blur',\(\)=>tabNumberHold\.cancel\(\)\)/, 'the numbers go when the window loses focus');
  assert.match(main, /if\(input\.type==='mouseWheel'\)tabNumberHold\.interrupt\(\)/, 'Ctrl+wheel zooms the page: no numbers');
  // The numbers are a label: they never reveal a hidden sidebar and never ask for focus.
  const hold = readFileSync(new URL('../desktop/tab-numbers.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(hold + readFileSync(new URL('../src/ui/tabNumbers.ts', import.meta.url), 'utf8'), /\.focus\(|reveal/);
});
