// R5: what arrived, what would change, and where it goes (pictures 15, 15b and, in setup, 21; spec 4.3).
//   - the parts with their counts, every one ticked (a click leaves it out);
//   - the notes: Spaces that will not fit, Spaces that were locked, a changed Spaces mode (strings of picture 15b);
//   - "Changes to how Acira protects you": every line UNTICKED, only ticked ones are applied (spec 10.1: a scammer's file or code cannot quietly weaken Acira);
//   - "Where should it go?" (the sheet only; setup has one profile and no question);
//   - Cancel and Bring it over.
// Setup draws the parts as ONE summary row with Review (README design question 8: the 600 px card cannot hold eight rows plus the safety lines) and keeps the safety group.
import { useState } from 'react';
import { MAX_WORKSPACES } from '../../runtime/workspaces';
import { CheckMark } from '../../components/CheckMark';
import { Segmented } from '../../components/Segmented';
import { currentLocale, t, useT } from '../../i18n';
import { ReceiveFrame, type FrameAction, type ReceiveVariant } from './ReceiveFrame';
import { ReceiveRows } from './ReceiveRows';
import { platformName } from './PairStrip';
import { includedRows, readyRows } from './receiveParts';
import { safetyLabel } from './safetyWords';
import type { TransferInclude, TransferPreview, TransferRow } from './types';

