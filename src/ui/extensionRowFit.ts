/**
 * Beta 14: the sidebar's row of pinned extensions is ONE line. What does not fit goes behind a "more" button at the end of the line.
 *
 * The buttons keep the size and the spacing they have always had (the toolbar's 30 px buttons with the engine's 5 px gap: the tester pointed at Arc, which shrinks them, and the
 * the team decided against it: smaller targets, uneven beside our other icons). So the row's width decides how many fit, and when there are more pinned than that, the last slot
 * is the "more" button, never a smaller icon. The order is the person's pinned order; what does not fit is taken from the end. Pure; the row measures and applies it.
 */
export const rowMetrics = {
  /** One extension button (extension-actions.css). */
  button: 30,
  /** The gap the engine's list puts between its buttons (its own style: `:host { gap: 5px }`). */
  gap: 5,
  /** The row's own padding at both sides together (sidebar.css `.sb-ext-row`: 14 px in, like the rows below). */
  inset: 28,
} as const;

export interface RowSlots {
  /** How many of the pinned extensions have their own button, from the start of the pinned list. */
  visible: number;
  /** The "more" button takes the last slot of the line: the rest of the pinned extensions are behind it. */
  more: boolean;
}

/** How many slots (a button each) fit in `inner` px: the room between the row's paddings. */
export const slotsIn = (inner: number): number => Math.max(0, Math.floor((inner + rowMetrics.gap) / (rowMetrics.button + rowMetrics.gap)));

/**
 * What a measurement of the row's inner width says, or null when it says nothing: a row that mounts into a column that has not been laid out yet (the first layout of a reveal reads
 * the column at no width, so the row is only its two paddings wide) has no room for even one button, and taking that for "no slots" hid every button until the next frame, which
 * is the late icons of AD1. No sidebar is narrower than one button, so such a reading is "not laid out yet": the row keeps the slots it had, and the real width follows it.
 */
export const measuredSlots = (inner: number): number | null => (inner < rowMetrics.button ? null : slotsIn(inner));

/** The slots a sidebar of this width gives its row (the sidebar's width is the setting's; the row is that wide less its padding), or null for a width that cannot hold a button. */
export const slotsInSidebar = (width: number): number | null => measuredSlots(width - rowMetrics.inset);

/**
 * `slots`: how many buttons the line has room for (`slotsIn` of the row's width, or less when the row shares its line with something that must keep its width: the toolbar's
 * address field, ui/toolbarFit.ts). `total`: how many extensions are pinned.
 */
export function rowSlots(slots: number, total: number): RowSlots {
  if (total <= 0) return { visible: 0, more: false };
  const room = Math.max(0, Math.floor(slots));
  if (total <= room) return { visible: total, more: false };
  // One slot is the "more" button (even in a line too narrow for anything else: the person can still reach every extension).
  return { visible: Math.max(0, room - 1), more: true };
}

/** The extensions behind the "more" button, in pinned order. */
export const hiddenBehindMore = <T,>(pinned: readonly T[], visible: number): T[] => pinned.slice(Math.max(0, visible));
