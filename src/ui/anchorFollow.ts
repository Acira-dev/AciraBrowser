import type { AnchorBox } from './settleAnchor';

/** A popup's control, followed for as long as the popup is open (D140, 22 Nov). `settleAnchor` reads the control again once after a
 * layout change; the control can also be moved later by something that is not a layout change of this component: a floating sidebar
 * letting go of the page, a sidebar's size step, the page's glide, a scroll. `read` is called once per animation frame and `keep`
 * gets every reading that differs from the last one given (or from the first one) by more than `epsilon` px on any side, so a list
 * hangs from where its field is now, not from where it was when the list opened. Returns a function that stops it. */
export function followAnchor<T extends AnchorBox>(read: () => T, keep: (anchor: T) => void, epsilon = 0.5, raf: (step: () => void) => number = requestAnimationFrame, cancel: (frame: number) => void = cancelAnimationFrame): () => void {
  let frame = 0, last: AnchorBox = read(), stopped = false;
  const moved = (a: AnchorBox, b: AnchorBox) => Math.abs(a.x - b.x) > epsilon || Math.abs(a.y - b.y) > epsilon || Math.abs(a.width - b.width) > epsilon || Math.abs(a.height - b.height) > epsilon;
  const step = () => {
    if (stopped) return;
    const next = read();
    if (moved(last, next)) { last = next; keep(next); }
    frame = raf(step);
  };
  frame = raf(step);
  return () => { stopped = true; cancel(frame); };
}
