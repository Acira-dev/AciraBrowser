import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { currentLocale, t } from '../../i18n';
import { runtime } from '../../runtime/client';
import type { UpdateStatus } from '../../runtime/nativeNetwork';
import { noteUpdatePhase } from '../../ui/updatePhase';

/** What the interface shows of an update: nothing (null) until one is downloading, then its progress (or where it was paused), then the finished
 *  download. Main tells every window when that changes ('update-changed'; during a download about twice a second, only when the percent moved). */
export interface UpdateView {
  phase: 'downloading' | 'paused' | 'ready' | 'error';
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
  /** Acira's own download: it pauses and resumes where it stopped. */
  pausable: boolean;
  /** Paused again because a Resume could not connect (offline, the feed unreachable); the bytes are kept and the next Resume goes on from them. */
  failed?: boolean;
  /** The page to download Acira from by hand, when main offers it after repeated failures (only ever acirabrowser.com). */
  lastResort?: string | null;
  /** A download that stopped (phase 'error'): when main tries again by itself (epoch ms; null once the quick tries are used up or while one runs), how many tries failed in a row, and why. */
  retryAt?: number | null;
  failures?: number;
  cause?: 'network' | 'file' | 'other';
  /** Main is looking again right now (a retry, or a press of Try again): the stopped look stays, with "Retrying…", instead of the pill going away for the length of the look. */
  retrying?: boolean;
}

/** The last-resort download page main offers after repeated failures, or null. Only a page of acirabrowser.com is ever opened from it. */
export const lastResortUrl = (update: UpdateStatus | undefined): string | null => { const url = update?.lastResort?.url; return typeof url === 'string' && /^https:\/\/acirabrowser\.com\//.test(url) ? url : null; };

const view = (update: UpdateStatus | undefined): UpdateView | null => {
  if (!update?.available) return null;
  // 'error' with an update known: the download stopped (main keeps the version and the bytes) and says so with `interrupted`. A failed look with nothing known stays invisible, as before.
  // The look that main makes before it tries again ('checking', the version and its bytes still held) is the same stopped download: the pill must not go away for it.
  const stopped = update.status === 'error' && update.interrupted === true, retrying = update.status === 'checking' && update.total != null; // main reports interrupted:false while it looks, but the version and its bytes are still held
  if (update.status !== 'downloading' && update.status !== 'paused' && update.status !== 'ready' && !stopped && !retrying) return null;
  const ready = update.status === 'ready', phase = stopped || retrying ? 'error' : update.status as 'downloading' | 'paused' | 'ready';
  noteUpdatePhase(phase);
  return { phase, version: update.available, percent: ready ? 100 : Math.max(0, Math.min(100, update.progress ?? 0)), transferred: update.transferred ?? null, total: update.total ?? null, speed: update.speed ?? null, notes: update.notes || '', prompt: ready && update.prompt === true, pausable: !ready && update.pausable === true, failed: phase === 'paused' && Boolean(update.error), lastResort: lastResortUrl(update),
    ...(phase === 'error' ? { retryAt: retrying ? null : update.retry?.at ?? null, failures: update.retry?.failures ?? 0, cause: update.cause ?? 'other', retrying } : {}) };
};

export { view as updateView };

/** Where the page learns the updater's status from: read it now, and hear when main says it changed ('update-changed'). */
export interface UpdateSource {
  read(): Promise<UpdateStatus | undefined>;
  subscribe(changed: () => void): () => void;
}

/** One reading of the updater for the whole page, kept for as long as the page lives (beta.14, item 13). The toolbar's Update pill used to read it itself
 *  when it mounted, and the pill is mounted again whenever its place changes (the address-in-the-sidebar layout puts the toolbar's buttons into the
 *  sidebar's row, the top bar puts them back): a fresh mount began with nothing, and a first read that failed (swallowed) left it with nothing until main's
 *  next 'update-changed', which a paused or finished download never sends. Now the last status is held here: a mount shows it at once, a read that fails
 *  keeps it and tries again, and the status is read again when the window is looked at and, while a download runs, now and then. The download itself is
 *  main's; this only looks at it. */
export function createUpdateStore(source: UpdateSource, { retries = [1000, 3000, 10000], poll = 8000, setTimer = setTimeout, clearTimer = clearTimeout, setRepeat = setInterval, clearRepeat = clearInterval }: { retries?: number[]; poll?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; setRepeat?: typeof setInterval; clearRepeat?: typeof clearInterval } = {}) {
  const listeners = new Set<() => void>();
  let status: UpdateStatus | undefined, version = 0, request = 0, failures = 0, retry: ReturnType<typeof setTimeout> | null = null, repeat: ReturnType<typeof setInterval> | null = null, stop: (() => void) | null = null;
  const inFlight = () => Boolean(status && ['downloading', 'checking'].includes(status.status));
  const tell = () => { for (const listener of [...listeners]) listener(); };
  const settle = (next: UpdateStatus | undefined) => { status = next; version++; failures = 0; watch(); tell(); };
  /** Reads the status now. A failed read keeps what is known and tries again (1 s, 3 s, 10 s); an older read that comes back late is dropped. */
  function refresh(): void {
    const id = ++request;
    if (retry) { clearTimer(retry); retry = null; }
    source.read().then((next) => { if (id === request) settle(next); }, () => {
      if (id !== request) return;
      const wait = retries[failures++];
      if (wait !== undefined) retry = setTimer(() => { retry = null; refresh(); }, wait);
    });
  }
  function begin(): void {
    if (stop) return;
    stop = source.subscribe(refresh);
    refresh();
  }
  // The safety net while a download runs: a missed 'update-changed' (a window that was busy, a first read that failed) is corrected by the next look.
  function watch(): void {
    if (listeners.size && inFlight() && !repeat) repeat = setRepeat(refresh, poll);
    else if ((!listeners.size || !inFlight()) && repeat) { clearRepeat(repeat); repeat = null; }
  }
  return {
    /** The last status read (undefined before the first read, or when there is no updater here), and a counter that moves with every read. */
    get: () => status,
    version: () => version,
    refresh,
    subscribe(listener: () => void): () => void {
      listeners.add(listener); begin(); watch();
      return () => { listeners.delete(listener); watch(); };
    },
    /** Looks again (the window was focused or came back into view). */
    nudge: refresh,
  };
}

const store = createUpdateStore({
  read: () => runtime.service({ type: 'update.status' }).then((result) => result.update),
  subscribe: (changed) => runtime.subscribeBrowser?.((event) => { if (event.type === 'update-changed') changed(); }) ?? (() => undefined),
});
if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.nudge(); });
  window.addEventListener('focus', () => store.nudge());
}

