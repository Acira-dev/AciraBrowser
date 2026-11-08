import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState } from '../src/runtime/core';
import { readRailPrefs } from '../src/ui/railPrefs';
import { LOCALES } from '../src/i18n/locales';
import { morphDirection, setTabsLayout, shownView, sidebarModeOn, sidebarModePeekEvent, tabsLayoutOf, tabsLayoutSettings, tabsLayouts, viewsOfLayout, type TabsLayout } from '../src/ui/sidebarMode';
import type { BrowserAction, BrowserSnapshot } from '../src/runtime/types';

// Sidebar mode (Arc, Zen) is the third answer of the Tabs choice (beta.13, item 4): Along the top, In a sidebar, Sidebar + address. It is still two stored settings,
// verticalTabs and addressInSidebar, so nothing is migrated; the choice is read from them and writes both.
const store = new Map<string, string>();
const events: string[] = [];
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } },
  window: { dispatchEvent: (event: { type: string }) => { events.push(event.type); return true; }, addEventListener: () => {}, removeEventListener: () => {} },
  Event: class { constructor(public type: string) {} },
});

const withSettings = (state: BrowserSnapshot, settings: Record<string, unknown>, windowUi: Record<string, unknown> = {}): BrowserSnapshot => ({ ...state, settings: { ...state.settings, ...settings }, windowUi: { ...state.windowUi, ...windowUi } });
const run = (state: BrowserSnapshot, layout: TabsLayout) => { const sent: BrowserAction[] = []; setTabsLayout(state, (action) => { sent.push(action); }, layout); return sent; };

test('the mode reads as on exactly when tabs and the address bar are both in the sidebar', () => {
  assert.equal(sidebarModeOn({ verticalTabs: true, addressInSidebar: true }), true);
  for (const settings of [{}, { verticalTabs: true }, { addressInSidebar: true }, { verticalTabs: false, addressInSidebar: true }, { verticalTabs: true, addressInSidebar: false }]) assert.equal(sidebarModeOn(settings), false, JSON.stringify(settings));
});

test('existing settings map to a layout exactly, with no migration', () => {
  // verticalTabs off is Along the top, whatever addressInSidebar says (a leftover flag from the old switch included)
  for (const address of [undefined, false, true]) assert.equal(tabsLayoutOf({ verticalTabs: false, addressInSidebar: address }), 'top', `tabs off, address ${address}`);
  assert.equal(tabsLayoutOf({}), 'top');
  assert.equal(tabsLayoutOf({ addressInSidebar: true }), 'top');
  // verticalTabs on, the address bar off or never set: In a sidebar
  for (const address of [undefined, false]) assert.equal(tabsLayoutOf({ verticalTabs: true, addressInSidebar: address }), 'sidebar', `tabs on, address ${address}`);
  // both on (Sidebar mode on): Sidebar + address, the window it always was
  assert.equal(tabsLayoutOf({ verticalTabs: true, addressInSidebar: true }), 'sidebar-address');
  // and the layout reads back the same pair
  assert.deepEqual(tabsLayouts.map(tabsLayoutSettings), [{ tabs: false, address: false }, { tabs: true, address: false }, { tabs: true, address: true }]);
  for (const layout of tabsLayouts) { const { tabs, address } = tabsLayoutSettings(layout); assert.equal(tabsLayoutOf({ verticalTabs: tabs, addressInSidebar: address }), layout); }
});

test('moving the address bar into or out of the sidebar is one sidebar.mode action: the same morph Sidebar mode always played', () => {
  const closed = withSettings(createInitialState(), {}, { workspaceOpen: false, webWorkspaceOpen: false });
  assert.deepEqual(run(closed, 'sidebar-address'), [{ type: 'sidebar.mode', tabs: true, address: true, open: true }], 'one action: one snapshot reaches every window, and a closed sidebar opens with the address bar in it');
  const open = withSettings(createInitialState(), {}, { workspaceOpen: true, webWorkspaceOpen: true });
  assert.deepEqual(run(open, 'sidebar-address'), [{ type: 'sidebar.mode', tabs: true, address: true }], 'an open sidebar has nothing to open');
  const mode = withSettings(createInitialState(), { verticalTabs: true, addressInSidebar: true });
  assert.deepEqual(run(mode, 'top'), [{ type: 'sidebar.mode', tabs: false, address: false }], 'out, and tabs back along the top');
  assert.deepEqual(run(mode, 'sidebar'), [{ type: 'sidebar.mode', tabs: true, address: false }], 'out, tabs stay in the sidebar');
  const side = withSettings(createInitialState(), { verticalTabs: true, addressInSidebar: false });
  assert.deepEqual(run(side, 'sidebar-address'), [{ type: 'sidebar.mode', tabs: true, address: true }], 'from In a sidebar the tabs are already there');
});

