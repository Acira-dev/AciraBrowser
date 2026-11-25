import { useSyncExternalStore } from 'react';
import { iconKey } from './siteIconColor';

/** The plate a Favorite's icon sits on inside the stack (Beta 14, L3), decided automatically for every site and worked out once per icon on this computer from
 *  an image the browser already holds (a saved data image, a bundled icon, the local favicon store): nothing is fetched. The answer is a handful of values kept
 *  in this computer's local storage beside the icon colours, by the icon's own hash (no site name or address), so it is not read again.
 *
 *  The rule, on a 64px drawing of the icon (opaque = alpha > 200, clear = alpha <= 40; the silhouette's box is every pixel over 40):
 *   1. TILE (the icon is a solid, possibly rounded, square): the box is square within 8% and at least 80% of the drawing, at least 86% of the box is opaque and its
 *      middle (inset 22%) is 99% or more opaque. Its background is read from the four corners (each at 3% and 10% in, 6% patches; the 3% patch is skipped where it is
 *      clear, as on a rounded tile): one colour (within 22 per channel) holding at least 50% of the patches' pixels and showing in at least 3 corners. Failing that, the
 *      dominant colour of the band 3px inside the silhouette's edge when it holds at least 50% of it. The plate takes that colour and the icon's square edge is feathered
 *      into it (17%), so no hard square shows. No single background (Instagram's gradient, Google Calendar's frame): the icon is the plate, edge to edge, clipped to the
 *      plate's shape, on the neutral surface.
 *   2. DISC (a round icon): near-square box at least 60% of the drawing, at least 90% opaque inside .92 r of its centre and at least 90% clear outside 1.06 r. The rim
 *      (.78 r to .98 r) is one colour holding at least 60% of the ring and the glyph is not cut out (under 4% clear inside .85 r): the plate is the rim colour, the disc
 *      melts into it and the glyph stays. A cut-out glyph (Spotify's waves, Zoom's letters) would vanish on its own colour, so it stays a mark.
 *   3. MARK (anything else, a bare logo on a transparent ground: Figma, GitHub, Slack): Acira's neutral tile surface. Never a guessed colour.
 *   4. CONTRAST GUARD on every neutral plate: the mean luminance of the mark's edge band (where it meets the plate) against both neutrals (white, and rgb 56 57 63):
 *      under 2.2:1 against the dark neutral, `ink` is 'dark' (the dark theme uses the light neutral: ChatGPT, Netflix); under 2.2:1 against white, 'light' (the light
 *      theme uses the dark neutral: Spotify). A light logo never lands on a light plate. A tile or disc plate is the icon's own background, so its glyph keeps its
 *      designed contrast.
 *  The sample behind these steps was checked on 30 real sites (docs of Beta 14, item 02). Pure analysis here; the reader and the store below. */
export interface IconPlate {
  /** 'bleed': the plate is a colour the icon carries (`rgb`); 'neutral': Acira's neutral tile surface. */
  kind: 'bleed' | 'neutral';
  /** The plate colour of a bleed plate: 'rgb(r g b)', or the neutral variable for an icon that is itself the plate (`edge`). */
  rgb?: string;
  /** For a neutral plate: which theme needs the other neutral so the mark does not vanish (dark: a dark mark; light: a light one). */
  ink?: 'dark' | 'light' | 'mid';
  /** The icon is a full (rounded) square: drawn smaller on its plate (62% rather than 83%). */
  full?: boolean;
  shape?: 'tile' | 'disc' | 'mark';
  /** A full square with no single background colour: the icon is the plate, edge to edge. */
  edge?: boolean;
}

const bucket = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const lum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const near = (px: ArrayLike<number>, i: number, c: readonly number[], d = 22) => Math.abs(px[i] - c[0]) <= d && Math.abs(px[i + 1] - c[1]) <= d && Math.abs(px[i + 2] - c[2]) <= d;

/** The neutrals a plate can be (mirrored in favorites-stack.css): the plate is fully opaque, so it never lets the one behind show through. */
export const NEUTRAL_PLATE = { light: [255, 255, 255], dark: [56, 57, 63] } as const;
/** The plate colour variable an icon that is itself its plate sits on (favorites-stack.css defines it per theme). */
export const NEUTRAL_VAR = 'var(--sb-plate-neutral)';

/** The dominant colour of some pixels: its share counts every pixel close to it (within 22 per channel), so anti-aliasing and 5-bit bucket edges do not split one flat
 *  colour into several (Spotify's green falls across two buckets; WhatsApp's white field across several). */
function dominant(px: ArrayLike<number>, indexes: readonly number[]) {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of indexes) { const k = bucket(px[i], px[i + 1], px[i + 2]), c = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 }; c.n++; c.r += px[i]; c.g += px[i + 1]; c.b += px[i + 2]; counts.set(k, c); }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return null;
  const rgb = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] as const;
  let close = 0; for (const i of indexes) if (near(px, i, rgb)) close++;
  return { share: close / Math.max(1, indexes.length), rgb };
}

