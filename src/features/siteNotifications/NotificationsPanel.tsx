import { useEffect } from 'react';
import type { BrowserAction, BrowserSnapshot, SiteNotificationRow } from '../../runtime/types';
import { MenuToggle } from '../../components/MenuToggle';
import { ActionRow } from '../../components/PanelParts';
import { SiteIcon } from '../rewind/SiteIcon';
import { t, useT } from '../../i18n';
import { ago } from './ago';
import { siteNotesCommand, useSiteNotifications } from './useSiteNotifications';
import './site-notifications.css';

/** The bell's glyph (Downloads' and Extensions' line weight), and with a stroke through it for Silent. */
export function BellIcon({ size = 16, off = false }: { size?: number; off?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={off ? 'M4.2 11.2V7.3a3.8 3.8 0 0 1 6.1-3M11.8 7.3v3.9l1.1 1.3H5.4 M6.6 13.9a1.5 1.5 0 0 0 2.8 0 M2.6 2.6l10.8 10.8' : 'M4.2 11.2V7.3a3.8 3.8 0 0 1 7.6 0v3.9l1.1 1.3H3.1Z M6.6 13.9a1.5 1.5 0 0 0 2.8 0'}/>
  </svg>;
}
const SilentIcon = ({ size }: { size?: number }) => <BellIcon size={size} off/>;

function Row({ row, tabId }: { row: SiteNotificationRow; tabId: string }) {
  const words = row.neutral ? t('workspaces.securedNotification') : row.title;
  return <div className="dl-panel-item sn-item" data-unread={row.unread || undefined}>
    <button type="button" className="acira-menu-row acira-menu-row-identity dl-panel-main sn-main" onClick={() => void siteNotesCommand(tabId, 'open', { id: row.id })}>
      {row.neutral ? <span className="sn-icon sn-icon-neutral" aria-hidden="true"><BellIcon size={14}/></span> : <SiteIcon url={row.origin} size={20} className="sn-icon"/>}
      <span className="acira-menu-title sn-words"><span className="sn-title">{words}</span>{!row.neutral && <span className="acira-menu-sub sn-body"><span className="sn-site">{row.site}</span>{row.body ? ` · ${row.body}` : ''}</span>}</span>
      <span className="sn-time">{ago(row.at)}{row.unread && <i className="sn-dot" aria-hidden="true"/>}</span>
    </button>
    <span className="dl-panel-acts">
      {!row.neutral && <button type="button" className="dl-panel-act" aria-label={t('sitenotes.mute', { site: row.site })} title={t('sitenotes.mute', { site: row.site })} onClick={() => void siteNotesCommand(tabId, 'mute', { id: row.id })}><BellIcon size={14} off/></button>}
      <button type="button" className="dl-panel-act" aria-label={t('sitenotes.dismiss')} title={t('sitenotes.dismiss')} onClick={() => void siteNotesCommand(tabId, 'dismiss', { id: row.id })}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg></button>
    </span>
  </div>;
}

/** The bell's popup: the website notifications of this window (newest first), Silent, the muted sites, Clear all, Notification settings. Opening
 *  it reads them all (the count on the bell goes). */
export function NotificationsPanel({ state, dispatch, tabId, onSettings }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; tabId: string; onSettings: () => void }) {
  useT();
  const list = useSiteNotifications(tabId, true), silent = state.settings.siteNotificationsSilent === true;
  useEffect(() => { if (list.unread) void siteNotesCommand(tabId, 'read'); }, [list.unread, tabId]);
  return <section className="download-panel sn-panel" aria-label={t('sitenotes.title')}>
    <MenuToggle icon={SilentIcon} label={t('sitenotes.silent')} on={silent} onToggle={() => dispatch({ type: 'settings.update', patch: { siteNotificationsSilent: !silent } })}/>
    <hr className="acira-menu-sep"/>
    {list.entries.length
      ? list.entries.map(row => <Row key={row.id} row={row} tabId={tabId}/>)
      : <div className="acira-menu-row acira-menu-row-fact"><BellIcon size={16}/><span className="acira-menu-title">{t('sitenotes.empty')}</span><span/></div>}
    {list.muted.map(item => <div key={item.origin} className="acira-menu-row acira-menu-row-fact sn-muted"><span/><span className="acira-menu-title">{t('sitenotes.muted', { site: item.site, count: item.count })}</span><button type="button" className="sn-link" onClick={() => void siteNotesCommand(tabId, 'unmute', { url: item.origin })}>{t('sitenotes.unmute')}</button></div>)}
    <hr className="acira-menu-sep"/>
    {list.entries.length > 0 && <ActionRow label={t('sitenotes.clearAll')} onClick={() => void siteNotesCommand(tabId, 'clear')}/>}
    <ActionRow label={t('sitenotes.settings')} onClick={onSettings}/>
  </section>;
}
