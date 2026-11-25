/** The Mini rail's pure geometry (no DOM access, so a test can pin it): the Favorites band and where a row's centre is in the sidebar's own box.
 *
 * The Mini rail's Favorites band (AJ: one column, five visible, the column starts 11 px from the top, 19 px of air before the "+"; the band is 177 px with five or more).
 * With fewer than five Favorites the column is only as tall as they are (a row is 32 px) and the band shrinks by the rows that are not there: three Favorites sat above a gap of
 * 80 px that held nothing (reported 16 Nov). The rail still only ever ADDS to the normal sidebar's own region (AciraSidebar's --mini-band-dy), so a band under the region's natural
 * height adds nothing and open stays exactly the normal sidebar. Pure numbers, so a test can pin them. */
export const MINI_BAND = 177;
export const MINI_COLUMN = 160;
export const MINI_ROW = 32;
/** D14: Favorites on the sidebar's BOTTOM edge. The band's 177 px end 6 px under the column; at the top that is followed by the "+" row's 19 px of air, at the bottom by the footer's line, so the faded fifth tile lay against it (6 px) and read as cut off. The region stands this much higher in the bottom place, so the fade ends 19 px above the footer, as it does above the "+" at the top. */
export const MINI_BOTTOM_AIR = 13;
/** The column's height for this many Favorites in it: whole rows, five at most (the rest is reached by the wheel), the full column when there are none to count. */
export const miniColumn = (rows: number): number => rows > 0 ? Math.min(MINI_COLUMN, Math.round(rows) * MINI_ROW) : MINI_COLUMN;
/** The band's height: the full 177 px less the rows the column does not have. */
export const miniBand = (rows: number): number => MINI_BAND - (MINI_COLUMN - miniColumn(rows));

/** A row's vertical centre in the sidebar's own box, from layout (offsetTop), not from where it is painted. Each hop adds the node's offsetTop and takes off the scroll of every
 * ancestor up to and INCLUDING its offset parent: the tab list (`.sb-scroll`) is positioned, so it is the offset parent of its rows and its own scroll was never subtracted (reported 16 Nov:
 * with the list scrolled the active tile and line stayed where the row stood before the scroll). */
export function layoutCentre(target: HTMLElement, aside: HTMLElement): number {
  let y = target.offsetHeight / 2;
  for (let node: HTMLElement | null = target; node && node !== aside; node = node.offsetParent as HTMLElement | null) {
    y += node.offsetTop;
    for (let up = node.parentElement; up; up = up.parentElement) {
      y -= up.scrollTop;
      if (up === node.offsetParent) break;
    }
  }
  return Math.round(y);
}

/** The controls that are only the open sidebar's, drawn at opacity 0 in the rail (they are past its clip or faded with its text): while the sidebar is only a rail they are taken out of the tab order and the accessibility tree
 * (setRailInert in miniRail.ts), so keyboard focus never lands on something nobody can see. Rows that show their icon in the rail (tabs, Favorites, folders, the Now Playing artwork, the footer's profile button) are not here. */
export const RAIL_HIDDEN = '.sb-tab-close,.sb-header-add,.sb-zone-actions,.sb-foot-icons button,.sb-active-peek,.sb-jump,.sb-resize,.sb-ws,.sb-ws-title-main,.sb-ws-title-more,.sb-ext-row button,.sb-sp button,.np-text-wrap,.np-hplay';