const css = (rgb: readonly number[]) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;

/** Pure: RGBA pixels of the icon drawn `size` x `size` (as a canvas gives them) to the plate it sits on. */
export function analysePlate(px: ArrayLike<number>, size: number): IconPlate {
  const A = (x: number, y: number) => px[(y * size + x) * 4 + 3];
  let x0 = size, y0 = size, x1 = -1, y1 = -1; const ink: number[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = A(x, y);
    if (a > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (a > 200) ink.push((y * size + x) * 4);
  }
  if (x1 < 0 || !ink.length) return { kind: 'neutral', ink: 'mid', shape: 'mark' };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, square = Math.abs(bw - bh) <= size * 0.08;
  let inBox = 0, mid = 0, midSolid = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const opaque = A(x, y) > 200; if (opaque) inBox++;
    if (x >= x0 + bw * 0.22 && x <= x1 - bw * 0.22 && y >= y0 + bh * 0.22 && y <= y1 - bh * 0.22) { mid++; if (opaque) midSolid++; }
  }
  // the band 3px inside the silhouette's edge (a pixel whose 3px neighbourhood reaches a non-opaque pixel or the drawing's edge)
  const opaqueAt = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && A(x, y) > 200;
  const band: number[] = [];
  for (const i of ink) {
    const p = i / 4, x = p % size, y = (p - x) / size; let edge = false;
    for (let d = 1; d <= 3 && !edge; d++) edge = !opaqueAt(x - d, y) || !opaqueAt(x + d, y) || !opaqueAt(x, y - d) || !opaqueAt(x, y + d);
    if (edge) band.push(i);
  }
  if (square && bw >= size * 0.8 && inBox / (bw * bh) >= 0.86 && midSolid / Math.max(1, mid) >= 0.99) {
    // the background is what the four corners agree on (just inside the tile's rounding): a glyph may touch the edge midpoints (WhatsApp's ring does) but rarely all corners
    const patch = (fx: number, fy: number) => {
      const out: number[] = [], s0 = Math.max(1, Math.round(size * 0.06)), px0 = Math.round(x0 + fx * (bw - s0)), py0 = Math.round(y0 + fy * (bh - s0));
      for (let y = py0; y < py0 + s0; y++) for (let x = px0; x < px0 + s0; x++) if (A(x, y) > 200) out.push((y * size + x) * 4);
      return out;
    };
    // each corner is read at two depths: 3% in (square tiles; clear on rounded ones, so skipped) and 10% in (inside a rounded tile's curve)
    const patches = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => [0.03, 0.1].flatMap(f => patch(cx ? 1 - f : f, cy ? 1 - f : f)));
    const corners = dominant(px, patches.flat());
    let bg: readonly number[] | null = null;
    if (corners && corners.share >= 0.5 && patches.filter(idx => idx.some(i => near(px, i, corners.rgb))).length >= 3) bg = corners.rgb;
    if (!bg) { const b = dominant(px, band); if (b && b.share >= 0.5) bg = b.rgb; }
    if (bg) return { kind: 'bleed', shape: 'tile', rgb: css(bg), full: true };
    // no single background (Instagram's gradient, Google Calendar's coloured frame): the icon IS the plate, edge to edge, clipped to the plate's radius; whatever its own
    // rounding leaves uncovered is the neutral surface (a guessed average would show as a coloured rim)
    return { kind: 'bleed', shape: 'tile', rgb: NEUTRAL_VAR, full: true, edge: true };
  }
  if (square && bw >= size * 0.6) {
    const cx = x0 + bw / 2 - 0.5, cy = y0 + bh / 2 - 0.5, R = Math.min(bw, bh) / 2;
    let inside = 0, inSolid = 0, outside = 0, outClear = 0, core = 0, coreHoles = 0; const ring: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / R, a = A(x, y), i = (y * size + x) * 4;
      if (d <= 0.92) { inside++; if (a > 200) inSolid++; }
      if (d >= 1.06) { outside++; if (a <= 40) outClear++; }
      if (d <= 0.85) { core++; if (a <= 200) coreHoles++; }
      if (d >= 0.78 && d <= 0.98 && a > 200) ring.push(i);
    }
    if (inSolid / Math.max(1, inside) >= 0.9 && outClear / Math.max(1, outside) >= 0.9) {
      const rim = dominant(px, ring), cutOut = coreHoles / Math.max(1, core) > 0.04;
      if (rim && rim.share >= 0.6 && !cutOut) return { kind: 'bleed', shape: 'disc', rgb: css(rim.rgb) };
    }
  }
  // contrast is judged where the mark meets the plate: its silhouette's edge band (a black disc with a white glyph reads as black)
  let total = 0; for (const i of band.length ? band : ink) total += lum(px[i], px[i + 1], px[i + 2]);
  const mean = total / (band.length || ink.length), light = lum(...NEUTRAL_PLATE.light), dark = lum(...NEUTRAL_PLATE.dark);
  return { kind: 'neutral', shape: 'mark', ink: contrast(mean, dark) < 2.2 ? 'dark' : contrast(mean, light) < 2.2 ? 'light' : 'mid' };
}

