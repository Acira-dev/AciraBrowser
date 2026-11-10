// 13.5, Sidebar + address in Full: the sidebar cannot be closed (reported 9 Nov 2026: in Full the top area still showed the sidebar button; on the Mac pressing it made the
// sidebar disappear, on Windows everything was glitchy and it could not be turned back off). Behaviour only, through symbols 13.4 already has, so on 13.4 every test here fails on its
// assertion: the button is offered, the reducer closes the sidebar, a saved closed sidebar stays closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { sidebarControl } from '../src/ui/layoutMode';
import { createRequire } from 'node:module';
import type { BrowserAction, BrowserSnapshot, Settings } from '../src/runtime/types';
const { validateAction } = createRequire(import.meta.url)('../desktop/validation.cjs');

type Mode = 'address' | 'sidebar' | 'top';
const layouts: Record<Mode, Partial<Settings>> = { address: { verticalTabs: true, addressInSidebar: true }, sidebar: { verticalTabs: true, addressInSidebar: false }, top: { verticalTabs: false, addressInSidebar: false } };
function window(mode: Mode, view: 'full' | 'compact' | 'focus' | 'seamless', open: boolean): BrowserSnapshot {
  const base = createInitialState();
  return { ...base, settings: { ...base.settings, ...layouts[mode], windowView: view }, windowUi: { ...base.windowUi, view, focusMode: view === 'focus', workspaceOpen: open, webWorkspaceOpen: open } };
}
const isOpen = (s: BrowserSnapshot) => s.windowUi.workspaceOpen && s.windowUi.webWorkspaceOpen;
const closes = { type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } } as const;

test('the sidebar button is not offered in Sidebar + address in Full, Compact or Focus, and is everywhere it was', () => {
  for (const view of ['full', 'compact', 'focus'] as const) assert.equal(sidebarControl(window('address', view, true)).visible, false, `Sidebar + address, ${view}`);
  assert.equal(sidebarControl(window('address', 'seamless', true)).visible, false, 'Seamless never had one');
  for (const view of ['full', 'compact', 'focus'] as const) assert.equal(sidebarControl(window('sidebar', view, true)).visible, true, `a sidebar with the toolbar over the page keeps it (${view})`);
  assert.equal(sidebarControl(window('sidebar', 'seamless', true)).visible, false);
  assert.equal(sidebarControl(window('top', 'full', true)).visible, false, 'horizontal tabs never had one');
});

test('nothing closes the sidebar of Sidebar + address in Full: not the patch the button, the key, the command or the Settings switch send', () => {
  for (const view of ['full', 'compact', 'focus'] as const) {
    const closed = reduceBrowser(window('address', view, true), closes);
    assert.equal(isOpen(closed), true, `${view}: ui.update with the sidebar closed leaves it open`);
    assert.equal(isOpen(reduceBrowser(window('address', view, true), { type: 'ui.update', patch: { workspaceOpen: false } })), true, `${view}: one flag alone`);
    assert.equal(isOpen(reduceBrowser(window('address', view, true), { type: 'ui.update', patch: { webWorkspaceOpen: false } })), true, `${view}: the other flag alone`);
  }
});

test('it can still be closed where it could be: a sidebar beside the toolbar, and Seamless', () => {
  assert.equal(isOpen(reduceBrowser(window('sidebar', 'full', true), closes)), false, 'tabs in a sidebar, address in the toolbar');
  assert.equal(isOpen(reduceBrowser(window('address', 'seamless', true), closes)), false, 'Seamless keeps its own rules');
  assert.equal(isOpen(reduceBrowser(window('top', 'full', true), closes)), false);
});

