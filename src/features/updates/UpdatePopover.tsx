import { useEffect, useRef, useState } from 'react';
import { DotMatrix } from '../../components/DotMatrix';
import { ScrollRegion } from '../../components/ScrollRegion';
import { t } from '../../i18n';
import { restartToUpdate, useUpdateStatus } from './useUpdateReady';
import './update-pill.css';

/** What the toolbar's Update pill opens (and what opens by itself, once, when a download finishes): one question in the glass panel. Install now
 *  saves the session and restarts into the update (tabs and profile come back as they were); Later just closes, leaving the pill as the quiet way
 *  back; Read more shows this version's release notes in the same panel, as plain text (main has already stripped every tag; nothing here is HTML).
 *  The panel opens at the size of its note (popup.ts) and grows to the notes when Read more is chosen; long notes scroll inside. Nothing takes focus when it opens by itself. */
export function UpdatePopover({ close, reducedMotion }: { close: () => void; reducedMotion: boolean }) {
  const update = useUpdateStatus(), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), seen = useRef(false), notesBox = useRef<HTMLDivElement>(null);
  // The update went away under the panel (installed from the menu, or a failed re-check): nothing left to ask.
  useEffect(() => { if (update) seen.current = true; else if (seen.current) close(); }, [update, close]);
  const install = () => { setBusy(true); void restartToUpdate().finally(() => window.setTimeout(() => setBusy(false), 8000)); };
  const version = update?.version ?? '';
  return (
    <div className="update-popover" role="group" aria-labelledby="update-pop-title" data-view={reading ? 'notes' : 'ask'} aria-busy={busy || undefined}>
      <div className="acira-menu-row acira-menu-row-identity">
        <span className="acira-menu-icon update-pop-mark" aria-hidden="true"><DotMatrix preset="check" size={16} rows={5} tone="accent" reducedMotion={reducedMotion} /></span>
        <span className="acira-menu-title" id="update-pop-title">{reading ? t('update.whatsNew') : t('update.readyTitle')}<span className="acira-menu-sub">{version && t('update.version', { version })}</span></span><span />
      </div>
      {reading
        ? <div className="update-pop-scroll"><ScrollRegion contentRef={notesBox}><div className="update-pop-notes" tabIndex={0} role="region" aria-label={t('update.whatsNew')}>{update?.notes || t('update.noNotes')}</div></ScrollRegion></div>
        : <p className="update-pop-note">{t('update.readyBody')}</p>}
      <div className="update-pop-actions">
        <button type="button" className="acira-button acira-button-quiet" disabled={!update} onClick={() => setReading((value) => !value)}>{reading ? t('update.back') : t('update.readMore')}</button>
        <span className="update-pop-gap" />
        <button type="button" className="acira-button acira-button-secondary" onClick={close}>{t('update.later')}</button>
        <button type="button" className="acira-button acira-button-primary" disabled={busy || !update} onClick={install}>{busy ? t('update.installing') : t('update.installNow')}</button>
      </div>
    </div>
  );
}
