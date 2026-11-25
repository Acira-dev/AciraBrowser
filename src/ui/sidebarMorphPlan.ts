/** Sidebar mode's morph: the choreography, as pure numbers (no DOM). ui/sidebarMorph.ts measures the window and plays it; main (desktop/page-motion.cjs)
 * glides the native page on the same two springs and the same lag, from the one layout message the morph sends.
 *
 * Why the timing is what it is. The page of a website is a native view and it is drawn ABOVE the interface, so anything the interface moves
 * under the page's rectangle disappears behind it. The page card's left edge travels with the sidebar (its edge and the sidebar's edge are one
 * line), and its top edge travels with the toolbar row that goes (or comes back). Turning the mode on, the chrome therefore has to be out of
 * the band before the page's top edge rises into it: the shared pieces (Back, Reload, Forward, the address field, the sidebar button) lead, the
 * top edge follows `LAG_MS` behind. Turning it off is the mirror: the band opens first (the top edge leads), the pieces cross into it, the
 * sidebar's edge follows. `occlusion` below measures exactly this; tests/sidebar-morph.test.ts pins it. */
import { springAt, springParams, springSettle } from './springs';

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

/** How long the page's top edge waits in a switch where the sidebar stands, decided BEFORE the layout is switched (main is told with the one layout message the switch sends).
 * `now.block`: the address block stands in the sidebar now; `now.rows`: the header's height now; `to.block` / `to.strip`: the layout it goes to has the block / the tab strip above the toolbar.
 *  - the bar closing or losing a row from ONE row, or to a bar that stays (Sidebar -> Sidebar + address; strip + toolbar -> toolbar): LAG_MS, as ever: the row empties, then closes;
 *  - strip + toolbar -> Sidebar + address: the field goes under the page's top edge and has to come out of its SIDE edge along the sidebar's second row, which the page covers only once its top edge has
 *    risen past that row. So the bar closes early here, right behind the buttons that leave it (100 ms), and the field is out of sight for about 70 ms instead of 150;
 *  - Sidebar + address -> strip + toolbar: the field's own row will be uncovered by the opening bar, so the bar waits the 90 ms the field takes to go under the page's side edge (it then comes out
 *    from under the page's top edge as the bar opens);
 *  - any other way out: no wait, the bar opens at once;
 *  - no bar over the page now (Hide the toolbar is on: the header is only the page's own margin, `NO_BAR`) and the block arriving: no row has to empty first, nothing waits. */
export const NO_BAR = 20;
/** D100: how long the page's top edge waits when the sidebar's column opens from nothing with the address block in it (Along the top -> Sidebar + address, the Sidebar mode switch itself). The field has
 * to cross the whole bar into the column's second row, and it starts only once Back / Forward / Reload have left its row (nothing crosses): on the 180 ms a row needs to empty beside a standing sidebar
 * the page's top edge closed over a field that had not left yet, so the plan stood it where it was for 150 ms under the rising page and brought it out from under the page's side edge at the block's
 * size (the regression guard's c2 at 1280 pt, 19 Nov: the field 100 % under the native page, 496 pt narrower in one frame). With this wait the straight way is clear at every width from 900 to 1600 pt
 * (the plan played a millisecond at a time), the field is in sight the whole way and the three buttons travel as themselves. */
export const TOP_BLOCK_LAG_MS = 300;
export function topEdgeLag(direction: Direction, scale: number, now: { block: boolean; rows: number }, to: { block: boolean; strip: boolean }): number {
  if (direction === 'in' && now.rows < NO_BAR) return 0;
  if (direction === 'in') return Math.round((now.rows > 60 && to.block ? 100 : LAG_MS) * scale);
  return now.block && to.strip ? Math.round(90 * scale) : 0;
}

/** The schedule's length again, after its lags were set from outside (`topEdgeLag`): the drawer and its longer lag, the pieces' common wait, the pill. */
export function retime(sch: Schedule): Schedule { sch.total = Math.max(settleMs(sch.drawer) + Math.max(sch.lagX, sch.lagY), sch.moveDelay + settleMs(sch.mover), Math.round(PILL_IN[1] * sch.scale)); return sch; }

/** 0 → 1: the spring's step response `ms` after `delay` (nothing before it, exactly 1 once settled). */
export function progressAt(spec: { duration: number; bounce: number }, ms: number, delay = 0): number {
  const t = (ms - delay) / 1000;
  if (t <= 0) return 0;
  const done = settleOf(spec);
  return t >= done ? 1 : springAt(spec, 0, 1, t).value;
}
/** When a spring has settled, worked out once per spring (the row morph's plan asks many thousands of times before the first frame). */
const settled = new Map<string, number>();
function settleOf(spec: { duration: number; bounce: number }): number {
  const key = spec.duration + '/' + spec.bounce; let done = settled.get(key);
  if (done === undefined) { done = springSettle(spec); if (settled.size > 64) settled.clear(); settled.set(key, done); }
  return done;
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
export interface Mover { id: string; first: Box; last: Box; attach0: boolean; attach1: boolean; bow: number; resizes: boolean; /** ms its horizontal / vertical travel waits (the wide address field changes row: it must not cross under the page's top edge on the way) */ xDelay: number; yDelay: number;
  /** Where its glyph sits inside its box (a button): what of it is drawn. Two buttons are apart when their glyphs are; the field and a block of the sidebar are drawn over their whole box. */
  ink?: Ink;
  /** ms its whole travel waits (a control that leaves where it stands is still fading on its path, or the band it travels into is not open yet). */
  wait?: number;
  /** The share of its travel over which its bow stands at its full height: from where its glyph meets the glyph it passes to where it has left it. It rises before and settles after. */
  bowSpan?: readonly [number, number];
  /** ms (from the morph's start) over which its lane forms: it may begin while the piece still waits, so a lane never forms in a frame or two. */
  bowRise?: readonly [number, number];
  /** The field goes under the page instead of across the row (see `Dive`). */
  dive?: Dive;
  /** The field goes round the page's corner, fading outside the column's edge and in at its place (see `Hop`, D116). */
  hop?: Hop;
  /** Its bow never carries it more than ROW_LEEWAY past its own two rows (D100, set by the plan for the buttons of a `fieldFirst` switch). */
  keepRows?: boolean;
  /** A block of the sidebar: it only moves with the sidebar's head growing or closing. */
  block?: boolean }

/** Where a mover is drawn `ms` into the morph (its box in window coordinates), given the layout numbers at that moment. */
/** `dir`: +1 with the sidebar on the left, -1 on the right (its edge moves the other way as the column opens). */
export function moverBox(m: Mover, first: LayoutNumbers, last: LayoutNumbers, now: LayoutNumbers, sch: Schedule, ms: number, dir: 1 | -1 = 1): Box {
  const start = sch.moveDelay + (m.wait ?? 0);
  if (m.hop) return hopBox(m, sch, ms);
  if (m.dive) return diveBox(m, first, last, now, sch, ms - start, dir);
  const k = progressAt(sch.mover, ms, start + m.xDelay), j = progressAt(sch.mover, ms, start + m.yDelay);
  const from = { ...m.first, x: m.first.x + (m.attach0 ? dir * (now.col - first.col) : 0) }, to = { ...m.last, x: m.last.x + (m.attach1 ? dir * (now.col - last.col) : 0) };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const y = mix(from.y, to.y, j) + (m.bowSpan ? m.bow * (m.bowRise && k < m.bowSpan[1] ? riseShare(ms, m.bowRise) : bowShare(k, m.bowSpan)) : m.bow * 4 * j * (1 - j));
  // D100 (`keepRows`, the Sidebar mode switch from or to Along the top): a button that changes rows keeps to its own two rows. Its lane is a bow off its path, and near either end of the path a bow
  // away from the other row carried it out of both: Reload dipped 3.3 pt under the row it was leaving and Forward rose up to 7.8 pt over the row it was reaching (the regression guard's c2, limit 3).
  // Where the two glyphs are side by side the path is between the rows and the lane is whole (the plan's real inputs played in the tests: 0 px^2). Not for the other pairs: at Narrow, Sidebar +
  // address <-> Tabs on top + sidebar, the same hold left Forward and Reload 2.7 px^2 on each other.
  const lo = Math.min(m.first.y, m.last.y), hi = Math.max(m.first.y, m.last.y);
  return { x: mix(from.x, to.x, k), y: m.keepRows && m.bow && hi - lo > 12 ? Math.min(hi + ROW_LEEWAY, Math.max(lo - ROW_LEEWAY, y)) : y, width: m.resizes ? mix(from.width, to.width, k) : to.width, height: m.resizes ? mix(from.height, to.height, j) : to.height };
}
/** How far past its own two rows a piece that changes rows may bow (D100). */
export const ROW_LEEWAY = 2;

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
  return { spring: { ...sch.drawer }, lag: { ...(sch.lagX ? { x: sch.lagX } : {}), ...(sch.lagY ? { y: sch.lagY } : {}) } };
}

