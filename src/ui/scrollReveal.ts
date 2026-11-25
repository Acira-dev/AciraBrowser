/** Scroll only this viewport. Retargeting starts from its current position. */
export function revealInViewport(viewport: HTMLElement, item: HTMLElement, duration: number) {
  const box = viewport.getBoundingClientRect(), row = item.getBoundingClientRect();
  const inset = Math.min(18, viewport.clientHeight / 8);
  const from = viewport.scrollTop;
  const delta = row.top < box.top + inset ? row.top - box.top - inset
    : row.bottom > box.bottom - inset ? row.bottom - box.bottom + inset : 0;
  const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, from + delta));
  let frame = 0;
  if (!duration || Math.abs(target - from) < 1) {
    viewport.scrollTop = target;
    return () => {};
  }
  const start = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    viewport.scrollTop = from + (target - from) * (1 - Math.pow(1 - progress, 3));
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** Scroll only `viewport`, up or down, so `item` shows: centred, or only as far as it takes (a row taller than the viewport shows its top).
 *  Never a box around it: scrollIntoView scrolls every ancestor that can scroll, the interface's own root included although its overflow
 *  is hidden, and a row near the end of a long Settings page lifted the whole window's interface (D177, Windows, 24 Nov). */
export interface RevealOptions { block?: 'nearest' | 'center' | 'start'; behavior?: ScrollBehavior }
export function revealWithin(viewport: HTMLElement, item: HTMLElement, { block = 'nearest', behavior = 'auto' }: RevealOptions = {}): boolean {
  const box = viewport.getBoundingClientRect(), row = item.getBoundingClientRect();
  const from = viewport.scrollTop, view = viewport.clientHeight, top = row.top - box.top - viewport.clientTop + from;
  const goal = block === 'center' ? top - (view - row.height) / 2 : block === 'start' ? top : top < from || row.height > view ? top : top + row.height > from + view ? top + row.height - view : from;
  const to = Math.max(0, Math.min(goal, viewport.scrollHeight - view));
  if (Math.abs(to - from) < 0.5) return false;
  viewport.scrollTo({ top: to, behavior });
  return true;
}

/** The same, in the nearest box around `item` that scrolls (overflow auto or scroll); nothing when there is none. For a line or a row in a
 *  Settings page, a dialog or a panel that has to show: the page's own scroller moves, nothing around it. */
export function revealInScroller(item: Element | null | undefined, options: RevealOptions = {}): boolean {
  if (!(item instanceof HTMLElement)) return false;
  for (let node = item.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return revealWithin(node, item, options);
  }
  return false;
}

/** The boxes that frame the interface. Their overflow is hidden, so a person can never scroll them, but a script can: scrollIntoView and
 *  focus() scroll every ancestor that can scroll. Any such scroll is put back at once (D177: after three Settings search picks on Windows the
 *  whole interface stood higher than the window, a strip of the desktop under it). */
export const INTERFACE_FRAME = 'html, body, #root, .app, .browser-root, .browser-body, .page-area, .page-content, .browser-settings';

/** Keeps every frame box at its origin. Scroll events reach a capturing listener on the document before the next frame is painted. */
export function pinInterfaceFrame(doc: Document = document): () => void {
  const onScroll = (event: Event) => {
    const node = event.target === doc ? doc.scrollingElement : event.target;
    if (!(node instanceof Element) || !node.matches(INTERFACE_FRAME)) return;
    if (node.scrollTop) node.scrollTop = 0;
    if (node.scrollLeft) node.scrollLeft = 0;
  };
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => doc.removeEventListener('scroll', onScroll, { capture: true });
}
