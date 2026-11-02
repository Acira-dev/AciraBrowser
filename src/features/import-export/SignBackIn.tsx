import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckMark } from '../../components/CheckMark';
import { runtime } from '../../runtime/client';
import type { BrowserSnapshot, ServiceRequest, SignInItem, SignInPlan } from '../../runtime/types';
import { useSiteIcons } from '../../ui/siteIcons';
import { currentLocale, useT } from '../../i18n';
import './sign-back-in.css';

const POLL_MS = 4000;

/** "Google, YouTube and Gmail" in the interface language. */
const listOf = (items: string[]) => {
  try { return new Intl.ListFormat(currentLocale(), { type: 'conjunction' }).format(items); } catch { return items.join(', '); }
};

/** The site's stored icon (kept on this computer while it was visited), else its first letter. */
function Mark({ item, icon }: { item: SignInItem; icon?: string }) {
  return <span className="sbi-icon" aria-hidden="true">{icon ? <img src={icon} alt="" width={20} height={20} draggable={false} /> : <bdi>{item.name.slice(0, 1).toUpperCase()}</bdi>}</span>;
}

/**
 * The checklist for signing back in after an import. Sign-ins do not travel between browsers (browsers lock them so other
 * programs cannot take them), so this lists the accounts the person uses most and opens each one's official sign-in page.
 * The list is worked out on this computer from imported history, bookmarks and saved-password hosts.
 */
export function SignBackIn({ state, from, refreshKey }: { state: BrowserSnapshot; from?: string; /** Changes when something was just imported: asks for new sites to be added. */ refreshKey?: string }) {
  const t = useT();
  const siteIcon = useSiteIcons(state);
  const [plan, setPlan] = useState<SignInPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const alive = useRef(true);
  const profile = state.activeBrowserProfileId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const call = useCallback(async (request: ServiceRequest) => {
    try {
      const result = await runtime.service(request);
      if (alive.current && result.signin) { setPlan(result.signin); setError(''); }
    } catch (failure) { if (alive.current && request.type !== 'signin.plan') setError(failure instanceof Error ? failure.message : String(failure)); }
  }, []);

  // Once on arrival (and again when something new was imported), then while the list is on screen and unfinished: the person
  // is signing in over in another tab, and a row ticks itself when its site has set a session cookie.
  useEffect(() => { void call({ type: 'signin.plan', refresh: Boolean(refreshKey) }); }, [call, profile, refreshKey]);
  const unfinished = Boolean(plan && plan.items.some(item => item.status === 'todo' || item.status === 'opened'));
  // Open until it is dismissed or has retired to Settings (14 days); the person's own choice wins either way.
  const shown = expanded ?? Boolean(plan && !plan.dismissed && !plan.retired);
  useEffect(() => {
    if (!unfinished || !shown) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') void call({ type: 'signin.plan' }); };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [unfinished, shown, call]);

  if (!plan || !plan.items.length) return null;
  const complete = plan.total > 0 && plan.done >= plan.total;
  const progress = complete ? t('signin.allDone') : t('signin.progress', { done: plan.done, total: plan.total });
  const act = async (id: string, request: ServiceRequest) => { setBusy(id); await call(request); if (alive.current) setBusy(''); };
  const iconFor = (item: SignInItem) => item.iconHosts.map(host => siteIcon('https://' + host)).find(Boolean);

  return <section className="aip-section sbi" data-setting="import-signin" aria-label={t('signin.title')} data-complete={complete || undefined}>
    <header className="aip-header sbi-head">
      <div className="sbi-titlebar">
        <h2 className="aip-heading">{t('signin.title')}</h2>
        <span className="sbi-progress" role="status" aria-live="polite">{progress}</span>
      </div>
      <span className="sbi-bar" aria-hidden="true"><i style={{ transform: `scaleX(${plan.total ? plan.done / plan.total : 0})` }} /></span>
      {shown && <p className="aip-copy">{t('signin.intro', { browser: from || t('signin.fallbackBrowser') })}</p>}
    </header>
    {shown && <ul className="sbi-list" aria-label={t('signin.listLabel')}>
      {plan.items.map((item, index) => {
        const done = item.status === 'done', skipped = item.status === 'skipped';
        return <li key={item.id} className="sbi-row" data-status={item.status} style={{ '--i': Math.min(index, 8) } as React.CSSProperties}>
          <button type="button" role="checkbox" aria-checked={done} className="sbi-tick" disabled={busy === item.id} aria-label={done ? t('signin.markUndone', { name: item.name }) : t('signin.markDone', { name: item.name })}
            onClick={() => void act(item.id, { type: 'signin.mark', id: item.id, status: done ? 'todo' : 'done' })}><CheckMark size={12} /></button>
          <Mark item={item} icon={iconFor(item)} />
          <span className="sbi-text">
            <strong className="sbi-name"><bdi>{item.name}</bdi></strong>
            {item.covers.length > 0 && <span className="sbi-sub">{t('signin.covers', { sites: listOf(item.covers) })}</span>}
            {item.kind === 'site' && item.covers.length === 0 && item.url && <span className="sbi-sub"><bdi>{new URL(item.url).hostname.replace(/^www\./, '')}</bdi></span>}
            <span className="sbi-meta">
              {item.visits > 0 && <span>{t('signin.visits', { count: item.visits })}</span>}
              {item.bookmarked && <span>{t('signin.bookmarked')}</span>}
              {item.autofill && <span className="sbi-autofill"><CheckMark size={12} />{t('signin.autofill')}</span>}
            </span>
          </span>
          <span className="sbi-actions">
            {done ? <span className="sbi-state"><CheckMark size={14} />{t('signin.signedIn')}</span> : skipped ? <>
              <span className="sbi-state sbi-dim">{t('signin.skipped')}</span>
              <button type="button" className="aip-button aip-quiet" disabled={busy === item.id} onClick={() => void act(item.id, { type: 'signin.mark', id: item.id, status: 'todo' })}>{t('signin.addBack')}</button>
            </> : <>
              {item.status === 'opened' && <span className="sbi-state sbi-dim">{t('signin.opened')}</span>}
              <button type="button" className={item.status === 'opened' ? 'aip-button' : 'aip-button sbi-go'} disabled={busy === item.id} aria-label={t('signin.signInTo', { name: item.name })}
                onClick={() => void act(item.id, { type: 'signin.open', id: item.id })}>{item.status === 'opened' ? t('signin.openAgain') : t('signin.signIn')}</button>
              <button type="button" className="aip-button aip-quiet" disabled={busy === item.id} onClick={() => void act(item.id, { type: 'signin.mark', id: item.id, status: 'skipped' })}>{t('signin.skip')}</button>
            </>}
          </span>
        </li>;
      })}
    </ul>}
    {error && <p className="aip-notice aip-error" role="alert">{error}</p>}
    <div className="aip-actions sbi-foot">
      {shown ? <button type="button" className="aip-button aip-quiet" onClick={() => { setExpanded(false); void call({ type: 'signin.dismiss', dismissed: true }); }}>{t('signin.dismiss')}</button>
        : <button type="button" className="aip-button" onClick={() => { setExpanded(true); void call({ type: 'signin.dismiss', dismissed: false }); }}>{t('signin.show')}</button>}
    </div>
  </section>;
}
