import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserSnapshot, Rectangle } from '../src/runtime/types';
import { groupEditorPlacement, popupGeometry } from '../src/ui/popup';

// R6 founder bug: "When I create a new tab group, the menu to edit its name (and colour) opens on the OTHER side instead of
// next to the group." The menu was placed before the new group's chip/header existed (and from an older render's state), so
// it fell back to the toolbar's menu button at the top-right. It now waits for the group and opens next to it.
const { measuredPlacement } = createRequire(import.meta.url)('../desktop/popup-measure.cjs') as {
  measuredPlacement: (input: { current: any; height: number; windowHeight: number; scale?: number }) => { y: number; h: number; up: boolean };
};
const state = { activeTabId: 'a', tabs: [{ id: 'a', contentKind: 'web' }], bookmarks: [], downloads: [], browserProfiles: [{}], tabGroups: [] } as unknown as BrowserSnapshot;
const place = (header: Rectangle, where: 'strip' | 'sidebar', viewport: { width: number; height: number }, height = 262) => {
  const first = popupGeometry('group-context', state, viewport, header, height);
  const placed = groupEditorPlacement(header, where, viewport, first.contentHeight, first.bounds.width);
  return { placed, geometry: popupGeometry('group-context', state, viewport, placed.anchor, height, { align: placed.align }) };
};
const windows = [{ width: 1280, height: 820 }, { width: 853, height: 547 }, { width: 720, height: 700 }, { width: 600, height: 480 }, { width: 1920, height: 1040 }];
const MARGIN = 12;

test('in a tab strip the menu hangs under the new group\'s chip, left edges together', () => {
  for (const viewport of windows) for (const x of [80, 300, Math.round(viewport.width / 2)]) {
    const chip = { x, y: 6, width: 110, height: 26 }, { placed, geometry } = place(chip, 'strip', viewport);
    assert.equal(placed.side, 'below');
    assert.equal(geometry.bounds.y, chip.y + chip.height + 8, `under the chip at ${x} in ${viewport.width}x${viewport.height}`);
    assert.equal(geometry.bounds.x, Math.min(Math.max(x, MARGIN), viewport.width - geometry.bounds.width - MARGIN), 'left edge on the chip\'s (clamped in the window)');
    assert.ok(geometry.bounds.x < x + chip.width, 'never on the other side of the window');
  }
});

test('in the sidebar the menu opens beside the new group\'s header, on the right, touching it', () => {
  for (const viewport of windows) for (const y of [60, 180, viewport.height / 2, viewport.height - 80, viewport.height - 40]) {
    const header = { x: 8, y, width: 224, height: 32 }, { placed, geometry } = place(header, 'sidebar', viewport), b = geometry.bounds;
    const at = `header at y=${y} in ${viewport.width}x${viewport.height}`;
    assert.equal(placed.side, 'right', at);
    assert.equal(b.x, header.x + header.width + 8, `${at}: left edge 8px right of the header`);
    assert.ok(b.y <= header.y + header.height && b.y + b.height >= header.y, `${at}: level with the header (top ${b.y}, height ${b.height})`);
    assert.ok(b.y >= MARGIN && b.y + b.height <= viewport.height - MARGIN, `${at}: inside the window`);
    if (y + geometry.contentHeight + 20 <= viewport.height) assert.equal(b.y, Math.max(MARGIN, header.y), `${at}: its top on the header's top when it fits`);
    assert.ok(geometry.origin.x <= .05, `${at}: it grows out of the edge next to the header`);
  }
});

test('it flips to the left of the header only when the right has no room, and drops under it when neither side has', () => {
  const viewport = { width: 900, height: 700 };
  const right = { x: 620, y: 200, width: 240, height: 32 }, flipped = place(right, 'sidebar', viewport);
  assert.equal(flipped.placed.side, 'left');
  assert.equal(flipped.geometry.bounds.x + flipped.geometry.bounds.width, right.x - 8, 'right edge 8px left of the header');
  assert.ok(flipped.geometry.origin.x >= .95, 'grows out of the edge next to the header');
  const wide = { x: 40, y: 200, width: 400, height: 32 }, narrow = { width: 560, height: 600 }, under = place(wide, 'sidebar', narrow);
  assert.equal(under.placed.side, 'below');
  assert.equal(under.geometry.bounds.y, wide.y + wide.height + 8);
  // Exactly enough room on the right still opens on the right.
  const edge = { x: 8, y: 100, width: 224, height: 32 }, exact = place(edge, 'sidebar', { width: 8 + 224 + 8 + 260 + 12, height: 700 });
  assert.equal(exact.placed.side, 'right');
});

test('the measured pass in main keeps the menu where the renderer put it, at every interface scale', () => {
  for (const scale of [1, 1.25, 1.5]) for (const y of [60, 240, 420]) for (const natural of [180, 262, 452]) {
    const viewport = { width: 1280 / scale, height: 820 / scale }, header = { x: 8, y: Math.min(y, viewport.height - 40), width: 224, height: 32 };
    const { geometry } = place(header, 'sidebar', viewport, natural), s = (r: Rectangle) => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale });
    const current = { kind: 'group-context', origin: geometry.origin, anchor: s(geometry.anchor), bounds: s(geometry.bounds), contentHeight: 1 };
    const measured = measuredPlacement({ current, height: geometry.contentHeight * scale, windowHeight: viewport.height * scale, scale });
    assert.ok(Math.abs(measured.y - geometry.bounds.y * scale) <= 1.01, `@${scale} header y=${header.y} natural ${natural}: main y ${measured.y} vs renderer ${geometry.bounds.y * scale}`);
  }
});

test('the window opens a new group\'s menu only once the group is on screen, and never falls back to the toolbar', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /event\.kind === 'group-context' && !event\.anchor && event\.targetTabId\) void openGroupMenu\.current\(/, 'an editor asked for without a box waits for the group');
  assert.match(app, /const groupNodeFor = /, 'it waits only for the chip or header to be in the page');
  assert.doesNotMatch(app, /settledGroupNode|still >= 2/, 'never for it to stop moving (the founder saw a second of delay)');
  assert.match(app, /await groupNodeFor\(group\.id\)/, 'it opens as soon as the group is in the page');
  // R7: the settled box cut to what the strip shows (groupAnchorBox = settledBox + visibleAnchor, tests/visible-anchor.test.ts).
  assert.match(app, /rect = node \? groupAnchorBox\(node\)/, 'at the box the group settles into, cut to what is in view');
  assert.match(app, /const box = node\.matches\('\.tab-group-badge,\.sb-group-header'\) \? settledBox\(node\)/, 'groupAnchorBox starts from the settled box');
  const controls = fs.readFileSync(new URL('../src/components/TabGroupControls.tsx', import.meta.url), 'utf8');
  assert.match(controls, /item\(t\('tabgroupcontrols\.newTabGroup'\),\(\)=>\{const created=createInlineGroup\(state,tab\.id\);close\(\);void created;\},<Plus size=\{15\}\/>,'dialog'\)/, 'the create is sent before the tab menu closes, without the 80ms pick blink');
  assert.match(app, /runtime\.getSnapshot\(\)[^;]*member = next\?\.tabs\.find/, 'it reads the new group from a fresh snapshot, not the listener\'s older state');
  assert.match(app, /sidebarGroupHeader\(group\?\.id\) \|\| Array\.from\(document\.querySelectorAll<HTMLElement>\('\.browser-tab\[data-tab-id\]/, 'without a chip or header it opens at the member tab, not the toolbar');
});