test('the morph plays for every pair that moves the address bar, and for no other', () => {
  const settings = (layout: TabsLayout) => { const { tabs, address } = tabsLayoutSettings(layout); return { settings: { verticalTabs: tabs, addressInSidebar: address } }; };
  const direction = (from: TabsLayout, to: TabsLayout) => morphDirection(settings(from), settings(to), false, true, 'in');
  assert.equal(direction('top', 'sidebar-address'), 'in');
  assert.equal(direction('sidebar', 'sidebar-address'), 'in');
  assert.equal(direction('sidebar-address', 'top'), 'out');
  assert.equal(direction('sidebar-address', 'sidebar'), 'out');
  assert.equal(direction('top', 'sidebar'), null, 'the tab layout switch keeps its own transition');
  assert.equal(direction('sidebar', 'top'), null);
});

test('between Top and Sidebar nothing but what the Tabs card always wrote: both settings and the profile\'s tabs switch', () => {
  const state = createInitialState();
  const profile = state.tabs[0].browserProfileId;
  assert.deepEqual(run(state, 'sidebar'), [{ type: 'settings.update', patch: { verticalTabs: true, addressInSidebar: false } }]);
  assert.equal(readRailPrefs(profile, false).tabs, true, 'the rail switch is written in the same step, as the card did');
  const side = withSettings(state, { verticalTabs: true });
  assert.deepEqual(run(side, 'top'), [{ type: 'settings.update', patch: { verticalTabs: false, addressInSidebar: false } }]);
  assert.equal(readRailPrefs(profile, false).tabs, false);
});

test('the profile\'s tabs switch is not written before the morph: it follows inside it (runtime/client.ts)', () => {
  const state = createInitialState();
  const profile = state.tabs[0].browserProfileId;
  assert.equal(readRailPrefs(profile, false).tabs, false);
  run(state, 'sidebar-address');
  assert.equal(readRailPrefs(profile, false).tabs, false, 'still as it was: the sidebar does not appear before the window starts moving');
});

test('picking the layout already shown sends nothing; a leftover address flag is cleared by the first pick', () => {
  const state = createInitialState();
  for (const layout of tabsLayouts) {
    const { tabs, address } = tabsLayoutSettings(layout);
    assert.deepEqual(run(withSettings(state, { verticalTabs: tabs, addressInSidebar: address }), layout), [], layout);
  }
  // tabs along the top with the old switch's address flag left on: it shows as Along the top, and the pick writes both so the next Sidebar pick starts clean
  const leftover = withSettings(state, { verticalTabs: false, addressInSidebar: true });
  assert.equal(tabsLayoutOf(leftover.settings), 'top');
  assert.deepEqual(run(leftover, 'top'), [{ type: 'settings.update', patch: { verticalTabs: false, addressInSidebar: false } }]);
  assert.deepEqual(run(leftover, 'sidebar'), [{ type: 'settings.update', patch: { verticalTabs: true, addressInSidebar: false } }], 'Sidebar is Sidebar, not Sidebar mode');
});

test('a private window writes its tabs switch to memory only', () => {
  const state = createInitialState();
  const base = state.browserProfiles[0];
  const priv = { ...base, id: 'profile-private', private: true };
  const tab = { ...state.tabs[0], browserProfileId: priv.id };
  const private_ = { ...state, browserProfiles: [...state.browserProfiles, priv], tabs: [tab], activeTabId: tab.id };
  run(private_, 'sidebar');
  assert.equal([...store.keys()].some((key) => key.includes('profile-private')), false, 'nothing in browser storage');
  assert.equal(readRailPrefs(priv.id, true).tabs, true);
});

test('Seamless has nothing on screen to show the layout moving: the window is told to let the edge show', () => {
  const seamless = withSettings(createInitialState(), { windowView: 'seamless' });
  events.length = 0;
  run(seamless, 'sidebar-address');
  assert.ok(events.includes(sidebarModePeekEvent));
  events.length = 0;
  run(withSettings(seamless, { verticalTabs: true }), 'top');
  assert.equal(events.includes(sidebarModePeekEvent), false, 'the address bar did not move');
  events.length = 0;
  run(withSettings(createInitialState(), {}), 'sidebar-address');
  assert.equal(events.includes(sidebarModePeekEvent), false, 'outside Seamless the morph itself shows it');
});

test('with the address bar in the sidebar the window views that look different are Full and Seamless; the stored view is never touched', () => {
  assert.deepEqual(viewsOfLayout('top'), ['full', 'compact', 'focus', 'seamless']);
  assert.deepEqual(viewsOfLayout('sidebar'), ['full', 'compact', 'focus', 'seamless']);
  assert.deepEqual(viewsOfLayout('sidebar-address'), ['full', 'seamless']);
  assert.deepEqual(viewsOfLayout('sidebar-address', ['full', 'compact', 'seamless']), ['full', 'seamless'], 'the menu and setup list three');
  // Compact and Focus show as Full there; they are shown as themselves in the other two layouts
  for (const view of ['compact', 'focus'] as const) { assert.equal(shownView('sidebar-address', view), 'full'); assert.equal(shownView('sidebar', view), view); assert.equal(shownView('top', view), view); }
  assert.equal(shownView('sidebar-address', 'seamless'), 'seamless');
  assert.equal(shownView('sidebar-address', 'full'), 'full');
  const compact = withSettings(createInitialState(), { windowView: 'compact', verticalTabs: true });
  const sent = run(compact, 'sidebar-address');
  assert.equal(sent.some((action) => action.type === 'settings.update' && 'windowView' in action.patch), false, 'picking the layout does not rewrite the view');
});