test('a sidebar that was closed comes back open the moment its window is in Full with the address bar in it', () => {
  // Seamless (closed) -> Full, by the window's own view, by the default view, and by a Focus or Compact switch
  assert.equal(isOpen(reduceBrowser(window('address', 'seamless', false), { type: 'ui.update', patch: { view: 'full' } })), true, 'view patch');
  assert.equal(isOpen(reduceBrowser(window('address', 'seamless', false), { type: 'ui.update', patch: { view: 'compact' } })), true, 'Compact is Full in this layout');
  assert.equal(isOpen(reduceBrowser(window('address', 'seamless', false), { type: 'ui.update', patch: { focusMode: true } })), true, 'Focus is Full in this layout');
  const byDefault = window('address', 'seamless', false); delete byDefault.windowUi.view; byDefault.windowUi.focusMode = false;
  assert.equal(isOpen(reduceBrowser(byDefault, { type: 'settings.update', patch: { windowView: 'full' } })), true, 'the default view (a window with no view of its own) turned to Full');
  // the layout turning on with the sidebar closed
  const closedFull = window('sidebar', 'full', false);
  assert.equal(isOpen(reduceBrowser(closedFull, { type: 'settings.update', patch: { addressInSidebar: true } })), true, 'Settings: Sidebar + address chosen with the sidebar closed');
  assert.equal(isOpen(reduceBrowser(closedFull, { type: 'sidebar.mode', tabs: true, address: true })), true, 'the layout switch, whether or not it names the sidebar');
  // and leaving the layout lets it be closed again
  assert.equal(isOpen(reduceBrowser(reduceBrowser(window('address', 'full', true), { type: 'sidebar.mode', tabs: true, address: false }), closes)), false);
});

test('a window saved with its sidebar closed in Sidebar + address (Full) is open again after the update', () => {
  for (const view of ['full', 'compact', 'focus'] as const) {
    const saved = JSON.parse(JSON.stringify(window('address', view, false)));
    assert.equal(isOpen(restoreSnapshot(saved)), true, `${view}: restored open`);
  }
  const seamless = JSON.parse(JSON.stringify(window('address', 'seamless', false)));
  assert.equal(isOpen(restoreSnapshot(seamless)), false, 'a Seamless window is left as it was');
  assert.equal(isOpen(restoreSnapshot(JSON.parse(JSON.stringify(window('sidebar', 'full', false))))), false, 'so is a window whose address bar is in the toolbar');
  // a window with no view of its own follows the saved default
  const byDefault = JSON.parse(JSON.stringify(window('address', 'full', false)));
  delete byDefault.windowUi.view; byDefault.settings.windowView = 'seamless';
  assert.equal(isOpen(restoreSnapshot(byDefault)), false, 'the default view is Seamless: nothing to hold open');
  byDefault.settings.windowView = 'full';
  assert.equal(isOpen(restoreSnapshot(byDefault)), true, 'the default view is Full: held open');
});

test('closing and opening it where it can be is unchanged', () => {
  const opened = reduceBrowser(window('sidebar', 'full', false), { type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } });
  assert.equal(isOpen(opened), true);
  const same = window('address', 'full', true);
  assert.equal(reduceBrowser(same, { type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } }).windowUi.workspaceOpen, true);
});

// ---- installed web apps (found by the two-window edge check, 9 Nov): their window is the bare, chromeless one an app is: main marks it (windowUi.app) and sets its sidebar closed; nothing may open it --------
function appWindow(): BrowserSnapshot {
  const w = window('address', 'full', false);
  return { ...w, windowUi: { ...w.windowUi, app: true, focusMode: true, view: 'focus' } };
}
test('an installed web app\'s window keeps its sidebar closed in Sidebar + address, through every action and a save and restore', () => {
  let s = appWindow();
  for (const action of [{ type: 'ui.update', patch: { view: 'full' } }, { type: 'ui.update', patch: { workspaceOpen: false } }, { type: 'settings.update', patch: { addressInSidebar: true } }, { type: 'sidebar.mode', tabs: true, address: true }, { type: 'ui.update', patch: {} }, { type: 'tab.new', url: 'https://harbor.dev/docs' }] as BrowserAction[]) {
    s = reduceBrowser(s, action);
    assert.equal(s.windowUi.app, true, `the app marker survives ${JSON.stringify(action)}`);
    assert.equal(isOpen(s) || s.windowUi.workspaceOpen || s.windowUi.webWorkspaceOpen, false, `${JSON.stringify(action)} must not open an app window's sidebar`);
  }
  assert.equal(sidebarControl(s).visible, sidebarControl(window('address', 'full', false)).visible === false ? true : false, 'an app window is not a held-open window: the button logic is the old one');
  assert.equal(restoreSnapshot(JSON.parse(JSON.stringify(persistedSnapshot(s)))).windowUi.workspaceOpen, false, 'and a restore leaves it closed');
  // an ordinary window never carries the marker, and the renderer cannot give one the marker through ui.update
  assert.throws(() => validateAction({ type: 'ui.update', patch: { app: true } }, createInitialState()), 'the bridge refuses a ui.update that names it: only main marks a window');
});
