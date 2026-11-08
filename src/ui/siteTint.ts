/**
 * Site tint (beta.13 study, item 19, researcher B: rendering). DEV PROTOTYPE, off unless the dev flag is set.
 *
 * The window frame (sidebar + top bar) takes a share of the open site's colour. Pure colour math lives here; the DOM engine
 * is siteTintEngine.ts and the paint is styles/site-tint.css.
 *
 * THE RULE (why it is AA on every colour and never flashes):
 *   The site gives the frame its HUE and a share of its COLOURFULNESS. Acira keeps the LIGHTNESS band of the person's own
 *   finish (the same rule finishes already follow in theme.ts: "hue and colorfulness come from the swatch; lightness comes
 *   from Acira's own scale"). Because lightness stays inside the finish's band, the finish's own ink, muted ink, icons and
 *   states keep their contrast without being recomputed, and the ink never flips between white and dark when the tab or the
 *   site changes. A colour change is then only a hue/chroma glide, so it can morph; it can never flash.
 *   - Very light sites (white, Wikipedia, Notion): no usable hue, so the frame stays the finish's own.
 *   - Very dark sites (GitHub dark, Spotify black): in a dark window the frame leans toward their hue at a floor chroma so
 *     the bar visibly belongs to them; in a light window the frame stays light (a near-black bar would flip the ink).
 *   - Any tint is gated: the chroma is lowered until every ink role passes WCAG AA (4.5:1 text, 3:1 icons) on the frame and on
 *     the hover, pressed and selected steps drawn over it.
 * "match" mode (the frame takes the site's lightness too, ink flips) is built only to be compared; it is not recommended.
 */
import { contrast, fromOklch, mix, rgb, toOklch } from './colorMath';

export type SiteTintMode = 'tint' | 'match';
/** flat: one colour. fade: the tint is strongest at the top and thins down the sidebar. edge: the top bar leans toward the
 * page's own top-edge colour at the seam. near: the tint hugs the page card and falls away from it (see site-tint.css). */
export type SiteTintShape = 'flat' | 'fade' | 'edge' | 'near';
/** frame: the one frame surface (sidebar + bands round the page). bar: the part beside the page only; the sidebar stays Acira's. */
export type SiteTintScope = 'frame' | 'bar';

export interface SiteTintRequest {
  /** The site's colour: its theme-color or sampled brand colour. */
  color: string;
  /** What the page's own top edge looks like (a sample), used by the "edge" shape. */
  edge?: string;
  /** 0 (off) to 1 (bold). Named levels below. */
  strength: number;
  mode?: SiteTintMode;
  shape?: SiteTintShape;
  scope?: SiteTintScope;
}
/** The finish's own frame as the engine reads it from the page: nothing here is recomputed by the tint. */
export interface SiteTintBase {
  dark: boolean;
  /** The finish's frame colour (--sidebar-rgb as a hex). */
  frame: string;
  /** The finish's ink on that frame (--sidebar-ink) and its secondary ink (--sidebar-muted). */
  ink: string;
  muted: string;
  /** The finish's accent and selection marker drawn on the frame (non-text, 3:1): the tint may not make them worse than 3:1, or than they already are. */
  accent?: string; marker?: string;
}
export interface SiteTintColors {
  frame: string; surface: string; end: string; hover: string; pressed: string; selected: string; divider: string; sheet: string; edge: string; halo: string;
  /** Present in match mode only (the ink flips with the site). */
  ink?: string; muted?: string; tone: 'light' | 'dark';
  /** What the rule did: the chroma was lowered by the AA gate, or the site had no hue to give. */
  note: 'ok' | 'gated' | 'no-hue' | 'dark-site-in-light-window';
  chroma: number;
}

/** Named levels the pictures and the (future) setting use. */
export const SITE_TINT_LEVELS = { whisper: .22, soft: .45, rich: .72, bold: 1 } as const;

/** Largest chroma that fits sRGB at this lightness and hue. */
function maxChroma(L: number, h: number) {
  let low = 0, high = .4;
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2, hex = fromOklch(L, mid, h), [, c] = toOklch(hex);
    if (c >= mid - .002) low = mid; else high = mid;
  }
  return low;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const triple = (hex: string) => rgb(hex).join(' ');
export const tripleOf = triple;

/** The frame states Acira draws over its frame, derived exactly as semanticColors derives them (ink mixed into the frame). */
export function siteTintStates(frame: string, ink: string, dark: boolean) {
  return {
    hover: mix(ink, frame, dark ? .08 : .055),
    pressed: mix(ink, frame, dark ? .13 : .09),
    selected: mix(ink, frame, dark ? .13 : .09),
    divider: mix(ink, frame, .1),
    sheet: dark ? mix('#ffffff', frame, .1) : '#ffffff',
  };
}
/** The secondary ink (labels, icons): the finish's own while it reads 4.6:1 on the frame and the steps over it, else the smallest
 * step toward the main ink that does. A continuous change of a few levels, never a flip. ok=false when it would need more than 60%. */
