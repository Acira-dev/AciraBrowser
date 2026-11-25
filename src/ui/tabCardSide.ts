import type { SidebarSide } from '../runtime/types';

/** Where a tab's hover card goes for a row, from the facts alone (ui/tabHoverCard.ts asks, desktop/tab-card.cjs places and flips it when it does not fit).
 * A strip tab (horizontal or compact) gets it below. A sidebar row gets it beside the row, toward the page: on the right when the sidebar is on the left,
 * on the left when it is on the right. A right sidebar says so outright (not a guess from where the row happens to be while the sidebar slides); a left
 * sidebar keeps the rule it always had: right, unless the row is in the window's right half. */
export const cardSideFor = (sidebarRow: boolean, rowCentre: number, windowWidth: number, sidebarSide: SidebarSide): 'below' | 'right' | 'left' => {
  if (!sidebarRow) return 'below';
  if (sidebarSide === 'right') return 'left';
  return rowCentre > windowWidth / 2 ? 'left' : 'right';
};

export interface CardBox { x: number; y: number; width: number; height: number }

/** The box a card is placed against. A sidebar row sits inside the sidebar with room around it, so a card measured from the ROW lands a few pixels inside the sidebar:
 * glued to its edge, or under it while the sidebar floats over the page (the team's 16 Nov 19:45 picture). The card is measured from the sidebar's edge on the
 * side it opens to, so the designed gap (tab-card.cjs GAP) shows between the two, docked and floated, on the left and on the right. A strip tab, or a row with no
 * sidebar around it, is its own box. */
export const cardAnchorFor = (row: CardBox, sidebar: CardBox | null, side: 'below' | 'right' | 'left'): CardBox => {
  if (!sidebar || side === 'below' || sidebar.width <= 0) return row;
  if (side === 'right') { const edge = Math.max(row.x + row.width, sidebar.x + sidebar.width); return { x: row.x, y: row.y, width: edge - row.x, height: row.height }; }
  const edge = Math.min(row.x, sidebar.x);
  return { x: edge, y: row.y, width: row.x + row.width - edge, height: row.height };
};
