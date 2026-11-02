import { useEffect, useState } from 'react';
import { runtime } from '../../runtime/client';
import type { UpdateStatus } from '../../runtime/nativeNetwork';

/** What the interface shows of an update: nothing (null) until one is downloading, then its progress, then the finished download. Main tells every
 *  window when that changes ('update-changed'; during a download about twice a second, only when the percent moved). */
export interface UpdateView {
  phase: 'downloading' | 'ready';
  version: string;
  /** 0–100. */
  percent: number;
  transferred: number | null;
  total: number | null;
  speed: number | null;
  /** The downloaded version's release notes, plain text (main strips every tag; this is only ever rendered as text). */
  notes: string;
  /** Nobody has been asked about this finished download yet. */
  prompt: boolean;
}

const view = (update: UpdateStatus | undefined): UpdateView | null => {
  if (!update?.available || (update.status !== 'downloading' && update.status !== 'ready')) return null;
  const ready = update.status === 'ready';
  return { phase: ready ? 'ready' : 'downloading', version: update.available, percent: ready ? 100 : Math.max(0, Math.min(100, update.progress ?? 0)), transferred: update.transferred ?? null, total: update.total ?? null, speed: update.speed ?? null, notes: update.notes || '', prompt: ready && update.prompt === true };
};

/** The updater's status, read now and again whenever main says it changed. `pick` turns it into what a caller shows; each read is a new object, so an effect keyed on it runs again on every change. */
function useUpdateRead<T>(pick: (update: UpdateStatus | undefined) => T | null): T | null {
  const [current, setCurrent] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      runtime.service({ type: 'update.status' })
        .then((result) => { if (alive) setCurrent(pick(result.update)); })
        .catch(() => { /* updates unavailable here (development run, Tor window): nothing to show */ });
    };
    read();
    const stop = runtime.subscribeBrowser?.((event) => { if (event.type === 'update-changed') read(); });
    return () => { alive = false; stop?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return current;
}

/** The update in flight or waiting for a restart, or null. */
export const useUpdateStatus = (): UpdateView | null => useUpdateRead(view);

/** The first launch on a new version: its notes (plain text) and whether the popup for them is still to be shown (`pending`), or null when this launch is not one or the feed had no notes. */
export interface WhatsNew { version: string; notes: string; pending: boolean }
const welcome = (update: UpdateStatus | undefined): WhatsNew | null => (update?.whatsNew?.notes ? { version: update.whatsNew.version, notes: update.whatsNew.notes, pending: update.welcome === true } : null);
export const useWhatsNew = (): WhatsNew | null => useUpdateRead(welcome);

/** Asks main to show the what's-new popup in this window. True for the single window that should (the one being looked at, once per launch). */
export const claimWhatsNew = () => runtime.service({ type: 'update.welcome' }).then((result) => result.update?.claimed === true).catch(() => false);

/** The version of an update that has finished downloading (waiting for a restart), or null. */
export function useUpdateReady(): string | null {
  const current = useUpdateStatus();
  return current?.phase === 'ready' ? current.version : null;
}

/** Saves the session, then installs and restarts (main: flush first, then quitAndInstall; the ordinary graceful quit restores the tabs). */
export const restartToUpdate = () => runtime.service({ type: 'update.install' }).catch(() => undefined);

/** Asks main for the one question about this finished download. True for the single window that should show it. */
export const claimUpdatePrompt = () => runtime.service({ type: 'update.prompt' }).then((result) => result.update?.claimed === true).catch(() => false);

const unit = (value: number, scale: number, digits: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value / scale);
/** "382 MB", "1.4 GB", "820 KB": the size of a download, in the viewer's number format. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${unit(bytes, 1e9, 1)} GB`;
  if (bytes >= 1e6) return `${unit(bytes, 1e6, bytes >= 1e8 ? 0 : 1)} MB`;
  return `${unit(Math.max(1, bytes), 1e3, 0)} KB`;
}
