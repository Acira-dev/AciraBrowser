/** Whether the Favorites panel (the stack's extras) is open, kept in memory per window and per profile (Beta 14, E6 of the team's notes of 17 Nov).
 *
 *  The extras stay open until the person folds them (the fold pill, Esc inside the panel, a drag out, or no folded Favorites left): a click on a tab, the page or the toolbar leaves them be, so
 *  a person can flip between many Favorites. The open state is not part of the sidebar's own React state, because that component is drawn again by a workspace switch, by Favorites moving
 *  between the top and the bottom, and by the sidebar changing mode; it would come back folded each time. It is not kept across a restart, and a new window starts folded. */
const open = new Map<string, true>();

/** One entry per window and profile: the interface runs once per window, the id is there for a UI that is ever shared. */
export const favoritesPanelKey = (windowId: string | undefined, profileId: string) => `${windowId ?? ''}:${profileId}`;

export const favoritesPanelWanted = (key: string) => open.has(key);

export function setFavoritesPanelWanted(key: string, on: boolean) {
  if (on) open.set(key, true); else open.delete(key);
}

/** Test seam: forget everything (a restart). */
export const resetFavoritesPanelState = () => open.clear();
