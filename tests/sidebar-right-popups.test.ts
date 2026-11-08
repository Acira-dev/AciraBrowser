import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { BrowserSnapshot, Rectangle, SidebarSide } from '../src/runtime/types';
import { groupEditorPlacement, pointerAnchor, popupFromRightSidebar, popupGeometry, rowAnchor } from '../src/ui/popup';
import { menuFormGeometry } from '../src/ui/menuFormGeometry';
import { placeTooltip, tooltipWidthLimit, type TooltipRect } from '../src/ui/tooltipPlacement';
import { cardSideFor } from '../src/ui/tabCardSide';
import { mirrorSpan } from '../src/ui/sidebarSide';
const mirrorLeft = (x: number, width: number, viewport: number) => mirrorSpan(x, width, viewport).x;

// The sidebar on the right: a popup opened from it opens toward the page (to its left) and stays inside the window, the exact mirror of what a left
// sidebar's popups do. With the sidebar on the left nothing below is different from what it was.

const MARGIN = 12;
const settings = (side: SidebarSide, extra: object = {}) => ({ sidebarSide: side, verticalTabs: true, sidebarWidth: 240, ...extra });
const stateOf = (side: SidebarSide, extra: object = {}) => ({ activeTabId: 'a', tabs: [{ id: 'a', contentKind: 'web' }], bookmarks: [], downloads: [], browserProfiles: [{}], tabGroups: [], settings: settings(side, extra) }) as unknown as BrowserSnapshot;
const plain = { activeTabId: 'a', tabs: [{ id: 'a', contentKind: 'web' }], bookmarks: [], downloads: [], browserProfiles: [{}], tabGroups: [] } as unknown as BrowserSnapshot;
const windows = [{ width: 1920, height: 1040 }, { width: 1280, height: 800 }, { width: 900, height: 600 }, { width: 640, height: 480 }];
const LEFT_HUNG = ['tabs', 'page-context', 'tab-context', 'group-context', 'split-context', 'group-preview', 'strip-context', 'bookmark-context', 'favorite-edit', 'context', 'split', 'security', 'tor', 'toolbar-context', 'workspace-menu', 'workspace-context', 'workspace-edit'];
const RIGHT_HUNG = ['profile', 'downloads', 'menu', 'more-tools', 'extensions', 'bookmark-edit', 'protection', 'vpn'];
const CENTRED = ['tabs', 'switcher', 'whats-new', 'palette', 'zoom', 'appearance'];
const height = 300;
const mirror = (box: Rectangle, view: number): Rectangle => ({ ...box, x: mirrorLeft(box.x, box.width, view) });

// What the x of a popup was before the sidebar had a side (src/ui/popup.ts popupGeometry): its left edge at the anchor's x for the kinds that hang from the
// left, its right edge at the anchor's right for the others, clamped inside the window with the 12px margin.
const oldX = (kind: string, anchor: Rectangle, width: number, view: number) => Math.round(Math.max(MARGIN, Math.min(view - width - MARGIN, LEFT_HUNG.includes(kind) ? anchor.x : anchor.x + anchor.width - width)));

test('popupFromRightSidebar: only a right sidebar with the tabs in it, and only an anchor in its column', () => {
  const view = 1280, inside = { x: 1100, y: 300, width: 2, height: 2 }, page = { x: 600, y: 300, width: 2, height: 2 };
  assert.equal(popupFromRightSidebar(settings('right'), inside, view), true);
  assert.equal(popupFromRightSidebar(settings('right'), page, view), false, 'an anchor in the page');
  assert.equal(popupFromRightSidebar(settings('right'), { x: 1040, y: 0, width: 0, height: 0 }, view), true, 'the column starts at the window\'s width less the sidebar\'s');
  assert.equal(popupFromRightSidebar(settings('right'), { x: 1039, y: 0, width: 0, height: 0 }, view), false);
  assert.equal(popupFromRightSidebar(settings('right', { sidebarWidth: 320 }), { x: 970, y: 0, width: 20, height: 20 }, view), true, 'a wider sidebar, an anchor\'s centre');
  assert.equal(popupFromRightSidebar(settings('left'), inside, view), false, 'a left sidebar is never "from the right"');
  assert.equal(popupFromRightSidebar(settings('right', { verticalTabs: false }), inside, view), false, 'tabs in the strip: no sidebar to come from');
  assert.equal(popupFromRightSidebar(undefined, inside, view), false);
  assert.equal(popupFromRightSidebar({}, inside, view), false);
  assert.equal(popupFromRightSidebar({ sidebarSide: 'right', verticalTabs: true }, inside, view), true, 'no stored width: the default 240');
});

