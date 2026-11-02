import { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Trash2, X } from '../components/AppIcons';
import { SiteIdentityIcon } from '../components/SiteIdentityIcon';
import type { BrowserAction, BrowserSnapshot, HistoryVisit } from '../runtime/types';
import { bookmarkContext, openPage, savedPageIdentity } from '../ui/pageActions';
import { useSiteIcons } from '../ui/siteIcons';
import { useT } from '../i18n';
import { ConfirmAction, LibraryEmpty, LibraryPage, LibrarySection, dayOf, pageHost, useDayWindow, useUndoNotice } from './Library';
import { cachedFormat } from './libraryModel';

const timeFormat = () => cachedFormat('time', { hour: 'numeric', minute: '2-digit' });

/** Visit times are stored as ISO strings; show them as local time and group them by local day. */
export function visitMoment(value: string, now = new Date()) {
  const date = new Date(value), { label, key } = dayOf(value, now);
  return { day: label, dayKey: key, time: Number.isNaN(date.getTime()) ? value : timeFormat().format(date) };
}

type Row = HistoryVisit & { shown: string };
type Day = { day: string; dayKey: number; items: Row[]; signature: string };

export function BrowserHistory({ state, dispatch, onNavigate }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; onNavigate: (url: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState(''), historySearch = useRef<HTMLInputElement>(null);
  const [notice, offer, dismiss] = useUndoNotice();
  const siteIcon = useSiteIcons(state);
  const profileId = state.tabs.find(tab => tab.id === state.activeTabId)?.browserProfileId || state.activeBrowserProfileId;
  const defaultProfileId = state.browserProfiles[0]?.id;
  const visits = useMemo(() => state.browsingHistory.filter(item => (item.browserProfileId ?? defaultProfileId) === profileId), [state.browsingHistory, profileId, defaultProfileId]);
  const needle = query.trim().toLowerCase();
  const entries = useMemo(() => needle ? visits.filter(item => `${item.title} ${item.url}`.toLowerCase().includes(needle)) : visits, [visits, needle]);
  const sites = useMemo(() => new Set(visits.map(item => pageHost(item.url))).size, [visits]);
  // One pass: a day is a header plus its rows, and the rows are built only for the part of the day that is near the screen (Library.tsx).
  const groups = useMemo(() => {
    const days: Day[] = [], ids: string[][] = [], now = new Date();
    for (const item of entries) {
      const moment = visitMoment(item.time, now), last = days.at(-1);
      const row: Row = { ...item, shown: moment.time };
      if (last && last.dayKey === moment.dayKey) { last.items.push(row); ids[ids.length - 1].push(item.id); } else { days.push({ day: moment.day, dayKey: moment.dayKey, items: [row], signature: '' }); ids.push([item.id]); }
    }
    days.forEach((day, index) => { day.signature = ids[index].join('|'); });
    return days;
  }, [entries]);
  // Days far from the screen are not in the DOM at all, two spacers of their exact height stand in (Library.tsx useDayWindow); rows of a long day are windowed inside it.
  const days = useRef<HTMLDivElement>(null), counts = useMemo(() => groups.map(group => group.items.length), [groups]), dayWindow = useDayWindow(days, counts);
  /** Deletes exactly these visits (not the same page on other days) and offers to put them back. */
  const removeVisits = (items: (HistoryVisit & { shown?: string })[], message: string) => {
    const visits = items.map(({ shown: _shown, ...visit }) => visit as HistoryVisit);
    dispatch({ type: 'history.delete', ids: visits.map(visit => visit.id) });
    offer(message, () => dispatch({ type: 'history.restore', visits }));
  };
  const row = (item: Row) => {
    const title = item.title.replace(/ · Demo$/, '') || pageHost(item.url);
    return <div className="lib-row" key={item.id}>
      <button className="lib-open" data-lib-stop title={`${title} · ${item.url}`} onClick={event => openPage(event, item.url, dispatch, onNavigate)} onAuxClick={event => openPage(event, item.url, dispatch, onNavigate)}
        onContextMenu={event => bookmarkContext(event, item.url, state)}
        onKeyDown={event => { if (event.key === 'Delete') { event.preventDefault(); removeVisits([item], t('history.removed', { title })); } }}>
        <SiteIdentityIcon url={item.url} favicon={savedPageIdentity(item.url, state).favicon || siteIcon(item.url)} size={16} className="lib-site" />
        <span className="lib-text"><span className="lib-title">{title}</span><span className="lib-host">{pageHost(item.url)}</span></span>
      </button>
      <span className="lib-trail">
        <time className="lib-time">{item.shown}</time>
        <span className="lib-actions">
          <button type="button" className="lib-icon" aria-label={t('history.openNewTabAria', { title })} title={t('history.openNewTab')} onClick={() => dispatch({ type: 'tab.new', url: item.url })}><ArrowUpRight size={14} /></button>
          <button type="button" className="lib-icon" data-danger aria-label={t('history.removeAria', { title })} title={t('history.remove')} onClick={() => removeVisits([item], t('history.removed', { title }))}><X size={14} /></button>
        </span>
      </span>
    </div>;
  };
  return <LibraryPage title={t('history.title')} description={t('history.description')}
    count={visits.length ? `${t('plural.visits', { count: visits.length })} · ${t('plural.sites', { count: sites })}` : undefined}
    search={{ label: t('history.search'), placeholder: t('history.search'), value: query, onChange: setQuery, inputRef: historySearch }} notice={notice} onDismissNotice={dismiss}>
    {groups.length > 0 ? <div className="lib-days" ref={days}>
      {dayWindow.span.first > 0 && <div aria-hidden="true" style={{ height: dayWindow.offsets[dayWindow.span.first] }} />}
      {groups.slice(dayWindow.span.first, dayWindow.span.last + 1).map((group, at) => <LibrarySection key={group.dayKey} title={group.day} count={group.items.length} day lead={dayWindow.span.first + at === 0} eager
        action={<ConfirmAction label={<><Trash2 size={13} /> {t('history.deleteDay')}</>} confirmLabel={t('history.deleteConfirm', { count: group.items.length })} ariaLabel={t('history.deleteDayAria', { day: group.day })} onConfirm={() => removeVisits(group.items, t('history.deletedFromDay', { count: group.items.length, day: group.day }))} />}
        windowed={{ count: group.items.length, at: i => row(group.items[i]), signature: group.signature }} />)}
      {dayWindow.span.last < groups.length - 1 && <div aria-hidden="true" style={{ height: dayWindow.offsets[groups.length] - dayWindow.offsets[dayWindow.span.last + 1] }} />}
    </div>
      : query
        ? <LibraryEmpty title={t('history.noMatchTitle')} text={t('history.noMatchText', { query: query.trim() })}><button type="button" className="acira-button acira-button-secondary" onClick={() => { setQuery(''); historySearch.current?.focus({ preventScroll: true }); }}>{t('lib.clearSearch')}</button></LibraryEmpty>
        : <LibraryEmpty title={t('history.emptyTitle')} text={t('history.emptyText')} />}
  </LibraryPage>;
}
