/** Split view layouts (master list §9, Windows Snap Layouts style; B leads the UX, this is the model and geometry it drives).
 *  A layout is a small grid: column and row fractions, and which pane fills each cell. Panes are listed in reading order.
 *  Sizing (R3-81): every edge between two panes is its own handle, so it resizes only the panes it separates. A column edge runs
 *  the full height and is shared; the row edge in a 2×2 grid is one segment per column, each with its own split (`colRows`);
 *  where a column edge meets a row segment the junction moves both axes and everything touching it together. Pure: no DOM, no state. */
export type SplitLayoutId = 'columns' | 'rows' | 'three-columns' | 'three-rows' | 'top-two-bottom-one' | 'top-one-bottom-two' | 'left-one-right-two' | 'left-two-right-one'
  | 'grid' | 'four-columns' | 'four-rows' | 'left-one-right-three' | 'left-three-right-one' | 'top-one-bottom-three'
  | 'top-three-bottom-one' | 'three-columns-split-left' | 'three-columns-split-middle' | 'three-columns-split-right' | 'three-rows-split-top' | 'three-rows-split-middle'
  | 'three-rows-split-bottom' | 'left-two-right-one-over-one' | 'left-one-right-two-over-one' | 'one-over-left-two-right-one' | 'one-over-left-one-right-two'
  | 'left-one-right-two-one' | 'left-one-right-one-two' | 'right-one-left-two-one' | 'right-one-left-one-two';
export interface SplitLayoutSpec { panes: number; cols: number; rows: number; /** areas[row][col] = pane index */ areas: number[][]; label: string; /** Each column keeps its own row split (the 2×2 grid). */ columnRows?: boolean;
  /** A shape a pane moved by its ribbon can land in (every way four panes can tile the page has one) that the picker and the menus don't list. */ extra?: boolean }
export interface SplitSizes { cols: number[]; rows: number[]; /** One row split per column, kept only where the columns differ (2×2 grid); `rows` is then the first column's. Absent: every column uses `rows`. */ colRows?: number[][] }
export interface SplitState extends SplitSizes { tabIds: string[]; layout: SplitLayoutId; groupId?: string }
export interface SplitGroup extends SplitState { id: string; collapsed: boolean; lastActiveTabId?: string; /** Chosen by the person (right-click, Rename); absent means the default "Split view". */ name?: string; /** The home pane (docs/launch/SPLIT_IN_GROUPS.md): the split lives where this tab lives. Set when the split is made (its first pane); adding a pane never changes it; when it leaves, the next pane in pane order takes over. */ home?: string; /** Linked copies (founder, 28 Oct): panes of this split whose tab ALSO stays in its own tab group, the same tab (one page) drawn twice. Only a split outside every group takes them (a grouped tab dropped on it); the split never moves them. */ linked?: string[] }
export interface Rect { x: number; y: number; width: number; height: number }
export type SplitHandleKind = 'col' | 'row' | 'corner';
/** A row segment: the edge between rows `row` and `row + 1`, along the columns starting at `column` (whose row split it moves). */
export interface SplitSegment { row: number; column: number }
/** `col`: the edge between columns `col` and `col + 1`. `row`: one segment of a row edge, from column `column` to `to`. `corner`: the junction of column edge `col`
 *  with the row segments it touches. rect is the hit area, centred on the gap. */
export interface SplitHandle { kind: SplitHandleKind; col?: number; row?: number; column?: number; to?: number; segments?: SplitSegment[]; rect: Rect }
export type SplitHandleRef = Pick<SplitHandle, 'kind' | 'col' | 'row' | 'column' | 'segments'>;

export const MAX_PANES = 4, MIN_FRACTION = .15;
/** Listed by pane count, the default first (layoutsFor keeps this order, so it is the order of the picker and the menus). Panes are numbered in reading
 *  order, a stack of panes beside a tall one by column: [A, B, C] stays left to right, top to bottom, whichever of the three-pane layouts it takes. */
