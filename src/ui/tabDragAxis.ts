/** Axis lock for a drag in the top tab strip (founder, 2 Nov: "when I'm moving sideways, it shouldn't be able to go vertical at all").
 *
 * The strip is only 36px tall, so a hand that drifts 20px up or down while it carries a tab sideways left the strip: the pointer read as "outside the
 * strip" (release cancelled the reorder and the tab snapped back; above the window it tore the tab off; below it the tab became a chip and armed the
 * split picker). Like Chrome, Safari and Arc, the direction is decided once, after a small dead zone, and stays until the button comes up: a drag that
 * starts sideways is a reorder to its end and its pointer is read on the strip's row; a drag that starts vertically keeps the vertical behaviour. */
export type DragAxis = 'x' | 'y';

/** How far the pointer must travel from where it went down before the direction is decided (px). */
export const AXIS_DEAD_ZONE = 5;

/** The drag's axis: `current` once it is decided, otherwise the dominant direction of `offset` (the pointer's travel since it went down) once it has left
 * the dead zone. A tie is sideways: the strip's own axis. */
export function decideAxis(current: DragAxis | null, offset: { x: number; y: number }, deadZone = AXIS_DEAD_ZONE): DragAxis | null {
  if (current) return current;
  if (Math.hypot(offset.x, offset.y) < deadZone) return null;
  return Math.abs(offset.y) > Math.abs(offset.x) ? 'y' : 'x';
}

/** A pointer that is carrying a tab sideways, read on the middle of the strip's row: whatever its height, every strip decision (the live reorder, a drop
 * into a group or split, the end of the row) sees it where its x says it is, and none of the vertical ones (chip, picker, bookmarks bar, window edge). */
export function rowPoint(point: { x: number; y: number }, row: { top: number; bottom: number }) {
  return { x: point.x, y: (row.top + row.bottom) / 2 };
}
