import type { Appearance, BrowserProfile, BrowserSnapshot, SearchEngine, Settings } from './types';
import {effectiveProviders} from './searchProviders';

/**
 * Per-profile settings. Profiles are separate worlds, as in Chrome (founder, 25 Oct), so a profile may keep its own
 * appearance and search engine. Anything a profile hasn't set follows the one setting for all profiles: the global
 * setting is the default, and a profile's own value wins only when set. Blocking is per profile already (content
 * blocking's per-profile policy and J's profile filters), so it isn't repeated here. See docs/launch/PROFILES.md.
 *
 * Settings › Appearance › "Applies to" has one switch for the profile's whole look: its Light / Dark / Auto, its Finish
 * and its custom window colours (13.6). A profile on "This profile" has `appearance` AND `look`; "All profiles" drops both.
 */
/** A profile's own colours: the Finish and the custom window colours, kept as one block. A colour left out of the block
 *  is not set (the profile follows its Finish), so the block never mixes with the shared colours. */
export interface ProfileLook {
  colorPreset: string;
  accentColor: string;
  browserTint: string;
  surfaceColor?: string;
  sidebarColor?: string;
  toolbarColor?: string;
  tabColor?: string;
}
export interface ProfileSettings {
  appearance?: Appearance;
  /** The profile's own Finish and custom colours. Present exactly when `appearance` is (core.ts fills it in; takeProfileLook routes changes to it). */
  look?: ProfileLook;
  searchEngine?: SearchEngine;
  /** Stable provider ID; takes precedence over the legacy three-engine override. */
  searchProviderId?: string;
}
export type ProfileSettingsPatch = { [Key in keyof ProfileSettings]?: ProfileSettings[Key] | null };

const appearances: readonly Appearance[] = ['light', 'dark', 'system'];
const engines: readonly SearchEngine[] = ['google', 'duckduckgo', 'bing'];
const hex = /^#[0-9a-f]{6}$/i;
/** The settings a profile's look owns. A change to any of these goes to the profile's `look` while the profile is on
 *  "This profile" (core.ts routes settings.update), and to the settings for all profiles otherwise. */
export const LOOK_KEYS = ['colorPreset', 'accentColor', 'browserTint', 'surfaceColor', 'sidebarColor', 'toolbarColor', 'tabColor'] as const;
const CUSTOM_COLOR_KEYS = ['surfaceColor', 'sidebarColor', 'toolbarColor', 'tabColor'] as const;

/** The look of some settings (the shared ones, or what a window shows): what a profile starts with when it takes its own. */
export function lookOf(settings: Pick<Settings, 'colorPreset' | 'accentColor' | 'browserTint'> & Partial<Pick<Settings, 'surfaceColor' | 'sidebarColor' | 'toolbarColor' | 'tabColor'>>): ProfileLook {
  const look: ProfileLook = { colorPreset: settings.colorPreset, accentColor: settings.accentColor, browserTint: settings.browserTint };
  for (const key of CUSTOM_COLOR_KEYS) if (hex.test(settings[key] || '')) look[key] = settings[key];
  return look;
}

/** A stored look, or undefined when it is not whole: a Finish needs its name and both colours; a custom colour that is
 *  not six-digit hex is dropped (as restoreSnapshot drops it from the shared settings). */
export function cleanLook(value: unknown): ProfileLook | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.colorPreset !== 'string' || !input.colorPreset || input.colorPreset.length > 160) return undefined;
  if (typeof input.accentColor !== 'string' || !hex.test(input.accentColor) || typeof input.browserTint !== 'string' || !hex.test(input.browserTint)) return undefined;
  return lookOf(input as unknown as ProfileLook);
}

/** Only known keys with valid values survive (stored state, the native boundary). Undefined when nothing is set. */
export function cleanProfileSettings(value: unknown): ProfileSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>, out: ProfileSettings = {};
  if (appearances.includes(input.appearance as Appearance)) out.appearance = input.appearance as Appearance;
  const look = cleanLook(input.look);
  if (look && out.appearance) out.look = look; // a look without its Light / Dark / Auto is not a profile's own
  if (engines.includes(input.searchEngine as SearchEngine)) out.searchEngine = input.searchEngine as SearchEngine;
  if (typeof input.searchProviderId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(input.searchProviderId)) out.searchProviderId = input.searchProviderId;
  return Object.keys(out).length ? out : undefined;
}

