import type { BrowserAction, BrowserSnapshot, Settings, SystemThemeInfo } from '../runtime/types';
import { scopedSettingAction } from './profileScope';

/** "Match my system theme" is on while its flag is set and Appearance is Auto: choosing Light or Dark anywhere (Settings, the
 * Appearance popup, setup) ends the matching without any of those places knowing about it. */
export const matchesSystemTheme = (settings: Pick<Settings, 'systemTheme' | 'appearance'>): boolean => Boolean(settings.systemTheme) && settings.appearance === 'system';

/** Settings with the desktop's accent handed down, when matching is on and the desktop gave one. The saved settings never hold
 * it (a window on another desktop would otherwise inherit a stale colour). */
export function withSystemAccent<T extends Settings>(settings: T, info: SystemThemeInfo): T {
  return matchesSystemTheme(settings) && info.supported && info.accent ? { ...settings, systemAccent: info.accent } : settings;
}

/** Turning it on follows the desktop's light or dark too (Auto). Turning it off leaves Appearance as it is. */
export function systemThemePatch(on: boolean): Partial<Settings> {
  return on ? { systemTheme: true, appearance: 'system' } : { systemTheme: false };
}

/** What the switch dispatches. Turning it on also sets Appearance to Auto where that applies now: a profile that keeps its own
 * Appearance (Settings "Applies to: This profile") gets Auto there, otherwise it is set for all profiles. The flag is the one
 * setting for all profiles either way. Turning it off leaves Appearance as it is. */
export function systemThemeActions(state: BrowserSnapshot, on: boolean): BrowserAction[] {
  if (!on) return [{ type: 'settings.update', patch: { systemTheme: false } }];
  const own = scopedSettingAction(state, 'appearance', 'system');
  return own ? [own, { type: 'settings.update', patch: { systemTheme: true } }] : [{ type: 'settings.update', patch: systemThemePatch(true) }];
}
