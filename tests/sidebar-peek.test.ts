import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createInitialState, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import { SIDEBAR_PEEK_DEFAULT, sidebarPeekDefaults, sidebarPeekOf } from '../src/runtime/windowView';
import { sidebarControl } from '../src/ui/layoutMode';
import core from '../src/features/settings/entries/core';
import sidebarEntries from '../src/features/settings/entries/sidebar';
import { searchSettings } from '../src/features/settings/search';
import type { SettingsContext } from '../src/features/settings/model';
const require = createRequire(import.meta.url);

// R5 (founder: "if I close the sidebar, it must not open automatically when the mouse nears the edge, especially in Full view"):
// "Show the closed sidebar at the left edge" is one switch per window view. Full off, Compact and Focus on; Seamless keeps its own.

test('a fresh profile: Full keeps a closed sidebar closed, Compact and Focus show it at the edge', () => {
  const s = createInitialState();
  assert.deepEqual(sidebarPeekDefaults, { full: false, compact: true, focus: true });
  assert.deepEqual(s.settings.sidebarPeek, { full: false, compact: true, focus: true });
  assert.equal(s.settings.sidebarPeekDefault, SIDEBAR_PEEK_DEFAULT);
  assert.deepEqual(sidebarPeekOf(undefined), { full: false, compact: true, focus: true });
  assert.deepEqual(sidebarPeekOf({ sidebarPeek: { full: true } }), { full: true, compact: true, focus: true }, 'a missing view takes its default');
  assert.deepEqual(sidebarPeekOf({ sidebarPeek: 'yes' as never }), sidebarPeekDefaults, 'junk is ignored');
});

test('a profile saved before the switch gets the defaults once (Full stops peeking); a later choice sticks across restarts', () => {
  const saved = createInitialState();
  const old = JSON.parse(JSON.stringify({ ...saved, settings: { ...saved.settings, sidebarPeek: undefined, sidebarPeekDefault: undefined } }));
  const migrated = restoreSnapshot(old);
  assert.deepEqual(migrated.settings.sidebarPeek, { full: false, compact: true, focus: true });
  assert.equal(migrated.settings.sidebarPeekDefault, 1);
  // The person turns Full's switch on and Focus's off: both survive a restart.
  const chosen = reduceBrowser(migrated, { type: 'settings.update', patch: { sidebarPeek: { full: true, compact: true, focus: false } } });
  const again = restoreSnapshot(JSON.parse(JSON.stringify(chosen)));
  assert.deepEqual(again.settings.sidebarPeek, { full: true, compact: true, focus: false });
});

test('a patch naming one view changes only that view, and the desktop validator accepts it (and nothing else)', () => {
  let s = createInitialState();
  s = reduceBrowser(s, { type: 'settings.update', patch: { sidebarPeek: { compact: false } as never } });
  assert.deepEqual(s.settings.sidebarPeek, { full: false, compact: false, focus: true });
  s = reduceBrowser(s, { type: 'settings.update', patch: { sidebarPeek: { full: true } as never } });
  assert.deepEqual(s.settings.sidebarPeek, { full: true, compact: false, focus: true });
  const { validateAction } = require('../desktop/validation.cjs');
  const ok = (patch: unknown) => { try { validateAction({ type: 'settings.update', patch }); return true; } catch { return false; } };
  assert.ok(ok({ sidebarPeek: { full: false, compact: true, focus: true } }));
  assert.ok(ok({ sidebarPeek: { full: true } }));
  assert.ok(!ok({ sidebarPeek: { full: 'no' } }));
  assert.ok(!ok({ sidebarPeek: { seamless: true } }), 'Seamless has its own switch');
  assert.ok(!ok({ sidebarPeekDefault: 0 }), 'the migration marker is not the renderer\'s to change');
});

test('the keyboard is unaffected: opening and closing the sidebar works the same whatever the switches say', () => {
  let s = createInitialState();
  s = reduceBrowser(s, { type: 'settings.update', patch: { verticalTabs: true, sidebarPeek: { full: false, compact: false, focus: false } } });
  s = reduceBrowser(s, { type: 'ui.update', patch: { workspaceOpen: false, webWorkspaceOpen: false } });
  assert.equal(sidebarControl(s).open, false);
  s = reduceBrowser(s, { type: 'ui.update', patch: { workspaceOpen: true, webWorkspaceOpen: true } });
  assert.equal(sidebarControl(s).open, true);
});

test('Settings: the row is in Tabs › Sidebar and, for Full, Compact and Focus, under Window view (Seamless keeps its own two), and search finds it', () => {
  const rows = readFileSync(new URL('../src/features/settings/SidebarRows.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/features/BrowserSettings.tsx', import.meta.url), 'utf8');
  const row = rows.indexOf('id="sidebar-peek"');
  assert.ok(row > 0, 'the shared sidebar rows draw it');
  assert.match(rows.slice(row - 500, row), /if \(!s\.verticalTabs\) return null;[\s\S]*if \(windowView !== 'seamless' && sidebarModeOn\(s\)\) return null;\s*if \(windowView !== 'seamless'\)/, 'only with tabs in the sidebar, not in Seamless, and not in Sidebar mode (a closed sidebar always comes back from the edge there)');
  assert.match(rows.slice(row, row + 400), /sidebarPeekOf\(s\)\[windowView\]/, 'it reads and writes the selected view\'s switch');
  const view = settings.indexOf('id="window-view"'), edge = settings.indexOf('{windowView !== "seamless" && <SidebarEdgeRows');
  assert.ok(view > 0 && edge > view, 'Appearance › Layout keeps it right after the Window view cards');
  const context: SettingsContext = { customGlassColors: true, privateProfile: false, desktop: true, websiteOpen: true, appearanceChanged: true, toolbarChanged: true, newTabChanged: true, verticalTabs: true };
  const all = [...core, ...sidebarEntries], entry = all.find((item) => item.id === 'sidebar-peek');
  assert.equal(entry?.title, 'Show the closed sidebar at the left edge');
  assert.equal(entry?.section, 'Tabs'); assert.equal(entry?.group, 'Sidebar');
  for (const query of ['closed sidebar', 'sidebar opens by itself', 'peek sidebar', 'left edge'])
    assert.ok(searchSettings(all, query, context).slice(0, 3).some((hit) => hit.entry.id === 'sidebar-peek'), query);
});
