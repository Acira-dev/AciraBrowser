/** The sidebar's list when a LAYOUT SWITCH replaces its rows (Beta 14.0; the team's rule for every sidebar motion: one interface, nothing drawn twice).
 *
 * Sidebar <-> Tabs on top + sidebar swaps the list's contents in one render: the tab rows and "New tab" go and the Shelf's sections come (Reading list, History, Downloads), or back; only Bookmarks is in both
 * lists, at another place. The list's own row motion (useFlip, AciraSidebar.tsx) is built for one change at a time and starts everything at once: the leaving rows' pictures faded while the arriving rows
 * faded in at the same places and Bookmarks slid through both, so for 300 ms two lists stood on screen ("New tab" over "Star a page or drag a tab here", "Bookmarks" over "Reading list"; the three-widths
 * sweep's F3). In a layout switch the three happen in turn instead, as numbers here (no DOM):
 *   1. the rows only the old list has fade where they stand, at once;
 *   2. the rows both lists have glide to their new place once those are gone;
 *   3. each row only the new list has comes in where it will stand, and only once no gliding row is over that place any more.
 * tests/list-switch-motion.test.ts pins it. */

/** How long the leaving rows take to go, and how long the rows that stay wait for them (at Premium; both take the speed's pace). The fade is front-loaded (useFlip's exit curve): at 70 of its 90 ms a row is under 3 %. */
export const SWITCH_LEAVE_MS = 90, SWITCH_WAIT_MS = 70;
/** How long an arriving row takes to come in, as a share of the list's spring. */
export const SWITCH_ARRIVE_SHARE = .45;

export interface SwitchMove { /** where the row stood and where it stands now (px, the list's own coordinates), and its height */ was: number; top: number; height: number }
export interface SwitchRow { top: number; height: number }
export interface SwitchPlan { /** ms the leaving rows fade over */ leave: number; /** ms the staying rows wait before they glide */ wait: number; /** per arriving row (in the order given), ms it waits before it comes in */ arrive: number[] }

/** The list's spring as useFlip samples it: 1 - (1 + wt)e^(-wt), w = 9.3, settled by t = 1 (no overshoot). */
export const listSpringAt = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - (1 + 9.3 * u) * Math.exp(-9.3 * u));

export function listSwitchPlan(moves: readonly SwitchMove[], arrivals: readonly SwitchRow[], spring: number, pace = 1): SwitchPlan {
  const leave = Math.round(SWITCH_LEAVE_MS * pace), wait = Math.round(SWITCH_WAIT_MS * pace);
  const topAt = (move: SwitchMove, ms: number) => move.was + (move.top - move.was) * listSpringAt(spring > 0 ? (ms - wait) / spring : 1);
  const arrive = arrivals.map(row => {
    // the last moment a gliding row is over this row's place (a pixel of air between them); rows that end touching it do not hold it for ever: the glide counts as over once it is within 2 px (or 6 %) of its end,
    // where the spring's long tail begins (the arriving row is still near nothing then: it starts from 0)
    let clear = wait;
    for (const move of moves) {
      if (Math.abs(move.top - move.was) < .5) continue;
      for (let ms = wait; ms <= wait + spring; ms += 4) {
        const top = topAt(move, ms), done = Math.abs(top - move.top) <= Math.max(2, Math.abs(move.top - move.was) * .06);
        if (done) break;
        if (top < row.top + row.height + 1 && top + move.height > row.top - 1) clear = Math.max(clear, ms + 4);
      }
    }
    return clear;
  });
  return { leave, wait, arrive };
}
