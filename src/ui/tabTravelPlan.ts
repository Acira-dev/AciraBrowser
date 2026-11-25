/* The tabs' travel in a layout switch that moves them between the strip along the top and the sidebar's list (D102; the team, 19 Nov: "approach it the same way u approached how the icons float
 * from sidebar to mini... that nice morph with no overlapping and glitches"). The arithmetic, as pure numbers (no DOM): ui/tabTravel.ts measures the window and plays it inside the layout morph
 * (ui/sidebarMorph.ts), on the morph's own clock.
 *
 * What travels, per tab: its ICON, one element drawn once, from the icon's own place in the strip to the icon's place in its row of the list (and back). The plate and the title do not travel: a strip
 * tab is as wide as five rows are high, so two neighbours' titles would lie over one another for half of any path. They go as a favorite's tile does in the Full <-> Mini glide: the old ones leave with
 * the old chrome at the start, the new ones arrive at the end, each only when no icon passes over it any more.
 *
 *   start      the icon's own box in the layout that is left, read from the screen
 *   end        its twin's box in the layout that comes
 *   clock      the morph's: every icon leaves in the first frame and lands in the last
 *   path       A website's page is a native view drawn ABOVE the interface: an icon on the straight line from the strip to its row is under the page for most of the way, so the path goes round the
 *              page's corner, inside the chrome. Two ways, by what the window has:
 *     HEAD     (the sidebar's head row has free room: `head`) three legs that overlap in time. Strip -> list: the icon runs along the strip into the head row, to its own place in a line there
 *              (`gather`; done in the first `RUN` of the time, before the toolbar's buttons rise into the strip's row); it drops to its row's height inside the sidebar's column; it slides along its
 *              own row into its place, where it stands from `SLIDE[1]` of the time on (its title comes in once it stands there). List -> strip: the same legs the other way round, each slow into its end. No icon is ever under the page while the column stands.
 *     LATE     (the way out to a layout with NO sidebar: its column closes from the first frame, and the page covers the list's icons within about 150 ms, real takes of 19 Nov: the page's edge at
 *              x 92 after 104 ms, at 29 after 155) the HEAD way's last leg only. No path out of a column that is being covered keeps an icon in sight: they could only leave through the strip of the
 *              column the page uncovers last, in the list's order, which is the reverse of the order they need along the strip. So the old icons leave with the sidebar, as it does, and each
 *              traveller is first drawn where it comes out on the head row's line (always above the page), over `APPEAR` of the time, and runs along the strip to its place.
 *     CORNER   (no free head row) one bent line: x leads and y lags by `lag` of the time on the way to the list, the same path walked back on the way out. An icon is drawn only while all of
 *              it is clear of the page (never half cut, never over the page); with no head row on the way out to a layout with no sidebar there is no travel at all.
 *   size       an icon keeps its own size all the way wherever the head row's line has room for that (five tabs at Standard); only a line too short for the tabs makes them smaller on the way.
 *              Where one of the toolbar's travelling pieces would pass under the line's end, the line stands a few px higher before it is made any shorter.
 *   clear way  an icon never crosses anything that is drawn. What ARRIVES on its way waits for it (ui/tabTravel.ts). The morph's own travelling pieces (the toolbar's buttons and field) cannot wait:
 *              the head row's line is lifted, or shortened as far as the icons keep their size, until no icon comes within the gap of one; where none of that clears them all there is NO travel, and
 *              the tabs leave and arrive with their chrome as they did before there was one. (ui/tabTravel.ts plays no travel either where the sidebar stands on both sides of the switch, or where
 *              the address field lives in the sidebar that comes: what stands or lands there fills the column from edge to edge.)
 *   apart      the icons keep their order in both layouts, so the nearest pair is always two neighbours. HEAD: the line in the head row is spaced so that neighbours are `TOUCH_GAP` apart; a row too
 *              short for that makes every icon `scale` smaller while it is on its way (never under `MIN_SCALE`). CORNER: the lag is the largest that keeps neighbours apart; none left: smaller icons.
 *   no twin    a tab with no place in sight on the other side (scrolled out, in a folded group, pinned) has no traveller: it leaves and arrives with its chrome, as before.
 *   turned     a morph turned round half way: every icon goes straight from where it is drawn to its place in the layout that is back.
 *
 * `clearance` measures the room between neighbours over the whole way; tests/tab-travel.test.ts pins it at 1, 5, 20 and 44 tabs, left and right. */
