// First-run setup's way in from another computer (spec 4.4, pictures 18-21): "Coming from another computer? Bring your Acira over." opens the receive flow in a card of
// setup's own, in place of the step it was offered on. The target is the first profile (no "where" question); after Bring it over the look has come quietly and `onApplied`
// lets setup end through its normal completion path (Onboarding `leave`, the finale into the person's own theme).
import type { BrowserAction } from "../../runtime/types";
import { useTransferStatus } from "../transfer/client";
import type { AppliedResult } from "../transfer/ReceiveApply";
import { ReceiveFlow } from "../transfer/ReceiveFlow";
import { importedWhat, importToast } from "../transfer/Done";
import { fromName } from "../transfer/ReceivePreview";
import { includedRows } from "../transfer/receiveParts";

export function SetupReceive({ onBack, onApplied }: { onBack: () => void; onApplied: (result?: AppliedResult) => void }) {
  const { status, refresh } = useTransferStatus();
  return <ReceiveFlow variant="setup" status={status} refresh={refresh} close={onBack} onApplied={onApplied} />;
}

/** The usual import toast with Undo ("Imported 6 Spaces and 412 bookmarks from Alex"), offered over the arriving browser, as after any import in setup. */
export function transferUndoToast(result: AppliedResult | null | undefined): BrowserAction | null {
  if (!result) return null;
  const { applied, preview } = result;
  return importToast(applied, importedWhat(preview.counts ?? {}, includedRows(preview.included)), fromName(preview)) as BrowserAction | null;
}
