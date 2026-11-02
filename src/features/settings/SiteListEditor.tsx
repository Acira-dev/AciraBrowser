import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { X } from '../../components/AppIcons';
import { useListMotion } from '../../ui/sharedMotion';
import { t } from '../../i18n';
import { addSites, removeSite, siteLimit } from './siteList';
import './site-list.css';

/** How long a removed row takes to leave: short, and skipped entirely when motion is off. */
const leaveMs = 110;

/**
 * A list of sites with an add field and a remove × on every row (Settings, house style). It edits a list of hosts and reports each
 * change through `onChange`; the caller stores it. Typing several sites at once (commas or new lines) adds them all.
 */
export function SiteListEditor({ sites, onChange, label, disabled }: { sites: string[]; onChange: (next: string[]) => void; label: string; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<'invalid' | 'duplicate' | 'full' | ''>('');
  const [leaving, setLeaving] = useState('');
  const messageId = useId(), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // R3-70: rows glide to their new places and the settings below the list slide with it, instead of jumping.
  const block = useRef<HTMLDivElement>(null), rows = useRef<HTMLUListElement>(null), signature = sites.join('|');
  useListMotion(block, signature, { followers: true }); useListMotion(rows, signature);
  useEffect(() => () => clearTimeout(timer.current), []);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !draft.trim()) return;
    const { next, result } = addSites(sites, draft);
    if (result !== 'added') { setProblem(result); return; }
    setProblem('');
    setDraft('');
    onChange(next);
  };
  const remove = (site: string) => {
    if (disabled) return;
    clearTimeout(timer.current);
    setProblem('');
    // The global motion speed (--motion-scale on .app: Premium 1.7, Fast 1, Off 0; 1 until it exists) times the base duration; Off and the OS setting skip the exit.
    const app = document.querySelector('.app'), scale = parseFloat(getComputedStyle(app ?? document.documentElement).getPropertyValue('--motion-scale')), factor = Number.isFinite(scale) ? scale : 1;
    if (factor === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches || app?.getAttribute('data-reduced-motion') === 'true') { onChange(removeSite(sites, site)); return; }
    setLeaving(site);
    timer.current = setTimeout(() => { setLeaving(''); onChange(removeSite(sites, site)); }, leaveMs * factor);
  };
  const message = problem === 'invalid' ? t('sitelist.invalid') : problem === 'duplicate' ? t('sitelist.duplicate') : problem === 'full' ? t('sitelist.full', { count: siteLimit }) : '';

  return <div ref={block} className="sl" data-disabled={disabled || undefined}>
    <form className="sl-add" onSubmit={add} noValidate>
      <input className="st-input sl-input" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={t('sitelist.addSite')} aria-invalid={problem ? true : undefined} aria-describedby={message ? messageId : undefined}
        placeholder="mail.example.com" value={draft} disabled={disabled} onChange={(event) => { setDraft(event.target.value); if (problem) setProblem(''); }} />
      <button type="submit" className="st-button" disabled={disabled || !draft.trim()}>{t('sitelist.add')}</button>
    </form>
    <p id={messageId} className="sl-message" role="alert" hidden={!message}>{message}</p>
    {sites.length > 0
      ? <ul ref={rows} className="sl-list" aria-label={label}>
        {sites.map((site) => <li key={site} data-leaving={leaving === site || undefined}>
          <span className="sl-site"><bdi>{site}</bdi></span>
          <button type="button" className="sl-remove" aria-label={t('sitelist.removeAria', { site })} title={t('sitelist.remove')} disabled={disabled} onClick={() => remove(site)}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>
        </li>)}
      </ul>
      : <p className="sl-empty">{t('sitelist.empty')}</p>}
  </div>;
}