export function fitMuted(muted: string, ink: string, surfaces: string[], minimum = 4.6) {
  for (let step = 0; step <= 20; step++) {
    const color = step === 0 ? muted : mix(ink, muted, step * .03);
    if (surfaces.every(surface => contrast(color, surface) >= minimum)) return { color, ok: true };
  }
  return { color: ink, ok: contrast(ink, surfaces[0]) >= 7 && surfaces.every(surface => contrast(ink, surface) >= minimum) };
}
/** Every pair a person reads on the frame, as it will be drawn: text 4.5:1, secondary text and icons 4.6:1. */
export function frameReadability(base: SiteTintBase, frame: string, ink = base.ink, muted = base.muted, dark = base.dark) {
  const s = siteTintStates(frame, ink, dark), surfaces = [frame, s.hover, s.pressed, s.selected];
  const fit = fitMuted(muted, ink, surfaces);
  // Non-text marks (accent, selection marker): 3:1 on the frame, or what the finish already had if that was lower.
  const nonText = (color?: string) => !color ? true : contrast(color, frame) >= Math.min(3, contrast(color, base.frame) - .02);
  return { ink: Math.min(...surfaces.map(surface => contrast(ink, surface))), muted: Math.min(...surfaces.map(surface => contrast(fit.color, surface))), mutedColor: fit.color, mutedOk: fit.ok, marksOk: nonText(base.accent) && nonText(base.marker) };
}
const passes = (r: { ink: number; muted: number; mutedOk: boolean; marksOk: boolean }) => r.ink >= 4.5 && r.muted >= 4.5 && r.mutedOk && r.marksOk;

export function siteTintColors(request: SiteTintRequest, base: SiteTintBase): SiteTintColors {
  const strength = clamp(request.strength, 0, 1), mode = request.mode ?? 'tint';
  const [Lc, Cc, hc] = toOklch(base.frame), [Ls, Cs, hs] = toOklch(request.color);
  const edgeSeed = request.edge || request.color;
  let note: SiteTintColors['note'] = 'ok';
  let frame = base.frame, ink: string | undefined, muted: string | undefined, tone: 'light' | 'dark' = base.dark ? 'dark' : 'light';

  if (mode === 'match') {
    // The site's own lightness: the frame can end up dark in a light window and the ink flips. For comparison only.
    const L = mix2(Lc, clamp(Ls, .12, .97), strength), C = Math.min(Cs * strength, maxChroma(L, hs) * .95);
    frame = fromOklch(L, C, hs);
    const white = contrast('#ffffff', frame) >= contrast('#16181c', frame);
    ink = white ? '#ffffff' : '#16181c';
    muted = white ? mix(ink, frame, .72) : mix(ink, frame, .74);
    for (let i = 0; i < 24 && contrast(muted, frame) < 4.6; i++) muted = mix(ink, muted, .85);
    tone = white ? 'dark' : 'light';
  } else {
    // Hue source. A site with no hue (white, black, grey) gives the frame nothing to lean toward.
    const hasHue = Cs >= .018;
    // Lightness: the finish's own, nudged toward the site's (a deeper site makes a slightly deeper frame), inside the same band
    // Acira's colour finishes use (light frames .86-.96, dark .16-.22), so the finish's ink keeps its contrast.
    const down = base.dark ? .045 : .11, up = base.dark ? .05 : 0;
    const siteDark = Ls < .32, darkLean = siteDark && base.dark && Cs >= .006;
    // A site with no hue to give moves nothing: a grey nudge would only dull the frame.
    const L0 = hasHue || darkLean ? clamp(Lc + (Ls - Lc) * .3 * strength, Lc - down, Lc + up) : Lc;
    // Colourfulness: a share of the site's chroma, never past what the gamut holds at this lightness, with a floor for dark
    // sites (a #0d1117 has chroma .014; in a dark window a floor lets the bar still lean blue).
    // Light windows also stop at chroma .07 (the YouTube-like Bold level): a saturated brand (a green at .10) otherwise reads as candy.
    const cap = (L: number) => Math.min(maxChroma(L, hs) * .8, base.dark ? 1 : .07);
    let want = hasHue || darkLean ? Math.max(Cs, darkLean ? .045 : 0) : 0;
    if (siteDark && !base.dark && hasHue) want = Math.min(want, .05); // a dark brand in a light window: a hint, not a bar
    if (!hasHue && !darkLean) note = siteDark && !base.dark ? 'dark-site-in-light-window' : 'no-hue';
    const gain = hasHue || darkLean ? Math.max(1, .17 / Math.max(want, .02)) : 1; // muted brands still show: scale toward a visible chroma
    // Dark reds and oranges go brown at low lightness; leaning them ~9 degrees toward crimson keeps them rich (the Abney shift).
    const hueShift = base.dark && hs > .2 && hs < 1.25 ? -.16 * Math.min(1, strength + .3) : 0;
    const draw = (L: number, chroma: number) => fromOklch(L, chroma, want === 0 ? hc : hs + hueShift);
    let L = L0, C = want === 0 ? Cc * (1 - strength * .6) : Cc + (Math.min(cap(L) , want * Math.min(gain, 2.2)) - Cc) * strength;
    frame = draw(L, C);
    for (let i = 0; i < 40 && !passes(frameReadability(base, frame)); i++) { C *= .9; L = Math.min(Lc + up, L + .008); frame = draw(L, C); note = 'gated'; }
    if (!passes(frameReadability(base, frame))) { frame = base.frame; note = 'gated'; }
    muted = frameReadability(base, frame).mutedColor;
  }
  const useInk = ink ?? base.ink, s = siteTintStates(frame, useInk, tone === 'dark');
  const [, Cf, hf] = toOklch(frame);
  if (!muted) muted = base.muted;
  // Where the tint fades to: the finish's own frame (shape "fade"); the page's edge colour (shape "edge").
  const end = mix(frame, base.frame, .3);
  const edge = mix(edgeSeed, frame, .5);
  const halo = fromOklch(clamp(toOklch(frame)[0] + (base.dark ? .04 : -.06), 0, 1), Math.min(Cf * 1.4, maxChroma(clamp(toOklch(frame)[0] + (base.dark ? .04 : -.06), 0, 1), hf)), hf);
  // The raised row joined to the selected tab (toolbar): Acira's white, with a fifth of the frame in it so the bar belongs to the strip above.
  const surface = base.dark ? frame : mix('#ffffff', frame, .8);
  return { frame, surface, end, hover: s.hover, pressed: s.pressed, selected: s.selected, divider: s.divider, sheet: s.sheet, edge, halo, ink, muted, tone, note, chroma: Cf };
}
const mix2 = (a: number, b: number, f: number) => a + (b - a) * f;