/** A value sets the profile's own setting; null returns that setting to the one for all profiles. */
export function applyProfileSettings(profile: BrowserProfile, patch: ProfileSettingsPatch): void {
  const next: Record<string, unknown> = { ...profile.settings };
  for (const [key, value] of Object.entries(patch)) {
    if (key !== 'appearance' && key !== 'look' && key !== 'searchEngine' && key !== 'searchProviderId') continue;
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  if (Object.hasOwn(patch, 'appearance') && patch.appearance === null) delete next.look; // All profiles: the whole look goes back
  if (Object.hasOwn(patch,'searchProviderId')) delete next.searchEngine;
  const clean = cleanProfileSettings(next);
  if (clean) profile.settings = clean;
  else delete profile.settings;
}

/** The settings a profile sees: the global ones with the profile's own values on top. A profile's search engine also
 *  becomes the default of a custom engine list while that engine remains available. A removed engine must not
 *  invalidate the saved list and send searches to an unrelated stock provider. */
export function effectiveSettings(settings: Settings, own?: ProfileSettings): Settings {
  if (!own) return settings;
  const next = { ...settings };
  if (own.appearance) next.appearance = own.appearance;
  if (own.look) {
    next.colorPreset = own.look.colorPreset;
    next.accentColor = own.look.accentColor;
    next.browserTint = own.look.browserTint;
    // a colour the profile did not set is not set: the shared custom colours never show through
    for (const key of CUSTOM_COLOR_KEYS) if (own.look[key]) next[key] = own.look[key]; else delete next[key];
  }
  const id = own.searchProviderId ?? own.searchEngine;
  const providers = effectiveProviders(settings.searchProviders ?? undefined,settings.searchEngine);
  if (id && providers.engines.some(engine=>engine.id===id)) {
    if (engines.includes(id as SearchEngine)) next.searchEngine = id as SearchEngine;
    if (settings.searchProviders || !engines.includes(id as SearchEngine))
      next.searchProviders = { ...providers, defaultId: id };
  }
  return next;
}

/** A settings.update made in a window whose profile is on "This profile" (it has its own `appearance` and `look`): Light /
 *  Dark / Auto, the Finish and the custom window colours belong to that profile, so they are taken out of the patch and
 *  returned as the profile's own patch; everything else stays a setting for all profiles. Anything else (all profiles, a
 *  private window, a patch with none of these keys) comes back untouched, so every place that sets a colour (Settings, the
 *  Appearance popup, setup) behaves the same without knowing about profiles. */
export function takeProfileLook(profile: BrowserProfile | undefined, shared: Settings, patch: Partial<Settings>): { rest: Partial<Settings>; own?: ProfileSettingsPatch } {
  if (!profile || profile.private || !profile.settings?.appearance) return { rest: patch };
  const touched = (['appearance', ...LOOK_KEYS] as const).filter((key) => Object.hasOwn(patch, key));
  if (!touched.length) return { rest: patch };
  const rest = { ...patch }, own: ProfileSettingsPatch = {};
  for (const key of touched) delete (rest as Record<string, unknown>)[key];
  if (patch.appearance && appearances.includes(patch.appearance)) own.appearance = patch.appearance;
  if (LOOK_KEYS.some((key) => Object.hasOwn(patch, key))) {
    const look: Record<string, unknown> = { ...(profile.settings.look ?? lookOf(shared)) };
    for (const key of LOOK_KEYS) {
      if (!Object.hasOwn(patch, key)) continue;
      const value = patch[key];
      if ((CUSTOM_COLOR_KEYS as readonly string[]).includes(key)) { if (typeof value === 'string' && hex.test(value)) look[key] = value; else delete look[key]; }
      else if (key === 'colorPreset' ? typeof value === 'string' && value && value.length <= 160 : typeof value === 'string' && hex.test(value)) look[key] = value;
    }
    own.look = look as unknown as ProfileLook;
  }
  return { rest, own };
}

/** Canonical search ownership also recognizes profiles saved before provider IDs were introduced. */
export const profileHasSetting = (own:ProfileSettings|undefined,key:keyof ProfileSettings) => key==='searchProviderId'
  ? own?.searchProviderId!==undefined||own?.searchEngine!==undefined : own?.[key]!==undefined;
export const profileSettingPatch = (key:keyof ProfileSettings,value:string|null):ProfileSettingsPatch => key==='searchProviderId'
  ? {searchProviderId:value,searchEngine:null} : {[key]:value} as ProfileSettingsPatch;

/** Settings as `profileId` (by default the window's profile) sees them. Private windows follow the global settings. */
export function settingsFor(state: Pick<BrowserSnapshot, 'settings' | 'browserProfiles' | 'activeBrowserProfileId'>, profileId = state.activeBrowserProfileId): Settings {
  const profile = state.browserProfiles.find((item) => item.id === profileId);
  return profile && !profile.private ? effectiveSettings(state.settings, profile.settings) : state.settings;
}

/** A window's snapshot with its profile's own settings applied: what the renderer is sent (main's snapshotFor). */
export function snapshotForProfile<T extends Pick<BrowserSnapshot, 'settings' | 'browserProfiles' | 'activeBrowserProfileId'>>(state: T): T {
  const settings = settingsFor(state);
  return settings === state.settings ? state : { ...state, settings };
}
