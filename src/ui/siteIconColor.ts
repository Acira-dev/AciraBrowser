import { useSyncExternalStore } from 'react';
import { siteIdentity } from '../runtime/sites';
import { pageIcon } from './internalPageIcon';

/** The dominant colour of a site's icon, worked out on this computer from an icon the browser already holds (a saved data image, a bundled
 * icon, the icon store). Nothing is fetched: an icon from another origin cannot be read and gives `undefined`.
 *
 * Shared by the Favorites ring (components/sidebar) and the tab glow (item 11): one reader and one cache, so a site is one colour everywhere. Only two numbers are kept per icon, the OKLCH hue and chroma, so one
 * cached pair serves light and dark: the stylesheet (or `oklchToRgb`) picks the lightness for the theme. An icon with no real colour
 * (black, white, grey, or none at all) gives `null`, and the caller falls back to the accent colour. */
export interface IconColor {
  /** OKLCH hue in degrees, 0 to 359. */
  h: number;
  /** OKLCH chroma, kept between `MIN_CHROMA` and `MAX_CHROMA` so a pale icon still gives a visible colour and a neon one stays inside sRGB. */
  c: number;
}

export const MIN_CHROMA = 0.11;
export const MAX_CHROMA = 0.19;
/** OKLCH lightness of a ring or glow drawn in an icon's colour: dark enough on light chrome and light enough on dark chrome to keep 3:1 (see tests/site-icon-color.test.ts). */
export const RING_LIGHTNESS = { light: 0.58, dark: 0.72 } as const;

const BINS = 24;
/** Pixels with less chroma than this (grey), or lighter or darker than the bounds, carry no colour. */
const GREY_CHROMA = 0.05, DARKEST = 0.18, LIGHTEST = 0.96;
/** An icon needs at least this share of its opaque pixels to have colour (GitHub's cat, Wikipedia's globe, Notion's cube do not). */
const MIN_COLOURED_SHARE = 0.12;

const linear = (value: number) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gamma = (value: number) => { const v = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055; return v; };

function toOklab(r: number, g: number, b: number) {
  const R = linear(r), G = linear(g), B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

/** Pure: RGBA pixels (as a canvas gives them) to the icon's dominant hue and chroma, or `null` when the icon has no real colour. */
export function analyseIcon(data: ArrayLike<number>): IconColor | null {
  const weight = new Float64Array(BINS), sumA = new Float64Array(BINS), sumB = new Float64Array(BINS);
  let opaque = 0, coloured = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    opaque++;
    const { L, a, b } = toOklab(data[i], data[i + 1], data[i + 2]), chroma = Math.hypot(a, b);
    if (chroma < GREY_CHROMA || L < DARKEST || L > LIGHTEST) continue;
    coloured++;
    const bin = Math.floor(((Math.atan2(b, a) * 180 / Math.PI + 360) % 360) / (360 / BINS)) % BINS, w = chroma * chroma; // the more vivid a pixel, the more it counts
    weight[bin] += w; sumA[bin] += a * w; sumB[bin] += b * w;
  }
  if (!opaque || coloured / opaque < MIN_COLOURED_SHARE) return null;
  let best = 0, bestScore = -1;
  for (let i = 0; i < BINS; i++) {
    const score = weight[i] + 0.5 * (weight[(i + 1) % BINS] + weight[(i + BINS - 1) % BINS]); // a hue straddling two bins still wins as one
    if (score > bestScore) { bestScore = score; best = i; }
  }
  let a = 0, b = 0, w = 0;
  for (const i of [best, (best + 1) % BINS, (best + BINS - 1) % BINS]) { a += sumA[i]; b += sumB[i]; w += weight[i]; }
  if (!w) return null;
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360, c = Math.hypot(a, b) / w;
  return { h: Math.round(h) % 360, c: Math.round(Math.min(MAX_CHROMA, Math.max(MIN_CHROMA, c)) * 1000) / 1000 };
}

/** An OKLCH colour as sRGB 0-255, pulled into the gamut by lowering its chroma (hue and lightness are kept). */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const at = (chroma: number) => {
    const a = chroma * Math.cos(h * Math.PI / 180), b = chroma * Math.sin(h * Math.PI / 180);
    const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
  };
  const inside = (rgb: number[]) => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  let low = 0, high = c;
  if (inside(at(c))) low = c;
  else for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (inside(at(mid))) low = mid; else high = mid; }
  return at(low).map(v => Math.round(Math.min(1, Math.max(0, gamma(Math.min(1, Math.max(0, v))))) * 255)) as [number, number, number];
}