export const SPLIT_LAYOUTS: Record<SplitLayoutId, SplitLayoutSpec> = {
  columns: { panes: 2, cols: 2, rows: 1, areas: [[0, 1]], label: 'Side by side' },
  rows: { panes: 2, cols: 1, rows: 2, areas: [[0], [1]], label: 'Top and bottom' },
  'three-columns': { panes: 3, cols: 3, rows: 1, areas: [[0, 1, 2]], label: 'Three columns' },
  'three-rows': { panes: 3, cols: 1, rows: 3, areas: [[0], [1], [2]], label: 'Three rows' },
  'top-two-bottom-one': { panes: 3, cols: 2, rows: 2, areas: [[0, 1], [2, 2]], label: 'Two on top, one below' },
  'top-one-bottom-two': { panes: 3, cols: 2, rows: 2, areas: [[0, 0], [1, 2]], label: 'One on top, two below' },
  'left-one-right-two': { panes: 3, cols: 2, rows: 2, areas: [[0, 1], [0, 2]], label: 'One left, two right' },
  'left-two-right-one': { panes: 3, cols: 2, rows: 2, areas: [[0, 2], [1, 2]], label: 'Two left, one right' },
  grid: { panes: 4, cols: 2, rows: 2, areas: [[0, 1], [2, 3]], label: 'Four in a grid', columnRows: true },
  'four-columns': { panes: 4, cols: 4, rows: 1, areas: [[0, 1, 2, 3]], label: 'Four columns' },
  'four-rows': { panes: 4, cols: 1, rows: 4, areas: [[0], [1], [2], [3]], label: 'Four rows' },
  'left-one-right-three': { panes: 4, cols: 2, rows: 3, areas: [[0, 1], [0, 2], [0, 3]], label: 'One left, three right' },
  'left-three-right-one': { panes: 4, cols: 2, rows: 3, areas: [[0, 3], [1, 3], [2, 3]], label: 'Three left, one right' },
  'top-one-bottom-three': { panes: 4, cols: 3, rows: 2, areas: [[0, 0, 0], [1, 2, 3]], label: 'One on top, three below' },
  // Every other way four panes tile the page, so a pane moved onto any edge of any pane has a real result (never a silent swap or a jump to an unrelated layout).
  'top-three-bottom-one': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 2], [3, 3, 3]], label: 'Three on top, one below', extra: true },
  'three-columns-split-left': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 2], [3, 1, 2]], label: 'Three columns, the left one split', extra: true },
  'three-columns-split-middle': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 2], [0, 3, 2]], label: 'Three columns, the middle one split', extra: true },
  'three-columns-split-right': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 2], [0, 1, 3]], label: 'Three columns, the right one split', extra: true },
  'three-rows-split-top': { panes: 4, cols: 2, rows: 3, areas: [[0, 1], [2, 2], [3, 3]], label: 'Three rows, the top one split', extra: true },
  'three-rows-split-middle': { panes: 4, cols: 2, rows: 3, areas: [[0, 0], [1, 2], [3, 3]], label: 'Three rows, the middle one split', extra: true },
  'three-rows-split-bottom': { panes: 4, cols: 2, rows: 3, areas: [[0, 0], [1, 1], [2, 3]], label: 'Three rows, the bottom one split', extra: true },
  'left-two-right-one-over-one': { panes: 4, cols: 2, rows: 3, areas: [[0, 1], [2, 1], [3, 3]], label: 'Two left and one right, one below', extra: true },
  'left-one-right-two-over-one': { panes: 4, cols: 2, rows: 3, areas: [[0, 1], [0, 2], [3, 3]], label: 'One left and two right, one below', extra: true },
  'one-over-left-two-right-one': { panes: 4, cols: 2, rows: 3, areas: [[0, 0], [1, 2], [3, 2]], label: 'One on top, two left and one right below', extra: true },
  'one-over-left-one-right-two': { panes: 4, cols: 2, rows: 3, areas: [[0, 0], [1, 2], [1, 3]], label: 'One on top, one left and two right below', extra: true },
  'left-one-right-two-one': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 2], [0, 3, 3]], label: 'One left, two on top and one below on the right', extra: true },
  'left-one-right-one-two': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 1], [0, 2, 3]], label: 'One left, one on top and two below on the right', extra: true },
  'right-one-left-two-one': { panes: 4, cols: 3, rows: 2, areas: [[0, 1, 2], [3, 3, 2]], label: 'One right, two on top and one below on the left', extra: true },
  'right-one-left-one-two': { panes: 4, cols: 3, rows: 2, areas: [[0, 0, 1], [2, 3, 1]], label: 'One right, one on top and two below on the left', extra: true },
};
export const isSplitLayout = (value: unknown): value is SplitLayoutId => typeof value === 'string' && Object.hasOwn(SPLIT_LAYOUTS, value);
/** The layouts that hold exactly this many panes, the default first: the ones the picker, the menus and the shortcuts offer. */
export function layoutsFor(count: number): SplitLayoutId[] { return (Object.keys(SPLIT_LAYOUTS) as SplitLayoutId[]).filter(id => SPLIT_LAYOUTS[id].panes === count && !SPLIT_LAYOUTS[id].extra); }
/** Every layout of this many panes, the extra shapes a moved pane can land in too (the listed ones first). */
export function allLayoutsFor(count: number): SplitLayoutId[] { return (Object.keys(SPLIT_LAYOUTS) as SplitLayoutId[]).filter(id => SPLIT_LAYOUTS[id].panes === count); }
export const defaultLayout = (count: number): SplitLayoutId | null => layoutsFor(count)[0] ?? null;
export const evenSizes = (n: number) => Array.from({ length: n }, () => 1 / n);

const round4 = (v: number) => Math.round(v * 10000) / 10000;
const usableList = (value: unknown, n: number): value is number[] => Array.isArray(value) && value.length === n && value.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0);

/** Fractions that sum to 1, each at least MIN_FRACTION (or even when the input is unusable). */
export function normalizeFractions(value: unknown, n: number): number[] {
  if (n <= 1) return [1];
  const list = usableList(value, n) ? value : evenSizes(n);
  const total = list.reduce((a, b) => a + b, 0), scaled = list.map(v => v / total);
  // Lift anything under the floor, taking the difference from the largest ones.
  const out = scaled.map(v => Math.max(MIN_FRACTION, v)); let excess = out.reduce((a, b) => a + b, 0) - 1;
  for (let guard = 0; excess > 1e-9 && guard < n * 2; guard++) {
    const free = out.map((v, i) => [v - MIN_FRACTION, i] as const).filter(([room]) => room > 1e-9).sort((a, b) => b[0] - a[0]);
    if (!free.length) break;
    const [room, i] = free[0], take = Math.min(room, excess); out[i] -= take; excess -= take;
  }
  return out.map(round4);
}