// ---- Beta 14.0: the row morph ------------------------------------------------------------------------------------------------------------------------------------------
// Sidebar <-> Sidebar + address with the sidebar standing (reported 19 Nov: "the way the address goes to the sidebar should go the smoothest way possible"). The plan above carried the
// field sideways along the bar, over Back / Reload / Forward and the sidebar button, and dropped it last: text over icons for 100 ms. Here nothing crosses anything, and the plan is not a
// list of numbers for one width: it is worked out from the boxes it is given (the three sidebar widths, either side, any window) by playing the morph ahead of time.
//   1. A button that would have to pass two or more others along one row (the sidebar button: first in the bar, last in the sidebar's row) cannot travel: on a 36 px row three glyphs
//      cannot pass it without lying on it. It leaves where it stands and arrives where it will stand, once the others have passed that place.
//   2. Two buttons that swap places (Forward and Reload) pass in two lanes: one glyph a little above the row's middle, the other a little below, for exactly as long as they are side by
//      side. The lanes are measured on the glyphs (16 px), which is what is drawn; the 28 px press areas never fit two deep in a 36 px row.
//   3. The field changes sides of the page's corner (from the bar above the page to the row beside it, or back). The page is drawn ABOVE the interface, so the one way round that corner
//      that crosses nothing is under the page: the field goes straight down behind the page's top edge (or sideways behind its side edge), is placed, covered, behind the edge it comes
//      out from, at the size it ends with, and slides out along its new row. It is one element all the way; the interface cuts it where the page covers it (ui/sidebarMorph.ts), so a
//      page the interface draws itself covers it exactly as a website does.
//   4. Whatever only one layout has leaves where it stands at once, or arrives where it will stand only when every traveller has cleared its place.
//   5. A traveller waits while a control that is leaving is still fading on its path, and while the band it travels into is still under the page.

/** Where a button's glyph sits inside its box (px from the box's top-left corner). */
export interface Ink { dx: number; dy: number; width: number; height: number }
/** What of a piece is drawn, given its box of the moment: its glyph (a button), or the whole box (the field, a block of the sidebar). */
export const inkOf = (m: Pick<Mover, 'ink'>, box: Box): Box => (m.ink ? { x: box.x + m.ink.dx, y: box.y + m.ink.dy, width: m.ink.width, height: m.ink.height } : box);

/** px kept between a traveller and a control that stands (or one that is leaving or arriving), and sideways between two glyphs before they count as side by side. */
export const CLEAR = 2;
/** px kept from a control that is leaving where it stands (it is fading: a traveller may pass a pixel from it, never over it). */
export const LEAVING_CLEAR = 1;
/** px between the two glyphs of a pair that passes in lanes, one above the other. One, so that in a 36 px row both lanes stay a pixel and a half inside the row (the lower lane is the one that crosses over the page's column while the bar is still opening: every pixel lower makes the buttons wait longer). */
export const LANE_GAP = 1;
/** A control that leaves where it stands is gone, to the eye, this long after the start (`leaving(LEAVE, 80)` is 3%); one that has to make room for travellers (the sidebar button) is quicker. */
export const LEFT_MS = 80, QUICK_LEAVE = [0, 60] as const, QUICK_LEFT_MS = 44;
/** How long a control that arrives where it will stand takes to come in. */
export const ARRIVE_MS = 130;
/** The longest the field waits to take a straight way (for the buttons or a leaving control to clear its row); past that, a way under the page starts at once and is the better one. */
export const STRAIGHT_WAIT_MS = 120;
/** D100f: how far behind its curve main draws a page edge that GIVES ROOM (the top edge going down under a bar that arrives, a side going in beside a sidebar that opens): it takes each whole point
 * two display frames after its curve reaches it and is rounded toward the chrome (desktop/page-motion.cjs STEP_LAG_FRAMES, D97; 34 ms at 60 Hz, 17 at 120), on the screen's clock whatever the
 * speed. The plan's own card is the curve itself. Out of Sidebar + address into Along the top the field crosses into the bar's row as the page's top edge clears it: judged against the curve it
 * was in sight, on the screen its end lay under the page's edge for a frame (the regression guard's c2 since D97 met D100 on the release tip: 0.7 to 1.9 % of the field at Premium, 3.0 to
 * 5.3 % at Fast, the limit 5; 0 on D100's own base). */
export const GIVE_ROOM_MS = 34;
/** D100f: how long the sidebar's column waits at least before it closes where the field goes first (out of Sidebar + address into Along the top): longer than the field may wait, always. The
 * field's near end rides the column's edge; a column that set off before the field carried it back on its way. At Premium the column's own 180 ms was enough; the room for main's page above
 * does not shrink with the speed while the column's wait does, and at Fast the field (98 ms) started after the column (90): 27 to 32 pt back on its way (the regression guard's c2 at Fast). */
export const fieldFirstColumnLag = (scale: number): number => Math.round(STRAIGHT_WAIT_MS * scale) + 2 * GIVE_ROOM_MS + 4;
/** The shares of the spring's travel at which a piece that goes under the page may pass the page's edge (its first travel aims that much further than the edge). The way under the page reads as ONE move:
 * the piece passes the edge while the spring is still quick, and comes out of the other edge at the speed it went under at (`Dive.launch`: the spring that carries it out starts with that speed instead of
 * from rest). A spring can take only so much starting speed without passing its place (its own rate times the way it has to go), so where the way out is short (the field rising 30 px into the bar) the
 * piece passes the edge later in its travel, slower: the plan takes the first of these shares whose speed at the edge the way out can take. The first is the quickest: the edge is passed about 50 ms in at
 * Premium, still gathering speed. */
export const HIDE_SHARES = [.45, .55, .65, .75, .8, .85, .9] as const;
/** D116 (`Hop`): px it stands outside the column's edge where it fades; the share of its way along the band at which it starts to fade, and how long it takes to fade out and in (ms at Premium). */
export const HOP_GAP = 8, HOP_FADE_AT = .9, HOP_FADE_MS = 60, HOP_IN_MS = 120;
/** The quickest of them (the field leaving the bar for the sidebar). */
export const HIDE_SHARE = HIDE_SHARES[0];
/** How much of the starting speed a spring could just take (it would arrive without slowing first) the way out is given at most. */
export const LAUNCH_CAP = .97;
/** ms a piece may stay covered by the page and still come out at speed (two frames at 120 a second): longer than that it has stopped, and starts from rest. */
export const HOLD_BLINK_MS = 8;

/** 0 → 1 over a span of ms (smooth). */
export function riseShare(ms: number, span: readonly [number, number]): number { const u = span[1] > span[0] ? Math.min(1, Math.max(0, (ms - span[0]) / (span[1] - span[0]))) : ms >= span[1] ? 1 : 0; return u * u * (3 - 2 * u); }
/** ms a spring takes to reach a share of its travel. */
export function msToReach(spec: { duration: number; bounce: number }, share: number): number {
  if (share <= 0) return 0; let lo = 0, hi = settleOf(spec) * 1000;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (progressAt(spec, mid) < share) lo = mid; else hi = mid; }
  return hi;
}
/** Windows sweep (19 Nov): the caption buttons stand over the window's top-right corner, so no control may pass under them in any frame. A control that goes DOWN and RIGHT from beside them to a row under them (Sidebar -> Tabs on top + sidebar:
 * the Acira menu, the overflow, Focus ...) waits to go right until it is under the caption's row; one that goes UP and LEFT from under them to beside them (the way back) first goes left, out of the caption's width, then up. Pure: `caption` is the
 * rectangle in the same pixels as the boxes (left edge, height; it reaches the window's right edge). Controls with an end inside the rectangle are not moved. Windows only: the caller passes nothing on the Mac. */
