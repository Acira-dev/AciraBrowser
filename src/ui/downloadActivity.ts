import type { BrowserDownload, BrowserSnapshot } from '../runtime/types';

/** A download that is still going or waiting to go on: bytes arriving, or paused and able to resume. */
export const isLiveDownload = (item: Pick<BrowserDownload, 'status'>) => item.status === 'Downloading' || item.status === 'Paused';

/** The downloads of one profile (the open window's, private windows included): a download without a profile id belongs to every window. */
export const profileDownloads = (state: Pick<BrowserSnapshot, 'downloads'>, profileId?: string) =>
  state.downloads.filter(item => !item.browserProfileId || item.browserProfileId === profileId);

/** What the downloads button shows: nothing (idle), bytes arriving (run), or only paused downloads (held). `progress` is the share of
 * the known sizes received, or null while no running download says how big it is. */
export interface DownloadActivity { phase: 'idle' | 'run' | 'held'; running: number; paused: number; progress: number | null }

export function downloadActivity(list: readonly Pick<BrowserDownload, 'status' | 'receivedBytes' | 'totalBytes'>[]): DownloadActivity {
  const live = list.filter(isLiveDownload), running = live.filter(item => item.status === 'Downloading').length, paused = live.length - running;
  const sized = live.filter(item => (item.totalBytes || 0) > 0);
  const total = sized.reduce((sum, item) => sum + (item.totalBytes || 0), 0), received = sized.reduce((sum, item) => sum + Math.min(item.totalBytes || 0, item.receivedBytes || 0), 0);
  return { phase: running ? 'run' : paused ? 'held' : 'idle', running, paused, progress: total > 0 ? Math.min(1, received / total) : null };
}

/** The most rows the downloads popup lists, and the height of each (a name and a line of detail on the panel system's identity row). */
export const PANEL_DOWNLOAD_ROWS = 5, PANEL_DOWNLOAD_ROW_HEIGHT = 44;

/** The rows the downloads popup shows: what is going on first, then the most recent, never more than `max`. */
export function panelDownloads<T extends Pick<BrowserDownload, 'status' | 'startedAt'>>(list: readonly T[], max = 5): T[] {
  return [...list].sort((a, b) => Number(isLiveDownload(b)) - Number(isLiveDownload(a)) || (b.startedAt || 0) - (a.startedAt || 0)).slice(0, max);
}

/** The popup's second line for a finished file that can run software: its warning first and no time. The row is narrow, so what gets cut
 * is the size, never the warning (it read "150 KB · 4:54 PM · Review before …" in every finish and language). */
export const panelWarnsFirst = (item: Pick<BrowserDownload, 'dangerous' | 'status'>) => !!item.dangerous && item.status === 'Ready';
