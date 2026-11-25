/* Beta 14: the toast's frosted glass. the reference design's sample draws it as ONE picture of what is under the toast, blurred once (blur 32px, saturated, dimmed or brightened), that
 * lies under every card and is shifted so it stays fixed to the window while the card moves (the reference sample: code/rig/tglass.js). The pixels here are the pop-up
 * system's own frozen snapshot (desktop/popup-snapshot.cjs, the host already holds it as `frozen` canvases), so nothing new is captured, kept, or filtered per frame: the filter runs once
 * per snapshot and the cards' backgrounds move only while a card moves (the follower below stops when nothing has moved). */
import type { Rectangle } from '../runtime/types';

/** His two frost recipes: the filter on the picture, and the tint, base, inner light and rim under and over it. Dark first. */
export const FROST = {
  dark: { filter: 'blur(32px) saturate(2.4) brightness(.64)', tint: '16 18 28', alpha: .32, base: '22 23 27', solid: '#1c1d22' },
  light: { filter: 'blur(32px) saturate(1.9) brightness(1.06)', tint: '250 250 252', alpha: .36, base: '240 240 243', solid: '#f7f7f9' },
} as const;

/** The glass slider moves the tint (his rule): `(g - 64) x .009` on his alpha, kept between .2 and .9. At 0 and 100 the surface is solid, never see-through. */
export const frostAlpha = (dark: boolean, glass: number): number => Math.min(.9, Math.max(.2, FROST[dark ? 'dark' : 'light'].alpha + (glass - 64) * .009));
export const frostIsSolid = (glass: number): boolean => !(glass > 0 && glass < 100);

export interface FrostFrame { canvas: CanvasImageSource; bounds: Rectangle }
export interface Frost { url: string; width: number; height: number; /** the window position of the picture's top-left corner, CSS px */ x: number; y: number; release(): void }

/** Pixels beyond the snapshot (a taller stack when the cards spread, a wider card) are the nearest edge's: the blur then has something to average, not the transparent edge of the canvas.
 * Beyond the WINDOW there is nothing: there the picture stays transparent and the blur fades to the edge, as the sample's whole-window picture does. */
const REACH = 100;

/** One blurred picture of the pixels under the toasts. `frames` are the snapshot's frames, bottom to top, each at its window bounds (CSS px). Returns null when there is nothing to draw. */
export function buildFrost(frames: FrostFrame[], dark: boolean, win: Rectangle | null = null, make: (width: number, height: number) => HTMLCanvasElement | null = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }): Frost | null {
  const live = frames.filter(frame => frame.bounds.width > 0 && frame.bounds.height > 0);
  if (!live.length) return null;
  const left = Math.min(...live.map(frame => frame.bounds.x)), top = Math.min(...live.map(frame => frame.bounds.y));
  const width = Math.ceil(Math.max(...live.map(frame => frame.bounds.x + frame.bounds.width)) - left), height = Math.ceil(Math.max(...live.map(frame => frame.bounds.y + frame.bounds.height)) - top);
  if (width < 1 || height < 1 || width * height > 4_000_000) return null;
  const base = make(width, height), padded = make(width + REACH * 2, height + REACH * 2), out = make(width, height);
  const baseContext = base?.getContext('2d'), paddedContext = padded?.getContext('2d'), outContext = out?.getContext('2d');
  if (!base || !padded || !out || !baseContext || !paddedContext || !outContext) return null;
  for (const frame of live) baseContext.drawImage(frame.canvas, frame.bounds.x - left, frame.bounds.y - top, frame.bounds.width, frame.bounds.height);
  // the picture in the middle; on each side that is NOT the window's edge, its edge row or column stretched outwards (corners with the corner pixel)
  const edge = (value: number, limit: number | undefined, inside: boolean) => limit === undefined || (inside ? value > limit + .5 : value < limit - .5);
  const openLeft = edge(left, win?.x, true), openTop = edge(top, win?.y, true), openRight = edge(left + width, win ? win.x + win.width : undefined, false), openBottom = edge(top + height, win ? win.y + win.height : undefined, false);
  paddedContext.drawImage(base, REACH, REACH);
  if (openLeft) paddedContext.drawImage(base, 0, 0, 1, height, 0, REACH, REACH, height);
  if (openRight) paddedContext.drawImage(base, width - 1, 0, 1, height, REACH + width, REACH, REACH, height);
  if (openTop) paddedContext.drawImage(base, 0, 0, width, 1, REACH, 0, width, REACH);
  if (openBottom) paddedContext.drawImage(base, 0, height - 1, width, 1, REACH, REACH + height, width, REACH);
  if (openLeft && openTop) paddedContext.drawImage(base, 0, 0, 1, 1, 0, 0, REACH, REACH);
  if (openRight && openTop) paddedContext.drawImage(base, width - 1, 0, 1, 1, REACH + width, 0, REACH, REACH);
  if (openLeft && openBottom) paddedContext.drawImage(base, 0, height - 1, 1, 1, 0, REACH + height, REACH, REACH);
  if (openRight && openBottom) paddedContext.drawImage(base, width - 1, height - 1, 1, 1, REACH + width, REACH + height, REACH, REACH);
  outContext.filter = FROST[dark ? 'dark' : 'light'].filter;
  outContext.drawImage(padded, -REACH, -REACH);
  return { url: out.toDataURL('image/jpeg', .92), width, height, x: left, y: top, release() { /* a data URL holds no resource to give back */ } };
}

