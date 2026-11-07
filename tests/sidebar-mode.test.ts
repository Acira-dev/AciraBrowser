import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/runtime/core';
import { readRailPrefs } from '../src/ui/railPrefs';
import { setSidebarMode, sidebarModeOn, sidebarModePlan } from '../src/ui/sidebarMode';
import type { BrowserAction } from '../src/runtime/types';

// Sidebar mode (Arc, Zen): tabs in the sidebar and the address bar in the sidebar, together, in one step; off goes back to what the person had.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
});

test('it reads as on exactly when tabs and the address bar are both in the sidebar', () => {
  assert.equal(sidebarModeOn({ verticalTabs: true, addressInSidebar: true }), true);
  for (const settings of [{}, { verticalTabs: true }, { addressInSidebar: true }, { verticalTabs: false, addressInSidebar: true }, { verticalTabs: true, addressInSidebar: false }]) assert.equal(sidebarModeOn(settings), false, JSON.stringify(settings));
});

test('turning it on sets both and remembers what was there; turning it off puts that back', () => {
  for (const start of [{ tabs: false, address: false }, { tabs: true, address: false }, { tabs: false, address: true }]) {
    const on = sidebarModePlan(start, true);
    assert.deepEqual(on.set, { tabs: true, address: true });
    assert.deepEqual(on.remember, start);
    const off = sidebarModePlan(on.set, false, on.remember ?? undefined);
    assert.deepEqual(off.set, start, JSON.stringify(start));
    assert.equal(off.remember, null, 'the memory is spent');
  }
});

test('with nothing remembered (both turned on by hand) off takes the address bar back to the toolbar and keeps the tabs where they are', () => {
  assert.deepEqual(sidebarModePlan({ tabs: true, address: true }, false).set, { tabs: true, address: false });
  // A memory that is itself "both on" would turn nothing off: it is ignored.
  assert.deepEqual(sidebarModePlan({ tabs: true, address: true }, false, { tabs: true, address: true }).set, { tabs: true, address: false });
});

test('turning it on while already in the mode keeps the memory it has', () => {
  assert.deepEqual(sidebarModePlan({ tabs: true, address: true }, true, { tabs: false, address: false }).remember, { tabs: false, address: false });
  assert.equal(sidebarModePlan({ tabs: true, address: true }, true).remember, null);
});

test('the switch is one action (both settings and the opening of a closed sidebar), and writes only the memory itself', () => {
  const state = createInitialState();
  const profile = state.tabs[0].browserProfileId;
  const sent: BrowserAction[] = [];
  const dispatch = (action: BrowserAction) => { sent.push(action); };
  state.windowUi = { ...state.windowUi, workspaceOpen: false, webWorkspaceOpen: false };
  setSidebarMode(state, dispatch, true);
  assert.deepEqual(sent, [{ type: 'sidebar.mode', tabs: true, address: true, open: true }], 'one action: one snapshot reaches every window, the morph never meets half a switch');
  assert.equal(readRailPrefs(profile, false).tabs, false, 'the profile\'s tabs switch follows the setting inside the morph (runtime/client.ts), not before it');
  assert.deepEqual(readRailPrefs(profile, false).sidebarModeBefore, { tabs: false, address: false });
  // Off, from the state it left: back to tabs along the top and the address bar in the toolbar.
  const on = { ...state, settings: { ...state.settings, verticalTabs: true, addressInSidebar: true } };
  sent.length = 0;
  setSidebarMode(on, dispatch, false);
  assert.deepEqual(sent, [{ type: 'sidebar.mode', tabs: false, address: false }]);
  assert.equal(readRailPrefs(profile, false).sidebarModeBefore, undefined, 'spent');
});

test('a private window keeps the memory in memory only', () => {
  const state = createInitialState();
  const base = state.browserProfiles[0];
  const priv = { ...base, id: 'profile-private', private: true };
  const tab = { ...state.tabs[0], browserProfileId: priv.id };
  const private_ = { ...state, browserProfiles: [...state.browserProfiles, priv], tabs: [tab], activeTabId: tab.id };
  setSidebarMode(private_, () => {}, true);
  assert.equal([...store.keys()].some((key) => key.includes('profile-private')), false, 'nothing in browser storage');
  assert.deepEqual(readRailPrefs(priv.id, true).sidebarModeBefore, { tabs: false, address: false });
});

test('the switch is in the three places and they share the one function', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const rows = read('../src/features/settings/SidebarRows.tsx'), panel = read('../src/features/settings/panels/sidebar.tsx'), settings = read('../src/features/BrowserSettings.tsx'), menu = read('../src/components/BrowserMenu.tsx'), app = read('../src/App.tsx');
  assert.match(rows, /setSidebarMode\(state, dispatch, on\)/);
  assert.ok(panel.indexOf('<SidebarModeRow') > panel.indexOf('id="sidebar"') && panel.indexOf('<SidebarModeRow') < panel.indexOf('id="sidebar-visible"'), 'first row of Tabs › Sidebar');
  const appearance = settings.slice(settings.indexOf('{section === "Appearance" &&'), settings.indexOf('{section === "Profiles" &&'));
  assert.ok(appearance.indexOf('<TabLayoutRow') < appearance.indexOf('<SidebarModeRow') && appearance.indexOf('<SidebarModeRow') < appearance.indexOf('id="window-view"'), 'Appearance › Layout: under the Tabs cards, above Window view');
  assert.match(menu, /<MenuToggle icon=\{PanelsTopLeft\} label=\{t\("sidebarmode\.title"\)\}/, 'the Acira menu row is the menu\'s own on/off row');
  assert.match(app, /setSidebarMode: \(on: boolean\) => \{ setSidebarMode\(state, dispatch, on\); close\(\);/, 'the Acira menu closes after the press: the whole window re-arranges and the menu would cover the sidebar');
});
