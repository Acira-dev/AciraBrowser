/**
 * Where the edge light sits (Beta 14, F5): beside the selected tab. Pure geometry, so a test can hold it; the sidebar's hook (components/sidebar/useEdgeLight.ts) measures and
 * siteGlowEngine.ts `placeEdgeLight` writes it. Positions are in the sidebar's own pixels, from its top.
 */
/** The light never sits closer than this to the sidebar's top or bottom: a selected row scrolled out of sight leaves the light at the edge, not off the sidebar. */
export const EDGE_MARGIN = 28;
/** Where in the sidebar's height the light rests when nothing is selected in view (before there is a row to follow). */
export const EDGE_REST = .3;
export function edgeLightY(row: { top: number; height: number } | null, side: { top: number; height: number }): number {
  if (!row || !(side.height > 0)) return Math.max(EDGE_MARGIN, side.height * EDGE_REST);
  const centre = row.top + row.height / 2 - side.top;
  return Math.min(Math.max(centre, EDGE_MARGIN), Math.max(EDGE_MARGIN, side.height - EDGE_MARGIN));
}
