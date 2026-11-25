/**
 * Ambient mode's colours (Beta 14, F6): what the page's own edge colours become as light on the frame. Pure, so a test can hold every rule.
 *
 * A sample is two short rows of [r, g, b]: down the edge beside the sidebar (`l`) and along the top (`t`), read by main (desktop/ambient-edge.cjs). Each becomes a row of stops, a colour and
 * how much of it to show:
 *   - WHITE OR FLAT PAGES ADD NOTHING. The share of a colour is its colourfulness (nothing below a chroma of 22, all of it from 92) times its brightness (nothing below a luma of 56, all of it
 *     from 146). White, grey, black and dark colours therefore add no haze: a white page edge never greys a dark sidebar or lowers its text contrast, and the site-colour edge light (F5) stands alone.
 *   - TONE. On a dark frame the colour is held between 110 and 165 (it reads as light, never as paint); on a light frame it is mixed 42% toward white (a stronger colour would be paint).
 *   - STRENGTH follows Site colour: Soft .56, Rich .82, at the colour's own share; Off takes Soft (the person turned Ambient mode on).
 *   - READABILITY. Every stop is gated like the site glow's: the stop at its strongest, over the frame, must keep the ink and the muted ink readable (4.5:1) and the finish's marks at 3:1;
 *     the share is lowered until it does. A muted label beside the page edge in Rich stays readable.
 */
import { compositeColor } from './colorMath';
import { frameReadability, type SiteTintBase } from './siteTint';

export type Rgb = readonly [number, number, number];
export interface AmbientSample { id?: string; side: 'left' | 'right'; /** read from the whole page, reduced (white, grey or black edges): its own, lower floors */ wide?: boolean; l: Rgb[]; t: Rgb[]; /** The page's far side (the edge the sidebar is NOT on) and its bottom: the colours of the thin strips round the page card (frame, one surface). Absent in a read that could not take them. */ r?: Rgb[]; b?: Rgb[]; /** ms: main's push of a tab's last read on a switch asks for a quick fade (F1), instead of the 300 ms of a new one */ fade?: number }
export interface AmbientStop { rgb: Rgb; alpha: number }
export interface AmbientStops { l: AmbientStop[]; t: AmbientStop[]; /** the far side's strip and the bottom strip (empty while a read has none) */ r: AmbientStop[]; b: AmbientStop[] }

export const AMBIENT_STRENGTH = { soft: .56, rich: .82 } as const;
export const CHROMA_FROM = 22, CHROMA_FULL = 92, LUMA_FROM = 56, LUMA_FULL = 146;
/** A whole-page read (F1 (3)): a page average is duller than an edge, so its floors are lower (and main already gave a small colourful part of a segment only its plain mean). */
export const WIDE_CHROMA_FROM = 12, WIDE_CHROMA_FULL = 60, WIDE_LUMA_FROM = 34, WIDE_LUMA_FULL = 110;
export const DARK_BAND = [110, 165] as const, LIGHT_WHITE_MIX = .42;

const smooth = (from: number, full: number, v: number) => { const x = Math.min(1, Math.max(0, (v - from) / (full - from))); return x * x * (3 - 2 * x); };
export const chromaOf = (c: Rgb) => Math.max(...c) - Math.min(...c);
export const lumaOf = (c: Rgb) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
/** How much of a page-edge colour shows at all (0 to 1): colourful AND bright. */
export const ambientShare = (c: Rgb, wide = false): number => wide ? smooth(WIDE_CHROMA_FROM, WIDE_CHROMA_FULL, chromaOf(c)) * smooth(WIDE_LUMA_FROM, WIDE_LUMA_FULL, lumaOf(c)) : smooth(CHROMA_FROM, CHROMA_FULL, chromaOf(c)) * smooth(LUMA_FROM, LUMA_FULL, lumaOf(c));

