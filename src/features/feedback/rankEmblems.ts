/** Beta 14/E5 (rank emblems, proposal): the drawings of the rank emblems, as plain data. No DOM, no colour: the colour is the rank's ring colour (OPEN, set in one place) and every stroke is a
 * centre-line on one 48 grid, round caps and joins, `pathLength=1`, so a single dash recipe draws any of them (the line-draw of the icon family: ui/lineIconPlay.ts in the icons branch).
 * The line weight is NOT scaled with the size: the emblem's own stroke stays near 1.4 CSS px at every size (the website's hero line), so the grid is only a coordinate system.
 *
 * Three directions are drawn, each a way for four ranks to read as a progression without numbers or medals:
 *   mark   The Acira symbol itself, drawn as its own outline. Every rank shows the whole mark; what a rank earns is light. Early Member: the mark in a quiet neutral line. Contributor: one bracket lit in the
 *          rank's colour. Trusted: both. Insider: the body of the mark tinted. Founding: the gap in the middle lit too, and the biggest aura.
 *   etched The same mark with a finish instead of a tint: from Insider the bodies are engraved with fine parallel hairlines, finer for Founding, which also has light lying across the engraving.
 *   ring   The profile ring as an object, with no logo in it: a line, a line and the start of an inner one, two lines, two lines and a bead of light on the outer one.
 * Early Member is apart (the brief): in `mark` and `etched` it is the mark in neutral ink with no colour, no light and no aura; in `ring` a small neutral ring.
 *
 * Every direction returns the same shape: `strokes` (drawn in order, the line-draw), `bodies` (soft flat tints that come in after the line), `lights` (small lit points), and `aura` (the soft
 * light around the emblem: one colour and a near-white core, painted with radial gradients that fall to nothing, never a rainbow). */
import {MARK_LOWER, MARK_UPPER} from './rankEmblemMark';

export type EmblemDirection = 'hybrid' | 'mark' | 'etched' | 'ring';
export type EmblemRank = 'earlyMember' | 'contributor' | 'trusted' | 'insider' | 'founding';
export const EMBLEM_DIRECTIONS: readonly EmblemDirection[] = ['hybrid', 'mark', 'etched', 'ring'];
/** The default drawing while the team is away (13 Nov): the Mark ladder, with the Etched finish only on Founding Contributor. The others stay selectable for the review. */
export const DEFAULT_EMBLEM: EmblemDirection = 'hybrid';
export const EMBLEM_RANKS: readonly EmblemRank[] = ['earlyMember', 'contributor', 'trusted', 'insider', 'founding'];
export const EMBLEM_GRID = 48;

export interface EmblemStroke {
  d: string;
  /** Multiplier of the emblem's line (1 = the line, .6 = a hairline). */
  weight?: number;
  /** 0..1, the ink's strength (the rank colour at this alpha). */
  opacity?: number;
  /** The part of the mark that is not lit (yet): drawn in the quiet neutral ink, not in the rank's colour. */
  ghost?: boolean;
}
export interface EmblemBody { d: string; opacity: number; /** 0 = fill the closed path; otherwise the width of a thick round-capped stroke along it. */ width?: number }
export interface EmblemLight { x: number; y: number; r: number; /** The core's strength, 0..1 (a near-white point inside the colour). */ core: number; /** A filled bead (r in grid units), not only a glow. */ bead?: boolean }
export interface EmblemAura { /** Peak strength of the colour at the centre, 0..1. */ peak: number; /** The core's strength: a near-white point inside the colour. */ core: number; /** 1 = the emblem's own size doubled; the glow falls to nothing at this radius. */ spread: number }
/** A fine engraving inside the bodies: parallel hairlines at the angle of the mark's slanted bands, clipped to the bodies, and a band of light lying across them (`sheen`). */
export interface EmblemEtching { clip: readonly string[]; spacing: number; opacity: number; sheen: number }
export interface Emblem { strokes: readonly EmblemStroke[]; bodies: readonly EmblemBody[]; lights: readonly EmblemLight[]; aura: EmblemAura | null; etching?: EmblemEtching }

const round = (n: number): number => Math.round(n * 100) / 100;
const rad = (deg: number): number => deg * Math.PI / 180;
const at = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
const pt = (x: number, y: number): string => `${round(x)} ${round(y)}`;

/** A circular arc as cubic Beziers of at most 90 degrees (angles in degrees, 0 at the right, y down, a positive sweep clockwise on the screen), like the icon set's arcPath. */
export function arcPath(cx: number, cy: number, r: number, from: number, sweep: number): string {
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / 90)), step = sweep / segments, k = 4 / 3 * Math.tan(rad(step) / 4);
  const tangent = (a: number): [number, number] => [-Math.sin(rad(a)), Math.cos(rad(a))];
  let d = `M${pt(...at(cx, cy, r, from))}`;
  for (let i = 0; i < segments; i++) {
    const a0 = from + step * i, a1 = a0 + step, p0 = at(cx, cy, r, a0), p1 = at(cx, cy, r, a1), t0 = tangent(a0), t1 = tangent(a1);
    d += `C${pt(p0[0] + k * r * t0[0], p0[1] + k * r * t0[1])} ${pt(p1[0] - k * r * t1[0], p1[1] - k * r * t1[1])} ${pt(p1[0], p1[1])}`;
  }
  return d;
}

