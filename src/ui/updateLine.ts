/** The update on the thin line under the sidebar's address field (Tabs > Sidebar + address). Pure functions, so the look can be tested without a browser;
 *  features/updates/UpdateLine.tsx paints them, address-in-sidebar.css colours the ready line.
 *
 *  Downloading: the line is a row of round dots in the update mark's own look (ink lights over a faint grid, the next dot blinking at half, the fill growing with the
 *  real progress) and a shine travels along it: the dots it passes brighten and swell a little, a bright head with a long tail behind it. Paused or stopped: the same
 *  fill held still and dimmed, as the Update pill's dots are. Ready: no dots, the line takes the accent. Speed Off and reduced motion: the dotted progress, still.
 *  Nothing else about the line changes (its 96 x 4 px, its 124 px under the pointer, the hit area of the pill button above it). */
export type LineLook = 'run' | 'held' | 'ready';
/** How the update looks on the line, or null for the line as it always was (no update, or an update that is only being looked for). A download that stopped is held, as the pill is. */
export function lineLookOf(phase: 'downloading' | 'paused' | 'ready' | 'error' | null | undefined): LineLook | null {
  return phase === 'downloading' ? 'run' : phase === 'paused' || phase === 'error' ? 'held' : phase === 'ready' ? 'ready' : null;
}

/** The dots: a 4 px pitch (the line's own height, so a dot row fills it), each dot 66% of its cell (the mark's 58% closed the gaps into bars at 2x; 4 px cells keep a clear gap).
 *  Alphas are of the line's ink: a lit dot, a dot of the faint grid. The shine: one sweep of `sweepMs`, a rest of `restMs`, a head `ahead` dots wide with a tail `tail` dots long. */
export const UPDATE_LINE = { pitch: 4, dot: .66, lit: .9, grid: .3, sweepMs: 1600, restMs: 600, ahead: 1.1, tail: 2.8, reach: 4, swell: .3, blinkHz: 2.4, held: .55 } as const;

/** How many dots fit a line `width` px long; the row is centred in it, so a line that widens under the pointer gains dots at both ends and keeps its pitch. */
export const lineColumns = (width: number): number => Math.max(1, Math.floor(width / UPDATE_LINE.pitch));

/** The same count the pill's dots use (`progressHeld`): at least one dot is lit, every dot at 100%. */
export const lineLit = (progress: number, columns: number): number => Math.max(1, Math.round(Math.min(1, Math.max(0, progress)) * columns));

const clamp01 = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;
/** The head of the shine at `seconds`, in dots from the line's start (it begins and ends `reach` dots outside the line so the shine enters and leaves whole), or null while it rests. */
export function shineHead(seconds: number, columns: number): number | null {
  const sweep = UPDATE_LINE.sweepMs / 1000, cycle = sweep + UPDATE_LINE.restMs / 1000, u = ((seconds % cycle) + cycle) % cycle;
  if (u >= sweep) return null;
  const p = u / sweep, eased = .5 - Math.cos(Math.PI * p) / 2;
  return -UPDATE_LINE.reach + eased * (columns + 2 * UPDATE_LINE.reach);
}
/** The shine's strength on dot `column` for a head at `head` (0 to 1): a tight bright edge in front, a soft tail behind. */
export function shineAt(head: number | null, column: number): number {
  if (head === null) return 0;
  const d = column - head;
  return d >= 0 ? Math.exp(-Math.pow(d / UPDATE_LINE.ahead, 2)) : Math.exp(d / UPDATE_LINE.tail);
}

/** What the dot should show before easing: 1 lit, .5 the next dot blinking (still at half when the line is still), 0 the faint grid. A held line blinks nothing. */
export function lineTarget(look: 'run' | 'held', seconds: number, column: number, columns: number, progress: number, still: boolean): number {
  const lit = lineLit(progress, columns);
  if (column < lit) return 1;
  if (column === lit && look === 'run' && column < columns) return still ? .5 : (seconds * UPDATE_LINE.blinkHz) % 1 < .5 ? .5 : 0;
  return 0;
}

/** One dot: its opacity (of the ink) and its swell (a fraction of the dot's radius), given how far its light has come (`shown`, 0 to 1, eased by the painter) and the shine on it.
 *  The shine takes a dot of the grid only half as far as a lit one, so the fill stays readable under it. */
export function lineDot(shown: number, shine: number): { alpha: number; swell: number } {
  const base = UPDATE_LINE.grid + (UPDATE_LINE.lit - UPDATE_LINE.grid) * clamp01(shown);
  return { alpha: clamp01(base + (1 - base) * shine * (shown > 0 ? 1 : .5)), swell: shine * UPDATE_LINE.swell };
}

/** The ink of the line from the `--ink` token ("37 38 43", or with commas), or null when it is not readable. */
export function inkOf(value: string): [number, number, number] | null {
  const numbers = value.match(/[\d.]+/g)?.map(Number);
  return numbers && numbers.length >= 3 && numbers.slice(0, 3).every(Number.isFinite) ? [numbers[0], numbers[1], numbers[2]] : null;
}
