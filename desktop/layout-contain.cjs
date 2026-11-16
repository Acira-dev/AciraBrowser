// 13.10 round 4 (laptop traces, Windows and Linux): during a Seamless float the interface asked for the Full view's page rectangle {x0,y72,W,H-72} while the page's only pane stayed at the window's edge, and the page
// really moved there. The interface now never sends it (src/ui/floatHold.ts); this is the same rule at the one door every layout comes through: a page area is the window onto its pane, it never starts below or after
// the pane it holds. A layout whose single pane starts above or before its page rectangle (by more than a few pixels) gets the pane's own rectangle as the page's, and the page card never leaves its pane.
const TOLERANCE = 8;
const box = value => !!value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]));
/** The layout to apply: `next` itself when nothing is odd, else a copy whose pageBounds is the single pane's rectangle. */
function containPage(next) {
  if (!next || !box(next.pageBounds) || !Array.isArray(next.views) || next.views.length !== 1 || !box(next.views[0].bounds)) return next;
  const page = next.pageBounds, view = next.views[0].bounds;
  if (page.y <= view.y + TOLERANCE && page.x <= view.x + TOLERANCE) return next;
  return { ...next, pageBounds: { x: view.x, y: view.y, width: view.width, height: view.height } };
}
module.exports = { containPage, TOLERANCE };
