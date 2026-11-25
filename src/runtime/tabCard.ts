import type { TabSession } from './types';

/** One of Acira's own pages (New tab, Settings, History, ...): its name is all it has to say, and the row shows that already, so it is never given a card
 * (the card's site line used to read "Acira", which told nobody anything: Chrome shows the title alone and Arc and Zen show nothing). */
export const ownPage = (tab: Pick<TabSession, 'contentKind'> & { url?: string } | null | undefined): boolean =>
  Boolean(tab) && (tab!.contentKind !== 'web' || (typeof tab!.url === 'string' && tab!.url.startsWith('acira://')));

/** What resting the pointer on this tab shows, in one rule for the interface (it hands the tooltip back when there is no
 * card) and for the main process (it decides what to draw and whether to take a picture):
 *  'preview'  the card with a picture of the page, taken when you leave the tab and kept in memory only
 *  'name'     the card without a picture
 *  null       no card: the plain tooltip
 * A private or Tor tab, and every tab of a private window, never gets a picture. A tab with a warning on it (a scam page) or
 * one using the camera, microphone or screen keeps its tooltip, which says so, and so does one of Acira's own pages (`ownPage`). */
export function tabCardKind(
  settings: { tabHoverCard?: string } | null | undefined,
  tab: Pick<TabSession, 'risk' | 'capturing' | 'privacy' | 'contentKind' | 'sleeping'> & { url?: string } | null | undefined,
  privateWindow = false,
): 'preview' | 'name' | null {
  const mode = settings?.tabHoverCard === 'name' || settings?.tabHoverCard === 'off' ? settings.tabHoverCard : 'preview';
  if (mode === 'off' || !tab || tab.risk || tab.capturing?.length || ownPage(tab)) return null;
  return mode === 'name' || tab.privacy || privateWindow ? 'name' : 'preview';
}

/** The site line of a card: the host without "www.", or "Acira" for one of its own pages. */
export function tabCardHost(url: string): string {
  try { const parsed = new URL(url); return parsed.protocol === 'acira:' ? 'Acira' : parsed.host.replace(/^www\./, ''); } catch { return ''; }
}
