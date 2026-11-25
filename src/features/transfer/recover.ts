// At start (spec 11.3): a transfer cut off while it was applying is taken back by main (the batch stays `applying` until `transfer.applied`), and the renderer's half is
// taken back here: main cannot reach localStorage, so it only remembers the ids (`transfer.rolledBack`) and each id with a saved record gets `undoUiPrefs`.
// Wiring (the team): call `startTransferBackground()` once, in the chrome view's App (an effect on mount, never in the overlay view or a private window).
import { undoRolledBackUiPrefs } from '../../ui/profileUiPrefs';
import { transferCall } from './client';
import { watchTransferReveal } from './reveal';

/** Asks main which batches it rolled back at start and puts this window's interface preferences back for each. Returns how many were put back; never throws (a private window refuses the call). */
export async function recoverRolledBackTransfers(call: typeof transferCall = transferCall): Promise<number> {
  try {
    const { batchIds } = await call({ type: 'transfer.rolledBack' });
    return Array.isArray(batchIds) && batchIds.length ? undoRolledBackUiPrefs(batchIds.filter((id): id is string => typeof id === 'string')) : 0;
  } catch { return 0; }
}

/** What the chrome view starts with: the recovery, and the listener that runs the reveal when a sheet in the overlay asks for it (reveal.ts). Returns the stop function. */
export function startTransferBackground(): () => void {
  void recoverRolledBackTransfers();
  return watchTransferReveal();
}
