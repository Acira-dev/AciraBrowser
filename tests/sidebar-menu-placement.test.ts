import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { BrowserSnapshot } from '../src/runtime/types';
import { pointerAnchor, popupFollowsTrigger, popupGeometry, rowAnchor } from '../src/ui/popup';

// R3-48: every sidebar context menu opens where the click was, clamped inside the window. The bug: a group's menu looked
// its anchor up as a strip chip, found none in the sidebar and fell back to the toolbar's menu button (top-right).
const state = { activeTabId: 'a', tabs: [{ id: 'a', contentKind: 'web' }], bookmarks: [], downloads: [], browserProfiles: [{}] } as unknown as BrowserSnapshot;
const kinds = ['group-context', 'tab-context', 'strip-context', 'bookmark-context', 'split-context'];
const windows = [{ width: 1440, height: 900 }, { width: 1100, height: 720 }, { width: 900, height: 600 }, { width: 640, height: 480 }];
const MARGIN = 12;

test('a right-click anchor is a 2px point at the pointer, never negative', () => {
  assert.deepEqual(pointerAnchor(66.4, 245.6), { x: 66, y: 246, width: 2, height: 2 });
  assert.deepEqual(pointerAnchor(-3, -1), { x: 0, y: 0, width: 2, height: 2 });
  assert.deepEqual(rowAnchor({ left: 6, top: 32, bottom: 64, width: 228 }), { x: 42, y: 60, width: 2, height: 2 });
});

test('a menu opened by a click inside the sidebar stays inside the window and touches the click, in every window size', () => {
  for (const viewport of windows) for (const kind of kinds)
    for (const x of [6, 66, 150, 232]) for (const y of [8, 60, 245, 420, viewport.height / 2, viewport.height - 40, viewport.height - 4]) {
      const { bounds } = popupGeometry(kind, state, viewport, pointerAnchor(x, y), undefined, { target: { contentKind: 'web' } });
      const at = `${kind} at ${x},${y} in ${viewport.width}x${viewport.height}`;
      assert.ok(bounds.x >= MARGIN && bounds.y >= MARGIN, `${at}: starts inside the ${MARGIN}px margin (${bounds.x},${bounds.y})`);
      assert.ok(bounds.x + bounds.width <= viewport.width - MARGIN && bounds.y + bounds.height <= viewport.height - MARGIN, `${at}: ends inside the window (${bounds.x + bounds.width},${bounds.y + bounds.height})`);
      // Horizontally the menu's left edge is the click's x (clamped); vertically it hangs 4px below the click (the 2px point plus a 2px gap), flips to end 2px above it, or is pinned to a margin when neither fits.
      assert.equal(bounds.x, Math.min(Math.max(x, MARGIN), viewport.width - bounds.width - MARGIN), `${at}: left edge follows the click`);
      const below = bounds.y === Math.round(y) + 4, above = bounds.y + bounds.height === Math.round(y) - 2, pinned = bounds.y === MARGIN || bounds.y + bounds.height === viewport.height - MARGIN;
      assert.ok(below || above || pinned, `${at}: opens at the click (top ${bounds.y}, height ${bounds.height})`);
    }
});

test('a sidebar click never sends a menu to the top-right of the window', () => {
  const viewport = { width: 1440, height: 900 };
  for (const kind of kinds) {
    const { bounds } = popupGeometry(kind, state, viewport, pointerAnchor(66, 245), undefined, { target: { contentKind: 'web' } });
    assert.ok(bounds.x < 300, `${kind} opened at x=${bounds.x}`);
  }
});

test('only the account and extension buttons and a strip chip are looked up again on each layout', () => {
  assert.equal(popupFollowsTrigger('accounts', false), true);
  assert.equal(popupFollowsTrigger('extensions', false), true);
  assert.equal(popupFollowsTrigger('group-context', true), true, 'a group chip in the tab strip');
  assert.equal(popupFollowsTrigger('group-context', false), false, 'a group in the sidebar keeps the anchor it was opened with');
  for (const kind of ['tab-context', 'strip-context', 'bookmark-context', 'split-context', 'menu']) assert.equal(popupFollowsTrigger(kind, true), false, kind);
});

test('the sidebar opens its context menus with the pointer', () => {
  const source = fs.readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  // Every right-click that opens a native popup hands popup() its event; only the keyboard path falls back to the row's box.
  const rightClicks = source.match(/onContextMenu=\{event=>\{[^}]*\bpopup\(|onContextMenu=\{event=>\{[^}]*\bcontext\(/g) || [];
  assert.ok(rightClicks.length >= 3, 'tab row, group header and New tab are wired');
  for (const call of source.match(/onContextMenu=\{event=>\{[^]*?\}\}/g) || []) {
    if (/\bpopup\(|\bcontext\(/.test(call)) assert.match(call, /,event\)|undefined,event\)/, `a right-click handler passes its pointer: ${call.slice(0, 120)}`);
  }
});
