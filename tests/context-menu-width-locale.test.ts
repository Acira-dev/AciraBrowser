import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_WIDTHS, localeMenuWidth, popupGeometry } from '../src/ui/popup';
import { LOCALES } from '../src/i18n/locales';
import type { BrowserSnapshot } from '../src/runtime/types';

// The compact menus are 260 wide (the toolbar menu 300) in English. A language whose longest row (label + shortcut) needs more
// gets a measured width (qa/tab-group-menu-i18n.mjs and qa/context-menus-i18n.mjs print each language's need), so no row is cut
// with an ellipsis.
const codes = new Set(LOCALES.map(locale => locale.code));
const COMPACT: Record<string, number> = { 'tab-context': 260, 'strip-context': 260, 'page-context': 260, 'toolbar-context': 300, 'split-context': 260, 'workspace-context': 240 };
// The Acira menu and the Protection panel are in the table too (an Arabic "Tabs" label and a Japanese note were cut by an ellipsis).
const BASE: Record<string, number> = { ...COMPACT, menu: 340, protection: 320 };

test('every language-specific menu width is for a real language, wider than the menu it widens, and narrower than the main menu', () => {
  for (const [kind, widths] of Object.entries(MENU_WIDTHS)) {
    assert.ok(kind in BASE, `${kind} has a base width in this test`);
    for (const [code, width] of Object.entries(widths)) {
      assert.ok(codes.has(code as never), `${kind}: ${code} is a shipped language`);
      assert.notEqual(code, 'en', `${kind}: English is the base width, it needs no entry`);
      assert.ok(width! > BASE[kind] && width! <= 360, `${kind}/${code}: ${width} is between ${BASE[kind]} and 360`);
      assert.equal(width! % 10, 0, `${kind}/${code}: widths are rounded up to 10`);
    }
  }
});

test('English keeps the base widths, and a widened kind gets its width in the geometry', () => {
  for (const [kind, base] of Object.entries(BASE)) assert.equal(localeMenuWidth(kind), 0, `${kind}: tests run in English`);
  const state = { tabs: [], tabGroups: [], settings: {}, windowUi: {}, workspaces: [] } as unknown as BrowserSnapshot;
  const viewport = { width: 1200, height: 800 };
  for (const [kind, base] of Object.entries(COMPACT)) assert.equal(popupGeometry(kind, state, viewport, { x: 100, y: 60, width: 2, height: 2 }, 300).bounds.width, base, `${kind} is ${base} wide in English`);
  assert.equal(localeMenuWidth('tab-context', 'de'), 330);
  assert.equal(localeMenuWidth('menu', 'ar'), 360);
  assert.equal(localeMenuWidth('protection', 'ja'), 330);
  assert.equal(localeMenuWidth('group-context', 'de'), 0, 'the group menu fits 260 in every language');
});
