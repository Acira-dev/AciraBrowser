// The calm end of a receive, in either variant: the sheet draws S's EndStateView (pictures 27 and 28); first-run setup draws the same sentence and actions on its own card.
import { t, useT } from '../../i18n';
import { END_ACTION_LABEL, EndStateView, type EndAction } from './EndState';
import { ReceiveFrame, type FrameAction, type ReceiveVariant } from './ReceiveFrame';
import type { ReceiveEnd } from './receiveMessages';

export interface ReceiveEndViewProps {
  variant: ReceiveVariant;
  row: ReceiveEnd;
  /** The words the person typed, dimmed, where the row shows them. */
  words?: readonly string[];
  onAction: (action: EndAction) => void;
  busy?: boolean;
}

/** An action that tries again is the card's primary; leaving is quiet. */
const TRIES: readonly EndAction[] = ['retry', 'tryAgain', 'checkUpdates', 'useFile'];

export function ReceiveEndView({ variant, row, words, onAction, busy = false }: ReceiveEndViewProps) {
  useT();
  if (variant === 'sheet') return <EndStateView row={row} words={words} onAction={onAction} busy={busy} />;
  const actions: FrameAction[] = row.actions.map((action, index) => ({
    id: action, label: t(END_ACTION_LABEL[action]), kind: TRIES.includes(action) && (index === 0 || row.actions.length === 1) ? 'primary' : 'secondary', disabled: busy, onClick: () => onAction(action)
  }));
  if (actions.length && !actions.some((action) => action.kind === 'primary')) actions[actions.length - 1] = { ...actions[actions.length - 1], kind: 'primary' };
  return <ReceiveFrame variant="setup" screen="end" title={t('transfer.setup.linkAction')} sub={t(row.message)} actions={actions} live="polite" />;
}
