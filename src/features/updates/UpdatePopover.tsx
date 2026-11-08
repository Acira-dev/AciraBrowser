import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from '../../components/AppIcons';
import { UpdateMark } from './UpdateMark';
import { ScrollRegion } from '../../components/ScrollRegion';
import { NoteList } from './NoteList';
import { t } from '../../i18n';
import { runtime } from '../../runtime/client';
import { downloadLine, pauseUpdate, restartToUpdate, resumeUpdate, useUpdateStatus, type UpdateView } from './useUpdateReady';
import './update-pill.css';

/** What the toolbar's Update pill opens (and what opens by itself, once, when a download finishes): one question in the glass panel. Install now
 *  saves the session and restarts into the update (tabs and profile come back as they were); Later just closes, leaving the pill as the quiet way
 *  back; Read more shows this version's release notes in the same panel, as plain text (main has already stripped every tag; nothing here is HTML).
 *  The panel opens at the size of its note (popup.ts) and grows to the notes when Read more is chosen; long notes scroll inside. Nothing takes focus when it opens by itself.
 *  While the update downloads, the same pill (the dots) opens the same panel on the download instead (UpdateDownload). */
export function UpdatePopover({ close, reducedMotion }: { close: () => void; reducedMotion: boolean }) {
  const update = useUpdateStatus({ fresh: true }), [reading, setReading] = useState(false), [busy, setBusy] = useState(false), seen = useRef(false), notesBox = useRef<HTMLDivElement>(null);
  // The update went away under the panel (installed from the menu, or a failed re-check): nothing left to ask.
  useEffect(() => { if (update) seen.current = true; else if (seen.current) close(); }, [update, close]);
  if (update && update.phase !== 'ready') return <UpdateDownload update={update} reducedMotion={reducedMotion} close={close} />;
  const install = () => { setBusy(true); void restartToUpdate().finally(() => window.setTimeout(() => setBusy(false), 8000)); };
  const version = update?.version ?? '';
  return (
    <div className="update-popover" role="group" aria-labelledby="update-pop-title" data-view={reading ? 'notes' : 'ask'} aria-busy={busy || undefined} data-popup-pending={update ? undefined : ''}>
      <div className="acira-menu-row acira-menu-row-identity">
        <span className="acira-menu-icon update-pop-mark" aria-hidden="true"><UpdateMark panel preset="check" tone="accent" reducedMotion={reducedMotion} /></span>
        <span className="acira-menu-title" id="update-pop-title">{reading ? t('update.whatsNew') : t('update.readyTitle')}<span className="acira-menu-sub">{version && t('update.version', { version })}</span></span><span />
      </div>
      {reading
        ? <div className="update-pop-scroll"><ScrollRegion contentRef={notesBox}><div className="update-pop-notes" tabIndex={0} role="region" aria-label={t('update.whatsNew')}>{<NoteList notes={update?.notes || t('update.noNotes')} />}</div></ScrollRegion></div>
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

/** The download, in the same panel (founder, 3 Nov 2026, option B): the dots, "Downloading update" and the version, and at the end of that row a ring
 *  that fills with the real progress. The ring is the control: a press pauses (its glyph is pause), and paused it keeps its fill in a muted ink and
 *  resumes (play). Under it, how much is here and how long is left (or that it resumes where it stopped), and What's new, which shows this version's
 *  notes in the panel the way Read more does. Paused, the dots dim here and in the toolbar. A download Acira cannot pause (electron-updater
 *  downloading by itself) shows the ring without a control. Nothing takes focus when it opens. */
export function UpdateDownload({ update, reducedMotion, close }: { update: UpdateView; reducedMotion: boolean; close?: () => void }) {
  const [reading, setReading] = useState(false), [asked, setAsked] = useState<'pause' | 'resume' | null>(null), notesBox = useRef<HTMLDivElement>(null);
  // The press shows at once (main answers in a moment, then every window hears 'update-changed'); the next status settles it. Every status read, not
  // only a new phase: a Resume that cannot connect is paused again before this window reads 'downloading', and the press then stayed on screen.
  useEffect(() => setAsked(null), [update]);
  const paused = asked ? asked === 'pause' : update.phase === 'paused', percent = Math.max(0, Math.min(100, update.percent));
  const toggle = () => { const next = paused ? 'resume' : 'pause'; setAsked(next); void (next === 'pause' ? pauseUpdate() : resumeUpdate()); };
  const ring = (
    <svg className="update-ring-dial" viewBox="0 0 26 26" aria-hidden="true">
      <circle className="update-ring-track" cx="13" cy="13" r="11" />
      <circle className="update-ring-fill" cx="13" cy="13" r="11" pathLength={100} strokeDasharray={`${percent} 100`} transform="rotate(-90 13 13)" data-empty={percent === 0 || undefined} />
    </svg>
  );
  return (
    <div className="update-popover update-download" role="group" aria-labelledby="update-pop-title" data-view={reading ? 'notes' : 'download'} data-phase={paused ? 'paused' : 'downloading'}>
      <div className="acira-menu-row acira-menu-row-identity">
        <span className="acira-menu-icon update-pop-mark" aria-hidden="true"><UpdateMark panel preset={paused ? 'progressHeld' : 'progress'} progress={percent / 100} tone="ink" reducedMotion={reducedMotion} /></span>
        <span className="acira-menu-title" id="update-pop-title">{reading ? t('update.whatsNew') : paused ? t('update.pausedTitle') : t('update.downloadingTitle')}<span className="acira-menu-sub">{t('update.version', { version: update.version })}</span></span>
        {update.pausable
          ? <button type="button" className="update-ring" data-paused={paused || undefined} aria-label={paused ? t('update.resumeDownload') : t('update.pauseDownload')} aria-describedby="update-pop-detail" onClick={toggle}>{ring}<span className="update-ring-glyph">{paused ? <Play size={10} /> : <Pause size={10} />}</span></button>
          : <span className="update-ring" aria-hidden="true">{ring}</span>}
      </div>
      {reading
        ? <div className="update-pop-scroll"><ScrollRegion contentRef={notesBox}><div className="update-pop-notes" tabIndex={0} role="region" aria-label={t('update.whatsNew')}>{<NoteList notes={update.notes || t('update.noNotes')} />}</div></ScrollRegion></div>
        : <p className="update-pop-note update-pop-detail" id="update-pop-detail">{downloadLine({ ...update, phase: paused ? 'paused' : 'downloading' })}</p>}
      <div className="update-pop-actions update-pop-links">
        <button type="button" className="acira-button acira-button-quiet" onClick={() => setReading((value) => !value)}>{reading ? t('update.back') : t('update.whatsNew')}</button>
        {update.lastResort && !reading && <button type="button" className="acira-button acira-button-quiet" onClick={() => { void runtime.dispatch({ type: 'tab.new', url: update.lastResort! }); close?.(); }}>{t('update.lastResort')}</button>}
      </div>
    </div>
  );
}
