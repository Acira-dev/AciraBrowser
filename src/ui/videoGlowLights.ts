import { paletteFromColor } from './nowPlayingPalette';
import type { AmbientSample, Rgb } from './ambientColours';

/** The pure half of the video's light (see videoGlow.ts): the card's lights as the rows of an Ambient sample, the site glow's one colour, and the card's last-resort palette. No window, no runtime: a test holds every rule. */
export type Lab = [number, number, number];
const SIDE_ROWS = 16, TOP_COLS = 24;

/** The card's own last resort for a page with no picture: four lights from the site's colour (nowPlayingPalette.ts). Re-exported so the video's light and the card can never disagree. */
export { paletteFromColor };

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;
const lab = (css: string): Lab | null => {
  const m = OKLCH.exec(css); if (!m) return null;
  const L = Number(m[1]), C = Number(m[2]), h = Number(m[3]) * Math.PI / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
};
const encode = (x: number) => { const v = Math.min(1, Math.max(0, x)); return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055)); };
/** OKLab to sRGB (0..255), clipped to the gamut. */
export function labToRgb(L: number, a: number, b: number): Rgb {
  const l = Math.pow(L + .3963377774 * a + .2158037573 * b, 3), m = Math.pow(L - .1055613458 * a - .0638541728 * b, 3), s = Math.pow(L - .0894841775 * a - 1.291485548 * b, 3);
  return [encode(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s), encode(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s), encode(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)];
}
/** `count` colours along the lights in order, blended in OKLab (so two hues meet through a clean mix, not through grey): the first light at the start, the last at the end. */
export function lightsRow(lights: Lab[], count: number): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < count; i++) {
    const at = count === 1 ? 0 : i / (count - 1) * (lights.length - 1), k = Math.min(lights.length - 2, Math.floor(at)), f = lights.length === 1 ? 0 : at - k;
    const p = lights[Math.max(0, k)], q = lights[Math.min(lights.length - 1, k + 1)];
    out.push(labToRgb(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f));
  }
  return out;
}
/** The lights (CSS oklch strings, left to right) as the two rows an Ambient sample is: along the top, left to right, and down the sidebar's edge, beginning with the light at the corner where the two meet (the
 *  first for a sidebar on the left, the last for one on the right), so the corner is one light. Null when no light can be read. */
export function sampleFromLights(lights: readonly string[] | null | undefined, side: 'left' | 'right', id?: string): AmbientSample | null {
  const labs = (lights ?? []).map(lab).filter((value): value is Lab => !!value);
  if (!labs.length) return null;
  const top = lightsRow(labs, TOP_COLS), down = lightsRow(side === 'right' ? [...labs].reverse() : labs, SIDE_ROWS);
  return { id, side, l: down, t: top };
}
/** The one colour for the site glow: the most colourful light, as #rrggbb. */
export function dominantHex(lights: readonly string[] | null | undefined): string | null {
  let best: Lab | null = null, chroma = -1;
  for (const css of lights ?? []) { const v = lab(css); if (v && Math.hypot(v[1], v[2]) > chroma) { chroma = Math.hypot(v[1], v[2]); best = v; } }
  if (!best) return null;
  return '#' + labToRgb(best[0], best[1], best[2]).map(c => c.toString(16).padStart(2, '0')).join('');
}

