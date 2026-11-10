// 13.5, Sidebar + address in Full: the sidebar stays open under ANY sequence of actions (no errors, glitches or crashes). Seeded random sequences of every action that can touch the
// sidebar's open state, the window's view, the layout or the tabs, checked after each step against the one rule, plus the same sequences through a save and restore, plus the places where the
// sidebar is still allowed to close (checked against a model of the old rules, so the fix cannot have changed them). Deterministic: the seeds are fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { effectiveView, patchKeepingSidebarOpen, sidebarHeldOpen, withSidebarHeldOpen, type WindowView } from '../src/runtime/windowView';
import { workspaceIsOpen } from '../src/runtime/browserChrome';
import { sidebarControl } from '../src/ui/layoutMode';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const VIEWS: (WindowView | null)[] = ['full', 'compact', 'focus', 'seamless', null];
const URLS = ['https://harbor.dev/docs', 'https://atlas.so/wiki', 'acira://settings', 'acira://history', 'acira://new'];

function actions(random: () => number, s: BrowserSnapshot): BrowserAction {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const bool = () => random() < 0.5;
  switch (Math.floor(random() * 16)) {
    case 0: return { type: 'ui.update', patch: { workspaceOpen: bool(), webWorkspaceOpen: bool() } };
    case 1: return { type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } };
    case 2: return { type: 'ui.update', patch: { workspaceOpen: bool() } };
    case 3: return { type: 'ui.update', patch: { webWorkspaceOpen: bool() } };
    case 4: return { type: 'ui.update', patch: { view: pick(VIEWS) } };
    case 5: return { type: 'ui.update', patch: { view: pick(VIEWS), workspaceOpen: bool(), webWorkspaceOpen: bool() } };
    case 6: return { type: 'ui.update', patch: { focusMode: bool() } };
    case 7: return { type: 'settings.update', patch: { windowView: pick(['full', 'compact', 'focus', 'seamless'] as const) } };
    case 8: return { type: 'settings.update', patch: { verticalTabs: bool() } };
    case 9: return { type: 'settings.update', patch: { addressInSidebar: bool() } };
    case 10: return { type: 'sidebar.mode', tabs: bool(), address: bool(), ...(random() < 0.5 ? { open: bool() } : {}) };
    case 11: return { type: 'tab.new', url: pick(URLS) };
    case 12: return { type: 'tab.select', id: pick(s.tabs).id };
    case 13: return { type: 'tab.close', id: pick(s.tabs).id };
    case 14: return { type: 'tab.navigate', tabId: s.activeTabId, url: pick(URLS) } as BrowserAction;
    default: return { type: 'settings.update', patch: { windowView: pick(['full', 'seamless'] as const), verticalTabs: true, addressInSidebar: bool() } };
  }
}
const held = (s: BrowserSnapshot) => sidebarHeldOpen(s.settings, effectiveView(s.settings, s.windowUi));
const bothOpen = (s: BrowserSnapshot) => s.windowUi.workspaceOpen && s.windowUi.webWorkspaceOpen;

test('300 random sequences of 60 actions: whenever Sidebar + address is in Full the sidebar is open, for every tab, after every step', () => {
  let steps = 0, heldSteps = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const random = rng(seed);
    let s = createInitialState();
    s = { ...s, settings: { ...s.settings, verticalTabs: random() < 0.7, addressInSidebar: random() < 0.7, windowView: VIEWS[Math.floor(random() * 4)] as WindowView }, windowUi: { ...s.windowUi, workspaceOpen: random() < 0.5, webWorkspaceOpen: random() < 0.5 } };
    for (let i = 0; i < 60; i++) {
      const action = actions(random, s);
      let next: BrowserSnapshot;
      try { next = reduceBrowser(s, action); } catch (error) { assert.fail(`seed ${seed} step ${i} ${JSON.stringify(action)} threw ${error}`); }
      steps++;
      if (held(next)) {
        heldSteps++;
        assert.equal(bothOpen(next), true, `seed ${seed} step ${i}: ${JSON.stringify(action)} left the sidebar closed in Sidebar + address (${effectiveView(next.settings, next.windowUi)})`);
        for (const tab of next.tabs) assert.equal(workspaceIsOpen(next.windowUi, tab), true, `seed ${seed} step ${i}: closed for ${tab.contentKind} tab`);
        assert.equal(sidebarControl(next).visible, false, `seed ${seed} step ${i}: the button is offered`);
      }
      s = next;
    }
  }
  assert.ok(steps === 18000 && heldSteps > 3000, `the sequences spend real time in the layout (${heldSteps} of ${steps} steps)`);
});

test('the same sequences through a save and a restore (a restart, or another window loading the state): the rule holds and nothing else moves', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const random = rng(1000 + seed);
    let s = createInitialState();
    for (let i = 0; i < 40; i++) {
      s = reduceBrowser(s, actions(random, s));
      if (i % 7 !== 6) continue;
      const restored = restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s))));
      if (held(restored)) assert.equal(bothOpen(restored), true, `seed ${seed} step ${i}: restored closed`);
      assert.equal(restored.windowUi.view, s.windowUi.view, 'the window\'s own view survives a restore');
      assert.equal(restored.settings.verticalTabs, s.settings.verticalTabs);
      assert.equal(restored.settings.addressInSidebar, s.settings.addressInSidebar);
      // a state that was legal before the save is not changed by it
      if (!held(s)) assert.deepEqual([restored.windowUi.workspaceOpen, restored.windowUi.webWorkspaceOpen], [s.windowUi.workspaceOpen, s.windowUi.webWorkspaceOpen], `seed ${seed} step ${i}: a closable sidebar keeps its state through a restart`);
    }
  }
});

