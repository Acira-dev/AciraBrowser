import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { BrowserDownload, BrowserSnapshot, ServiceRequest } from '../runtime/types';
import { runtime } from '../runtime/client';
import { DownloadLine } from '../components/DownloadLine';
import { DownloadMatrix } from '../components/DownloadsGlyph';
import { isLiveDownload, profileDownloads } from '../ui/downloadActivity';
import { FolderOpen, Pause, Play, RotateCw, Trash2, X } from '../components/AppIcons';
import { currentLocale, t, useT } from '../i18n';
import { TorDownloadNotice } from './tor/TorDownloadNotice';
import { FileGlyph, LibraryEmpty, LibraryPage, LibrarySection, MiddleName, dayOf } from './Library';
import { bytes, canDeleteFile, canDragFile, sizeOf, statusText } from './downloadText';

export { bytes, canDeleteFile, canDragFile, sizeOf, statusText } from './downloadText';
export const rate = (value?: number) => value && value > 0 ? `${bytes(value)}/s` : '';
export const left = (seconds?: number) => !seconds || seconds <= 0 ? '' : seconds < 60 ? t('dl.secLeft', { count: Math.max(1, Math.round(seconds)) }) : seconds < 3600 ? t('dl.minLeft', { count: Math.round(seconds / 60) }) : t('dl.hourLeft', { count: Math.round(seconds / 3600) });
export type DownloadCommand = Extract<ServiceRequest, { type: 'downloads.command' }>['command'];
const timeFormat = () => new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit' });
const live = isLiveDownload;

/** How long a picked-up row stays dimmed at least: on macOS the command answers as soon as the drag has begun, on Windows only when it ends. */
const LIFT_MS = 400;
/** A finished file picked up by its row: the browser's own drag is replaced by a native file drag that main starts (the `drag` command), which carries the real file
 * to a page's upload box, another program or the desktop. `lift` dims the row (the same 45% a dragged bookmark row gets) while the file is held. */
export function pickUpFile(event: { preventDefault(): void }, id: string, act: (id: string, command: DownloadCommand) => Promise<void>, lift: (on: boolean) => void, now: () => number = Date.now, later: (run: () => void, ms: number) => void = (run, ms) => void window.setTimeout(run, ms)) {
  event.preventDefault();
  const since = now(); lift(true);
  return act(id, 'drag').finally(() => later(() => lift(false), Math.max(0, LIFT_MS - (now() - since))));
}
/** The row props that make a finished file draggable (the popup's row and the page's row share them); a row that is running, failed or whose file is gone gets none. */
export function useFileDrag(item: BrowserDownload, act: (id: string, command: DownloadCommand) => Promise<void>) {
  const [lifted, setLifted] = useState(false);
  if (!canDragFile(item)) return {};
  return { draggable: true as const, 'data-dragging': lifted || undefined, onDragStart: (event: DragEvent<HTMLElement>) => void pickUpFile(event, item.id, act, setLifted) };
}