export function captionKeepClear(movers: Mover[], sch: Schedule, caption: { left: number; height: number }): void {
  const inside = (b: Box) => b.x + b.width > caption.left && b.y < caption.height;
  for (const m of movers) {
    const a = m.first, b = m.last;
    if (inside(a) || inside(b)) continue;
    if (!(Math.max(a.x + a.width, b.x + b.width) > caption.left && Math.min(a.y, b.y) < caption.height)) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dy > 0 && dx > 0) m.xDelay = Math.max(m.xDelay, msToReach(sch.mover, Math.min(1, Math.max(0, (caption.height - a.y) / dy))));
    else if (dy < 0 && dx < 0) m.yDelay = Math.max(m.yDelay, msToReach(sch.mover, Math.min(1, Math.max(0, (a.x + a.width - caption.left) / -dx))));
  }
}
/** The shortest time a lane takes to form (at Premium): 9 px in less would be a jolt. */
export const LANE_MS = 64;
/** 0 → 1 → 0 along a travel: rising (smooth) up to span[0], standing at 1 to span[1], settling (smooth) after. */
export function bowShare(k: number, span: readonly [number, number]): number {
  const smooth = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };
  if (k <= span[0]) return span[0] > 0 ? smooth(k / span[0]) : 1;
  if (k >= span[1]) return span[1] < 1 ? 1 - smooth((k - span[1]) / (1 - span[1])) : 1;
  return 1;
}

/** The field's way under the page. */
export interface Dive {
  /** How far (px) the first part of its travel aims, along x and y. */
  dx: number; dy: number;
  /** ms after its start at which the page covers all of it. */
  hideMs: number;
  /** ms it then stays covered before it comes out (the row it comes out into is not clear yet). */
  hold: number;
  /** Its box behind the page's edge as it starts to come out, in the layout it ends in: the size it ends with, flush behind the edge it comes out from. */
  from: Box;
  /** The speed it comes out at, in shares of its way out per second: the speed it went under at. 0 or missing: from rest (it had to wait covered, or the spring is not the plain one). */
  launch?: number;
}
/** 0 → 1: the spring's response `ms` in when it starts at `launch` (shares of the way per second) instead of from rest; never past its place. */
export function launchAt(spec: { duration: number; bounce: number }, ms: number, launch: number): number {
  if (!(launch > 0)) return progressAt(spec, ms);
  const t = ms / 1000; if (t <= 0) return 0;
  return t >= settleOf(spec) ? 1 : Math.min(1, springAt(spec, 0, 1, t, launch).value);
}
function diveBox(m: Mover, first: LayoutNumbers, last: LayoutNumbers, now: LayoutNumbers, sch: Schedule, local: number, dir: 1 | -1): Box {
  const d = m.dive!, out = d.hideMs + d.hold, mix = (a: number, b: number, t: number) => a + (b - a) * t;
  if (local < out) { const k = progressAt(sch.mover, Math.min(local, d.hideMs)); return { x: m.first.x + (m.attach0 ? dir * (now.col - first.col) : 0) + d.dx * k, y: m.first.y + d.dy * k, width: m.first.width, height: m.first.height }; }
  const k = launchAt(sch.mover, local - out, d.launch ?? 0);
  return { x: mix(d.from.x, m.last.x, k) + (m.attach1 ? dir * (now.col - last.col) : 0), y: mix(d.from.y, m.last.y, k), width: m.last.width, height: m.last.height };
}

/** D116 (Beta 14.1): THE FIELD THAT CANNOT STAY IN SIGHT GOES ROUND, NOT UNDER. In the COMPACT window view the Sidebar mode switch (`fieldFirst`) takes the field between the bar's 32 px band and the
 * sidebar's column BELOW that band: the band holds Back, Forward and Reload, the arriving sidebar button and the window's buttons, and the column is uncovered only as the page's edge reaches its
 * end, so no way keeps the whole field in sight without crossing them. It went under the page (the dive): on real frames cut by the page's edge for 5 to 6 frames each way, 82 to 99 % under the
 * native page in the regression guard's c2, with a 450 px jump while it was covered (14.0's tip, 20 Nov). It now glides along the band, in sight, to just outside the column's edge (`at`), fades
 * there, and fades in at its place in the column once the page's edge has uncovered it; and the other way, fades where it stands in the column and fades in outside the column's edge, then glides
 * along the band to its place. The way it is not seen is the hop from `at` into the column (~240 px), well within what its own travel allows. */
export interface Hop {
  /** 'in': along the band to `at`, then into the column; 'out': from the column to `at`, then along the band. */
  leg: 'in' | 'out';
  /** Its box just outside the column's edge, in the band, the size it has there. */
  at: Box;
  /** ms from the morph's start: it fades out over [outStart, outEnd] and in over [inStart, inEnd]. */
  outStart: number; outEnd: number; inStart: number; inEnd: number;
}
/** How much of a mover is drawn `ms` in: 1, or less for a field on its hop. */
export function hopOpacity(m: Mover, ms: number): number {
  const h = m.hop; if (!h) return 1;
  const ramp = (a: number, b: number) => (b > a ? Math.min(1, Math.max(0, (ms - a) / (b - a))) : ms >= a ? 1 : 0);
  if (ms < h.inStart) return 1 - ramp(h.outStart, h.outEnd);
  return ramp(h.inStart, h.inEnd);
}
function hopBox(m: Mover, sch: Schedule, ms: number): Box {
  const h = m.hop!, mix = (a: number, b: number, t: number) => a + (b - a) * t, box = (a: Box, b: Box, k: number) => ({ x: mix(a.x, b.x, k), y: mix(a.y, b.y, k), width: mix(a.width, b.width, k), height: mix(a.height, b.height, k) });
  if (h.leg === 'in') return ms >= h.inStart ? { ...m.last } : box(m.first, h.at, progressAt(sch.mover, ms, sch.moveDelay + (m.wait ?? 0)));
  return ms < h.inStart ? { ...m.first } : box(h.at, m.last, progressAt(sch.mover, ms, h.inStart));
}

/** The page card: what main draws the page in, and what covers anything the interface moves under it. */
export interface PageBox { left: number; top: number; right: number; bottom: number; radius: number }
/** The card `ms` in: its left and right edges on the x clock, its top and bottom on the y clock, its corner on the drawer's (the same clocks as `layoutAt`, which is what draws it). */
export function pageBoxAt(first: PageBox, last: PageBox, sch: Schedule, ms: number): PageBox {
  const x = progressAt(sch.drawer, ms, sch.lagX), y = progressAt(sch.drawer, ms, sch.lagY), c = progressAt(sch.drawer, ms), mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return { left: mix(first.left, last.left, x), right: mix(first.right, last.right, x), top: mix(first.top, last.top, y), bottom: mix(first.bottom, last.bottom, y), radius: mix(first.radius, last.radius, c) };
}
const rightOf = (b: Box) => b.x + b.width, bottomOf = (b: Box) => b.y + b.height;
const grown = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 });
/** How far apart two boxes are (0 when they touch or overlap). */
export const gapOf = (a: Box, b: Box): number => Math.max(0, Math.max(a.x - rightOf(b), b.x - rightOf(a)), Math.max(a.y - bottomOf(b), b.y - bottomOf(a)));
/** px² two boxes share. */
export const overlapOf = (a: Box, b: Box): number => Math.max(0, Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y));
/** The page covers all of a box. A corner's cut-out covers nothing: a box that reaches into the square of a round corner is not covered. */
export function coveredByPage(box: Box, page: PageBox): boolean {
  if (box.x < page.left || rightOf(box) > page.right || box.y < page.top || bottomOf(box) > page.bottom) return false;
  const r = page.radius, sideways = box.x < page.left + r || rightOf(box) > page.right - r, upright = box.y < page.top + r || bottomOf(box) > page.bottom - r;
  return !(sideways && upright);
}
/** The parts of a box the page does not cover, as boxes: what lies outside the page's rectangle, and what lies in the square of one of its round corners (counted whole: the safe side). */
export function uncovered(box: Box, page: PageBox): Box[] {
  const out: Box[] = [], add = (x0: number, y0: number, x1: number, y1: number) => { const x = Math.max(x0, box.x), y = Math.max(y0, box.y), w = Math.min(x1, rightOf(box)) - x, h = Math.min(y1, bottomOf(box)) - y; if (w > 0 && h > 0) out.push({ x, y, width: w, height: h }); };
  const far = 1e6, r = page.radius;
  add(-far, -far, far, page.top); add(-far, page.bottom, far, far); add(-far, page.top, page.left, page.bottom); add(page.right, page.top, far, page.bottom);
  if (r > 0) { add(page.left, page.top, page.left + r, page.top + r); add(page.right - r, page.top, page.right, page.top + r); add(page.left, page.bottom - r, page.left + r, page.bottom); add(page.right - r, page.bottom - r, page.right, page.bottom); }
  return out;
}

