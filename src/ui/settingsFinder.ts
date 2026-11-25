import { breadcrumb, settingsRegistry } from '../features/settings/registry';
import { searchSettings } from '../features/settings/search';
import type { BrowserSnapshot } from '../runtime/types';
import type { PaletteSetting } from './paletteResults';
import { translateText } from '../i18n';

/** Beta 14.4: the settings Command search offers for a query: the settings search itself (its synonyms and its languages), two at most, each with
 *  where it lives. Vite-only (the registry collects its entries with import.meta.glob), so the window passes it to CommandPalette. */
export function settingsFinder(state: BrowserSnapshot, desktop: boolean): (query: string) => PaletteSetting[] {
  const profileId = state.tabs.find((item) => item.id === state.activeTabId)?.browserProfileId ?? state.activeBrowserProfileId;
  const privateProfile = Boolean(state.browserProfiles.find((item) => item.id === profileId)?.private);
  const context = { customGlassColors: true, privateProfile, desktop, websiteOpen: true, verticalTabs: state.settings.verticalTabs === true, stockSearch: true };
  return (query) => searchSettings(settingsRegistry, query, context, 2).map((hit) => ({ id: hit.entry.id, title: hit.entry.title, place: breadcrumb(hit.entry).map(translateText).join(' › ') }));
}