test('the choice is the same in the four places and they share the one function', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const row = read('../src/features/settings/TabLayoutRow.tsx'), panel = read('../src/features/settings/panels/sidebar.tsx'), settings = read('../src/features/BrowserSettings.tsx'), menu = read('../src/components/BrowserMenu.tsx'), app = read('../src/App.tsx'), yours = read('../src/features/onboarding/MakeItYours.tsx'), rows = read('../src/features/settings/SidebarRows.tsx');
  // the three cards
  assert.match(row, /value: 'toolbar'[\s\S]*value: 'sidebar'[\s\S]*value: 'sidebar-address', label: t\('yours\.tabsSideAddress'\)/);
  // Appearance › Layout and Settings › Tabs use one component and one function
  assert.match(settings, /setTabsLayout\(state, dispatch, layout === "toolbar" \? "top" : layout\)/);
  assert.equal([...settings.matchAll(/<TabLayoutRow /g)].length, 2, 'Appearance › Layout and Tabs');
  // the switch and its rows are gone, everywhere
  for (const gone of ['SidebarModeRow', 'AddressInSidebarRow', 'setSidebarMode', 'sidebarModePlan', 'sidebarmode.title', 'windowview.addressInSidebar']) for (const [name, source] of Object.entries({ row, panel, settings, menu, app, yours, rows })) assert.ok(!source.includes(gone), `${name} still has ${gone}`);
  assert.ok(!/id="sidebar-mode"|id="address-in-sidebar"/.test(panel + rows + settings), 'no row with the old ids');
  // Window view: only the views that look different in the layout, at the card size of four
  assert.match(settings, /viewsOfLayout\(layoutChoice\)\.map\(\(mode\) => \(\{ value: mode, label: windowViewName\(mode\), art: <MiniView view=\{mode\} layout=\{tabLayout\} \/> \}\)\)/);
  assert.match(settings, /value=\{shownView\(layoutChoice, windowView\)\}/);
  // the menu: one Tabs segment with three icon cells, no Sidebar mode row, the menu closes after the pick
  assert.match(menu, /\{id:'sidebar-address',tip:t\("yours\.tabsSideAddress"\)/);
  assert.ok(!/MenuToggle[^\n]*sidebarmode/.test(menu));
  assert.match(app, /setTabsLayout: \(layout: TabsLayout\) => \{ setTabsLayout\(state, dispatch, layout\); close\(\);/, 'the Acira menu closes after the pick: the window re-arranges and the menu would cover the sidebar');
  // setup: three answers, and the view list follows the layout
  assert.match(yours, /\["sidebar-address", t\("yours\.tabsSideAddress"\)\]/);
  assert.match(yours, /onChange=\{\(value\) => setTabsLayout\(state, dispatch, value\)\}/);
  assert.match(yours, /viewsOfLayout\(layout, \["full", "compact", "seamless"\]\)/);
});

test('search finds the Tabs choice by the words the old Sidebar mode and address bar rows used', () => {
  const core = readFileSync(new URL('../src/features/settings/entries/core.ts', import.meta.url), 'utf8');
  const entry = core.split('\n').find((line) => line.includes("id: 'sidebar-only-tabs'")) ?? '';
  for (const word of ['sidebar mode', 'sidebar only', 'everything in sidebar', 'address bar', 'url bar', 'address bar in sidebar', 'arc style', 'zen style']) assert.ok(entry.includes(`'${word}'`), word);
});

test('the new label is in every language, and the strings the old rows used are gone from all of them', () => {
  const retired = ['sidebarmode.title', 'sidebarmode.detail', 'windowview.addressInSidebar', 'windowview.addressInSidebarDetail', 'sidebar.addressNeedsSidebarTabs', 'sidebar.moveTabsToSidebar'];
  const english = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.equal(english['yours.tabsSideAddress'], 'Sidebar + address');
  for (const { code } of LOCALES) {
    const messages = JSON.parse(readFileSync(new URL(`../src/i18n/${code}.json`, import.meta.url), 'utf8')) as Record<string, string>;
    assert.ok(messages['yours.tabsSideAddress']?.trim(), `${code}: the third Tabs label`);
    if (code !== 'en') assert.notEqual(messages['yours.tabsSideAddress'], english['yours.tabsSideAddress'], `${code}: translated`);
    for (const id of retired) assert.equal(id in messages, false, `${code}: ${id} is retired`);
  }
});
