/** R4-51: the cover step's card row, as plain numbers (no DOM) so the glide targets are tested. Every position is a distance
 * from the row's start (0 … reach), whatever the writing direction. `points` are the card edges the row may rest on, in order,
 * with `reach` (the far end) last. */

/** The widest edge fades (px): the far side is wider because the round arrow sits on it. */
export const fadeWidth = { start: 40, end: 64 } as const;

const clamp = (value: number, reach: number) => Math.min(Math.max(0, reach), Math.max(0, value));

/** The fades grow with the distance still to scroll on each side, so a fade is gone exactly when its end arrives (no step),
 * and an arrow shows while there is more than a couple of pixels left that way. */
export function coverEdges(position: number, reach: number) {
  const before = Math.max(0, position);
  const left = Math.max(0, reach - position);
  return { start: before > 2, end: left > 2, fadeStart: Math.min(fadeWidth.start, before), fadeEnd: Math.min(fadeWidth.end, left) };
}

/** An arrow moves the row by about three quarters of its width and lands on a card edge (so nothing has to correct it after),
 * always at least one card in the arrow's direction, never past either end. */
export function coverPageTarget(points: number[], from: number, direction: 1 | -1, width: number, reach: number): number {
  const wanted = from + direction * width * 0.75;
  const ahead = points.map((point) => clamp(point, reach)).filter((point) => (direction > 0 ? point > from + 1 : point < from - 1));
  if (!ahead.length) return direction > 0 ? clamp(reach, reach) : 0;
  return ahead.reduce((best, point) => (Math.abs(point - wanted) < Math.abs(best - wanted) ? point : best));
}

/** Where the row rests after a wheel or touchpad: the nearest card edge (the ends stay where they are). */
export function coverSnap(points: number[], from: number, reach: number): number {
  if (!points.length || from <= 0.5 || from >= reach - 0.5) return clamp(from, reach);
  return points.map((point) => clamp(point, reach)).reduce((best, point) => (Math.abs(point - from) < Math.abs(best - from) ? point : best));
}

/** The smallest move that shows a card whole, clear of the edge fades. `start` is the card's distance from the row's start. */
export function coverReveal(start: number, size: number, from: number, width: number, reach: number): number {
  if (start < from + fadeWidth.start) return clamp(start - fadeWidth.start, reach);
  if (start + size > from + width - fadeWidth.end) return clamp(start + size - width + fadeWidth.end, reach);
  return clamp(from, reach);
}
