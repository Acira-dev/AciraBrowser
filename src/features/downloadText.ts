import type { BrowserDownload } from '../runtime/types';
import { t, type MessageId } from '../i18n';

export const bytes = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : value >= 1e6 ? `${Math.round(value / 1e6)} MB` : `${Math.max(1, Math.round(value / 1e3))} KB`;
/** Finished downloads keep their size as the native side wrote it ("3072 / 3072 KB"); show the total. */
export const sizeOf = (item: BrowserDownload) => item.totalBytes && item.totalBytes > 0 ? bytes(item.totalBytes) : item.size.includes('/') ? item.size.split('/').pop()!.trim() : item.size;
export const statusText = (status: string) => { const id = `dl.status.${status}` as MessageId; const text = t(id); return text === id ? status : text; };
/** The note on a sidebar download row: how far a running one is, a finished file's size, otherwise its status in the interface language. */
export const sidebarNote = (item: BrowserDownload) => item.status === 'Downloading' ? (item.totalBytes ? `${Math.min(99, Math.round((item.receivedBytes || 0) / item.totalBytes * 100))}%` : '…') : item.status === 'Ready' ? sizeOf(item) : statusText(item.status);