const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 5e-4);
/** The row split of every column, by column index: the column's own where the layout keeps one, else the shared rows. */
export function rowSets(split: Pick<SplitState, 'layout' | 'rows' | 'colRows'>): number[][] {
  const spec = SPLIT_LAYOUTS[split.layout], shared = normalizeFractions(split.rows, spec.rows);
  return Array.from({ length: spec.cols }, (_, c) => spec.columnRows && usableList(split.colRows?.[c], spec.rows) ? normalizeFractions(split.colRows![c], spec.rows) : shared);
}
/** Sizes from the columns' fractions and each column's row split; the columns' rows are kept apart only where they differ, so a
 *  layout that never needed them (and anything saved before they existed) stays exactly as it was. */
export function composeSizes(layout: SplitLayoutId, cols: number[], sets: number[][]): SplitSizes {
  const differ = SPLIT_LAYOUTS[layout].columnRows && sets.some(set => !sameList(set, sets[0]));
  return differ ? { cols, rows: sets[0], colRows: sets } : { cols, rows: sets[0] };
}

/** A split from stored or requested data, or null if it can't stand: 2–4 distinct open tabs, the active one among them, a known
 *  layout for that count (else the default), sane sizes. Reads the old two-pane {tabIds:[a,b], ratio} too. */
export function normalizeSplit(input: unknown, openIds: readonly string[], activeId: string): SplitState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>, ids = raw.tabIds;
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_PANES || !ids.every(id => typeof id === 'string' && openIds.includes(id)) || new Set(ids).size !== ids.length || !ids.includes(activeId)) return null;
  const layout = isSplitLayout(raw.layout) && SPLIT_LAYOUTS[raw.layout].panes === ids.length ? raw.layout : defaultLayout(ids.length)!;
  const spec = SPLIT_LAYOUTS[layout];
  const legacy = typeof raw.ratio === 'number' && Number.isFinite(raw.ratio) && raw.cols === undefined ? [raw.ratio, 1 - raw.ratio] : undefined;
  const cols = normalizeFractions(legacy && spec.cols === 2 && layout !== 'rows' ? legacy : raw.cols, spec.cols), rows = normalizeFractions(legacy && layout === 'rows' ? legacy : raw.rows, spec.rows);
  return { tabIds: [...ids] as string[], layout, ...composeSizes(layout, cols, rowSets({ layout, rows, colRows: raw.colRows as number[][] | undefined })), ...(typeof raw.groupId==='string'?{groupId:raw.groupId}:{}) };
}

/** Moving a pane inside a split (R4-29): the order once `dragged` takes slot `slot` of the layout it was dropped on, the others keeping their order
 *  around it (the rule of the Snap picker's drop, ui/splitDrop.splitTabsFor). Null when the pane isn't in the split or the slot isn't one of its cells. */
export function arrangeOrder(tabIds: readonly string[], dragged: string, slot: number): string[] | null {
  if (!tabIds.includes(dragged) || !Number.isInteger(slot) || slot < 0 || slot >= tabIds.length) return null;
  const order = tabIds.filter(id => id !== dragged); order.splice(slot, 0, dragged);
  return order;
}
/** The pane that becomes the current one when the current pane `leaving` is closed or taken out of the split: the first other pane
 *  (the rule `split.remove` always had). Undefined when `leaving` isn't a pane. Closing a pane never jumps to a tab outside the split. */
export function paneAfterLeaving(tabIds: readonly string[], leaving: string): string | undefined {
  return tabIds.includes(leaving) ? tabIds.find(id => id !== leaving) : undefined;
}
/** The split once its panes are arranged (`split.arrange`): the layout and the order of the same panes. A new layout starts with even sizes; the same layout
 *  keeps its sizes with its cells. Null when the request can't stand (another pane count, panes that aren't the split's) or changes nothing. */
export function arrangeSplit<T extends SplitState>(split: T, layout: unknown, order: unknown): T | null {
  if (!isSplitLayout(layout) || SPLIT_LAYOUTS[layout].panes !== split.tabIds.length) return null;
  if (!Array.isArray(order) || order.length !== split.tabIds.length || new Set(order).size !== order.length || !order.every(id => typeof id === 'string' && split.tabIds.includes(id))) return null;
  const same = order.every((id, index) => id === split.tabIds[index]);
  if (layout === split.layout) return same ? null : { ...split, tabIds: [...order] as string[] };
  const spec = SPLIT_LAYOUTS[layout], next = { ...split, tabIds: [...order] as string[], layout, cols: evenSizes(spec.cols), rows: evenSizes(spec.rows) };
  delete next.colRows;
  return next;
}

/** Dropping a tab on a pane (R4-40): beside it, on one of its edges. */
export type DropEdge = 'left' | 'right' | 'top' | 'bottom';
export const DROP_EDGES: readonly DropEdge[] = ['left', 'right', 'top', 'bottom'];
/** The listed layout of `count` panes whose cells are `areas` (labels are whatever the caller used; only which cells share one matters), and which label
 *  stands in each of that layout's panes. Null when no layout has that shape. */
