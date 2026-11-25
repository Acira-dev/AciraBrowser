/** Beta 14: the Mini sidebar's intent numbers and the pure decisions made from them (ui/miniRail.ts does the listening). The numbers are the approved sample's, verbatim
 * (the reference sample, round 6). Pure: no DOM, no timers, so tests/mini-intent.test.ts can drive them with sample series. */
export type MiniSpeed = 'premium' | 'fast' | 'off';
export interface Sample { x: number; y: number; t: number }

export const REST_PX = 6;          // moved less than this ...
export const REST_MS = 60;         // ... in this long: the pointer is resting
export const DWELL: Readonly<Record<MiniSpeed, number>> = { premium: 180, fast: 120, off: 120 };   // rest this long on the rail's empty space: it opens
export const DWELL_FAVORITES = 420;                                                                  // over the Favorites column the wheel gets the first word
export const DWELL_ITEM = 700;     // a rest on an icon (before a click) opens only after this
export const PREPARE_AHEAD = 140;  // the page's still for the glass is taken this long before the open, never earlier
export const GRACE: Readonly<Record<MiniSpeed, number>> = { premium: 300, fast: 200, off: 200 };   // after leaving, before it closes (never restarted by jitter)
export const LEEWAY = 8;           // around the open sidebar that still counts as on it
export const MIN_VISIBLE = 400;    // once open, at least this long (no flash)
export const LOCKOUT = 250;        // no re-open right after a close (a jittery pointer cannot flicker it)
export const RETURN_MS = 60;       // a real return (resting this long inside) cancels a running close wait
export const X_GUARD = 300;        // a tab's x that appeared under a resting pointer ignores clicks this long (and until the pointer moves)

/** When the current rest began: the first sample after the last one that was REST_PX or more away from where the pointer is now (the pointer arriving and slowing down counts from when it slows). */
export function restStart(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (!last) return 0;
  let farAt = -1;
  for (let i = samples.length - 1; i >= 0; i--) if (Math.hypot(samples[i].x - last.x, samples[i].y - last.y) >= REST_PX) { farAt = i; break; }
  return farAt < 0 ? samples[0].t : Math.max(samples[farAt].t, samples[farAt + 1]?.t ?? samples[farAt].t);
}
/** How long a rest must last before the sidebar opens: an icon waits longest (usually the moment before a click), the Favorites column a little longer than empty rail space (the wheel is how it is used). */
export function dwellFor(a: { closing: boolean; overItem: boolean; overFavorites: boolean; speed: MiniSpeed }): number {
  return a.closing ? RETURN_MS : a.overItem ? DWELL_ITEM : a.overFavorites ? Math.max(DWELL_FAVORITES, DWELL[a.speed]) : DWELL[a.speed];
}
/** Whether a rest of `rested` ms with `dwell` to go asks for the page's still now (a rest that ends in a click never pays for one). */
export const stillDue = (rested: number, dwell: number): boolean => rested >= Math.max(REST_MS, dwell - PREPARE_AHEAD);
/** Pointer on the rail (closed) or on the opening/open sidebar plus nothing, in px from the sidebar's window edge; a button held, a lockout or a pointer outside the window never count. */
export function onRail(a: { inside: boolean; fromEdge: number; y: number; closing: boolean; width: number; buttons: number; now: number; lockUntil: number; rail: number }): boolean {
  return a.inside && a.fromEdge >= 0 && a.y >= 0 && a.fromEdge < (a.closing ? a.width : a.rail) && a.buttons === 0 && a.now >= a.lockUntil;
}
/** The open sidebar is closed by a pointer that left it once GRACE has passed since it left and it has been open MIN_VISIBLE. */
export const closeDue = (a: { now: number; leaveAt: number; openedAt: number; speed: MiniSpeed }): boolean => a.leaveAt > 0 && a.now - a.leaveAt >= GRACE[a.speed] && a.now - a.openedAt >= MIN_VISIBLE;
