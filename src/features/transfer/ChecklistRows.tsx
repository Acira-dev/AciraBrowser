// The checklist of S1 (spec 4.2, pictures 04, 05 and 29), shared: the send sheet and the profile file draw it as it is, and the receiving preview (agent R) can draw the
// same rows from the counts of what arrived.
//
//   <ChecklistRows counts={summary.counts} sizes={summary.sizes} checked={include} onChange={(row, on) => …}
//                  history={{ days, onChange, highlight }} disabled={{ passwords: true }} />
//
//   rows      which rows, in which order (default: all eleven, in ROW_ORDER)
//   counts    TransferSummary.counts (spaces, pinned, favorites, bookmarks, history, shortcuts, sites, reading, routines, extensions, webApps, openTabs, pictures, passwords)
//   sizes     TransferSummary.sizes, only for the "3 · 8 MB" of New tab pictures
//   checked   which rows are ticked; onChange(row, on) is called when one is clicked
//   disabled  rows that cannot be changed (their box is dimmed)
//   history   the "All / Last 90 days / Last 30 days" select on the History row; `highlight` rings it (the "Too large" message points at it)
//   `SelectionPicker` below is the whole S1 body: the summary pill with Change, the always-visible Passwords row, and this list when it is unfolded.
import { ChevronDown } from 'lucide-react';
import { t, type MessageId } from '../../i18n';
import { defaultSelection, formatCount, formatSize, ROW_ORDER, selectionKind, type Selection } from './sendModel';
import type { HistoryDays, TransferRow, TransferSummary } from './types';

const NAME: Record<TransferRow, MessageId> = {
  look: 'transfer.row.look', spaces: 'transfer.row.spaces', bookmarks: 'transfer.row.bookmarks', history: 'transfer.row.history', settings: 'transfer.row.settings', privacy: 'transfer.row.privacy',
  reading: 'transfer.row.reading', extensions: 'transfer.row.extensions', openTabs: 'transfer.row.openTabs', pictures: 'transfer.row.pictures', passwords: 'transfer.row.passwords',
};

/** What a row shows besides its name: `ct` at the right, `small` as a second line under the name (rows with a second line are taller, picture 05). */
export function rowDetail(row: TransferRow, counts: Record<string, number>, sizes: Partial<Record<TransferRow, number>> = {}): { ct?: string; small?: string } {
  const n = (key: string) => counts[key], has = (key: string) => typeof counts[key] === 'number';
  switch (row) {
    case 'spaces': return has('spaces') ? { small: t('transfer.row.spacesCount', { spaces: t('transfer.send.spaces', { count: n('spaces') }), pinned: formatCount(n('pinned')), favorites: formatCount(n('favorites')) }) } : {};
    case 'bookmarks': return has('bookmarks') ? { ct: formatCount(n('bookmarks')) } : {};
    case 'history': return has('history') ? { ct: t('transfer.send.visits', { count: n('history') }) } : {};
    case 'settings': return has('shortcuts') ? { ct: t('transfer.row.settingsCount', { count: n('shortcuts') }) } : {};
    case 'privacy': return has('sites') ? { ct: t('transfer.row.privacyCount', { count: n('sites') }) } : {};
    case 'reading': return has('reading') || has('routines') ? { ct: `${formatCount(n('reading'))} · ${formatCount(n('routines'))}` } : {};
    case 'extensions': return { small: t('transfer.row.extensionsHint'), ...(has('extensions') || has('webApps') ? { ct: `${formatCount(n('extensions'))} · ${formatCount(n('webApps'))}` } : {}) };
    case 'openTabs': return has('openTabs') ? { ct: formatCount(n('openTabs')) } : {};
    case 'pictures': return has('pictures') ? { ct: sizes.pictures ? `${formatCount(n('pictures'))} · ${formatSize(sizes.pictures)}` : formatCount(n('pictures')) } : {};
    case 'passwords': return { small: t('transfer.row.passwordsGate'), ...(has('passwords') ? { ct: formatCount(n('passwords')) } : {}) };
    default: return {};
  }
}

const HISTORY: { days: HistoryDays; label: MessageId }[] = [{ days: 0, label: 'transfer.row.historyAll' }, { days: 90, label: 'transfer.row.history90' }, { days: 30, label: 'transfer.row.history30' }];
export const historyLabel = (days: HistoryDays) => t((HISTORY.find(option => option.days === days) ?? HISTORY[0]).label);

