import { useCallback, useEffect, useState } from 'react';
import { t, useT } from '../../i18n';
import { runtime } from '../../runtime/client';
import type { MetricsStatus } from '../../runtime/types';

/** Optional anonymous usage counts, shared by Settings and the setup Privacy step. Only new setup initializes an unset choice;
 * `payload` is the exact message that would be sent, so "See what's sent" never shows anything but the truth. */
export const USAGE_COPY = {
  get title() { return t('usage.title'); },
  /** One line for a row value. */
  value: (enabled: boolean) => t(enabled ? 'usage.on' : 'usage.off'),
  /** The ask, in plain words. */
  get ask() { return t('usage.ask'); },
  /** Two-line row in setup (under 55 characters in English). */
  get short() { return t('usage.short'); },
  /** Under the switch in Settings. */
  get detail() { return t('usage.detail'); },
  /** Setup and Settings facts line, replacing "Data sent to Acira: None". */
  fact: (enabled: boolean) => t(enabled ? 'usage.factOn' : 'usage.factOff'),
  /** The collection promise, honest in both states. */
  promise: (enabled: boolean) => t(enabled ? 'usage.promiseOn' : 'usage.promiseOff'),
};
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Something went wrong.');

/** The last answer this window got, so coming back to a step shows the real choice at once (a person who turned it off and
 * returns never sees the default again). While setup's first answer is still on its way (about half a second) the switch
 * shows the default it is about to record, on, instead of an off and disabled switch (R4-11: the default looked off). */
let latest: MetricsStatus | undefined;

export function useMetrics({newSetup = false}: {newSetup?: boolean} = {}) {
  useT(); // re-render when the language changes, so USAGE_COPY is read in the new one
  const [status, setStatus] = useState<MetricsStatus | undefined>(latest);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [offNotice, setOffNotice] = useState(false);
  const dismissOffNotice = useCallback(() => setOffNotice(false), []);
  useEffect(() => {
    let alive = true;
    const first = runtime.service(newSetup ? {type: 'metrics.set', enabled: true, onlyIfUnset: true} : { type: 'metrics.status' }).then((result) => (latest = result.metrics));
    first.then((result) => { if (alive) setStatus(result); }).catch((reason) => { if (alive) setProblem(message(reason)); });
    return () => { alive = false; };
  }, [newSetup]);
  const set = useCallback(async (enabled: boolean) => {
    setBusy(true); setProblem('');
    try { latest = (await runtime.service({ type: 'metrics.set', enabled })).metrics; setStatus(latest); setOffNotice(!enabled); } catch (reason) { setProblem(message(reason)); } finally { setBusy(false); }
  }, []);
  /** R4-61: "Ask me now and then how features are working". */
  const setAskRatings = useCallback(async (enabled: boolean) => {
    setBusy(true); setProblem('');
    try { latest = (await runtime.service({ type: 'metrics.ask-ratings', enabled })).metrics; setStatus(latest); } catch (reason) { setProblem(message(reason)); } finally { setBusy(false); }
  }, []);
  return { status, enabled: status ? status.enabled : newSetup && !problem, ready: Boolean(status), busy, problem, set, offNotice,
    dismissOffNotice, payloadText: status ? JSON.stringify(status.payload, null, 2) : '', askRatings: status?.askRatings !== false, setAskRatings };
}
