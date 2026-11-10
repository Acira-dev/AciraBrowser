// 13.5, Sidebar + address in Full: the ways to close the sidebar other than its button, on the interface side: the patch a window sends, the commands a list offers, the Settings row.
// (main's toggleSidebar is tests/sidebar-held-open-routes.test.cjs.) Each assertion here is about something 13.4 does and 13.5 does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInitialState } from '../src/runtime/core';
import { patchKeepingSidebarOpen, sidebarHeldOpen } from '../src/runtime/windowView';
import { commandsOffered, SIDEBAR_TOGGLE_COMMAND } from '../src/ui/layoutMode';
import { isAvailable, type SettingsContext, type SettingsEntry } from '../src/features/settings/model';
import type { BrowserSnapshot } from '../src/runtime/types';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const win = (verticalTabs: boolean, addressInSidebar: boolean, view: 'full' | 'compact' | 'focus' | 'seamless'): BrowserSnapshot => {
  const base = createInitialState();
  return { ...base, settings: { ...base.settings, verticalTabs, addressInSidebar, windowView: view }, windowUi: { ...base.windowUi, view, focusMode: view === 'focus' } };
};

test('it is held open in Sidebar + address outside Seamless and nowhere else', () => {
  const on = { verticalTabs: true, addressInSidebar: true };
  for (const view of ['full', 'compact', 'focus'] as const) assert.equal(sidebarHeldOpen(on, view), true, view);
  assert.equal(sidebarHeldOpen(on, 'seamless'), false);
  assert.equal(sidebarHeldOpen({ verticalTabs: true, addressInSidebar: false }, 'full'), false, 'the toolbar is over the page: the button closes it');
  assert.equal(sidebarHeldOpen({ verticalTabs: false, addressInSidebar: true }, 'full'), false, 'the address flag alone is not the layout');
  assert.equal(sidebarHeldOpen({}, 'full'), false);
  assert.equal(sidebarHeldOpen(null, 'full'), false);
});

test('the patch a window sends loses whatever would close the sidebar, and a patch left with nothing is not sent', () => {
  const s = win(true, true, 'full');
  const closing = { workspaceOpen: false, webWorkspaceOpen: false };
  assert.deepEqual(patchKeepingSidebarOpen(s.settings, s.windowUi, closing), {});
  assert.deepEqual(patchKeepingSidebarOpen(s.settings, s.windowUi, { ...closing, view: 'compact' as const }), { view: 'compact' }, 'the rest of the patch goes through');
  assert.deepEqual(patchKeepingSidebarOpen(s.settings, s.windowUi, { workspaceOpen: true, webWorkspaceOpen: true }), { workspaceOpen: true, webWorkspaceOpen: true }, 'opening is untouched');
  // the view AFTER the patch decides: into Seamless the sidebar may go, out of it it may not
  assert.deepEqual(patchKeepingSidebarOpen(s.settings, s.windowUi, { ...closing, view: 'seamless' as const }), { ...closing, view: 'seamless' });
  const seamless = win(true, true, 'seamless');
  assert.deepEqual(patchKeepingSidebarOpen(seamless.settings, seamless.windowUi, closing), closing, 'Seamless closes as before');
  assert.deepEqual(patchKeepingSidebarOpen(seamless.settings, seamless.windowUi, { ...closing, view: 'full' as const }), { view: 'full' });
  const side = win(true, false, 'full');
  assert.deepEqual(patchKeepingSidebarOpen(side.settings, side.windowUi, closing), closing, 'a sidebar beside the toolbar closes as before');
});

test('"Toggle sidebar" is not offered by the command bar or the address list where the sidebar is held open', () => {
  const commands = [{ id: 'new-tab' }, { id: SIDEBAR_TOGGLE_COMMAND }, { id: 'focus-mode' }];
  assert.equal(SIDEBAR_TOGGLE_COMMAND, 'workspace', 'the registry id (desktop/shortcut-registry.cjs)');
  assert.deepEqual(commandsOffered(win(true, true, 'full'), commands).map(c => c.id), ['new-tab', 'focus-mode']);
  for (const other of [win(true, false, 'full'), win(true, true, 'seamless'), win(false, false, 'full')]) assert.equal(commandsOffered(other, commands), commands, 'the same list everywhere else');
  assert.match(read('../desktop/shortcut-registry.cjs'), /C\('workspace','Toggle sidebar'/);
  assert.match(read('../src/components/CommandPalette.tsx'), /commandsOffered\(state, commands\)/);
  assert.equal((read('../src/App.tsx').match(/commandsOffered\(state, useAddressCommands/g) || []).length, 2, 'both address lists');
});

test('Settings › Sidebar › Show sidebar is not listed (row or search) where the sidebar cannot be hidden', () => {
  const ctx = (patch: Partial<SettingsContext>): SettingsContext => ({ customGlassColors: false, privateProfile: false, desktop: true, websiteOpen: false, ...patch });
  return import('../src/features/settings/entries/sidebar').then(({ default: entries }) => {
    const entry = (entries as SettingsEntry[]).find(item => item.id === 'sidebar-visible')!;
    assert.equal(isAvailable(entry, ctx({ sidebarClosable: false })), false);
    assert.equal(isAvailable(entry, ctx({ sidebarClosable: true })), true);
    assert.equal(isAvailable(entry, ctx({})), true, 'absent means it can');
    assert.match(read('../src/features/settings/panels/sidebar.tsx'), /\{!sidebarHeldOpenIn\(state\.settings, state\.windowUi\) && \(\s*<SettingRow id="sidebar-visible"/);
    assert.match(read('../src/features/BrowserSettings.tsx'), /const sidebarClosable = !sidebarHeldOpenIn\(s, state\.windowUi\)/);
  });
});

test('the interface turns the key and the optimistic close away before anything is drawn or sent', () => {
  assert.match(read('../src/runtime/client.ts'), /if\(action\.type==='ui\.update'\)\{const patch=patchKeepingSidebarOpen\(latest\.current\.settings,latest\.current\.windowUi,action\.patch\);if\(patch!==action\.patch\)\{if\(!Object\.keys\(patch\)\.length\)return;/);
  const app = read('../src/App.tsx');
  assert.match(app, /if \(!e\.repeat && !sidebarHeld\) \{\s*setOverlay\(null\);\s*setWorkspaceOpen\(value => !value\);/);
  assert.match(app, /const sidebarHeld = sidebarHeldOpenIn\(s, state\.windowUi\);/);
});
