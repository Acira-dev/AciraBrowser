/**
 * Site glow (beta.13 study, item 19, part B step 2). DEV PROTOTYPE, off unless the dev flag is set (siteTint.ts).
 *
 * The founder's direction: instead of colouring the sidebar and top bar, extend the glow the New Tab page already draws from its
 * artwork (`.nt-glow`: three soft radial washes of the picture's own colours, 12% opacity) to websites, so the site's colour
 * glows into the sidebar. The native page view is drawn ABOVE the interface, so the glow can only live in the interface layers
 * round and behind the page: it is painted from the page's edges outward over the sidebar column, the band above the page and the
 * strip below it, and the page covers its own side of every wash.
 *
 * Colour source: researcher A's ACCENT pipeline (a glow is an accent, not a surface): the favicon's brand colour (saturated, neither
 * near-black nor near-white), else the manifest colour, else theme-color, else the sampled top edge, else NO glow (white-tile icons
 * on white sites have no brand colour and the glow is absent, not black). `glowColour(..., 'surface-first')` is the order the
 * coordinator listed (theme-color, edge, favicon) for comparison.
 *
 * Safety: the wash colour is held to the finish's lightness band (same rule as siteTint.ts) and the PEAK composite (the layer at its
 * full opacity over the finish's frame) is gated like a tint frame: ink and secondary ink AA, accent and marker 3:1.
 */
import { compositeColor, contrast, fromOklch, mix, toOklch } from './colorMath';
import { frameReadability, siteTintStates, type SiteTintBase } from './siteTint';

export interface GlowSources { favicon?: string; manifest?: string; themeColor?: string; edge?: string }
export type GlowOrder = 'accent' | 'surface-first';
/** A colour a person would call the site's colour: saturated, not near-black, not near-white. */
export function isBrandColour(hex: string | undefined): hex is string {
  if (!hex || !/^#[\da-f]{6}$/i.test(hex)) return false;
  const [L, C] = toOklch(hex);
  return C >= .06 && L >= .3 && L <= .92;
}
export function glowColour(sources: GlowSources, order: GlowOrder = 'accent'): { color?: string; from?: keyof GlowSources } {
  const sequence: (keyof GlowSources)[] = order === 'accent' ? ['favicon', 'manifest', 'themeColor', 'edge'] : ['themeColor', 'edge', 'favicon', 'manifest'];
  for (const key of sequence) if (isBrandColour(sources[key])) return { color: sources[key], from: key };
  return {};
}

/** Layer opacity at the named strengths (the New Tab's own is .12 over a plain page; the frame sits under a veil, so more). */
export const SITE_GLOW_LEVELS = { soft: .3, rich: .55 } as const;
/** The setting's two levels as the request's strength (layer opacity .12 + .43 x strength: Soft .30, Rich .55). */
export const SITE_GLOW_STRENGTH = { soft: .42, rich: 1 } as const;
export interface SiteGlowRequest { color: string; strength: number }
export interface SiteGlowColors { g1: string; g2: string; g3: string; opacity: number; peak: string; note: 'ok' | 'gated' | 'none' }

/** Screen blend in dark windows (as `.nt-glow`), normal blend in light. The peak is the strongest pixel of the layer. */
export function glowPeak(frame: string, glow: string, opacity: number, dark: boolean) {
  if (!dark) return compositeColor(`rgba(${rgbOf(glow)} / ${opacity})`, frame);
  const f = rgbOf(frame).split(' ').map(Number), g = rgbOf(glow).split(' ').map(Number);
  return '#' + f.map((v, i) => Math.round(255 * (1 - (1 - v / 255) * (1 - opacity * g[i] / 255))).toString(16).padStart(2, '0')).join('');
}
const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ');

export function siteGlowColors(request: SiteGlowRequest, base: SiteTintBase): SiteGlowColors {
  const strength = Math.max(0, Math.min(1, request.strength)), [Lc] = toOklch(base.frame), [Ls, Cs, hs] = toOklch(request.color);
  if (strength <= 0 || Cs < .03) return { g1: base.frame, g2: base.frame, g3: base.frame, opacity: 0, peak: base.frame, note: 'none' };
  // Lightness: the finish's band (light: a touch deeper than the frame so the wash reads; dark: a touch brighter, drawn with screen).
  const L1 = base.dark ? Math.min(.46, Lc + .26 + (Ls - .5) * .1) : Math.max(.7, Lc - .16 + (Ls - .6) * .05);
  const hue = (d: number) => hs + d * Math.PI / 180;
  const opacity = .12 + (.55 - .12) * strength; // .12 is the New Tab's own; .55 is the top of the range
  let chroma = Math.min(Cs, base.dark ? .13 : .15), note: SiteGlowColors['note'] = 'ok';
  const make = (c: number) => ({ g1: fromOklch(L1, c, hue(0)), g2: fromOklch(L1 + (base.dark ? .06 : .03), c * .85, hue(16)), g3: fromOklch(L1 - (base.dark ? .06 : .03), c * .85, hue(-16)) });
  let colors = make(chroma), peak = glowPeak(base.frame, colors.g1, opacity, base.dark);
  const ok = (p: string) => { const r = frameReadability(base, p, base.ink, base.muted, base.dark); return r.ink >= 4.5 && r.muted >= 4.5 && r.mutedOk && r.marksOk; };
  for (let i = 0; i < 40 && !ok(peak); i++) { chroma *= .9; note = 'gated'; colors = make(chroma); peak = glowPeak(base.frame, colors.g1, opacity, base.dark); }
  if (!ok(peak)) return { g1: base.frame, g2: base.frame, g3: base.frame, opacity: 0, peak: base.frame, note: 'none' };
  return { ...colors, opacity, peak, note };
}
// kept for the engine's glow states: hover and pressed stay Acira's own opaque steps (they sit over the wash as small patches)
export const glowStates = siteTintStates;
export { contrast, mix };
