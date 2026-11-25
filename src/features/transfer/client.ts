// The renderer's side of the transfer service: typed calls over `runtime.service`, and one hook that keeps the status current.
// Main nudges every window with `{type:'transfer-changed'}` (spec 6); the hook then reads `transfer.status` (the same nudge-then-read pattern as `filters-changed`).
import { useEffect, useRef, useState } from 'react';
import { runtime } from '../../runtime/client';
import type { ServiceRequest } from '../../runtime/types';
import type { TransferIntent, TransferRequest, TransferResultBag, TransferStatus } from './types';

/** One call: the request is one of `TransferRequest`, the answer is the `transfer` bag of the service result (an error from main is thrown as an Error). */
export async function transferCall(request: TransferRequest): Promise<TransferResultBag> {
  const result = await runtime.service(request as unknown as ServiceRequest);
  return ((result as unknown as { transfer?: TransferResultBag }).transfer ?? {}) as TransferResultBag;
}

export const EMPTY_STATUS: TransferStatus = { outgoing: null, incoming: null, sheet: null, relay: true, platform: 'unknown' };

export async function readTransferStatus(): Promise<TransferStatus> {
  return (await transferCall({ type: 'transfer.status' })).status ?? EMPTY_STATUS;
}

/** Opens the sheet in the focused window, on the side the caller needs. The menu, Settings and the palette all use this. */
export async function openTransferSheet(intent: TransferIntent): Promise<void> {
  await transferCall({ type: 'transfer.open', intent });
}

/** The live status. `refresh` re-reads at once (after a call that changes it). */
export function useTransferStatus(): { status: TransferStatus; refresh: () => Promise<TransferStatus> } {
  const [status, setStatus] = useState<TransferStatus>(EMPTY_STATUS);
  const alive = useRef(true);
  const generation = useRef(0);
  const refresh = async () => {
    const mine = ++generation.current;
    try {
      const next = await readTransferStatus();
      if (alive.current && mine === generation.current) setStatus(next);
      return next;
    } catch {
      return status;
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    const stop = runtime.subscribeBrowser((event: { type: string }) => { if (event.type === 'transfer-changed') void refresh(); });
    return () => { alive.current = false; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { status, refresh };
}
