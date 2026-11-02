// React adaptation of ProfileImportOption.svelte's dataList capability gating.
// GPL-3.0, imputnet/helium-onboarding 64257c5ea5b04c551305120eef5a495046f4e1fa.
import type {
  ImportCategory,
  ImportSource,
} from "../../services/accounts/setup-types";
export const importLabels: Record<ImportCategory, string> = {
  bookmarks: "Bookmarks and folders",
  history: "Browsing history",
  preferences: "Supported browser preferences",
  extensions: "Extension inventory",
  favorites: "Favorites",
  spaces: "Spaces as tab groups",
};
export function importCapabilities(profile: ImportSource): ImportCategory[] {
  const options: ImportCategory[] = [];
  if (profile.available.bookmarks) options.push("bookmarks");
  if (profile.available.history) options.push("history");
  if (profile.available.preferences) options.push("preferences");
  if (profile.available.extensions) options.push("extensions");
  // Arc: the sidebar's Favorites and each Space's pinned tabs.
  if (profile.available.favorites) options.push("favorites");
  if (profile.available.spaces) options.push("spaces");
  return options;
}
