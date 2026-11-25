// The calm end states (spec 4.6, 5.1 moment 13, pictures 27 and 28): one sentence, the dimmed code or a small glyph, and the one or two actions the table gives.
// `outgoingEnd` maps what the sending computer's session ended with to the row of spec 4.6; `EndStateView` draws any row (agent R's receiving side draws the same
// sheet from receiveMessages.ts, so the glyph and action names match).
//
// The chips of an ended code dim to .4 and blur softly (CSS, on the Formation's exit timing) while the sentence fades in; nothing flashes and nothing shakes.
import { EditorGlyph, type EditorIconName } from '../../components/EditorGlyph';
import { t, type MessageId } from '../../i18n';
import { CodeChips } from './CodeChips';
import type { OutgoingStatus, TransferReason } from './types';

/** `chips`: the code's own words, dimmed (expired, cancelled for safety, in use, tamper); the others are a small glyph (picture 28). */
export type EndGlyph = 'chips' | 'search' | 'unplug' | 'wifi-off' | 'arrow-up' | 'alert' | 'clock' | 'none';
/**
 * makeNewCode: back to what to send. back / close: leave the end state, or close the sheet. retry / tryAgain: send again with the same choice. useFile: use a profile
 * file instead. checkUpdates: look for a new Acira.
 */
export type EndAction = 'makeNewCode' | 'back' | 'close' | 'retry' | 'tryAgain' | 'useFile' | 'checkUpdates';
export interface EndRow { message: MessageId; glyph: EndGlyph; actions: EndAction[] }

export const END_ACTION_LABEL: Record<EndAction, MessageId> = {
  makeNewCode: 'transfer.action.makeNewCode', back: 'transfer.action.back', close: 'transfer.action.close', retry: 'transfer.action.retry', tryAgain: 'transfer.action.tryAgain',
  useFile: 'transfer.action.useFile', checkUpdates: 'transfer.action.checkUpdates',
};
const ICONS: Record<Exclude<EndGlyph, 'chips' | 'none'>, EditorIconName> = { search: 'Search', unplug: 'Unplug', 'wifi-off': 'WifiOff', 'arrow-up': 'ArrowUp', alert: 'AlertTriangle', clock: 'Clock3' };

const row = (message: MessageId, glyph: EndGlyph, ...actions: EndAction[]): EndRow => ({ message, glyph, actions });

/**
 * The row of spec 4.6 for what ended a send, seen from the sending computer (A). `null` when the person's own Cancel ended it (no message: the sheet goes back to
 * what to send), and for `too_large`, which is not an end state but S1 coming back with its "Too large" line.
 */
export function outgoingEnd(state: 'cancelled' | 'expired' | 'failed', reason: TransferReason | null | undefined, local = false): EndRow | null {
  if (state === 'expired') return row('transfer.error.expiredSender', 'chips', 'makeNewCode');
  if (state === 'cancelled') {
    switch (reason) {
      case 'mismatch': case 'timeout': return row('transfer.error.mismatchSender', 'chips', 'makeNewCode');
      case 'tamper': return row('transfer.error.tamper', 'chips', 'makeNewCode');
      case 'receiver': return local ? null : row('transfer.error.cancelledByOther', 'chips', 'makeNewCode');
      case 'sender': return local ? null : row('transfer.error.cancelledByOther', 'chips', 'makeNewCode');
      default: return null;
    }
  }
  switch (reason) {
    case 'too_large': return null;
    case 'offline': return row('transfer.error.offline', 'wifi-off', 'retry', 'useFile');
    case 'unavailable': return row('transfer.error.unavailable', 'wifi-off', 'useFile');
    case 'busy': return row('transfer.error.busy', 'clock', 'retry');
    case 'rate_limited': return row('transfer.error.rate', 'clock');
    case 'slow': return row('transfer.error.slow', 'wifi-off', 'useFile');
    case 'silent': return row('transfer.error.silent', 'unplug', 'tryAgain');
    case 'damaged': return row('transfer.error.damaged', 'alert', 'tryAgain');
    case 'newer': return row('transfer.error.newer', 'arrow-up', 'checkUpdates');
    case 'gone': return row('transfer.error.vanished', 'unplug', 'close');
    default: return row('transfer.error.generic', 'alert', 'tryAgain');
  }
}
/** The same, from the session status main keeps. */
export const outgoingEndOf = (status: Pick<OutgoingStatus, 'state' | 'reason' | 'local'>): EndRow | null =>
  status.state === 'cancelled' || status.state === 'expired' || status.state === 'failed' ? outgoingEnd(status.state, status.reason, status.local) : null;

/** The one primary button: Retry, when the file is offered beside it (picture 27). Every other action is the quiet-fill secondary. */
export const primaryAction = (actions: readonly EndAction[]): EndAction | null => actions.includes('retry') && actions.includes('useFile') ? 'retry' : null;

export interface EndStateViewProps {
  row: EndRow;
  /** The code's words, dimmed, for rows whose glyph is `chips`. */
  words?: readonly string[];
  onAction: (action: EndAction) => void;
  /** An action already running (its buttons wait). */
  busy?: boolean;
}

/** The sheet's calm end state: `.tx-end` of picture 27. The first button takes the focus; a row with no action (too many tries) has none and Esc closes the sheet. */
export function EndStateView({ row: end, words, onAction, busy = false }: EndStateViewProps) {
  const primary = primaryAction(end.actions);
  // A code that ended carries no words any more: with none to dim, the row has the quiet glyph of a lost connection instead of an empty card.
  const glyph: EndGlyph = end.glyph === 'chips' && !words?.length ? 'unplug' : end.glyph;
  return (
    <div className="tx-end" data-end={end.message}>
      {glyph === 'chips'
        ? <div className="tx-code" data-calm=""><span className="tx-code-plate" aria-hidden="true" /><CodeChips words={words ?? []} calm /><div className="tx-time" style={{ ['--k' as string]: 0 }}><b className="tx-time-bar" /></div></div>
        : glyph !== 'none' ? <div className="tx-ico" aria-hidden="true"><EditorGlyph name={ICONS[glyph]} className="tx-end-icon" /></div> : null}
      <p role="status" className="tx-end-msg">{t(end.message)}</p>
      {end.actions.length > 0 && (
        <div className="tx-foot">
          {end.actions.map((action, index) => (
            <button key={action} type="button" className={`acira-button acira-button-${action === primary ? 'primary' : 'secondary'} acira-button-prominent`} disabled={busy} data-initial-focus={index === 0 ? 'true' : undefined} onClick={() => onAction(action)}>{t(END_ACTION_LABEL[action])}</button>
          ))}
        </div>
      )}
    </div>
  );
}
