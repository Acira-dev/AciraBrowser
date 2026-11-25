import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../../../runtime/client';
import type { UsageNotice } from '../../../runtime/types';
import { t, useT } from '../../../i18n';
import type { BandCard, BandContext } from './types';

/** The last answer this window got, so a new tab shows the banner on its first frame instead of after a round trip. */
let latest: UsageNotice | undefined;

async function ask(act: 'status' | 'close' | 'undo' | 'link'): Promise<UsageNotice | undefined> {
  try { const answer = (await runtime.service({ type: 'metrics.notice', act })).notice; if (answer) latest = answer; return answer; } catch { return undefined; }
}

/** Section C: the usage notice. Shown while sharing is on and nothing has settled it: X (with the standard Undo toast), a click on either link, or 24 hours after setup finished.
 *  It survives new tabs and restarts because main keeps it (metrics.json), and every window hears when it changes. */
export function useUsageNoticeCard({ dispatch }: BandContext): BandCard | null {
  useT();
  const [notice, setNotice] = useState<UsageNotice | undefined>(latest);
  const [off, setOff] = useState(false);
  const refresh = useCallback(() => { void ask('status').then((answer) => answer && setNotice(answer)); }, []);
  useEffect(() => {
    refresh();
    return runtime.subscribeBrowser?.((event) => { if (event.type === 'usage-changed') refresh(); });
  }, [refresh]);
  const close = () => {
    void ask('close').then((answer) => {
      if (answer) setNotice(answer);
      dispatch({ type: 'toast', text: t('usage.notice.closed'), action: { label: t('toast.undo'), command: { type: 'usage.notice.undo' } } });
    });
  };
  const see = () => { void ask('link').then((answer) => answer && setNotice(answer)); dispatch({ type: 'tab.new', url: 'acira://usage' }); };
  const turnOff = () => {
    void ask('link').then(() => runtime.service({ type: 'metrics.set', enabled: false, where: 'notice' })).then(() => { setOff(true); refresh(); }).catch(() => undefined);
  };
  const turnOn = () => { void runtime.service({ type: 'metrics.set', enabled: true }).then(() => { setOff(false); refresh(); }).catch(() => undefined); };
  if (off) {
    return { id: 'usage', kind: 'usage', style: 'default', title: '', body: '', actions: [], onClose: () => setOff(false), closeLabel: t('app.close'),
      confirmation: { text: t('usage.notice.offDone'), action: { id: 'on', label: t('usage.notice.onAgain'), onClick: turnOn } } };
  }
  if (!notice?.visible) return null;
  return { id: 'usage', kind: 'usage', style: 'default', title: t('usage.notice.title'), body: t('usage.notice.body'), closeLabel: t('app.close'), onClose: close,
    actions: [{ id: 'see', label: t('usage.notice.see'), onClick: see }, { id: 'off', label: t('usage.notice.off'), onClick: turnOff }] };
}