/** Where a card's background picture must sit so the picture stays fixed to the window. The card's window position is the surface's window position plus the card's offset inside it. The offset is
 * the sample's own: minus the card's window position divided by the card's scale (a card behind the front one is drawn smaller, and its picture scales with it), then moved by the picture's own corner,
 * because the sample's picture is the whole window and this one is the part of it under the toasts. For a card at full size (scale 1) this is exactly "the picture stays fixed to the window". */
export const frostOffset = (card: { x: number; y: number }, surface: { x: number; y: number }, popup: { x: number; y: number }, frost: { x: number; y: number }, scale = 1) =>
  ({ x: -(popup.x + (card.x - surface.x)) / scale + frost.x, y: -(popup.y + (card.y - surface.y)) / scale + frost.y });

/** Follows the cards while they move (an entrance, an exit, the stack shifting or spreading) and writes each card's picture offset; stops by itself once nothing has moved for a few
 * frames, so the surface costs nothing at rest. `read` gives the cards and the two window positions; `kick` restarts it (called on any change of the cards' style or children). */
export function createFollower(read: () => { cards: HTMLElement[]; surface: { x: number; y: number }; popup: { x: number; y: number }; frost: { x: number; y: number } } | null, schedule: (cb: () => void) => number = cb => requestAnimationFrame(cb), cancel: (id: number) => void = id => cancelAnimationFrame(id), quiet = 12) {
  let handle = 0, still = 0; const last = new WeakMap<HTMLElement, string>();
  const frame = () => {
    handle = 0;
    const scene = read(); if (!scene) return;
    let moved = false;
    for (const card of scene.cards) {
      const box = card.getBoundingClientRect(), sx = card.offsetWidth ? box.width / card.offsetWidth || 1 : 1, offset = frostOffset({ x: box.x, y: box.y }, scene.surface, scene.popup, scene.frost, sx), key = offset.x.toFixed(2) + ',' + offset.y.toFixed(2);
      if (last.get(card) !== key) { last.set(card, key); card.style.setProperty('--tf-x', offset.x.toFixed(2) + 'px'); card.style.setProperty('--tf-y', offset.y.toFixed(2) + 'px'); moved = true; }
    }
    still = moved ? 0 : still + 1;
    if (still < quiet) handle = schedule(frame);
  };
  return { kick() { still = 0; if (!handle) handle = schedule(frame); }, stop() { if (handle) cancel(handle); handle = 0; }, running: () => handle !== 0 };
}
