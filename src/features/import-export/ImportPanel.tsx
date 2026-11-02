import { useEffect, useRef, useState } from 'react';
import { DotMatrix } from '../../components/DotMatrix';
import { runtime } from '../../runtime/client';
import type { BrowserSnapshot, ImportSource, ServiceResult } from '../../runtime/types';
import { browserIconFor, browserLetter } from './browserIcons';
import { ExtensionReinstall } from './ExtensionReinstall';
import { PasswordHandoff } from './PasswordHandoff';
import { SignBackIn } from './SignBackIn';
import { importErrorPresentation, type ImportErrorAction } from './importError';
import { applyImportedFavorites, undoImportBatches } from '../../ui/importedFavorites';
import { useT, type MessageId } from '../../i18n';
import './import-export.css';

type Category = 'favorites' | 'spaces' | 'bookmarks' | 'history' | 'preferences' | 'extensions';
type FeedbackLocation = ImportErrorAction;
const categoryOrder: Category[] = ['favorites', 'spaces', 'bookmarks', 'history', 'preferences', 'extensions'];
/** Only Arc has these; other browsers don't list them at all rather than showing them unavailable. */
const arcOnly: readonly Category[] = ['favorites', 'spaces'];
const countIds = new Set<string>(['favorites', 'spaces', 'bookmarks', 'history', 'extensions', 'preferences']);

