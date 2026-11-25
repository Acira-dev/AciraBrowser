'use strict';
// Beta 14 section V: where the page and its docked Developer tools sit inside a tab's pane. Pure arithmetic, no Electron: the dock (devtools-dock.cjs) and the tests share it.
//
// A tab's PANE is the rectangle the interface measured for it (one whole page area, or one half of a split). Docked on the right (left, bottom), DevTools takes `size` px of the
// pane's width (height) and the page keeps the rest, with a GAP between them: the same 6 px a split view leaves between two panes (src/features/split/SplitView.tsx SPLIT_GAP), where the
// divider sits. Both are cards with the page's corner radius, exactly as two panes of a split are.
//
// Chromium's own arithmetic for this is chrome/browser/devtools/devtools_contents_resizing_strategy.cc (the inspected page and the DevTools view share a rectangle, each with a minimum
// size) and chrome/browser/ui/views/frame/contents_layout_manager.cc; the minimums below are Acira's.

/**
 * Everything below in the units of the window's DIPs, for an interface at `scale` (1, 1.25, 1.5 ...): the gap is the split view's gap (6 interface px), the minimums likewise, so a dock looks the
 * same beside a 150 % interface as beside a 100 % one. `module.exports` is the scale 1; `forScale(scale)` another.
 */
