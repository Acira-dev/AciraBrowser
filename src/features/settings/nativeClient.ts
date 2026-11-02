import { runtime } from '../../runtime/client';
import type { NativeRequest, NativeResult } from '../../runtime/nativeCore';

/** One call into the desktop core for Settings panels. Fails with a readable message outside the desktop app. */
export function native(request: NativeRequest): Promise<NativeResult> {
  if (!runtime.native) return Promise.reject(new Error('Open the Acira desktop app to change this.'));
  return runtime.native(request);
}

/** IPC errors arrive as "Error invoking remote method '…': Error: <message>". Show only the message. */
export const readable = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '');
