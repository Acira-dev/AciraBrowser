// The rows of the receiving screens (R4 receiving and checking, R5 the preview, R7 done): which parts there are, what each says, and which are ticked. Pure.
// A part's second line is the checklist's own (ChecklistRows `rowDetail`), so the sending and the receiving screens count the same way.
import { t, type MessageId } from '../../i18n';
import { rowDetail } from './ChecklistRows';
import { ROW_ORDER } from './sendModel';
import type { TransferPreview, TransferRow } from './types';

/** A row's name as the receiving screens show it (picture 14: "Spaces" has its counts under it). */
export const ROW_NAME: Record<TransferRow, MessageId> = {
  look: 'transfer.row.look', spaces: 'transfer.row.spacesShort', bookmarks: 'transfer.row.bookmarks', history: 'transfer.row.history', settings: 'transfer.row.settings', privacy: 'transfer.row.privacy',
  reading: 'transfer.row.reading', extensions: 'transfer.row.extensions', openTabs: 'transfer.row.openTabs', pictures: 'transfer.row.pictures', passwords: 'transfer.row.passwords'
};

/** The parts of a transfer that carry: from the preview's `included` (an array of row names, or a record of booleans). */
export function includedRows(included: TransferPreview['included'] | null | undefined): TransferRow[] {
  if (Array.isArray(included)) return ROW_ORDER.filter((row) => included.includes(row));
  if (included && typeof included === 'object') return ROW_ORDER.filter((row) => (included as Record<string, boolean>)[row] === true);
  return [];
}

/**
 * The parts the manifest announces, before the data has arrived. The manifest has counts for what the sender included (a row nobody ticked has none); it does not list
 * "Look and layout" and "Settings, search and shortcuts" (they have no count), so those two are assumed; when the manifest carries `included` (main may add it) it is exact.
 */
export function manifestRows(manifest: { counts?: Record<string, number>; included?: unknown } | null | undefined): TransferRow[] {
  if (!manifest) return [];
  if (manifest.included) return includedRows(manifest.included as TransferPreview['included']);
  const has = (key: string) => typeof manifest.counts?.[key] === 'number';
  const on: Record<TransferRow, boolean> = {
    look: true, spaces: has('spaces'), bookmarks: has('bookmarks'), history: has('history'), settings: true, privacy: has('sites'), reading: has('reading') || has('routines'),
    extensions: has('extensions') || has('webApps'), openTabs: has('openTabs'), pictures: has('pictures'), passwords: has('passwords')
  };
  return ROW_ORDER.filter((row) => on[row]);
}

/** What goes under a part's name: the Spaces' three counts, the others their count (a bare number for bookmarks, "9,812 visits" for history, ...). */
export function rowSub(row: TransferRow, counts: Record<string, number>): string | undefined {
  const detail = rowDetail(row, counts);
  if (row === 'spaces') return detail.small;
  if (row === 'extensions' || row === 'passwords') return detail.ct;
  return detail.ct ?? detail.small;
}

export type RowState = 'tick' | 'wait' | 'later';
export interface ReceiveRowModel { id: TransferRow; name: string; sub?: string; state: RowState; /** Off in the preview: the person left it out. */ off?: boolean }

/**
 * R4 while bytes flow: every announced part waits (a dot); the ones the bytes have not reached yet are dimmer. While the data is being checked, `ticked` of them have a
 * tick, in order. `fraction` is the verified share of the bytes (never moves back).
 */
export function receivingRows(rows: readonly TransferRow[], counts: Record<string, number>, fraction: number, ticked = 0): ReceiveRowModel[] {
  const total = Math.max(1, rows.length);
  return rows.map((row, index) => ({
    id: row, name: t(ROW_NAME[row]), sub: rowSub(row, counts),
    state: index < ticked ? 'tick' as const : ticked === 0 && index / total >= Math.min(1, fraction) + 0.1 ? 'later' as const : 'wait' as const
  }));
}
/** R5 and R7: every part ticked (R5: unless the person unticked it). */
export const readyRows = (rows: readonly TransferRow[], counts: Record<string, number>, left: Partial<Record<TransferRow, boolean>> = {}): ReceiveRowModel[] =>
  rows.map((row) => ({ id: row, name: t(ROW_NAME[row]), sub: rowSub(row, counts), state: 'tick' as const, ...(left[row] === false ? { off: true } : {}) }));

/** The apply's steps, in the order main reports them (desktop/transfer/index.cjs APPLY_STEPS), with the words of R6 (spec 4.3). */
export const APPLY_STEPS = ['spaces', 'bookmarks', 'history', 'settings', 'sites', 'other'] as const;
export type ApplyStep = (typeof APPLY_STEPS)[number];
export const APPLY_NAME: Record<ApplyStep, MessageId> = {
  spaces: 'transfer.apply.spaces', bookmarks: 'transfer.apply.bookmarks', history: 'transfer.apply.history', settings: 'transfer.apply.settings', sites: 'transfer.apply.sites', other: 'transfer.apply.other'
};
/** The steps R6 lists for this transfer: a step the person did not bring is not listed ("Bookmarks" of a profile with none). */
export function applyStepsFor(rows: readonly TransferRow[]): ApplyStep[] {
  const has = (...names: TransferRow[]) => names.some((name) => rows.includes(name));
  return APPLY_STEPS.filter((step) => {
    switch (step) {
      case 'spaces': return has('spaces', 'openTabs');
      case 'bookmarks': return has('bookmarks');
      case 'history': return has('history');
      case 'settings': return has('settings', 'look');
      case 'sites': return has('privacy');
      case 'other': return true;
    }
  });
}
/** R6's rows: the steps main has finished tick, the one it is on is live (the small loader), the rest wait. */
export function applyRows(steps: readonly ApplyStep[], done: readonly string[], current: string | null | undefined): { id: ApplyStep; name: string; state: 'tick' | 'live' | 'wait' }[] {
  const live = current && steps.includes(current as ApplyStep) && !done.includes(current) ? current : steps.find((step) => !done.includes(step));
  return steps.map((step) => ({ id: step, name: t(APPLY_NAME[step]), state: done.includes(step) ? 'tick' as const : step === live ? 'live' as const : 'wait' as const }));
}
