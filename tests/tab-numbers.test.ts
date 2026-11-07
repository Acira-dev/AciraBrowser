import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInitialState, makeTab, reduceBrowser } from '../src/runtime/core';
import { listedTabs } from '../src/runtime/favoriteTabs';
import { TAB_NUMBER_DIGITS, tabNumberMatches, tabNumbers } from '../src/runtime/tabNumbers';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Tab numbers while Ctrl/Cmd is held label what Ctrl/Cmd+1…9 do (desktop/shortcuts.cjs → main's `select-tab`). The numbering must
// never disagree with the key, so the main half of these tests runs the real resolver.
const nodeRequire = createRequire(import.meta.url);
const { resolveDefaultShortcut, shortcutKey } = nodeRequire('../desktop/shortcuts.cjs') as { resolveDefaultShortcut(input: Record<string, unknown>, platform: string): { action: string; index?: number } | null; shortcutKey(input: Record<string, unknown>): string };
const { createTabNumberHold } = nodeRequire('../desktop/tab-numbers.cjs') as { createTabNumberHold(options: Record<string, unknown>): { note(input: Record<string, unknown>): string | undefined; readonly typed: number | null } };
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

test('nine tabs: 1–8 are their own key and the ninth is also the last tab, 9', () => {
  assert.deepEqual(labels(tabNumbers(withTabs(8))), Array.from({ length: 8 }, (_, i) => `t${i + 1}=${i + 1}`));
  assert.equal(tabNumbers(withTabs(9)).get('t9'), 9, 'the ninth tab is also the last');
  assert.equal(tabNumbers(withTabs(9)).size, 9);
});

test('ten tabs and more: every tab to the ninety-ninth shows its own place (typed as two digits), tab 9 has none, the last of a hundred is 9', () => {
  const ten = tabNumbers(withTabs(10));
  assert.equal(ten.get('t10'), 10, 'the last of ten is 10, not 9: 1 then 0');
  assert.equal(ten.has('t9'), false, 'no key reaches the ninth of ten tabs: Ctrl+9 alone is the last');
  assert.equal(ten.size, 9);
  const twelve = tabNumbers(withTabs(12));
  assert.deepEqual([...twelve].map(([id, n]) => `${id}=${n}`), ['t1=1', 't2=2', 't3=3', 't4=4', 't5=5', 't6=6', 't7=7', 't8=8', 't10=10', 't11=11', 't12=12']);
  const many = tabNumbers(withTabs(120));
  assert.equal(many.get('t15'), 15);
  assert.equal(many.get('t99'), 99);
  assert.equal(many.has('t100'), false, 'three digits are not typed');
  assert.equal(many.get('t120'), 9, 'the last tab, which has no two-digit place, is still Ctrl+9');
  assert.equal(many.size, 8 + 90 + 1);
});

test('a typed first digit highlights the places it can still lead to: 1 → 10…19, nothing under ten', () => {
  assert.deepEqual([1, 5, 8, 9, 10, 15, 19, 20, 99].map(n => tabNumberMatches(n, 1)), [false, false, false, false, true, true, true, false, false]);
  assert.deepEqual([9, 90, 99, 100].map(n => tabNumberMatches(n, 9)), [false, true, true, false]);
});

/** The real hold, driven with the real resolver: type these keys under the platform's modifier and let go; which listed tab did it select? */
function typeDigits(state: BrowserSnapshot, platform: 'darwin' | 'win32' | 'linux', digits: string, release = true) {
  const mac = platform === 'darwin', flags = mac ? { meta: true } : { control: true };
  let selected: string | null = null, now = 0, next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const hold = createTabNumberHold({
    platform,
    isNumberKey: (input: Record<string, unknown>) => resolveDefaultShortcut(input, platform)?.action === 'select-tab',
    digitOf: (input: Record<string, unknown>) => /^[0-9]$/.test(shortcutKey(input)) ? Number(shortcutKey(input)) : -1,
    naturalDigit: (input: Record<string, unknown>) => { const key = shortcutKey(input), found = resolveDefaultShortcut(input, platform); return /^[1-9]$/.test(key) && found?.action === 'select-tab' && found.index === (key === '9' ? -1 : Number(key) - 1) ? Number(key) : -1; },
    tabCount: () => listedTabs(state).length,
    select: (position: number) => { const here = listedTabs(state); selected = (position < 0 ? here.at(-1) : here[position - 1])?.id ?? null; },
    onChange: () => {},
    setTimer: (fn: () => void, ms: number) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id: number) => { timers.delete(id); },
  });
  const key = (type: string, k: string, extra: Record<string, unknown> = {}) => hold.note({ type, key: k, code: /^\d$/.test(k) ? 'Digit' + k : '', shift: false, alt: false, control: false, meta: false, isAutoRepeat: false, ...extra });
  key('keyDown', mac ? 'Meta' : 'Control', flags);
  const verdicts: Array<string | undefined> = [];
  for (const digit of digits) {
    const verdict = key('keyDown', digit, flags);
    verdicts.push(verdict);
    // What main does with the key: a first digit that waits runs nothing, a second digit was acted on by the hold, any other select-tab chord goes to its tab at once.
    if (verdict !== 'wait' && verdict !== 'taken') { const command = resolveDefaultShortcut({ type: 'keyDown', key: digit, code: 'Digit' + digit, shift: false, alt: false, control: !mac, meta: mac }, platform); if (command?.action === 'select-tab') { const here = listedTabs(state); selected = (command.index! < 0 ? here.at(-1) : here[command.index!])?.id ?? null; } }
    key('keyUp', digit, flags);
  }
  const before = selected;
  if (release) key('keyUp', mac ? 'Meta' : 'Control');
  return { selected, selectedBeforeRelease: before, verdicts };
}