/** A control only one of the two layouts has: what of it is drawn, and (leaving) when it is gone to the eye. */
export interface Still { id: string; box: Box; /** px kept clear of it (CLEAR when not given; the Mac's window buttons are discs, their box's corners empty: 0) */ clear?: number; goneAt?: number; /** its copy rides with the sidebar's column (a piece of the old sidebar, or of a block in it): its box moves by the column's travel */ rides?: boolean }
export interface RowMorphInput {
  movers: Mover[]; first: LayoutNumbers; last: LayoutNumbers; page0: PageBox; page1: PageBox; sch: Schedule; dir: 1 | -1;
  /** The row the buttons travel along: its height (the old header's or the new one's, whichever is taller). */
  band: number;
  /** Controls that leave where they stand, and ones that arrive where they will stand. */
  leaving: Still[]; arriving: Still[];
  /** Controls that stand where they are through the whole switch (the sidebar button of a bar that only gains or loses a row): in a traveller's way for good. */
  standing?: Still[];
  /** D100 (Along the top <-> Sidebar + address): where the field cannot go straight only because the row's buttons are in its way, the field goes as soon as it can and the BUTTONS wait until it has
   * made room, instead of the field going under the page or the buttons leaving where they stand. */
  fieldFirst?: boolean;
}
export interface RowMorphPlan {
  /** The pieces that travel (the given objects, with their waits, lanes and the field's dive set). */
  movers: Mover[];
  /** Pieces that cannot travel (rule 1): they leave where they were and arrive where they will be. */
  demoted: Mover[];
  /** By id, ms from the start at which the place of a control that arrives is clear of every traveller (a demoted piece's too). */
  clearAt: Record<string, number>;
  /** The same for a control that is not drawn at its place while the column opens or closes: `ride` is how far along the row it is drawn from its place at the first column (it comes in riding the
   *  sidebar's edge); at a moment it is drawn at that share of `ride` the column still has to go. Never sooner than its place itself is clear. */
  clearOf: (place: Box, ride: number) => number;
}

/** Is this the row morph's: the sidebar stands (its column does not change) and the field ends above the page or beside it. The buttons may keep their row (Sidebar <-> Sidebar + address) or change it with the
 * bar (a tab strip arriving above the toolbar or leaving). (Turned round half way the field may be
 * anywhere: where it changes sides of the page's corner it goes under the page, where it is already on the side it ends on it simply goes back.) */
export function rowMorphApplies(movers: Mover[], first: LayoutNumbers, last: LayoutNumbers, page0: PageBox, page1: PageBox, dir: 1 | -1, columnOpens = false): boolean {
  const field = movers.find(m => m.resizes);
  // (Beta 14.0: with Along the top on one side the column opens from nothing or closes to nothing, on the morph's clock: the page's side edge moves with it, and the plan works from the page's box of every moment.)
  const opens = columnOpens && Math.min(first.col, last.col) < 1 && Math.max(first.col, last.col) >= 1;
  if (!field || (!opens && (Math.abs(first.col - last.col) >= 1 || last.col < 1))) return false;
  const to = regionOf(field.last, page1, dir), from = regionOf(field.first, page0, dir);
  return (to === 'band' || to === 'column') && from !== 'corner';
}
type Region = 'band' | 'column' | 'under' | 'corner';
/** Where a box is drawn: above the page (the bar), beside it in the sidebar's column, covered by it, or round its corner (above and beside at once). */
export function regionOf(box: Box, page: PageBox, dir: 1 | -1): Region {
  if (coveredByPage(box, page)) return 'under';
  const beside = dir === 1 ? box.x < page.left - .5 : rightOf(box) > page.right + .5, above = box.y < page.top - .5;
  if (beside && above && (dir === 1 ? rightOf(box) > page.left + .5 : box.x < page.right - .5) && bottomOf(box) > page.top + .5) return 'corner';
  return beside ? 'column' : 'band';
}