function matchLayout(areas: number[][], count: number): { layout: SplitLayoutId; labels: number[] } | null {
  for (const layout of allLayoutsFor(count)) {
    const spec = SPLIT_LAYOUTS[layout];
    if (spec.rows !== areas.length || spec.cols !== areas[0].length) continue;
    const forward = new Map<number, number>(), back = new Map<number, number>(); let ok = true;
    for (let r = 0; r < spec.rows && ok; r++) for (let c = 0; c < spec.cols; c++) {
      const label = areas[r][c], pane = spec.areas[r][c];
      if ((forward.has(label) && forward.get(label) !== pane) || (back.has(pane) && back.get(pane) !== label)) { ok = false; break; }
      forward.set(label, pane); back.set(pane, label);
    }
    if (ok && back.size === count) return { layout, labels: Array.from({ length: count }, (_, pane) => back.get(pane)!) };
  }
  return null;
}
/** The split once `newId` opens beside pane `pane` on `edge`: the pane's cells are cut along that edge and the layout that has the resulting shape
 *  is used, with the panes in its order. Null when the split is full, the tab is already in it, or no layout has the shape (an edge the interface
 *  then does not offer). A new layout starts with even sizes. */
export function insertBeside(split: Pick<SplitState, 'layout' | 'tabIds'>, pane: number, edge: DropEdge, newId: string): { layout: SplitLayoutId; tabIds: string[] } | null {
  const n = split.tabIds.length, spec = SPLIT_LAYOUTS[split.layout];
  if (!spec || spec.panes !== n || n >= MAX_PANES || pane < 0 || pane >= n || split.tabIds.includes(newId) || !DROP_EDGES.includes(edge)) return null;
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  spec.areas.forEach((row, r) => row.forEach((p, c) => { if (p === pane) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); } }));
  const NEW = n, areas = spec.areas.map(row => [...row]);
  if (edge === 'left' || edge === 'right') {
    const at = edge === 'left' ? c0 : c1 + 1;
    for (let r = 0; r < areas.length; r++) {
      let cell = NEW;
      if (r < r0 || r > r1) {
        // Beside the pane the new column belongs to whichever pane spans it, or stretches the one at the outer edge; two panes meeting there is no clean cut.
        if (at > 0 && at < spec.cols) { if (spec.areas[r][at - 1] !== spec.areas[r][at]) return null; cell = spec.areas[r][at]; } else cell = spec.areas[r][at === 0 ? 0 : spec.cols - 1];
      }
      areas[r].splice(at, 0, cell);
    }
  } else {
    const at = edge === 'top' ? r0 : r1 + 1, row: number[] = [];
    for (let c = 0; c < spec.cols; c++) {
      let cell = NEW;
      if (c < c0 || c > c1) { if (at > 0 && at < spec.rows) { if (spec.areas[at - 1][c] !== spec.areas[at][c]) return null; cell = spec.areas[at][c]; } else cell = spec.areas[at === 0 ? 0 : spec.rows - 1][c]; }
      row.push(cell);
    }
    areas.splice(at, 0, row);
  }
  const match = matchLayout(areas, n + 1);
  return match ? { layout: match.layout, tabIds: match.labels.map(label => label === NEW ? newId : split.tabIds[label]) } : null;
}
/** The edges of a pane a tab can open beside (those that give a listed layout). */
export const insertEdges = (split: Pick<SplitState, 'layout' | 'tabIds'>, pane: number): DropEdge[] => DROP_EDGES.filter(edge => insertBeside(split, pane, edge, '\u0000new') !== null);
/** A layout's cells as a grid of labels (any numbers; only which cells share one matters). */
export type Grid = number[][];
function spanOf(grid: Grid, label: number) {
  let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  grid.forEach((row, r) => row.forEach((p, c) => { if (p === label) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); } }));
  return r1 < 0 ? null : { r0, r1, c0, c1 };
}
/** The same tiling in the fewest tracks: a row (or column) that repeats the one before it goes. */
export function simplifyGrid(grid: Grid): Grid {
  const rows = grid.filter((row, r) => r === 0 || row.some((p, c) => p !== grid[r - 1][c]));
  const keep = rows[0].map((_, c) => c === 0 || rows.some(row => row[c] !== row[c - 1]));
  return rows.map(row => row.filter((_, c) => keep[c]));
}
/** The ways the others can close over a pane that leaves: the panes along one of its sides stretch across its cells, when none of them reaches past
 *  that side (so every pane stays a rectangle). Everything else keeps its place — the split keeps its shape instead of falling back to the default layout. */
export function closeOver(grid: Grid, label: number): Grid[] {
  const s = spanOf(grid, label); if (!s) return [];
  const rows = grid.length, cols = grid[0].length, out: Grid[] = [];
  const fits = (p: number, horizontal: boolean) => { const q = spanOf(grid, p)!; return horizontal ? q.r0 >= s.r0 && q.r1 <= s.r1 : q.c0 >= s.c0 && q.c1 <= s.c1; };
  const sides: { ok: boolean; from: (r: number, c: number) => number; horizontal: boolean }[] = [
    { ok: s.c0 > 0, from: r => grid[r][s.c0 - 1], horizontal: true },
    { ok: s.c1 < cols - 1, from: r => grid[r][s.c1 + 1], horizontal: true },
    { ok: s.r0 > 0, from: (_, c) => grid[s.r0 - 1][c], horizontal: false },
    { ok: s.r1 < rows - 1, from: (_, c) => grid[s.r1 + 1][c], horizontal: false },
  ];
  for (const side of sides) {
    if (!side.ok) continue;
    const next = grid.map(row => [...row]); let ok = true;
    for (let r = s.r0; r <= s.r1 && ok; r++) for (let c = s.c0; c <= s.c1; c++) { const p = side.from(r, c); if (!fits(p, side.horizontal)) { ok = false; break; } next[r][c] = p; }
    if (ok) out.push(simplifyGrid(next));
  }
  return out;
}
/** The grid once `label`'s cells are cut in half along `edge` and `fresh` takes the half on that side (its tracks are doubled first, so the panes beside it
 *  just span both halves: every cut is clean). */
