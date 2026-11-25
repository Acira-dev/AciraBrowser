import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * The motion of the address suggestions list (brief section O, points 4 and 5; rule 12).
 *
 * The list arrives with the website's vapor: it resolves out of a soft blur (5px to 0), fades in and drops 3px into place, 220ms.
 * It leaves the same way backwards (the exit is the entrance reversed), on the panel's own 130ms close.
 * While you type, a row that is new or has changed place re-forms in its own slot with the same vapor (4px, 180ms) instead of sliding across
 * its neighbours, so two titles are never drawn on top of each other; a row that stays put does not move. Everything is WAAPI on the rows.
 */
export const VAPOR_EASE = 'cubic-bezier(.22,1,.36,1)';
export const VAPOR_IN = { duration: 220, blur: 5, rise: 3 } as const;
export const VAPOR_OUT_MS = 130;
export const REFORM = { duration: 180, blur: 4 } as const;
/** Frames of one vapor (entrance order: soft, faint and `rise` px high, then sharp, solid and in place). The arrival drops 3px (item17: translateY(-3px) to none); a row's re-form has
 *  no drop at all (item17: opacity and blur only), so it carries no transform. */
export const vaporFrames = (blur: number, rise = 0): Keyframe[] => rise
  ? [{ opacity: 0, filter: `blur(${blur}px)`, transform: `translateY(${-rise}px)` }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }]
  : [{ opacity: 0, filter: `blur(${blur}px)` }, { opacity: 1, filter: 'blur(0px)' }];

const SURFACE = '.popup-surface';
/** Run `animation` once the panel around the list is actually on screen. A panel is hidden (`data-preparing`) until its glass and size are ready, and
 *  a vapor that ran in that time would be over before anyone saw it. Without a panel (a list drawn on its own) the animation just plays. */
function whenShown(animation: Animation, host: HTMLElement): () => void {
  const surface = host.closest<HTMLElement>(SURFACE);
  if (!surface || !surface.hasAttribute('data-preparing')) return () => {};
  animation.pause();
  let timer = 0;
  const go = () => { observer.disconnect(); clearTimeout(timer); animation.play(); };
  const observer = new MutationObserver(() => { if (!surface.hasAttribute('data-preparing')) go(); });
  observer.observe(surface, { attributes: true, attributeFilter: ['data-preparing'] });
  timer = window.setTimeout(go, 800);
  return () => { observer.disconnect(); clearTimeout(timer); };
}

/** When the panel starts to close (it turns inert after having been open), play the entrance backwards over its own close; if it opens again, restore. */
function reverseOnClose(host: HTMLElement): () => void {
  const surface = host.closest<HTMLElement>(SURFACE);
  if (!surface) return () => {};
  let opened = !surface.hasAttribute('inert'), leaving: Animation | null = null;
  const observer = new MutationObserver(() => {
    const inert = surface.hasAttribute('inert');
    if (!inert) { opened = true; if (leaving) { leaving.cancel(); leaving = null; } return; }
    if (opened && !leaving) leaving = host.animate(vaporFrames(VAPOR_IN.blur, VAPOR_IN.rise), { duration: VAPOR_OUT_MS, easing: VAPOR_EASE, direction: 'reverse', fill: 'forwards' });
  });
  observer.observe(surface, { attributes: true, attributeFilter: ['inert'] });
  return () => { observer.disconnect(); leaving?.cancel(); };
}

/** `rows`: every row's id and top, in order. `speed` is the interface's animation speed (1 = as designed). `reduced`: reduced motion, nothing moves. */
export function useSuggestionMotion(list: RefObject<HTMLElement | null>, rows: readonly { id: string; top: number }[], { reduced, speed }: { reduced: boolean; speed: number }) {
  const placed = useRef<Map<string, number> | null>(null);
  const scale = 1 / Math.max(.5, speed);
  const signature = rows.map(row => `${row.id}@${row.top}`).join('|');
  // The list as a whole: arrives once, and leaves with its panel. When the panel itself carries the vapor (SheetPopupSurface, `data-panel-vapor`: its glass and
  // the list resolve out of one blur on one clock, so the two can never read as two pieces) the list adds nothing of its own.
  useLayoutEffect(() => {
    const host = list.current;
    if (!host || reduced || host.closest(SURFACE)?.hasAttribute('data-panel-vapor')) return;
    const arrival = host.animate(vaporFrames(VAPOR_IN.blur, VAPOR_IN.rise), { duration: VAPOR_IN.duration * scale, easing: VAPOR_EASE, fill: 'backwards' });
    const stopWaiting = whenShown(arrival, host), stopClosing = reverseOnClose(host);
    return () => { stopWaiting(); stopClosing(); arrival.cancel(); };
  }, [reduced]);
  // The rows while typing: re-form in place, never glide.
  useLayoutEffect(() => {
    const host = list.current, next = new Map(rows.map(row => [row.id, row.top] as [string, number])), before = placed.current;
    placed.current = next;
    if (!host || reduced || !before) return;
    for (const el of host.querySelectorAll<HTMLElement>('[data-row-id]')) {
      const id = el.dataset.rowId!, was = before.get(id);
      if (was === undefined || was !== next.get(id)) el.animate(vaporFrames(REFORM.blur), { duration: REFORM.duration * scale, easing: VAPOR_EASE, fill: 'backwards' });
    }
  }, [signature, reduced]);
}
