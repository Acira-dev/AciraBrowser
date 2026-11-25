// The sending side's rules, with no React in them: what the checklist says, whether it fits in a code, the countdown, the number field, the password
// meter, and which of main's answers is which message. The screens (SendFlow, FileFlow, TransferSheet) are thin over this, and the tests drive it directly.
// Spec: the design notes sections 4.2 (S1-S5), 4.5, 4.6.
import { currentLocale, t, type MessageId } from '../../i18n';
import { DEFAULT_INCLUDE } from './types';
import type { HistoryDays, OutgoingStatus, TransferInclude, TransferReason, TransferRow, TransferSummary } from './types';

/** How long an unclaimed code lives (desktop/transfer/constants.cjs CODE_TTL): the hairline under the chips starts at this and shrinks to nothing. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** The last minute of a code: the hairline and the time turn to the warning tone (spec 5.1 moment 3). */
export const LATE_MS = 60 * 1000;
/** The room a code has (desktop/transfer/index.cjs MAX_CODE_BYTES), used when a summary does not carry its own limit. */
export const CODE_LIMIT_BYTES = 24 * 1024 * 1024;
/** A locked profile file needs at least this many characters (desktop/transfer/profile-file.cjs MIN_PASSWORD). */
export const MIN_PASSWORD = 10;

/** The checklist, top to bottom (the order of desktop/transfer/inventory.cjs ROWS). */
export const ROW_ORDER: readonly TransferRow[] = ['look', 'spaces', 'bookmarks', 'history', 'settings', 'privacy', 'reading', 'extensions', 'openTabs', 'pictures', 'passwords'];

// ------------------------------------------------------------------------------------------------ the number field

/** Western, Arabic-Indic (U+0660-0669) and Extended Arabic-Indic / Persian (U+06F0-06F9) digits all become 0-9; everything else is dropped. */
export function foldDigits(raw: string): string {
  let out = '';
  for (const char of String(raw ?? '')) {
    const code = char.codePointAt(0)!;
    if (code >= 0x30 && code <= 0x39) out += char;
    else if (code >= 0x660 && code <= 0x669) out += String(code - 0x660);
    else if (code >= 0x6f0 && code <= 0x6f9) out += String(code - 0x6f0);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ time and size

/** "9:41": minutes and seconds left, never negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000)), minutes = Math.floor(total / 60), seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export interface Expiry { left: number; /** 1 right after the code was made, 0 when it ends: the width of the hairline. */ fraction: number; late: boolean }
/** Where a waiting code is in its life: `expiresAt` is ms on this computer's clock (OutgoingStatus.expiresAt). */
export function expiryOf(expiresAt: number | undefined, now: number): Expiry {
  const left = Math.max(0, (expiresAt ?? now) - now);
  return { left, fraction: Math.min(1, left / CODE_TTL_MS), late: left <= LATE_MS };
}

const numberOf = (value: number, digits: number) => new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: digits }).format(value);
const unitOf = (bytes: number): [number, string, number] => bytes >= 1e9 ? [1e9, 'GB', 1] : bytes >= 1e6 ? [1e6, 'MB', bytes >= 1e8 ? 0 : 1] : [1e3, 'KB', 0];
/** "3.1 MB", "820 KB": the same sizes the update pill shows. */
export function formatSize(bytes: number): string {
  const [scale, label, digits] = unitOf(Math.max(1, bytes));
  return `${numberOf(bytes / scale, digits)} ${label}`;
}
/** "2.4 of 3.1 MB": how much is there, in the unit of the whole (the unit once). */
export function shareParts(done: number, total: number): { done: string; total: string } {
  const [scale, label, digits] = unitOf(Math.max(1, total));
  return { done: numberOf(Math.min(done, total) / scale, digits), total: `${numberOf(total / scale, digits)} ${label}` };
}
/** A count with its group separators ("9,812"). */
export const formatCount = (value: number) => numberOf(value || 0, 0);

// ------------------------------------------------------------------------------------------------ the checklist

export interface Selection { include: TransferInclude; historyDays: HistoryDays }
export const defaultSelection = (): Selection => ({ include: { ...DEFAULT_INCLUDE }, historyDays: 0 });

/**
 * What one row adds to the compressed size, from the summary's estimate. History is estimated for all of it; a window takes its share by visits
 * (summary.counts.history90 / history30 against counts.history). Passwords have no estimate (they are small and only travel in a locked file or code).
 */