const hexRgb = (value?: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(value || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
/** Readable initial on the profile color (WCAG relative luminance). */
const onColor = (value?: string) => { const rgb = hexRgb(value); if (!rgb) return undefined; const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b > .42 ? '#111' : '#fff'; };

/** A profile's own face: its picture, else its color with its initial. Browsers draw these from the profile, so people recognise them. */
function Avatar({ source }: { source: ImportSource }) {
  const fill = source.color || source.fillColor;
  const style = source.picture ? undefined : { background: fill || undefined, color: onColor(fill) };
  return <span className="aip-avatar" style={style} data-plain={!source.picture && !fill ? '' : undefined} aria-hidden="true">{source.picture ? <img src={source.picture} alt="" width={24} height={24} draggable={false} /> : <bdi>{(source.initial || source.name || '?').slice(0, 1).toUpperCase()}</bdi>}</span>;
}

/** A browser's own app icon (read from its installed executable), or its first letter when there is none to read. */
function BrowserTile({ browser, icon }: { browser: string; icon?: string }) {
  return <span className="aip-browser" data-icon={icon ? '' : undefined} aria-hidden="true">{icon ? <img src={icon} alt="" width={16} height={16} draggable={false} /> : browserLetter(browser)}</span>;
}

/** Presentation of the existing native importer. Discovery and file dialogs stay in runtime.service. */
export function ImportPanel({ state }: { state: BrowserSnapshot }) {
  const t = useT();
  const categoryNames = (category: Category) => t(`import.cat.${category}` as MessageId);
  const countLabel = (category: string, count: number) => t((countIds.has(category) ? `import.count.${category}` : 'import.count.items') as MessageId, { count });
  const [result, setResult] = useState<ServiceResult>({});
  const [source, setSource] = useState<ImportSource | null>(null);
  const [categories, setCategories] = useState<Category[]>(['bookmarks', 'history']);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(t('import.activity.finding'));
  const [error, setError] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [feedbackLocation, setFeedbackLocation] = useState<FeedbackLocation>('source');
  const [cancelable, setCancelable] = useState(false);
  const [passwordsBrought, setPasswordsBrought] = useState(0);
  const generation = useRef(0);
  const summary = useRef<HTMLDivElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const selection = useRef<HTMLFieldSetElement>(null);
  const findProfiles = useRef<HTMLButtonElement>(null);
  const focusSelection = useRef(false);
  const focusSources = useRef(false);
  const isPrivate = Boolean(state.browserProfiles.find(profile => profile.id === state.activeBrowserProfileId)?.private);
  const preview = result.preview;
  const batch = result.batch;
  const hasIssues = batch?.results.some(row => row.status === 'failed' || row.status === 'unavailable');
  const errorCopy = error ? importErrorPresentation(error, feedbackLocation) : null;
  /** The browser the person brought things from (a bookmarks file or an Acira profile file is not one): names the one whose sign-ins stay behind. */
  const fromFile = (browser: string) => browser === 'HTML' || browser === 'Acira';
  const fromBrowser = (batch && !fromFile(batch.browser) ? batch.browser : result.batches?.find(item => !fromFile(item.browser))?.browser) || undefined;
  const signinRefresh = batch ? `${batch.id}:${passwordsBrought}` : passwordsBrought ? `p${passwordsBrought}` : undefined;

  useEffect(() => {
    if (batch) {
      summary.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      summary.current?.focus({ preventScroll: true });
    }
  }, [batch?.id]);
  useEffect(() => {
    if (error) {
      errorNotice.current?.closest('.aip-error-block')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      errorNotice.current?.focus({ preventScroll: true });
    }
  }, [error]);
  useEffect(() => {
    if (busy) return;
    if (focusSelection.current && preview && source?.id === preview.source.id) {
      focusSelection.current = false;
      selection.current?.focus({ preventScroll: true });
    }
    if (focusSources.current && !source) {
      focusSources.current = false;
      findProfiles.current?.focus({ preventScroll: true });
    }
  }, [busy, preview, source]);

  const another = () => {
    focusSelection.current = false;
    focusSources.current = true;
    setSource(null);
    setResult(current => ({ ...current, batch: undefined, preview: undefined }));
    setError('');
    setExportMessage('');
  };
  const cancel = () => {
    focusSelection.current = false;
    generation.current++;
    setBusy(false); setCancelable(false); setError('');
    setExportMessage(t('import.cancelled'));
  };
  const discover = async () => {
    const mine = ++generation.current;
    setBusy(true); setCancelable(true); setActivity(t('import.activity.finding')); setFeedbackLocation('source'); setError(''); setExportMessage('');
    try { const next = await runtime.service({ type: 'imports.discover' }); if (mine !== generation.current) return; setResult(next); setSource(null); }
    catch (error) { if (mine === generation.current) setError(String(error)); }
    finally { if (mine === generation.current) { setBusy(false); setCancelable(false); } }
  };
  useEffect(() => { void discover(); }, [state.activeBrowserProfileId]);

  const choose = async (item: ImportSource) => {
    focusSelection.current = true;
    const mine = ++generation.current;
    setSource(item); setBusy(true); setCancelable(true); setActivity(t('import.activity.reading')); setFeedbackLocation('source'); setError(''); setExportMessage('');
    setResult(current => ({ ...current, preview: undefined, batch: undefined }));
    try {
      const next = await runtime.service({ type: 'imports.preview', sourceId: item.id });
      if (mine === generation.current) {
        setResult(current => ({ ...current, ...next }));
        // Arc's Favorites and Spaces are what its people come for, so they start ticked.
        const arc = arcOnly.filter(category => next.preview?.source.available[category]);
        setCategories(old => [...new Set([...arc, ...old.filter(category => !arcOnly.includes(category))])]);
      }
    } catch (error) { if (mine === generation.current) setError(String(error)); }
    finally { if (mine === generation.current) { setBusy(false); setCancelable(false); } }
  };
  const run = async () => {
    if (!source) return;
    setBusy(true); setActivity(t('import.activity.importing')); setFeedbackLocation('selection'); setError(''); setExportMessage('');
    try {
      const next = await runtime.service({ type: 'imports.run', sourceId: source.id, categories });
      if (next.batch?.favorites?.length) applyImportedFavorites(next.batch.profileId, next.batch.id, next.batch.favorites);
      setResult(current => ({ ...current, ...next }));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const importHTML = async () => {
    setBusy(true); setActivity(t('import.activity.file')); setFeedbackLocation('html'); setError(''); setExportMessage('');
    try {
      const next = await runtime.service({ type: 'imports.html' });
      setResult(current => ({ ...current, ...next }));
      if (next.cancelled) setExportMessage(t('import.importCancelled'));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const exportData = async (format: 'html' | 'json') => {
    setBusy(true); setActivity(t('import.activity.exporting')); setFeedbackLocation(format === 'html' ? 'export-html' : 'export-json'); setError(''); setExportMessage('');
    try {
      const next = await runtime.service({ type: 'imports.export', format, history: format === 'json' && includeHistory });
      setExportMessage(next.cancelled ? t('import.exportCancelled') : format === 'html' ? t('import.bookmarksExported') : t('import.profileExported'));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const undo = async (batchId: string) => {
    setBusy(true); setActivity(t('import.activity.undoing')); setFeedbackLocation(batch ? 'receipt' : 'previous'); setError(''); setExportMessage('');
    try {
      await undoImportBatches([batchId], id => runtime.service({ type: 'imports.undo', batchId: id }));
      another();
      setResult(await runtime.service({ type: 'imports.discover' }));
      setFeedbackLocation('source');
      setExportMessage(t('import.undone'));
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  /** "7 bookmarks · 1 duplicate skipped": the preview counts what the import adds, and says what it leaves out and why. */
  const withSkipped = (count: string, skipped?: { duplicates: number; notWeb: number }) => [count, skipped?.duplicates ? t('import.skip.duplicates', { count: skipped.duplicates }) : '', skipped?.notWeb ? t('import.skip.notWeb', { count: skipped.notWeb }) : ''].filter(Boolean).join(' · ');
  const categoryDescription = (category: Category) => {
    if (!preview?.source.available[category]) return t('import.desc.unavailable');
    if (category === 'favorites') return t('import.desc.favorites', { count: countLabel(category, preview.favorites ?? 0) });
    if (category === 'spaces') return t('import.desc.spaces', { count: countLabel(category, preview.spaces ?? 0), pinned: (preview.pinned ?? 0).toLocaleString() });
    if (category === 'bookmarks') return withSkipped(countLabel(category, preview.bookmarks), preview.skipped?.bookmarks);
    if (category === 'history') return preview.history === null ? t('import.desc.historyUnreadable') : withSkipped(countLabel(category, preview.history), preview.skipped?.history);
    if (category === 'extensions') return t('import.desc.extensions', { count: countLabel(category, preview.extensions.length) });
    return t('import.desc.preferences');
  };
  const feedback = (location: FeedbackLocation) => feedbackLocation === location && (busy || error || exportMessage) ?
    <div className="aip-inline-feedback">
      {busy && <p className="aip-feedback" role="status"><DotMatrix preset="loader" size={16} reducedMotion={state.settings.reducedMotion}/><span>{activity}</span>{cancelable && <button type="button" className="aip-button aip-quiet" onClick={cancel}>{t('import.cancel')}</button>}</p>}
      {errorCopy && <div className="aip-error-block">
        <p className="aip-notice aip-error" ref={errorNotice} tabIndex={-1} role="alert"><strong>{errorCopy.title}</strong><span>{errorCopy.message}</span></p>
        <details className="aip-error-details"><summary>{t('import.technicalDetails')}</summary><pre>{errorCopy.details}</pre></details>
      </div>}
      {exportMessage && <p className="aip-feedback" role="status">{exportMessage}</p>}
    </div> : null;

  return <section className="acira-import-panel" aria-label={t('import.panelLabel')} aria-busy={busy}>
    {isPrivate && <p className="aip-notice" role="status">{t('import.private')}</p>}
    {batch ? <div className="aip-section aip-receipt" data-setting="import-browser" ref={summary} tabIndex={-1} role="status">
      <header className="aip-header">
        <h2 className="aip-heading">{hasIssues ? t('import.completeIssues') : t('import.complete')}</h2>
        <p className="aip-copy">{batch.browser} · {batch.name}</p>
      </header>
      <ul className="aip-results">{batch.results.map(row => <li key={row.category} data-result={row.status}>
        <div><strong>{categoryOrder.includes(row.category as Category) ? categoryNames(row.category as Category) : row.category}</strong>
          <span className="aip-result-status">{row.status === 'imported' ? t('import.status.imported') : row.status === 'inventory only' ? t('import.status.inventory') : row.status === 'failed' ? t('import.status.failed') : row.status === 'unavailable' ? t('import.status.unavailable') : row.status}</span></div>
        {(row.status === 'imported' || row.status === 'inventory only') && <p className="aip-copy">{countLabel(row.category, row.count ?? 0)}{row.folders ? ` · ${t('import.folders', { count: row.folders })}` : ''}{row.skipped ? ` · ${t('import.skipped', { count: row.skipped.toLocaleString() })}` : ''}</p>}
        {row.status === 'inventory only' && !isPrivate && preview?.extensions?.length ? <ExtensionReinstall profileId={batch.profileId} found={preview.extensions}/> : row.status === 'inventory only' && <p className="aip-copy">{t('import.extNotInstalled')}</p>}
        {row.error && <p className="aip-copy" role="alert">{row.error}</p>}
      </li>)}</ul>
      <div className="aip-actions">
        <button type="button" className="aip-button aip-primary" disabled={busy} onClick={another}>{t('import.more')}</button>
        <button type="button" className="aip-button" disabled={busy || isPrivate} onClick={() => void undo(batch.id)}>{t('import.undo')}</button>
      </div>
      {feedback('receipt')}
    </div> : <div className="aip-section" data-setting="import-browser">
      <header className="aip-header">
        <h2 className="aip-heading">{source ? <span className="aip-chosen"><Avatar source={source} /><span>{source.browser} · <bdi>{source.name}</bdi>{source.email && source.email !== source.name ? <span className="aip-email"><bdi>{source.email}</bdi></span> : null}</span></span> : t('import.fromAnother')}</h2>
        {!source && <p className="aip-copy">{t('import.blurb')}</p>}
        {!source && <p className="aip-copy aip-signins">{t('import.signinsStay')}</p>}
      </header>
      {!source ? <>
        <div className="aip-actions"><button ref={findProfiles} type="button" className="aip-button" disabled={busy} onClick={() => void discover()}>{t('import.findProfiles')}</button></div>
        {feedback('source')}
        {Boolean(result.sources?.length) && <div className="aip-sources" aria-label={t('import.availableProfiles')}>{[...new Set(result.sources!.map(item => item.browser))].map(browser => <div className="aip-group" role="group" aria-label={browser} key={browser}>
          <div className="aip-group-head"><BrowserTile browser={browser} icon={browserIconFor(result.icons, browser)} /><span>{browser}</span></div>
          {result.sources!.filter(item => item.browser === browser).map(item => <button type="button" className="aip-source" key={item.id} disabled={busy} onClick={() => void choose(item)}>
            <Avatar source={item} />
            <strong><bdi>{item.name}</bdi>{item.email && item.email !== item.name && <span className="aip-email"><bdi>{item.email}</bdi></span>}</strong>
            <span className="aip-source-meta">{categoryOrder.filter(category => item.available[category]).map(category => categoryNames(category)).join(' · ') || t('import.noSupportedData')}</span>
            <span className="aip-source-action">{t('import.chooseProfile')} <span aria-hidden="true">→</span></span>
          </button>)}
        </div>)}</div>}
        {result.sources?.length === 0 && <p className="aip-empty">{t('import.noProfiles')}</p>}
      </> : <>
        <div className="aip-actions"><button type="button" className="aip-button aip-quiet" disabled={busy} onClick={another}>{t('import.changeProfile')}</button>{!preview && !busy && <button type="button" className="aip-button" onClick={() => void choose(source)}>{t('import.retry')}</button>}</div>
        {feedback('source')}
        {preview && <>
          <fieldset ref={selection} tabIndex={-1} className="aip-categories" disabled={busy || isPrivate}>
            <legend>{t('import.chooseWhat')}</legend>
            {categoryOrder.filter(category => !arcOnly.includes(category) || preview.source.available[category]).map(category => <label key={category} className="aip-category" data-unavailable={!preview.source.available[category] || undefined}>
              <input type="checkbox" checked={categories.includes(category)} disabled={!preview.source.available[category] || busy || isPrivate} onChange={event => setCategories(old => event.target.checked ? [...old, category] : old.filter(item => item !== category))}/>
              <span><strong>{categoryNames(category)}</strong><span>{categoryDescription(category)}</span></span>
            </label>)}
          </fieldset>
          <p className="aip-copy aip-signins">{t('import.signinsStay')}</p>
          {preview.warnings.length > 0 && <div className="aip-warnings" role="status">{preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
          <div className="aip-actions"><button type="button" className="aip-button aip-primary" disabled={busy || isPrivate || !categories.length} onClick={() => void run()}>{t('import.importSelected')}</button></div>
        </>}
      </>}
      {feedback('selection')}
    </div>}
    {!isPrivate && <SignBackIn state={state} from={fromBrowser} refreshKey={signinRefresh} />}
    {!isPrivate && <PasswordHandoff from={fromBrowser} reducedMotion={state.settings.reducedMotion} onImported={() => setPasswordsBrought(count => count + 1)} />}
    <div className="aip-section aip-files">
      <header className="aip-header"><h2 className="aip-heading">{t('import.filesHeading')}</h2></header>
      {!batch && <div className="aip-file-row" data-setting="import-bookmarks-html">
        <div><h3>{t('import.importBookmarks')}</h3><p className="aip-copy">{t('import.importBookmarksDesc')}</p></div>
        <button type="button" className="aip-button" disabled={busy || isPrivate} onClick={() => void importHTML()}>{t('import.importBookmarksBtn')}</button>
        {feedback('html')}
      </div>}
      <div className="aip-file-row" data-setting="export-bookmarks-html">
        <div><h3>{t('import.exportBookmarks')}</h3><p className="aip-copy">{t('import.exportBookmarksDesc')}</p></div>
        <button type="button" className="aip-button" disabled={busy || isPrivate} onClick={() => void exportData('html')}>{t('import.exportBookmarksBtn')}</button>
        {feedback('export-html')}
      </div>
      <div className="aip-file-row" data-setting="export-profile-json">
        <div><h3>{t('import.exportProfile')}</h3><p className="aip-copy">{t('import.exportProfileDesc')}</p></div>
        <button type="button" className="aip-button" disabled={busy || isPrivate} onClick={() => void exportData('json')}>{t('import.exportProfileBtn')}</button>
        <label className="aip-history" data-setting="export-include-history"><input type="checkbox" checked={includeHistory} disabled={busy || isPrivate} onChange={event => setIncludeHistory(event.target.checked)}/><span>{t('import.includeHistory')}</span></label>
        {feedback('export-json')}
      </div>
      <p className="aip-privacy">{t('import.privacy')}</p>
    </div>
    {!batch && Boolean(result.batches?.length) && <div className="aip-section aip-previous" data-setting="import-batches">
      <header className="aip-header"><h2 className="aip-heading">{t('import.batches')}</h2><p className="aip-copy">{t('import.batchesDesc')}</p></header>
      <ul>{result.batches!.map(item => <li key={item.id}><span><strong>{item.browser} · {item.name}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></span><button type="button" className="aip-button" disabled={busy || isPrivate} onClick={() => void undo(item.id)}>{t('import.undoThis')}</button></li>)}</ul>
      {feedback('previous')}
    </div>}
  </section>;
}
