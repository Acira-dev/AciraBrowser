import { useEffect, useState } from 'react';
import { Layers3 } from '../../components/AppIcons';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { formatShortcut } from '../../ui/platform';
import { useSiteIcons } from '../../ui/siteIcons';
import { t } from '../../i18n';
import { ago, host, rewind, rewindAvailable, type ClosedTab, type RestoreResult, type TabsState } from './client';
import { SiteIcon } from './SiteIcon';

/** "Recently closed" (R3-39): the last few tabs you closed, one click each, so "closed five minutes ago" never needs the Rewind page. It reads the
 *  same closed-tab log as the page (same de-duplication, same private/Tor exclusion) and restores the same way: in the background, in the old
 *  group, with Undo. The last row opens Rewind for everything older. */
export function RecentlyClosed({ state, dispatch, close, onNavigate }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => unknown; close: () => void; onNavigate: (url: string) => void }) {
  const [tabs, setTabs] = useState<ClosedTab[] | null>(null);
  const iconFor = useSiteIcons(state);
  useEffect(() => {
    let live = true;
    if (!rewindAvailable()) { setTabs([]); return; }
    void rewind<TabsState>({ type: 'rewind.tabs', limit: 6 }).then(data => { if (live) setTabs(data.private ? [] : data.tabs); }, () => { if (live) setTabs([]); });
    return () => { live = false; };
  }, []);
  const reopen = async (tab: ClosedTab) => {
    close();
    try {
      const result = await rewind<RestoreResult>({ type: 'rewind.reopen', ids: [tab.id] });
      if (!result.ok) dispatch({ type: 'toast', text: result.message || t('rewind.restoreFailed'), tone: 'error' });
      else if (result.restored && result.token) dispatch({ type: 'toast', text: result.split ? t('rewind.restoredSplit') : t('rewind.restoredOne', { title: tab.title || host(tab.url) }), action: { label: t('toast.undo'), command: { type: 'rewind.undo', token: result.token } } });
      else dispatch({ type: 'toast', text: t('rewindpage.thoseTabsAreAlreadyOpen'), tone: 'status', icon: 'info' });
    } catch (cause) { dispatch({ type: 'toast', text: cause instanceof Error ? cause.message : t('rewind.restoreFailed'), tone: 'error' }); }
  };
  const now = Date.now();
  return <>
    {/* Still loading: the popup measures once the list is in (a frame at the bare footer's 83px read as a resize). */}
    {tabs === null ? <span hidden data-popup-pending /> : tabs.length
      ? tabs.map(tab => <button key={tab.id} type="button" className="tab-result" title={tab.url} onClick={() => void reopen(tab)}>
        <SiteIcon url={tab.url} icon={iconFor(tab.url)} className="site-identity-icon" />
        <span><strong>{tab.title || host(tab.url)}</strong><small>{host(tab.url)} · {ago(tab.closedAt, now)}</small></span>
      </button>)
      : <p className="info-note">{t('rewind.emptyTabsTitle')}</p>}
    <hr />
    <button type="button" className="menu-row" onClick={() => { onNavigate('acira://rewind'); close(); }}><Layers3 size={16} /><span>{t('rewind.openRewind')}</span><kbd>{formatShortcut('Ctrl Shift H')}</kbd></button>
  </>;
}