/** The colour as light: lifted into the dark band on a dark frame, mixed toward white on a light one. */
export function ambientColour(c: Rgb, dark: boolean): Rgb {
  if (!dark) return c.map(v => Math.round(v + (255 - v) * LIGHT_WHITE_MIX)) as unknown as Rgb;
  const top = Math.max(...c, 1), target = Math.min(DARK_BAND[1], Math.max(DARK_BAND[0], top)), k = target / top;
  return c.map(v => Math.min(255, Math.round(v * k))) as unknown as Rgb;
}
const hex = (c: Rgb) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** One stop: the light's colour and its share, the share lowered until the stop at its strongest keeps the frame readable. */
export function ambientStop(raw: Rgb, base: SiteTintBase, strength: number, wide = false): AmbientStop {
  const rgb = ambientColour(raw, base.dark);
  let alpha = ambientShare(raw, wide) * strength;
  if (alpha < .01) return { rgb, alpha: 0 };
  const ok = (a: number) => { const peak = compositeColor(`rgba(${rgb.join(' ')} / ${a})`, base.frame), r = frameReadability(base, peak, base.ink, base.muted, base.dark); return r.ink >= 4.5 && r.muted >= 4.5 && r.mutedOk && r.marksOk; };
  for (let i = 0; i < 40 && alpha > .01 && !ok(alpha); i++) alpha *= .92;
  return { rgb, alpha: alpha < .01 ? 0 : Math.round(alpha * 1000) / 1000 };
}
/** Where two edges of the page meet there is ONE colour: the page's corner. Every row of colours is read from its own thin strip, and two strips meet only in part, so their ends are given the same colour (the mean) and the lights of the two surfaces that
 *  meet there (the sidebar and the toolbar, the sidebar and the strip under the page, the strip beside the page and the toolbar, the two strips) are one tone at the corner: no step. The corner where the toolbar and the sidebar meet was the first (the side row's first colour and the top row's
 *  first, for a left sidebar, or last, for a right one); the strips round the page card add the other three, so the light goes all the way round the page. */
const meanOf = (a: Rgb, b: Rgb): Rgb => [0, 1, 2].map(i => Math.round((a[i] + b[i]) / 2)) as unknown as Rgb;
function shareEnds(x: Rgb[], xi: number, y: Rgb[], yi: number) { if (xi < 0 || yi < 0 || xi >= x.length || yi >= y.length) return; const mean = meanOf(x[xi], y[yi]); x[xi] = mean; y[yi] = mean; }
export function withSharedCorner(sample: AmbientSample): { l: Rgb[]; t: Rgb[]; r: Rgb[]; b: Rgb[] } {
  const l = [...sample.l], t = [...sample.t], r = [...(sample.r ?? [])], b = [...(sample.b ?? [])];
  if (!l.length || !t.length) return { l, t, r, b };
  const lastT = t.length - 1, lastL = l.length - 1, lastB = b.length - 1, lastR = r.length - 1;
  if (sample.side === 'right') {
    shareEnds(l, 0, t, lastT);            // the corner where the toolbar and the sidebar meet (top right)
    shareEnds(l, lastL, b, lastB);        // the sidebar and the strip under the page (bottom right)
    shareEnds(r, lastR, b, 0);            // the strip under the page and the strip beside it (bottom left)
    shareEnds(r, 0, t, 0);                // the strip beside the page and the toolbar (top left)
  } else {
    shareEnds(l, 0, t, 0);                // the toolbar and the sidebar (top left)
    shareEnds(l, lastL, b, 0);            // the sidebar and the strip under the page (bottom left)
    shareEnds(r, lastR, b, lastB);        // the strip under the page and the strip beside it (bottom right)
    shareEnds(r, 0, t, lastT);            // the strip beside the page and the toolbar (top right)
  }
  return { l, t, r, b };
}
export function ambientStops(sample: AmbientSample, base: SiteTintBase, level: 'off' | 'soft' | 'rich'): AmbientStops {
  const strength = AMBIENT_STRENGTH[level === 'rich' ? 'rich' : 'soft'], { l, t, r, b } = withSharedCorner(sample), wide = sample.wide === true;
  return { l: l.map(c => ambientStop(c, base, strength, wide)), t: t.map(c => ambientStop(c, base, strength, wide)), r: r.map(c => ambientStop(c, base, strength, wide)), b: b.map(c => ambientStop(c, base, strength, wide)) };
}
/** Is there any light at all? (A white or flat page has none: nothing is drawn and the layers are put away.) */
export const hasLight = (s: AmbientStops | null): boolean => !!s && [...s.l, ...s.t, ...s.r, ...s.b].some(stop => stop.alpha > .02);
/** The same light, within a few thousandths of a share and a couple of levels everywhere: not worth a cross-fade. */
export function sameLight(a: AmbientStops | null, b: AmbientStops | null): boolean {
  if (!a || !b || a.l.length !== b.l.length || a.t.length !== b.t.length || a.r.length !== b.r.length || a.b.length !== b.b.length) return false;
  const near = (x: AmbientStop[], y: AmbientStop[]) => x.every((stop, i) => Math.abs(stop.alpha - y[i].alpha) < .02 && stop.rgb.every((v, k) => Math.abs(v - y[i].rgb[k]) <= 3));
  return near(a.l, b.l) && near(a.t, b.t) && near(a.r, b.r) && near(a.b, b.b);
}

