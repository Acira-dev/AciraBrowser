/* The favorites' glide in a Full <-> Mini switch, as rules of the grid (the team, 19 Nov: "wide and narrow: approach them the same way you approached the standard... how you did these flying icons"). Nothing here
 * knows a width: the same rules run at two columns (Narrow 168), three (Standard 240) and four (Wide 312), and at any dragged width.
 *
 * What the glide is made of, per favorite (miniRail.ts `glideFavorites` runs it; this file holds its arithmetic so it can be tested without a window):
 *   start      its own cell in the grid, wherever the layout has put it (read from the screen)
 *   end        its twin's slot in the rail's column: the favorites keep their reading order, so the k-th favorite goes to the k-th slot
 *   path       straight, from the icon's centre in its cell to the centre of its slot; its size goes from the grid's to the rail's along the same curve
 *   delay      none: every icon leaves in the first frame of the switch and arrives in its last (one clock, the page's)
 *   duration   the switch's own, 480 ms x the motion pace
 *   curve      the page's spring (SPRING_STOPS)
 *   its tile's background (fill, rim, shadow)   leaves over the first PLATE_PART of the time on a collapse and arrives over the last PLATE_PART on an expand: never stronger than the part of the way its icon still has to go (`plateStrength`)
 *   a favorite the rail has no room for        stays in its cell and fades: gone by `stayFadeEnd` on a collapse, back WITH the move on an expand (`stayRise`, D172)
 *
 * Why the formation never needs reordering (the team's "if at four columns two paths must cross, order them by column"): every icon runs the same curve at the same moment, so the vector between two icons is a straight line from
 * their offset in the grid to their offset in the rail. Two neighbours in a row start a column apart side by side and end a slot apart one above the other: the line between those two offsets passes the origin at
 * column x slot / hypot(column, slot), about 28 pt for the grid's 73 to 82 pt columns and the rail's 30.5 pt slots, which is more than an icon (16 to 20 pt). An icon from the row below starts further away and ends a slot away: never nearer
 * than the slot. So no two gliding icons touch at 2, 3 or 4 columns (tests/mini-collapse-one-surface.test.ts runs all pairs). The only things a path can cross are the cells of favorites that do not travel: those are gone first (stayFadeEnd). */
import { bleedFade, fallOff } from './ambientColours';

/* ----- Two see-through pictures of ONE light that must add up to it (the head row of a dock switch, 19 Nov). The head's light and the bar's light meet at the sidebar's travelling edge, and the two states' bar lights change into
 * one another in time. Laid over one another at part strength, two see-through pictures of the same light let more of the frame through than one at full: strengths m and n of a light whose share of the frame is `a` give
 * a * (m + n - a * m * n), which is the light itself only when one of the two is bent: n = b / (1 - a * (1 - b)) against m = 1 - b (ambientColours `bleedFade`, the base's own rule for its floating sidebar; whichever of the two is on
 * top). The share is read from the bar's light as it stands when the switch begins. */
