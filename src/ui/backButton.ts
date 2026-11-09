import type { TabSession } from '../runtime/types';

/** The toolbar's Back button is off when there is nowhere to go back to. A website tab can go back when its page can, when an Acira page is behind it,
 *  or when it shows an error page with an earlier page behind it: the address that failed never joined the page's own history (so the page itself
 *  says it cannot go back), yet Back returns to the page the person came from, which is what the error page's own "Go back" button offers. */
export function webBackDisabled(tab: Pick<TabSession, 'canGoBack' | 'history' | 'historyIndex' | 'error'>): boolean {
  if (tab.canGoBack) return false;
  if (tab.history.slice(0, tab.historyIndex).some(url => url.startsWith('acira://'))) return false;
  return !(tab.error && tab.historyIndex > 0);
}

/** The toolbar's Forward button is off at the last entry of the tab's list. A failed address shows its error page while the page itself still sits on the entry
 *  before it, so the page may report a "forward" that is the very error page on screen: there Forward does nothing, and it is off. */
export function webForwardDisabled(tab: Pick<TabSession, 'canGoForward' | 'history' | 'historyIndex' | 'error'>): boolean {
  if (tab.historyIndex < tab.history.length - 1) return false;
  return !tab.canGoForward || !!tab.error;
}
