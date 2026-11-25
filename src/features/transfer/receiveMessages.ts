import type { EndAction, EndGlyph, EndRow } from './EndState';
import type { MessageId } from '../../i18n';
import type { IncomingStatus, TransferReason } from './types';

// The glyph and action names are EndState.tsx's (the sheet's calm end state draws every row); the receiving side uses these: `chips` is the typed words, dimmed
// (expired, in use, already used, tamper, the number not confirmed); back leaves for the first screen (type another code); close closes the sheet; retry and
// tryAgain send the same code again; useFile opens a profile file instead; checkUpdates looks for a new Acira.
export type ReceiveEnd = EndRow;
export type { EndAction, EndGlyph };

const end = (message: MessageId, glyph: EndGlyph, ...actions: EndAction[]): ReceiveEnd => ({ message, glyph, actions });

/** The row of spec 4.6 for a reason, seen from the receiving computer (B). */
export function endForReason(reason: TransferReason | null | undefined): ReceiveEnd {
  switch (reason) {
    case 'not_found': case 'bad_code': return end('transfer.error.notFound', 'search', 'back');
    case 'in_use': return end('transfer.error.inUse', 'chips', 'back');
    case 'expired': return end('transfer.error.expired', 'chips', 'back');
    case 'ended': return end('transfer.error.ended', 'chips', 'back');
    case 'gone': case 'protocol': case 'too_large': return end('transfer.error.vanished', 'unplug', 'close');
    case 'sender': case 'receiver': return end('transfer.error.cancelledByOther', 'unplug', 'close');
    case 'mismatch': case 'timeout': return end('transfer.error.mismatchReceiver', 'chips', 'close');
    case 'tamper': return end('transfer.error.tamper', 'chips', 'close');
    case 'silent': return end('transfer.error.silent', 'unplug', 'tryAgain');
    case 'offline': return end('transfer.error.offline', 'wifi-off', 'retry', 'useFile');
    case 'unavailable': return end('transfer.error.unavailable', 'wifi-off', 'useFile');
    case 'busy': return end('transfer.error.busy', 'clock', 'retry');
    case 'rate_limited': return end('transfer.error.rate', 'clock');
    case 'damaged': case 'invalid': case 'internal': return end('transfer.error.damaged', 'alert', 'tryAgain');
    case 'newer': return end('transfer.error.newer', 'arrow-up', 'checkUpdates');
    case 'slow': return end('transfer.error.slow', 'wifi-off', 'useFile');
    // Typed on the computer that made the code (spec 14.8): "Type this on your other computer."
    case 'own_code': return end('transfer.code.title', 'none', 'back');
    default: return end('transfer.error.vanished', 'unplug', 'close');
  }
}

/** The end state of an incoming transfer: its message, glyph and actions, or null when it ends without a word (this computer's own Cancel). */
export function receiveEnd(incoming: Pick<IncomingStatus, 'state' | 'reason' | 'local'> | null | undefined): ReceiveEnd | null {
  if (!incoming || (incoming.state !== 'cancelled' && incoming.state !== 'expired' && incoming.state !== 'failed')) return null;
  if (incoming.state === 'cancelled' && incoming.local) return null;
  if (incoming.state === 'expired') return endForReason(incoming.reason || 'expired');
  return endForReason(incoming.reason);
}

/** Start again on the other computer: the payload is gone (the sheet was closed during the preview, or main dropped it). */
export const GONE_END: ReceiveEnd = end('transfer.error.gone', 'unplug', 'close');
/** The apply threw: the batch was rolled back (spec 11.3). */
export const APPLY_FAILED_END: ReceiveEnd = end('transfer.error.applyFailed', 'alert', 'close');
