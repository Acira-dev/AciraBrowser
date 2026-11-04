/** A popup's control read again once it has stopped moving. A layout change moves the toolbar over a few frames (the new row
 * arrives by a transform and the classes that place it follow a frame later), so a control read at the commit can be where
 * it is leaving. `read` is called once per animation frame; `keep` gets the first reading that stayed the same (to the pixel)
 * for `frames` frames, or the last one after `limit` frames. Returns a function that stops it. */
export type AnchorBox = { x: number; y: number; width: number; height: number };
export function settleAnchor<T extends AnchorBox>(read: () => T, keep: (anchor: T) => void, frames = 3, limit = 90, raf: (step: () => void) => number = requestAnimationFrame, cancel: (frame: number) => void = cancelAnimationFrame): () => void {
  let frame = 0, steady = 0, seen = '', count = 0;
  const step = () => {
    const anchor = read(), key = [anchor.x, anchor.y, anchor.width, anchor.height].map(Math.round).join();
    steady = key === seen ? steady + 1 : 0; seen = key;
    if (steady >= frames || ++count > limit) { keep(anchor); return; }
    frame = raf(step);
  };
  frame = raf(step);
  return () => cancel(frame);
}