/** The light of a row at a point along it (0 = its first stop, 1 = its last): the two stops round it, mixed. The frame's light over a page that is CUT by a floating sidebar takes the page's own colour where the cut is
 *  (ui/ambient.ts): the corner the sidebar makes there is that colour, not the colour of the page's real corner, which is out of sight under the sidebar. */
/** How many levels a light moves the frame's own colour (the largest channel): what a stop near the page's corner is held up by (cornerRow). */
export function lightLevels(stop: AmbientStop | null, frame: string): number {
  if (!stop || !(stop.alpha > 0)) return 0;
  const channels = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  try { const lit = channels(compositeColor(`rgba(${stop.rgb.join(' ')} / ${stop.alpha})`, frame)), bare = channels(compositeColor('rgba(0 0 0 / 0)', frame)); return Math.max(...lit.map((v, i) => Math.abs(v - bare[i]))); } catch { return 0; }
}
export function stopAt(row: AmbientStop[], at: number): AmbientStop | null {
  if (!row.length) return null;
  const x = Math.max(0, Math.min(1, at)) * (row.length - 1), i = Math.min(row.length - 1, Math.floor(x)), j = Math.min(row.length - 1, i + 1), k = x - i, a = row[i], b = row[j];
  const mix = (c: 0 | 1 | 2) => Math.round(a.rgb[c] + (b.rgb[c] - a.rgb[c]) * k);
  return { rgb: [mix(0), mix(1), mix(2)], alpha: a.alpha + (b.alpha - a.alpha) * k };
}
/** NO DARK NOTCH BESIDE THE PAGE'S CORNER (D51, 18 Nov; the head is the column, 19 Nov; D80, 19 Nov). Under a head the column begins with the top row's colour where the bar meets it (`first`), and the head
 *  above it carries that light up to the window's top. A page that is read whole (plain edges, a coloured block further in) has a lit top row, a stop with no light beside the plain band under the corner, and
 *  light again below it: a dark band between the bar's light and the column's own, 60 levels deep on a bright video page. THAT NOTCH is filled: a run of at most CORNER_NOTCH stops, beginning at the first or
 *  the second stop under the corner, that lies more than 1.5 levels under a line falling by 3 levels in 40 px (`fall`, levels per px; `level` says how many levels a stop moves the frame: ui/ambient.ts
 *  gives lightLevels over the frame's colour) AND is closed by a stop that carries that line. Its stops take the stop above them, dimmed to the line.
 *  EVERYTHING ELSE IS THE PAGE'S OWN (D80). Until 19 Nov the line held every weaker stop all the way down, in the colour of the stop above: a page red above and green below lit the whole column red, and a
 *  coloured header over a plain body would have glowed down the sidebar. A run that is not closed is not a notch: the column follows the page by height, stop for stop, as it did before the head. */
export const CORNER_FALL = 3 / 40, CORNER_NOTCH = 2;
export function cornerRow(row: AmbientStop[], first: AmbientStop, span: number, level: (stop: AmbientStop) => number, fall = CORNER_FALL): AmbientStop[] {
  const n = row.length;
  if (n < 2 || !(span > 0)) return n ? [first, ...row.slice(1)] : row;
  const step = span / (n - 1), drop = fall * step, out: AmbientStop[] = [first, ...row.slice(1)], held: AmbientStop[] = [];
  let here = level(first), above = first, i = 1;
  // stops that carry the line keep their own and the count starts again from each; the notch begins at stop 1 or 2, or there is none
  for (; i <= CORNER_NOTCH && i < n; i++) { const own = level(row[i]); if (here - drop > 1.5 && own < here - drop - 1.5) break; here = own; above = row[i]; }
  if (i > CORNER_NOTCH || i >= n) return out;
  const start = i;
  for (; i < n && i - start < CORNER_NOTCH; i++) {
    const allowed = here - drop, had = level(above);
    if (!(allowed > 1.5 && level(row[i]) < allowed - 1.5 && had > 0)) break;
    above = { rgb: above.rgb, alpha: above.alpha * Math.min(1, allowed / had) }; held.push(above); here = allowed;
  }
  // closed by a stop that carries the line: a notch. Still under it after CORNER_NOTCH stops, or the column ends there: the page's own.
  if (!held.length || i >= n || (here - drop > 1.5 && level(row[i]) < here - drop - 1.5)) return out;
  held.forEach((stop, k) => { out[start + k] = stop; });
  return out;
}
/** THE BLEED (the head is the column, 19 Nov). At a sidebar's edge the bar's light bleeds 10 px into the head while the column's light is faded out over the same pixels, linearly (styles/ambient.css). Two layers, one
 *  drawn over the other: a share a over a share b shows a + b - a*b, so two straight fades dip in the middle (5 levels under a 65-level light). The bleed's own strength at `b` of the way to full (0 at the far
 *  side of the blend, 1 at the edge), for a column whose share is `share`: with it the two add up to the straight blend. */