test('where the sidebar may close, the old rules apply to the letter (model of 13.4: the patch is the state)', () => {
  const layouts: [boolean, boolean, WindowView][] = [[true, false, 'full'], [true, false, 'compact'], [true, false, 'focus'], [true, false, 'seamless'], [false, false, 'full'], [false, true, 'full'], [true, true, 'seamless']];
  for (const [verticalTabs, addressInSidebar, view] of layouts) for (const workspaceOpen of [true, false]) for (const webWorkspaceOpen of [true, false]) for (const [w, v] of [[true, true], [false, false], [true, false], [false, true]]) {
    const base = createInitialState();
    const s: BrowserSnapshot = { ...base, settings: { ...base.settings, verticalTabs, addressInSidebar, windowView: view }, windowUi: { ...base.windowUi, view, focusMode: view === 'focus', workspaceOpen, webWorkspaceOpen } };
    assert.equal(held(s), false);
    const next = reduceBrowser(s, { type: 'ui.update', patch: { workspaceOpen: w, webWorkspaceOpen: v } });
    assert.deepEqual([next.windowUi.workspaceOpen, next.windowUi.webWorkspaceOpen], [w, v], `${verticalTabs}/${addressInSidebar}/${view}: patch ${w}/${v} on ${workspaceOpen}/${webWorkspaceOpen}`);
    assert.equal(sidebarControl(next).visible, verticalTabs && view !== 'seamless', 'the button as it was');
  }
});

test('the patch filter: only closing keys ever go, nothing is added, an untouched patch is the same object, and applying it never closes a held sidebar', () => {
  const random = rng(77);
  for (let i = 0; i < 4000; i++) {
    let s = createInitialState();
    s = { ...s, settings: { ...s.settings, verticalTabs: random() < 0.8, addressInSidebar: random() < 0.8, windowView: VIEWS[Math.floor(random() * 4)] as WindowView }, windowUi: { ...s.windowUi, view: random() < 0.6 ? (VIEWS[Math.floor(random() * 4)] as WindowView) : undefined } };
    const patch: Record<string, unknown> = {};
    for (const key of ['workspaceOpen', 'webWorkspaceOpen'] as const) if (random() < 0.6) patch[key] = random() < 0.5;
    if (random() < 0.4) patch.view = VIEWS[Math.floor(random() * 5)];
    if (random() < 0.2) patch.focusMode = random() < 0.5;
    const kept = patchKeepingSidebarOpen(s.settings, s.windowUi, patch as never) as Record<string, unknown>;
    for (const key of Object.keys(kept)) assert.ok(key in patch && kept[key] === patch[key], `${key} only ever comes through unchanged`);
    for (const key of Object.keys(patch)) if (!(key in kept)) assert.ok((key === 'workspaceOpen' || key === 'webWorkspaceOpen') && patch[key] === false, `${key}=${String(patch[key])} must not be dropped`);
    if (Object.keys(kept).length === Object.keys(patch).length) assert.equal(kept, patch, 'nothing to take out: the very same object');
    // the filtered patch, applied the way the renderer's optimistic draw applies it, then the reducer's rule: never a closed held sidebar; and the reducer alone gives the same answer
    const viaFilter = reduceBrowser(s, { type: 'ui.update', patch: kept as never }), direct = reduceBrowser(s, { type: 'ui.update', patch: patch as never });
    assert.deepEqual([viaFilter.windowUi.workspaceOpen, viaFilter.windowUi.webWorkspaceOpen], [direct.windowUi.workspaceOpen, direct.windowUi.webWorkspaceOpen], `the filter and the reducer agree for ${JSON.stringify(patch)}`);
  }
});

test('withSidebarHeldOpen is idempotent, returns the same object when there is nothing to do, and never touches another field', () => {
  const base = createInitialState();
  const on = { ...base.settings, verticalTabs: true, addressInSidebar: true, windowView: 'full' as WindowView };
  const closed = { ...base.windowUi, view: 'full' as WindowView, workspaceOpen: false, webWorkspaceOpen: true, zoomTargetTabId: 'x', lastTabs: { a: 'b' } };
  const opened = withSidebarHeldOpen(on, closed);
  assert.deepEqual({ ...opened, workspaceOpen: false }, { ...closed, workspaceOpen: false }, 'only the two flags');
  assert.equal(opened.workspaceOpen && opened.webWorkspaceOpen, true);
  assert.equal(withSidebarHeldOpen(on, opened), opened, 'idempotent');
  const seamless = { ...closed, view: 'seamless' as WindowView };
  assert.equal(withSidebarHeldOpen(on, seamless), seamless, 'Seamless: the same object');
  assert.equal(withSidebarHeldOpen({ ...on, addressInSidebar: false }, closed), closed, 'Sidebar-only: the same object');
});