/** The updater's status as the page holds it, picked into what a caller shows. Each change of the status is a new object, so an effect keyed on it runs
 *  again on every change. `fresh`: show nothing until this mount has heard an answer of its own (the panels, which open at the size of what they show and
 *  must not open on a status held from earlier); the toolbar's pill shows what the page already knows, at once. */
function useUpdateRead<T>(pick: (update: UpdateStatus | undefined) => T | null, fresh = false): T | null {
  const mounted = useRef(store.version());
  const stamp = useSyncExternalStore(store.subscribe, store.version, store.version);
  // Every status change makes a new picked object (the pill's effects are keyed on it), the same status read twice included.
  const picked = useMemo(() => (fresh && stamp === mounted.current ? null : pick(store.get())), [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every mount asks again (the held status shows meanwhile): a mount that finds the status held from a while ago corrects it within a moment.
  useEffect(() => { store.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return picked;
}

/** The update in flight or waiting for a restart, or null. */
export const useUpdateStatus = ({ fresh = false }: { fresh?: boolean } = {}): UpdateView | null => useUpdateRead(view, fresh);

/** The first launch on a new version: its notes (plain text) and whether the popup for them is still to be shown (`pending`), or null when this launch is not one or the feed had no notes. */
export interface WhatsNew { version: string; notes: string; pending: boolean }
const welcome = (update: UpdateStatus | undefined): WhatsNew | null => (update?.whatsNew?.notes ? { version: update.whatsNew.version, notes: update.whatsNew.notes, pending: update.welcome === true } : null);
export const useWhatsNew = ({ fresh = false }: { fresh?: boolean } = {}): WhatsNew | null => useUpdateRead(welcome, fresh);

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

/** Pause keeps the bytes already downloaded (and stays paused across a quit); Resume goes on from there. Every window hears 'update-changed'. */
/** Try again now, after a download stopped: main treats update.check from the interface as a person's own check (it looks again and goes on from the held bytes, or starts afresh). */
export const tryAgainUpdate = () => runtime.service({ type: 'update.check' }).catch(() => undefined);
export const pauseUpdate = () => runtime.service({ type: 'update.pause' }).catch(() => undefined);
export const resumeUpdate = () => runtime.service({ type: 'update.resume' }).catch(() => undefined);

const unit = (value: number, scale: number, digits: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value / scale);
/** The unit a size is shown in, and its decimals: [scale, label, digits]. */
const scaleOf = (bytes: number): [number, string, number] => bytes >= 1e9 ? [1e9, 'GB', 1] : bytes >= 1e6 ? [1e6, 'MB', bytes >= 1e8 ? 0 : 1] : [1e3, 'KB', 0];
/** "382 MB", "1.4 GB", "820 KB": the size of a download, in the viewer's number format. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${unit(bytes, 1e9, 1)} GB`;
  if (bytes >= 1e6) return `${unit(bytes, 1e6, bytes >= 1e8 ? 0 : 1)} MB`;
  return `${unit(Math.max(1, bytes), 1e3, 0)} KB`;
}
/** "160 of 382 MB": how much of the file is here, in the unit of the whole (the unit once). */
export function formatShare(done: number, total: number): string {
  const [scale, label, digits] = scaleOf(total);
  return t('update.sizeOf', { done: unit(Math.min(done, total), scale, digits), total: `${unit(total, scale, digits)} ${label}` });
}
const amount = (value: number, unitName: 'minute' | 'hour') => new Intl.NumberFormat(currentLocale(), { style: 'unit', unit: unitName, unitDisplay: 'short' }).format(value);
type DurationFormatter = { format: (duration: { hours: number; minutes: number }) => string };
/** "3 min left", "1 hr, 25 min left", "less than a minute left": the time a download still needs, rounded so it does not flicker (whole minutes,
 *  then five-minute steps past the hour), in the interface's language. */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return t('update.lessThanMinute');
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t('update.timeLeft', { time: amount(minutes, 'minute') });
  const steps = Math.round(minutes / 5) * 5, hours = Math.floor(steps / 60), rest = steps % 60;
  const Duration = (Intl as unknown as { DurationFormat?: new (locale: string, options: { style: 'short' }) => DurationFormatter }).DurationFormat;
  const time = Duration ? new Duration(currentLocale(), { style: 'short' }).format({ hours, minutes: rest }) : rest ? `${amount(hours, 'hour')} ${amount(rest, 'minute')}` : amount(hours, 'hour');
  return t('update.timeLeft', { time });
}
/** The panel's line under the title: "160 of 382 MB · 3 min left" while it downloads (the time once the speed is known), "160 of 382 MB · resumes where
 *  it stopped" while paused ("· Connection failed" when a Resume could not connect), the percent alone before the size is known. */
export function downloadLine(update: UpdateView): string {
  const failed = update.phase === 'paused' && update.failed;
  if (!update.total || update.transferred === null) { const short = t('update.downloadDetailShort', { percent: update.percent }); return failed ? `${short} · ${t('app.connectionFailed')}` : short; }
  const share = formatShare(update.transferred, update.total);
  if (update.phase === 'paused') return `${share} · ${failed ? t('app.connectionFailed') : t('update.resumesWhereStopped')}`;
  return update.speed ? `${share} · ${formatTimeLeft((update.total - update.transferred) / update.speed)}` : share;
}

/** "Retrying in 2 min": when main tries again by itself (rounded up to whole minutes, like the time left); "Retrying…" when that is under a minute away. */
export function formatRetryIn(at: number, now = Date.now()): string {
  const seconds = Math.max(0, (at - now) / 1000);
  return seconds < 60 ? t('update.retryingSoon') : t('update.retryIn', { time: amount(Math.ceil(seconds / 60), 'minute') });
}
/** The panel's lines when a download stopped: why and how much is here ("Connection failed · 9.9 of 24 MB"), and when it tries again ("Retrying in 2 min", "Retrying…" while it
 *  looks, or that Acira tries again later once the quick tries are used up). A file that failed its check says so in the sentence Settings uses and is not tried again by a press. */
export function errorLines(update: UpdateView): { what: string; when: string | null } {
  const share = update.total && update.transferred !== null ? formatShare(update.transferred, update.total) : t('update.downloadDetailShort', { percent: update.percent });
  if (update.retrying) return { what: share, when: t('update.retryingSoon') };
  if (update.cause === 'file') return { what: t('updates.notVerified'), when: null };
  const why = update.cause === 'network' ? t('app.connectionFailed') : t('update.causeOther');
  return { what: `${why} · ${share}`, when: update.retryAt ? formatRetryIn(update.retryAt) : t('update.retryLater') };
}