test('left: every popup lands where it always did, whatever the anchor and the window', () => {
  for (const viewport of windows) for (const kind of [...LEFT_HUNG, ...RIGHT_HUNG].filter(item => !CENTRED.includes(item)))
    for (const anchor of [pointerAnchor(6, 80), pointerAnchor(150, 400), pointerAnchor(viewport.width - 5, 90), { x: 8, y: 700, width: 224, height: 32 }, { x: viewport.width - 240, y: 44, width: 28, height: 28 }, { x: viewport.width / 2, y: 120, width: 90, height: 30 }]) {
      const a = popupGeometry(kind, stateOf('left'), viewport, anchor, height), b = popupGeometry(kind, plain, viewport, anchor, height);
      assert.deepEqual(a, b, `${kind} at ${anchor.x},${anchor.y} in ${viewport.width}: the setting changes nothing on the left`);
      assert.equal(a.bounds.x, oldX(kind, anchor, a.bounds.width, viewport.width), `${kind} at ${anchor.x} in ${viewport.width}`);
    }
});

test('right, but the anchor is not in the sidebar (or there is no sidebar): the same place as ever', () => {
  for (const viewport of windows) for (const kind of [...LEFT_HUNG, ...RIGHT_HUNG].filter(item => !CENTRED.includes(item))) {
    const page = [pointerAnchor(80, 200), pointerAnchor(viewport.width - 260, 90), { x: viewport.width - 400, y: 44, width: 28, height: 28 }];
    for (const anchor of page) assert.deepEqual(popupGeometry(kind, stateOf('right'), viewport, anchor, height), popupGeometry(kind, plain, viewport, anchor, height), `${kind} from the page at ${anchor.x}`);
    const column = pointerAnchor(viewport.width - 100, 200);
    assert.deepEqual(popupGeometry(kind, stateOf('right', { verticalTabs: false }), viewport, column, height), popupGeometry(kind, plain, viewport, column, height), `${kind}: tabs in the strip`);
  }
});

test('right: a menu opened at the pointer in the sidebar hangs toward the page, touching the pointer, inside the window: the left sidebar\'s menu, mirrored', () => {
  for (const viewport of windows) for (const kind of ['tab-context', 'group-context', 'bookmark-context', 'split-context', 'strip-context', 'workspace-context'])
    for (const dx of [6, 40, 110, 200, 234]) for (const y of [8, 60, 245, viewport.height / 2, viewport.height - 40]) {
      const x = viewport.width - 240 + dx, anchor = pointerAnchor(x, y), at = `${kind} at ${x},${y} in ${viewport.width}x${viewport.height}`;
      const right = popupGeometry(kind, stateOf('right'), viewport, anchor, height, { target: { contentKind: 'web' } }), b = right.bounds;
      assert.ok(b.x >= MARGIN && b.x + b.width <= viewport.width - MARGIN && b.y >= MARGIN && b.y + b.height <= viewport.height - MARGIN, `${at}: inside the window (${b.x},${b.y} ${b.width}x${b.height})`);
      assert.equal(b.x, Math.max(MARGIN, Math.min(anchor.x + anchor.width - b.width, viewport.width - b.width - MARGIN)), `${at}: its right edge is the pointer's (clamped)`);
      assert.ok(b.x + b.width <= x + 2 + .5 || b.x === viewport.width - b.width - MARGIN, `${at}: it does not run on to the right of the pointer, toward the window edge, unless the window ends there`);
      // The same click on the left sidebar of a window seen in a mirror.
      const left = popupGeometry(kind, stateOf('left'), viewport, mirror(anchor, viewport.width), height, { target: { contentKind: 'web' } });
      assert.deepEqual(mirror(b, viewport.width), left.bounds, `${at}: the mirror of the left sidebar's menu`);
      assert.equal(right.bounds.y, left.bounds.y, `${at}: vertically the same`);
    }
});

