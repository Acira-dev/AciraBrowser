/** Keeps one pointer's events flowing to a stable element for the whole of a drag (R3-22).
 *
 * A dragged tab swaps places with its neighbours while the pointer is still down: React moves its DOM node, native views
 * are re-laid out, hit-testing changes under the pointer. Without an anchor, the platform can then drop the pointer's
 * stream (capture released, pointercancel) and the tab stops following the hand. The anchor is the strip itself: it is
 * never moved or unmounted by a reorder. If capture is ever lost while the button is still down, it is taken again.
 * Call the returned function when the drag ends. */
export function holdPointer(node: Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'setPointerCapture' | 'releasePointerCapture' | 'hasPointerCapture'> | null | undefined, pointerId: number): () => void {
  if (!node || !Number.isFinite(pointerId)) return () => {};
  let held = true;
  const take = () => { try { node.setPointerCapture(pointerId); } catch { /* the pointer is no longer active: nothing to hold */ } };
  const lost = (event: Event) => { if (held && (event as PointerEvent).pointerId === pointerId) take(); };
  node.addEventListener('lostpointercapture', lost);
  take();
  return () => {
    if (!held) return;
    held = false;
    node.removeEventListener('lostpointercapture', lost);
    try { if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId); } catch { /* already released */ }
  };
}