const C = 24;
// ---- The mark: the two outlines of the true symbol (rankEmblemMark.ts). ------------------------------------------------------------------------------------------------------------------------------
/** The gap in the middle of the symbol: where the light goes (Founding). */
const GAP_LIGHT: EmblemLight = {x: C, y: C, r: 7.5, core: 0.62};
const ghost = (d: string): EmblemStroke => ({d, ghost: true, opacity: 0.55, weight: 0.85});

/** The progression of the mark, shared by `mark` and `etched` (they differ only in the finish): the whole mark is always there; each rank lights more of it. */
function markLadder(rank: EmblemRank, finish: 'tint' | 'etch'): Emblem {
  const upper: EmblemStroke = {d: MARK_UPPER}, lower: EmblemStroke = {d: MARK_LOWER};
  const both = [MARK_UPPER, MARK_LOWER];
  switch (rank) {
    case 'earlyMember': return {strokes: [ghost(MARK_UPPER), ghost(MARK_LOWER)], bodies: [], lights: [], aura: null};
    case 'contributor': return {strokes: [ghost(MARK_LOWER), upper], bodies: [], lights: [], aura: {peak: 0.17, core: 0.1, spread: 1.3}};
    case 'trusted': return {strokes: [upper, lower], bodies: [], lights: [], aura: {peak: 0.21, core: 0.14, spread: 1.45}};
    case 'insider': return finish === 'tint'
      ? {strokes: [upper, lower], bodies: both.map(d => ({d, opacity: 0.17})), lights: [], aura: {peak: 0.25, core: 0.18, spread: 1.6}}
      : {strokes: [upper, lower], bodies: both.map(d => ({d, opacity: 0.07})), lights: [], aura: {peak: 0.25, core: 0.18, spread: 1.6}, etching: {clip: both, spacing: 2.3, opacity: 0.55, sheen: 0}};
    case 'founding': return finish === 'tint'
      ? {strokes: [upper, lower], bodies: both.map(d => ({d, opacity: 0.26})), lights: [GAP_LIGHT], aura: {peak: 0.3, core: 0.28, spread: 1.85}}
      : {strokes: [upper, lower], bodies: both.map(d => ({d, opacity: 0.1})), lights: [GAP_LIGHT], aura: {peak: 0.3, core: 0.28, spread: 1.85}, etching: {clip: both, spacing: 1.45, opacity: 0.6, sheen: 0.5}};
  }
}
const mark = (rank: EmblemRank): Emblem => markLadder(rank, 'tint');
const etched = (rank: EmblemRank): Emblem => markLadder(rank, 'etch');

// ---- The ring: two concentric lines, no logo. The same ladder as the mark: the whole object is always there, each rank lights more of it. --------------------------------------------------------
const R_OUTER = 16, R_INNER = round(R_OUTER / 1.618), R_MID = round((R_OUTER + R_INNER) / 2);
function ring(rank: EmblemRank): Emblem {
  const circle = (r: number, extra: Partial<EmblemStroke> = {}): EmblemStroke => ({d: arcPath(C, C, r, -90, 360), ...extra});
  const outer = circle(R_OUTER), inner = circle(R_INNER, {weight: 0.85}), ghostInner = circle(R_INNER, {ghost: true, opacity: 0.55, weight: 0.85}), ghostOuter = circle(R_OUTER, {ghost: true, opacity: 0.55, weight: 0.85});
  const annulus: EmblemBody = {d: arcPath(C, C, R_MID, -90, 360), opacity: 0.17, width: R_OUTER - R_INNER};
  switch (rank) {
    case 'earlyMember': return {strokes: [ghostOuter, ghostInner], bodies: [], lights: [], aura: null};
    case 'contributor': return {strokes: [ghostInner, outer], bodies: [], lights: [], aura: {peak: 0.17, core: 0.1, spread: 1.3}};
    case 'trusted': return {strokes: [outer, inner], bodies: [], lights: [], aura: {peak: 0.21, core: 0.14, spread: 1.45}};
    case 'insider': return {strokes: [outer, inner], bodies: [annulus], lights: [], aura: {peak: 0.25, core: 0.18, spread: 1.6}};
    case 'founding': return {strokes: [outer, inner], bodies: [{...annulus, opacity: 0.26}], lights: [{x: C, y: C, r: 6.5, core: 0.55}, {x: C, y: C - R_OUTER, r: 2.6, core: 1, bead: true}], aura: {peak: 0.3, core: 0.28, spread: 1.85}};
  }
}

const hybrid = (rank: EmblemRank): Emblem => (rank === 'founding' ? etched(rank) : mark(rank));
const BUILDERS: Record<EmblemDirection, (rank: EmblemRank) => Emblem> = {hybrid, mark, etched, ring};
export function emblemFor(direction: EmblemDirection, rank: EmblemRank): Emblem { return BUILDERS[direction](rank); }
