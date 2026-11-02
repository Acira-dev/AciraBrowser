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