const luminance = ([r, g, b]: readonly number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG contrast ratio of two sRGB colours (0-255). */
export function contrastRatio(x: readonly number[], y: readonly number[]): number {
  const a = luminance(x), b = luminance(y);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Reading an icon and remembering the answer. In memory per icon; in local storage as hue and chroma by site and icon (not in a private window).

const STORE = 'acira-icon-colors', STORE_LIMIT = 300;
const memory = new Map<string, IconColor | null | undefined>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0, stored: Record<string, [number, number] | 0> | null = null;
const changed = () => { version++; listeners.forEach(listener => listener()); };

/** A short stable fingerprint of an icon's text (FNV-1a), so a site that changes its icon is read again. */
const fingerprints = new Map<string, string>();
export function iconKey(src: string): string {
  const known = fingerprints.get(src);
  if (known) return known;
  let hash = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { hash ^= src.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  const value = (hash >>> 0).toString(36) + src.length.toString(36);
  if (fingerprints.size > 200) fingerprints.clear();
  fingerprints.set(src, value);
  return value;
}
const keyOf = (site: string, src: string) => `${site}#${iconKey(src)}`;

function load(): Record<string, [number, number] | 0> {
  if (stored) return stored;
  try { stored = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { stored = {}; }
  return stored!;
}
function save(key: string, value: IconColor | null) {
  const all = load(), keys = Object.keys(all);
  if (keys.length >= STORE_LIMIT) for (const old of keys.slice(0, keys.length - STORE_LIMIT + 1)) delete all[old];
  delete all[key]; all[key] = value ? [value.h, value.c] : 0; // re-inserted last: the newest stay
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* the colour is just read again next time */ }
}

function read(src: string): Promise<IconColor | null | undefined> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(undefined);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(undefined);
        context.drawImage(image, 0, 0, 32, 32);
        resolve(analyseIcon(context.getImageData(0, 0, 32, 32).data));
      } catch { resolve(undefined); } // an icon from another origin taints the canvas: unreadable, not colourless
    };
    image.onerror = () => resolve(undefined);
    image.src = src;
  });
}

/** The colour of one icon: `IconColor`, `null` (no real colour) or `undefined` (not read yet, or unreadable). Starts the read when needed. */
export function iconColor(site: string, src: string | undefined, persist = true): IconColor | null | undefined {
  if (!src) return null;
  const key = keyOf(site, src);
  if (memory.has(key)) return memory.get(key);
  if (persist) {
    const saved = load()[key];
    if (saved !== undefined) { const value = saved ? { h: saved[0], c: saved[1] } : null; memory.set(key, value); return value; }
  }
  if (!pending.has(key)) {
    pending.add(key);
    void read(src).then(value => {
      pending.delete(key);
      memory.set(key, value);
      if (value !== undefined && persist) save(key, value);
      changed();
    });
  }
  return undefined;
}

/** For a list of icons (`key` names the result, `site` is what the answer is remembered under, with the icon's fingerprint): their colours,
 * filled in as the reads finish. Re-renders when one does. */
export function useIconColors(items: readonly { key: string; site: string; src?: string }[], persist = true): Record<string, IconColor | null | undefined> {
  useSyncExternalStore(subscribe, () => version);
  const out: Record<string, IconColor | null | undefined> = {};
  for (const { key, site, src } of items) out[key] = iconColor(site, src, persist);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The tab glow (item 11): the selected tab and a hovered one take a soft glow in the site's colour. It is the same hue and chroma the Favorites
// ring wears, drawn at one lightness that works on both themes (the glow is a decoration at a low share; the row's own ink is checked against
// the strongest wash in tests/tab-glow.test.ts), as '#rrggbb' so the selection motion can blend it from one tab's colour to the next's.
// ---------------------------------------------------------------------------------------------------------------------------------------

/** OKLCH lightness of the glow colour. */
export const GLOW_LIGHTNESS = 0.64;

/** The glow colour of an icon's hue and chroma, as `#rrggbb`. */
export function glowHex(color: IconColor): string {
  return '#' + oklchToRgb(GLOW_LIGHTNESS, color.c, color.h).map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Pure: RGBA pixels to the glow colour (`#rrggbb`), or `null` when the icon has no real colour. */
export function glowColorFromPixels(data: ArrayLike<number>): string | null {
  const color = analyseIcon(data);
  return color ? glowHex(color) : null;
}

/** The picture a tab's icon is drawn from (SiteIdentityIcon's rule), or '' when the tab wears a glyph of Acira's own or has no icon. */
export function iconSourceOf(url: string, favicon?: string): string {
  const identity = siteIdentity(url);
  return identity.icon || (favicon && /^(https?:|data:image\/|acira-app:)/i.test(favicon) ? favicon : '');
}

/** The colour source for a tab: its icon's picture, unless Acira draws its own glyph there (its pages, a failed page). */
export function tabIconSource(url: string, favicon?: string, error = false): string {
  return error || pageIcon(url) ? '' : iconSourceOf(url, favicon);
}

/**
 * The glow colour of a tab's site icon as `#rrggbb`, or undefined while it is being read or when there is none.
 * `enabled` is false for a tab that must not glow (private, Tor, sleeping, a risk outline, a linked copy): nothing is read for it.
 * The answer is remembered by the icon's hash alone (no site name or address), so browsing leaves no list of sites on the device.
 */
export function useSiteIconColor(url: string, favicon: string | undefined, enabled = true, error = false): string | undefined {
  useSyncExternalStore(subscribe, () => version);
  const src = enabled ? tabIconSource(url, favicon, error) : '';
  const color = src ? iconColor('', src) : null;
  return color ? glowHex(color) : undefined;
}

/** Test seam: forget everything read so far (memory only). */
export function resetIconColors() { memory.clear(); pending.clear(); fingerprints.clear(); stored = {}; changed(); }

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
