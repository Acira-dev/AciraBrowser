import type { UpdateStatus } from '../../runtime/nativeNetwork';
import { currentLocale, t, translateText } from '../../i18n';

/** What the updater adds when a download stops (desktop/browser-services/app-updater.cjs): interrupted = a known update with its size, cause = what kind of trouble, retry = failed tries in a row and when the next automatic try is (ms since the epoch, null when none is planned). */
type Stopped = UpdateStatus & { interrupted?: boolean; cause?: 'network' | 'file' | 'other' | null; retry?: { failures: number; at: number | null } };
const inMinutes = (at: number, now: number) => new Intl.NumberFormat(currentLocale(), { style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 0 }).format(Math.max(1, Math.ceil((at - now) / 60000)));

/** Settings > About's update row, apart from the panel so tests can read it: the line under the title and the row's button. */
export function describe(status?: Stopped, now: number = Date.now()) {
  if (!status) return t('updates.reading');
  switch (status.status) {
    // The updater says why in English (app-updater.cjs, mac-app-update.cjs); each reason is in the catalog.
    case 'unsupported': return status.reason ? translateText(status.reason) : t('updates.notAvailableHere');
    case 'checking': return t('updates.checking');
    case 'available': return t('updates.versionAvailable', { version: status.available ?? '' });
    case 'downloading': return status.progress ? t('updates.downloadingProgress', { version: status.available ?? '', percent: status.progress }) : t('updates.downloadingVersion', { version: status.available ?? '' });
    // Paused from the toolbar's update panel (and still paused after a relaunch): the row says so and its button resumes. A Resume that could not
    // connect is paused again with the reason (error): the row says the connection failed, the note below gives the technical detail.
    case 'paused': { const line = t('updates.pausedProgress', { version: status.available ?? '', percent: status.progress ?? 0 }); return status.error ? `${line} · ${t('app.connectionFailed')}` : line; }
    case 'ready': return t('updates.versionReady', { version: status.available ?? '' });
    case 'current': return t('updates.upToDate');
    // One line: the updater's own words (a 200-character HttpError on a Mac) wrapped the row to five lines and pushed its button down; they go in the note below.
    // Three different failures, three different sentences (every error used to read "Could not check for updates."): a file that did not pass its check was not installed;
    // a download that stopped names its version and when Acira tries again; only a failed look is a failed check. The updater's own words stay in the note below the group.
    case 'error':
      if (status.cause === 'file') return t('updates.notVerified');
      if (status.interrupted && status.available) return status.retry?.at ? t('updates.downloadFailedRetry', { version: status.available, time: inMinutes(status.retry.at, now) }) : t('updates.downloadFailedLater', { version: status.available });
      return t('updates.checkFailed', { error: '' }).trim();
    default: return t('connection.torStatus.notChecked');
  }
}

/** The row's one button for a status, and whether it is off. Its words never change while it waits (it used to read "Checking…", shrinking by a
 *  third and jumping, and kept saying so through the download): a check stays "Check for updates" while it checks, and a check keeps the button as
 *  it is (a second press is ignored by the updater, app-updater.cjs check()). The line under the title says what is happening.
 *  While Acira's own download runs, the button pauses it, as the ring in the toolbar's update panel does; paused, it resumes. A download that cannot
 *  pause (electron-updater's own, status.pausable false) keeps the button as it was, off. */
export function rowAction(status?: Stopped): { action: 'update.install' | 'update.download' | 'update.pause' | 'update.resume' | 'update.check'; disabled: boolean; retry?: true } {
  const downloading = status?.status === 'downloading';
  if (status?.status === 'ready') return { action: 'update.install', disabled: false };
  // a download that stopped (not one refused for its check): the same press, a manual check that resumes the bytes, worded "Try again"
  if (status?.status === 'error' && status.interrupted && status.available && status.cause !== 'file') return { action: 'update.check', disabled: false, retry: true };
  if (status?.status === 'paused') return { action: 'update.resume', disabled: false };
  if (downloading && status.pausable) return { action: 'update.pause', disabled: false };
  if (status?.status === 'available' || (downloading && status.autoDownload === false)) return { action: 'update.download', disabled: downloading };
  return { action: 'update.check', disabled: !status?.supported || downloading };
}