import type { Box, Direction } from './sidebarMorphPlan';

/** One tab's icon in both layouts (CSS px). `strip`: in the tab strip along the top; `list`: in its row of the sidebar. `gather`: the x of its middle in the head row's line (HEAD way);
 * `held`: where it is drawn now (a morph turned round). */
export interface TravelTab { id: string; strip: Box; list: Box; gather?: number; held?: Box }
export type Way = 'head' | 'corner';
export interface TravelPlan {
  direction: Direction;
  way: Way;
  /** LATE: the travellers are first drawn on the head row's line (the way out to a layout with no sidebar). */
  late: boolean;
  /** ms from the first frame to the landing: the morph's own length. */
  total: number;
  /** CORNER: the part of the time y waits behind x on the way from the strip to the list (0: the straight line). */
  lag: number;
  /** Every icon's size while it is on its way, as a part of its own (1 unless the room is too short). */
  scale: number;
  /** HEAD: px the head row's line stands above the strip's own icon line (0 unless one of the morph's travelling pieces passes right under the line: see `LIFTS`). */
  lift: number;
  /** The tabs in their order along the strip. */
  tabs: TravelTab[];
  /** The moments at which a drawn traveller comes within the gap of one of the morph's own travelling pieces (0 with nothing in the way, or when the line could be lifted or shortened clear of them;
   * more than 0: no line cleared them, and the plan carries no tabs). */
  fouls: number;
}
/** px kept between two travelling icons. */
export const TOUCH_GAP = 2;
/** The longest y waits behind x (CORNER). */
export const MAX_LAG = .42;
/** The smallest an icon is drawn on its way. */
export const MIN_SCALE = .5;
/** HEAD, as parts of the time. Strip -> list: the run along the strip is over at RUN; the drop takes DROP (it begins as the run ends: the icon is still in the strip's row then, and what lies under its way, the Favorites, can come in as
 * soon as the last icon is below it); the slide along the row takes SLIDE and ends BEFORE the landing, so an icon stands in its place when its title becomes readable. List -> strip: the slide out takes SLIDE_OUT, the rise RISE,
 * and the run along the strip the last RUN of the time. */
export const RUN = .28, DROP = [.22, .64] as const, SLIDE = [.52, .88] as const, SLIDE_OUT = .38, RISE = [.26, .68] as const;
/** LATE: the part of the time over which a traveller comes into sight, from just before its run along the strip begins (it stands in the strip's row by then, within a few px of the line). */
export const APPEAR = .08, APPEAR_FROM = 1 - RUN - .02;
/** The way out: from this part of the time on the travellers read where their slots in the strip are, every frame (the strip that comes is not at its final layout when the switch begins, and its
 * tabs glide to their places by their own motion until after it ends). Before `1 - RUN`: until then no icon's place depends on where its slot in the strip is. */
