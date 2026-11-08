/** Sidebar mode's morph: the choreography, as pure numbers (no DOM). ui/sidebarMorph.ts measures the window and plays it; main (desktop/page-motion.cjs)
 * glides the native page on the same two springs and the same lag, from the one layout message the morph sends.
 *
 * Why the timing is what it is. The page of a website is a native view and it is drawn ABOVE the interface, so anything the interface moves
 * under the page's rectangle disappears behind it. The page card's left edge travels with the sidebar (its edge and the sidebar's edge are one
 * line), and its top edge travels with the toolbar row that goes (or comes back). Turning the mode on, the chrome therefore has to be out of
 * the band before the page's top edge rises into it: the shared pieces (Back, Reload, Forward, the address field, the sidebar button) lead, the
 * top edge follows `LAG_MS` behind. Turning it off is the mirror: the band opens first (the top edge leads), the pieces cross into it, the
 * sidebar's edge follows. `occlusion` below measures exactly this; tests/sidebar-morph.test.ts pins it. */
import { springAt, springSettle } from './springs';

export interface Box { x: number; y: number; width: number; height: number }
/** The numbers of the layout the browser itself draws (the grid, the header, the page card), in CSS px. */
export interface LayoutNumbers { col: number; hdr: number; mt: number; mr: number; mb: number; ml: number; radius: number; ring: number }
export type Direction = 'in' | 'out';

/** Critically damped, perceptual duration in seconds: the drawer (sidebar column, the page's edges, the sidebar's slide) and the pieces that move. They are the same spring on purpose: the address field rides the
 * drawer's edge on its way in, and on one curve its path is monotonic and never leaves the window (on a faster one it swings out past the window's left edge and back). */
export const DRAWER_D = .2, MOVE_D = .2;
/** How long the lagging pair of page edges waits; how long the band takes to open before pieces cross it (turning the mode off). */
export const LAG_MS = 180, OPEN_MS = 120;
/** Milliseconds from the start: old chrome leaves; the sidebar's contents, the pill, the sidebar button and the returning chrome arrive. */
export const LEAVE = [0, 110] as const, RAIL_IN = [170, 350] as const, PILL_IN = [260, 420] as const, BUTTON_IN = [100, 240] as const, CHROME_IN = [210, 340] as const;
/** What the layout message takes to reach main and start the page's glide (measured at 12 ms: the native page trailed the card by up to 27 px at the start with the clocks set equal). The morph's clock starts this long after the send. */
export const MAIN_LATENCY_MS = 12;
/** A piece that has to pass another (Forward and Reload swap places) bows this far, in opposite directions, so two 28 px buttons never overlap. */
export const ARC = 13;

export interface Schedule {
  direction: Direction;
  /** The speed's pace (`--motion-pace`): 1 Premium, .5 Fast (`fastPace`). */
  scale: number;
  /** ms the page's left/right edges and its top/bottom edges wait. */
  lagX: number; lagY: number;
  /** ms before the shared pieces start. */
  moveDelay: number;
  /** The one spring (seconds, perceptual, bounce 0) the drawer runs on, and the same for the pieces. */
  drawer: { duration: number; bounce: number }; mover: { duration: number; bounce: number };
  /** ms from the start until everything has settled. */
  total: number;
}

const settleMs = (spec: { duration: number; bounce: number }) => Math.round(springSettle(spec) * 1000);

/** Turning the mode on collapses the header (the toolbar row goes into the sidebar): the top edge lags and the pieces lead. Off: the opposite. */
export function schedule(direction: Direction, scale: number, interrupted = false): Schedule {
  // A morph turned round half way starts from wherever everything is: no waiting for anything, the whole window goes at once.
  const drawer = { duration: DRAWER_D * scale, bounce: 0 }, mover = { duration: MOVE_D * scale, bounce: 0 }, lag = interrupted ? 0 : Math.round(LAG_MS * scale);
  const inward = direction === 'in', moveDelay = inward || interrupted ? 0 : Math.round(OPEN_MS * scale);
  const total = Math.max(settleMs(drawer) + lag, moveDelay + settleMs(mover), Math.round(PILL_IN[1] * scale));
  return { direction, scale, lagX: inward ? 0 : lag, lagY: inward ? lag : 0, moveDelay, drawer, mover, total };
}

