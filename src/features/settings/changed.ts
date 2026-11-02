import type { NewTabPreferences } from '../../ui/newTabPreferences';

const defaultModules = { workspace: true, artwork: true, name: false, mark: false, search: true, shortcuts: false, saved: true, recent: true };

/** True when the new-tab layout differs from its defaults; the Reset row only exists then. */
export function newTabChanged(prefs: Pick<NewTabPreferences, 'modules' | 'daily' | 'perTab' | 'hourly' | 'collection' | 'caption' | 'frequent' | 'artStyle' | 'artwork'>, defaultArtwork: string) {
  return (Object.keys(defaultModules) as (keyof typeof defaultModules)[]).some((key) => prefs.modules[key] !== defaultModules[key]) || prefs.daily || prefs.perTab === true || prefs.hourly === true || (prefs.collection ?? 'built-in') !== 'built-in' || prefs.caption === false || prefs.frequent || prefs.artStyle !== 'framed' || prefs.artwork !== defaultArtwork;
}
