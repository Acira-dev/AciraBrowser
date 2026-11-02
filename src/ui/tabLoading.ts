import type { TabSession } from '../runtime/types';

/** A tab's row shows the loading dot matrix while its page is loading — the current tab or any other, in the sidebar, the
 * horizontal strip and the compact strip alike — and its site icon again once loading stops. Main reports `loading` for
 * every tab with a page (progress is withheld for tabs off screen, so progress is never the test). A sleeping tab has no
 * page, so it never shows the dots. */
export function tabShowsLoading(tab: Pick<TabSession, 'loading' | 'contentKind' | 'sleeping' | 'error'>): boolean {
  return tab.loading && tab.contentKind === 'web' && !tab.sleeping && !tab.error;
}
