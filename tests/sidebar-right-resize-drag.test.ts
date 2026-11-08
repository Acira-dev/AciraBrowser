import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clampSidebarWidth, draggedSidebarWidth, overSidebar, rubberBandWidth, SIDEBAR_SIZES, SIDEBAR_WIDTH, sidebarEdgeOf, sidebarKeyWidth } from '../src/ui/sidebarLayout';
import { carriedBeyondEdge, carriedState } from '../src/ui/useTabDragSurface';

// The sidebar on the right (settings.sidebarSide). Its resize grip and the tab drag out of it are the left sidebar's, seen in a mirror;
// with the sidebar on the left every number is what it was before the side existed.

const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('resize: on the left the width is what it always was, to the last bit', () => {
  for (const width of [220, 240, 255.5, 320]) for (const startX of [0, 3.25, 240, 241.5]) for (const clientX of [-40, 0, 100.75, 240, 600])
    assert.equal(draggedSidebarWidth('left', width, startX, clientX), width + clientX - startX);
});

test('resize: on the right, dragging the grip toward the window\'s left makes the sidebar wider (the left drag, mirrored)', () => {
  const view = 1280, startWidth = 240, grip = view - startWidth;
  assert.equal(draggedSidebarWidth('right', startWidth, grip, grip - 30), 270, '30px to the left: 30px wider');
  assert.equal(draggedSidebarWidth('right', startWidth, grip, grip + 20), 220, '20px to the right: 20px narrower');
  for (const width of [220, 240, 300]) for (const delta of [-90, -17.5, 0, 12, 85]) {
    // The left sidebar dragged by `delta` and the right one dragged by `-delta` (its mirror image) agree.
    assert.equal(draggedSidebarWidth('right', width, 900, 900 - delta), draggedSidebarWidth('left', width, 100, 100 + delta));
  }
});

test('resize: the rubber band and the clamp see the same width on both sides', () => {
  const viewStart = 1000;
  // Past the maximum the edge keeps following with growing resistance; past the minimum likewise; neither knows the side.
  for (const [side, toward] of [['left', 1], ['right', -1]] as const) {
    const raw = draggedSidebarWidth(side, 300, viewStart, viewStart + toward * 80);
    assert.equal(raw, 380);
    assert.equal(clampSidebarWidth(raw), SIDEBAR_WIDTH.max);
    assert.ok(rubberBandWidth(raw) > SIDEBAR_WIDTH.max && rubberBandWidth(raw) <= SIDEBAR_WIDTH.max + 24);
    const narrow = draggedSidebarWidth(side, 230, viewStart, viewStart - toward * 80);
    assert.equal(clampSidebarWidth(narrow), SIDEBAR_WIDTH.min);
  }
});

test('resize keys: an arrow goes to the next size; on the right ArrowLeft/ArrowRight swap, Home/End/Enter do not', () => {
  const sizes = SIDEBAR_SIZES;
  // On the left an arrow points where the edge goes: ArrowRight widens (the next larger size), ArrowLeft narrows.
  for (const [width, left, right] of [[168, 168, 240], [240, 168, 312], [312, 240, 312], [176, 168, 240], [301.5, 240, 312]] as const) {
    assert.equal(sidebarKeyWidth('left', 'ArrowLeft', width), left, `left ArrowLeft from ${width}`);
    assert.equal(sidebarKeyWidth('left', 'ArrowRight', width), right, `left ArrowRight from ${width}`);
    // The mirror: on the right ArrowLeft widens and ArrowRight narrows.
    assert.equal(sidebarKeyWidth('right', 'ArrowLeft', width), right, `right ArrowLeft from ${width}`);
    assert.equal(sidebarKeyWidth('right', 'ArrowRight', width), left, `right ArrowRight from ${width}`);
  }
  for (const side of ['left', 'right'] as const) {
    assert.equal(sidebarKeyWidth(side, 'Home', 300), sizes.narrow);
    assert.equal(sidebarKeyWidth(side, 'End', 300), sizes.wide);
    assert.equal(sidebarKeyWidth(side, 'Enter', 300), sizes.standard);
    for (const key of ['ArrowUp', 'ArrowDown', 'a', ' ']) assert.equal(sidebarKeyWidth(side, key, 240), null, `${side} ${key}`);
  }
});

test('the sidebar\'s page-side edge: its right edge on the left, its left edge on the right, and nothing over the sidebar without one', () => {
  const box = { left: 1040, right: 1280 };
  assert.equal(sidebarEdgeOf(box, 'left'), 1280);
  assert.equal(sidebarEdgeOf(box, 'right'), 1040);
  assert.equal(sidebarEdgeOf(undefined, 'left'), 0, 'the old fallback');
  assert.equal(sidebarEdgeOf(null, 'right'), Infinity);
  for (const side of ['left', 'right'] as const) for (const x of [-5, 0, 100, 1e6]) assert.equal(overSidebar(x, sidebarEdgeOf(null, side), side), side === 'left' ? x <= 0 : false);
});

