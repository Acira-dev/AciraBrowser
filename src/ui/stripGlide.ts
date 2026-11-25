/** Beta 14, Top + sidebar (reported 14 Nov: "one layer passing over another" while the Shelf slides): the tab strip stays through the sidebar's slide (it is in the old frame and the new one),
 * and its box moves with the column's edge. The strip is a named element of the layout view transition (`acira-tab-row`, toolbar-controls.css); with no rule of its own its box took the
 * default 240 ms expo-out while the column slid for 480 ms, so on closing the strip's box ran out over the column still on its way out, and on opening it stood clear of the arriving column.
 * A layout switch where the strip is in both frames and its box moved or changed width carries `data-strip-glide` on the root (ui/sharedMotion.ts), and sidebar.css puts the strip on the
 * column's clock and curve, showing only the new strip, revealed by its morphing box, like the toolbar under it. A strip that arrives or leaves (tabs in the sidebar, Along the top) keeps its own fade. */
export interface StripBox {
  x: number; width: number;
  /** How far the strip's first control (the sidebar button, else the tab overview) stands from the strip's start edge. The Shelf's strip starts at the column's edge, the closed Shelf's after the window's corner (the Mac's traffic lights): the controls and the tabs
   * stand that much further in or out in one frame, while the strip's box glides. 0 when the strip has no control yet. */
  lead: number;
  /** The strip reads right to left: its start edge is its right edge. */
  rtl: boolean;
}
export const STRIP_SELECTOR = '.browser-shell > .acira-tab-row';
/** The strip's tone (its recess band) is a child of its own, so that it can fade between the two states while the strip's content glides (sidebar.css). It is not a control. */
const isContent = (node: Element) => !node.classList.contains('acira-strip-tone') && node.getClientRects().length > 0;
export const stripBoxOf = (root: ParentNode = document): StripBox | null => {
  const strip = root.querySelector(STRIP_SELECTOR);
  if (!strip) return null;
  const box = strip.getBoundingClientRect(), rtl = getComputedStyle(strip).direction === 'rtl';
  const first = [...strip.children].find(isContent)?.getBoundingClientRect();
  return { x: box.x, width: box.width, lead: first ? (rtl ? box.right - first.right : first.left - box.left) : 0, rtl };
};
/** The strip glides: it is in both frames and its box is not where it was (a pixel of slack for rounding). */
export const stripGlides = (before: StripBox | null, after: StripBox | null): boolean =>
  !!before && !!after && (Math.abs(before.x - after.x) > 1 || Math.abs(before.width - after.width) > 1);
/** The strip's new picture is drawn from its box's start edge, but its first control stands `lead` from there in the new state and stood `before.lead` in the old one: unless the picture starts that much out of place, the
 * content jumps by the difference in the first frame and then glides with the box (measured 14 Nov: 86 px on a Mac, the traffic lights' room, the first frame of closing the Shelf). The picture starts offset so that the first
 * control is where it was, and settles to 0 on the box's own curve. Physical px to the right: positive moves the new picture towards the end of the strip's line. */
export const stripStartOffset = (before: StripBox | null, after: StripBox | null): number => {
  if (!before || !after) return 0;
  const shift = after.lead - before.lead;           // along the line, from the start edge
  return Math.abs(shift) < 1 ? 0 : shift;           // the picture is drawn `shift` further along than the old one was: pull it back by that
};
