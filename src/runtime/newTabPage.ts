import type { TabSession } from './types';

/** The New Tab's address. */
export const NEW_TAB_URL = 'acira://new';

/**
 * An extension's page shown as the New Tab (Settings > Extensions > "Use as New Tab page"): it loads in the tab's own page view, so the tab is a
 * "web" tab, but its address stays the New Tab's and it is not a website (desktop/browser-services/extension-new-tab.cjs).
 */
export const isNewTabPage = (tab: Pick<TabSession, 'contentKind' | 'url'>): boolean => tab.contentKind === 'web' && tab.url === NEW_TAB_URL;

/** A real website: what Shields, certificates, site information, Reader, Favorites, Split view and "Copy page address" are about. */
export const isWebsite = (tab: Pick<TabSession, 'contentKind' | 'url'>): boolean => tab.contentKind === 'web' && tab.url !== NEW_TAB_URL;