export function cutGrid(grid: Grid, label: number, edge: DropEdge, fresh: number): Grid | null {
  const s = spanOf(grid, label); if (!s) return null;
  if (edge === 'left' || edge === 'right') {
    const k = s.c1 - s.c0 + 1, out = grid.map(row => row.flatMap((p, c) => c >= s.c0 && c <= s.c1 ? [p, p] : [p]));
    for (let r = s.r0; r <= s.r1; r++) for (let i = 0; i < k; i++) out[r][s.c0 + (edge === 'left' ? i : k + i)] = fresh;
    return simplifyGrid(out);
  }
  const k = s.r1 - s.r0 + 1, out = grid.flatMap((row, r) => r >= s.r0 && r <= s.r1 ? [[...row], [...row]] : [[...row]]);
  for (let i = 0; i < k; i++) for (let c = s.c0; c <= s.c1; c++) out[s.r0 + (edge === 'top' ? i : k + i)][c] = fresh;
  return simplifyGrid(out);
}
const UNIT: Rect = { x: 0, y: 0, width: 1600, height: 900 };
const evenRects = (layout: SplitLayoutId) => { const spec = SPLIT_LAYOUTS[layout]; return paneRects({ layout, cols: evenSizes(spec.cols), rows: evenSizes(spec.rows) }, UNIT, 0); };
const overlap = (a: Rect, b: Rect) => { const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)); const i = w * h; return i / Math.max(1, a.width * a.height + b.width * b.height - i); };
/** The half of a pane's cell on one of its edges: where a pane moved there is meant to land. */
export function edgeHalf(rect: Rect, edge: DropEdge): Rect {
  return edge === 'left' ? { ...rect, width: rect.width / 2 } : edge === 'right' ? { ...rect, x: rect.x + rect.width / 2, width: rect.width / 2 } : edge === 'top' ? { ...rect, height: rect.height / 2 } : { ...rect, y: rect.y + rect.height / 2, height: rect.height / 2 };
}
/** Moving a pane of an open split beside another one, on one of its edges (dragging a pane by its ribbon onto the edge of a pane), the way editor groups move
 *  in VS Code: the pane leaves its cell and a neighbour closes over it (the rest of the split keeps its shape), then the target's cell is cut in half
 *  along that edge and the moved pane takes that half. Of the ways that gives a layout, the one where the moved pane lands closest to that half (and the
 *  others move least) wins; a way that changes nothing wins outright (the pane is already there). The older rule (the others close up into the default
 *  layout) is only a last resort (every four-pane tiling has a layout, so it never comes to that). With two panes that is side by side or
 *  stacked, the moved one on the named side. The result may be the arrangement the split already has (the caller treats that as nothing to do). Null when no
 *  way gives a listed layout, or the panes aren't the split's. */
export function moveBeside(split: Pick<SplitState, 'layout' | 'tabIds'>, from: string, to: string, edge: DropEdge): { layout: SplitLayoutId; tabIds: string[] } | null {
  const ids = split.tabIds, spec = SPLIT_LAYOUTS[split.layout];
  if (!spec || spec.panes !== ids.length || from === to || !ids.includes(from) || !ids.includes(to) || !DROP_EDGES.includes(edge)) return null;
  const rest = ids.filter(id => id !== from);
  if (rest.length === 1) { const first = edge === 'left' || edge === 'top'; return { layout: edge === 'left' || edge === 'right' ? 'columns' : 'rows', tabIds: first ? [from, to] : [to, from] }; }
  const fromIndex = ids.indexOf(from), toIndex = ids.indexOf(to), candidates: { layout: SplitLayoutId; tabIds: string[] }[] = [];
  for (const closed of closeOver(spec.areas, fromIndex)) {
    const cut = cutGrid(closed, toIndex, edge, fromIndex), match = cut && matchLayout(cut, ids.length);
    if (match) candidates.push({ layout: match.layout, tabIds: match.labels.map(label => ids[label]) });
  }
  // Where one way leaves the split as it is, the pane already sits on that side of the target: that is the answer (nothing to do), not a reshuffle elsewhere.
  const unchanged = candidates.find(next => sameArrangement(split, next));
  if (unchanged) return unchanged;
  if (!candidates.length) { const base = defaultLayout(rest.length), legacy = base ? insertBeside({ layout: base, tabIds: rest }, rest.indexOf(to), edge, from) : null; if (legacy) candidates.push(legacy); }
  if (!candidates.length) return null;
  const before = evenRects(split.layout), aim = edgeHalf(before[toIndex], edge);
  const score = (next: { layout: SplitLayoutId; tabIds: string[] }) => { const after = evenRects(next.layout); return 2 * overlap(after[next.tabIds.indexOf(from)], aim) + rest.reduce((sum, id) => sum + overlap(after[next.tabIds.indexOf(id)], before[ids.indexOf(id)]), 0) / rest.length; };
  return candidates.reduce((best, next) => score(next) > score(best) + 1e-9 ? next : best);
}
/** Whether moving a pane (`moveBeside`) leaves the split exactly as it is. */
export const sameArrangement = (split: { layout: SplitLayoutId; tabIds: readonly string[] }, next: { layout: SplitLayoutId; tabIds: readonly string[] }) => next.layout === split.layout && next.tabIds.length === split.tabIds.length && next.tabIds.every((id, index) => id === split.tabIds[index]);
/** The tab order once `newId` takes the place of pane `pane` (the tab it replaces leaves the split, still open). Null for a tab already in the split. */
export function replaceAt(tabIds: readonly string[], pane: number, newId: string): string[] | null {
  if (pane < 0 || pane >= tabIds.length || tabIds.includes(newId)) return null;
  return tabIds.map((id, index) => index === pane ? newId : id);
}

