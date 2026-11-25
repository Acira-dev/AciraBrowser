import { useEffect, useState } from 'react';
import { runtime } from '../../runtime/client';
import type { BrowserCommand, SiteNotificationsList } from '../../runtime/types';

/** 14.3: this window's website notifications (desktop/site-notifications.cjs, memory only in main). Main sends the whole list on every change; the
 *  popup, a page of its own, also asks once when it opens. One subscription per page, shared by every caller. */
const EMPTY: SiteNotificationsList = { entries: [], muted: [], unread: 0, holds: false };
let latest: SiteNotificationsList = EMPTY, subscribed = false;
const listeners = new Set<(list: SiteNotificationsList) => void>();
const publish = (list: SiteNotificationsList) => { latest = list; for (const listen of listeners) listen(list); };
const isList = (value: unknown): value is SiteNotificationsList => !!value && typeof value === 'object' && Array.isArray((value as SiteNotificationsList).entries);
function subscribe() {
  if (subscribed) return; subscribed = true;
  // main's 'site-notifications' event (desktop/main.cjs siteNotificationsChanged): not one of the state events the reducer reads, so it is told apart here
  runtime.subscribeBrowser(event => { const value = event as unknown as { type?: string } & Partial<SiteNotificationsList>; if (value.type === 'site-notifications' && isList(value)) { const { type: _type, ...list } = value as { type: string } & SiteNotificationsList; publish(list); } });
}

export type SiteNotesAction = Extract<BrowserCommand, { type: 'site-notifications' }>['action'];
/** Ask main to act on this window's list (list, read, open / dismiss / mute a row, clear, unmute a site); its answer is the list. */
export function siteNotesCommand(tabId: string, action: SiteNotesAction, extra: { id?: string; url?: string } = {}): Promise<void> {
  subscribe();
  return (runtime.browserCommand({ type: 'site-notifications', tabId, action, ...extra }) as unknown as Promise<unknown>).then(answer => { if (isList(answer)) publish(answer); }, () => undefined);
}

/** The list as it is now. `ask` (the popup): ask main for it once on mount. */
export function useSiteNotifications(tabId?: string, ask = false): SiteNotificationsList {
  subscribe();
  const [list, setList] = useState(latest);
  useEffect(() => { listeners.add(setList); setList(latest); if (ask && tabId) void siteNotesCommand(tabId, 'list'); return () => { listeners.delete(setList); }; }, [tabId, ask]);
  return list;
}
