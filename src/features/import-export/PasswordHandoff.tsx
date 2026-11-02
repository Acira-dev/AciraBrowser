import { useState } from 'react';
import { Segmented } from '../../components/Segmented';
import { CheckMark } from '../../components/CheckMark';
import { DotMatrix } from '../../components/DotMatrix';
import { HANDOFF_BROWSERS, handoffBrowserFor, usePasswordHandoff, type HandoffBrowser } from '../passwords/handoff';
import { useT } from '../../i18n';
import './password-handoff.css';

type Handoff = ReturnType<typeof usePasswordHandoff>;

/** The steps, the file, the summary and the Recycle Bin reminder of "Bring your passwords". One body for two places: Settings ›
 *  Import & export (`variant="settings"`) and the setup import step's sheet (`variant="setup"`), which only differ in skin. */
export function HandoffBody({ handoff, from, variant, reducedMotion }: { handoff: Handoff; from?: string; variant: 'settings' | 'setup'; reducedMotion?: boolean }) {
  const t = useT();
  const [browser, setBrowser] = useState<HandoffBrowser>(() => handoffBrowserFor(from));
  const chosen = HANDOFF_BROWSERS.find(item => item.id === browser) ?? HANDOFF_BROWSERS[0];
  const { phase, preview, imported, trash, error } = handoff;
  const fresh = (preview?.new ?? 0) + (preview?.update ?? 0);
  const total = (imported?.added ?? 0) + (imported?.updated ?? 0);
  const button = variant === 'setup' ? 'fr-btn fr-btn-secondary' : 'aip-button';
  const primary = variant === 'setup' ? 'fr-btn fr-btn-primary' : 'aip-button aip-primary';
  const quiet = variant === 'setup' ? 'fr-link' : 'aip-button aip-quiet';
  const guide = phase === 'idle' || phase === 'choosing';
  return <div className="pwh-body" data-variant={variant} data-phase={phase}>
    {guide && <>
      <Segmented label={t('handoff.browserLabel')} value={browser} options={HANDOFF_BROWSERS.map(item => [item.id, item.name] as const)} onChange={setBrowser} />
      <ol className="pwh-steps" aria-label={t('handoff.title')}>
        <li><span className="pwh-n" aria-hidden="true">1</span><span>{t(chosen.menu)}</span></li>
        <li><span className="pwh-n" aria-hidden="true">2</span><span>{t(chosen.export)}</span></li>
        <li><span className="pwh-n" aria-hidden="true">3</span><span>{t('handoff.confirm')}</span></li>
      </ol>
      <p className="pwh-fast">{t('handoff.fast', { address: chosen.address })}</p>
    </>}
    {phase === 'preview' && preview && <div className="pwh-summary" role="status">
      <p className="pwh-line"><strong>{t('handoff.previewLine', { total: preview.total ?? 0, fresh: (preview.new ?? 0).toLocaleString() })}</strong></p>
      {!fresh && <p className="pwh-sub">{t('handoff.nothingNew')}</p>}
    </div>}
    {phase === 'done' && <div className="pwh-summary pwh-done" role="status">
      <p className="pwh-line pwh-good"><CheckMark size={16} /><strong>{total ? t('handoff.imported', { count: total }) : t('handoff.nothingNew')}</strong></p>
      <p className="pwh-sub">{t('handoff.remind')}</p>
    </div>}
    {error && <p className="pwh-error" role="alert">{error}</p>}
    {trash === 'trashed' && <p className="pwh-sub pwh-good-line" role="status"><CheckMark size={14} />{t('handoff.trashed')}</p>}
    {trash === 'failed' && !error && <p className="pwh-sub" role="alert">{t('handoff.trashFailed')}</p>}
    <div className="pwh-actions">
      {guide && <button type="button" className={primary} disabled={phase === 'choosing'} onClick={() => void handoff.choose()}>{phase === 'choosing' ? t('handoff.choosing') : t('handoff.choose')}</button>}
      {phase === 'choosing' && <DotMatrix preset="loader" size={16} reducedMotion={reducedMotion} />}
      {phase === 'preview' && <>
        <button type="button" className={primary} disabled={!fresh} onClick={() => void handoff.apply()}>{t('handoff.importBtn', { count: fresh })}</button>
        <button type="button" className={quiet} onClick={() => void handoff.choose()}>{t('handoff.another')}</button>
      </>}
      {phase === 'importing' && <button type="button" className={primary} disabled>{t('handoff.importing')}</button>}
      {phase === 'done' && <>
        {trash !== 'trashed' && <button type="button" className={button} disabled={trash === 'working'} onClick={() => void handoff.moveFile()}>{trash === 'working' ? t('handoff.trashing') : t('handoff.trash')}</button>}
        <button type="button" className={quiet} onClick={handoff.reset}>{t('handoff.another')}</button>
      </>}
    </div>
  </div>;
}

/** Settings › Import & export: the card, shown wherever the desktop password vault exists (never in a private window). */
export function PasswordHandoff({ from, onImported, reducedMotion }: { from?: string; onImported?: () => void; reducedMotion?: boolean }) {
  const t = useT();
  const handoff = usePasswordHandoff(onImported);
  if (!handoff.available) return null;
  return <div className="aip-section pwh" data-setting="import-passwords">
    <header className="aip-header">
      <h2 className="aip-heading">{t('handoff.title')}</h2>
      <p className="aip-copy">{t('handoff.intro')}</p>
    </header>
    <HandoffBody handoff={handoff} from={from} variant="settings" reducedMotion={reducedMotion} />
  </div>;
}