/** The light's fall-off with the distance from the page's edge (px): the sidebar's across, the bar's upward (styles/ambient.css: 100 % at the edge, 70 % at 48, 34 % at 112, 10 % at 176, none at 232). */
export function fallOff(px: number): number {
  const at = [[0, 1], [48, .7], [112, .34], [176, .1], [232, 0]], d = Math.max(0, px);
  for (let i = 1; i < at.length; i++) if (d <= at[i][0]) return at[i - 1][1] + (at[i][1] - at[i - 1][1]) * (d - at[i - 1][0]) / (at[i][0] - at[i - 1][0]);
  return 0;
}
/** THE CORNER IS ONE VALUE (the team, 19 Nov, on the real takes: a ridge, the head 8 to 12 levels over the bar it joins along the window's top rows). A point of the head `dx` from the sidebar's edge and `h`
 *  above the bar's foot is as far from the page as the FARTHER of the two: its light is the column's at `max(dx, h)`. So at the edge the head is the bar's light on every row (the bar falls off upward on the same
 *  curve), beyond `dx = h` it is the column's, and nothing in between is brighter than either: no ridge, no blend needed. The mask is the column's fall-off across less a triangle at the corner (a diagonal
 *  gradient in a square as tall as the band, styles/ambient.css): these are its four alphas, at a quarter, a half, three quarters and the whole of the way from the diagonal to the corner, exact along the
 *  window's top row and never over the bar's value on the rows under it. */
export function cornerClamp(height: number): number[] {
  const H = Math.max(0, height), top = fallOff(H);
  return [1, 2, 3, 4].map(i => { const across = fallOff(H - H * i / 4); return across > 0 ? Math.round(Math.max(0, 1 - top / across) * 1000) / 1000 : 0; });
}
export const bleedFade = (share: number, b: number): number => Math.round(b / (1 - Math.min(.95, Math.max(0, share)) * (1 - b)) * 1000) / 1000;
export const rgba = (s: AmbientStop) => `rgb(${s.rgb[0]} ${s.rgb[1]} ${s.rgb[2]} / ${Math.round(s.alpha * 1000) / 1000})`;
/** A row of stops as a CSS gradient along `axis`, the stops spread over [from, from + span] px and the first and last colours held out to the ends. */
export function ambientGradient(stops: AmbientStop[], axis: 'y' | 'x', from: number, span: number): string {
  if (!stops.length) return 'none';
  const n = stops.length, at = (i: number) => Math.round((from + span * (n === 1 ? 0 : i / (n - 1))) * 10) / 10;
  // a row that begins before the box (the page's real rectangle under a floating sidebar) has stops at negative positions: no stop is held at 0px then, the gradient simply starts part-way along the row
  const parts = [...(at(0) >= 0 ? [`${rgba(stops[0])} 0px`] : []), ...stops.map((s, i) => `${rgba(s)} ${at(i)}px`), `${rgba(stops[n - 1])} 100%`];
  // stop positions must not go backwards: a page that starts at the edge (from 0) repeats the first stop at 0px
  const clean: string[] = [];
  let last = -Infinity;
  for (const part of parts) { const m = /(-?[\d.]+)(px|%)$/.exec(part); const pos = m && m[2] === 'px' ? Number(m[1]) : Infinity; if (pos < last) continue; if (pos !== Infinity) last = pos; clean.push(part); }
  return `linear-gradient(${axis === 'y' ? '180deg' : '90deg'}, ${clean.join(', ')})`;
}

