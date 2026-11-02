import type { TabSession } from './types';

/** What resting the pointer on this tab shows, in one rule for the interface (it hands the tooltip back when there is no
 * card) and for the main process (it decides what to draw and whether to take a picture):
 *  'preview'  the card with a picture of the page, taken when you leave the tab and kept in memory only
 *  'name'     the card without a picture
 *  null       no card: the plain tooltip
 * A private or Tor tab, and every tab of a private window, never gets a picture. A tab with a warning on it (a scam page) or
 * one using the camera, microphone or screen keeps its tooltip, which says so. */
export function tabCardKind(
  settings: { tabHoverCard?: string } | null | undefined,
  tab: Pick<TabSession, 'risk' | 'capturing' | 'privacy' | 'contentKind' | 'sleeping'> | null | undefined,
  privateWindow = false,
): 'preview' | 'name' | null {
  const mode = settings?.tabHoverCard === 'name' || settings?.tabHoverCard === 'off' ? settings.tabHoverCard : 'preview';
  if (mode === 'off' || !tab || tab.risk || tab.capturing?.length) return null;
  return mode === 'name' || tab.privacy || privateWindow || tab.contentKind !== 'web' ? 'name' : 'preview';
}

/** The site line of a card: the host without "www.", or "Acira" for one of its own pages. */
export function tabCardHost(url: string): string {
  try { const parsed = new URL(url); return parsed.protocol === 'acira:' ? 'Acira' : parsed.host.replace(/^www\./, ''); } catch { return ''; }
}
