import type { Settings } from '../runtime/types';

/**
 * Noël, the opt-in Christmas theme: what the person chose, read from the three saved settings (Settings › Appearance › Noël).
 * They are cosmetic preferences: never sent anywhere, and they never change a page. A missing or invalid value reads as its default,
 * so an old profile, a hand-edited save or a transfer from another version never leaves the theme half on.
 *
 * - `noelOn`   the theme is switched on (off by default).
 * - `noelSnow` where the snow falls: 'sidebar' (default), 'window' (over the whole window) or 'off' (no snowfall).
 * - `noelHat`  a flat Santa hat on the profile picture while the theme is on (on by default).
 * - `noelKeepSnowing` the snowfall keeps falling whenever the window can be seen (on by default; the team 24 Nov: "it should be constantly snowing ... people who just
 *   want it to be temporary can make it temporary"); off, it rests after a while without input (2 min, 30 s on battery, desktop/season-overlay.cjs; the sidebar's 10 s).
 */
/** Noël's light: while the theme is on, the site's breathing glow is one still, icy light of this colour (the same kind of light as the still Glow in Your colours). */
export const NOEL_LIGHT = '#a9c6e6';
export type NoelSnow = 'sidebar' | 'window' | 'off';
export const NOEL_SNOW_VALUES: readonly NoelSnow[] = ['sidebar', 'window', 'off'];
export interface NoelPrefs { on: boolean; snow: NoelSnow; hat: boolean; keep: boolean }

export const NOEL_DEFAULTS: Readonly<NoelPrefs> = Object.freeze({ on: false, snow: 'sidebar', hat: true, keep: true });

export function noelPrefs(settings: Pick<Settings, 'noelOn' | 'noelSnow' | 'noelHat' | 'noelKeepSnowing'> | null | undefined): NoelPrefs {
  const on = settings?.noelOn;
  const snow = settings?.noelSnow;
  const hat = settings?.noelHat;
  const keep = settings?.noelKeepSnowing;
  return {
    on: typeof on === 'boolean' ? on : NOEL_DEFAULTS.on,
    snow: NOEL_SNOW_VALUES.includes(snow as NoelSnow) ? snow as NoelSnow : NOEL_DEFAULTS.snow,
    hat: typeof hat === 'boolean' ? hat : NOEL_DEFAULTS.hat,
    keep: typeof keep === 'boolean' ? keep : NOEL_DEFAULTS.keep,
  };
}