export function rowBytes(summary: TransferSummary, row: TransferRow, historyDays: HistoryDays): number {
  const base = summary.sizes[row] ?? 0;
  if (row !== 'history' || !historyDays) return base;
  const all = summary.counts.history ?? 0, window = summary.counts[historyDays === 90 ? 'history90' : 'history30'];
  return all > 0 && window != null ? Math.round(base * Math.min(1, window / all)) : base;
}
/** The estimated size of the ticked rows. */
export function estimateBytes(summary: TransferSummary, include: Partial<Record<TransferRow, boolean>>, historyDays: HistoryDays): number {
  return ROW_ORDER.reduce((sum, row) => sum + (include[row] ? rowBytes(summary, row, historyDays) : 0), 0);
}
/** Whether the ticked rows are over what a code can carry (spec 4.2: "Too large to send by code"). */
export const exceedsLimit = (summary: TransferSummary, include: Partial<Record<TransferRow, boolean>>, historyDays: HistoryDays): boolean =>
  estimateBytes(summary, include, historyDays) > (summary.limit || CODE_LIMIT_BYTES);

export type SelectionKind = { kind: 'default' } | { kind: 'defaultPasswords' } | { kind: 'everything' } | { kind: 'custom'; count: number };
/** Which words the summary pill uses: the default, the default plus passwords, everything, or "N parts selected". */
export function selectionKind(include: Partial<Record<TransferRow, boolean>>): SelectionKind {
  const ticked = ROW_ORDER.filter(row => include[row]);
  if (ticked.length === ROW_ORDER.length) return { kind: 'everything' };
  const matchesDefault = (withPasswords: boolean) => ROW_ORDER.every(row => Boolean(include[row]) === (row === 'passwords' ? withPasswords : DEFAULT_INCLUDE[row]));
  if (matchesDefault(false)) return { kind: 'default' };
  if (matchesDefault(true)) return { kind: 'defaultPasswords' };
  return { kind: 'custom', count: ticked.length };
}

// ------------------------------------------------------------------------------------------------ the password of a profile file

export type Strength = { bars: 0 | 1 | 2 | 3 | 4; label: 'none' | 'weak' | 'fair' | 'strong' };
/** A plain meter, not a promise: length first, then how many kinds of characters. Under 10 characters is weak and cannot be used. */
export function passwordStrength(password: string): Strength {
  const length = [...String(password ?? '').normalize('NFKC')].length;
  if (!length) return { bars: 0, label: 'none' };
  if (length < MIN_PASSWORD) return { bars: 1, label: 'weak' };
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(rule => rule.test(password)).length;
  let bars = 2;
  if (length >= 14 || kinds >= 3) bars++;
  if (length >= 16 && kinds >= 3) bars++;
  return { bars: bars as 2 | 3 | 4, label: bars >= 4 ? 'strong' : 'fair' };
}
export const passwordUsable = (password: string) => [...String(password ?? '').normalize('NFKC')].length >= MIN_PASSWORD;

// ------------------------------------------------------------------------------------------------ what went wrong

/** Main's own words for the errors it throws (desktop/transfer/handle.cjs `translated`): the code does not cross the process boundary, the message does, in this computer's language. */
const SAID: [MessageId, TransferReason][] = [
  ['transfer.send.tooLarge', 'too_large'], ['transfer.error.unavailable', 'unavailable'], ['transfer.error.notYet', 'unavailable'], ['transfer.error.damaged', 'damaged'], ['transfer.error.newer', 'newer'],
  ['transfer.file.newer', 'newer'], ['transfer.error.gone', 'gone'],
];
/**
 * The reason an error from main means. Over IPC only the message is certain, and main words it with the catalog's own text in the language of the window, so the
 * message is matched against the same catalog; a `code` (when one survives) and English wording are read too. An unknown one is `internal`.
 */
export function reasonOfError(error: unknown): TransferReason {
  const code = String((error as { code?: unknown })?.code ?? ''), message = String((error as { message?: unknown })?.message ?? error ?? '');
  const known: Record<string, TransferReason> = { 'too-large': 'too_large', too_large: 'too_large', unavailable: 'unavailable', 'not-yet': 'unavailable', offline: 'offline', busy: 'busy', rate_limited: 'rate_limited', slow: 'slow', newer: 'newer', damaged: 'damaged', gone: 'gone', invalid: 'invalid' };
  if (known[code]) return known[code];
  for (const [id, reason] of SAID) if (message.includes(t(id))) return reason;
  if (/too large to send/i.test(message)) return 'too_large';
  if (/isn.t available (?:right now|yet)/i.test(message)) return 'unavailable';
  if (/can.t reach|offline|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(message)) return 'offline';
  if (/newer acira/i.test(message)) return 'newer';
  return 'internal';
}

export const LIVE_OUTGOING = ['building', 'ready', 'confirming', 'sending', 'uploaded', 'done'] as const;
export const ENDED = ['cancelled', 'expired', 'failed'] as const;
export const isEnded = (state: string | undefined): boolean => state === 'cancelled' || state === 'expired' || state === 'failed';
export const isLiveOutgoing = (outgoing: OutgoingStatus | null | undefined): boolean => Boolean(outgoing) && (LIVE_OUTGOING as readonly string[]).includes(outgoing!.state);
/** The copy-to-clipboard text of a code: `amber-falcon-river-copper-lantern`. */
export const codeText = (words: readonly string[]): string => words.join('-');
