// One boolean for the entry points: is a send waiting? (the menu row and the Settings row show a small dot while it is).
import { useTransferStatus } from './client';
import { sendIsLive } from './entryPoints';

/** Reads the transfer status once when it mounts and again on every `transfer-changed` nudge; the caller is a small row, so a tick re-renders that row and nothing around it. */
export function useSendLive(): boolean {
  return sendIsLive(useTransferStatus().status);
}