export const READ_AGAIN = 1 - RUN - .06;
/** The solver looks at this many moments of the way and asks for `SLACK` px more than the gap, so that between two of them the room is still the gap. */
const SAMPLES = 160, SLACK = 1.5;
/** The widest two neighbours are set apart in the head row's line (middle to middle). */
const GATHER_MAX = 40;
/** px the head row's line may be lifted, tried in this order, before it is shortened. */
export const LIFTS = [3, 6, 8] as const;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
/** Slow out of a place and slow into the other (cubic in-out); fast out and slow in (cubic out). */
export const ease = (t: number): number => { const v = clamp01(t); return v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
/** CORNER: how far x and y have come at `p` of the way from the strip (0) to the list (1). */
export function axes(p: number, lag: number): { x: number; y: number } { const span = 1 - lag; return { x: ease(p / span), y: ease((p - lag) / span) }; }
/** HEAD: how far each leg has come at `t` of the time: `run` 0 in the strip, 1 on the head row's line; `drop` 0 at the head row's height, 1 at the row's; `slide` 0 at the line's x, 1 at the icon's place in its row. */
export function legs(direction: Direction, t: number): { run: number; drop: number; slide: number } {
  if (direction === 'in') return { run: easeOut(t / RUN), drop: ease((t - DROP[0]) / (DROP[1] - DROP[0])), slide: ease((t - SLIDE[0]) / (SLIDE[1] - SLIDE[0])) };
  // The way back: slide out along the row, rise, run out along the strip, each slow into its end.
  return { slide: 1 - ease(t / SLIDE_OUT), drop: 1 - ease((t - RISE[0]) / (RISE[1] - RISE[0])), run: 1 - easeOut((t - (1 - RUN)) / RUN) };
}
const midX = (box: Box) => box.x + box.width / 2, midY = (box: Box) => box.y + box.height / 2;
/** The size on the way: its own at both ends, `scale` of it from a fifth of the time to four fifths. */
const sizeAt = (t: number, scale: number) => 1 - (1 - scale) * Math.min(1, clamp01(t) / .2, (1 - clamp01(t)) / .2);

/** An icon's box at `t` of the time (0 the first frame, 1 the landing). */
export function boxAt(plan: Pick<TravelPlan, 'direction' | 'way' | 'lag' | 'scale'> & { lift?: number; late?: boolean }, tab: TravelTab, t: number): Box {
  const time = clamp01(t), from = plan.direction === 'in' ? tab.strip : tab.list, to = plan.direction === 'in' ? tab.list : tab.strip;
  const k = ease(time), grow = sizeAt(time, plan.scale);
  if (tab.held) {
    // Turned round half way: straight from where it is drawn.
    const width = tab.held.width + (to.width - tab.held.width) * k, height = tab.held.height + (to.height - tab.held.height) * k;
    return { x: midX(tab.held) + (midX(to) - midX(tab.held)) * k - width / 2, y: midY(tab.held) + (midY(to) - midY(tab.held)) * k - height / 2, width, height };
  }
  const width = (from.width + (to.width - from.width) * k) * grow, height = (from.height + (to.height - from.height) * k) * grow;
  let cx: number, cy: number;
  if (plan.way === 'head' && tab.gather !== undefined) {
    const l = legs(plan.direction, time);
    cx = midX(tab.strip) + (tab.gather - midX(tab.strip)) * l.run + (midX(tab.list) - tab.gather) * l.slide;
    // (the line's lift is taken as the icon runs to it and given back as it drops)
    cy = midY(tab.strip) - (plan.lift ?? 0) * l.run * (1 - l.drop) + (midY(tab.list) - midY(tab.strip)) * l.drop;
  } else {
    const a = axes(plan.direction === 'in' ? time : 1 - time, plan.lag);
    cx = midX(tab.strip) + (midX(tab.list) - midX(tab.strip)) * a.x; cy = midY(tab.strip) + (midY(tab.list) - midY(tab.strip)) * a.y;
  }
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
/** The room between two boxes: how far apart they are (side to side, or corner to corner where they are apart both ways); negative when they overlap, by how much. */
export const roomBetween = (a: Box, b: Box): number => { const gx = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width), gy = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height); return gx > 0 && gy > 0 ? Math.hypot(gx, gy) : Math.max(gx, gy); };
/** The least room between two NEIGHBOURS over the whole way (the tabs keep their order in both layouts, so no other pair comes nearer). Infinity with fewer than two tabs. */
export function clearance(plan: Pick<TravelPlan, 'direction' | 'way' | 'lag' | 'scale'> & { lift?: number; late?: boolean }, tabs: TravelTab[]): number {
  let least = Infinity;
  for (let i = 1; i < tabs.length; i++) for (let s = 0; s <= SAMPLES; s++) { const room = roomBetween(boxAt(plan, tabs[i - 1], s / SAMPLES), boxAt(plan, tabs[i], s / SAMPLES)); if (room < least) least = room; }
  return least;
}

/** The plan for these tabs. `head`: the free room of the sidebar's head row for the icons' MIDDLES (x from, x to; null: none), and the side of the window the sidebar stands at (the line in the head row is
 * packed toward the window's edge). `column`: the sidebar's column stands through the whole switch or opens (false: it closes at once, the way out to a layout with no sidebar). `turned`: by tab id, where the icon
 * of a morph turned round half way is drawn now. `obstacles`: where the morph's own travelling pieces are drawn `ms` after its first frame (the toolbar's buttons and field on their way). */
