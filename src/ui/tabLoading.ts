import type { TabSession } from '../runtime/types';

/** A tab's row shows the loading dot matrix while its page is loading — the current tab or any other, in the sidebar, the
 * horizontal strip and the compact strip alike — and its site icon again once loading stops. Main reports `loading` for
 * every tab with a page (progress is withheld for tabs off screen, so progress is never the test). A sleeping tab has no
 * page, so it never shows the dots. */
export function tabShowsLoading(tab: Pick<TabSession, 'loading' | 'contentKind' | 'sleeping' | 'error'> & { url?: string }): boolean {
  /* the New Tab's extension page (runtime/newTabPage.ts) is a start page: it never wears the loading dots, as Acira's own New Tab never did */
  return tab.loading && tab.contentKind === 'web' && tab.url !== 'acira://new' && !tab.sleeping && !tab.error;
}
