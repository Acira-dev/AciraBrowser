// 13.10: where the interface may ask main for the profile's filters (AI-free mode is the profile's `aiContent` filter).
// Pure (no React, no runtime), so the menu, the toolbar button, Settings and the tests share it.
import type { BrowserSnapshot } from '../runtime/types';

type WindowKind = Pick<BrowserSnapshot, 'browserProfiles' | 'activeBrowserProfileId'>;
/** A private or Tor window cannot read or change the profile's filters: main refuses `filters.profile-*` there ("Open a regular profile to change
 * profile filters"), so the interface does not ask. A state that does not name its window's profile counts as one too (main refuses it as well).
 * A Tor tab in an ordinary window still can: main's rule is the window's, not the tab's. */
export function profileFiltersBlocked(state: WindowKind | null | undefined): boolean {
  if (!state) return false;
  const profile = state.browserProfiles?.find(item => item.id === state.activeBrowserProfileId);
  return Boolean(!profile || profile.private || profile.tor);
}