/** The alphas of a light layer's colour stops as its gradient is written (`rgb(r g b / a)` or `rgba(r, g, b, a)`; a stop with no alpha is 1), in their order along the bar. */
export function stopAlphas(image: string): number[] {
  const out: number[] = [];
  for (const found of String(image || '').matchAll(/rgba?\(([^()]*)\)/gi)) {
    const parts = found[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const raw = parts[3], alpha = raw === undefined ? 1 : raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    if (Number.isFinite(alpha)) out.push(Math.max(0, Math.min(1, alpha)));
  }
  return out;
}
/** The bar light's share of the frame beside the sidebar, at the band's mean strength (the light falls off upward from the page: 1 at the band's foot, `fallOff(foot)` at the window's top row). `shown` is how much of the layer
 * shows (its opacity). 0 when the gradient cannot be read: the ramps are straight then. */
export function lightShare(image: string, shown: number, foot: number, right: boolean): number {
  const alphas = stopAlphas(image);
  if (!alphas.length || !Number.isFinite(shown) || !Number.isFinite(foot)) return 0;
  const end = right ? alphas[alphas.length - 1] : alphas[0];
  return Math.max(0, Math.min(.95, end * Math.max(0, Math.min(1, shown)) * (1 + fallOff(Math.max(0, foot))) / 2));
}
/** The bent picture's strength at a quarter, a half and three quarters of the way (its partner is at three quarters, a half and a quarter): `--mini-e1..3` (miniRail.css). */
export const bentRamp = (share: number): [number, number, number] => [bleedFade(share, .25), bleedFade(share, .5), bleedFade(share, .75)];
/** What two such pictures add up to, as a part of the light at full (1 = exact): the bent one at `bleedFade(bend, b)`, the straight one at 1 - b, for a light whose true share on this row is `share`. */
export const pairSum = (share: number, bend: number, b: number): number => { const n = bleedFade(bend, b), m = 1 - b; return m + n - share * m * n; };

/** The page's spring as 33 stops, 15 ms apart at the full pace (the same list as the `linear()` easing the switch's pictures use). */
export const SPRING_STOPS = [0, .03361, .112, .21091, .31536, .41656, .50969, .59255, .66451, .72589, .77752, .82045, .85584, .88478, .9083, .9273, .94258, .95483, .9646, .97237, .97853, .9834, .98725, .99027, .99265, .99452, .99598, .99712, .99801, .99871, .99925, .99967, 1];
/** The part of the travel the spring has covered at `time` (a part of the switch's time, 0 to 1). */
export function springAt(time: number): number {
  const x = Math.max(0, Math.min(1, time)) * (SPRING_STOPS.length - 1), i = Math.min(SPRING_STOPS.length - 2, Math.floor(x));
  return SPRING_STOPS[i] + (SPRING_STOPS[i + 1] - SPRING_STOPS[i]) * (x - i);
}
/** The part of a switch's TIME at which its spring has covered `part` of the travel (the inverse of `springAt`). */
export function springTime(part: number): number {
  if (part <= 0) return 0;
  for (let i = 1; i < SPRING_STOPS.length; i++) if (part <= SPRING_STOPS[i]) return (i - 1 + (part - SPRING_STOPS[i - 1]) / (SPRING_STOPS[i] - SPRING_STOPS[i - 1])) / (SPRING_STOPS.length - 1);
  return 1;
}
/** D162 (reported 23 Nov, on the D152 picture, Standard, light: "you see how it'll glitch the selected one, the highlighted ... it shouldn't show when transforming"): the open Favorite's highlight is not seen while the sidebar
 * transforms. Its plate travelled at the cell's whole size under the next icons, and the tile's ring stayed at the cell. Now the plate (and the tile's ring with it) fades out over SELECTED_OUT_MS as its icon leaves, and the highlight
 * comes back over SELECTED_IN_MS ending where the icon has landed (the spring at 99 % of the travel), at its place: the rail's tile on a collapse, the cell on an expand. The same in both directions, in the switch's TIME (linear),
 * so an expand is not the collapse run backwards (that would show the plate crossing the grid at its full size). */
export const SELECTED_OUT_MS = 64;
export const SELECTED_IN_MS = 96;
export const SELECTED_LAND = .99;
export function selectedFade(duration: number): Keyframe[] {
  const d = Math.max(1, duration), land = springTime(SELECTED_LAND), out = Math.min(.3, SELECTED_OUT_MS / d), back = Math.max(out, land - SELECTED_IN_MS / d);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return [{ opacity: 1, offset: 0 }, { opacity: 0, offset: r(out) }, { opacity: 0, offset: r(back) }, { opacity: 1, offset: r(land) }, { opacity: 1, offset: 1 }];
}
/** A tile's background is there for this part of the time at the start of a collapse (the end of an expand). */
export const PLATE_PART = .3;
/** A favorite with no slot in the rail is gone by this part of the time at the latest (and is back over the last such part of an expand). */
export const STAY_PART = .2;
/** D152 (Narrow, 8 Favorites, real frames 23 Nov): the travelling edge reaches the second column's tiles at once, so a fade that had to end before it did was one frame (14 ms): the tiles vanished. When the edge is what ends a
 * fade it lasts the whole STAY_PART (96 ms at Premium, six frames: no frame takes more than a sixth of it away; the moving edge sweeps over the tile while it fades); a gliding icon that would reach it sooner still ends it sooner. */
export const STAY_EDGE_MIN = STAY_PART;
/** D152 (Fast): the fade of a favorite with no rail place lasts this long at least, at any speed (at Fast the 20 % of a 240 ms switch was three frames: a blink). As a part of the switch's time: `stayFloor(duration)`. */
export const STAY_MIN_MS = 96;
export const stayFloor = (duration: number): number => Math.min(.5, Math.max(STAY_PART, STAY_MIN_MS / Math.max(1, duration)));
/** How strong a travelling favorite's background is at `time` of a collapse (an expand is the same run backwards): a straight fade over PLATE_PART. It is never stronger than the part of the way its icon still has to go
 * (1 - springAt(time)): a background does not stand at strength with its icon gone. */
export const plateStrength = (time: number): number => Math.max(0, 1 - Math.max(0, time) / PLATE_PART);

/** An icon as a disc: its centre and half its width, in px on screen. */
export type Disc = { x: number; y: number; r: number };
export type Glider = { from: Disc; to: Disc };
/** Where a gliding icon is when the spring has covered `part` of the travel. */
export const gliderAt = (glider: Glider, part: number): Disc => ({ x: glider.from.x + (glider.to.x - glider.from.x) * part, y: glider.from.y + (glider.to.y - glider.from.y) * part, r: glider.from.r + (glider.to.r - glider.from.r) * part });
/** When a favorite that stays in its cell is gone on a collapse, as a part of the switch's time: the earliest of STAY_PART, the moment a gliding icon first touches its icon (2 px of air), the moment the travelling edge reaches its
 * tile (`edge`: the part of the travel after which the edge is at the tile's outer side, but never under STAY_EDGE_MIN), each less a 2 % margin, and never under 3 %. `icon` is null for a tile with no icon (the add tile). */
export function stayFadeEnd(icon: Disc | null, gliders: Glider[], edge: number, floor = STAY_EDGE_MIN): number {
  let reach = 1;
  if (icon) for (const glider of gliders) for (let part = 0; part <= 1; part += .02) {
    const at = gliderAt(glider, part);
    if (Math.abs(at.x - icon.x) < at.r + icon.r + 2 && Math.abs(at.y - icon.y) < at.r + icon.r + 2) { reach = Math.min(reach, part); break; }
  }
  return Math.max(.03, Math.min(Math.max(STAY_PART, floor), springTime(reach) - .02, Math.max(floor, springTime(Math.max(0, Math.min(1, edge))) - .02)));
}
/** D172 (reported 24 Nov: the Favorites the rail does not keep came back only at the END of an open, "they should come in with the move"; they rose over the last STAY_PART of the TIME, when the spring had covered 99.7 % of
 * the travel): on an expand a favorite that stays in its cell rises WITH the move. Its opacity follows the travel (the animation runs on the switch's spring, so the two numbers returned are parts of the TRAVEL, its keyframe
 * offsets) from the part at which ALL of these hold, up to STAY_LAND, where the move has landed (never over less than `floor` of the TIME: no blink at Fast):
 *   the opening edge has begun to uncover its tile (`inner`: the part of the travel at which the edge is at the tile's inner side);
 *   every gliding icon has passed its icon for good (a glider leaves it where a collapse's glider would first touch it, 2 px of air, 2 % later);
 *   every travelling plate (another favorite's tile background on its way, `plates`) has left its tile's box for good (the same rule, more than 1 px on both axes): the first build let a plate pass over a tile already
 *   at 0.6 to 0.8 (probe, his set-up, 10 to 18 frames an open), which a collapse never shows (its tiles are gone before anything reaches them).
 * The collapse's rule (stayFadeEnd) mirrored, on the move's own curve. */
export const STAY_LAND = .99;
/** A box on screen, px (a tile's, or a travelling plate's at one end of its way). */
export type Box = { x: number; y: number; w: number; h: number };
/** A travelling plate: its box in the grid (`from`) and at the rail (`to`); it scales from its top left corner (miniRail.css), so its box at a part of the way is the straight mix of the two. */
export type PlatePath = { from: Box; to: Box };
export const plateAt = (plate: PlatePath, part: number): Box => ({ x: plate.from.x + (plate.to.x - plate.from.x) * part, y: plate.from.y + (plate.to.y - plate.from.y) * part, w: plate.from.w + (plate.to.w - plate.from.w) * part, h: plate.from.h + (plate.to.h - plate.from.h) * part });
export const boxesMeet = (a: Box, b: Box): boolean => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
export function stayRise(icon: Disc | null, gliders: Glider[], inner: number, floor = STAY_EDGE_MIN, tile: Box | null = null, plates: PlatePath[] = []): [number, number] {
  let reach = 1;
  if (icon) for (const glider of gliders) for (let part = 0; part <= 1; part += .02) {
    const at = gliderAt(glider, part);
    if (Math.abs(at.x - icon.x) < at.r + icon.r + 2 && Math.abs(at.y - icon.y) < at.r + icon.r + 2) { reach = Math.min(reach, part); break; }
  }
  if (tile) for (const plate of plates) for (let part = 0; part <= 1; part += .02) if (boxesMeet(plateAt(plate, part), tile)) { reach = Math.min(reach, part); break; }
  const clear = reach < 1 ? Math.min(1, 1 - reach + .02) : 0;
  const start = Math.min(springTime(Math.max(clear, Math.max(0, Math.min(1, inner)))), 1 - floor);
  const end = Math.min(1, Math.max(springTime(STAY_LAND), start + floor));
  return [springAt(start), springAt(end)];
}
/** The nearest two gliding icons' centres come to one another over the whole travel (they all share one clock, so the vector between two of them is a straight line from their offset in the grid to their offset in the rail). */
export function nearestApproach(a: Glider, b: Glider): number {
  const sx = b.from.x - a.from.x, sy = b.from.y - a.from.y, ex = b.to.x - a.to.x, ey = b.to.y - a.to.y, dx = ex - sx, dy = ey - sy, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(sx * dx + sy * dy) / len)) : 0;
  return Math.hypot(sx + dx * t, sy + dy * t);
}
