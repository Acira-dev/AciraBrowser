import { carrySidebarRow } from './sidebarTabDrag';
import { motionScale } from './splitMotion';

/** A tab becoming a favorite is the bookmark's split (founder, 6 Nov: "a copy splits off the tab, morphs smoothly into the icon-only favorite
 *  tile, the other tiles make room, and the original tab stays still"). The motion itself is `split` in sidebarTabDrag.ts (one code, one timing, with
 *  the saved-page split); this file holds what the favorites side adds: the new tile is held back (the sidebar draws it at opacity 0, and
 *  leaves it out of the grid's own enter animation) until the copy has landed on it, and the copy that goes when there is no drag (the tab menu,
 *  Cmd+Shift+D, the "+" form), from the tab's row, which stays where it is. Motion off: no copy, the tile is simply there. */
const held = new Set<string>();

/** The tile of this favorite is held back while its copy is on the way. */
export const favoriteMorphing = (appId: string) => held.has(appId);
export const favoriteTile = (appId: string) => document.querySelector<HTMLElement>(`.acira-sidebar .sb-apps [data-app-id="${CSS.escape(appId)}"]`);
export const holdFavoriteTile = (appId: string) => { held.add(appId); };
export function releaseFavoriteTile(appId: string) {
  held.delete(appId);
  const tile = favoriteTile(appId);
  if (tile) { tile.style.opacity = ''; tile.removeAttribute('data-morph'); tile.removeAttribute('data-motion-skip'); }
}

/** Where the new tile will be while it is not in the page yet: the slot the grid opened under the drag, else the first slot of the empty drop target. */
export const favoriteSlot = (): DOMRect | null => (document.querySelector('.acira-sidebar .sb-apps .sb-app-gap') ?? document.querySelector('.acira-sidebar .sb-apps-ghost .sb-app-ghost'))?.getBoundingClientRect() ?? null;

/** The copy for a tab that stays in its row: it splits off the row and goes up to the tile. False (nothing held, nothing drawn) when motion is off
 *  or the row is not on screen (the sidebar closed, the row out of view): the tile then simply appears. */
export function splitFavoriteFromRow(appId: string, tabId: string): boolean {
  if (typeof document === 'undefined' || !motionScale()) return false;
  const row = document.querySelector<HTMLElement>(`.acira-sidebar .sb-tab[data-tab-id="${CSS.escape(tabId)}"]:not(.sb-flip-ghost)`), scroll = document.querySelector<HTMLElement>('.acira-sidebar .sb-scroll');
  const box = row?.getBoundingClientRect();
  if (!row || !scroll || !box || !box.width || !box.height) return false;
  const card = carrySidebarRow(row, scroll, { x: box.left + box.width / 2, y: box.top + box.height / 2 }, '', { stay: true });
  holdFavoriteTile(appId);
  card.favorite(() => favoriteTile(appId), () => releaseFavoriteTile(appId), { stay: true });
  return true;
}
