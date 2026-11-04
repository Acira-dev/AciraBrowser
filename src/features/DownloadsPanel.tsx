import type { ReactNode } from 'react';
import type { BrowserDownload, BrowserSnapshot } from '../runtime/types';
import { runtime } from '../runtime/client';
import { DownloadMatrix } from '../components/DownloadsGlyph';
import { Download, FolderOpen, Pause, Play, RotateCw, X } from '../components/AppIcons';
import { ActionRow } from '../components/PanelParts';
import { t, useT } from '../i18n';
import { isLiveDownload, panelDownloads, panelWarnsFirst, PANEL_DOWNLOAD_ROWS } from '../ui/downloadActivity';
import { TorDownloadNotice } from './tor/TorDownloadNotice';
import { DownloadLineSlot, downloadMeta, downloadShare, sizeOf, useDownloads, type DownloadCommand } from './Downloads';
import { FileGlyph, MiddleName } from './Library';
import './downloads-panel.css';

function PanelRow({ item, act, reduced, onOpened }: { item: BrowserDownload; act: (id: string, command: DownloadCommand) => Promise<void>; reduced: boolean; onOpened: () => void }) {
  const running = isLiveDownload(item), openable = item.status === 'Ready' && !!item.canOpen;
  const matrix = running ? <DownloadMatrix phase={item.status === 'Paused' ? 'held' : 'run'} progress={downloadShare(item)} reducedMotion={reduced}/> : undefined;
  const body = <>
    <FileGlyph name={item.name} bare>{matrix}</FileGlyph>
    <span className="acira-menu-title"><MiddleName name={item.name}/><span className="acira-menu-sub">{panelWarnsFirst(item) ? <><span data-warn>{t('dl.review')}</span> · {sizeOf(item)}</> : downloadMeta(item, false)}</span></span>
    <span/>
  </>;
  const button = (label: string, icon: ReactNode, run: () => void, danger = false) => <button type="button" className="dl-panel-act" data-danger={danger || undefined} aria-label={label} title={label} onClick={run}>{icon}</button>;
  return <div className="dl-panel-item" data-status={item.status} data-live={running || undefined}>
    {openable
      ? <button type="button" className="acira-menu-row acira-menu-row-identity dl-panel-main" aria-label={t('dl.openAria', { name: item.name })} onClick={() => { void act(item.id, 'open'); onOpened(); }}>{body}</button>
      : <div className="acira-menu-row acira-menu-row-identity dl-panel-main">{body}</div>}
    <span className="dl-panel-acts">
      {item.status === 'Downloading' && item.canPause && button(t('dl.pauseAria', { name: item.name }), <Pause size={14}/>, () => void act(item.id, 'pause'))}
      {item.status === 'Paused' && item.canResume && button(t('dl.resumeAria', { name: item.name }), <Play size={14}/>, () => void act(item.id, 'resume'))}
      {!running && item.status !== 'Ready' && (item.canResume ? button(t('dl.resume'), <Play size={14}/>, () => void act(item.id, 'resume')) : item.canRetry && button(t('dl.retry'), <RotateCw size={14}/>, () => void act(item.id, 'retry')))}
      {item.status === 'Ready' && item.canShow && button(t('dl.showAria', { name: item.name }), <FolderOpen size={14}/>, () => void act(item.id, 'show'))}
      {item.canCancel ? button(t('dl.cancelAria', { name: item.name }), <X size={14}/>, () => void act(item.id, 'cancel'), true)
        : !running && button(t('dl.removeAria', { name: item.name }), <X size={14}/>, () => void runtime.dispatch({ type: 'downloads.remove', id: item.id }))}
    </span>
    <DownloadLineSlot item={item} reduced={reduced}/>
  </div>;
}

/** The downloads popup (the toolbar button, the sidebar's footer button): the extensions popup's panel system. What is downloading comes
 * first, each with its line, pause and cancel; then the latest finished files; the last row goes to the whole list. */
export function DownloadsPanel({ state, close, onSeeAll }: { state: BrowserSnapshot; close: () => void; onSeeAll: () => void }) {
  useT();
  const { items, error, act, fromTor } = useDownloads(state, '', false), rows = panelDownloads(items, PANEL_DOWNLOAD_ROWS);
  return <section className="download-panel" aria-label={t('browsermenu.downloads')}>
    <TorDownloadNotice active={fromTor}/>
    {error && <p className="download-panel-note" role="alert">{error}</p>}
    {rows.length
      ? rows.map(item => <PanelRow key={item.id} item={item} act={act} reduced={state.settings.reducedMotion} onOpened={close}/>)
      : <div className="acira-menu-row acira-menu-row-fact"><Download size={16} className="acira-menu-icon"/><span className="acira-menu-title">{t('dl.emptyTitle')}</span><span/></div>}
    <hr className="acira-menu-sep"/>
    <ActionRow label={t('dl.seeAll')} onClick={onSeeAll}/>
  </section>;
}
