/** Beta 14 the team notes 17 Nov, E9: when a carried group may be measured, and how long its landing may take. Pure, so a test can hold the rules. */

/** One animation as the carry sees it: still moving, and whether it has an end (a looping one never ends and must not hold the carry). */
export interface CarryAnimation { running: boolean; finite: boolean }

/** How long the carry waits for the fold to finish drawing before it measures anyway (the fold's longest motion is the sidebar's own spring, about 400 ms at Premium). */
export const FOLD_WAIT_MS = 900;

/** The fold is fully drawn: no ghost picture of a leaving row is left in the list and no finite animation on the group is still running. A fold that has not settled by
 *  `FOLD_WAIT_MS` counts as drawn: the carry must never wait for ever. `waited` is the time since the group got its `data-collapsed`. */
export function foldDrawn(ghosts: number, animations: readonly CarryAnimation[], waited: number): boolean {
  if (waited >= FOLD_WAIT_MS) return true;
  return ghosts === 0 && !animations.some(animation => animation.running && animation.finite);
}

/** Wrap-up never depends on animation frames: whatever the landing was waiting for (a flight on frames, a mutation that never came), this timer ends it.
 *  The flight is `ms`, the commit's own wait 1500 ms, the room's last close `ms`: the fallback comes after all of them. */
export const landingDeadline = (ms: number): number => ms + 1500 + ms + 500;

/** The distance the rows after a carried group close up by (and the gap that opens where it lands): the group's folded height, its header and, for a group that holds the
 *  current tab, that tab's row. `nextTop` is where the next row of the list starts (null: the group is the last one), `blockHeight` the group's own height. */
export function foldedSpan(homeTop: number, nextTop: number | null, blockHeight: number, headerHeight: number): number {
  const span = nextTop === null ? blockHeight : nextTop - homeTop;
  return Number.isFinite(span) && span >= headerHeight - 0.5 ? span : headerHeight;
}