export function planTabTravel(input: { tabs: TravelTab[]; direction: Direction; total: number; head?: { from: number; to: number } | null; side?: 1 | -1; column?: boolean; turned?: Map<string, Box> | null; obstacles?: ((ms: number) => Box[]) | null }): TravelPlan {
  // In their order along the strip (the list keeps the same order, top to bottom).
  const tabs = [...input.tabs].sort((a, b) => midX(a.strip) - midX(b.strip) || midY(a.list) - midY(b.list)).map(tab => ({ ...tab, gather: undefined as number | undefined, held: input.turned?.get(tab.id) }));
  const plan: TravelPlan = { direction: input.direction, way: 'corner', late: false, total: Math.max(1, input.total), lag: MAX_LAG, scale: 1, lift: 0, tabs, fouls: 0 };
  if (input.turned?.size) return plan;
  // What the rests themselves allow: two icons that stand nearer than the gap in a layout (a strip squeezed to its icons) are not asked to be further apart on the way.
  let rest = Infinity;
  for (let i = 1; i < tabs.length; i++) rest = Math.min(rest, roomBetween(tabs[i - 1].strip, tabs[i].strip), roomBetween(tabs[i - 1].list, tabs[i].list));
  const need = Math.min(TOUCH_GAP + SLACK, rest), smaller = () => { let low = MIN_SCALE, high = 1; plan.scale = low; if (clearance(plan, tabs) < need) return; for (let i = 0; i < 6; i++) { const mid = (low + high) / 2; plan.scale = mid; if (clearance(plan, tabs) >= need) low = mid; else high = mid; } plan.scale = low; };
  const side = input.side ?? 1, head = input.head ?? null;
  // The way out to a layout with no sidebar: only through the head row, late; with no head row, no travel.
  const closes = input.column === false && input.direction === 'out';
  if (closes && !(head && head.to - head.from >= 0)) { tabs.length = 0; return plan; }
  if (head && head.to - head.from >= 0 && (input.column !== false || closes)) {
    // HEAD: a line of places in the head row, in the strip's order, packed toward the window's edge the sidebar stands at (every icon then runs TOWARD the corner, and stands well inside the column
    // when it drops). A row too short even for icons at their smallest carries only as many tabs as fit, the ones nearest the sidebar: the others have no traveller.
    const all = [...tabs], widest = all.reduce((most, tab) => Math.max(most, tab.strip.width, tab.list.width), 0);
    // (`least`: the smallest the icons may be made on this line; it carries as many tabs as fit at that size)
    const line = (from: number, to: number, least = MIN_SCALE) => {
      const fits = Math.max(1, Math.floor((to - from) / (widest * least + need)) + 1), kept = all.length > fits ? (side === 1 ? all.slice(0, fits) : all.slice(all.length - fits)) : all;
      const step = kept.length > 1 ? Math.min(GATHER_MAX, (to - from) / (kept.length - 1)) : 0;
      kept.forEach((tab, i) => { tab.gather = side === 1 ? from + i * step : to - (kept.length - 1 - i) * step; });
      tabs.length = 0; tabs.push(...kept);
      plan.way = 'head'; plan.lag = 0; plan.late = closes; plan.scale = 1;
      if (kept.length > 1 && (step < widest + need || clearance(plan, tabs) < need)) smaller();
    };
    line(head.from, head.to);
    // The toolbar's own pieces travel through the same corner (the morph's plan says where each of them is at every moment). The line is lifted, then shortened from its end nearest the page, 6 px at a
    // time, until no traveller comes within the gap of one. A shorter line carries FEWER tabs at the size the room itself gave them (the ones nearest the page have no traveller then), never smaller
    // icons: an icon is not made smaller to let a button by. Where nothing clears them all there is no travel.
    if (input.obstacles) {
      // (The pieces' places are asked of the morph once, at the moments looked at: working them out is the dear part.)
      const pieces = new Map<number, Box[]>(), known = (ms: number) => { let boxes = pieces.get(ms); if (!boxes) { boxes = input.obstacles!(ms); pieces.set(ms, boxes); } return boxes; };
      const at = (cut: number, least = MIN_SCALE) => (side === 1 ? line(head.from, head.to - cut, least) : line(head.from + cut, head.to, least));
      // First the whole line a little higher (the icons keep their size and their spacing; a button that rises into the row passes under them), as high as the strip's own icons leave room above;
      // only then a shorter line.
      const room = Math.max(0, Math.min(...all.map(tab => tab.strip.y)) - 2);
      const whole = { scale: plan.scale };   // the size the room itself gives these tabs
      let best = { cut: 0, lift: 0, fouls: fouls(plan, known) };
      for (const lift of LIFTS) { if (best.fouls <= 0 || lift > room) break; plan.lift = lift; at(0); const count = fouls(plan, known); if (count < best.fouls) best = { cut: 0, lift, fouls: count }; }
      plan.lift = best.lift;
      for (let cut = 6; best.fouls > 0 && cut <= head.to - head.from; cut += 6) { at(cut, whole.scale); if (plan.scale < whole.scale - .02) continue; const count = fouls(plan, known); if (count < best.fouls) best = { cut, lift: best.lift, fouls: count }; }
      if (best.cut) at(best.cut, whole.scale); else at(0);
      plan.fouls = best.fouls;
      if (best.fouls > 0) tabs.length = 0;
    }
    return plan;
  }
  if (tabs.length < 2) return plan;
  if (clearance(plan, tabs) >= need) return plan;
  plan.lag = 0;
  if (clearance(plan, tabs) >= need) {
    // The largest lag that keeps them apart (the room shrinks as the lag grows: the icons bunch at the corner).
    let low = 0, high = MAX_LAG;
    for (let i = 0; i < 7; i++) { const mid = (low + high) / 2; plan.lag = mid; if (clearance(plan, tabs) >= need) low = mid; else high = mid; }
    plan.lag = low; return plan;
  }
  // Even the straight line brings neighbours together: every icon is smaller on its way.
  smaller();
  return plan;
}

