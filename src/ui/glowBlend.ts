/**
 * Colour blending for the selected-tab glow while the selection moves (item 11).
 *
 * The selection already travels from the old tab to the new one (the sidebar's raised card on the strip spring, the top strip's
 * pill on its own spring). The glow travels with it, and when the two tabs' colours differ it blends along the way on the same
 * curve and timing; a tab with no colour is that colour at no strength, so a glow fades in or out instead of snapping.
 */
export type Glow = readonly [number, number, number, number];

/** `#rrggbb` as red, green, blue, 1; anything else is no colour. */
export function parseGlow(color: string | undefined | null): Glow | null {
  const hex = color && /^#([\da-f]{6})$/i.exec(color.trim());
  if (!hex) return null;
  const value = parseInt(hex[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 1];
}

/** No glow at all (alpha 0); its colour channels do not matter until it is paired with a real one (see `pair`). */
export const NO_GLOW: Glow = [0, 0, 0, 0];

/** The two ends of a blend: a missing colour takes the other end's channels at alpha 0, so a glow fades without passing through grey. */
export function pair(from: Glow | null, to: Glow | null): { from: Glow; to: Glow } {
  if (from && to) return { from, to };
  if (from) return { from, to: [from[0], from[1], from[2], 0] };
  if (to) return { from: [to[0], to[1], to[2], 0], to };
  return { from: NO_GLOW, to: NO_GLOW };
}

/** The colour `t` (0..1) of the way from `from` to `to`, channels and alpha straight (a missing end shares the other's channels). */
export function mixGlow(from: Glow, to: Glow, t: number): Glow {
  const k = Math.min(1, Math.max(0, t));
  // A fully transparent end carries no colour of its own: use the other end's channels so the blend never dips toward black.
  const a = from[3] === 0 && to[3] > 0 ? [to[0], to[1], to[2], 0] : from, b = to[3] === 0 && from[3] > 0 ? [from[0], from[1], from[2], 0] : to;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

/** A glow as a CSS colour: `rgb(r g b / a)`. */
export function glowCss(glow: Glow): string {
  return `rgb(${Math.round(glow[0])} ${Math.round(glow[1])} ${Math.round(glow[2])} / ${Math.round(glow[3] * 1000) / 1000})`;
}

/** The two ends of the sidebar card's colour animation, as CSS colours (`#rrggbb` or `#rrggbb00`), or null when neither tab has a colour. */
export function glideColors(from: string | undefined | null, to: string | undefined | null): [string, string] | null {
  const a = parseGlow(from), b = parseGlow(to);
  if (!a && !b) return null;
  const hex = (color: string | undefined | null) => (color ?? '').trim().toLowerCase();
  return [a ? hex(from) : hex(to) + '00', b ? hex(to) : hex(from) + '00'];
}