test('the numbers are exactly what the real Ctrl/Cmd+digits do, on every platform, for every tab count: type a tab\'s figure and you land on that tab', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) for (const count of [0, 1, 3, 8, 9, 10, 11, 12, 19, 20, 21, 35, 98, 99, 100, 120]) for (const vertical of [true, false]) {
    const state = withTabs(count, vertical), numbers = tabNumbers(state);
    for (const [id, figure] of numbers) {
      const result = typeDigits(state, platform, String(figure));
      assert.equal(result.selected, id, `${platform}: typing ${figure} of ${count} tabs must land on ${id}`);
    }
    // Every tab from the tenth to the ninety-ninth carries the figure that reaches it.
    for (let n = 10; n <= Math.min(count, 99); n++) assert.equal(numbers.get('t' + n), n, `${platform}: tab ${n} of ${count} is labelled ${n}`);
    // A single digit, as before: Cmd+d goes to tab d (9 = the last), whether the hold waited for a second digit or not.
    for (const digit of TAB_NUMBER_DIGITS) {
      const expected = chordTarget(state, digit, platform), result = typeDigits(state, platform, String(digit));
      assert.equal(result.selected, expected?.id ?? null, `${platform}: Cmd/Ctrl+${digit} alone of ${count} tabs still goes where it always did`);
      if (digit * 10 > count) assert.equal(result.selectedBeforeRelease, expected?.id ?? null, `${platform}: with ${count} tabs ${digit} acts at once (no tab ${digit}0 to wait for)`);
      else assert.equal(result.selectedBeforeRelease, null, `${platform}: with ${count} tabs ${digit} waits for a second digit`);
    }
    for (const [id, digit] of numbers) if (digit < 10) assert.equal(chordTarget(state, digit, platform)?.id, id, `${platform}: ${id} shows ${digit} of ${count}`);
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
  assert.equal(tabNumbers(many).get(ownMany), 12, 'the last listed tab is the twelfth');
  assert.equal(tabNumbers(many).get('t11'), 11);
  assert.equal(typeDigits(many, 'darwin', '12').selected, ownMany, 'and 1 then 2 goes there');
  assert.equal(typeDigits(many, 'darwin', '9').selected, ownMany, 'as does Cmd+9');
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
  assert.equal(tabNumbers(twelve, [2, 3, 4, 5, 6, 7, 8]).has('t12'), false, 'with 1 and 9 moved nothing reaches the twelfth tab');
  assert.equal(tabNumbers(twelve, [2, 3, 4, 5, 6, 7, 8]).has('t10'), false);
  assert.equal(tabNumbers(twelve, [9]).get('t12'), 9, 'with only Ctrl+9 left the last tab is "9"');
  assert.equal(tabNumbers(twelve, [1, 2]).get('t12'), 12, 'two digits need only the first digit\'s chord');
  assert.equal(tabNumbers(twelve, [1, 2]).has('t3'), false);
});

test('main\'s select-tab is still the expression the numbers copy, and main feeds the hold from every page', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /case 'select-tab':\{const here=listedTabs\(state\),target=command\.index<0\?here\.at\(-1\):here\[command\.index\];if\(noted==='wait'\)hearKeyUps\(wc\);else if\(target\)\{dispatch\(\{type:'tab\.select',id:target\.id\}\);\}/, 'change runtime/tabNumbers.ts with it; a first digit that waits runs nothing but the key-up helper');
  assert.match(main, /function shortcut\(wc,event,input,menuCommand,origin=[^)]*\)\{\n const noted=input&&!authActive&&!shortcutRegistry\?\.isRecording\(\)\?tabNumberHold\.note\(input\):undefined;/, 'every page and the interface report their keys to the hold');
  assert.match(main, /if\(noted==='taken'\)\{event\?\.preventDefault\(\);return;\}/, 'the second digit of a two-digit number runs nothing else (Ctrl+0 is the zoom reset)');
  assert.equal((main.match(/if\(mouse\.type==='mouseDown'\)tabNumberHold\.abandon\(\)/g) || []).length, 2, 'a click in a page or in the interface drops a waiting digit');
  assert.match(main, /owner=noted==='flushed'\?null:pageOwner\(pages,wc\)/, 'a digit sent to its tab by the next key must not pull the old page back');
  assert.match(main, /select:position=>\{const here=listedTabs\(state\),target=position<0\?here\.at\(-1\):here\[position-1\]/, 'the two-digit number picks from the same list');
  assert.match(main, /mainWindow\.on\('blur',\(\)=>tabNumberHold\.cancel\(\)\)/, 'the numbers go when the window loses focus');
  assert.match(main, /if\(input\.type==='mouseWheel'\)tabNumberHold\.interrupt\(\)/, 'Ctrl+wheel zooms the page: no numbers');
  // The numbers are a label: they never reveal a hidden sidebar and never ask for focus.
  const hold = readFileSync(new URL('../desktop/tab-numbers.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(hold + readFileSync(new URL('../src/ui/tabNumbers.ts', import.meta.url), 'utf8'), /\.focus\(|reveal/);
});
