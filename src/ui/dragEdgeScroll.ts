/** A list scrolls while a tab is carried near one of its ends, as in Chrome and Arc: the sidebar's tab list up and down, the top and compact
 * strips sideways. The speed grows with how far the pointer is into the edge band (squared, so the first pixels only creep), and it keeps going
 * while the pointer rests there. It runs on animation frames, only while a band is reached and the list can still move that way. */
export const EDGE_BAND = 36;
/** px per second with the pointer at the very edge. */
export const EDGE_SPEED = 720;

/** Signed speed for a pointer at `pointer` on a list whose visible span is `start`..`end`: negative toward the start, positive toward the end, 0 in
 * the middle. `beyond`: past the list's end the speed stays at its most (a strip, whose pointer may leave it sideways) or stops (the sidebar, where
 * the pinned tiles and saved pages above and below are drop targets of their own). A list shorter than two bands shares it between both ends. */
export function edgeSpeed(pointer: number, start: number, end: number, beyond: 'max' | 'none' = 'max', band = EDGE_BAND, max = EDGE_SPEED): number {
  if (!Number.isFinite(pointer) || end <= start) return 0;
  if (beyond === 'none' && (pointer < start || pointer > end)) return 0;
  const zone = Math.min(band, (end - start) / 2.5), intoStart = start + zone - pointer, intoEnd = pointer - (end - zone);
  if (intoStart > 0) return -max * Math.min(1, intoStart / zone) ** 2;
  if (intoEnd > 0) return max * Math.min(1, intoEnd / zone) ** 2;
  return 0;
}

export interface EdgeScroller {
  /** Where the pointer is now on the list's axis (client px); starts the frames if a band is reached. */
  update(pointer: number): void;
  /** The drag ended or left the list: no more scrolling. */
  stop(): void;
  /** How far it has scrolled the list since it was made (px, signed). */
  readonly scrolled: number;
}

/** `onStep(delta)` runs after every frame that moved the list by `delta` px (the sidebar reads the drop under the resting pointer again; a strip needs
 * nothing: motion's drag follows a scrolling ancestor itself, keeping the tab under the pointer, and its Reorder reads the slot). `span`: the list's
 * visible extent on the axis when more than the scroller shows it (the sidebar's active-tab peek, pinned at its end while that tab is out of view: the
 * band then ends with the peek and moves only a few px when the peek comes or goes). `limit`: the scroll positions the drag may reach, when the list is
 * only part of what its scroller holds (the sidebar's saved pages follow its tabs). `band`: the depth of each edge band (px). */
export function createEdgeScroller({ axis, scroller, beyond = 'max', band = EDGE_BAND, span, limit, onStep }: { axis: 'x' | 'y'; scroller: () => HTMLElement | null; beyond?: 'max' | 'none'; band?: number; span?: (node: HTMLElement) => { start: number; end: number }; limit?: (node: HTMLElement) => { min: number; max: number }; onStep?: (delta: number) => void }): EdgeScroller {
  let pointer: number | null = null, frame = 0, last = 0, scrolled = 0;
  const tick = (now: number) => {
    frame = 0;
    const node = scroller();
    if (!node || pointer === null) { last = 0; return; }
    const box = node.getBoundingClientRect(), extent = span?.(node) ?? { start: axis === 'x' ? box.left : box.top, end: axis === 'x' ? box.right : box.bottom }, speed = edgeSpeed(pointer, extent.start, extent.end, beyond, band);
    const room = axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight, at = axis === 'x' ? node.scrollLeft : node.scrollTop, bounds = limit?.(node);
    const low = Math.max(0, bounds?.min ?? 0), high = Math.min(room, bounds?.max ?? room);
    if (!speed || room <= 0 || (speed < 0 && at <= low) || (speed > 0 && at >= high)) { last = 0; return; }
    const elapsed = last ? Math.min(48, now - last) : 16;
    last = now;
    const goal = Math.max(low, Math.min(high, at + speed * elapsed / 1000));
    if (axis === 'x') node.scrollLeft = goal; else node.scrollTop = goal;
    const moved = (axis === 'x' ? node.scrollLeft : node.scrollTop) - at;
    if (moved) { scrolled += moved; onStep?.(moved); }
    frame = requestAnimationFrame(tick);
  };
  return {
    update(next) { pointer = next; if (!frame) frame = requestAnimationFrame(tick); },
    stop() { pointer = null; cancelAnimationFrame(frame); frame = 0; last = 0; },
    get scrolled() { return scrolled; },
  };
}
