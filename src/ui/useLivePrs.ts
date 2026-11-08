import { useEffect,useState } from 'react';
import { runtime } from '../runtime/client';
import type { LivePrsStatus } from '../runtime/livePrs';

/** The live pull requests folder as the main process holds it (desktop/live-prs). Asks once on mount and again whenever main says it changed
 *  (a refresh finished, a filter moved, the folder was added or removed in another window of the profile). `null` until the first answer.
 *  Asking is also how a window joins the folder's refresh, so a window with no folder (the default) costs one cheap request and nothing after it. */
export function useLivePrs(profileId: string, enabled = true): LivePrsStatus | null {
  const [status, setStatus] = useState<LivePrsStatus | null>(null);
  useEffect(() => {
    if (!enabled) { setStatus(null); return; }
    let alive = true;
    const read = () => { void runtime.service({ type: 'live-prs.status' }).then((result) => { if (alive && result.livePrs) setStatus(result.livePrs); }).catch(() => {}); };
    read();
    const unsubscribe = runtime.subscribeBrowser?.((event) => { if (event.type === 'live-prs-changed') read(); });
    return () => { alive = false; unsubscribe?.(); };
  }, [profileId, enabled]);
  return status;
}

/** Sends one of the folder's requests and hands back the new status (the same answer `useLivePrs` would get next). */
export async function livePrsRequest(request: Parameters<typeof runtime.service>[0]): Promise<LivePrsStatus | null> {
  try { return (await runtime.service(request)).livePrs ?? null; } catch { return null; }
}