test('right: a menu hung from a row (opened with the keyboard) or a tile hangs from the row\'s window-side edge toward the page', () => {
  const view = { width: 1280, height: 800 };
  for (const kind of ['tab-context', 'favorite-edit', 'workspace-menu', 'workspace-context']) {
    const row = { x: view.width - 240 + 6, y: 200, width: 228, height: 32 };
    const { bounds } = popupGeometry(kind, stateOf('right'), view, row, height), left = popupGeometry(kind, stateOf('left'), view, { ...row, x: 6 }, height);
    assert.equal(bounds.x + bounds.width, Math.min(row.x + row.width, view.width - MARGIN), `${kind}: right edges together`);
    assert.deepEqual(mirror(bounds, view.width), left.bounds, `${kind}: the left sidebar's row menu, mirrored`);
  }
});

test('right: the kinds that hang from the anchor\'s right edge (the footer\'s profile and downloads, the toolbar menu in the sidebar) already open toward the page', () => {
  for (const viewport of windows) for (const kind of ['profile', 'downloads', 'menu', 'extensions']) for (const anchor of [{ x: viewport.width - 230, y: viewport.height - 44, width: 200, height: 32 }, { x: viewport.width - 224, y: 60, width: 28, height: 28 }]) {
    const a = popupGeometry(kind, stateOf('right'), viewport, anchor, height), b = popupGeometry(kind, plain, viewport, anchor, height);
    assert.deepEqual(a, b, `${kind}: unchanged`);
    assert.ok(a.bounds.x + a.bounds.width <= anchor.x + anchor.width + 0.5 || a.bounds.x === viewport.width - a.bounds.width - MARGIN, `${kind}: ends at the anchor's right edge or the window's margin`);
    assert.ok(a.bounds.x >= MARGIN && a.bounds.x + a.bounds.width <= viewport.width - MARGIN, `${kind}: inside the window`);
  }
});

test('the group editor on the right: beside the header on its left (toward the page), or under it when neither side has room', () => {
  const place = (header: Rectangle, view: { width: number; height: number }, side: SidebarSide) => {
    const first = popupGeometry('group-context', stateOf(side), view, header, height), placed = groupEditorPlacement(header, 'sidebar', view, first.contentHeight, first.bounds.width, side);
    return { placed, geometry: popupGeometry('group-context', stateOf(side), view, placed.anchor, height, { align: placed.align }) };
  };
  for (const view of [{ width: 1280, height: 820 }, { width: 1920, height: 1040 }, { width: 853, height: 547 }]) for (const y of [60, 180, view.height / 2, view.height - 80, view.height - 40]) {
    const header = { x: view.width - 240 + 8, y, width: 224, height: 32 }, { placed, geometry } = place(header, view, 'right'), b = geometry.bounds;
    const at = `header at y=${y} in ${view.width}x${view.height}`;
    assert.equal(placed.side, 'left', at);
    assert.equal(placed.align, 'end', at);
    assert.equal(b.x + b.width, header.x - 8, `${at}: right edge 8px left of the header`);
    assert.ok(b.y <= header.y + header.height && b.y + b.height >= header.y, `${at}: level with the header`);
    assert.ok(b.x >= MARGIN && b.y >= MARGIN && b.y + b.height <= view.height - MARGIN, `${at}: inside the window`);
    const left = place({ ...header, x: 8 }, view, 'left');
    assert.equal(left.placed.side, 'right', 'the left sidebar\'s editor opens on the right of its header');
    assert.deepEqual(mirror(b, view.width), left.geometry.bounds, `${at}: the left sidebar's editor, mirrored`);
  }
  // No room on either side (a narrow window): under the header, its right edge on the header's.
  const narrow = { width: 400, height: 600 }, header = { x: 160, y: 200, width: 224, height: 32 }, { placed, geometry } = place(header, narrow, 'right');
  assert.equal(placed.side, 'below');
  assert.equal(placed.align, 'end');
  assert.equal(geometry.bounds.y, header.y + header.height + 8);
  assert.equal(geometry.bounds.x + geometry.bounds.width, header.x + header.width, 'hung from the header\'s right edge');
  // Left is the old function, argument for argument.
  for (const view of [{ width: 1280, height: 820 }, narrow]) for (const where of ['strip', 'sidebar'] as const) for (const x of [8, 160, 900]) {
    const head = { x, y: 300, width: 224, height: 32 };
    assert.deepEqual(groupEditorPlacement(head, where, view, 262), groupEditorPlacement(head, where, view, 262, 260, 'left'));
  }
  assert.equal(groupEditorPlacement({ x: 100, y: 300, width: 100, height: 26 }, 'strip', { width: 1280, height: 800 }, 262, 260, 'right').align, 'start', 'a tab strip does not care which side the sidebar is on');
});

