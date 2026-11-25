// Where the transfer is offered (spec 4.1): the Acira menu, Settings › Import & export and the command palette.
// Pure (no React, no runtime), so the popup's height estimate (src/ui/popup.ts) and the tests can use it.
import type { BrowserSnapshot } from '../../runtime/types';
import type { TransferStatus } from './types';

/** The states of an outgoing session that the entry points show as live: a code is out (or on its way to being used). From `building` the code is not ready yet and from `done` on nothing waits. */
const LIVE_SEND = new Set<string>(['ready', 'confirming', 'sending', 'uploaded']);
/** A send is waiting: the menu row and the Settings row show the small live dot. */
export const sendIsLive = (status: Pick<TransferStatus, 'outgoing'> | null | undefined): boolean => LIVE_SEND.has(status?.outgoing?.state ?? '');

type WindowKind = Pick<BrowserSnapshot, 'browserProfiles' | 'activeBrowserProfileId'> & Partial<Pick<BrowserSnapshot, 'tabs' | 'activeTabId'>>;
/** A private or Tor window cannot read or change the profile's filters (AI-free mode is the profile's `aiContent` filter): main refuses
 * `filters.profile-*` there ("Open a regular profile to change profile filters"), so the interface does not ask. A Tor tab in an ordinary window
 * still can (main's rule is the window's, not the tab's). */
export function profileFiltersBlocked(state: WindowKind | null | undefined): boolean {
  if (!state) return false;
  const profile = state.browserProfiles?.find(item => item.id === state.activeBrowserProfileId);
  return Boolean(!profile || profile.private || profile.tor);
}

/** A private or Tor window moves nothing (main refuses the requests there), so no entry point offers it. Same rule as `isTorWindow` (a Tor tab counts) plus the private profile. */
export function transferBlocked(state: WindowKind | null | undefined): boolean {
  if (!state) return false;
  const profile = state.browserProfiles?.find(item => item.id === state.activeBrowserProfileId);
  return Boolean(profile?.private || profile?.tor || state.tabs?.find(tab => tab.id === state.activeTabId)?.privacy === 'tor');
}