/** Work the row morph out (see the rules above). Mutates the movers it keeps and `sch` (no common wait: each piece has its own; the total). */
export function planRowMorph(input: RowMorphInput): RowMorphPlan {
  const { first, last, page0, page1, sch, dir, band } = input;
  sch.moveDelay = 0;
  let movers = input.movers.slice();
  for (const m of movers) { m.wait = 0; m.xDelay = 0; m.yDelay = 0; m.bow = 0; m.bowSpan = undefined; m.bowRise = undefined; m.dive = undefined; m.hop = undefined; }
  const cx = (b: Box) => b.x + b.width / 2, cy = (b: Box) => b.y + b.height / 2;
  const settle = Math.round(springSettle(sch.mover) * 1000), horizon = () => Math.max(sch.total, ...movers.map(endOf)) + 8;
  const endOf = (m: Mover) => (m.hop ? Math.max(m.hop.inEnd, m.hop.leg === 'out' ? m.hop.inStart + settle : 0) : (m.wait ?? 0) + Math.max(m.xDelay, m.yDelay) + (m.dive ? m.dive.hideMs + m.dive.hold : 0) + settle);
  // The layout and the page card of a moment depend on the moment alone (the lags are set before the plan): worked out once each, the plan asks for them many thousands of times.
  const lays = new Map<number, LayoutNumbers>(), pages = new Map<number, PageBox>();
  const layAt = (ms: number) => { let lay = lays.get(ms); if (!lay) { lay = layoutAt(first, last, sch, ms); lays.set(ms, lay); } return lay; };
  const pageAt = (ms: number) => { let page = pages.get(ms); if (!page) { page = pageBoxAt(page0, page1, sch, ms); pages.set(ms, page); } return page; };
  /** The page as main draws it, for what has to stay IN SIGHT (`fieldFirst` only): an edge that gives room stands where its curve stood GIVE_ROOM_MS before, on the whole point toward the chrome. */
  const drawnPageAt = (ms: number): PageBox => {
    const now = pageAt(ms); if (!input.fieldFirst) return now;
    const then = pageAt(Math.max(0, ms - GIVE_ROOM_MS));
    return { ...now, top: page1.top > page0.top ? Math.floor(then.top + 1e-6) : now.top, left: page1.left > page0.left ? Math.floor(then.left + 1e-6) : now.left, right: page1.right < page0.right ? Math.ceil(then.right - 1e-6) : now.right, bottom: page1.bottom < page0.bottom ? Math.ceil(then.bottom - 1e-6) : now.bottom };
  };
  /** How much longer the field and the buttons may wait for it than they could (the search's bound, not the wait). */
  const room = input.fieldFirst ? 2 * GIVE_ROOM_MS : 0;
  const boxAt = (m: Mover, ms: number) => moverBox(m, first, last, layAt(ms), sch, ms, dir);
  /** What of a mover is drawn `ms` in: a button's glyph, a block's box, the field's box less what the page covers. */
  const drawnAt = (m: Mover, ms: number): Box[] => { if (m.hop && hopOpacity(m, ms) < .05) return []; const ink = inkOf(m, boxAt(m, ms)); return m.resizes ? uncovered(ink, pageAt(ms)) : [ink]; };
  const hits = (parts: Box[], others: Box[], pad = CLEAR) => parts.some(a => others.some(b => overlapOf(grown(a, pad / 2), grown(b, pad / 2)) > 0));
  // The morph is played ahead every few ms: 4 at Premium, and as many samples of the travel at any other pace (Fast moves twice as far in a ms).
  const STEP = Math.max(1, Math.round(4 * sch.scale));

  // 1. A button that would pass two or more others along its row cannot travel.
  const buttons = () => movers.filter(m => m.ink && !m.resizes && !m.block);
  const sameRow = (a: Mover, b: Mover) => Math.abs(cy(inkOf(a, a.first)) - cy(inkOf(b, b.first))) < 8 && Math.abs(cy(inkOf(a, a.last)) - cy(inkOf(b, b.last))) < 8;
  const swaps = (a: Mover, b: Mover) => sameRow(a, b) && (cx(inkOf(a, a.first)) < cx(inkOf(b, b.first))) !== (cx(inkOf(a, a.last)) < cx(inkOf(b, b.last)));
  const demoted: Mover[] = [];
  const demote = (m: Mover) => { demoted.push(m); movers = movers.filter(item => item !== m); };
  for (;;) {
    const list = buttons(), counts = list.map(m => list.filter(o => o !== m && swaps(m, o)).length), most = Math.max(0, ...counts);
    if (most < 2) break;
    const tied = list.filter((_, i) => counts[i] === most);
    demote(tied.reduce((a, b) => (Math.abs(b.last.x - b.first.x) < Math.abs(a.last.x - a.first.x) ? b : a)));
  }
  // 2. Two that swap pass in two lanes, as high as the row allows; with no room for two glyphs the one that travels less cannot travel either.
  const pairs: [Mover, Mover][] = [];
  for (const a of buttons()) for (const b of buttons()) {
    if (a === b || !movers.includes(a) || !movers.includes(b) || !swaps(a, b) || Math.abs(a.last.x - a.first.x) < Math.abs(b.last.x - b.first.x) || a.bowSpan || b.bowSpan) continue;
    // a travels further: it takes the upper lane. Both glyphs are side by side while their centres are nearer than half their widths and the clearance: the lanes stand that long.
    const ia = inkOf(a, a.first), ib = inkOf(b, b.first), c0 = cx(ia) - cx(ib), rel = (a.last.x - a.first.x) - (b.last.x - b.first.x), reach = (ia.width + ib.width) / 2 + CLEAR;
    let k0 = (-reach - c0) / rel, k1 = (reach - c0) / rel; if (k0 > k1) [k0, k1] = [k1, k0];
    const need = (ia.height + ib.height) / 2 + LANE_GAP, up = Math.min(inkOf(a, a.first).y, inkOf(a, a.last).y) - 1, down = band - 1 - Math.max(bottomOf(inkOf(b, b.first)), bottomOf(inkOf(b, b.last)));
    if (!(k0 > .02 && k1 < .995) || up + down < need || up < 0 || down < 0) { demote(b); continue; }
    const rise = Math.min(up, Math.max(need / 2, need - down));
    a.bow = -rise; b.bow = need - rise; a.bowSpan = b.bowSpan = [k0, k1]; pairs.push([a, b]);
  }
  const train = buttons(), field = movers.find(m => m.resizes), blocks = movers.filter(m => m.block);
  if (input.fieldFirst) for (const m of train) m.keepRows = true;
  // 5a. The row's buttons travel on one clock (their lanes are worked out on it). They wait while a leaving control is still to be seen where one of them would pass, while the page still covers the band one
  // of them travels into, and (`also`) while the field is still to be seen on their way.
  const leavingNow = (ms: number) => [...input.leaving.filter(s => ms < (s.goneAt ?? LEFT_MS) * sch.scale + STEP).map(s => (s.rides ? { ...s.box, x: s.box.x + dir * (layAt(ms).col - first.col) } : s.box)), ...(ms < QUICK_LEFT_MS * sch.scale + STEP ? demoted.map(m => inkOf(m, m.first)) : [])];
  const trainFaults = (also?: (ms: number) => Box[]) => { for (let ms = 0; ms <= horizon(); ms += STEP) { const page = pageAt(ms), gone = leavingNow(ms), more = also ? also(ms) : []; for (const m of train) { const ink = inkOf(m, boxAt(m, ms)), safe = grown(ink, .5); /* half a pixel clear of the page's edge, so nothing slips in between two samples */ if (hits([ink], gone, LEAVING_CLEAR) || (more.length && hits([ink], more)) || uncovered(safe, page).reduce((sum, part) => sum + part.width * part.height, 0) < safe.width * safe.height - .001) return true; } } return false; };
  // A lane forms over LANE_MS at least, ending where the two glyphs come side by side; it may form while the buttons still wait, and they wait a little longer when that is too short.
  // (a pair that changes rows as well is already travelling up or down by a whole row: its lanes need no time of their own)
  const lanes = train.filter(m => m.bowSpan), laneNeed = Math.max(0, ...lanes.map(m => (Math.abs(m.last.y - m.first.y) > 12 ? 0 : Math.round(LANE_MS * sch.scale - msToReach(sch.mover, m.bowSpan![0])))));
  const setWait = (wait: number) => { for (const m of train) { m.wait = wait; if (m.bowSpan) { const side = wait + m.xDelay + msToReach(sch.mover, m.bowSpan[0]); m.bowRise = [Math.max(0, side - Math.round(2 * LANE_MS * sch.scale)), side]; } } };
  const trainWaits = (from: number, also?: (ms: number) => Box[]) => { for (let wait = from; wait <= 400 && train.length; wait += STEP) { setWait(wait); if (!trainFaults(also)) return true; } if (train.length) setWait(from); /* nothing clears it (a morph turned round with the band closing): they go at once */ return false; };
  trainWaits(laneNeed);
  // Which of a pair takes the upper lane is free: the other way round is taken where it lets the row start sooner (a glyph in the upper lane can clip a control of the row above that is still leaving).
  for (const [a, b] of pairs) {
    const was = train[0]?.wait ?? 0; if (was <= laneNeed) break;
    const flip = () => { const up = a.bow; a.bow = -b.bow; b.bow = -up; };
    flip(); trainWaits(laneNeed);
    if ((train[0]?.wait ?? 0) >= was) { flip(); trainWaits(laneNeed); }
  }

  // 5d. What stands where it is through the whole switch is in a traveller's way for good: waiting does not help. The row's buttons then take their two directions one after the other (down or up
  // first and then along the row, or along first), by the shortest delay that lets every glyph pass clear of it. (The sidebar on the right: the toolbar's row under a tab strip starts at the window's
  // edge, left of the sidebar button that stays in the row above, and Back's glyph went through the button's on its diagonal.)
  let standing = input.standing ?? [];
  const hitsStanding = (m: Mover) => { for (let ms = 0; ms <= horizon(); ms += STEP) { const ink = inkOf(m, boxAt(m, ms)); if (standing.some(still => hits([ink], [still.box], still.clear ?? CLEAR))) return true; } return false; };
  const standingHit = () => train.some(hitsStanding);
  /** px^2 two of the train's glyphs lie on each other at worst (the lanes keep them apart). */
  const glyphsMeet = () => { let worst = 0; for (let ms = 0; ms <= horizon(); ms += STEP) { const inks = train.map(m => inkOf(m, boxAt(m, ms))); for (let a = 0; a < inks.length; a++) for (let b = a + 1; b < inks.length; b++) worst = Math.max(worst, overlapOf(inks[a], inks[b])); } return worst; };
  if (standing.length && train.length && standingHit()) {
    // (D109: the delay may not put one glyph on another. Delaying the whole row's change held Forward's and Reload's lanes at the row they share, the swap's two glyphs on each other: 71 px^2 on the
    // plan's real inputs with the Mac's window buttons standing. Where the whole row cannot go round it that way, only the buttons whose own way crosses it take the two directions one after the
    // other, the others keep their way, and they may wait longer: Back at Narrow has to be past the window buttons' end before it rises beside them.)
    const meetBefore = glyphsMeet(), hitters = train.filter(hitsStanding), step = 2 * STEP;
    let best: { axis: 'x' | 'y'; ms: number; only: Mover[] | null } | null = null;
    const set = (axis: 'x' | 'y', delay: number, only: Mover[] | null) => { for (const m of train) { const d = !only || only.includes(m) ? delay : 0; m.xDelay = axis === 'x' ? d : 0; m.yDelay = axis === 'y' ? d : 0; } };
    for (const [only, cap] of [[null, 200], [hitters, 320]] as const) {
      for (const axis of ['x', 'y'] as const) for (let delay = step; delay <= Math.round(cap * sch.scale) && (!best || delay < best.ms); delay += step) {
        set(axis, delay, only);
        if (!standingHit() && trainWaits(laneNeed) && !standingHit() && glyphsMeet() <= meetBefore + .5) { best = { axis, ms: delay, only }; break; }   // (the cheap look first: which way the glyphs pass does not depend on when they start)
      }
      if (best) break;
    }
    if (best) set(best.axis, best.ms, best.only); else set('x', 0, null);
    trainWaits(laneNeed);
    // Nothing goes round the window buttons: the plan goes on as if they were not there (as it did before D109), never sends the field under the page for them.
    if (!best) standing = standing.filter(still => still.id !== 'lights');
  }

  // 5c. The sidebar's blocks wait, too, while a control that is leaving is still to be seen where they would pass (the pill's line under the field, as the head closes).
  const blocksClearLeaving = (from: number) => { for (let wait = from; wait <= 400 && blocks.length; wait += STEP) { for (const b of blocks) b.wait = wait; let hit = false; for (let ms = 0; !hit && ms <= LEFT_MS * sch.scale + STEP; ms += STEP) { const gone = leavingNow(ms); if (gone.length && blocks.some(b => { const box = boxAt(b, ms); return (Math.abs(box.x - b.first.x) > .5 || Math.abs(box.y - b.first.y) > .5) && hits([box], gone, LEAVING_CLEAR); })) hit = true; } if (!hit) break; } };
  blocksClearLeaving(0);
  // 3. The field. Where a straight way keeps all of it in sight (never under the page) and, after a short wait at most, crosses nothing, it takes it: a row that only moves up or down with the bar, or a slide
  // along one row into the sidebar. Where the straight way lies under the page (it changes sides of the page's corner) it goes under the page.
  /** Returns what tells whether the buttons meet the field, and whether the buttons were what kept the field from waiting in sight (they pass along the row it would stand in). */
  const planField = (field: Mover) => {
    let blocked = false;
    field.wait = 0; field.dive = undefined; field.hop = undefined;
    const restGap = (o: Mover) => Math.min(CLEAR, gapOf(field.first, inkOf(o, o.first)), gapOf(field.last, inkOf(o, o.last)));
    const fieldMeets = (others: Mover[], fromMs: number, toMs: number) => { for (let ms = fromMs; ms <= toMs; ms += STEP) { const parts = drawnAt(field, ms); if (parts.length && others.some(o => hits(parts, drawnAt(o, ms), restGap(o)))) return true; } return false; };
    const others = [...blocks, ...train];
    // (D100, `fieldFirst`: a field that still stands where it stood crosses nothing. The pill's line lies right under the field in the sidebar's block, the two touching at rest: counted as a
    // crossing while the pill left, it ruled the straight way out for good, and out of Sidebar + address into Along the top the field went under the page: the regression guard's c2, 19 Nov.)
    const stood = (box: Box) => Math.abs(box.x - field.first.x) < .5 && Math.abs(box.y - field.first.y) < .5 && Math.abs(box.width - field.first.width) < .5;
    const overLeaving = (box: Box, ms: number) => !(input.fieldFirst && stood(box)) && hits([box], leavingNow(ms), LEAVING_CLEAR);
    const straightClear = () => { for (let ms = 0; ms <= horizon(); ms += STEP) { const box = boxAt(field, ms), seen = uncovered(box, drawnPageAt(ms)).reduce((sum, part) => sum + part.width * part.height, 0); if (seen < box.width * box.height - .5) return false; if (ms <= LEFT_MS * sch.scale && overLeaving(box, ms)) return false; } return !fieldMeets(others, 0, horizon()); };
    let straight = false;
    for (let wait = 0; wait <= Math.round(STRAIGHT_WAIT_MS * sch.scale) + room && !straight; wait += STEP) { field.wait = wait; straight = straightClear(); }
    if (!straight && train.length && (input.fieldFirst || train.some(m => m.xDelay || m.yDelay))) {
      // The buttons travel along the row the field still stands in (they go round a control that stays): the field starts as soon as what is leaving lets it, and the buttons wait until it has made room.
      // (D100, `fieldFirst`: the same out of Sidebar + address into Along the top: the buttons come down into the row the field is still leaving.)
      const alone = () => { for (let ms = 0; ms <= horizon(); ms += STEP) { const box = boxAt(field, ms), seen = uncovered(box, drawnPageAt(ms)).reduce((sum, part) => sum + part.width * part.height, 0); if (seen < box.width * box.height - .5) return false; if (ms <= LEFT_MS * sch.scale && overLeaving(box, ms)) return false; } return true; };
      let soonest = -1; for (let wait = 0; wait <= Math.round(STRAIGHT_WAIT_MS * sch.scale) + room && soonest < 0; wait += STEP) { field.wait = wait; if (alone()) soonest = wait; }
      if (soonest >= 0) {
        const was = train[0].wait ?? 0;
        for (let wait = was; wait <= was + Math.round(240 * sch.scale) + room && !straight; wait += 2 * STEP) { setWait(wait); straight = !standingHit() && !trainFaults() && straightClear(); }
        if (!straight) setWait(was);
      }
    }
    if (!straight) {
      const page = pageAt(0), from = regionOf(field.first, page, dir), to = regionOf(field.last, page1, dir), r = page.radius;
      const spring = springParams(sch.mover), plain = spring.zeta >= .9999, blink = Math.max(STEP, Math.round(HOLD_BLINK_MS * sch.scale));
      const trainWait0 = train[0]?.wait ?? 0;
      let dive: Dive = { dx: 0, dy: 0, hideMs: 0, hold: 0, from: field.last };
      /** The field starts `wait` ms in and aims so that it passes the page's edge at `share` of its first travel. False when the page never covers it. */
      const aim = (wait: number, share: number): boolean => {
        field.wait = wait;
        dive = { dx: 0, dy: 0, hideMs: from === 'under' ? 0 : Number.MAX_SAFE_INTEGER, hold: 0, from: field.last, launch: 0 };
        if (from === to) { /* turned round before it left its side of the corner: it goes straight back */ }
        else if (from === 'band') dive.dy = (page.top + (field.first.x < page.left + r || rightOf(field.first) > page.right - r ? r : 0) - field.first.y) / share;
        else if (from === 'column') dive.dx = dir === 1 ? (page.left + r - field.first.x) / share : -(rightOf(field.first) - (page.right - r)) / share;
        field.dive = from !== to ? dive : undefined;
        // when the page covers it
        let hidden = from === 'under';
        // (looked for every few ms, then back to the first ms it is covered: a scan by the ms cost a quarter of the whole plan where the field has to wait)
        for (let ms = wait; field.dive && !hidden && ms <= wait + settle; ms += STEP) if (coveredByPage(boxAt(field, ms), pageAt(ms))) { let at = ms; while (at > wait && at > ms - STEP && coveredByPage(boxAt(field, at - 1), pageAt(at - 1))) at -= 1; dive.hideMs = at - wait; hidden = true; }
        if (!hidden) field.dive = undefined;   // the page never covers it (no card to go under): it travels straight, as it always did
        return hidden;
      };
      /** px a second at which it passes under the page's edge. */
      const speedIn = () => (dive.hideMs > 0 ? Math.hypot(dive.dx, dive.dy) * springAt(sch.mover, 0, 1, dive.hideMs / 1000).velocity : 0);
      /** Its box behind the edge it comes out from, `hold` ms after the page covered it, and the speed it comes out at: the speed it went under at, where it comes out at once. False while that box is not covered yet. */
      const comeOut = (hold: number) => {
        dive.hold = hold; const at = (field.wait ?? 0) + dive.hideMs + hold, p = pageAt(at);
        dive.from = to === 'column' ? { x: dir === 1 ? p.left + p.radius : p.right - p.radius - field.last.width, y: field.last.y, width: field.last.width, height: field.last.height } : { x: field.last.x, y: p.top + (field.last.x < p.left + p.radius || rightOf(field.last) > p.right - p.radius ? p.radius : 0), width: field.last.width, height: field.last.height };
        const way = Math.hypot(field.last.x - dive.from.x, field.last.y - dive.from.y);
        dive.launch = plain && hold <= blink && way > 1 ? Math.min(speedIn() / way, spring.omega * LAUNCH_CAP) : 0;
        return coveredByPage(dive.from, p);
      };
      /** Could the way out take the speed it goes under at (were it to come out at once)? */
      const takesSpeed = () => { comeOut(0); const way = Math.hypot(field.last.x - dive.from.x, field.last.y - dive.from.y); return !plain || way <= 1 || speedIn() / way <= spring.omega * LAUNCH_CAP; };
      /** Everyone else's waits for this dive, and how long the field has to stay covered before its new row is clear (`quick`: only whether it can come out within a blink; 401 = not found). */
      /** (`quick` also means: the buttons keep the wait they have; a start at which the waiting field is in their way is no start: -1) */
      const settleRest = (quick: boolean): number => {
        setWait(trainWait0);
        const wait = field.wait ?? 0, inSight = (ms: number) => (ms < wait + dive.hideMs ? drawnAt(field, ms) : []);
        // The buttons wait while the field is still in sight on their way (the sidebar on the right: they travel along the bar it is leaving).
        if (train.length && trainFaults(inSight)) { if (quick) return -1; trainWaits(train[0].wait ?? 0, inSight); }
        // 5b. The blocks of the sidebar (the head growing or closing) wait while the field is still to be seen where they would pass.
        comeOut(0);
        for (let w = 0; w <= 400 && blocks.length; w += STEP) { for (const b of blocks) b.wait = w; if (!fieldMeets(blocks, 0, wait + dive.hideMs)) break; }
        blocksClearLeaving(blocks[0]?.wait ?? 0);
        // It comes out when it is covered where it starts from, and its new row is clear of the blocks, the buttons and what is still leaving, from then to the end.
        for (let hold = 0; hold <= (quick ? blink : 400); hold += STEP) {
          // (it can only wait where the page still covers it: an edge that moves on uncovers it where it waits)
          dive.hold = hold; if (hold > 0 && uncovered(boxAt(field, wait + dive.hideMs + hold - 1), pageAt(wait + dive.hideMs + hold - 1)).length) return 401;
          if (!comeOut(hold)) continue;
          const start = wait + dive.hideMs + hold; let clear = !fieldMeets(others, start, horizon());
          for (let ms = start; clear && ms <= LEFT_MS * sch.scale; ms += STEP) if (hits(drawnAt(field, ms), leavingNow(ms), LEAVING_CLEAR)) clear = false;
          if (clear) return hold;
        }
        return 401;
      };
      // The share of its first travel at which it passes the edge: the quickest whose speed the way out can take. Where none can, the way out is a few px (it is the page's own edge that uncovers
      // the piece in its new row): then the slowest at which the page still covers it at all (an edge that is on its way down no longer covers a piece that reaches it late), so that it goes
      // under the page as late as it can and is out of sight the shortest time.
      let share: number = HIDE_SHARES[0];
      for (const candidate of HIDE_SHARES) { if (!aim(0, candidate)) break; share = candidate; if (takesSpeed()) break; }
      if (aim(0, share)) {
        const hold = settleRest(false);
        // It would be out of sight for a while (waiting covered by the page for its new row to clear, or lying in its new row until the page's edge uncovers it): gone, and back a moment later.
        // It starts later instead, standing in sight where it is, so that it goes under the page only when it can come out at once: the start that leaves it out of sight the shortest time
        // (as long as that makes none of the buttons wait longer: where they travel along the row it stands in, it still makes way first).
        const gone = () => { let ms = 0; for (let at = 0; at <= horizon(); at += STEP) if (!drawnAt(field, at).length) ms += STEP; return ms; };
        let least = hold <= blink ? gone() : Number.POSITIVE_INFINITY, start = 0;
        if (least > 2 * blink) {
          const coarse = 4 * STEP; let inWay = 0;
          const tryStart = (wait: number) => { if (!aim(wait, share)) return Number.POSITIVE_INFINITY; const held = settleRest(true); if (held < 0) { inWay += 1; return Number.POSITIVE_INFINITY; } return held <= blink ? gone() : Number.POSITIVE_INFINITY; };
          // every 16 ms first, then once 8 ms sooner than the best: about twenty tries at most where there were forty; three starts in a row that only the buttons spoil end the search
          // (they pass along the row the field would stand in: they cannot travel, see below)
          for (let wait = coarse; wait <= Math.round(320 * sch.scale) && !(inWay >= 3 && start === 0); wait += coarse) { const out = tryStart(wait); if (out < least) { least = out; start = wait; if (out <= 2 * blink) break; } }
          if (start > 2 * STEP) { const out = tryStart(start - 2 * STEP); if (out <= Math.max(least, 2 * blink)) { least = out; start -= 2 * STEP; } }
          blocked = start === 0 && inWay > 0;
          aim(start, share); settleRest(start > 0);
        }
        // (Beta 14.0, Along the top: the field's way to the page's edge may lie across a piece of the old bar that leaves where it stands, a tab of a strip that goes or the tab overview. The straight
        // way is checked against them; the dive was only checked once it came out. It now waits in sight where it stands until its way is clear of them as well.)
        const crossesLeaving = () => { for (let ms = 0; ms <= LEFT_MS * sch.scale + STEP; ms += STEP) if (hits(drawnAt(field, ms), leavingNow(ms), LEAVING_CLEAR)) return true; return false; };
        if (crossesLeaving()) {
          const was = field.wait ?? 0; let clear = false;
          for (let w = was + STEP; w <= was + Math.round((LEFT_MS + 40) * sch.scale) && !clear; w += STEP) { if (!aim(w, share)) continue; clear = settleRest(true) >= 0 && !crossesLeaving(); }
          if (!clear) { aim(was, share); settleRest(was > 0); }
        }
      }
      // (Beta 14.0, Along the top: no straight way and no dive either, the field staying in the bar's band where the page never covers it (Along the top -> Sidebar, its tabs' strip leaving): it went
      // anyway, through the tab of the strip that was still leaving. It now waits in sight where it stands until its way is clear of what is leaving.)
      if (!field.dive && !field.hop) {
        const clearOfLeaving = () => { for (let ms = 0; ms <= Math.round(LEFT_MS * sch.scale) + STEP; ms += STEP) if (hits([boxAt(field, ms)], leavingNow(ms), LEAVING_CLEAR)) return false; return true; };
        for (let w = field.wait ?? 0; w <= Math.round((LEFT_MS + 40) * sch.scale); w += STEP) { field.wait = w; if (clearOfLeaving()) break; }
      }
    }
    return { meets: fieldMeets, blocked };
  };
  if (field) {
    const pass = planField(field);
    // A button whose way lies across the field's own row, with the field in it, cannot travel: there is no lane beside a field. (The sidebar on the right, Sidebar + address <-> Tabs on top + sidebar:
    // the toolbar's row starts at the window's edge, the far side of the field from the sidebar; the only other ways lead through the window's own buttons.) The buttons then leave where they stand and
    // arrive where they will stand, like the sidebar button, and the field is planned again without them. The same where the field could only wait out of sight because the buttons pass along its row.
    if (train.length && (pass.blocked || pass.meets(train, 0, horizon()))) {
      // (D109: where only some of the buttons go round what stands, their two directions one after the other, they may be what keeps the field from its way: at Narrow on the Mac, Back moving
      // along its row past the window buttons before it rises meets the field coming the other way. Those alone then leave where they stand and arrive where they will stand; the others travel.)
      const late = train.filter(m => m.xDelay || m.yDelay); let solved = false;
      if (late.length && late.length < train.length) {
        for (const m of late) { train.splice(train.indexOf(m), 1); demote(m); }
        trainWaits(laneNeed); const again = planField(field); solved = !(again.blocked || again.meets(train, 0, horizon()));
      }
      if (!solved) { for (const m of train.splice(0)) demote(m); planField(field); }
    }
  }
  // D116 (`Hop`): where the straight way of the Sidebar mode switch would take the field under the page, it goes round the page's corner instead: along the band in sight to just outside the
  // column's edge, fading there, and fading in at its place once the page has uncovered it (or the other way round). Tried only between the band and the column, and only where every
  // moment it is drawn is whole in sight against the page as main draws it, clear of what is leaving and of the buttons and the sidebar's blocks; otherwise it dives as before.
  const whole = (box: Box, ms: number) => uncovered(box, drawnPageAt(ms)).reduce((sum, part) => sum + part.width * part.height, 0) >= box.width * box.height - .5;
  const planHop = (f: Mover): boolean => {
    const others = [...blocks, ...train], restGap = (o: Mover) => Math.min(CLEAR, gapOf(f.first, inkOf(o, o.first)), gapOf(f.last, inkOf(o, o.last)));
    const p0 = pageAt(0), from = regionOf(f.first, p0, dir), to = regionOf(f.last, page1, dir);
    const leg: Hop['leg'] | null = from === 'band' && to === 'column' ? 'in' : from === 'column' && to === 'band' ? 'out' : null;
    if (!leg) return false;
    const edge = leg === 'in' ? page1 : p0, width = leg === 'in' ? f.last.width : f.first.width, height = leg === 'in' ? f.first.height : f.last.height;
    let at: Box = { x: dir === 1 ? edge.left + HOP_GAP : edge.right - HOP_GAP - width, y: leg === 'in' ? f.first.y : f.last.y, width, height };
    // (it never goes back on itself: where `at` would not lie between where it starts and where it ends (a wide sidebar on the right in a narrow window), it fades where it stands and in where it
    // ends: no way along the band)
    if (at.x < Math.min(f.first.x, f.last.x) - .5 || at.x > Math.max(f.first.x, f.last.x) + .5) at = { ...(leg === 'in' ? f.first : f.last) };
    const fade = Math.max(STEP, Math.round(HOP_FADE_MS * sch.scale)), come = Math.max(STEP, Math.round(HOP_IN_MS * sch.scale)), limit = horizon() + Math.round(600 * sch.scale);
    const leavingEnd = Math.round(LEFT_MS * sch.scale) + STEP;
    const others0 = others.map(o => ({ o, gap: restGap(o) }));
    /** From which ms on its box `place` is whole in sight and clear of every other piece, to `limit` (-1: never). */
    const clearFrom = (place: Box, from: number) => { let first = -1; for (let ms = limit; ms >= from; ms -= STEP) { const ok = whole(place, ms) && !(ms <= leavingEnd && hits([place], leavingNow(ms), LEAVING_CLEAR)) && !others0.some(({ o, gap }) => hits([place], drawnAt(o, ms), gap)); if (!ok) break; first = ms; } return first; };
    /** Its way while drawn, [a, b]: whole in sight, clear of what is leaving and of the others. */
    const wayClear = (a: number, b: number) => { for (let ms = a; ms <= b; ms += STEP) { const parts = drawnAt(f, ms); if (!parts.length) continue; const box = boxAt(f, ms); if (!whole(box, ms) || (ms <= leavingEnd && hits([box], leavingNow(ms), LEAVING_CLEAR)) || others0.some(({ o, gap }) => hits(parts, drawnAt(o, ms), gap))) return false; } return true; };
    const reach = (wait: number, share: number) => { for (let ms = wait; ms <= limit; ms += STEP) if (progressAt(sch.mover, ms, sch.moveDelay + wait) >= share) return ms; return limit; };
    if (leg === 'in') {
      for (let wait = 0; wait <= Math.round((STRAIGHT_WAIT_MS + LEFT_MS) * sch.scale); wait += STEP) {
        f.wait = wait; const outStart = reach(wait, HOP_FADE_AT), outEnd = outStart + fade;
        f.hop = { leg, at, outStart, outEnd, inStart: limit + 1, inEnd: limit + 1 };
        if (!wayClear(0, outEnd)) {
          // (the sidebar on the right: the buttons travel along the same band towards the column the field glides to; they start once it is out of their way, as they do for a field that
          // makes room first, D100)
          if (!train.length) continue;
          const was = train[0].wait ?? 0;
          if (!trainWaits(was, ms => drawnAt(f, ms)) || !wayClear(0, outEnd)) { setWait(was); continue; }
        }
        // it fades in at its place once that is in sight and clear for good (the field fills the column: its place is beside the column's edge)
        const inStart = clearFrom(f.last, outEnd);
        if (inStart < 0) break;
        f.hop = { leg, at, outStart, outEnd, inStart, inEnd: inStart + come };
        return true;
      }
    } else {
      f.wait = 0;
      // it fades where it stands (beside the column's edge: the field fills the column), and in outside the column's edge once the band there is in sight and clear for good
      const open = clearFrom(at, fade);
      for (let t = open; open >= 0 && t <= limit; t += STEP) {
        f.hop = { leg, at, outStart: 0, outEnd: fade, inStart: t, inEnd: t + come };
        if (wayClear(t, limit)) return true;
      }
    }
    f.wait = 0; f.hop = undefined; return false;
  };
  // D116: the Sidebar mode switch's field that the plan still sends under the page goes round the page's corner instead (`Hop`); every other decision of the plan stands.
  if (field && field.dive && input.fieldFirst) {
    const dive = field.dive, wait = field.wait, waits = train.map(m => m.wait ?? 0);
    field.dive = undefined;
    if (!planHop(field)) { field.dive = dive; field.wait = wait; if (train.length) setWait(waits[0]); }
  }
  // 4. The place of each control that arrives: clear of every traveller from this moment on.
  // (D100b: a control of a bar that stands in the page's column, or one carried on the sidebar's edge, is not drawn at its place while the column opens or closes: it comes in riding that edge, `ride`
  // px from its place at the first column. Its place was clear long before it was: out of Sidebar + address into Along the top, with the field crossing the bar in sight since D100, Home came in
  // lying on the field's end, and so did Back, Forward and Reload where they could not travel (stepped frames, 20 Nov: Narrow and Wide sidebar, up to 521 px^2, Reload at 59 %). Where it is drawn
  // at a moment is what has to be clear.)
  const colShare = (ms: number) => (Math.abs(first.col - last.col) > .5 ? (layAt(ms).col - last.col) / (first.col - last.col) : 0);
  // (The span looked at is taken once: the switch's own end grows by the arrivals below, and an arrival timed after the plan was made, the engine's, has to look at the same span. A layer of
  // the sidebar that a traveller ends in is in its way to the last moment looked at: asked again after the end had grown it answered 140 ms later, and Sidebar mode on took 861 ms where it
  // took 724, the regression guard's own figure, 20 Nov.)
  const end = horizon();
  // (D109: what stands is in the way of an arrival drawn away from its place too. At Narrow in a 900 px window, the way in, Back arrives where it will stand beside the window buttons, but it is
  // carried in on the opening sidebar's edge: from its place's clearAt on it faded in 10 px short of it, on the third button for 4 frames at 7 to 34 % (stepped frames, 20 Nov: 109 px^2). Kept off
  // what stands where it is drawn; a piece whose own place is closer to one than that one's clearance keeps the gap its place has.)
  const stills = input.standing ?? [];
  const clearOf = (place: Box, ride: number) => {
    let at = 0;
    const around = ride ? stills.map(still => ({ box: still.box, pad: Math.min(still.clear ?? CLEAR, gapOf(still.box, place)) })) : [];
    // (only what is drawn as a thing of its own can be in the way: a button's glyph, the field, a block; a layer that fills the sidebar is behind everything)
    for (let ms = 0; ms <= end; ms += STEP) {
      const drawn = { ...place, x: place.x + ride * colShare(ms) }, here = ride ? [place, drawn] : [place];
      if (movers.some(m => (m.ink || m.resizes || m.block) && hits(drawnAt(m, ms), here, Math.min(CLEAR, gapOf(inkOf(m, m.last), place))))) at = ms + STEP;
      else if (around.some(still => hits([drawn], [still.box], still.pad))) at = ms + STEP;
    }
    return at;
  };
  const clearAt: Record<string, number> = {};
  for (const still of [...input.arriving, ...demoted.map(m => ({ id: m.id, box: inkOf(m, m.last) }))]) clearAt[still.id] = clearOf(still.box, 0);
  sch.total = Math.max(sch.total, ...movers.map(endOf), ...Object.values(clearAt).map(at => at + Math.round(ARRIVE_MS * sch.scale)));
  return { movers, demoted, clearAt, clearOf };
}