/** THE FRAME IS ONE COLOUR FIELD (reported 20 Nov, final7 on YouTube: "even these linings"). Each 6 pt margin round the card is lit by the page's own edge on that side, and on a page whose four edges differ
 *  (a video's glow purple across the top and down the left, the dark right column and foot) each margin read as a band of its own colour beside the bar and the sidebar: slate under a purple bar, dark beside a
 *  purple sidebar. The joins were smooth (withSharedCorner), the bands were not. A margin is now the stretch of field BETWEEN the two surfaces it joins:
 *  (1) its own colours stay within FIELD_CAP levels (as drawn over the frame) of the straight line from the colour at its start to the colour at its end, mixed toward that line as little as it takes; the
 *      corner where two margins meet (the bottom one away from the sidebar) stays within FIELD_CAP of the mean of the two surfaces at their far ends (the bar's end, the sidebar's foot);
 *  (2) at each end it IS the colour it meets and comes into its own (capped) colours over FIELD_RAMP_PX (smoothstep).
 *  A dark page keeps a dark frame (its line is dark); a purple bar over a slate edge keeps the margin under it purple. The bar's and the sidebar's own light are untouched (same light, same strength).
 *  (A first cut held every margin to the mean of the whole bar and side: on a dark page with a purple middle it lifted dark margins toward a purple that is nowhere near them, 7.5 -> 20.8 levels, real windows.) */
export const FIELD_RAMP_PX = 160, FIELD_CAP = 8;
const mixStop = (a: AmbientStop, b: AmbientStop, k: number): AmbientStop => ({ rgb: [0, 1, 2].map(i => Math.round(a.rgb[i] + (b.rgb[i] - a.rgb[i]) * k)) as unknown as Rgb, alpha: Math.round((a.alpha + (b.alpha - a.alpha) * k) * 1000) / 1000 });
/** How far apart two lights are as drawn over the frame (the largest channel). */
function drawnApart(a: AmbientStop, b: AmbientStop, frame: string): number {
  const ch = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  try { const x = ch(compositeColor(`rgba(${a.rgb.join(' ')} / ${a.alpha})`, frame)), y = ch(compositeColor(`rgba(${b.rgb.join(' ')} / ${b.alpha})`, frame)); return Math.max(...x.map((v, i) => Math.abs(v - y[i]))); } catch { return 0; }
}
/** A stop held within `cap` levels of `target` as drawn over the frame: mixed toward it as little as it takes. */
export function capToField(stop: AmbientStop, target: AmbientStop | null, frame: string | null | undefined, cap = FIELD_CAP): AmbientStop {
  if (!target || !frame || drawnApart(stop, target, frame) <= cap) return stop;
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) { const mid = (lo + hi) / 2; if (drawnApart(mixStop(stop, target, mid), target, frame) <= cap) hi = mid; else lo = mid; }
  return mixStop(stop, target, hi);
}
/** (1) A margin's own stops held to the line between its ends (the line depends on the stop's place along the row only, so this is made once per read: ui/ambient.ts fieldOf). */
export function capRow(row: AmbientStop[], start: AmbientStop | null, end: AmbientStop | null, frame: string | null | undefined): AmbientStop[] {
  const n = row.length;
  if (!frame || !start || !end) return row;
  return row.map((stop, i) => capToField(stop, mixStop(start, end, n === 1 ? 0 : i / (n - 1)), frame));
}
const ease = (x: number) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v); };
/** (2) A margin's (capped) row as drawn: it IS `start` at its first end and `end` at its last, and comes into its own over FIELD_RAMP_PX at each. `span` is the row's length in px. */
export function fieldRow(row: AmbientStop[], start: AmbientStop | null, end: AmbientStop | null, span: number): AmbientStop[] {
  const n = row.length;
  if (!n) return row;
  return row.map((stop, i) => {
    const d = n === 1 ? 0 : span * i / (n - 1);
    let out = stop;
    if (start) out = mixStop(start, out, ease(d / FIELD_RAMP_PX));
    if (end) out = mixStop(end, out, ease((span - d) / FIELD_RAMP_PX));
    return out;
  });
}
/** The corner where two margins meet (the bottom one away from the sidebar): the two rows' shared colour, held within FIELD_CAP of the mean of the bar's end and the sidebar's foot that the two margins lead to. */
export function marginCorner(stops: AmbientStops, side: 'left' | 'right', frame: string | null | undefined): AmbientStop | null {
  const own = side === 'left' ? (stops.r.length ? stops.r[stops.r.length - 1] : stops.b.length ? stops.b[stops.b.length - 1] : null) : (stops.r.length ? stops.r[stops.r.length - 1] : stops.b.length ? stops.b[0] : null);
  const bar = stops.t.length ? (side === 'left' ? stops.t[stops.t.length - 1] : stops.t[0]) : null, foot = stops.l.length ? stops.l[stops.l.length - 1] : null;
  if (!own) return null;
  return bar && foot ? capToField(own, mixStop(bar, foot, .5), frame) : own;
}
/** The ends of each margin: what it meets. `side` is the sidebar's side. */
export function marginEnds(stops: AmbientStops, kind: 'far' | 'bottom' | 'near', side: 'left' | 'right', frame: string | null | undefined): { start: AmbientStop | null; end: AmbientStop | null } {
  const first = (row: AmbientStop[]) => row.length ? row[0] : null, last = (row: AmbientStop[]) => row.length ? row[row.length - 1] : null, corner = marginCorner(stops, side, frame);
  if (side === 'left') {
    if (kind === 'far') return { start: last(stops.t), end: stops.r.length ? corner : null };   // the right margin: the bar's right end over it, the bottom-right corner under it
    if (kind === 'bottom') return { start: last(stops.l), end: stops.b.length ? corner : null }; // the bottom margin: the sidebar's foot, then the bottom-right corner
    return { start: first(stops.t), end: first(stops.b) ?? last(stops.l) };                     // the hidden sidebar's margin: the bar's left end, then the bottom margin's start (the sidebar's foot)
  }
  if (kind === 'far') return { start: first(stops.t), end: stops.r.length ? corner : null };     // the left margin: the bar's left end, the bottom-left corner
  if (kind === 'bottom') return { start: stops.b.length ? corner : null, end: last(stops.l) };    // the bottom margin, left to right: the bottom-left corner, then the sidebar's foot
  return { start: last(stops.t), end: last(stops.b) ?? last(stops.l) };
}

