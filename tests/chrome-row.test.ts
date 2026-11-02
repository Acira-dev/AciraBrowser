import test from 'node:test';
import assert from 'node:assert/strict';
import { chromeMode, chromeRow, compactRowHeight, type ToolbarSetting } from '../src/ui/chromeRow';
import { sidebarControl } from '../src/ui/layoutMode';
import type { BrowserSnapshot } from '../src/runtime/types';

const TOOLBAR = 36, TAB_ROW = 32;
const layouts = [{ name: 'strip', sidebarTabs: false }, { name: 'sidebar', sidebarTabs: true }] as const;
const settings: ToolbarSetting[] = ['visible', 'compact', 'hidden'];

test('R3-65 every combination: tab layout x Toolbar setting x Focus keeps the address field, the way out and the menu', () => {
  for (const layout of layouts) for (const toolbar of settings) for (const focus of [false, true]) {
    for (const engaged of [false, true]) {
      const mode = chromeMode({ focus, toolbar, engaged, reveal: false });
      const row = chromeRow(mode, layout.sidebarTabs, TOOLBAR, TAB_ROW);
      const label = `${layout.name} / ${toolbar} / focus ${focus} / engaged ${engaged} -> ${mode}`;
      assert.equal(row.addressField, true, `${label}: the address field is always there`);
      assert.equal(row.navigation, true, `${label}: back, forward and reload`);
      assert.equal(row.menu, true, `${label}: the menu`);
      assert.equal(row.sidebarToggle, layout.sidebarTabs, `${label}: the sidebar button follows the tab layout, in Focus too`);
      assert.equal(row.tabStrip && row.miniTabs, false, `${label}: never a strip and chips together`);
      assert.equal(row.tabStrip || row.miniTabs || layout.sidebarTabs, true, `${label}: tabs stay reachable`);
      if (focus) {
        assert.equal(mode, 'focus', label);
        assert.equal(row.exitFocus, true, `${label}: Focus always shows its way out`);
        assert.deepEqual([row.bookmarksBar, row.extensions, row.optionalButtons, row.overflow, row.tabOverview, row.tabStrip], [false, false, false, false, false, false], `${label}: secondary chrome hides`);
        assert.equal(row.height, compactRowHeight, `${label}: one slim row`);
      } else {
        assert.equal(row.exitFocus, false, label);
      }
    }
  }
});

test('Focus and Compact differ in what they keep; Compact keeps everything Standard has', () => {
  for (const layout of layouts) {
    const standard = chromeRow('standard', layout.sidebarTabs, TOOLBAR, TAB_ROW), compact = chromeRow('compact', layout.sidebarTabs, TOOLBAR, TAB_ROW), focus = chromeRow('focus', layout.sidebarTabs, TOOLBAR, TAB_ROW);
    for (const key of ['extensions', 'optionalButtons', 'overflow', 'addressField', 'navigation', 'menu', 'sidebarToggle'] as const) assert.equal(compact[key], standard[key], `${layout.name}: Compact keeps ${key}`);
    assert.equal(compact.tabOverview, true);
    assert.equal(compact.height, compactRowHeight);
    assert.equal(focus.extensions, false);
    assert.ok(focus.height <= compact.height);
    assert.ok(standard.height > compact.height || layout.sidebarTabs, 'Standard with a strip is taller than one slim row');
  }
});

test('a keyboard reveal shows the full chrome for a moment, then the mode returns', () => {
  assert.equal(chromeMode({ focus: true, toolbar: 'visible', engaged: false, reveal: true }), 'standard');
  assert.equal(chromeMode({ focus: true, toolbar: 'visible', engaged: false, reveal: false }), 'focus');
  assert.equal(chromeMode({ focus: false, toolbar: 'compact', engaged: true, reveal: false }), 'compact');
  assert.equal(chromeMode({ focus: false, toolbar: 'compact', engaged: false, reveal: false }), 'standard');
  assert.equal(chromeMode({ focus: false, toolbar: 'hidden', engaged: true, reveal: false }), 'standard', 'Hide until needed does not change the mode');
});

test('the sidebar button shows in Focus when tabs are in the sidebar (R3-65) and only then', () => {
  const state = (verticalTabs: boolean, focusMode: boolean) => ({
    settings: { verticalTabs }, windowUi: { focusMode, workspaceOpen: false, webWorkspaceOpen: false, split: null },
    activeTabId: 't1', tabs: [{ id: 't1', contentKind: 'web', url: 'https://example.com/' }],
  }) as unknown as BrowserSnapshot;
  assert.equal(sidebarControl(state(true, true)).visible, true);
  assert.equal(sidebarControl(state(true, false)).visible, true);
  assert.equal(sidebarControl(state(false, true)).visible, false);
});

test('Seamless has no sidebar button: the left edge (or Ctrl+Shift+E) brings the sidebar, so the toolbar closes up and Full, Compact and Focus keep the button', () => {
  const state = (verticalTabs: boolean, view?: string, windowView?: string) => ({
    settings: { verticalTabs, ...(windowView ? { windowView } : {}) }, windowUi: { focusMode: false, workspaceOpen: false, webWorkspaceOpen: false, split: null, ...(view ? { view } : {}) },
    activeTabId: 't1', tabs: [{ id: 't1', contentKind: 'web', url: 'https://example.com/' }],
  }) as unknown as BrowserSnapshot;
  for (const view of ['full', 'compact', 'focus']) assert.equal(sidebarControl(state(true, view)).visible, true, `${view} keeps the button`);
  assert.equal(sidebarControl(state(true, 'seamless')).visible, false, 'this window is Seamless');
  assert.equal(sidebarControl(state(true, undefined, 'seamless')).visible, false, 'Seamless is the default view and this window has none of its own');
  assert.equal(sidebarControl(state(true, 'full', 'seamless')).visible, true, 'a window of its own view wins over the default');
  assert.equal(sidebarControl(state(true, 'seamless', 'full')).visible, false);
  assert.equal(sidebarControl(state(false, 'seamless')).visible, false, 'horizontal tabs never had one');
});