/** The ink a neutral plate needs in a theme: a mark that would vanish on the theme's neutral takes the other one. */
export const plateFlips = (plate: IconPlate | null | undefined, dark: boolean): boolean => !!plate && plate.kind === 'neutral' && (dark ? plate.ink === 'dark' : plate.ink === 'light');

// ---------------------------------------------------------------------------------------------------------------------------------------
// Reading an icon and remembering the answer: in memory per icon; in local storage by the icon's hash alone (not in a private window).
const STORE = 'acira-icon-plates-1', STORE_LIMIT = 300, SIZE = 64;
type Saved = [kind: 0 | 1, rgb: string, ink: 0 | 1 | 2, flags: number];
const FLAGS = { full: 1, edge: 2, tile: 4, disc: 8 };
const memory = new Map<string, IconPlate | null | undefined>(), pending = new Set<string>(), listeners = new Set<() => void>();
let version = 0, stored: Record<string, Saved | 0> | null = null;
const changed = () => { version++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

const pack = (plate: IconPlate): Saved => [plate.kind === 'bleed' ? 1 : 0, plate.rgb ?? '', plate.ink === 'dark' ? 1 : plate.ink === 'light' ? 2 : 0,
  (plate.full ? FLAGS.full : 0) | (plate.edge ? FLAGS.edge : 0) | (plate.shape === 'tile' ? FLAGS.tile : plate.shape === 'disc' ? FLAGS.disc : 0)];
const unpack = (saved: Saved): IconPlate => ({
  kind: saved[0] ? 'bleed' : 'neutral', ...(saved[1] ? { rgb: saved[1] } : {}), ...(saved[0] ? {} : { ink: (['mid', 'dark', 'light'] as const)[saved[2]] ?? 'mid' }),
  ...(saved[3] & FLAGS.full ? { full: true } : {}), ...(saved[3] & FLAGS.edge ? { edge: true } : {}),
  shape: saved[3] & FLAGS.tile ? 'tile' : saved[3] & FLAGS.disc ? 'disc' : 'mark',
});
const valid = (value: unknown): value is Saved => Array.isArray(value) && value.length === 4 && (value[0] === 0 || value[0] === 1) && typeof value[1] === 'string' && value[1].length <= 40 && [0, 1, 2].includes(value[2] as number) && Number.isInteger(value[3]);
function load(): Record<string, Saved | 0> {
  if (stored) return stored;
  try { const parsed = JSON.parse(localStorage.getItem(STORE) || '{}'); stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { stored = {}; }
  return stored!;
}
function save(key: string, plate: IconPlate | null) {
  const all = load(), keys = Object.keys(all);
  if (keys.length >= STORE_LIMIT) for (const old of keys.slice(0, keys.length - STORE_LIMIT + 1)) delete all[old];
  delete all[key]; all[key] = plate ? pack(plate) : 0; // re-inserted last: the newest stay
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* the plate is just worked out again next time */ }
}

function read(src: string): Promise<IconPlate | null | undefined> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(undefined);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(undefined);
        context.drawImage(image, 0, 0, SIZE, SIZE);
        resolve(analysePlate(context.getImageData(0, 0, SIZE, SIZE).data, SIZE));
      } catch { resolve(undefined); } // an icon from another origin taints the canvas: unreadable, so the neutral plate (never a guessed colour)
    };
    image.onerror = () => resolve(undefined);
    image.src = src;
  });
}

/** The plate of one icon: an `IconPlate`, `null` (nothing to read) or `undefined` (not read yet, or unreadable: the caller draws the neutral plate). Starts the read when needed. */
export function iconPlate(src: string | undefined, persist = true): IconPlate | null | undefined {
  if (!src) return null;
  const key = iconKey(src);
  if (memory.has(key)) return memory.get(key);
  if (persist) {
    const saved = load()[key];
    if (saved !== undefined && (saved === 0 || valid(saved))) { const value = saved ? unpack(saved) : null; memory.set(key, value); return value; }
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

/** For a list of icons (`key` names the result): their plates, filled in as the reads finish. Re-renders when one does. */
export function useIconPlates(items: readonly { key: string; src?: string }[], persist = true): Record<string, IconPlate | null | undefined> {
  useSyncExternalStore(subscribe, () => version);
  const out: Record<string, IconPlate | null | undefined> = {};
  for (const { key, src } of items) out[key] = iconPlate(src, persist);
  return out;
}

/** Test seam: forget everything read so far (memory only). */
export function resetIconPlates() { memory.clear(); pending.clear(); stored = null; changed(); }
