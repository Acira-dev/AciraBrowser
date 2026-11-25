/**
 * D159 (member, Windows, 14.2: "screen flash"): at Enter on the New Tab one frame showed the page area bare, dark where the interface had already
 * dropped its New Tab before the cover (the New Tab's picture, desktop/page-still.cjs cover) reached the screen. Main says `newtab-cover` the
 * moment it moves the cover in, before the state that drops the New Tab: the interface then keeps a copy of its New Tab standing in the page area
 * for two frames, bounded by the cover's own hold (COVER_UP_MS) and never longer than HOLD_MAX_MS, so the page area is never bare in between.
 * Only for that cover; every other navigation is untouched. The copy is inert (no events, hidden from assistive tech) and goes whatever happens.
 */
export const HOLD_MAX_MS = 50;
const bridge = (): { subscribeBrowser?: (fn: (event: unknown) => void) => () => void } | undefined => typeof window === 'undefined' ? undefined : (window as unknown as { acira?: { subscribeBrowser?: (fn: (event: unknown) => void) => () => void } }).acira;

/** Keeps a copy of the page area's New Tab for two frames (at most `holdMs`, at most HOLD_MAX_MS). Returns the copy, or null when there is nothing to keep. */
export function holdNewTab(holdMs = HOLD_MAX_MS): HTMLElement | null {
  const area = document.querySelector('.page-area'), content = area?.querySelector(':scope > .page-content');
  if (!area || !content || !content.querySelector('.nt-page')) return null;
  const copy = content.cloneNode(true) as HTMLElement;
  copy.classList.add('nt-hold'); copy.setAttribute('aria-hidden', 'true'); copy.setAttribute('inert', '');
  const a = area.getBoundingClientRect(), c = content.getBoundingClientRect();   // the copy stands exactly where the New Tab stood
  copy.style.cssText += `;position:absolute;left:${c.left - a.left}px;top:${c.top - a.top}px;width:${c.width}px;height:${c.height}px;margin:0;z-index:3;pointer-events:none`;
  area.appendChild(copy);
  let gone = false;
  const drop = () => { if (gone) return; gone = true; window.clearTimeout(bound); copy.remove(); };
  const bound = window.setTimeout(drop, Math.min(HOLD_MAX_MS, Math.max(0, holdMs)));
  requestAnimationFrame(() => requestAnimationFrame(drop));
  return copy;
}

/** Wire main's `newtab-cover` in; returns the unsubscribe. */
export function installNewTabHold(): () => void {
  const off = bridge()?.subscribeBrowser?.(raw => {
    const event = raw as { type?: string; holdMs?: unknown };
    if (event?.type === 'newtab-cover') holdNewTab(typeof event.holdMs === 'number' ? event.holdMs : HOLD_MAX_MS);
  });
  return () => { off?.(); };
}