/** 0 → 1: the spring's step response `ms` after `delay` (nothing before it, exactly 1 once settled). */
export function progressAt(spec: { duration: number; bounce: number }, ms: number, delay = 0): number {
  const t = (ms - delay) / 1000;
  if (t <= 0) return 0;
  const done = springSettle(spec);
  return t >= done ? 1 : springAt(spec, 0, 1, t).value;
}
/** A smooth 0 → 1 over `[from, to]` ms (scaled by the speed setting). */
export function ramp(window: readonly [number, number], ms: number, scale = 1): number {
  const a = window[0] * scale, b = window[1] * scale;
  if (b <= a) return ms >= b ? 1 : 0;
  const u = Math.min(1, Math.max(0, (ms - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** The layout numbers `ms` into the morph: the sidebar's column and the page's left and right margins on the x clock, the header, the top and bottom margins on the y
 * clock (each held back by its own lag), the card's corner and ring on the drawer's clock (main rounds the native page's corners on it). */
export function layoutAt(first: LayoutNumbers, last: LayoutNumbers, sch: Schedule, ms: number): LayoutNumbers {
  const x = progressAt(sch.drawer, ms, sch.lagX), y = progressAt(sch.drawer, ms, sch.lagY), c = progressAt(sch.drawer, ms);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return { col: mix(first.col, last.col, x), ml: mix(first.ml, last.ml, x), mr: mix(first.mr, last.mr, x), hdr: mix(first.hdr, last.hdr, y), mt: mix(first.mt, last.mt, y), mb: mix(first.mb, last.mb, y), radius: mix(first.radius, last.radius, c), ring: mix(first.ring, last.ring, c) };
}

/** A piece that exists in both layouts and travels from one box to the other as one element. `attach0` / `attach1`: it sits inside the sidebar's column in the layout it
 * leaves / reaches, so that end rides with the sidebar's edge while the column opens or closes. `bow` is the arc that keeps two crossing pieces apart. */
export interface Mover { id: string; first: Box; last: Box; attach0: boolean; attach1: boolean; bow: number; resizes: boolean; /** ms its horizontal / vertical travel waits (the wide address field changes row: it must not cross under the page's top edge on the way) */ xDelay: number; yDelay: number }

/** Where a mover is drawn `ms` into the morph (its box in window coordinates), given the layout numbers at that moment. */
/** `dir`: +1 with the sidebar on the left, -1 on the right (its edge moves the other way as the column opens). */
export function moverBox(m: Mover, first: LayoutNumbers, last: LayoutNumbers, now: LayoutNumbers, sch: Schedule, ms: number, dir: 1 | -1 = 1): Box {
  const k = progressAt(sch.mover, ms, sch.moveDelay + m.xDelay), j = progressAt(sch.mover, ms, sch.moveDelay + m.yDelay);
  const from = { ...m.first, x: m.first.x + (m.attach0 ? dir * (now.col - first.col) : 0) }, to = { ...m.last, x: m.last.x + (m.attach1 ? dir * (now.col - last.col) : 0) };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return { x: mix(from.x, to.x, k), y: mix(from.y, to.y, j) + m.bow * 4 * j * (1 - j), width: m.resizes ? mix(from.width, to.width, k) : to.width, height: m.resizes ? mix(from.height, to.height, j) : to.height };
}

/** When the morph has settled: the drawer and its lag, the pieces (with any wait of their own), the last thing to arrive. */
export const totalMs = (sch: Schedule, movers: Mover[]): number => Math.max(sch.total, sch.moveDelay + Math.max(0, ...movers.map(m => Math.max(m.xDelay, m.yDelay))) + settleMs(sch.mover));

/** The wide address field that changes row passes the page's top edge on the way. Going down (turning the mode on) it travels sideways first, into the sidebar's column where nothing covers it,
 * and drops last. Going up (turning it off) it rises at once, inside the sidebar's column (nothing covers it there either), and only then, as the band has opened, slides out. */
export const ROW_DELAY_MS = 150;
/** How long a button that ends lower waits to drop. The native page's edge lags the interface's card edge by up to ~18 px as the column opens, and on Windows with the sidebar on the right the buttons end at the column's left corner (8 px in): they must be clear of it first. Still inside the morph's own length (426 ms at Premium: the wait adds nothing up to 180). */
export const BUTTON_DROP_MS = 180;
export function delayRowChange(movers: Mover[], sch: Schedule): Mover[] {
  for (const m of movers) {
    // Any piece that ends below where it starts waits to drop (the buttons too: on Windows with the sidebar on the right the block's row sits 40 px lower, under the caption buttons, and
    // a button dropping while it was still over the page's column was hidden by the page, 100% covered for a few frames in Compact and Focus). Only the wide address field also rises early.
    if (m.last.y > m.first.y + 4) m.yDelay = Math.round((m.resizes ? ROW_DELAY_MS : BUTTON_DROP_MS) * sch.scale);
    else if (m.resizes && m.last.y < m.first.y - 4) m.yDelay = -sch.moveDelay;
  }
  return movers;
}

/** Pieces whose left-to-right order changes between the two layouts must cross: one bows up, the other down, as far as the band allows. The band is the strip above the page's top edge
 * (`band` px: the old header's height): a piece may not leave the window's top, and must stay above the page (a piece under it is hidden by it). With no room (a 36 px row has 4 px to
 * spare) the pieces simply pass each other. Mutates `bow`. */
export function bowCrossings(movers: Mover[], band = 36): Mover[] {
  const room = (m: Mover, sign: number, size: number) => {
    // The largest bow whose path stays inside [1, band - 1] for the piece's whole height.
    let bow = size;
    for (; bow > 0; bow -= 1) {
      let fits = true;
      for (let j = 0; j <= 1.0001 && fits; j += .05) { const y = m.first.y + (m.last.y - m.first.y) * j + sign * bow * 4 * j * (1 - j); fits = y >= 1 && y + m.first.height <= band - 1; }
      if (fits) break;
    }
    return bow;
  };
  for (let i = 0; i < movers.length; i++) for (let j = i + 1; j < movers.length; j++) {
    const a = movers[i], b = movers[j];
    if (a.resizes || b.resizes) continue;
    const swapped = (a.first.x < b.first.x) !== (a.last.x < b.last.x);
    const near = Math.abs(a.first.y - b.first.y) < a.first.height && Math.abs(a.last.y - b.last.y) < a.last.height;
    if (!swapped || !near) continue;
    const aTravel = a.last.x - a.first.x, bTravel = b.last.x - b.first.x, aLeads = aTravel > bTravel;
    const up = aLeads ? a : b, down = aLeads ? b : a, goUp = room(up, -1, ARC), goDown = room(down, 1, ARC), size = Math.min(goUp, goDown);
    if (size < 6) continue;
    up.bow = -size; down.bow = size;
  }
  return movers;
}

/** The fraction of a box the native page covers while the interface draws it: the page is the rectangle right of `left` and below `top` (the card's top-left corner). */
export function occlusion(box: Box, page: { left: number; top: number }): number {
  const w = Math.max(0, box.x + box.width - Math.max(box.x, page.left)), h = Math.max(0, box.y + box.height - Math.max(box.y, page.top));
  return box.width > 0 && box.height > 0 ? (w * h) / (box.width * box.height) : 0;
}

/** The page card's top-left corner `ms` in (what main's glide draws: its left edge on the x clock, its top edge on the y clock). */
export const pageCorner = (first: LayoutNumbers, last: LayoutNumbers, sch: Schedule, ms: number) => { const n = layoutAt(first, last, sch, ms); return { left: n.col + n.ml, top: n.hdr + n.mt }; };

/** Opacity of something that arrives (`from` → 1 over the window) or leaves (1 → 0). `from` carries an interrupted morph's current opacity. */
export const arriving = (window: readonly [number, number], ms: number, scale = 1, from = 0) => from + (1 - from) * ramp(window, ms, scale);
export const leaving = (window: readonly [number, number], ms: number, scale = 1, from = 1) => from * (1 - ramp(window, ms, scale)) ** 2;

/** The spring and lag main takes with the one layout the morph sends (`BrowserLayout.pageSpring`, `pageEdgeLag`). */
export function pageGlide(sch: Schedule): { spring: { duration: number; bounce: number }; lag: { x?: number; y?: number } } {
  return { spring: { ...sch.drawer }, lag: sch.lagX ? { x: sch.lagX } : sch.lagY ? { y: sch.lagY } : {} };
}
