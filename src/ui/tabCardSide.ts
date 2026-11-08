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