/** How much of a traveller is drawn at `t` of the time, before the page is asked: all of it, except LATE, where it comes into sight over `APPEAR` as its run along the strip begins. */
export const shownAt = (plan: Pick<TravelPlan, 'late'>, t: number): number => (plan.late ? ease((clamp01(t) - APPEAR_FROM) / APPEAR) : 1);
/** The moments (of those the plan looks at, every fourth one) at which a drawn traveller comes within the gap of one of the morph's own travelling pieces. */
export function fouls(plan: TravelPlan, obstacles: (ms: number) => Box[]): number {
  let count = 0;
  for (let s = 0; s <= SAMPLES; s += 4) {
    const t = s / SAMPLES; if (shownAt(plan, t) <= 0) continue;
    const others = obstacles(plan.total * t); if (!others.length) continue;
    if (plan.tabs.some(tab => { const box = boxAt(plan, tab, t); return others.some(other => roomBetween(box, other) < TOUCH_GAP); })) count++;
  }
  return count;
}
/** An icon's box `ms` after the morph's first frame. */
export const travelBox = (plan: TravelPlan, tab: TravelTab, ms: number): Box => boxAt(plan, tab, ms / plan.total);

/** Every traveller's box at every moment the plan looks at (one row per moment): worked out once and shared by every place that asks when it is clear. */
export function sweep(plan: TravelPlan): Box[][] { const out: Box[][] = []; for (let s = 0; s <= SAMPLES; s++) out.push(plan.tabs.map(tab => boxAt(plan, tab, s / SAMPLES))); return out; }
/** The last moment (ms) at which any travelling icon lies over `rect`; 0 when none ever does. What arrives there (a row's title, a favorite's tile, a strip tab's title) comes in after it. */
export function clearAfter(plan: TravelPlan, rect: Box, swept: Box[][] = sweep(plan)): number {
  let last = 0;
  // (LATE: a traveller that is not drawn yet is in nobody's way)
  for (let s = 0; s < swept.length; s++) if (shownAt(plan, s / (swept.length - 1)) > 0 && swept[s].some(box => roomBetween(box, rect) < 0)) last = plan.total * Math.min(swept.length - 1, s + 1) / (swept.length - 1);
  return last;
}
/** How much of what arrives at a place is shown at `ms`: nothing until the place is clear (`clearAt`), then in over `over` ms (less where the landing comes sooner), there by the landing at the latest:
 * what clears only in the last `LAST_MS` comes in over them. */
export const LAST_MS = 50;
export function arrivalAt(plan: TravelPlan, clearAt: number, ms: number, over = 110): number {
  const start = Math.min(clearAt, plan.total - Math.min(LAST_MS, plan.total * .25)), span = Math.max(1, Math.min(over, plan.total - start));
  return ease((ms - start) / span);
}

