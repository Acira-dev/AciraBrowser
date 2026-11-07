import type { BrowserAction, TabSession } from '../runtime/types';
import { favoriteTabOf } from '../runtime/favoriteTabs';
import { addSidebarApp, appHost, moveSidebarApp, normalizeAppUrl, readSidebarApps, SIDEBAR_APPS_MAX, setSidebarAppsHidden, updateSidebarApp, type SidebarApp } from './sidebarApps';
import { t } from '../i18n';

/** One way to make a favorite (founder, 6 Nov: dragging a tab up gave the good tile, the other ways gave something else). Dragging a
 *  tab up, Cmd+Shift+D and its command, the tab menu's "Add to Favorites", the "+" form, a dropped link, an import, the new-tab
 *  shortcuts and a web-app install all come through here, so they decide the same things the same way:
 *   - the address (normalised) and the name (the tab's own name as the list shows it, else what the caller knows);
 *   - the icon: a local image only, the tab's own, else an open tab of the same site's (never fetched);
 *   - a second copy: an address that is already a favorite never makes a second tile;
 *   - the tab in hand: the favorite is linked to it (the tile shows it and goes to it) and it stays in the tab list exactly where it is, with its
 *     group and its place, unless the favorite is already linked to another tab.
 *  `planFavorite` decides and writes nothing; `addFavorite` writes. Pure over the stores it reads, so it is tested without a window. */
export type FavoriteTab = Pick<TabSession, 'id' | 'url' | 'title' | 'favicon' | 'browserProfileId' | 'contentKind'> & Partial<Pick<TabSession, 'customTitle' | 'favoriteId' | 'privacy'>>;

export type FavoritePlan =
  | { kind: 'refuse'; message: string }
  | { kind: 'add'; url: string; title: string; icon?: string; adopt?: string }
  | { kind: 'exists'; app: SidebarApp; adopt?: string; icon?: string };

export interface FavoriteInput {
  profileId: string;
  privateMode: boolean;
  url: string;
  title?: string;
  icon?: string;
  /** The tab this favorite is made from (drag, shortcut, menu, "+" form on the current page): the favorite is linked to it. */
  tab?: FavoriteTab;
  /** Every tab of the window (the workspace on screen and the others): to find the favorite's own tab and an open tab's icon. */
  tabs?: readonly FavoriteTab[];
  /** Where in the grid it goes (a drop); the end when left out. */
  index?: number;
  /** A gesture the person made: Favorites that were switched off come back on. An import or a seed leaves that switch alone. */
  reveal?: boolean;
}

/** The name a tab has in the sidebar's list: its own name if it was renamed, else the page's. */
export const favoriteTabTitle = (tab: Pick<FavoriteTab, 'title' | 'customTitle'>) => (tab.customTitle?.trim() || tab.title || '').trim();

const isLocalIcon = (icon: unknown): icon is string => typeof icon === 'string' && /^data:image\//i.test(icon);

/** An open tab's icon for an address: the same page first, then any page of the same site, in this profile, never a private or Tor tab's. */
export function openTabIcon(url: string, tabs: readonly FavoriteTab[], profileId: string): string | undefined {
  const host = appHost(url), mine = tabs.filter(tab => tab.browserProfileId === profileId && !tab.privacy && isLocalIcon(tab.favicon));
  const same = mine.find(tab => normalizeAppUrl(tab.url) === url) ?? mine.find(tab => host && appHost(tab.url) === host);
  return same?.favicon;
}

