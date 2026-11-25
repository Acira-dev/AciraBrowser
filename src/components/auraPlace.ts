/** Where the aura picker's popover stands (14.1, components/AuraColourPopover.tsx). Kept apart from the component so the rule is tested
 *  without the picker's styles (tests/own-colours.test.ts). */
const WIDTH = 300, GAP = 10, EDGE = 12;
export type Box = { left: number; top: number; right: number; bottom: number };
export type Place = { anchor: Box; area: Box };
/** What of the trigger's page is on screen: the window, cut by every scrolling or clipping box round the trigger (Settings' own scroller sits
 *  under the toolbar, so the picker never covers the toolbar or the address field). */
export function visibleArea(anchor: HTMLElement): Box {
  const area = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (let node = anchor.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowY === 'visible' && style.overflowX === 'visible') continue;
    const r = node.getBoundingClientRect();
    area.left = Math.max(area.left, r.left); area.top = Math.max(area.top, r.top); area.right = Math.min(area.right, r.right); area.bottom = Math.min(area.bottom, r.bottom);
  }
  return area;
}
/** Under its trigger when it fits in that area; else above it; else BESIDE it (right, else left), as near the trigger's middle as the area
 *  allows. Never over the area's edge while it fits in it at all (a picker taller than the area starts at its top). Exported for the tests. */
export function popoverPlace({ anchor: r, area }: Place, height: number, width = WIDTH) {
  const lo = area.top + EDGE, hi = area.bottom - EDGE, sideways = (x: number) => Math.max(area.left + EDGE, Math.min(x, area.right - width - EDGE));
  if (!height || r.bottom + GAP + height <= hi) return { left: sideways(r.left - 8), top: r.bottom + GAP };
  if (r.top - GAP - height >= lo) return { left: sideways(r.left - 8), top: r.top - GAP - height };
  const middle = Math.max(lo, Math.min((r.top + r.bottom) / 2 - height / 2, hi - height));
  const right = r.right + GAP, left = r.left - GAP - width;
  return { left: right + width <= area.right - EDGE || left < area.left + EDGE ? sideways(right) : left, top: middle };
}

