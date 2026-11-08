import { useEffect, useRef } from 'react';
import { UpdateMark } from './UpdateMark';
import { t } from '../../i18n';
import { claimUpdatePrompt, claimWhatsNew, formatBytes, formatRetryIn, formatShare, useUpdateStatus, useWhatsNew, type UpdateView } from './useUpdateReady';
import './update-pill.css';

/** The tooltip of the download dot: what is happening, then how far it is ("42% · 160 of 382 MB · 5 MB/s"). Sizes and speed appear once they are known. */
export function downloadTip(update: UpdateView): string {
  const known = update.total && update.transferred !== null;
  const detail = known
    ? t('update.downloadDetail', { percent: update.percent, done: formatBytes(update.transferred!), total: formatBytes(update.total!), speed: update.speed ? formatBytes(update.speed) : '…' })
    : t('update.downloadDetailShort', { percent: update.percent });
  return `${t('update.downloadTip', { version: update.version })}\n${detail}`;
}
/** The tooltip of a paused download: what it is, then how much is here ("160 of 382 MB"). */
export function pausedTip(update: UpdateView): string {
  const share = update.total && update.transferred !== null ? formatShare(update.transferred, update.total) : t('update.downloadDetailShort', { percent: update.percent });
  return `${t('update.pausedTip', { version: update.version })}\n${share}`;
}

/** The tooltip of a download that stopped: which update, then when it tries again by itself (or "Retrying…" while it looks, or how to try, or that the file did not pass its check). */
export function errorTip(update: UpdateView): string {
  const second = update.retrying ? t('update.retryingSoon') : update.cause === 'file' ? t('updates.notVerified') : update.retryAt ? formatRetryIn(update.retryAt) : t('update.errorTipHint');
  return `${t('update.errorTip', { version: update.version })}\n${second}`;
}

/** The update, at the toolbar's right edge beside the Acira menu button. Nothing until an update is downloading (and no timers or frames then).
 *  Downloading: a small dot matrix that fills with the real progress; hover or focus it for the details. No line, no number on the toolbar.
 *  A click opens the update panel (UpdatePopover): the progress, a ring that pauses and resumes it, What's new. Paused: the same dots, held and dimmed.
 *  Downloaded: the same dots resolve into a check and a calm "Update" pill appears; main asks once (claimUpdatePrompt) and this opens the
 *  popup (Install now, Later, Read more). After Later the pill is the quiet way back. It never moves again; ignored, the update installs when Acira quits. */
export function UpdatePill({ onOpen, onOpenNotes, active, canAsk, reducedMotion }: { onOpen: () => void; onOpenNotes: () => void; active: boolean; canAsk: boolean; reducedMotion: boolean }) {
  const update = useUpdateStatus(), whatsNew = useWhatsNew(), open = useRef(onOpen), openNotes = useRef(onOpenNotes);
  open.current = onOpen; openNotes.current = onOpenNotes;
  // Asking is held back while something else is open or being typed (canAsk); the update stays unasked and is claimed the moment the toolbar is free.
  useEffect(() => { if (update?.prompt && canAsk) void claimUpdatePrompt().then((claimed) => { if (claimed) open.current(); }); }, [update, canAsk]);
  // The first launch on a new version shows its notes once, by itself, centred in the window (WhatsNewPopover); the same way, only when nothing else is open.
  // A moment after the window is up, so it arrives calmly after the browser's own arrival rather than with it.
  useEffect(() => {
    if (!whatsNew?.pending || !canAsk) return;
    const timer = window.setTimeout(() => { void claimWhatsNew().then((claimed) => { if (claimed) openNotes.current(); }); }, 1200);
    return () => window.clearTimeout(timer);
  }, [whatsNew, canAsk]);
  if (!update) return null;
  const ready = update.phase === 'ready', paused = update.phase === 'paused', stopped = update.phase === 'error';
  const tip = ready ? `${t('update.readyTip', { version: update.version })}\n${t('update.readyTipHint')}` : stopped ? errorTip(update) : paused ? pausedTip(update) : downloadTip(update), label = tip.replace('\n', '. ');
  return (
    <button type="button" className="update-pill" data-update-pill data-phase={update.phase} data-popup-trigger="" data-tip={tip} aria-label={label}
      aria-haspopup="dialog" aria-expanded={active} onClick={onOpen}>
      <span className="update-pill-mark" aria-hidden="true"><UpdateMark preset={ready ? 'check' : paused || stopped ? 'progressHeld' : 'progress'} progress={update.percent / 100} tone="ink" reducedMotion={reducedMotion} /></span>
      {ready && <span className="update-pill-label">{t('update.pill')}</span>}
    </button>
  );
}