/** This profile's downloads (with what the native side knows about each) and the commands that act on them. */
export function useDownloads(state: BrowserSnapshot, query: string, hideReady: boolean) {
  const [error, setError] = useState(''), [reconciled, setReconciled] = useState<BrowserDownload[]>([]);
  const profileId = state.activeBrowserProfileId, mine = profileDownloads(state, profileId), ids = mine.map(item => item.id + ':' + item.status).join(',');
  const refresh = async () => { const result = await runtime.service({ type: 'downloads.list' }); setReconciled(result.downloads || []); };
  useEffect(() => { let alive = true; void runtime.service({ type: 'downloads.list' }).then(result => { if (alive) setReconciled(result.downloads || []); }).catch(reason => alive && setError(reason instanceof Error ? reason.message : String(reason))); return () => { alive = false; }; }, [profileId, ids]);
  const act = async (id: string, command: DownloadCommand) => { setError(''); try { await runtime.service({ type: 'downloads.command', id, command }); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  const needle = query.trim().toLowerCase();
  const items = mine.filter(item => item.name.toLowerCase().includes(needle)).filter(item => !(hideReady && item.status === 'Ready')).map(item => item.canCancel === undefined ? (reconciled.find(native => native.id === item.id) || item) : item);
  return { items, error, act, total: mine.length, fromTor: mine.some(item => item.tor) };
}

/** The second line of a download: what has arrived, then (on the page, which has the room) its speed and the time left; a finished file shows its size and when. */
export function downloadMeta(item: BrowserDownload, detailed = true) {
  const total = item.totalBytes && item.totalBytes > 0 ? item.totalBytes : 0, received = item.receivedBytes || 0;
  const arrived = total ? t('dl.ofTotal', { received: bytes(received), total: bytes(total) }) : sizeOf(item);
  return item.status === 'Downloading' ? [arrived, detailed ? rate(item.speed) : '', left(item.eta)].filter(Boolean).join(' · ')
    : item.status === 'Paused' ? [arrived, statusText('Paused')].join(' · ')
    : item.status === 'Ready' ? [sizeOf(item), item.startedAt ? timeFormat().format(new Date(item.startedAt)) : ''].filter(Boolean).join(' · ')
    : [sizeOf(item), statusText(item.status)].filter(Boolean).join(' · ');
}

/** The share of a download received, or null while its size is unknown. */
export const downloadShare = (item: BrowserDownload) => item.totalBytes && item.totalBytes > 0 ? Math.min(1, (item.receivedBytes || 0) / item.totalBytes) : null;

/** A download's line while it runs, and for the moment it runs to the end and fades once the file is done. */
export function DownloadLineSlot({ item, reduced }: { item: BrowserDownload; reduced: boolean }) {
  const running = live(item), [tail, setTail] = useState(false), was = useRef(running);
  // The render in which the file turns Ready still draws the line (it is the same one that ran), so it can run to the end and fade.
  const finished = was.current && !running && item.status === 'Ready';
  useEffect(() => {
    was.current = running;
    if (!finished) return;
    setTail(true); const timer = window.setTimeout(() => setTail(false), 900); return () => window.clearTimeout(timer);
  }, [running, item.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!running && !tail && !finished) return null;
  return <DownloadLine progress={downloadShare(item)} paused={item.status === 'Paused'} finishing={!running} reduced={reduced} />;
}

function DownloadRow({ item, act, reduced }: { item: BrowserDownload; act: (id: string, command: DownloadCommand) => Promise<void>; reduced: boolean }) {
  useT();
  const meta = downloadMeta(item);
  const label = item.name;
  // A finished file can be dragged out to Explorer or into a page: the browser's own drag is replaced by a native file drag started in main.
  const drag = useFileDrag(item, act);
  // The matrix is the file's icon while it downloads, and shows again when the pointer rests on a finished file's icon or name.
  const [hot, setHot] = useState(false), cooling = useRef(0);
  const warm = () => { window.clearTimeout(cooling.current); setHot(true); }, cool = () => { window.clearTimeout(cooling.current); cooling.current = window.setTimeout(() => setHot(false), 90); };
  useEffect(() => () => window.clearTimeout(cooling.current), []);
  const settled = item.status === 'Ready', matrix = live(item) ? <DownloadMatrix phase={item.status === 'Paused' ? 'held' : 'run'} progress={downloadShare(item)} grid={7} size={24} reducedMotion={reduced} /> : settled && hot ? <DownloadMatrix phase="done" progress={1} grid={7} size={24} reducedMotion={reduced} /> : null;
  return <div className="lib-row dl" data-status={item.status} data-settled={!live(item) || undefined} {...drag}>
    <span className="dl-lead" data-matrix={matrix ? '' : undefined} onPointerEnter={settled ? warm : undefined} onPointerLeave={settled ? cool : undefined}><FileGlyph name={item.name}>{matrix}</FileGlyph></span>
    <div className="dl-body">
      <span className="dl-name" onPointerEnter={settled ? warm : undefined} onPointerLeave={settled ? cool : undefined}><MiddleName name={item.name} /></span>
      <span className="dl-meta">{meta}{item.dangerous ? <> · <span data-warn>{t('dl.review')}</span></> : null}</span>
    </div>
    <span className="lib-actions lib-actions-live">
      {item.status === 'Downloading' && item.canPause && <button type="button" className="lib-icon" aria-label={t('dl.pauseAria', { name: label })} title={t('dl.pause')} onClick={() => void act(item.id, 'pause')}><Pause size={14} /></button>}
      {item.status === 'Paused' && item.canResume && <button type="button" className="lib-icon" aria-label={t('dl.resumeAria', { name: label })} title={t('dl.resume')} onClick={() => void act(item.id, 'resume')}><Play size={14} /></button>}
      {item.canCancel && <button type="button" className="lib-icon" aria-label={t('dl.cancelAria', { name: label })} title={t('dl.cancel')} onClick={() => void act(item.id, 'cancel')}><X size={14} /></button>}
      {!live(item) && item.status !== 'Ready' && (item.canResume
        ? <button type="button" className="acira-button acira-button-quiet lib-compact" onClick={() => void act(item.id, 'resume')}><Play size={13} />{t('dl.resume')}</button>
        : item.canRetry && <button type="button" className="acira-button acira-button-quiet lib-compact" onClick={() => void act(item.id, 'retry')}><RotateCw size={13} />{t('dl.retry')}</button>)}
    </span>
    <span className="lib-actions">
      {item.status === 'Ready' && item.canOpen && <button type="button" className="acira-button acira-button-quiet lib-compact" aria-label={t('dl.openAria', { name: label })} onClick={() => void act(item.id, 'open')}>{t('dl.open')}</button>}
      {item.status === 'Ready' && item.canShow && <button type="button" className="lib-icon" aria-label={t('dl.showAria', { name: label })} title={t('dl.showInFolder')} onClick={() => void act(item.id, 'show')}><FolderOpen size={14} /></button>}
      {canDeleteFile(item) && <button type="button" className="lib-icon" data-danger aria-label={t('dl.deleteAria', { name: label })} title={t('dl.delete')} onClick={() => void act(item.id, 'delete')}><Trash2 size={14} /></button>}
      {!item.canCancel && !live(item) && <button type="button" className="lib-icon" data-danger aria-label={t('dl.removeAria', { name: label })} title={t('dl.removeFromList')} onClick={() => void runtime.dispatch({ type: 'downloads.remove', id: item.id })}><X size={14} /></button>}
    </span>
    <DownloadLineSlot item={item} reduced={reduced} />
  </div>;
}

const hideReadyKey = 'acira.downloads.hideCompleted';
export function Downloads({ state }: { state: BrowserSnapshot }) {
  useT();
  const [query, setQuery] = useState(''), downloadSearch = useRef<HTMLInputElement>(null);
  const [hideReady, setHideReady] = useState(() => { try { return localStorage.getItem(hideReadyKey) === '1'; } catch { return false; } });
  const toggle = () => setHideReady(value => { const next = !value; try { localStorage.setItem(hideReadyKey, next ? '1' : '0'); } catch { /* optional */ } return next; });
  const { items, error, act, total, fromTor } = useDownloads(state, query, hideReady);
  const groups = useMemo(() => {
    const active = items.filter(live), done = items.filter(item => !live(item));
    const days = done.reduce<{ label: string; key: number; items: BrowserDownload[] }[]>((list, item) => {
      const { label, key } = dayOf(item.startedAt), last = list.at(-1);
      if (last && last.key === key) last.items.push(item); else list.push({ label, key, items: [item] });
      return list;
    }, []);
    return [...(active.length ? [{ label: t('dl.inProgress'), key: -1, items: active }] : []), ...days];
  }, [items]);
  const anyReady = profileDownloads(state, state.activeBrowserProfileId).some(item => item.status === 'Ready');
  return <LibraryPage title={t('dl.title')} description={t('dl.description')} count={total ? t('plural.files', { count: total }) : undefined}
    search={{ label: t('dl.find'), placeholder: t('dl.find'), value: query, onChange: setQuery, inputRef: downloadSearch }}
    actions={anyReady ? <button type="button" className="acira-button acira-button-secondary" aria-pressed={hideReady} onClick={toggle}>{hideReady ? t('dl.showCompleted') : t('dl.hideCompleted')}</button> : undefined}>
    <TorDownloadNotice active={fromTor} variant="page"/>
    {error && <p className="lib-error" role="alert">{error}</p>}
    {groups.length ? groups.map(group => <LibrarySection key={group.key} title={group.label} count={group.items.length}>
      {group.items.map(item => <DownloadRow key={item.id} item={item} act={act} reduced={state.settings.reducedMotion} />)}
    </LibrarySection>)
      : <LibraryEmpty title={query ? t('dl.noMatchTitle') : hideReady && total ? t('dl.hiddenTitle') : t('dl.emptyTitle')} text={query ? t('dl.noMatchText', { query: query.trim() }) : hideReady && total ? t('dl.hiddenText') : t('dl.emptyText')}>
        {(query || (hideReady && total > 0)) && <button type="button" className="acira-button acira-button-secondary" onClick={() => { if(query){setQuery(''); downloadSearch.current?.focus({preventScroll:true});}else toggle(); }}>{query ? t('lib.clearSearch') : t('dl.showCompleted')}</button>}
      </LibraryEmpty>}
  </LibraryPage>;
}