/** px from its slot at which an icon counts as standing in it (half the gap between a tab's icon and its title). */
export const LANDED_PX = 4;
/** ms after its last frame for which the layout morph stays up (sidebarMorph.ts takes it down at total + 34): what could only begin to arrive when an icon stood still is whole when the morph goes. */
export const TAIL_MS = 30;
/** The way out: does a traveller drawn at `now` still have to pass over `place` on its way to its `slot` in the strip? Not once it stands in its slot (within LANDED_PX). Until then: while the stretch
 * between where it is drawn and its slot (2 px beyond both ends) comes within `pad` px of the place. With the pad a tab's own title, which begins a few px beside its icon's slot, waits for its own
 * icon to stand there, from whichever side it comes; the title of a tab on its way waits for the icon to have passed. */
export function stillToPass(now: Box, slot: Box, place: { left: number; top: number; right: number; bottom: number }, pad = 0): boolean {
  if (Math.abs(now.x - slot.x) < LANDED_PX && Math.abs(now.y - slot.y) < LANDED_PX) return false;
  const from = Math.min(now.x, slot.x) - 2, to = Math.max(now.x + now.width, slot.x + slot.width) + 2, top = Math.min(now.y, slot.y), bottom = Math.max(now.y + now.height, slot.y + slot.height);
  return from < place.right + pad && to > place.left - pad && top < place.bottom && bottom > place.top;
}
/** The way out: where a traveller is drawn `ms` after the first frame or, while it is not drawn yet (LATE, before its run), where it will FIRST be drawn: on the head row's line. What arrives in the
 * strip asks about this box. (Asked about where the plan has the undrawn icon, still in the list's column, a button of the strip that stands between the column and the line was let in at once and
 * the icons ran over it: real takes of 20 Nov with the sidebar on the right, +355 ms.) */
export const drawnOrFirst = (plan: TravelPlan, tab: TravelTab, ms: number): Box => travelBox(plan, tab, plan.late ? Math.max(ms, plan.total * (1 - RUN)) : ms);
/** The way out: how much of what arrives in the strip is shown at `ms`, when no icon had to pass over it any more from `clearedAt` on (null: one still has to): nothing before, then in over `over`
 * ms, or over what is left until TAIL_MS after the landing where that is sooner. Nothing is brought in under an icon to be there by the landing: a title whose own icon comes over it (the sidebar on
 * the right) begins when the icon stands, and is whole when the morph goes. */
export function cameAt(plan: Pick<TravelPlan, 'total'>, clearedAt: number | null, ms: number, over = 90): number {
  if (clearedAt === null) return 0;
  return ease((ms - clearedAt) / Math.max(1, Math.min(over, plan.total + TAIL_MS - clearedAt)));
}

/** The part of a box the page does not cover, as a CSS clip-path in the box's own coordinates (`none`: all of it; null: none of it, the box is wholly under the page). The page is a rectangle whose
 * top and one side edge face the chrome (the sidebar's side: `side` 1 on the left, -1 on the right); its rounded corner is not followed (an icon is as small as the corner).
 * `unit`: the box's own px per drawn px, for an element drawn scaled (a clip is written in the element's own coordinates). */
export function cutUnderPage(box: Box, page: { left: number; top: number; right: number; bottom: number }, side: 1 | -1, unit = 1): string | null {
  const above = Math.min(box.height, Math.max(0, page.top - box.y));                                                           // rows of the box above the page's top edge
  const beside = side === 1 ? Math.min(box.width, Math.max(0, page.left - box.x)) : Math.min(box.width, Math.max(0, box.x + box.width - page.right));   // columns of it beside the page, in the sidebar's column
  const outside = box.x + box.width <= page.left || box.x >= page.right || box.y + box.height <= page.top || box.y >= page.bottom;
  if (outside || above >= box.height || beside >= box.width) return 'none';
  if (above <= 0 && beside <= 0) return null;
  const w = box.width, h = box.height, r = (v: number) => Math.round(v * unit * 100) / 100;
  // An L: the whole width above the page's top edge, and the columns beside the page all the way down.
  return side === 1
    ? `polygon(0px 0px, ${r(w)}px 0px, ${r(w)}px ${r(above)}px, ${r(beside)}px ${r(above)}px, ${r(beside)}px ${r(h)}px, 0px ${r(h)}px)`
    : `polygon(0px 0px, ${r(w)}px 0px, ${r(w)}px ${r(h)}px, ${r(w - beside)}px ${r(h)}px, ${r(w - beside)}px ${r(above)}px, 0px ${r(above)}px)`;
}