/** Glide between two frame colours in OKLab (a straight line, not round the hue wheel): red to green passes through a soft
 * desaturated middle like a dissolve, not through yellow, and lightness moves linearly inside the finish's band. */
export function glideColor(from: string, to: string, t: number) {
  const [L1, C1, h1] = toOklch(from), [L2, C2, h2] = toOklch(to);
  const a = mix2(C1 * Math.cos(h1), C2 * Math.cos(h2), t), b = mix2(C1 * Math.sin(h1), C2 * Math.sin(h2), t);
  return fromOklch(mix2(L1, L2, t), Math.hypot(a, b), Math.atan2(b, a));
}

/** The variables the stylesheet reads. Colours are hex; the -rgb forms feed rgb(var(..) / alpha). */
export function siteTintVariables(colors: SiteTintColors, request: SiteTintRequest): Record<string, string> {
  return {
    '--st-frame': colors.frame, '--st-frame-rgb': triple(colors.frame), '--st-surface-rgb': triple(colors.surface),
    '--st-end-rgb': triple(colors.end), '--st-edge-rgb': triple(colors.edge), '--st-halo-rgb': triple(colors.halo),
    '--st-hover': colors.hover, '--st-pressed': colors.pressed, '--st-selected': colors.selected, '--st-divider': colors.divider, '--st-sheet': colors.sheet,
    '--st-muted': colors.muted!,
    ...(colors.ink ? { '--st-ink': colors.ink, '--st-ink-rgb': triple(colors.ink) } : {}),
    '--st-strength': String(clamp(request.strength, 0, 1)),
  };
}

export const SITE_TINT_FLAG_KEY = 'acira.dev.siteTint';
/** The dev flag. Off by default; on with localStorage 'acira.dev.siteTint' = '1' or ?siteTint=1 on the interface URL. */
let flag: boolean | undefined;
export function siteTintEnabled(): boolean {
  if (flag !== undefined) return flag; // read once per page load: App asks on every render
  try {
    flag = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('siteTint') === '1')
      || (typeof localStorage !== 'undefined' && localStorage.getItem(SITE_TINT_FLAG_KEY) === '1');
  } catch { flag = false; }
  return flag;
}