export function planFavorite(input: FavoriteInput): FavoritePlan {
  const url = normalizeAppUrl(input.url);
  if (!url) return { kind: 'refuse', message: 'Enter a web address, like example.com.' };
  const { apps } = readSidebarApps(input.profileId, input.privateMode), tabs = input.tabs ?? (input.tab ? [input.tab] : []);
  const icon = [input.icon, input.tab?.favicon].find(isLocalIcon) ?? openTabIcon(url, tabs, input.profileId);
  const existing = apps.find(app => app.url === url);
  if (existing) {
    const owner = favoriteTabOf(tabs as readonly FavoriteTab[], existing.id, input.profileId);
    // An existing favorite without a tab of its own takes the tab in hand; one that has its own keeps it.
    return { kind: 'exists', app: existing, ...(input.tab && !owner && input.tab.favoriteId !== existing.id ? { adopt: input.tab.id } : {}), ...(!existing.icon && icon ? { icon } : {}) };
  }
  if (apps.length >= SIDEBAR_APPS_MAX) return { kind: 'refuse', message: `Up to ${SIDEBAR_APPS_MAX} favorites.` };
  const title = (input.title?.trim() || (input.tab ? favoriteTabTitle(input.tab) : '')).slice(0, 80);
  return { kind: 'add', url, title, ...(icon ? { icon } : {}), ...(input.tab ? { adopt: input.tab.id } : {}) };
}

export interface FavoriteResult { plan: FavoritePlan; app?: SidebarApp; /** The tab the favorite is now linked to: the caller sends `tab.favorite` for it. */ adopt?: string; added: boolean }

export function addFavorite(input: FavoriteInput): FavoriteResult {
  const plan = planFavorite(input);
  if (plan.kind === 'refuse') return { plan, added: false };
  let app: SidebarApp | undefined, added = false;
  if (plan.kind === 'exists') {
    app = plan.app;
    if (plan.icon) updateSidebarApp(input.profileId, input.privateMode, app.id, { icon: plan.icon });
    if (input.index !== undefined) moveSidebarApp(input.profileId, input.privateMode, app.id, input.index);
  } else {
    const made = addSidebarApp(input.profileId, input.privateMode, { url: plan.url, title: plan.title, icon: plan.icon });
    if (typeof made === 'string') return { plan: { kind: 'refuse', message: made }, added: false };
    app = made; added = true;
    if (input.index !== undefined) moveSidebarApp(input.profileId, input.privateMode, app.id, input.index);
  }
  if (input.reveal && readSidebarApps(input.profileId, input.privateMode).hidden) setSidebarAppsHidden(input.profileId, input.privateMode, false);
  return { plan, app, added, ...(plan.adopt ? { adopt: plan.adopt } : {}) };
}

/** What a way of adding says when it says anything (the keyboard, the menu and a dropped link do; a drag shows itself). */
export function favoriteToast(result: FavoriteResult, existingToo = true): BrowserAction | null {
  if (result.plan.kind === 'refuse') return { type: 'toast', text: result.plan.message, tone: 'error' };
  if (!result.app) return null;
  if (result.added) return { type: 'toast', text: t('acirasidebar.titleAddedToFavorites', { title: result.app.title }) };
  return existingToo ? { type: 'toast', text: t('acirasidebar.titleIsAlreadyInFavorites', { title: result.app.title }) } : null;
}

/** A favorite that was made without an icon (an import, a dropped link, the old new-tab shortcuts, a typed address) takes the first
 *  local one the browser knows: its own tab's, an open tab of the same site's, or the icon store's (kept on this computer while you
 *  were on the site). Saved into the favorite, so it is the same tile a dragged tab makes and stays when the tab is closed. */
export function iconsToBackfill(apps: readonly SidebarApp[], tabs: readonly FavoriteTab[], profileId: string, stored: (url: string) => string | undefined): { id: string; icon: string }[] {
  const found: { id: string; icon: string }[] = [];
  for (const app of apps) {
    if (app.icon || app.url.startsWith('acira://')) continue;
    const own = favoriteTabOf(tabs, app.id, profileId), icon = (own && appHost(own.url) === appHost(app.url) && isLocalIcon(own.favicon) ? own.favicon : undefined) ?? openTabIcon(app.url, tabs, profileId) ?? (() => { const kept = stored(app.url); return isLocalIcon(kept) ? kept : undefined; })();
    if (icon) found.push({ id: app.id, icon });
  }
  return found;
}