test('a menu opened from the keyboard on a row of a right sidebar hangs 36px in from the row\'s window-side edge', () => {
  assert.deepEqual(rowAnchor({ left: 6, top: 32, bottom: 64, width: 228 }), { x: 42, y: 60, width: 2, height: 2 }, 'left: as before');
  assert.deepEqual(rowAnchor({ left: 6, top: 32, bottom: 64, width: 228 }, 'left'), { x: 42, y: 60, width: 2, height: 2 });
  const view = 1280, row = { left: mirrorLeft(6, 228, view), top: 32, bottom: 64, width: 228 };
  const right = rowAnchor(row, 'right'), left = rowAnchor({ left: 6, top: 32, bottom: 64, width: 228 });
  assert.deepEqual(mirror(right, view), left, 'the left anchor, mirrored');
  assert.equal(right.x + right.width, row.left + row.width - 36);
  const { bounds } = popupGeometry('bookmark-context', stateOf('right'), { width: view, height: 800 }, right, height);
  assert.equal(bounds.x + bounds.width, right.x + right.width, 'the menu hangs toward the page from that point');
});

test('a child form of a popup that opens from the sidebar goes toward the page', () => {
  for (const view of [{ width: 900, height: 700 }, { width: 1280, height: 800 }, { width: 1920, height: 1040 }]) {
    const trigger = { x: 0, y: 300, width: 300, height: 30 };
    const parentRight = popupGeometry('profile', stateOf('right'), view, { x: view.width - 230, y: view.height - 44, width: 200, height: 32 }, 160).bounds;
    assert.equal(menuFormGeometry(parentRight, { ...trigger, x: parentRight.x }, view, 220).side, 'left', `${view.width}: a right sidebar's popup is at the window's right: its form goes left`);
    const parentLeft = popupGeometry('profile', stateOf('left'), view, { x: 20, y: view.height - 44, width: 200, height: 32 }, 160).bounds;
    assert.equal(menuFormGeometry(parentLeft, { ...trigger, x: parentLeft.x }, view, 220).side, 'right', `${view.width}: a left sidebar's popup's form goes right (unchanged)`);
  }
});

