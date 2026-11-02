import { useId, useState, type FormEvent } from 'react';
import { runtime } from '../../runtime/client';
import type { TabSession } from '../../runtime/types';
import { TorGlyph } from './TorChip';
import { torProblem, torRequest } from './torClient';
import '../../styles/error-page.css';
import './tor.css';

import { t } from '../../i18n';

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

/** "This onion site needs a key" (Tor Browser's onion authentication prompt): tor said the service wants a client key (ExtendedErrors 0xF4) or refused the one it has
 * (0xF5), so the tab asks for it instead of showing a connection error. The key goes to tor for the site this tab shows, is kept in memory only, and the page loads again. */
export function TorOnionAuth({ tab }: { tab: TabSession }) {
  const id = useId(), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  const wrong = tab.onionAuth === 'wrong', site = hostOf(tab.url);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true); setProblem('');
    void torRequest({ type: 'tor.onion-auth-add', tabId: tab.id, key }).then(() => setKey(''), (error: unknown) => setProblem(torProblem(error))).finally(() => setBusy(false));
  };
  const goBack = () => { if (tab.canGoBack || tab.historyIndex > 0) void runtime.browserCommand({ type: 'back', tabId: tab.id }); else void runtime.dispatch({ type: 'tab.navigate', tabId: tab.id, url: 'acira://new' }); };
  return <article className="navigation-error tor-onion-auth" aria-labelledby={id}>
    <div className="ne-body">
      <div className="ne-glyph" aria-hidden="true"><TorGlyph size={16}/></div>
      <div id={id} className="display-page ne-title" role="heading" aria-level={1}>{wrong ? t('tor.onionAuth.titleWrong') : t('tor.onionAuth.titleMissing')}</div>
      <p className="lede ne-message">{wrong ? t('tor.onionAuth.bodyWrong', { site: `⁨${site}⁩` }) : t('tor.onionAuth.bodyMissing', { site: `⁨${site}⁩` })}</p>
      <form className="tor-auth-form" onSubmit={submit}>
        <label htmlFor={id + '-key'}>{t('tor.onionAuth.label')}</label>
        <input id={id + '-key'} type="password" value={key} autoFocus autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={t('tor.onionAuth.placeholder')} aria-invalid={Boolean(problem) || undefined} aria-describedby={id + '-note'} onChange={event => setKey(event.target.value)}/>
        {problem && <p className="tor-auth-problem" role="alert">{problem}</p>}
        <div className="ne-actions">
          <button type="submit" className="ne-button" data-primary disabled={busy || !key.trim()}>{busy ? t('tor.onionAuth.adding') : t('tor.onionAuth.add')}</button>
          <button type="button" className="ne-button" data-quiet onClick={goBack}>{t('error.goBack')}</button>
        </div>
        <p className="ne-note" id={id + '-note'}>{t('tor.onionAuth.note')}</p>
      </form>
    </div>
  </article>;
}