function make(scale = 1) {
  scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const GAP = Math.max(1, Math.round(6 * scale));
  /** The smallest the page may be made by the divider, and the smallest the DevTools may be, along the docked axis and across it (CSS px of the window). */
  const MIN_PAGE = { width: Math.round(300 * scale), height: Math.round(200 * scale) };
  const MIN_DEVTOOLS = { width: Math.round(280 * scale), height: Math.round(180 * scale) };
  /** What a pane too small for both minimums gives DevTools at the very least (the page keeps its minimum first); under this there is no room to dock. */
  const FLOOR = Math.round(120 * scale);
  const SIDES = ['right', 'bottom', 'left'];
  const isSide = side => SIDES.includes(side);
  const vertical = side => side === 'bottom';   // the dock stacks below the page: the docked axis is the height

  const axis = side => vertical(side) ? { pos: 'y', len: 'height' } : { pos: 'x', len: 'width' };

  /** The default size along the docked axis in a pane of `outerLength`: a bit over a third of it, in sensible bounds. */
  function defaultSize(side, outer) {
    const length = vertical(side) ? outer.height : outer.width;
    return vertical(side) ? Math.round(Math.max(240 * scale, Math.min(length * .42, 560 * scale))) : Math.round(Math.max(360 * scale, Math.min(length * .38, 720 * scale)));
  }

  /**
   * The size DevTools really gets along the docked axis: `wanted` (or the default) kept between its minimum and what leaves the page its minimum. Returns null when the pane cannot hold both
   * (the dock is then not shown until the pane is bigger: the page keeps the whole pane, the DevTools stay open and hidden).
   */
  function clampSize(side, wanted, outer) {
    const a = axis(side), length = outer[a.len], min = vertical(side) ? MIN_DEVTOOLS.height : MIN_DEVTOOLS.width, minPage = vertical(side) ? MIN_PAGE.height : MIN_PAGE.width;
    const room = length - GAP - minPage;                      // the most DevTools can have while the page keeps its minimum
    if (!(room >= FLOOR)) return null;
    const size = typeof wanted === 'number' && Number.isFinite(wanted) ? Math.round(wanted) : defaultSize(side, outer);   // no saved size: the default; a drag past the minimum: the minimum
    return Math.max(Math.min(room, min), Math.min(room, size));   // never under `min`, unless the room itself is smaller (then all of it); never over the room
  }

  /** Rounded integer rectangle. */
  const rect = (x, y, width, height) => ({ x: Math.round(x), y: Math.round(y), width: Math.max(0, Math.round(width)), height: Math.max(0, Math.round(height)) });

  /**
   * The three rectangles of a docked tab, settled (`progress` 1) or part of the way (0: DevTools has no room yet, the page has the whole pane). `size` is DevTools' size along the docked axis
   * (already clamped). The page is the pane minus DevTools and the gap; DevTools sits at the docked edge; the gap between them is the divider's strip.
   */
  function dockRects(outer, side, size, progress = 1) {
    const p = Math.max(0, Math.min(1, progress)), dev = Math.round(size * p), gap = Math.round(GAP * p);
    if (side === 'right') return { page: rect(outer.x, outer.y, outer.width - dev - gap, outer.height), devtools: rect(outer.x + outer.width - dev, outer.y, dev, outer.height), divider: rect(outer.x + outer.width - dev - gap, outer.y, gap, outer.height) };
    if (side === 'left') return { page: rect(outer.x + dev + gap, outer.y, outer.width - dev - gap, outer.height), devtools: rect(outer.x, outer.y, dev, outer.height), divider: rect(outer.x + dev, outer.y, gap, outer.height) };
    return { page: rect(outer.x, outer.y, outer.width, outer.height - dev - gap), devtools: rect(outer.x, outer.y + outer.height - dev, outer.width, dev), divider: rect(outer.x, outer.y + outer.height - dev - gap, outer.width, gap) };
  }

  /** How far the dock is open, 0 to 1, read from where the page's near edge is now: the page's own glide (page-motion.cjs) is the one clock, so DevTools and the divider stay exactly beside it. */
  function progressOf(pageRect, outer, side, size) {
    const a = axis(side), total = size + GAP;
    if (!(total > 0)) return 0;
    const taken = outer[a.len] - pageRect[a.len];
    return Math.max(0, Math.min(1, taken / total));
  }

  /**
   * Where DevTools and the divider are while the page is at `pageRect`. While the dock itself is sliding (opening or closing) DevTools fills the pane from the gap after the page to
   * the docked edge, so there is never an overlap or a hole between them, whatever the page's rectangle did on that frame: the page's own glide (page-motion.cjs) is the clock and
   * `progress` is read from where the page is. Settled (`progress` 1, given by the caller) DevTools keeps its size and follows the page, so another glide of the page (the sidebar
   * opening beside it, a toolbar easing) carries DevTools along with it. At rest both are the same as `dockRects(…, 1)`.
   */
  function follow(pageRect, outer, side, size, progress) {
    const p = progress === undefined ? progressOf(pageRect, outer, side, size) : Math.max(0, Math.min(1, progress)), gap = Math.round(GAP * p), settled = p >= 1;
    // Along the docked axis DevTools stands against the page (and, while the dock slides, against the docked edge); across it DevTools has the page's own span, so a glide of the page's other
    // edges (the sidebar opening beside it, a toolbar easing) carries it along exactly.
    if (side === 'right') { const x = pageRect.x + pageRect.width + gap; return { devtools: rect(x, pageRect.y, settled ? size : outer.x + outer.width - x, pageRect.height), divider: rect(pageRect.x + pageRect.width, pageRect.y, gap, pageRect.height), progress: p }; }
    if (side === 'left') { const right = pageRect.x - gap, width = settled ? size : right - outer.x; return { devtools: rect(right - width, pageRect.y, width, pageRect.height), divider: rect(right, pageRect.y, gap, pageRect.height), progress: p }; }
    const y = pageRect.y + pageRect.height + gap;
    return { devtools: rect(pageRect.x, y, pageRect.width, settled ? size : outer.y + outer.height - y), divider: rect(pageRect.x, pageRect.y + pageRect.height, pageRect.width, gap), progress: p };
  }

  /** The size the layout of DevTools is held at while it slides (its final size, so it lays out once). `inset` is what a Windows caption box takes off the top of a right-docked DevTools. */
  function finalLayoutSize(outer, side, size, inset = 0) {
    const top = side === 'right' ? Math.max(0, Math.min(Math.round(inset) || 0, outer.height - 1)) : 0;
    return vertical(side) ? { width: Math.max(1, Math.round(outer.width)), height: Math.max(1, Math.round(size)) } : { width: Math.max(1, Math.round(size)), height: Math.max(1, Math.round(outer.height) - top) };
  }

  /**
   * Windows, when the caption buttons sit over the page area's top-right corner (Sidebar mode's notch, Seamless with nothing showing): a right-docked DevTools whose top reaches that corner
   * starts below it, so its own toolbar (the menu, the settings) is never under the window's minimise / maximise / close, the way a split's top-right pane keeps its buttons left of them
   * (src/features/split/captionCorner.ts). Returns DevTools' rectangle with its top given up; any other dock, or a pane away from the corner, is returned as it is.
   */
  function belowCaption(devtools, side, inset) {
    const top = side === 'right' ? Math.max(0, Math.min(Math.round(inset) || 0, devtools.height - 1)) : 0;
    return top ? { x: devtools.x, y: devtools.y + top, width: devtools.width, height: devtools.height - top } : devtools;
  }

  /** A divider drag: the new size from the size when the press began and how far the pointer has gone (screen px along the docked axis). Right and bottom docks grow as the pointer goes toward the page. */
  function draggedSize(side, startSize, delta, outer) {
    const toward = side === 'left' ? delta : -delta;   // right/bottom: the divider moves toward the page (left/up) as DevTools grows
    return clampSize(side, startSize + toward, outer);
  }

  /** The divider keys: arrows move it by `step` toward or away from the page; returns the new size. */
  function keyedSize(side, size, key, step, outer) {
    const grow = vertical(side) ? 'ArrowUp' : side === 'left' ? 'ArrowRight' : 'ArrowLeft', shrink = vertical(side) ? 'ArrowDown' : side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (key === grow) return clampSize(side, size + step, outer);
    if (key === shrink) return clampSize(side, size - step, outer);
    return size;
  }
  return { scale, GAP, MIN_PAGE, MIN_DEVTOOLS, FLOOR, SIDES, isSide, vertical, defaultSize, clampSize, dockRects, progressOf, follow, finalLayoutSize, belowCaption, draggedSize, keyedSize };
}

module.exports = { ...make(1), forScale: make };