test('a sidebar label fits the room beside the page, on whichever side the sidebar is', () => {
  const view = 1280, mac = { left: 0, right: 86, top: 0, bottom: 32 };
  // The left sidebar: the old answer (tests/tooltip-placement.test.ts).
  const page = { left: 240, right: 1274, top: 36, bottom: 714 }, favorite = { left: 12, right: 80, top: 40, bottom: 80 };
  assert.equal(tooltipWidthLimit(favorite, page, view, 'left'), 224);
  assert.equal(tooltipWidthLimit(favorite, page, view), 224, 'the root says left by default');
  assert.equal(tooltipWidthLimit(favorite, null, 180, 'left'), 164);
  assert.equal(tooltipWidthLimit({ left: 400, right: 440, top: 100, bottom: 130 }, page, view, 'left'), 320, 'a trigger over the page is not a sidebar label');
  // The right sidebar: the column past the page's right edge.
  const pageRight = { left: 6, right: view - 240, top: 36, bottom: 714 }, tile = { left: view - 228, right: view - 160, top: 40, bottom: 80 };
  assert.equal(tooltipWidthLimit(tile, pageRight, view, 'right'), 224, 'the same 224 as the left sidebar\'s label');
  assert.equal(tooltipWidthLimit(tile, pageRight, view, 'left'), 320, 'the left rule does not look past the page\'s right edge');
  assert.equal(tooltipWidthLimit({ left: 400, right: 440, top: 100, bottom: 130 }, pageRight, view, 'right'), 320);
  assert.equal(tooltipWidthLimit(tile, null, 180, 'right'), 164);
  // A label for a row opens beside the row toward the page (when no native website is under it): on the left of the right sidebar's row, on the right of the left one's.
  const flipped = (box: TooltipRect): TooltipRect => ({ left: view - box.right, right: view - box.left, top: box.top, bottom: box.bottom });
  const row = { left: view - 234, right: view - 6, top: 200, bottom: 232 }, size = { width: view, height: 720 }, w = 200;
  const tip = placeTooltip(row, w, size, null, mac, 24, true), mirrored = placeTooltip(flipped(row), w, size, null, mac, 24, true);
  assert.ok(tip && mirrored);
  assert.equal(tip.side, 'left');
  assert.equal(mirrored.side, 'right');
  assert.equal(tip.x, view - mirrored.x, 'the same tip, mirrored');
  assert.ok(tip.x + w / 2 <= row.left - 8 + .5 && tip.x - w / 2 >= 8, 'between the window\'s margin and the row');
  // Over a native website the page is no place for it, on either side: it goes below (or above) the row, the same way.
  const over = placeTooltip(row, 200, size, pageRight, mac, 24, true), overMirrored = placeTooltip(flipped(row), 200, size, { left: 240, right: view - 6, top: 36, bottom: 714 }, mac, 24, true);
  assert.ok(over && overMirrored);
  assert.equal(over.side, overMirrored.side);
  assert.equal(over.y, overMirrored.y);
});

test('the tab hover card asks to open toward the page: on the left of a right sidebar\'s rows, as before for the left one', () => {
  const width = 1280;
  assert.equal(cardSideFor(false, 100, width, 'left'), 'below', 'a horizontal or compact strip tab');
  assert.equal(cardSideFor(false, 1200, width, 'right'), 'below', 'a strip tab, whatever side the sidebar is on');
  assert.equal(cardSideFor(true, 120, width, 'left'), 'right', 'a left sidebar row');
  assert.equal(cardSideFor(true, 1160, width, 'right'), 'left', 'a right sidebar row');
  assert.equal(cardSideFor(true, 700, width, 'right'), 'left', 'the side, not where the row is while the sidebar slides');
  assert.equal(cardSideFor(true, 700, width, 'left'), 'left', 'the old guess from the row\'s place, unchanged for the left');
  assert.equal(cardSideFor(true, 640, width, 'left'), 'right');
  const hover = fs.readFileSync(new URL('../src/ui/tabHoverCard.ts', import.meta.url), 'utf8');
  assert.match(hover, /cardSideFor\(sidebarRow, box\.left \+ box\.width \/ 2, window\.innerWidth, rootSidebarSide\(\)\)/);
  assert.match(hover, /cardSide\(row\), cardFloor\(row\)/, 'the hover message still carries the side and the floor');
});

test('the toasts that sit over the content leave the sidebar\'s room on the right when the sidebar is there', () => {
  const transient = fs.readFileSync(new URL('../src/styles/transient.css', import.meta.url), 'utf8'), artwork = fs.readFileSync(new URL('../src/styles/artwork-toast.css', import.meta.url), 'utf8');
  assert.match(transient, /:root:root:root \.t-solo \{[^}]*left: var\(--navigation-width, 0px\);[^}]*right: 0;/, 'the left rule is as it was');
  assert.match(transient, /:root:root:root\[data-sidebar-side=right\] \.t-solo \{\s*left: 0;\s*right: var\(--navigation-width, 0px\);\s*\}/);
  assert.match(artwork, /--toast-edge: calc\(var\(--navigation-width, 0px\) \+ 16px\);\s*position: fixed; top: auto; right: auto; bottom: 16px; left: var\(--toast-edge\);/, 'the left rule is as it was');
  assert.match(artwork, /:root\[data-sidebar-side=right\] \.app\.style-acira \.toast\[data-artwork-toast\] \{ left: 16px; \}/);
  // The override is declared after the rule it overrides and is more specific, so it wins at any order of loading.
  assert.ok(transient.indexOf('[data-sidebar-side=right] .t-solo') > transient.indexOf(':root:root:root .t-solo {'));
});
