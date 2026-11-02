import type { Appearance, BrowserProfile, BrowserSnapshot, SearchEngine, Settings } from './types';
import {effectiveProviders} from './searchProviders';

/**
 * Per-profile settings. Profiles are separate worlds, as in Chrome (founder, 25 Oct), so a profile may keep its own
 * appearance and search engine. Anything a profile hasn't set follows the one setting for all profiles: the global
 * setting is the default, and a profile's own value wins only when set. Blocking is per profile already (content
 * blocking's per-profile policy and J's profile filters), so it isn't repeated here. See docs/launch/PROFILES.md.
 */
export interface ProfileSettings {
  appearance?: Appearance;
  searchEngine?: SearchEngine;
  /** Stable provider ID; takes precedence over the legacy three-engine override. */
  searchProviderId?: string;
}
export type ProfileSettingsPatch = { [Key in keyof ProfileSettings]?: ProfileSettings[Key] | null };

const appearances: readonly Appearance[] = ['light', 'dark', 'system'];
const engines: readonly SearchEngine[] = ['google', 'duckduckgo', 'bing'];

/** Only known keys with valid values survive (stored state, the native boundary). Undefined when nothing is set. */
export function cleanProfileSettings(value: unknown): ProfileSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>, out: ProfileSettings = {};
  if (appearances.includes(input.appearance as Appearance)) out.appearance = input.appearance as Appearance;
  if (engines.includes(input.searchEngine as SearchEngine)) out.searchEngine = input.searchEngine as SearchEngine;
  if (typeof input.searchProviderId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(input.searchProviderId)) out.searchProviderId = input.searchProviderId;
  return Object.keys(out).length ? out : undefined;
}

/** A value sets the profile's own setting; null returns that setting to the one for all profiles. */
export function applyProfileSettings(profile: BrowserProfile, patch: ProfileSettingsPatch): void {
  const next: Record<string, unknown> = { ...profile.settings };
  for (const [key, value] of Object.entries(patch)) {
    if (key !== 'appearance' && key !== 'searchEngine' && key !== 'searchProviderId') continue;
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
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
  const id = own.searchProviderId ?? own.searchEngine;
  const providers = effectiveProviders(settings.searchProviders ?? undefined,settings.searchEngine);
  if (id && providers.engines.some(engine=>engine.id===id)) {
    if (engines.includes(id as SearchEngine)) next.searchEngine = id as SearchEngine;
    if (settings.searchProviders || !engines.includes(id as SearchEngine))
      next.searchProviders = { ...providers, defaultId: id };
  }
  return next;
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