/** "just now", "5 minutes ago", "2 hours ago", "yesterday": when the profile was made, in this computer's language. */
export function sentWhen(createdAt: string | number | undefined, now = Date.now()): string {
  const at = typeof createdAt === 'number' ? createdAt : Date.parse(String(createdAt ?? ''));
  const seconds = Number.isFinite(at) ? Math.max(0, (now - at) / 1000) : 0;
  if (seconds < 90) return t('transfer.preview.sentNow');
  let format: Intl.RelativeTimeFormat;
  try { format = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' }); } catch { format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  return hours < 48 ? format.format(-hours, 'hour') : format.format(-Math.round(hours / 24), 'day');
}
/** Who it is from: the sender's profile name, else its computer's system. */
export const fromName = (preview: Pick<TransferPreview, 'from'>): string => preview.from.name.trim() || platformName(preview.from.platform as never) || '';
/** "Alex · from Windows · sent just now". */
export const fromLine = (preview: Pick<TransferPreview, 'from'>, now = Date.now()): string =>
  t('transfer.preview.from', { name: fromName(preview), platform: platformName(preview.from.platform as never), when: sentWhen(preview.from.createdAt, now) });

/** What the setup's one summary row says under its name: "6 Spaces · 412 bookmarks · 9,812 visits · and more". */
export function summaryLine(preview: Pick<TransferPreview, 'counts' | 'included'>): string {
  const counts = preview.counts ?? {}, parts: string[] = [];
  if (typeof counts.spaces === 'number') parts.push(t('transfer.send.spaces', { count: counts.spaces }));
  if (typeof counts.bookmarks === 'number') parts.push(t('transfer.send.bookmarks', { count: counts.bookmarks }));
  if (typeof counts.history === 'number') parts.push(t('transfer.send.visits', { count: counts.history }));
  const shown = new Set<TransferRow>(['spaces', 'bookmarks', 'history']);
  if (includedRows(preview.included).some((row) => !shown.has(row))) parts.push(t('transfer.setup.andMore'));
  return parts.join(' · ');
}

/** Which of the notes of picture 15b apply, for the chosen target. Spaces that do not fit only matter when this profile's own room is used. */
export function previewNotes(preview: TransferPreview, target: 'current' | 'new') {
  const overflow = target === 'current' ? Math.max(0, Number(preview.spaces?.overflow) || 0) : Math.max(0, (Number(preview.counts?.spaces) || 0) - MAX_WORKSPACES);
  return {
    overflow,
    lockedSpaces: Math.max(0, Number(preview.notMoved?.lockedSpaces) || 0),
    changesSpacesMode: preview.changesSpacesMode === true
  };
}

export interface ReceivePreviewProps {
  variant: ReceiveVariant;
  preview: TransferPreview;
  target: 'current' | 'new';
  onTarget: (target: 'current' | 'new') => void;
  /** The parts the person left out (false). */
  include: Partial<TransferInclude>;
  onToggleRow: (row: TransferRow) => void;
  /** The ids of the safety lines the person ticked. */
  ticked: ReadonlySet<string>;
  onToggleSafety: (id: string) => void;
  onCancel: () => void;
  onBring: (button: HTMLButtonElement) => void;
  /** Bring it over is running: the buttons wait. */
  busy?: boolean;
}

function Notes({ preview, target, variant }: { preview: TransferPreview; target: 'current' | 'new'; variant: ReceiveVariant }) {
  const notes = previewNotes(preview, target);
  if (!notes.overflow && !notes.lockedSpaces && !notes.changesSpacesMode) return null;
  if (variant === 'setup') {
    return <>{notes.overflow > 0 && <p className="fr-note rx-note">{t('transfer.preview.limit', { count: notes.overflow })}</p>}{notes.lockedSpaces > 0 && <p className="fr-note rx-note">{t('transfer.preview.locked', { count: notes.lockedSpaces })}</p>}</>;
  }
  return (
    <div className="rx-notes">
      {notes.overflow > 0 && <><p className="tx-warn">{t('transfer.preview.limit', { count: notes.overflow })}</p><p className="tx-note rx-hint">{t('transfer.preview.limitHint')}</p></>}
      {notes.lockedSpaces > 0 && <p className="tx-warn">{t('transfer.preview.locked', { count: notes.lockedSpaces })}</p>}
      {notes.changesSpacesMode && <p className="tx-warn">{t('transfer.preview.spacesMode')}</p>}
    </div>
  );
}

export function ReceivePreview(props: ReceivePreviewProps) {
  useT();
  const { variant, preview, target, include, ticked, busy = false } = props;
  const [review, setReview] = useState(false);
  const rows = includedRows(preview.included), counts = preview.counts ?? {};
  const models = readyRows(rows, counts, include);
  const lines = preview.safety ?? [];
  const name = fromName(preview);
  const actions: FrameAction[] = [
    { id: 'cancel', label: t('transfer.preview.cancel'), kind: 'secondary', disabled: busy, onClick: props.onCancel },
    { id: 'bring', label: t('transfer.preview.apply'), kind: 'primary', disabled: busy || !rows.some((row) => include[row] !== false), revealOrigin: true, initialFocus: true }
  ];
  const onPress = (action: FrameAction, node: HTMLButtonElement) => { if (action.id === 'bring') props.onBring(node); };
  const everyProfile = <p className="tx-note rx-every">{t('transfer.preview.everyProfile')}</p>;
  
  if (variant === 'setup') {
    return (
      <ReceiveFrame variant="setup" screen="preview" title={t('transfer.setup.linkAction')} sub={fromLine(preview)} actions={actions} onActionPress={onPress}>
        <fieldset className="fr-group rx-setup-group">
          <div className="fr-row fr-noicon rx-summary" data-two="">
            <span className="fr-row-text"><b>{t('transfer.setup.everything', { name })}</b><small className="rx-summary-sub">{summaryLine(preview)}</small></span>
            <button type="button" className="fr-link fr-inline-link rx-review" aria-expanded={review} onClick={() => setReview((open) => !open)}>{t('transfer.setup.review')}</button>
          </div>
        </fieldset>
        {review && <ReceiveRows rows={models} onToggle={props.onToggleRow} label={t('transfer.setup.everything', { name })} />}
        <Notes preview={preview} target={target} variant="setup" />
        {lines.length > 0 && (
          <>
            <div className="fr-glabel rx-glabel"><span>{t('transfer.preview.safetyTitle')}</span></div>
            <div className="fr-group rx-setup-group" role="group" aria-label={t('transfer.preview.safetyTitle')}>
              {lines.map((line) => (
                <label key={line.id} className="fr-row fr-pick fr-noicon rx-fact" data-multiple="">
                  <input className="fr-visually-hidden" type="checkbox" checked={ticked.has(line.id)} onChange={() => props.onToggleSafety(line.id)} />
                  <span className="fr-row-text"><b className="rx-fact-name">{safetyLabel(line)}</b></span>
                  <span className="fr-trail"><span className="fr-box" aria-hidden="true"><CheckMark size={12} /></span></span>
                </label>
              ))}
            </div>
            <p className="fr-note rx-note">{t('transfer.preview.askAgain')}</p>
          </>
        )}
      </ReceiveFrame>
    );
  }
  const newName = name || platformName(preview.from.platform as never);
  return (
    <ReceiveFrame variant="sheet" screen="preview" title={fromLine(preview)} actions={actions} onActionPress={onPress}>
      <ReceiveRows rows={models} onToggle={props.onToggleRow} label={fromLine(preview)} />
      <Notes preview={preview} target={target} variant="sheet" />
      {lines.length > 0 && (
        <div className="tx-box" role="group" aria-label={t('transfer.preview.safetyTitle')}>
          <h3 className="tx-box-title">{t('transfer.preview.safetyTitle')}</h3>
          <p className="tx-note rx-boxnote">{t('transfer.preview.safetyHint')}</p>
          {lines.map((line) => (
            <label key={line.id} className="tx-item">
              <input type="checkbox" className="tx-check" checked={ticked.has(line.id)} onChange={() => props.onToggleSafety(line.id)} />
              <span className="nm">{safetyLabel(line)}</span>
            </label>
          ))}
          <p className="tx-note rx-boxnote rx-ask-again">{t('transfer.preview.askAgain')}</p>
        </div>
      )}
      <div className="tx-ask">
        <h3 className="tx-ask-title" id="rx-where">{t('transfer.preview.where')}</h3>
        <Segmented<'current' | 'new'> label={t('transfer.preview.where')} value={target} onChange={props.onTarget}
          options={[['current', t('transfer.preview.current')], ['new', t('transfer.preview.new', { name: newName })]]} />
      </div>
      {everyProfile}
    </ReceiveFrame>
  );
}
