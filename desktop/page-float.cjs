'use strict';

// D137 (24 Nov 2026): a view switch that WIDENS the page beside a sidebar on the RIGHT (Full -> Seamless, 240/312, Premium and Fast) showed an
// occasional one-step strip at the page's moving right edge: on macOS the view's frame and its content commit separately, so a live or stepped
// glide of a growing page can show the page's backing one step short of its edge (real frames, 24 Nov 13:03: strips in 6 of 6 takes, 7 to 24
// frames, worst 109 px). The page does not glide for this switch any more: the interface view is floated over the page views
// (chrome-float.cjs), the page takes its final size at once under it, and the interface's own pictures uncover it as they move (the sidebar
// slides out, the bar fades). The interface cuts the page's final rect out of the transition's whole-window picture and hides the page's
// two pictures while it floats (src/ui/pageFloat.ts): without that cut the whole-window picture faded in over the page and veiled it to a
// third of its brightness until the interface was lowered (13:03, every float take). Pure of Electron: main hands in the float, the emitter
// and the clock; tests/page-float.test.cjs drives it with fakes.

const LIMIT_MS = 1500;

/**
 * Does this placement widen the page beside a right sidebar at a VIEW switch (its left edge staying, its width growing by 40 points or more)?
 * `viewSwitched` (createViewWatch): the window's view itself changed just now. `pageSwitch` alone is every `layout` mode switch, and a sidebar opening,
 * closing or collapsing to Mini is one too: a Sidebar -> Mini close on the right widens the page the same way, and the float's hole then cut the
 * sidebar's own surface out of the whole-window picture for its first frames (24 Nov 18:4x: black sidebar, white tiles).
 */
function widensBesideRightSidebar({ was, bounds, side, animated, pageSwitch, dockSlide, viewSwitched }) {
  if (viewSwitched !== true || !animated || pageSwitch !== true || dockSlide || side !== 'right' || !was || !bounds) return false;
  return Math.abs(was.x - bounds.x) <= 12 && bounds.width - was.width >= 40 && bounds.height >= was.height - 1;
}

/**
 * Main never raises the interface by itself (chrome-float's finding 2: the interface must have its cut-out ready, or its opaque page area covers
 * the page for the frames before it does). So `begin` tells the interface the page's final rect (in its own points) and HOLDS the placement; the
 * interface cuts the hole, then asks for the float (`edge` float:true with the rect: `raiseFor`), and only then is the interface raised and the
 * page placed at its final size, under it. The interface lowers itself near its transition's end (`edge` float:false: `end`). At LIMIT_MS main
 * finishes whatever is left: a placement never asked for is made (no float), and a float still up is lowered unless someone else (a Seamless
 * edge reveal) asked for the float since.
 */
function createPageFloat({ float, emit, scale = () => 1, later = setTimeout, cancel = clearTimeout }) {
  let timer = null, asks = 0, pending = null, raised = false, mine = 0, held = '';
  const flush = () => { if (pending) { const place = pending; pending = null; place(); } };
  /** Someone asked for the float without a page waiting (a Seamless edge reveal): our limit must not take it away from them. */
  const noteRaise = () => { asks++; };
  function begin(bounds, place) {
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (pending && key === held) { pending = place; return; }                 // the same layout again while it waits: it keeps waiting, nothing is placed early
    held = key;
    if (timer) cancel(timer);
    flush();                                                                  // a placement held for an earlier switch is made now
    pending = place; raised = false;
    const k = scale() || 1;
    emit({ type: 'page-float', rect: { x: bounds.x / k, y: bounds.y / k, width: bounds.width / k, height: bounds.height / k } });
    timer = later(() => {
      timer = null; flush();
      emit({ type: 'page-float', rect: null });
      if (raised && asks === mine) float.lower();
      raised = false;
    }, LIMIT_MS);
  }
  /** The interface has its cut-out and asks for the float: raise, then place the page at once. False when nothing waits (an ordinary float:true). */
  function raiseFor() {
    if (!pending) return false;
    float.raise(); raised = true; mine = asks;
    flush();
    return true;
  }
  /** The interface lowered itself: nothing is left for the limit to lower (a placement still held is made). */
  function end() { flush(); raised = false; }
  return { begin, raiseFor, end, noteRaise, get waiting() { return !!pending; }, get raised() { return raised; } };
}

/** How long after the window's view changed a widening placement still belongs to that view switch. */
const VIEW_SWITCH_MS = 700;

/**
 * The window's view (Full, Seamless, Compact, Focus...) as main sees it on each layout: `note` says whether it changed within VIEW_SWITCH_MS; `spend`
 * after the float fired, so one view switch floats once. A layout that comes before main's state has the new view finds no change: the page glides
 * as it did before D137 (the safe side).
 */
function createViewWatch(windowMs = VIEW_SWITCH_MS) {
  let last = null, at = -Infinity;
  return {
    note(view, now) { if (view !== last) { if (last !== null) at = now; last = view; } return now - at <= windowMs; },
    spend() { at = -Infinity; },
  };
}

module.exports = { LIMIT_MS, VIEW_SWITCH_MS, widensBesideRightSidebar, createPageFloat, createViewWatch };