interface Track { start: number; size: number }
/** Pixel lengths for fractions along one axis with gaps between; the last part takes the rounding remainder. */
function tracks(start: number, length: number, fractions: number[], gap: number, round = true): Track[] {
  const usable = Math.max(0, length - gap * (fractions.length - 1)), out: Track[] = [];
  let at = start, used = 0;
  fractions.forEach((f, i) => { const size = i === fractions.length - 1 ? usable - used : round ? Math.round(usable * f) : usable * f; out.push({ start: at, size }); at += size + gap; used += size; });
  return out;
}
/** Every column's tracks, and for each column its own row tracks (rows[column][row]). */
function laidOut(split: Pick<SplitState, 'layout' | 'cols' | 'rows' | 'colRows'>, rect: Rect, gap: number, round: boolean) {
  const spec = SPLIT_LAYOUTS[split.layout];
  return { spec, cols: tracks(rect.x, rect.width, normalizeFractions(split.cols, spec.cols), gap, round), rows: rowSets(split).map(set => tracks(rect.y, rect.height, set, gap, round)) };
}

/** Each pane's rectangle, by pane index. Cells a pane spans merge, including the gaps between them. */
export function paneRects(split: Pick<SplitState, 'layout' | 'cols' | 'rows' | 'colRows'>, rect: Rect, gap = 6): Rect[] {
  const { spec, cols, rows } = laidOut(split, rect, gap, true);
  return Array.from({ length: spec.panes }, (_, pane) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    spec.areas.forEach((row, r) => row.forEach((p, c) => { if (p !== pane) return; x0 = Math.min(x0, cols[c].start); x1 = Math.max(x1, cols[c].start + cols[c].size); y0 = Math.min(y0, rows[c][r].start); y1 = Math.max(y1, rows[c][r].start + rows[c][r].size); }));
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  });
}

/** A length as a share of the page area plus pixels (what a CSS calc() needs), so panes lay out without measuring anything. */
export interface Linear { pct: number; px: number }
export interface PaneEdges { left: Linear; top: Linear; width: Linear; height: Linear }
const minus = (a: Linear, b: Linear): Linear => ({ pct: round4(a.pct - b.pct), px: round4(a.px - b.px) });
function linearTracks(fractions: number[], gap: number) {
  const n = fractions.length; let before = 0;
  const starts = fractions.map((f, i) => { const at: Linear = { pct: round4(before * 100), px: round4((i - before * (n - 1)) * gap) }; before += f; return at; });
  return starts.map((start, i) => ({ start, end: i < n - 1 ? { pct: starts[i + 1].pct, px: round4(starts[i + 1].px - gap) } : { pct: 100, px: 0 } }));
}
/** Each pane's box as page-relative percentages and pixels, by pane index (the same geometry as paneRects, unrounded). */
export function paneEdges(split: Pick<SplitState, 'layout' | 'cols' | 'rows' | 'colRows'>, gap = 6): PaneEdges[] {
  const spec = SPLIT_LAYOUTS[split.layout], cols = linearTracks(normalizeFractions(split.cols, spec.cols), gap), rows = rowSets(split).map(set => linearTracks(set, gap));
  return Array.from({ length: spec.panes }, (_, pane) => {
    let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1;
    spec.areas.forEach((row, r) => row.forEach((p, c) => { if (p !== pane) return; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }));
    const left = cols[c0].start, top = rows[c0][r0].start;
    return { left, top, width: minus(cols[c1].end, left), height: minus(rows[c0][r1].end, top) };
  });
}
/** The pixel value of a Linear along a length of `length` pixels. */
export const resolveLinear = (value: Linear, length: number) => value.pct * length / 100 + value.px;

/** Where the handles are. Every edge between two panes is its own handle: a column edge (full length, shared by the panes on both sides along it),
 *  and each row edge in pieces, one per column where the layout lets columns differ (2×2) and one for the whole run where a pane spans the columns.
 *  Where a column edge meets row segments there is a junction: a square of `junction` pixels that moves the column edge and every segment touching
 *  it together (segments closer than that merge into one four-way junction). thickness is the hit area of an edge, centred on the gap. */
