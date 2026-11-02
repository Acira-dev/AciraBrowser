/** The error illustration: a path from this device (left) to a destination (right), drawn on a crisp square-cell grid.
 * Each failure kind breaks the path in a different, readable place. Pure data and timing, so it is testable without a canvas.
 *
 * Grid: 20 × 10 cells, 4px pitch (80 × 40px), so it sits on the 4px grid and the left edge of the ink is the left edge of the
 * element. Levels are stepped, never tweened: 0 off, 1 ghost, 2 dim, 3 on. */
export type ErrorKind = 'certificate' | 'offline' | 'dns' | 'timeout' | 'refused' | 'reset' | 'blocked' | 'secure' | 'other';

export const gridCols = 20;
export const gridRows = 10;
/** CSS pixels between cell origins; cells are pitch − 1px wide. */
export const cellPitch = 4;
export const stepsPerSecond = 12;
const cycleSteps = 44;

type Cell = '.' | 'o' | 'p' | 'g' | 'F';
type Grid = Cell[][];
const blank = (): Grid => Array.from({ length: gridRows }, () => Array<Cell>(gridCols).fill('.'));
const fill = (g: Grid, r0: number, c0: number, h: number, w: number, ch: Cell) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) g[r][c] = ch; };
const frame = (g: Grid, r0: number, c0: number, h: number, w: number, ch: Cell) => { fill(g, r0, c0, h, w, ch); fill(g, r0 + 1, c0 + 1, h - 2, w - 2, '.'); };
const set = (g: Grid, cells: Array<[number, number]>, ch: Cell) => { for (const [r, c] of cells) g[r][c] = ch; };
/** A node: a 6×6 frame with a 2×2 core, rows 2–7. */
const node = (g: Grid, c0: number, ch: Cell = 'o', core: Cell | null = ch) => { frame(g, 2, c0, 6, 6, ch); if (core) fill(g, 4, c0 + 2, 2, 2, core); };
/** The path occupies rows 4–5. */
const line = (g: Grid, c0: number, c1: number, ch: Cell = 'p') => fill(g, 4, c0, 2, c1 - c0 + 1, ch);
const text = (g: Grid) => g.map((row) => row.join(''));

function build(kind: ErrorKind): Grid {
  const g = blank();
  node(g, 0);
  switch (kind) {
    case 'certificate': // The destination answers, but its identity is unconfirmed: a ghost frame with a flagged core.
      line(g, 6, 13); node(g, 14, 'g', 'F'); break;
    case 'secure': // An open padlock at the end of the path: no secure connection to make.
      line(g, 6, 13); fill(g, 4, 14, 5, 6, 'o'); fill(g, 1, 15, 1, 4, 'o'); set(g, [[2, 15], [3, 15], [2, 18]], 'o'); break;
    case 'dns': // The path runs out in dashes towards a destination that is not there.
      line(g, 6, 9); fill(g, 4, 10, 2, 1, 'p'); fill(g, 4, 12, 2, 1, 'p'); node(g, 14, 'g', null); break;
    case 'offline': // This device only: no path, a faint destination.
      fill(g, 4, 7, 2, 1, 'g'); fill(g, 4, 10, 2, 1, 'g'); fill(g, 4, 13, 2, 1, 'g'); node(g, 14, 'g'); break;
    case 'timeout': // The path goes quiet halfway; limit marks above and below it.
      line(g, 6, 9); fill(g, 4, 10, 2, 1, 'g'); fill(g, 4, 12, 2, 1, 'g'); node(g, 14, 'o', null); fill(g, 0, 10, 2, 2, 'F'); fill(g, 8, 10, 2, 2, 'F'); break;
    case 'refused': // A wall stands in front of the destination.
      line(g, 6, 11); fill(g, 0, 12, 10, 2, 'F'); node(g, 14); break;
    case 'reset': // The path snaps and the halves slip apart.
      fill(g, 4, 6, 2, 3, 'p'); fill(g, 5, 11, 2, 3, 'p'); set(g, [[3, 9], [6, 9], [3, 10], [6, 10]], 'F'); node(g, 14); break;
    case 'blocked': // A bar cuts across the path.
      line(g, 6, 13); node(g, 14); for (let i = 1; i <= 8; i++) { g[i][6 + i] = 'F'; g[i][7 + i] = 'F'; } break;
    case 'other': // The path has a gap, bracketed.
      line(g, 6, 13); fill(g, 4, 9, 2, 2, '.'); fill(g, 3, 9, 1, 2, 'F'); fill(g, 6, 9, 1, 2, 'F'); node(g, 14, 'o', 'g'); break;
  }
  return g;
}

export const figures: Record<ErrorKind, string[]> = Object.fromEntries((['certificate', 'offline', 'dns', 'timeout', 'refused', 'reset', 'blocked', 'secure', 'other'] as ErrorKind[]).map((kind) => [kind, text(build(kind))])) as Record<ErrorKind, string[]>;

const base: Record<Cell, number> = { '.': 0, g: 1, p: 2, o: 3, F: 3 };
export const cellAt = (kind: ErrorKind, row: number, col: number): Cell => (figures[kind][row]?.[col] as Cell | undefined) ?? '.';

/** How the pulse moves and where the flagged cells react. `end` is the last path column it reaches. */
const motion: Record<ErrorKind, { end: number; mode: 'run' | 'bounce' | 'stall' | 'none' }> = {
  certificate: { end: 13, mode: 'run' },
  secure: { end: 13, mode: 'run' },
  dns: { end: 12, mode: 'run' },
  refused: { end: 11, mode: 'bounce' },
  blocked: { end: 9, mode: 'stall' },
  timeout: { end: 9, mode: 'stall' },
  reset: { end: 8, mode: 'bounce' },
  other: { end: 8, mode: 'stall' },
  offline: { end: 6, mode: 'none' },
};
const startColumn = 6;

/** Level of one cell at time t seconds: 0 off, 1 ghost, 2 dim, 3 on. Steps only, no easing. */
export function levelAt(kind: ErrorKind, t: number, row: number, col: number): number {
  const cell = cellAt(kind, row, col), level = base[cell], { end, mode } = motion[kind];
  const k = Math.floor(Math.max(0, t) * stepsPerSecond) % cycleSteps, run = end - startColumn;
  if (mode === 'none') {
    // Searching for a network: the core blinks and a single dim step scans the faint path, then it rests.
    if (col >= 2 && col <= 3 && row >= 4 && row <= 5) return Math.floor(k / 6) % 2 ? 1 : 3;
    if (cell === 'g' && row >= 4 && row <= 5 && col < 14 && k < cycleSteps - 8 && col === 7 + 3 * (Math.floor(k / 5) % 3)) return 3;
    return level;
  }
  const head = mode === 'bounce' ? (k <= run ? startColumn + k : Math.max(startColumn, end - (k - run))) : startColumn + Math.min(k, run);
  if (cell === 'p' && k < cycleSteps - 6 && col >= head - 1 && col <= head) return 3;
  const since = k - run;
  if (cell === 'F' && since >= 0 && since < 8) return Math.floor(since / 2) % 2 ? 1 : 3;
  if (kind === 'dns' && since >= 0 && since < 10 && cell === 'g' && col >= 14) return 2;
  return level;
}

/** The single still frame used when motion is reduced: the figure at rest with its fault marked. */
export const stillLevel = (kind: ErrorKind, row: number, col: number) => base[cellAt(kind, row, col)];

/** Number of cells that belong to the figure (not the empty grid). */
export const inkCount = (kind: ErrorKind) => figures[kind].join('').replace(/\./g, '').length;
