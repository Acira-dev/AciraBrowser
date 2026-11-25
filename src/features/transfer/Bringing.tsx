// R6: Bringing it over (picture 16). The steps main works through (spaces and tabs, bookmarks, history, settings, site settings, the rest) tick one after another as it
// reports each, the one it is on shows the small loader. No button: nothing here can be cancelled once it has begun (it is all-or-nothing, spec 11.3).
// Then the reveal (reveal.ts) turns the browser into the sender's.
import { t, useT } from '../../i18n';
import { ReceiveFrame, type ReceiveVariant } from './ReceiveFrame';
import { ProgressLine } from './ProgressLine';
import { ApplyList } from './ReceiveRows';
import { applyRows, applyStepsFor, type ApplyStep } from './receiveParts';
import type { TransferApplying, TransferRow } from './types';

export interface BringingProps {
  variant: ReceiveVariant;
  /** The parts that are coming over (the ticked ones). */
  rows: readonly TransferRow[];
  /** `status.applying`: the steps main has finished and the one it is on, sent as it goes (`transfer-changed` after each step). Null before the first one and after apply returns. */
  applying?: TransferApplying | null;
  /** `transfer.apply` has returned: steps 1-4 are all done, so every row ticks (any main did not report in time ticks now, one after another). */
  finished?: boolean;
  reducedMotion?: boolean;
}

export function Bringing({ variant, rows, applying, finished = false, reducedMotion }: BringingProps) {
  useT();
  const steps: ApplyStep[] = applyStepsFor(rows);
  const done = finished ? steps : applying?.done ?? [];
  return (
    <ReceiveFrame variant={variant} screen="bringing" title={t('transfer.apply.title')} live="polite">
      <ProgressLine className="tx-line-bringing" fraction={finished || steps.length === 0 ? 1 : done.length / steps.length} reducedMotion={reducedMotion} label={t('transfer.apply.title')} />
      <ApplyList rows={applyRows(steps, done, applying?.step)} reducedMotion={reducedMotion} />
    </ReceiveFrame>
  );
}
