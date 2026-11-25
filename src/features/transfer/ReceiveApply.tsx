// The shared end of every receive (the code road, ReceiveFlow, and the profile file, FileFlow): R5 the preview and "Where should it go?", R6 bringing it over with the
// reveal, R7 done. Spec 4.3, 5.3 and 11.
//
//   preview   the parts (a click leaves one out), the notes, "Changes to how Acira protects you" (every line unticked), where it goes, Cancel, Bring it over.
//   bringing  `transfer.apply` (steps 1-4: main reports each; the rows tick), then THE REVEAL (reveal.ts); the sheet shows Done inside the new frame.
//   done      Your profile is here, with the follow-ups that apply.
//   failed    "Something went wrong, so nothing was changed." (main rolled the batch back, or this screen takes it back); Close.
// In setup (variant `setup`) there is no "Where should it go?" (the first profile is the target), the look is applied quietly (the setup's finale is the reveal) and
// `onApplied` is called when it is done, so setup ends through its own completion path; Done is not shown.
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useT } from '../../i18n';
import { runtime } from '../../runtime/client';
import { undoImportBatches } from '../../ui/importedFavorites';
import { useTransferStatus } from './client';
import { Bringing } from './Bringing';
import { Done } from './Done';
import { ReceiveEndView } from './ReceiveEnd';
import { centreOf } from './ReceiveFrame';
import { ReceivePreview } from './ReceivePreview';
import { TICK_GAP_MS } from './ReceiveRows';
import { APPLY_FAILED_END, GONE_END } from './receiveMessages';
import { applyStepsFor, includedRows } from './receiveParts';
import { bringItOver, realDeps, type RevealOrigin } from './reveal';
import { useSheetEnv } from './sheetEnv';
import type { TransferApplied, TransferInclude, TransferPreview, TransferRow } from './types';

/** What `onApplied` hands over: the receipt of the apply and the preview it was made from (the toast with Undo is worded from them). */
export interface AppliedResult { applied: TransferApplied; preview: TransferPreview }
export interface ReceiveApplyProps {
  variant: 'sheet' | 'setup';
  source: 'file' | 'code';
  preview: TransferPreview;
  close: () => void;
  /** Leaves the preview without applying (Cancel): for a file it goes back to the sheet's first screen. */
  cancel: () => void;
  onApplied?: (result?: AppliedResult) => void;
}

type Stage = 'preview' | 'bringing' | 'done' | 'failed';
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the apply request leaves out: the parts the person unticked, as `false`. Nothing when all are kept. */
export function leftOut(rows: readonly TransferRow[], include: Partial<TransferInclude>): Partial<TransferInclude> | undefined {
  const out: Partial<TransferInclude> = {};
  for (const row of rows) if (include[row] === false) out[row] = false;
  return Object.keys(out).length ? out : undefined;
}

export function ReceiveApply({ variant, source, preview, close, cancel, onApplied }: ReceiveApplyProps) {
  useT();
  const env = useSheetEnv();
  // R6's ticks: main sets `status.applying` and nudges after each step of `transfer.apply` (spaces, bookmarks, history, settings, sites, other).
  const { status } = useTransferStatus();
  const [stage, setStage] = useState<Stage>('preview');
  const [target, setTarget] = useState<'current' | 'new'>(variant === 'setup' ? 'current' : preview.defaultTarget === 'new' ? 'new' : 'current');
  const [include, setInclude] = useState<Partial<TransferInclude>>({});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [applied, setApplied] = useState<TransferApplied | null>(null);
  const [failure, setFailure] = useState(APPLY_FAILED_END);
  const [finished, setFinished] = useState(false);
  const receipt = useRef<TransferApplied | null>(null);
  const rows = includedRows(preview.included);
  const kept = rows.filter((row) => include[row] !== false);

  const toggleRow = (row: TransferRow) => setInclude((before) => ({ ...before, [row]: before[row] === false ? true : false }));
  const toggleSafety = (id: string) => setTicked((before) => { const next = new Set(before); if (!next.delete(id)) next.add(id); return next; });

  const bring = async (button: HTMLButtonElement) => {
    const origin: RevealOrigin | null = centreOf(button);
    setStage('bringing');
    try {
      await bringItOver(
        { target, include: leftOut(rows, include), safety: [...ticked] },
        {
          origin, quiet: variant === 'setup', deps: realDeps(env.call),
          // main has finished steps 1-4: any row it did not report yet ticks now, one after another, before the look changes
          stepsDone: async (receiptOf) => { receipt.current = receiptOf; setFinished(true); await wait(TICK_GAP_MS * applyStepsFor(kept).length + 120); },
          // inside the new frame: the sheet shows its Done screen there
          commit: () => { if (variant === 'setup' || !receipt.current) return; const got = receipt.current; flushSync(() => { setApplied(got); setStage('done'); }); }
        }
      );
      if (variant === 'setup') onApplied?.(receipt.current ? { applied: receipt.current, preview } : undefined);
      else if (receipt.current) { setApplied(receipt.current); setStage('done'); onApplied?.({ applied: receipt.current, preview }); }
    } catch (error) {
      // Step 1-4 failed: main took the batch back. A failure after them (the look, the preferences): this screen takes the batch back.
      if (receipt.current) { try { await undoImportBatches([receipt.current.batchId], (batchId) => runtime.service({ type: 'imports.undo', batchId }) as Promise<{ undone?: boolean }>); } catch { /* the batch stays in import history with its Undo */ } }
      setFailure(String((error as { message?: string })?.message ?? '').includes('Start again') || (error as { code?: string })?.code === 'gone' ? GONE_END : APPLY_FAILED_END);
      setStage('failed');
    }
  };

  if (stage === 'preview') {
    return <ReceivePreview variant={variant} preview={preview} target={target} onTarget={setTarget} include={include} onToggleRow={toggleRow} ticked={ticked} onToggleSafety={toggleSafety} onCancel={cancel} onBring={(button) => void bring(button)} />;
  }
  if (stage === 'bringing') {
    return <Bringing variant={variant} rows={kept} applying={status.applying} finished={finished} />;
  }
  if (stage === 'done' && applied) return <Done variant={variant} applied={applied} preview={preview} include={include} close={close} call={env.call} />;
  void source;
  return <ReceiveEndView variant={variant} row={failure} onAction={() => close()} />;
}
