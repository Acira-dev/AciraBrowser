import type { FrameMaterial, Settings } from './types';

/**
 * Your colours (Beta 14.1, the team's "aura" colour picker): the data rules, pure so a test holds every one.
 *
 * - The colours a person adds with Acira's own picker are kept as swatches beside the 12 finishes (`ownColours`, at most OWN_LIMIT,
 *   six-digit lowercase hex, no repeats, the newest last).
 * - Choosing one is a finish like any other: `colorPreset: OWN_FINISH` with the colour as `browserTint` and `accentColor` (ui/theme.ts
 *   gives an own colour its frame by the fixed-lightness rule, ui/frameField.ts).
 * - With an own colour in use: `frameGradient` (one to three more colours, corner to corner on the frame's one field, 14.3), `frameGlow` (Ambient's
 *   light in those colours, still), `frameMaterial` (glass, matte, glossy). They belong to the profile's look (runtime/profileSettings.ts
 *   LOOK_KEYS), so they move with "This profile", with a profile copy and with the transfer's Look row.
 */
export const OWN_FINISH = 'Own';
export const OWN_LIMIT = 12;
export const GRADIENT_EXTRA = 3;
export const FRAME_MATERIALS: readonly FrameMaterial[] = ['glass', 'matte', 'glossy'];
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);

/** A stored list of colours, cleaned: hex only, lowercase, no repeats, at most `limit` (the last ones kept). Undefined when nothing valid is left. */
export function cleanHexList(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  for (const item of value) if (isHex(item)) { const hex = item.toLowerCase(); seen.delete(hex); seen.add(hex); }
  const list = [...seen].slice(-limit);
  return list.length ? list : undefined;
}
export const cleanMaterial = (value: unknown): FrameMaterial | undefined => FRAME_MATERIALS.includes(value as FrameMaterial) ? value as FrameMaterial : undefined;

/** Is an own colour the finish in use? */
export const isOwnFinish = (s: Pick<Settings, 'colorPreset' | 'browserTint'>): boolean => s.colorPreset === OWN_FINISH && isHex(s.browserTint);

/** The finish patch for one of your colours (Settings, the Appearance popup, the swatch row). */
export const ownFinishPatch = (hex: string): Pick<Settings, 'colorPreset' | 'accentColor' | 'browserTint'> => ({ colorPreset: OWN_FINISH, accentColor: hex.toLowerCase(), browserTint: hex.toLowerCase() });

/** Add a colour to the swatches (the picker's "Add colour"): it goes last; already there, it moves last; past the limit the oldest goes. */
export function addOwnColour(list: readonly string[] | undefined, hex: string): string[] {
  return cleanHexList([...(list ?? []), hex], OWN_LIMIT) ?? [];
}
/** Remove a swatch. If it was the colour in use, the finish goes back to the default (Porcelain): the caller applies `fallback`. Its place in a
 *  gradient goes too. */
export function removeOwnColour(s: Pick<Settings, 'ownColours' | 'frameGradient' | 'colorPreset' | 'browserTint'>, hex: string): Partial<Settings> & { inUse: boolean } {
  const gone = hex.toLowerCase(), keep = (s.ownColours ?? []).filter(item => item.toLowerCase() !== gone);
  const gradient = (s.frameGradient ?? []).filter(item => item.toLowerCase() !== gone);
  return { ownColours: keep, frameGradient: gradient, inUse: isOwnFinish(s) && (s.browserTint ?? '').toLowerCase() === gone };
}

/** The frame's colours in order, top to bottom: the own colour in use, then the gradient's (none when the finish is not an own colour). */
export function frameColours(s: Pick<Settings, 'colorPreset' | 'browserTint' | 'frameGradient'>): string[] {
  if (!isOwnFinish(s)) return [];
  const main = s.browserTint.toLowerCase();
  const extra: string[] = [];
  for (const item of Array.isArray(s.frameGradient) ? s.frameGradient : []) { if (!isHex(item)) continue; const hex = item.toLowerCase(); if (hex !== main && !extra.includes(hex)) extra.push(hex); }
  return [main, ...extra.slice(0, GRADIENT_EXTRA)];
}
/** The frame's material: only an own colour has one (every other finish is Glass, as today). */
export const frameMaterialOf = (s: Pick<Settings, 'colorPreset' | 'browserTint' | 'frameMaterial'>): FrameMaterial => isOwnFinish(s) ? cleanMaterial(s.frameMaterial) ?? 'glass' : 'glass';
/** Is the still glow in the own colours on? */
export const frameGlowOn = (s: Pick<Settings, 'colorPreset' | 'browserTint' | 'frameGlow'>): boolean => isOwnFinish(s) && s.frameGlow === true;