export function splitHandles(split: Pick<SplitState, 'layout' | 'cols' | 'rows' | 'colRows'>, rect: Rect, gap = 6, thickness = 10, junction = 16): SplitHandle[] {
  const { spec, cols, rows } = laidOut(split, rect, gap, false), out: SplitHandle[] = [];
  const verticals: { col: number; x: number }[] = [];
  for (let c = 0; c < spec.cols - 1; c++) {
    const on = spec.areas.map((row, r) => row[c] !== row[c + 1] ? r : -1).filter(r => r >= 0);
    if (!on.length) continue;
    const x = cols[c].start + cols[c].size + gap / 2, top = rows[c][on[0]].start, bottom = rows[c][on.at(-1)!].start + rows[c][on.at(-1)!].size;
    out.push({ kind: 'col', col: c, rect: { x: x - thickness / 2, y: top, width: thickness, height: bottom - top } }); verticals.push({ col: c, x });
  }
  const segments: { row: number; c0: number; c1: number; y: number }[] = [];
  for (let r = 0; r < spec.rows - 1; r++) {
    const groups: { c0: number; c1: number }[] = [];
    for (let c = 0; c < spec.cols; c++) {
      if (spec.areas[r][c] === spec.areas[r + 1][c]) continue;
      const last = groups.at(-1), joins = last && last.c1 === c - 1 && (!spec.columnRows || spec.areas[r][c] === spec.areas[r][c - 1] || spec.areas[r + 1][c] === spec.areas[r + 1][c - 1]);
      if (joins) last.c1 = c; else groups.push({ c0: c, c1: c });
    }
    for (const { c0, c1 } of groups) {
      // A segment reaches into the gap where it meets a column edge, so the two lines join.
      const y = rows[c0][r].start + rows[c0][r].size + gap / 2, left = cols[c0].start - (c0 > 0 ? gap / 2 : 0), right = cols[c1].start + cols[c1].size + (c1 < spec.cols - 1 ? gap / 2 : 0);
      out.push({ kind: 'row', row: r, column: c0, to: c1, rect: { x: left, y: y - thickness / 2, width: right - left, height: thickness } }); segments.push({ row: r, c0, c1, y });
    }
  }
  for (const v of verticals) {
    const touching = segments.filter(s => s.c0 <= v.col + 1 && s.c1 >= v.col && [s.row, s.row + 1].some(r => spec.areas[r][v.col] !== spec.areas[r][v.col + 1])).sort((a, b) => a.y - b.y);
    const clusters: typeof touching[] = [];
    for (const s of touching) { const last = clusters.at(-1); if (last && s.y - last.reduce((sum, m) => sum + m.y, 0) / last.length <= junction) last.push(s); else clusters.push([s]); }
    for (const cluster of clusters) {
      const y = cluster.reduce((sum, m) => sum + m.y, 0) / cluster.length;
      out.push({ kind: 'corner', col: v.col, row: cluster[0].row, segments: cluster.map(s => ({ row: s.row, column: s.c0 })), rect: { x: Math.round(v.x - junction / 2), y: Math.round(y - junction / 2), width: junction, height: junction } });
    }
  }
  return out;
}

/** Move the edge between list[i] and list[i + 1] by `delta` pixels, keeping both at least `floor` (a fraction). With snapPx, an edge that lands
 *  within that many pixels of one of the `targets` (fractions for list[i]) settles on it: a soft detent, released as soon as the pointer is past it. */
function shift(list: number[], i: number, delta: number, usable: number, floor: number, targets: number[] = [], snapPx = 0) {
  const pair = list[i] + list[i + 1]; let want = list[i] + delta / usable;
  if (snapPx > 0) { let near = snapPx + 1; for (const t of targets) { const d = Math.abs(t - want) * usable; if (d <= snapPx && d < near) { near = d; want = t; } } }
  // A pair too small to give both panes the floor (a tall stack in a short window) splits evenly instead of flipping.
  const f = Math.min(floor, pair / 2), next = [...list]; next[i] = Math.max(f, Math.min(pair - f, want)); next[i + 1] = pair - next[i];
  return next.map(round4);
}
const segmentsOf = (handle: SplitHandleRef): SplitSegment[] => handle.kind === 'col' ? [] : handle.segments ?? (handle.row === undefined ? [] : [{ row: handle.row, column: handle.column ?? 0 }]);
const movesColumn = (handle: SplitHandleRef, spec: SplitLayoutSpec) => (handle.kind === 'col' || handle.kind === 'corner') && handle.col !== undefined && handle.col < spec.cols - 1;

/** Sizes after dragging a handle by (dx, dy) pixels from where the drag started (start = sizes at pointer down). A column edge moves the column
 *  split; a row segment moves only its own column's row split (all of them where the layout shares one); a junction moves both. Every pane keeps at
 *  least minPx wide and minHeightPx tall (three quarters of it unless given, as minimumSize counts) or MIN_FRACTION, whichever is larger. snapPx > 0 adds the detents: an even split of the two panes
 *  (and equal thirds), and a segment lining up with the same edge in the neighbouring column. */
