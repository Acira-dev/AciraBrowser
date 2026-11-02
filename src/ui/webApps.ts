import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import type { BrowserAction, BrowserSnapshot } from '../runtime/types';
import { addSidebarApp, normalizeAppUrl, readSidebarApps, removeSidebarApp, setSidebarAppsHidden } from './sidebarApps';
import { t } from '../i18n';

/** F52 installed web apps (desktop/web-apps.cjs through the native channel). */
export interface WebApp { id: string; profileId: string; name: string; startUrl: string; scope: string; themeColor: string; display: string; kind: 'app' | 'shortcut'; installedAt: string; shortcuts: number; inStart?: boolean; launcher?: 'finder'; icon: string }
export interface WebAppCandidate { id: string; kind: 'app' | 'shortcut'; installable: boolean; name: string; startUrl: string; scope: string; display: string; themeColor: string; installed: boolean }
type Reply = { webApps?: { apps?: WebApp[]; installed?: WebApp; candidate?: WebAppCandidate } };
const EVENT = 'acira-web-apps';

function call(request: Record<string, unknown>): Promise<Reply> {
  const native = (runtime as unknown as { native?: (request: Record<string, unknown>) => Promise<Reply> }).native;
  if (!native) return Promise.reject(new Error('Apps need the desktop app.'));
  return native(request);
}
const reason = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That didn’t work. Try again.';

export const inspectSite = (tabId?: string) => call({ type: 'webapps.inspect', ...(tabId ? { tabId } : {}) }).then(reply => reply.webApps?.candidate ?? null);
export async function listWebApps() { return (await call({ type: 'webapps.list' })).webApps?.apps ?? []; }

/** Install the page in `tabId` (default: the active tab): shortcut in Start and on the desktop, and a Favorite. */
export async function installSiteAsApp(state: BrowserSnapshot, dispatch: (action: BrowserAction) => void, tabId = state.activeTabId) {
  const tab = state.tabs.find(item => item.id === tabId);
  const profile = state.browserProfiles.find(item => item.id === tab?.browserProfileId);
  try {
    const reply = await call({ type: 'webapps.install', tabId });
    const app = reply.webApps?.installed;
    if (!app) throw new Error('That site could not be installed.');
    if (tab && !profile?.private) {
      const url = normalizeAppUrl(app.startUrl);
      if (url && !readSidebarApps(tab.browserProfileId).apps.some(item => item.url === url)) addSidebarApp(tab.browserProfileId, false, { url: app.startUrl, title: app.name, icon: app.icon || undefined });
      setSidebarAppsHidden(tab.browserProfileId, false, false);
    }
    window.dispatchEvent(new Event(EVENT));
    dispatch({ type: 'toast', text: app.launcher==='finder' ? t('local.webAppInstalledFinder',{name:app.name}) : app.inStart ? `Installed ${app.name}. It’s in Start and in Favorites.` : `Installed ${app.name}. It’s in Favorites.` });
    return app;
  } catch (error) { dispatch({ type: 'toast', text: reason(error), tone: 'error' }); return null; }
}

export async function uninstallWebApp(app: WebApp, dispatch: (action: BrowserAction) => void) {
  try {
    await call({ type: 'webapps.uninstall', id: app.id });
    const url = normalizeAppUrl(app.startUrl);
    const pinned = readSidebarApps(app.profileId).apps.find(item => item.url === url);
    if (pinned) removeSidebarApp(app.profileId, false, pinned.id);
    window.dispatchEvent(new Event(EVENT));
    dispatch({ type: 'toast', text: `${app.name} removed` });
  } catch (error) { dispatch({ type: 'toast', text: reason(error), tone: 'error' }); }
}

export function useWebApps() {
  const [apps, setApps] = useState<WebApp[] | null>(null), [error, setError] = useState('');
  const refresh = useCallback(() => { listWebApps().then(next => { setApps(next); setError(''); }, failure => { setApps([]); setError(reason(failure)); }); }, []);
  useEffect(() => { refresh(); window.addEventListener(EVENT, refresh); return () => window.removeEventListener(EVENT, refresh); }, [refresh]);
  return { apps, error, refresh };
}
