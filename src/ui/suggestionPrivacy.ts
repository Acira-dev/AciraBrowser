import type { BrowserProfile, HistoryVisit, TabSession } from '../runtime/types';

/** Which kind of browsing a tab is: an ordinary tab, a private tab (or any tab of a private window), a Tor tab (or any tab
 * of a Tor window) or a tab of a secured workspace. Every suggestion surface asks this before it shows one tab to another.
 *
 * The rules (founder P0, 28 Oct):
 * - An ordinary tab never sees anything from a private, Tor or secured tab: no "Switch to tab" row, no title, no address.
 * - A Tor tab sees nothing from the ordinary profile (Tor Browser's rule): no ordinary tabs, history or bookmarks. It
 *   may switch to another Tor tab, which shares its Tor connection.
 * - A private tab follows Chrome Incognito: it may read the ordinary history, bookmarks and tabs but never writes them
 *   (the reducer skips history for every `tab.privacy`). A secured tab reads the same way. */
export type BrowsingContext = 'normal' | 'private' | 'tor' | 'secured';
type Profiles = { browserProfiles?: Pick<BrowserProfile, 'id' | 'private' | 'tor'>[] };
type Tab = Pick<TabSession, 'browserProfileId'> & { privacy?: TabSession['privacy'] };

export function browsingContextOf(state: Profiles, tab: Tab | undefined): BrowsingContext {
  if (!tab) return 'normal';
  const profile = state.browserProfiles?.find(item => item.id === tab.browserProfileId);
  if (tab.privacy === 'tor' || profile?.tor) return 'tor';
  if (tab.privacy === 'private' || profile?.private) return 'private';
  if (tab.privacy === 'secured') return 'secured';
  return 'normal';
}

/** May a suggestion shown in `from` name the open tab `target` (a "Switch to tab" row, a command-bar tab result)? */
export function tabVisibleFrom(state: Profiles, from: Tab | undefined, target: Tab) {
  const viewer = browsingContextOf(state, from), owner = browsingContextOf(state, target);
  if (owner === 'normal') return viewer !== 'tor';
  return owner === viewer;
}

/** Addresses that can only have come from Tor: never shown outside it, and purged if an older build stored one. */
export function torOnlyUrl(url: string) {
  try { return /\.onion$/i.test(new URL(url).hostname); } catch { return false; }
}

/** A visit that may be kept in (and read from) the ordinary history: never one of a private or Tor profile, never an onion address. */
export function ordinaryVisit(state: Profiles, visit: Pick<HistoryVisit, 'url' | 'browserProfileId'>) {
  if (torOnlyUrl(visit.url)) return false;
  const profile = visit.browserProfileId === undefined ? undefined : state.browserProfiles?.find(item => item.id === visit.browserProfileId);
  return !profile?.private && !profile?.tor;
}

/** The history a tab may read: none in Tor; elsewhere only ordinary visits. */
export function historyVisibleFrom<T extends Pick<HistoryVisit, 'url' | 'browserProfileId'>>(state: Profiles, from: Tab | undefined, history: readonly T[]): T[] {
  if (browsingContextOf(state, from) === 'tor') return [];
  return history.filter(visit => ordinaryVisit(state, visit));
}

/** Bookmarks are the person's own choice, so they stay everywhere except a Tor tab of an ordinary window (they are the
 * ordinary profile's). A Tor window's bookmarks are its own (the Tor vault's) and stay. */
export function bookmarksVisibleFrom(state: Profiles, from: Tab | undefined) {
  if (browsingContextOf(state, from) !== 'tor') return true;
  return Boolean(state.browserProfiles?.find(item => item.id === from?.browserProfileId)?.tor);
}
