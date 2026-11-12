/** The sidebar comes in three sizes (item 32). The width is still one number, `settings.sidebarWidth`, shared by every window, but it is always one of
 * these three: the reducer and the restore snap whatever they are given (an older profile's 250 or 300) to the nearest size, so the setting always
 * equals one of the three pictures in Settings › Tabs › Sidebar.
 *
 * The widths come from the Favorites grid. The grid has 12px of padding on each side and 6px gaps; with today's 68px tile, N across needs
 * 24 + 6(N-1) + 68N px: 166, 240, 314. Rounded to 168, 240 and 312 they are 72px apart, so the tile is the same size at every size and only the number
 * per row changes (2, 3 and 4). Pure: no DOM, no React, because main's bundle imports it too (runtime/core.ts). */
export const SIDEBAR_SIZES = { narrow: 168, standard: 240, wide: 312 } as const;
export type SidebarSize = keyof typeof SIDEBAR_SIZES;
export const SIDEBAR_SIZE_ORDER: readonly SidebarSize[] = ['narrow', 'standard', 'wide'];
/** Where a width stops being one size and becomes the next: the midpoints. A drag lands on the nearer size, and the Favorites grid reflows at the
 * same two widths, so the grid shows where a release would land. */
export const SIDEBAR_SIZE_BREAKS = { narrowStandard: 204, standardWide: 276 } as const;

export function sizeOf(width: unknown): SidebarSize {
  const value = typeof width === 'number' && Number.isFinite(width) ? width : SIDEBAR_SIZES.standard;
  return value < SIDEBAR_SIZE_BREAKS.narrowStandard ? 'narrow' : value < SIDEBAR_SIZE_BREAKS.standardWide ? 'standard' : 'wide';
}
/** The width of the nearest size: 168, 240 or 312 (anything that is not a number is Standard). */
export const snapSidebarWidth = (width: unknown): number => SIDEBAR_SIZES[sizeOf(width)];
/** The next smaller (-1) or larger (+1) size; the ends stay where they are. */
export const steppedSize = (size: SidebarSize, direction: -1 | 1): SidebarSize => SIDEBAR_SIZE_ORDER[Math.max(0, Math.min(SIDEBAR_SIZE_ORDER.length - 1, SIDEBAR_SIZE_ORDER.indexOf(size) + direction))];

/** Favorites per row at a size. */
export const FAVORITES_ACROSS: Record<SidebarSize, 2 | 3 | 4> = { narrow: 2, standard: 3, wide: 4 };
/** How many columns the grid has. Narrow and Wide are strict (2 and 4). Standard is 3, except for the counts where 3 leaves a ragged last row and 4
 * does not (4 or 8 tiles): they keep 4 across, as they always have, so no existing grid moves when the sizes arrive. */
export function favoriteColumns(size: SidebarSize, tiles: number): number {
  if (size !== 'standard') return FAVORITES_ACROSS[size];
  return tiles >= 5 && tiles % 3 !== 0 && tiles % 4 === 0 || tiles === 4 ? 4 : 3;
}