/** The History row's select: a native <select> (its menu is the system's, so it is never clipped by the sheet) drawn as the picture's small field. */
export function HistorySelect({ days, onChange, highlight = false, disabled = false }: { days: HistoryDays; onChange: (days: HistoryDays) => void; highlight?: boolean; disabled?: boolean }) {
  return (
    <span className="tx-select" data-focus={highlight ? '' : undefined} data-disabled={disabled ? '' : undefined}>
      <span aria-hidden="true">{historyLabel(days)}</span><ChevronDown className="tx-select-chev" aria-hidden="true" strokeWidth={1.5} />
      <select className="tx-select-input" aria-label={t('transfer.row.history')} value={String(days)} disabled={disabled} onChange={event => onChange(Number(event.target.value) as HistoryDays)}>
        {HISTORY.map(option => <option key={option.days} value={String(option.days)}>{t(option.label)}</option>)}
      </select>
    </span>
  );
}

export interface ChecklistRowsProps {
  rows?: readonly TransferRow[];
  counts: Record<string, number>;
  sizes?: Partial<Record<TransferRow, number>>;
  checked: Partial<Record<TransferRow, boolean>>;
  onChange: (row: TransferRow, on: boolean) => void;
  disabled?: Partial<Record<TransferRow, boolean>>;
  history?: { days: HistoryDays; onChange: (days: HistoryDays) => void; highlight?: boolean };
  className?: string;
}

export function ChecklistRows({ rows = ROW_ORDER, counts, sizes, checked, onChange, disabled = {}, history, className = '' }: ChecklistRowsProps) {
  return (
    <div className={`tx-list ${className}`.trim()}>
      {rows.map(row => {
        const { ct, small } = rowDetail(row, counts, sizes);
        return (
          <label key={row} className={`tx-item${small ? ' two' : ''}`} data-row={row} data-off={checked[row] ? undefined : ''}>
            <input type="checkbox" className="tx-check" checked={Boolean(checked[row])} disabled={Boolean(disabled[row])} onChange={event => onChange(row, event.target.checked)} />
            <span className="nm">{t(NAME[row])}{small && <small className="tx-nm-sub">{small}</small>}</span>
            {ct && <span className="ct tx-count">{ct}</span>}
            {row === 'history' && history && <HistorySelect days={history.days} onChange={history.onChange} highlight={history.highlight} disabled={!checked.history || Boolean(disabled.history)} />}
          </label>
        );
      })}
    </div>
  );
}

export interface SelectionPickerProps {
  /** The counts and estimates; null while main is still working them out (the pill and Passwords row show without numbers). */
  summary: TransferSummary | null;
  selection: Selection;
  onChange: (next: Selection) => void;
  expanded: boolean;
  onExpanded: (open: boolean) => void;
  /** The ticked rows are over what a code can carry: the History select is ringed. */
  tooLarge?: boolean;
  /** Rows that cannot be changed. */
  disabled?: Partial<Record<TransferRow, boolean>>;
}

/** The S1 body: the summary pill with Change (it unfolds the full list), the Passwords row that is always visible, and the list. */
export function SelectionPicker({ summary, selection, onChange, expanded, onExpanded, tooLarge = false, disabled = {} }: SelectionPickerProps) {
  const kind = selectionKind(selection.include);
  const pill = kind.kind === 'everything' ? t('transfer.send.everything') : kind.kind === 'default' ? t('transfer.send.default') : kind.kind === 'defaultPasswords' ? t('transfer.send.defaultPasswords') : t('transfer.send.custom', { count: kind.count });
  const counts = summary?.counts ?? {};
  const set = (row: TransferRow, on: boolean) => onChange({ ...selection, include: { ...selection.include, [row]: on } });
  const passwords = summary?.passwordsAvailable ?? counts.passwords;
  return (
    <>
      <div className="tx-pill" data-open={expanded ? '' : undefined}>
        <span className="tx-pill-text">{pill}</span>
        <button type="button" className="acira-button acira-button-quiet" aria-expanded={expanded} onClick={() => onExpanded(!expanded)}>{t('transfer.send.change')}<ChevronDown className="tx-pill-chev" aria-hidden="true" strokeWidth={1.5} /></button>
      </div>
      {expanded
        ? <ChecklistRows counts={counts} sizes={summary?.sizes} checked={selection.include} onChange={set} disabled={disabled}
            history={{ days: selection.historyDays, onChange: days => onChange({ ...selection, historyDays: days }), highlight: tooLarge }} />
        : (
          <label className="tx-item tx-pw-line" data-row="passwords">
            <input type="checkbox" className="tx-check" checked={selection.include.passwords} disabled={Boolean(disabled.passwords) || passwords === 0} onChange={event => set('passwords', event.target.checked)} />
            <span className="nm">{t('transfer.row.passwords')}{typeof passwords === 'number' && <span className="tx-count tx-count-inline"> ({formatCount(passwords)})</span>}</span>
          </label>
        )}
    </>
  );
}

export { defaultSelection };
