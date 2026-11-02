import { useCallback, useEffect, useState } from 'react';
import { TorGlyph } from './TorChip';
import { torRequest } from './torClient';
import './tor.css';

import { t } from '../../i18n';

type Reply = { torDownloadWarning: { show: boolean } };

/** Tor Browser's download warning (browser.download.showTorWarning), in Acira's design: a file from a Tor tab opens in another program, outside Tor and outside
 * this browser, and some files then connect to the internet. It sits above the list of downloads (the toolbar panel and the Downloads page) while any download
 * came from a Tor tab, until "Got it" is chosen; the choice is one Tor preference. Until then, opening such a file asks first (download-engine.cjs). */
export function TorDownloadNotice({ active, variant = 'panel' }: { active: boolean; variant?: 'panel' | 'page' }) {
  const [show, setShow] = useState(false), [problem, setProblem] = useState('');
  useEffect(() => {
    if (!active) return;
    let live = true;
    void torRequest<Reply>({ type: 'tor.download-warning' }).then(reply => { if (live) setShow(reply.torDownloadWarning.show); }, () => undefined);
    return () => { live = false; };
  }, [active]);
  const dismiss = useCallback(() => {
    setProblem('');
    void torRequest<Reply>({ type: 'tor.download-warning-dismiss' }).then(reply => setShow(reply.torDownloadWarning.show), (error: unknown) => setProblem(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('tor.settings.notSaved')));
  }, []);
  if (!active || !show) return null;
  return <div className="tor-dl-notice" data-variant={variant} role="note" aria-label={t('tor.download.title')}>
    <TorGlyph size={16}/>
    <div className="tor-dl-notice-text">
      <strong>{t('tor.download.title')}</strong>
      <p>{t('tor.download.body')}</p>
      {problem && <p className="tor-dl-notice-problem" role="alert">{problem}</p>}
    </div>
    <div className="tor-dl-notice-actions"><button type="button" className="acira-button acira-button-secondary" onClick={dismiss}>{t('tor.download.gotIt')}</button></div>
  </div>;
}
