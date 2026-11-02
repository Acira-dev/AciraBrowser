/** What the top of the sidebar shows for Favorites (R4 leftovers, coordinator): with none saved the area shows nothing, so a fresh
 *  profile has no empty rounded boxes above New tab. The drop zone appears only while a tab or a link is being dragged, floating over the top
 *  of the list so the rows never move under the pointer.
 *    'none'  Favorites are switched off in Settings: no band, no grid
 *    'grid'  at least one favorite (or the Add editor is open): the tile grid
 *    'idle'  none saved, nothing dragged: an empty band level with the toolbar row, nothing drawn
 *    'drop'  none saved, a tab or link is being dragged (or is over the zone): the floating drop zone */
export type FavoritesTop = 'none' | 'grid' | 'idle' | 'drop';

export function favoritesTop(input: { hidden: boolean; count: number; editingNew?: boolean; tabDrag?: boolean; linkDrag?: boolean; overZone?: boolean }): FavoritesTop {
  if (input.hidden) return 'none';
  if (input.count > 0 || input.editingNew) return 'grid';
  return input.tabDrag || input.linkDrag || input.overZone ? 'drop' : 'idle';
}

/** The hairline under the grid: only when there is a grid to separate. An empty Favorites area leaves the list starting at the band, as it does with Favorites off. */
export const favoritesSeparator = (count: number): boolean => count > 0;