/** The light in the four cut-outs of the page card's rounded corners (the part of the page's box outside its curve; the frame shows there, and the sidebar's and the toolbar's light layers, which end at their own boxes,
 *  never reached it). A cut-out takes the light of the page's own corner colour: the sidebar's column lights the two corners at its side (its first and last stops), the toolbar's band lights the two at the top (its first
 *  and last stops), a corner touching both takes the sidebar's (the first stops are shared). A corner whose neighbours are not lit (no sidebar, no toolbar, the bottom corner on the side away from the sidebar) gets none:
 *  it stays the frame, as in 13.8. `side` is the sidebar's side; `haveSide` / `haveTop` say whether the surface is there to light the corner. */
export interface CornerLight { tl: string; tr: string; bl: string; br: string }
export function cornerLight(stops: AmbientStops | null, side: 'left' | 'right', haveSide: boolean, haveTop: boolean, frame?: string | null): CornerLight {
  const none = 'rgb(0 0 0 / 0)', out: CornerLight = { tl: none, tr: none, bl: none, br: none };
  if (!stops || !stops.l.length || !stops.t.length) return out;
  // the corner where two margins meet (the bottom one away from the sidebar) is their one value as the field draws it (marginEnds): capped when the frame's colour is known
  const corner = frame ? marginCorner(stops, side, frame) : null, R1raw = stops.r.length ? stops.r[stops.r.length - 1] : null, B0raw = stops.b.length ? stops.b[0] : null;
  const L0 = stops.l[0], L1 = stops.l[stops.l.length - 1], T0 = stops.t[0], T1 = stops.t[stops.t.length - 1], R1 = R1raw && (corner ?? R1raw), B0 = B0raw && (corner ?? B0raw);
  if (side === 'left') {
    if (haveSide) { out.tl = rgba(L0); out.bl = rgba(L1); } else if (haveTop) out.tl = rgba(T0);
    if (haveTop) out.tr = rgba(T1);
    if (R1) out.br = rgba(R1);   // the strips round the page card light the bottom corner on the side away from the sidebar (frame, one surface)
  } else {
    if (haveSide) { out.tr = rgba(L0); out.br = rgba(L1); } else if (haveTop) out.tr = rgba(T1);
    if (haveTop) out.tl = rgba(T0);
    if (B0) out.bl = rgba(B0);
  }
  return out;
}