export function resizeSplit(start: Pick<SplitState, 'layout' | 'cols' | 'rows' | 'colRows'>, handle: SplitHandleRef, dx: number, dy: number, rect: Rect, gap = 6, minPx = 240, snapPx = 0, minHeightPx = rowFloor(SPLIT_LAYOUTS[start.layout].rows, minPx)): SplitSizes {
  const spec = SPLIT_LAYOUTS[start.layout], cols = normalizeFractions(start.cols, spec.cols), sets = rowSets(start);
  const along = (length: number, count: number, min: number) => { const usable = Math.max(1, length - gap * (count - 1)); return { usable, floor: Math.min(.5, Math.max(MIN_FRACTION, min / usable)) }; };
  let nextCols = cols; const nextSets = sets.map(set => [...set]);
  if (movesColumn(handle, spec)) {
    const i = handle.col!, { usable, floor } = along(rect.width, spec.cols, minPx);
    nextCols = shift(cols, i, dx, usable, floor, [(cols[i] + cols[i + 1]) / 2, ...(spec.cols > 2 ? [1 / spec.cols] : [])], snapPx);
  }
  const moving = segmentsOf(handle).filter(s => s.row >= 0 && s.row < spec.rows - 1 && s.column >= 0 && s.column < spec.cols), { usable, floor } = along(rect.height, spec.rows, minHeightPx);
  for (const { row, column } of moving) {
    const columns = spec.columnRows ? [column] : sets.map((_, c) => c), base = sets[columns[0]];
    const lineUp = spec.columnRows ? sets.filter((_, c) => !moving.some(s => s.column === c)).map(set => set[row]) : [];
    const moved = shift(base, row, dy, usable, floor, [(base[row] + base[row + 1]) / 2, ...(spec.rows > 2 ? [1 / spec.rows] : []), ...lineUp], snapPx);
    for (const c of columns) nextSets[c] = moved;
  }
  return composeSizes(start.layout, nextCols, nextSets);
}

/** Sizes with just the panes this handle separates made equal (the edge goes to the middle of the two); a junction evens everything touching it. */
export function equalizeSplit(start: Pick<SplitState, 'layout' | 'cols' | 'rows' | 'colRows'>, handle: SplitHandleRef): SplitSizes {
  const spec = SPLIT_LAYOUTS[start.layout], cols = normalizeFractions(start.cols, spec.cols), sets = rowSets(start).map(set => [...set]);
  const even = (list: number[], i: number) => { const half = round4((list[i] + list[i + 1]) / 2); list[i] = half; list[i + 1] = half; return list; };
  const nextCols = movesColumn(handle, spec) ? even([...cols], handle.col!) : cols;
  for (const { row, column } of segmentsOf(handle)) {
    if (row < 0 || row >= spec.rows - 1) continue;
    if (spec.columnRows) even(sets[column], row); else for (const set of sets) even(set, row);
  }
  return composeSizes(start.layout, nextCols, sets);
}

/** Sizes part of the way (t, 0…1) from one split's sizes to another's, for the equalise animation. */
export function blendSizes(layout: SplitLayoutId, from: Pick<SplitState, 'cols' | 'rows' | 'colRows'>, to: Pick<SplitState, 'cols' | 'rows' | 'colRows'>, t: number): SplitSizes {
  const spec = SPLIT_LAYOUTS[layout], mix = (a: number[], b: number[]) => a.map((v, i) => round4(v + (b[i] - v) * t));
  const a = { layout, ...from }, b = { layout, ...to }, setsA = rowSets(a), setsB = rowSets(b);
  return composeSizes(layout, mix(normalizeFractions(from.cols, spec.cols), normalizeFractions(to.cols, spec.cols)), setsA.map((set, c) => mix(set, setsB[c])));
}

/** A stable key for a handle (React keys, hover and focus bookkeeping). */
export const handleKey = (handle: SplitHandleRef) => handle.kind === 'col' ? `c${handle.col}` : handle.kind === 'row' ? `r${handle.row}.${handle.column ?? 0}` : `x${handle.col}.${(handle.segments ?? []).map(s => `${s.row}.${s.column}`).join('+')}`;
/** The keys of the handles that move with this one: a junction takes the column edge and the segments it touches along, any other handle is alone. */
export function movesWith(handle: SplitHandleRef): string[] {
  return handle.kind === 'corner' ? [handleKey({ kind: 'col', col: handle.col }), ...(handle.segments ?? []).map(s => handleKey({ kind: 'row', row: s.row, column: s.column }))] : [];
}

/** The least height a pane keeps in a layout of `rows` rows: three quarters of the width floor, half of it in a stack of three or more so four rows
 *  still fit a 1080p screen. */
export const rowFloor = (rows: number, minPx = 240) => Math.round(minPx * (rows >= 3 ? .5 : .75));
/** The smallest page area this layout fits in, so the interface can refuse a split the window can't hold. */
export function minimumSize(layout: SplitLayoutId, gap = 6, minPx = 240) {
  const spec = SPLIT_LAYOUTS[layout];
  return { width: spec.cols * minPx + gap * (spec.cols - 1), height: spec.rows * rowFloor(spec.rows, minPx) + gap * (spec.rows - 1) };
}
/** The layouts of `count` panes that fit a page area this size (the default first); every one of them when none does, so a picker is never empty and
 *  the "widen the window" notice explains the refusal. Without a height only the width counts. */
export function fittingLayouts(count: number, area: { width: number; height?: number }, gap = 6, minPx = 320): SplitLayoutId[] {
  const all = layoutsFor(count), fits = all.filter(layout => { const least = minimumSize(layout, gap, minPx); return least.width <= area.width && (area.height === undefined || least.height <= area.height); });
  return fits.length ? fits : all;
}
