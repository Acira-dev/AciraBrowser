/** Beta 14, Shelf collapse recorded frame by frame (14 Nov): the address field's shown text is centred in its field, and the field is much wider in the closed layout than beside a docked sidebar (the new toolbar's field is 1000px where the old one was 444).
 * The field is a named element of the layout switch, shown as its NEW picture anchored at the box's left edge, so in the first frame the text stood where the new, wider field centres it (a hundred pixels or more to the right of where it was), and then
 * glided with the box. The new picture starts pulled back by that difference and settles to 0 on the box's own curve (view-morph.css `sb-addr-settle`). */
export const ADDRESS_BAR = '.browser-shell > .acira-persistent-toolbar .address-bar';
/** Where the shown text of the address field starts, from the field's left edge, in px; null when no text is drawn (a focused field, the new tab page). */
export const addressLeadOf = (root: ParentNode = document): number | null => {
  const bar = root.querySelector(ADDRESS_BAR), shown = bar?.querySelector('.address-display');
  if (!bar || !shown || !shown.getClientRects().length) return null;
  const range = document.createRange();
  range.selectNodeContents(shown);
  const text = range.getBoundingClientRect();
  return text.width > 0 ? text.left - bar.getBoundingClientRect().left : null;
};
/** How far along the new text stands from where the old one did (a pixel of slack for rounding); 0 when either is not drawn. */
export const addressStartOffset = (before: number | null, after: number | null): number =>
  before === null || after === null || Math.abs(after - before) < 1 ? 0 : after - before;
