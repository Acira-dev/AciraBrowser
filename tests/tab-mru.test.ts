import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ctrlTabModeFrom, markSwitcherReleased, mruOrder, nextInCycle, readSwitcherOpenedAt, stampActivation, switcherIndex, switcherReleasedSince, tabCycleOrder, writeSwitcherStart } from '../src/ui/tabMru';
import type { TabGroup } from '../src/runtime/types';

test('current tab first, then most recently used', () => {
  assert.deepEqual(mruOrder(['a', 'b', 'c', 'd'], 'c', { a: 10, b: 30, c: 40, d: 20 }), ['c', 'b', 'd', 'a']);
});

test('tabs never activated follow in strip order after used ones', () => {
  assert.deepEqual(mruOrder(['a', 'b', 'c', 'd', 'e'], 'a', { a: 5, d: 3 }), ['a', 'd', 'b', 'c', 'e']);
});

test('closed and foreign tabs are ignored; a missing active tab is skipped', () => {
  assert.deepEqual(mruOrder(['a', 'b'], 'x', { x: 99, b: 2, a: 1, z: 50 }), ['b', 'a']);
});

test('activating tabs in sequence yields that order reversed', () => {
  let stamps: Record<string, number> = {};
  ['a', 'b', 'c', 'b'].forEach((id, time) => { stamps = stampActivation(stamps, id, time); });
  assert.deepEqual(mruOrder(['a', 'b', 'c'], 'b', stamps), ['b', 'c', 'a']);
});

test('stamps are pruned to open tabs and capped', () => {
  const stamps = stampActivation({ old: 1, gone: 2 }, 'a', 3, new Set(['a', 'old']));
  assert.deepEqual(Object.keys(stamps).sort(), ['a', 'old']);
  let many: Record<string, number> = {};
  for (let i = 0; i < 450; i++) many = stampActivation(many, 't' + i, i);
  assert.equal(Object.keys(many).length, 400);
  assert.ok(many.t449 !== undefined && many.t0 === undefined);
});

test('Tab and Shift+Tab wrap around the list', () => {
  assert.equal(switcherIndex(5, 1, 1), 2);
  assert.equal(switcherIndex(5, 1, 4), 0);
  assert.equal(switcherIndex(5, 0, -1), 4);
  assert.equal(switcherIndex(0, 3, 2), 0);
});

test('Ctrl+Tab defaults to the next tab; old and unknown choices migrate to it', () => {
  assert.equal(ctrlTabModeFrom(null), 'next');
  assert.equal(ctrlTabModeFrom('strip'), 'next');
  assert.equal(ctrlTabModeFrom('garbage'), 'next');
  assert.equal(ctrlTabModeFrom('recent'), 'recent');
  assert.equal(ctrlTabModeFrom('viewer'), 'viewer');
});

const tab = (id: string, extra: { pinned?: boolean; group?: string; browserProfileId?: string } = {}) => ({ id, pinned: !!extra.pinned, group: extra.group || '', browserProfileId: extra.browserProfileId || 'p' });
const group = (name: string, collapsed = false): TabGroup => ({ id: 'g-' + name, name, color: 'blue', collapsed, browserProfileId: 'p' });

test('top tabs: pinned first, then strip order; Ctrl+Tab and Ctrl+Shift+Tab wrap', () => {
  const tabs = [tab('a'), tab('pin', { pinned: true }), tab('b'), tab('c')];
  const order = tabCycleOrder(tabs, [], 'a', false);
  assert.deepEqual(order, ['pin', 'a', 'b', 'c']);
  assert.equal(nextInCycle(order, 'a', 1), 'b');
  assert.equal(nextInCycle(order, 'c', 1), 'pin');
  assert.equal(nextInCycle(order, 'pin', -1), 'c');
});

test('collapsed groups are skipped, open groups are walked, the current tab is never skipped', () => {
  const tabs = [tab('a'), tab('x1', { group: 'Work' }), tab('x2', { group: 'Work' }), tab('y1', { group: 'Read' }), tab('b')];
  const groups = [group('Work', true), group('Read')];
  assert.deepEqual(tabCycleOrder(tabs, groups, 'a', false), ['a', 'y1', 'b']);
  assert.equal(nextInCycle(tabCycleOrder(tabs, groups, 'a', false), 'a', 1), 'y1');
  assert.deepEqual(tabCycleOrder(tabs, groups, 'x2', false), ['a', 'x2', 'y1', 'b']);
});

test('sidebar tabs: this profile only, pinned first, then tab order with each group at its first tab', () => {
  const tabs = [tab('a'), tab('g1', { group: 'Work' }), tab('other', { browserProfileId: 'q' }), tab('pin', { pinned: true }), tab('b'), tab('g2', { group: 'Work' })];
  assert.deepEqual(tabCycleOrder(tabs, [group('Work')], 'a', true), ['pin', 'a', 'g1', 'g2', 'b']);
  assert.deepEqual(tabCycleOrder(tabs, [group('Work', true)], 'a', true), ['pin', 'a', 'b']);
  assert.deepEqual(tabCycleOrder(tabs, [group('Work', true)], 'g2', true), ['pin', 'a', 'g2', 'b'], 'a collapsed group keeps the current tab');
});

test('from a tab outside the order Ctrl+Tab lands on the first tab, Ctrl+Shift+Tab on the last; nothing to cycle is a no-op', () => {
  assert.equal(nextInCycle(['a', 'b'], 'gone', 1), 'a');
  assert.equal(nextInCycle(['a', 'b'], 'gone', -1), 'b');
  assert.equal(nextInCycle([], 'a', 1), undefined);
});

// QA audit: Ctrl let go just after the 120ms delay before the switcher shows reached the chrome view while the overlay was not mounted yet, so the
// overlay opened with nothing left to wait for and stayed up. The chrome view now leaves a mark the overlay reads as it mounts.
test('a Control release after the switcher was asked for is seen by an overlay that mounts later', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  try {
    writeSwitcherStart(1); const openedAt = readSwitcherOpenedAt();
    assert.ok(openedAt > 0);
    assert.equal(switcherReleasedSince(openedAt), false, 'still held: the overlay waits for the release itself');
    markSwitcherReleased(openedAt + 8);
    assert.equal(switcherReleasedSince(openedAt, openedAt + 20), true, 'released before the overlay mounted: it switches at once');
    writeSwitcherStart(2); const later = readSwitcherOpenedAt() + 1000;
    store.set('acira-tab-switcher-open', JSON.stringify({ start: 2, at: later }));
    assert.equal(switcherReleasedSince(later), false, 'a release from an earlier use never ends the next one');
    markSwitcherReleased(later - 1);
    assert.equal(switcherReleasedSince(later, later + 5), false);
    markSwitcherReleased(later + 3);
    assert.equal(switcherReleasedSince(later, later + 6000), false, 'a mark that old is ignored');
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});

// QA audit (second half of the same bug): a switcher that was up for only a few tens of ms came back after it was closed, because the tab change
// (tab.select) reached the chrome view before the overlay's close did, and the chrome view sent a layout that still held the switcher.
test('the switcher closes first and then switches, so the tab change never meets a layout that still holds the switcher', () => {
  const source = fs.readFileSync(new URL('../src/components/sidebar/TabSwitcher.tsx', import.meta.url), 'utf8');
  const commit = source.slice(source.indexOf('const commit='), source.indexOf('const cancel='));
  assert.ok(commit.indexOf('close()') > -1 && commit.indexOf('close()') < commit.indexOf("dispatch({type:'tab.select'"), 'close() comes before the tab.select dispatch');
});