test('over the sidebar: up to the edge on the left (as before), from the edge on the right, the edge itself inside both', () => {
  for (const x of [0, 10.5, 239.9, 240, 240.1, 900]) assert.equal(overSidebar(x, 240, 'left'), x <= 240);
  for (const x of [0, 1039.9, 1040, 1040.1, 1279, 1280]) assert.equal(overSidebar(x, 1040, 'right'), x >= 1040);
  // The mirror: the same point on a window of width V is over the right sidebar when its mirror image is over the left one.
  const view = 1280, width = 240;
  for (const x of [0, 100, 1039, 1040, 1041, 1200, 1280]) assert.equal(overSidebar(x, view - width, 'right'), overSidebar(view - x, width, 'left'));
});

test('the carried chip: on the left it is the old hysteresis exactly', () => {
  for (const was of [false, true]) for (const edge of [-1e9, 0, 36, 288.5, 1000]) for (const x of [-20, 0, 36.5, 286, 288.5, 290.5, 298.4, 298.6, 1100])
    assert.equal(carriedBeyondEdge(was, x, edge), carriedState(was, x, edge));
  assert.equal(carriedBeyondEdge(false, 300, 288, 'left'), true);
  assert.equal(carriedBeyondEdge(true, 289, 288, 'left'), false);
});

test('the carried chip: on the right it forms 10px past the sidebar\'s left edge toward the page and the row returns within 2px of it', () => {
  const edge = 1040;
  assert.equal(carriedBeyondEdge(false, 1035, edge, 'right'), false, 'still over the sidebar');
  assert.equal(carriedBeyondEdge(false, 1031, edge, 'right'), false, 'out, but not past the 10px threshold');
  assert.equal(carriedBeyondEdge(false, 1029, edge, 'right'), true, 'past 10px: the chip forms');
  assert.equal(carriedBeyondEdge(true, 1035, edge, 'right'), true, 'stays a chip while it hovers just outside');
  assert.equal(carriedBeyondEdge(true, 1039, edge, 'right'), false, 'back at the edge: the row returns');
  for (const was of [false, true]) for (const x of [900, 1020, 1029.5, 1030, 1031, 1037.9, 1038, 1038.5, 1060])
    assert.equal(carriedBeyondEdge(was, x, edge, 'right'), carriedBeyondEdge(was, -x, -edge, 'left'), 'the left hysteresis seen in a mirror');
  // Over the page the chip is formed on the right exactly where it is formed on the left over the mirrored window.
  const view = 1280;
  for (const was of [false, true]) for (const x of [10, 400, 1020, 1031, 1036]) assert.equal(carriedBeyondEdge(was, x, view - 240, 'right'), carriedBeyondEdge(was, view - x, 240, 'left'));
  assert.equal(carriedBeyondEdge(false, 500, Infinity, 'right'), true, 'no sidebar on screen: free, like the left\'s edge 0');
});

test('the sidebar wires all of it: the side reaches the grip, the drag tests and the carried chip', () => {
  const sidebar = source('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /<ResizeHandle width=\{width\} onChange=\{setWidth\} side=\{sidebarSideOf\(state\.settings\)\}\/>/);
  assert.match(sidebar, /draggedSidebarWidth\(side,drag\.current\.width,drag\.current\.x,event\.clientX\)/);
  assert.match(sidebar, /sidebarKeyWidth\(side,event\.key,width\)/);
  assert.doesNotMatch(sidebar, /point\.x<=sidebarRight\(\)|point\.x<=edge/, 'no test assumes the page is to the right of the sidebar');
  assert.equal((sidebar.match(/overSidebar\(point\.x,/g) || []).length, 2, 'finish and move both ask overSidebar');
  assert.match(sidebar, /carryChip\(current\.node,'\.split-group-open>svg',\{side\}\)/);
  const surface = source('../src/ui/useTabDragSurface.ts');
  assert.match(surface, /carriedBeyondEdge\(state\.target===1,point\.x,edge,side\)/, 'the sidebar chip forms 10px past the sidebar\'s page-side edge');
});

// Integration (beta.13): the workspace drag feedback (item 16) sticks a carried chip (a group's folder, a split's icon) to a workspace's icon with an edge far off
// on the sidebar's own side. With the sidebar on the right the page is toward smaller x, so the sentinel flips sign; the chips carry the side.
test('a group or split chip over a workspace icon sticks on either side: the sentinel edge and the side travel with the chip', () => {
  const sidebar = source('../src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /const stuck=side==='right'\?1e6:-1e6;/);
  assert.match(sidebar, /carryChip\(current\.node,'\.sb-group-folder',\{side,only:/);
  assert.match(sidebar, /current\.chip\.move\(point,stuck\);markWorkspaceDrop\(point,dropNote\(\{kind:'group'/);
  assert.match(sidebar, /current\.chip\.move\(point,workspaceDropAt\(point\)\?stuck:edge\)/);
  assert.doesNotMatch(sidebar, /chip\.move\(point,-1e6\)|\?-1e6:edge/, 'no left-only sentinel is left');
  for (const side of ['left', 'right'] as const) {
    const stuck = side === 'right' ? 1e6 : -1e6;
    for (const x of [-500, 0, 200, 900, 5000]) assert.equal(carriedBeyondEdge(false, x, stuck, side), true, `${side}: at x ${x} the chip is formed and stuck`);
  }
});
