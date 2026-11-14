/** The quiet around the sidebar list's scroll to the tab that was just selected (round 6, 150 %). While the list is on its way to the tab, the "current tab" pill stays away: the pill
 * docks under the list and takes its height, and the Bookmarks row it pushes into view takes more, two 36px steps in two frames before the scroll has begun, cutting the bottom rows and
 * popping both rows in. The pill is for a tab the list is scrolled away from, not for one it is about to show.
 * Every reveal takes a token; only the latest one ends the quiet, so a scroll that finishes late (or a timer left over from an earlier one) never ends a newer reveal's quiet. */
export interface RevealQuiet {
  /** A reveal begins: the quiet starts, and this is its token. */
  start(): number;
  /** The reveal with this token is over (its scroll ended, nothing scrolled, or a newer change replaced it). True when that ended the quiet, false when a newer reveal owns it. */
  end(token: number): boolean;
  /** Whether the pill must stay away right now. */
  quiet(): boolean;
}

export function revealQuiet(): RevealQuiet {
  let serial = 0, owner = 0;
  return {
    start() { owner = ++serial; return owner; },
    end(token) { if (owner !== token) return false; owner = 0; return true; },
    quiet() { return owner !== 0; },
  };
}
