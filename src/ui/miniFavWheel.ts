/** D170 (a member on Windows, 23 Nov, Beta 14.2): the Mini rail's Favorites column ran ONE ROW PER WHEEL EVENT (MiniFavColumn took every event as a whole row, 32 px). A notched wheel sends one event a
 * notch, so that was right for it; a precision touchpad or a free-spinning wheel sends a stream of small events (1 to 10 px at 60 a second), and the column raced eight rows in 0.4 s. Now a real notch still moves
 * one row, and small deltas add up: one row per ROW px of the hand's travel. The column's target is kept between events (it was read back from scrollTop while the previous smooth scroll was still running), and a
 * pause or a change of direction starts the count again. Pure: tests/mini-fav-wheel.test.ts. */
export const MINI_FAV_ROW = 32;
/** A pause longer than this starts a new gesture: the target is read from where the column stands. */
export const MINI_FAV_GESTURE_MS = 250;
/** A single event of this many px or more is a notch (Windows sends 100 a notch, macOS 40 or more for a classic wheel; a touchpad's events are a few px). */
export const MINI_FAV_NOTCH_PX = 40;
export type FavWheelState = { acc: number; target: number; at: number };
export type FavWheelInput = { deltaY: number; deltaX: number; deltaMode: number; wheelDeltaY?: number; now: number; scrollTop: number; max: number; page: number };

/** The event's travel in px: line mode (a notch on some systems) counts a row a line, page mode a column. */
export function wheelPixels(input: Pick<FavWheelInput, 'deltaY' | 'deltaX' | 'deltaMode' | 'page'>): number {
  const raw = input.deltaY || input.deltaX;
  return input.deltaMode === 1 ? raw * MINI_FAV_ROW : input.deltaMode === 2 ? raw * input.page : raw;
}
/** One notch of a wheel with clicks: the legacy wheelDelta is a whole multiple of 120 (Chromium sets it from the wheel's ticks; a touchpad's is not), or the event is large on its own. */
export function isNotch(input: Pick<FavWheelInput, 'deltaY' | 'deltaX' | 'deltaMode' | 'wheelDeltaY' | 'page'>): boolean {
  if (input.deltaMode !== 0) return true;
  const legacy = input.wheelDeltaY ?? 0;
  if (legacy && Math.abs(legacy) >= 120 && legacy % 120 === 0) return true;
  return Math.abs(wheelPixels(input)) >= MINI_FAV_NOTCH_PX;
}
const snap = (top: number): number => Math.round(top / MINI_FAV_ROW) * MINI_FAV_ROW;
const clamp = (top: number, max: number): number => Math.max(0, Math.min(Math.max(0, max), top));
/** The next state and, when the column moves, the row it scrolls to (null: it stays). */
export function favWheel(state: FavWheelState | null, input: FavWheelInput): { state: FavWheelState; target: number | null } {
  const px = wheelPixels(input);
  const fresh = !state || input.now - state.at > MINI_FAV_GESTURE_MS;
  let acc = fresh ? 0 : state.acc, target = fresh ? clamp(snap(input.scrollTop), input.max) : state.target;
  if (!px) return { state: { acc, target, at: input.now }, target: null };
  let rows: number;
  if (isNotch(input)) { rows = Math.sign(px); acc = 0; }
  else {
    if (acc && Math.sign(acc) !== Math.sign(px)) acc = 0;     // the hand turned round: the count starts again
    acc += px; rows = Math.trunc(acc / MINI_FAV_ROW); acc -= rows * MINI_FAV_ROW;
  }
  if (!rows) return { state: { acc, target, at: input.now }, target: null };
  const next = clamp(target + rows * MINI_FAV_ROW, input.max);
  if (next === target) return { state: { acc: 0, target, at: input.now }, target: null };     // at an end: nothing builds up past it
  return { state: { acc, target: next, at: input.now }, target: next };
}
